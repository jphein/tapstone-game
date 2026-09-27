//! The RESULT linger (protocol state-machine.md, RESULT: "both R seen (or 5 s) → LOBBY"; ruled
//! "linger A" 2026-09-23). After a result the arena keeps the finished match for up to 5 s, or
//! until both seats have acked the final commit. Meanwhile it keeps retransmitting what a seat has
//! not acked, answers NAKs, and re-broadcasts the head commit and R every second. Without this, a
//! lost lethal commit was never re-sent: at 10% loss, 30% of duels ended with both followers
//! short of the result. Taps are swallowed (the match is over); the lobby runs as usual beside it.
use tapstone_proto::frame::{BROADCAST, Commit, Frame, MatchResult, Nak, Tap};

use super::play::{HEAD_MS, RETRANSMIT_MS};
use super::{ArenaCore, Committed, Match, Output, Table};

pub const LINGER_MS: u64 = 5_000;

pub(crate) struct Linger {
    m: Box<Match>,
    result: MatchResult,
    /// Set on the first tick after the result (`finish` has no clock).
    until: Option<u64>,
    last_tx: [u64; 2],
    last_r: u64,
}

impl Linger {
    pub(crate) fn new(m: Box<Match>, result: MatchResult) -> Linger {
        Linger {
            m,
            result,
            until: None,
            last_tx: [0; 2],
            last_r: 0,
        }
    }

    fn head(&self) -> u16 {
        self.m.log.len().saturating_sub(1) as u16
    }

    fn behind(&self, seat: usize) -> bool {
        self.m.acked[seat].is_none_or(|a| a < self.head())
    }
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
    /// Whether a finished match is still being delivered (tests and diagnostics).
    pub fn lingering(&self) -> bool {
        self.linger.is_some()
    }

    pub(crate) fn linger_tick(&mut self, now: u64, out: &mut Vec<Output>) {
        if matches!(self.table, Table::Match(_)) {
            self.linger = None; // a new match started: the old one is history
            return;
        }
        let Some(l) = self.linger.as_mut() else {
            return;
        };
        let until = *l.until.get_or_insert(now + LINGER_MS);
        if now >= until || !(l.behind(0) || l.behind(1)) {
            let id = l.m.id;
            self.linger = None;
            out.push(Output::Log(format!("result linger for {id:08x} closed")));
            return;
        }
        let id = l.m.id;
        let mut sends: Vec<Frame> = Vec::new();
        for seat in 0..2 {
            if l.behind(seat) && now.saturating_sub(l.last_tx[seat]) >= RETRANSMIT_MS {
                let next = l.m.acked[seat].map_or(0, |a| a as usize + 1);
                if let Some(c) = l.m.log.get(next) {
                    sends.push(Frame::Commit(commit_of(c)));
                }
                l.last_tx[seat] = now;
            }
        }
        if now.saturating_sub(l.last_r) >= HEAD_MS {
            if let Some(c) = l.m.log.last() {
                sends.push(Frame::Commit(commit_of(c)));
            }
            sends.push(Frame::Result(l.result));
            l.last_r = now;
        }
        for f in sends {
            self.send(out, BROADCAST, id, &f);
        }
    }

    /// A frame from one of the finished match's seats: ACKs and NAKs are the linger's; taps are
    /// swallowed. Returns false for anything the lobby should see (beacons, claims).
    pub(crate) fn linger_frame(&mut self, src: u8, f: &Frame, out: &mut Vec<Output>) -> bool {
        let Some(l) = self.linger.as_mut() else {
            return false;
        };
        let Some(seat) = l.m.nodes.iter().position(|&n| n == src) else {
            return false;
        };
        let id = l.m.id;
        match f {
            Frame::Ack(a) => {
                let want =
                    l.m.log
                        .get(a.mseq as usize)
                        .map(|c| c.hash.unwrap_or([0; 8]));
                if want == Some(a.hash) {
                    let acked = &mut l.m.acked[seat];
                    *acked = Some(acked.map_or(a.mseq, |x| x.max(a.mseq)));
                    if !(l.behind(0) || l.behind(1)) {
                        self.linger = None; // both seats hold the result: nothing left to deliver
                        out.push(Output::Log(format!("result linger for {id:08x} closed")));
                    }
                } else {
                    // The match is over and posted; a split now can only be logged.
                    out.push(Output::Log(format!(
                        "late ack mismatch from seat {seat} at {}",
                        a.mseq
                    )));
                }
                true
            }
            Frame::Nak(Nak { from, to }) => {
                let end = (*to as usize).min(l.m.log.len().saturating_sub(1));
                let commits: Vec<Commit> =
                    l.m.log
                        .get(*from as usize..=end)
                        .unwrap_or(&[])
                        .iter()
                        .map(commit_of)
                        .collect();
                for c in commits {
                    self.send(out, BROADCAST, id, &Frame::Commit(c));
                }
                true
            }
            Frame::Tap(Tap::Propose { record, .. }) => {
                record.kind != tapstone_rules::Kind::ClaimSeat // a late play tap: swallowed
            }
            _ => false,
        }
    }
}
