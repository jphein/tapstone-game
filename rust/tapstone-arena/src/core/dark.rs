//! Arena-dark recovery (spec §7): journal → rebuild → J → H chunks → verify → take over.
use std::collections::BTreeMap;
use tapstone_proto::frame::{
    BROADCAST, Commit, Frame, HANDBACK_RECORDS, Halt, HandbackNak, Join, halt_reason, join_role,
};

use tapstone_rules::{Applied, Chain, Game, HouseRules, Record};

use super::{
    ArenaCore, Committed, CoreConfig, JournalOp, Match, Output, Signer, StatsSource, Table,
    track_uids,
};
use crate::decks::DeckBook;
use crate::registry::Registry;

pub const HANDBACK_NAK_MS: u64 = 200;
/// How long a handover (first hand-back verified → resumed, #98 b/c) is expected to take, at most.
/// Measured 2026-09-25 on familiar with broadcast loss drawn per receiver: over 660 lossy runs
/// (three meshes, either seat's `B` dropped, 110 seeds) the longest was 1010 ms (p99 610 ms);
/// this is 3× that. Past it the arena logs once that the handover is still open, and keeps waiting: it
/// never resumes on a log that may be incomplete, and never voids a match that may still recover.
pub const HANDOVER_BOUND_MS: u64 = 3_000;

/// What the journal knows about the match in flight.
#[derive(Debug, Clone, PartialEq)]
pub struct RecoveredMatch {
    pub match_id: u32,
    pub rules: [u8; 9],
    pub nodes: [u8; 2],
    pub figurines: [[u8; 7]; 2],
    pub decks: [Vec<u16>; 2],
    pub start_unix: u32,
    pub records: Vec<([u8; 24], Option<[u8; 8]>)>,
}

impl RecoveredMatch {
    /// The last match with a `Begin` and no `End`, from an ordered journal.
    pub fn from_journal(ops: &[JournalOp]) -> Option<RecoveredMatch> {
        let begin = ops
            .iter()
            .rposition(|o| matches!(o, JournalOp::Begin { .. }))?;
        let JournalOp::Begin {
            match_id,
            rules,
            nodes,
            figurines,
            decks,
            start_unix,
        } = ops[begin].clone()
        else {
            return None;
        };
        let mut records = Vec::new();
        for o in &ops[begin + 1..] {
            match o {
                JournalOp::Record {
                    match_id: id,
                    record,
                    hash,
                } if *id == match_id => {
                    // A record at an mseq already journaled replaces it and everything after it:
                    // a revived arena that rewound an unagreed tail (#98) journals the interim's.
                    let seq = u16::from_le_bytes([record[0], record[1]]) as usize;
                    records.truncate(seq);
                    records.push((*record, *hash));
                }
                JournalOp::End { match_id: id, .. } if *id == match_id => return None,
                _ => {}
            }
        }
        Some(RecoveredMatch {
            match_id,
            rules,
            nodes,
            figurines,
            decks,
            start_unix,
            records,
        })
    }
}

pub(crate) struct Dark {
    pub from: u16,
    pub count: Option<u8>,
    pub chunks: Vec<Option<Vec<[u8; 32]>>>,
    pub last_nak: u64,
    /// Commits the interim arbiter broadcast that the arena overheard, by mseq. The interim keeps
    /// arbitrating until it sees the arena's handover commit, so it can commit past the hand-back
    /// it sent; spec §7 step 5 hands over only when the heads are equal, so these are adopted too,
    /// through the same verify path.
    pub overheard: BTreeMap<u16, Commit>,
    /// The hand-back is verified and the arena arbitrates again.
    pub resumed: bool,
    /// Each seat's last committed lseq as the interim arbiter reported it in `H`.
    pub last_lseq: [u16; 2],
    /// Where the handover is (#98 b/c, candidate 1).
    pub stage: Stage,
    /// When the first hand-back was verified (the handover commit went out).
    pub verified_at: Option<u64>,
    /// The handover outlived `HANDOVER_BOUND_MS` and the arena said so (once).
    pub overdue_logged: bool,
    /// A shrine ACKed the arena's head with the arena's own hash during round one, so the prefix
    /// the hand-back starts from is agreed (#98). Until then a hand-back that fails at its first
    /// record may only mean the arena's head is a commit no shrine ever heard.
    pub agreed: bool,
}

/// The handover, in rounds (#98 b/c). The first hand-back can miss interim commits: the interim
/// arbitrates until it hears the handover, and the arena may not overhear what it commits. So the
/// arena resumes only once the interim has stepped down and a second hand-back, from the arena's
/// head, has come back and been absorbed. Until then it commits nothing (#95), and it never stops
/// asking: an interim that does not answer leaves the match waiting (0028), never resumed on a log
/// that may be incomplete.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Stage {
    /// Collecting the first hand-back, from the journaled prefix.
    HandBack,
    /// The first hand-back is verified and the handover commit sent: waiting for the interim to
    /// ACK the arena's head, which it does only once it has heard an arena commit and stepped down.
    AwaitAck,
    /// The interim has stepped down: collecting the second hand-back, from the arena's head. Its
    /// log is frozen now, so this one is complete.
    Confirm,
}

impl ArenaCore {
    /// Rebuild the match by re-applying every journaled record, then ask seat 0's shrine for the
    /// gap. Returns the core and the frames to send.
    pub fn recover(
        cfg: CoreConfig,
        stats: Box<dyn StatsSource + Send>,
        decks: DeckBook,
        registry: Registry,
        signer: Box<dyn Signer + Send>,
        rec: RecoveredMatch,
        now: u64,
    ) -> (ArenaCore, Vec<Output>) {
        let mut core = ArenaCore::new(cfg, stats, decks, registry, signer);
        core.last_match = Some(rec.match_id); // the next match must not reuse this id
        let rules = HouseRules::from_bytes(rec.rules);
        let mut game = Game::new(rules, [0, 1], [&rec.decks[0], &rec.decks[1]]);
        let mut chain = None;
        let mut log = Vec::new();
        let mut out = Vec::new();
        for (bytes, hash) in &rec.records {
            let Some(r) = Record::decode(bytes) else {
                break;
            };
            let Ok(applied) = game.apply(&r) else { break };
            let h = step(&mut chain, &game, &r, applied);
            if h != *hash {
                out.push(Output::Log(format!(
                    "journal disagrees with the engine at {}",
                    r.seq
                )));
                break;
            }
            log.push(Committed {
                record: r,
                hash: h,
                applied,
                lseq: 0,
            });
        }
        let from = log.len() as u16;
        // B for a seat that J's after the revival (#67): zero genesis if the journal never started.
        let genesis = super::lobby::genesis_after(
            Game::new(rules, [0, 1], [&rec.decks[0], &rec.decks[1]]),
            log.iter().map(|c: &Committed| &c.record),
        );
        let begin = tapstone_proto::frame::Begin::new(
            &rules,
            rec.nodes,
            genesis,
            [&rec.decks[0], &rec.decks[1]],
        );
        core.table = Table::Match(Box::new(Match {
            id: rec.match_id,
            game,
            chain,
            log,
            nodes: rec.nodes,
            figurines: rec.figurines,
            sigils: [
                tapstone_proto::ids::deck_sigil(&rec.decks[0]),
                tapstone_proto::ids::deck_sigil(&rec.decks[1]),
            ],
            decks: rec.decks,
            begin,
            started_ms: now,
            start_unix: rec.start_unix,
            acked: [None; 2],
            last_heard: [now; 2],
            last_tx: [now; 2],
            tries: [0; 2],
            last_lseq: [None; 2],
            last_broadcast: now,
            paused: true,
            dark: Some(Dark {
                from,
                count: None,
                chunks: Vec::new(),
                last_nak: now,
                overheard: BTreeMap::new(),
                resumed: false,
                last_lseq: [0; 2],
                stage: Stage::HandBack,
                verified_at: None,
                overdue_logged: false,
                agreed: false,
            }),
            handover_ms: None,
            drawn: Default::default(),
            in_hand: Default::default(),
        }));
        if let Table::Match(m) = &mut core.table {
            let replayed: Vec<Record> = m.log.iter().map(|c| c.record).collect();
            for r in &replayed {
                track_uids(m, r);
            }
        }
        let join = Frame::Join(Join {
            role: join_role::ARENA,
            have_mseq: from,
        });
        core.send(&mut out, rec.nodes[0], rec.match_id, &join);
        out.push(Output::View(core.view()));
        (core, out)
    }

    pub(crate) fn dark_frame(
        &mut self,
        _src: u8,
        seat: usize,
        f: Frame,
        now: u64,
        out: &mut Vec<Output>,
    ) {
        let Some(m) = self.running() else { return };
        let Some(d) = m.dark.as_mut() else { return };
        match f {
            // Between the rounds the arena takes no hand-back: a late or duplicate round-one chunk
            // (an empty tail has the same `from` as round two) must not complete anything
            // (Oracle on #100: it resumed 80 of 660 runs without the interim's ACK).
            Frame::Handback(hb) if !d.resumed && d.stage != Stage::AwaitAck => {
                if hb.from_mseq != d.from || hb.n as usize > HANDBACK_RECORDS {
                    return;
                }
                let count = *d.count.get_or_insert(hb.count);
                if d.chunks.len() < count as usize {
                    d.chunks.resize(count as usize, None);
                }
                for s in 0..2 {
                    d.last_lseq[s] = d.last_lseq[s].max(hb.last_lseq[s]);
                }
                if let Some(slot) = d.chunks.get_mut(hb.idx as usize) {
                    *slot = Some(hb.records[..hb.n as usize].to_vec());
                }
                if d.chunks.iter().all(Option::is_some) {
                    self.take_over(now, out);
                }
            }
            // The interim arbiter (seat 0's shrine) committing on its own: keep it for adoption.
            Frame::Commit(c) if seat == 0 => {
                d.overheard.insert(c.mseq, c);
                if d.resumed {
                    self.absorb(Vec::new(), now, out);
                }
            }
            _ => {}
        }
    }

    /// The hand-back is complete: verify it, then every consecutive overheard interim commit, and
    /// resume (spec §7 steps 4-5).
    fn take_over(&mut self, now: u64, out: &mut Vec<Output>) {
        let Some(m) = self.running() else { return };
        let Some(d) = m.dark.as_mut().filter(|d| d.stage != Stage::AwaitAck) else {
            return;
        };
        let records: Vec<([u8; 32], Option<u16>)> = std::mem::take(&mut d.chunks)
            .into_iter()
            .flatten()
            .flatten()
            .map(|b| (b, None))
            .collect();
        if records.is_empty() && d.stage == Stage::HandBack && !d.agreed {
            // An empty tail verifies nothing, least of all the arena's head: the interim may hold
            // exactly as many records as the journal and its own at the head's mseq (#167). Keep
            // asking, and send the interim the head now rather than at the next re-broadcast: its
            // ACK agrees it (and the arena asks again at once) or rewinds it (`rewind_unagreed`).
            d.count = None;
            let (id, node) = (m.id, m.nodes[0]);
            if let Some(c) = m.log.last().map(commit_at) {
                self.send(out, node, id, &Frame::Commit(c));
            }
            return;
        }
        if self.absorb(records, now, out) {
            let Some(m) = self.running() else { return };
            let id = m.id;
            let len = m.log.len();
            if let Some(d) = m.dark.as_mut().filter(|d| d.stage == Stage::HandBack) {
                // Round one verified. Send the handover and wait for the interim to step down;
                // commit nothing yet (#98 b/c).
                d.stage = Stage::AwaitAck;
                d.verified_at = Some(now);
                d.from = len as u16;
                d.count = None;
                d.last_nak = now;
                out.push(Output::Log(format!(
                    "hand-back verified at mseq {len}; waiting for the interim to step down"
                )));
                if let Some(c) = m.log.last() {
                    let commit = commit_at(c);
                    self.send(out, BROADCAST, id, &Frame::Commit(commit));
                }
                self.finish_if_over(out);
                return;
            }
            // Only round two resumes: the interim has ACKed the head, so its log was frozen when
            // it handed back the rest.
            let Some(d) = m.dark.as_mut().filter(|d| d.stage == Stage::Confirm) else {
                return;
            };
            {
                d.resumed = true;
                if let Some(t) = d.verified_at {
                    m.handover_ms = Some(now.saturating_sub(t));
                }
                // Dedupe from the interim's lseqs: a tap it committed and a seat retransmits must
                // not be committed twice (ruled 2026-09-23; the records themselves carry no lseq).
                for s in 0..2 {
                    if d.last_lseq[s] > 0 {
                        let l = m.last_lseq[s].map_or(d.last_lseq[s], |x| x.max(d.last_lseq[s]));
                        m.last_lseq[s] = Some(l);
                    }
                }
            }
            m.paused = false;
            m.last_heard = [now; 2];
            out.push(Output::Log(format!(
                "arena resumed at mseq {}",
                m.log.len()
            )));
            if let Some(c) = m.log.last() {
                let commit = commit_at(c);
                self.send(out, BROADCAST, id, &Frame::Commit(commit));
            }
            out.push(Output::View(self.view()));
            self.finish_if_over(out);
        }
    }

    /// Re-apply `records` (handed back, no lseq), then every overheard interim commit that is next
    /// in line, each through the engine and compared with its carried hash. One mismatch halts the
    /// match (spec §7 step 4): the arena never trusts a hash it cannot recompute. Returns false if
    /// it halted.
    fn absorb(
        &mut self,
        records: Vec<([u8; 32], Option<u16>)>,
        now: u64,
        out: &mut Vec<Output>,
    ) -> bool {
        let Some(m) = self.running() else {
            return false;
        };
        let id = m.id;
        let resumed = m.dark.as_ref().is_some_and(|d| d.resumed);
        let mut queue = records.into_iter();
        let mut adopted_late = false;
        loop {
            if m.game.phase == tapstone_rules::Phase::Over {
                break;
            }
            let next = match queue.next() {
                Some(x) => x,
                None => {
                    let at = m.game.seq;
                    let Some(c) = m.dark.as_mut().and_then(|d| d.overheard.remove(&at)) else {
                        break;
                    };
                    let mut b = [0u8; 32];
                    b[..24].copy_from_slice(&c.record.encode());
                    b[24..].copy_from_slice(&c.hash);
                    adopted_late = true;
                    (b, Some(c.lseq))
                }
            };
            match verify_one(m, &next.0) {
                Ok(mut committed) => {
                    if let Some(lseq) = next.1 {
                        committed.lseq = lseq;
                        m.last_lseq[committed.record.seat as usize] = Some(lseq);
                    }
                    track_uids(m, &committed.record);
                    m.log.push(committed);
                    out.push(Output::Journal(JournalOp::Record {
                        match_id: id,
                        record: committed.record.encode(),
                        hash: committed.hash,
                    }));
                }
                Err(x) => {
                    // Round one's hand-back failing at its first record, before any shrine has
                    // ACKed the arena's head: the head may be a commit the arena journaled and
                    // never got on the air, so the interim arbitrated that mseq itself (#98). Drop
                    // the hand-back and keep asking; the head re-broadcast (#98(a)) draws the ACK
                    // that either agrees (a mismatch here then halts) or rewinds the head.
                    if let Some(d) = m
                        .dark
                        .as_mut()
                        .filter(|d| d.stage == Stage::HandBack && !d.agreed && x.at_mseq == d.from)
                    {
                        d.count = None;
                        d.chunks.clear();
                        rebuild(m); // verify_one applied the refused record
                        return false;
                    }
                    self.halt(x, out);
                    return false;
                }
            }
        }
        if let Some(d) = m.dark.as_mut() {
            let head = m.game.seq;
            d.overheard.retain(|&k, _| k >= head); // older ones are already in the log
        }
        if resumed && adopted_late {
            m.last_heard = [now; 2];
            let id = m.id;
            if let Some(c) = m.log.last() {
                let commit = commit_at(c);
                self.send(out, BROADCAST, id, &Frame::Commit(commit));
            }
            out.push(Output::View(self.view()));
            self.finish_if_over(out);
        }
        true
    }

    /// Round one of the handover, and a shrine ACKed `mseq` with a hash that is not the arena's
    /// (#98). A resuming arena commits nothing (#95), so its log is the journaled prefix, and a
    /// shrine that holds a different record there never heard the arena's: the arena journaled it
    /// and died before it went out, and the interim arbitrated that mseq itself. The record was
    /// never agreed, so the arena drops it and everything after it and asks for the hand-back from
    /// there; whatever comes back is still recomputed record by record. Returns false where that is
    /// no explanation (not round one, or at or before the record that started the chain, which `B`
    /// states): the caller halts as ever.
    pub(crate) fn rewind_unagreed(&mut self, mseq: u16, out: &mut Vec<Output>) -> bool {
        let Some(m) = self.running() else {
            return false;
        };
        let to = mseq as usize;
        let chained = to > 0 && m.log.get(to - 1).is_some_and(|c| c.hash.is_some());
        if !chained
            || to >= m.log.len()
            || !m
                .dark
                .as_ref()
                .is_some_and(|d| d.stage == Stage::HandBack && !d.resumed)
        {
            return false;
        }
        let dropped = m.log.len() - to;
        m.log.truncate(to);
        rebuild(m);
        // `acked` is left alone. It only takes ACKs whose hash matches the arena's chain, and a
        // hash at m commits to every record up to m, so a seat acked at or past `to` holds the very
        // record at `to` this drops. A follower never replaces a record it holds (a duplicate is
        // acked with its own hash), so that seat is forked from the history the arena adopts and
        // the match ends DESYNC whatever `acked` says. Retransmit and linger read the log with
        // `get`, so a stale ack past the head sends nothing. Measured: no rewind in 1,200 lossy
        // stress runs or the dark tests had any ack at all (Lead's perturbation on #160).
        let Some(d) = m.dark.as_mut() else {
            return false;
        };
        d.from = mseq;
        d.count = None;
        d.chunks.clear();
        d.last_nak = 0; // the next tick asks from here
        d.overheard.retain(|&k, _| k >= mseq);
        out.push(Output::Log(format!(
            "a shrine holds another record at mseq {mseq}: dropped {dropped} unagreed journaled \
             record(s), asking for the hand-back from {mseq}"
        )));
        true
    }

    fn finish_if_over(&mut self, out: &mut Vec<Output>) {
        let Some(m) = self.running() else { return };
        if m.game.phase != tapstone_rules::Phase::Over {
            return;
        }
        let winner = match m.game.winner {
            Some(tapstone_rules::Winner::Seat(s)) => Some(s),
            _ => None,
        };
        let lethal = m.game.seats.iter().any(|s| s.castle.life == 0);
        let reason = if lethal {
            tapstone_proto::frame::result_reason::LETHAL
        } else {
            tapstone_proto::frame::result_reason::STOP
        };
        self.finish(reason, winner, out);
    }

    /// While the hand-back is incomplete, NAK the missing chunks every 200 ms.
    pub(crate) fn dark_tick(&mut self, now: u64, out: &mut Vec<Output>) -> bool {
        let Some(m) = self.running() else {
            return false;
        };
        let (id, node) = (m.id, m.nodes[0]);
        if !m.dark.as_ref().is_some_and(|d| !d.resumed) {
            return false;
        }
        // #98(a): re-broadcast the head of the journaled prefix every HEAD_MS while resuming, as a
        // running match does. A shrine that lost a prefix commit (the interim, which then cannot
        // hand back from `from` at all) sees its gap and NAKs it; the answer comes from the final
        // prefix, since a resuming arena commits nothing (#95). Before this, nothing repaired such
        // a gap and the hand-back waited forever.
        let head = if now.saturating_sub(m.last_broadcast) >= super::play::HEAD_MS {
            m.last_broadcast = now;
            m.log.last().map(commit_at)
        } else {
            None
        };
        let Some(d) = m.dark.as_mut() else {
            return false;
        };
        // #167: until a shrine has ACKed the head with the arena's hash, the head may be a commit
        // the arena journaled and never got on the air, and the interim may hold its own record at
        // that mseq. Broadcast, seat 1 (which may have missed the interim's) takes the arena's and
        // is forked for good when the interim's ACK rewinds it. So it goes to the interim alone:
        // it ACKs (agreeing or rewinding), NAKs its gap, or takes the record, which is then the
        // interim's as well.
        let head_to = if d.stage == Stage::HandBack && !d.agreed {
            node
        } else {
            BROADCAST
        };
        if let Some(t) = d
            .verified_at
            .filter(|&t| now.saturating_sub(t) > HANDOVER_BOUND_MS)
            && !d.overdue_logged
        {
            d.overdue_logged = true;
            out.push(Output::Log(format!(
                "handover open {} ms (bound {HANDOVER_BOUND_MS} ms): the interim has not stepped \
                 down and handed back; the match waits",
                now.saturating_sub(t)
            )));
        }
        if now.saturating_sub(d.last_nak) >= HANDBACK_NAK_MS && d.stage == Stage::AwaitAck {
            // Re-send the handover until the interim ACKs it; it steps down on hearing it.
            d.last_nak = now;
            if let Some(c) = m.log.last().map(commit_at) {
                self.send(out, BROADCAST, id, &Frame::Commit(c));
            }
        } else if now.saturating_sub(d.last_nak) >= HANDBACK_NAK_MS {
            d.last_nak = now;
            let frame = match d.count {
                None => Frame::Join(Join {
                    role: join_role::ARENA,
                    have_mseq: d.from,
                }),
                Some(_) => {
                    let bitmap = d
                        .chunks
                        .iter()
                        .enumerate()
                        .filter(|(_, c)| c.is_none())
                        .fold(0u64, |b, (i, _)| b | (1 << i));
                    Frame::HandbackNak(HandbackNak {
                        from_mseq: d.from,
                        bitmap,
                    })
                }
            };
            self.send(out, node, id, &frame);
        }
        if let Some(c) = head {
            self.send(out, head_to, id, &Frame::Commit(c));
        }
        true
    }
}

/// The game, chain and card tracking again from the log alone: after a record was applied that the
/// log does not keep (a refused hand-back record), or the log was cut back (#98).
fn rebuild(m: &mut Match) {
    m.game = Game::new(m.game.rules, [0, 1], [&m.decks[0], &m.decks[1]]);
    m.chain = None;
    m.drawn = Default::default();
    m.in_hand = Default::default();
    let records: Vec<Record> = m.log.iter().map(|c| c.record).collect();
    for r in &records {
        let applied = m.game.apply(r).expect("the log applied once already");
        step(&mut m.chain, &m.game, r, applied);
        track_uids(m, r);
    }
}

fn commit_at(c: &Committed) -> Commit {
    Commit {
        mseq: c.record.seq,
        lseq: c.lseq,
        record: c.record,
        hash: c.hash.unwrap_or([0; 8]),
    }
}

/// One record through the engine and the chain, against the hash it carries.
fn verify_one(m: &mut Match, bytes: &[u8; 32]) -> Result<Committed, Halt> {
    let carried: [u8; 8] = bytes[24..].try_into().unwrap();
    let carried = (carried != [0; 8]).then_some(carried);
    let at = m.game.seq;
    let Some(r) = Record::decode(bytes).filter(|r| r.seq == at) else {
        return Err(handback_halt(at, [0; 8], carried));
    };
    let Ok(applied) = m.game.apply(&r) else {
        return Err(handback_halt(at, [0; 8], carried));
    };
    let h = step(&mut m.chain, &m.game, &r, applied);
    if h != carried {
        return Err(handback_halt(at, h.unwrap_or([0; 8]), carried));
    }
    Ok(Committed {
        record: r,
        hash: h,
        applied,
        lseq: 0,
    })
}

fn handback_halt(at_mseq: u16, mine: [u8; 8], theirs: Option<[u8; 8]>) -> Halt {
    Halt {
        at_mseq,
        reason: halt_reason::HANDBACK,
        mine,
        theirs: theirs.unwrap_or([0; 8]),
    }
}

fn step(chain: &mut Option<Chain>, game: &Game, r: &Record, applied: Applied) -> Option<[u8; 8]> {
    if applied == Applied::Started {
        *chain = Some(Chain::genesis(game));
        None
    } else if let Some(c) = chain.as_mut() {
        c.step(r, game);
        Some(c.head())
    } else {
        None
    }
}
