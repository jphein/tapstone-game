//! The arbiter: stamps, applies and records taps, and keeps the hash chain from `Started` on.
use tapstone_rules::{Applied, Chain, Game, Record, Refusal};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Committed {
    pub record: Record,
    /// Chain head after this record; `None` for lobby records (genesis is taken at `Started`).
    pub hash: Option<[u8; 8]>,
    pub applied: Applied,
}

#[derive(Clone, Debug)]
pub struct Arbiter {
    pub game: Game,
    pub chain: Option<Chain>,
    pub records: Vec<Committed>,
    pub refusals: u32,
    clock_ms: u32,
}

impl Arbiter {
    pub fn new(game: Game) -> Arbiter {
        Arbiter {
            game,
            chain: None,
            records: Vec::new(),
            refusals: 0,
            clock_ms: 0,
        }
    }

    /// Stamp seq/time/uid/auth, apply, and record. Refused taps are counted and dropped.
    pub fn commit(&mut self, mut tap: Record) -> Result<Applied, Refusal> {
        tap.seq = self.game.seq;
        tap.time_ms = self.clock_ms;
        self.clock_ms = self.clock_ms.wrapping_add(250);
        let [lo, hi] = tap.card.to_le_bytes();
        tap.uid = [0x04, tap.seat, lo, hi, 0, 0, 0];
        tap.auth = 0;
        match self.game.apply(&tap) {
            Ok(applied) => {
                let hash = if applied == Applied::Started {
                    self.chain = Some(Chain::genesis(&self.game));
                    None
                } else if let Some(chain) = self.chain.as_mut() {
                    chain.step(&tap, &self.game);
                    Some(chain.head())
                } else {
                    None
                };
                self.records.push(Committed {
                    record: tap,
                    hash,
                    applied,
                });
                Ok(applied)
            }
            Err(e) => {
                self.refusals += 1;
                Err(e)
            }
        }
    }
}
