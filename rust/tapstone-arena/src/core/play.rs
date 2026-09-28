//! A running match (arena spec §5.2–§5.4; protocol §4.3–§4.5 with the arena as arbiter).
use tapstone_proto::frame::{
    Ack, BROADCAST, Commit, Frame, Halt, Header, MatchResult, Nak, Tap, arena_refusal, halt_reason,
    join_role, refusal_code, result_reason,
};
use tapstone_proto::ids::rules_id;
use tapstone_proto::transcript::{TranscriptHeader, record_bytes, transcript_sha};
use tapstone_rules::{Applied, Chain, Kind, Record, Refusal, Winner};

use crate::view::ViewModel;

use super::{ArenaCore, Committed, JournalOp, Match, MatchOver, Output, Table};

/// Protocol / state-machine.md timers.
pub const RETRANSMIT_MS: u64 = 200;
pub const RETRIES: u8 = 5;
pub const HEAD_MS: u64 = 1000;
pub const STALE_MS: u64 = 3000;
/// A lost *seat* times the match out (0028 keeps this only for seats, never for the arena).
pub const LOST_MS: u64 = 120_000;

fn needs_card(k: Kind) -> bool {
    matches!(k, Kind::Charge | Kind::CastUnit | Kind::CastSpell)
}

/// Whether `proposal` is the tap `committed` records: every field the shrine chose. The arena's
/// own stamps (seq, time, auth) and the card it resolved from the UID are excluded, as is the seat
/// byte, which the arena overwrites with the node's seat.
fn same_tap(committed: &Record, proposal: &Record, seat: usize) -> bool {
    committed.seat as usize == seat
        && committed.kind == proposal.kind
        && committed.uid == proposal.uid
        && committed.lane == proposal.lane
        && committed.target == proposal.target
        && committed.aux == proposal.aux
        && (committed.card == proposal.card || committed.uid != [0; 7])
}

fn commit_of(c: &Committed) -> Commit {
    Commit {
        mseq: c.record.seq,
        lseq: c.lseq,
        record: c.record,
        hash: c.hash.unwrap_or([0; 8]),
    }
}

impl ArenaCore {
    pub(crate) fn running(&mut self) -> Option<&mut Match> {
        match &mut self.table {
            Table::Match(m) => Some(m),
            Table::Lobby(_) => None,
        }
    }

    /// Stamp, apply, chain, journal, broadcast. The journal output precedes the send (D10).
    pub(crate) fn commit(
        &mut self,
        mut r: Record,
        lseq: u16,
        now: u64,
        out: &mut Vec<Output>,
    ) -> Result<(), Refusal> {
        let Some(m) = self.running() else {
            return Err(Refusal::NotPlaying);
        };
        r.seq = m.game.seq;
        r.time_ms = now.saturating_sub(m.started_ms) as u32;
        r.auth = 0;
        let applied = m.game.apply(&r)?;
        let hash = if applied == Applied::Started {
            let c = Chain::genesis(&m.game);
            // B stated this genesis before the claims went out (#67): one computation, two paths.
            debug_assert!(m.begin.genesis == [0; 8] || m.begin.genesis == c.head());
            m.chain = Some(c);
            None
        } else if let Some(c) = m.chain.as_mut() {
            c.step(&r, &m.game);
            Some(c.head())
        } else {
            None
        };
        let committed = Committed {
            record: r,
            hash,
            applied,
            lseq,
        };
        super::track_uids(m, &r);
        m.log.push(committed);
        if r.kind != Kind::ClaimSeat {
            m.last_lseq[r.seat as usize] = Some(lseq);
        }
        m.last_broadcast = now;
        m.last_tx = [now; 2]; // the broadcast just now counts as a transmission to both seats
        let id = m.id;
        out.push(Output::Journal(JournalOp::Record {
            match_id: id,
            record: r.encode(),
            hash,
        }));
        self.send(out, BROADCAST, id, &Frame::Commit(commit_of(&committed)));
        out.push(Output::View(self.view()));
        if let Applied::GameEnded(Winner::Seat(w)) = applied {
            let lethal = self
                .running()
                .is_some_and(|m| m.game.seats.iter().any(|s| s.castle.life == 0));
            let reason = if lethal {
                result_reason::LETHAL
            } else {
                result_reason::STOP
            };
            self.finish(reason, Some(w), out);
        }
        Ok(())
    }

    pub(crate) fn play_frame(
        &mut self,
        src: u8,
        h: Header,
        f: Frame,
        now: u64,
        out: &mut Vec<Output>,
    ) {
        let Some(m) = self.running() else { return };
        // A match frame names the match it is about. One from the last match (a shrine still
        // holding it) must not act on this one: an ACK's hash is compared against this match's log,
        // a HALT would void it (found by the first two-match desk run), a TAP would be committed
        // here, costing a seat a move nobody made in this match (Oracle on #89), and a NAK would
        // replay this match to a shrine that asked about another. JOIN is exempt: a shrine asks with
        // J precisely when it lacks this match's B and so cannot know its id (it sends 0).
        let scoped = matches!(
            f,
            Frame::Ack(_) | Frame::Halt(_) | Frame::Tap(_) | Frame::Nak(_)
        );
        if scoped && h.match_id != m.id {
            return;
        }
        let Some(seat) = m.nodes.iter().position(|&n| n == src) else {
            return;
        };
        m.last_heard[seat] = now;
        m.tries[seat] = 0;
        // A revived arena whose hand-back is incomplete (spec §7) holds only the journaled prefix;
        // the interim's records above it are still on their way. It commits nothing until it has
        // them: a tap is dropped (the shrine retransmits until a C arrives). Before this it
        // committed taps on top of the prefix, and the late hand-back voided a match both shrines
        // agreed on as a DESYNC (#95). Its J and N answers need no guard: with taps dropped the
        // log holds only that prefix until it resumes, and the prefix is final. A gameless seat 0
        // (the would-be interim) needs exactly that, B and the prefix, to hand back at all.
        if matches!(f, Frame::Tap(_)) && m.dark.as_ref().is_some_and(|d| !d.resumed) {
            return;
        }
        let was_paused = std::mem::replace(&mut m.paused, false);
        if was_paused {
            out.push(Output::View(self.view()));
        }
        match f {
            Frame::Tap(Tap::Propose { lseq, record }) => {
                self.tap(seat, src, lseq, record, now, out)
            }
            Frame::Ack(a) => self.ack(seat, a, out),
            Frame::Nak(n) => self.replay_range(n, out),
            // A rebooted seat rejoins by JOIN: a full replay of the log from what it holds (ruled
            // 2026-09-23, "(b)"). It rebuilds its state and its seat's last lseq from the records,
            // exactly as on the NAK path. A snapshot (`S`) is for spectators, built with them.
            // A shrine without the match's B (#67) asks the same way: B first, then the replay.
            Frame::Join(j) if j.role == join_role::SEAT => {
                self.send_begin(src, out);
                self.replay_range(
                    Nak {
                        from: j.have_mseq,
                        to: 0xFFFF,
                    },
                    out,
                )
            }
            Frame::Halt(x) => self.halt(x, out),
            other => self.dark_frame(src, seat, other, now, out),
        }
    }

    fn tap(
        &mut self,
        seat: usize,
        src: u8,
        lseq: u16,
        mut r: Record,
        now: u64,
        out: &mut Vec<Output>,
    ) {
        let Some(m) = self.running() else { return };
        let id = m.id;
        if r.kind == Kind::ClaimSeat {
            return; // a late retransmit of a lobby claim
        }
        if m.last_lseq[seat].is_some_and(|l| lseq <= l) {
            // A used lseq. Re-send its commit only if the proposal IS the tap committed under it (a
            // retransmit whose C was lost). Anything else is a counter that went backwards (a
            // rebooted shrine) or an lseq the arena knows only from a hand-back: refuse it, so the
            // shrine re-syncs instead of taking an old commit as confirmation of a new tap (the
            // silent loss Oracle found on #74).
            let same = m
                .log
                .iter()
                .rev()
                .find(|c| c.record.seat as usize == seat && c.lseq == lseq)
                .filter(|c| same_tap(&c.record, &r, seat))
                .map(commit_of);
            match same {
                Some(c) => self.send(out, BROADCAST, id, &Frame::Commit(c)),
                None => self.send(
                    out,
                    src,
                    id,
                    &Frame::Tap(Tap::Reject {
                        lseq,
                        reason: arena_refusal::STALE_LSEQ,
                    }),
                ),
            }
            return;
        }
        r.seat = seat as u8; // the node's seat, whatever the byte claims
        if r.kind == Kind::Draw && m.drawn[seat].contains(&r.uid) {
            let reject = Frame::Tap(Tap::Reject {
                lseq,
                reason: arena_refusal::COPY_DRAWN,
            });
            self.send(out, src, id, &reject);
            return;
        }
        if needs_card(r.kind) {
            match self.registry.resolve_or(r.uid, r.card) {
                Some(card) => r.card = card,
                None => {
                    self.send(
                        out,
                        src,
                        id,
                        &Frame::Tap(Tap::Reject {
                            lseq,
                            reason: arena_refusal::UNKNOWN_UID,
                        }),
                    );
                    return;
                }
            }
        }
        if let Err(e) = self.commit(r, lseq, now, out) {
            self.send(
                out,
                src,
                id,
                &Frame::Tap(Tap::Reject {
                    lseq,
                    reason: refusal_code(&e),
                }),
            );
        }
    }

    /// The match's `B`, unicast to `node` (#67).
    fn send_begin(&mut self, node: u8, out: &mut Vec<Output>) {
        let Some(m) = self.running() else { return };
        let (id, b) = (m.id, m.begin);
        self.send(out, node, id, &Frame::Begin(b));
    }

    fn ack(&mut self, seat: usize, a: Ack, out: &mut Vec<Output>) {
        let Some(m) = self.running() else { return };
        let Some(want) = m.log.get(a.mseq as usize).map(|c| c.hash.unwrap_or([0; 8])) else {
            return;
        };
        if want != a.hash {
            // Round one of a handover: the arena's journaled head may never have gone out (#98).
            if self.rewind_unagreed(a.mseq, out) {
                return;
            }
            let x = Halt {
                at_mseq: a.mseq,
                reason: halt_reason::HASH,
                mine: want,
                theirs: a.hash,
            };
            return self.halt(x, out);
        }
        let acked = &mut m.acked[seat];
        *acked = Some(acked.map_or(a.mseq, |x| x.max(a.mseq)));
        // #98 b/c: the interim ACKing the arena's head after the handover means it heard an arena
        // commit and stepped down, so its log is frozen. Ask for the rest of it, from the head.
        let head = m.log.len();
        if a.mseq as usize + 1 == head
            && let Some(d) = m
                .dark
                .as_mut()
                .filter(|d| d.stage == super::dark::Stage::HandBack)
        {
            if !d.agreed {
                // #167: an empty tail waited on this; ask again at the next tick, not a whole
                // HANDBACK_NAK_MS after the last J (`an_agreed_empty_tail_is_taken_within_...`).
                d.last_nak = 0;
            }
            d.agreed = true; // #98: the hand-back's starting point is agreed
        }
        if seat == 0
            && a.mseq as usize + 1 == head
            && let Some(d) = m
                .dark
                .as_mut()
                .filter(|d| d.stage == super::dark::Stage::AwaitAck)
        {
            d.stage = super::dark::Stage::Confirm;
            d.last_nak = 0; // the next tick asks
        }
    }

    /// NAK: re-send `from..=to` (`to = 0xFFFF` = head). The arena keeps the whole log, so any gap
    /// is replayable; the 64-commit ring of §4.4 is a shrine-side limit.
    fn replay_range(&mut self, n: Nak, out: &mut Vec<Output>) {
        let Some(m) = self.running() else { return };
        let id = m.id;
        let end = (n.to as usize).min(m.log.len().saturating_sub(1));
        let commits: Vec<Commit> = m
            .log
            .get(n.from as usize..=end)
            .unwrap_or(&[])
            .iter()
            .map(commit_of)
            .collect();
        for c in commits {
            self.send(out, BROADCAST, id, &Frame::Commit(c));
        }
    }

    /// Divergence (§5): broadcast X, void the match, post it with both hashes. Never pick a winner.
    pub(crate) fn halt(&mut self, x: Halt, out: &mut Vec<Output>) {
        let Some(m) = self.running() else { return };
        let id = m.id;
        self.send(out, BROADCAST, id, &Frame::Halt(x));
        out.push(Output::Log(format!(
            "desync at {} ({:02x?} vs {:02x?})",
            x.at_mseq, x.mine, x.theirs
        )));
        self.finish(result_reason::DESYNC, None, out);
    }

    pub(crate) fn play_tick(&mut self, now: u64, out: &mut Vec<Output>) {
        if self.dark_tick(now, out) {
            return; // no retransmits, pauses or timeouts while the hand-back is in flight
        }
        let Some(m) = self.running() else { return };
        let id = m.id;
        let head = m.log.len().saturating_sub(1) as u16;
        let mut resend: Vec<Commit> = Vec::new();
        let mut begin_to: Vec<u8> = Vec::new();
        let mut pause = false;
        for seat in 0..2 {
            let behind = m.acked[seat].is_none_or(|a| a < head);
            if behind && now.saturating_sub(m.last_tx[seat]) >= RETRANSMIT_MS {
                if m.tries[seat] >= RETRIES {
                    pause = true;
                } else {
                    // A seat that has acked nothing may never have heard B (#67): it goes first.
                    if m.acked[seat].is_none() {
                        begin_to.push(m.nodes[seat]);
                    }
                    let next = m.acked[seat].map_or(0, |a| a + 1) as usize;
                    if let Some(c) = m.log.get(next) {
                        resend.push(commit_of(c));
                    }
                    m.last_tx[seat] = now;
                    m.tries[seat] += 1;
                }
            }
            if now.saturating_sub(m.last_heard[seat]) > STALE_MS {
                pause = true;
            }
        }
        if now.saturating_sub(m.last_broadcast) >= HEAD_MS {
            if let Some(c) = m.log.last() {
                resend.push(commit_of(c));
            }
            m.last_broadcast = now;
        }
        let lost = (0..2).find(|&s| now.saturating_sub(m.last_heard[s]) > LOST_MS);
        let newly_paused = pause && !m.paused;
        m.paused |= pause;
        for node in begin_to {
            self.send_begin(node, out);
        }
        for c in resend {
            self.send(out, BROADCAST, id, &Frame::Commit(c));
        }
        if newly_paused {
            out.push(Output::View(self.view()));
        }
        if let Some(lost) = lost {
            self.finish(result_reason::TIMEOUT, Some(1 - lost as u8), out);
        }
    }

    /// Close the match: RESULT, journal End, and the MatchOver the ledger and poster consume.
    pub(crate) fn finish(&mut self, reason: u8, winner: Option<u8>, out: &mut Vec<Output>) {
        let final_view = match &self.table {
            Table::Match(m) => ViewModel::of_match(m, None),
            Table::Lobby(_) => return,
        };
        let mut next = super::lobby::Lobby {
            last_over: Some(Box::new(ViewModel {
                phase: "over".into(),
                ..final_view
            })),
            ..Default::default()
        };
        // A timeout's winner is the arena's call, which the engine never saw.
        if let Some(v) = next.last_over.as_mut() {
            v.winner = winner;
        }
        let Table::Match(m) = std::mem::replace(&mut self.table, Table::Lobby(next)) else {
            return;
        };
        let records: Vec<[u8; 32]> = m
            .log
            .iter()
            .map(|c| record_bytes(&c.record, c.hash))
            .collect();
        let header = TranscriptHeader {
            match_id: m.id,
            ruleset: self.cfg.ruleset,
            registry: self.cfg.registry_id,
            rules: rules_id(&self.cfg.rules),
            seat_nodes: m.nodes,
            deck_sigils: m.sigils,
            start_ts: m.start_unix,
        }
        .encode();
        let sha = transcript_sha(&header, &records);
        let head = m.chain.map_or([0; 8], |c| c.head());
        let final_mseq = m.log.last().map_or(0, |c| c.record.seq);
        let mut result =
            MatchResult::unsigned(final_mseq, winner.unwrap_or(0xFF), reason, head, sha);
        let (kind, sig) = self.signer.sign(&result, m.id);
        result.sig_kind = kind;
        result.sig = sig;
        self.send(out, BROADCAST, m.id, &Frame::Result(result));
        out.push(Output::Journal(JournalOp::End {
            match_id: m.id,
            result,
        }));
        let mut tsx1 = header.to_vec();
        for r in &records {
            tsx1.extend_from_slice(r);
        }
        let json = crate::transcript::to_json(&m, &self.cfg.rules);
        out.push(Output::MatchOver(Box::new(MatchOver {
            match_id: m.id,
            result,
            nodes: m.nodes,
            figurines: m.figurines,
            winner,
            round: m.game.round,
            tsx1,
            json,
        })));
        out.push(Output::View(self.view()));
        self.last_beacon = None;
        self.linger = Some(super::linger::Linger::new(m, result));
    }
}
