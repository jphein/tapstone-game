//! The serial trace (`TAPSTONE_SERIAL_TRACE`): every line `SerialLink` writes to or reads from its
//! gateway, stamped with the host's wall clock in µs as `<t_us> > <line>` (written) or
//! `<t_us> < <line>` (read). Two traces from one host share that clock, so joining a sender's `TX`
//! lines with a receiver's `RX` lines by frame bytes gives each frame's host-to-host latency and
//! the frames the air lost. Sans-IO: `SerialLink` writes the lines, this reads them.
use std::collections::HashSet;

use super::lines::{GwLine, PREFIX, parse};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dir {
    /// Written to the gateway.
    Out,
    /// Read from the gateway.
    In,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub t_us: u64,
    pub dir: Dir,
    pub line: String,
}

/// One trace line as `SerialLink` writes it (the line keeps its own newline, or gets one).
pub fn trace_line(t_us: u64, dir: Dir, line: &str) -> String {
    let d = match dir {
        Dir::Out => '>',
        Dir::In => '<',
    };
    format!("{t_us} {d} {}\n", line.trim_end_matches(['\r', '\n']))
}

pub fn parse_trace(text: &str) -> Result<Vec<Entry>, String> {
    text.lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
        .map(|(i, l)| {
            let bad = || format!("trace line {}: {l:?}", i + 1);
            let (t, rest) = l.split_once(' ').ok_or_else(bad)?;
            let (d, line) = rest.split_once(' ').unwrap_or((rest, ""));
            let dir = match d {
                ">" => Dir::Out,
                "<" => Dir::In,
                _ => return Err(bad()),
            };
            Ok(Entry {
                t_us: t.parse().map_err(|_| bad())?,
                dir,
                line: line.to_string(),
            })
        })
        .collect()
}

/// One direction of the air, from the sender's trace and the receiver's.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Leg {
    /// `TX` lines the sender wrote.
    pub tx: u32,
    /// `TXOK`s the sender's gateway answered (the driver took it; not delivery).
    pub txok: u32,
    /// `TXERR`s, as (tx id, reason).
    pub txerr: Vec<(u32, String)>,
    /// `TX` frames that came out of the receiver as an `RX` line.
    pub delivered: u32,
    /// `TX` frames that never did, while the receiver was listening: `lost_txerr` of them failed at
    /// the driver, `lost_unanswered` got no answer at all, and the rest (`air_lost`) left and never
    /// arrived.
    pub lost: u32,
    pub lost_txerr: u32,
    pub lost_unanswered: u32,
    /// `TX` lines with neither a `TXOK` nor a `TXERR` (delivered or not): the gateway never said.
    pub unanswered: u32,
    /// Undelivered `TX` frames written after the receiver's trace ends: nobody was listening (a
    /// process that exits first, as the arena does after `--once`). Not counted as lost.
    pub after_close: u32,
    /// Receiver `RX` lines no sender `TX` accounts for (another node, or a duplicate).
    pub foreign_rx: u32,
    /// Host write of `TX` to host read of `RX`, µs, per delivered frame in `TX` order.
    pub latency_us: Vec<u64>,
    /// Lines without the `@TS1` prefix on the sender's side (smol's ordinary logs).
    pub logs: u32,
    /// Receiver `RX` lines whose sender id (the gateway's roster, the link layer) differs from the
    /// `src` byte in the frame's own header: the arena keys seats by the first.
    pub src_mismatch: u32,
}

impl Leg {
    /// Frames that left their gateway (not a `TXERR`, not unanswered) and never arrived.
    pub fn air_lost(&self) -> u32 {
        self.lost - self.lost_txerr - self.lost_unanswered
    }

    /// The `q` quantile (0..=1) of the latencies, nearest rank; `None` without any.
    pub fn quantile(&self, q: f64) -> Option<u64> {
        let mut v = self.latency_us.clone();
        v.sort_unstable();
        let n = v.len();
        (n > 0).then(|| v[((q * n as f64).ceil() as usize).clamp(1, n) - 1])
    }
}

/// `@TS1 TX <id> <dst> <hex>` → (id, lowercase hex).
fn tx_of(line: &str) -> Option<(Option<u32>, String)> {
    let mut w = line.strip_prefix(PREFIX)?.split(' ');
    (w.next()? == "TX").then_some(())?;
    let id = w.next()?.parse().ok();
    let _dst = w.next()?;
    Some((id, w.next()?.to_ascii_lowercase()))
}

fn hex_of(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// One `TX` line of the sender's, as `join` accounts for it.
struct Tx {
    t_us: u64,
    id: Option<u32>,
    hex: String,
    /// An `RX` took it, or it can never be taken (a `TXERR`'d frame never left).
    taken: bool,
    delivered: bool,
}

/// Join `sender`'s `TX` lines with `receiver`'s `RX` lines by frame bytes. Each `RX`, in time order,
/// takes the earliest untaken `TX` of the same bytes written no later than it and at most
/// `window_us` before it (a desk shrine repeats identical frames, so bytes alone are ambiguous).
/// A `TXERR`'d frame never left, so no `RX` can take it; its bytes repeat in the retransmit, which
/// can.
pub fn join(sender: &[Entry], receiver: &[Entry], window_us: u64) -> Leg {
    let mut leg = Leg::default();
    let mut txs: Vec<Tx> = Vec::new();
    let (mut oks, mut errs) = (HashSet::new(), HashSet::new());
    for e in sender {
        match e.dir {
            Dir::Out => {
                if let Some((id, hex)) = tx_of(&e.line) {
                    leg.tx += 1;
                    txs.push(Tx {
                        t_us: e.t_us,
                        id,
                        hex,
                        taken: false,
                        delivered: false,
                    });
                }
            }
            Dir::In => match parse(&e.line) {
                GwLine::TxOk(id) => {
                    leg.txok += 1;
                    oks.insert(id);
                }
                GwLine::TxErr(id, why) => {
                    if let Some(tx) = txs.iter_mut().rev().find(|t| t.id == Some(id)) {
                        tx.taken = true;
                    }
                    errs.insert(id);
                    leg.txerr.push((id, why));
                }
                GwLine::Log(_) => leg.logs += 1,
                _ => {}
            },
        }
    }
    let closed_at = receiver.iter().map(|e| e.t_us).max().unwrap_or(0);
    let mut rxs: Vec<(u64, String)> = receiver
        .iter()
        .filter(|e| e.dir == Dir::In)
        .filter_map(|e| match parse(&e.line) {
            GwLine::Rx { src, bytes, .. } => {
                // The header's src is byte 19 (tag 13 · ver · kind · match 4 · src).
                if bytes.get(19).is_some_and(|&h| h != src) {
                    leg.src_mismatch += 1;
                }
                Some((e.t_us, hex_of(&bytes)))
            }
            _ => None,
        })
        .collect();
    rxs.sort_by_key(|r| r.0);
    let mut lat: Vec<(u64, u64)> = Vec::new(); // (t_tx, latency)
    for (t_rx, h) in rxs {
        let hit = txs
            .iter_mut()
            .find(|t| !t.taken && t.hex == h && t.t_us <= t_rx && t_rx - t.t_us <= window_us);
        match hit {
            Some(tx) => {
                tx.taken = true;
                tx.delivered = true;
                leg.delivered += 1;
                lat.push((tx.t_us, t_rx - tx.t_us));
            }
            None => leg.foreign_rx += 1,
        }
    }
    lat.sort_by_key(|l| l.0);
    leg.latency_us = lat.into_iter().map(|l| l.1).collect();
    for tx in &txs {
        let failed = tx.id.is_some_and(|i| errs.contains(&i));
        let answered = failed || tx.id.is_some_and(|i| oks.contains(&i));
        if !answered {
            leg.unanswered += 1;
        }
        if tx.delivered {
            continue;
        }
        if tx.t_us > closed_at {
            leg.after_close += 1;
            continue;
        }
        leg.lost += 1;
        if failed {
            leg.lost_txerr += 1;
        } else if !answered {
            leg.lost_unanswered += 1;
        }
    }
    leg
}
