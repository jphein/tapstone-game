//! The sans-IO arbiter (arena spec D1): `handle(Input, now_ms) -> Vec<Output>`. No sockets, no
//! clock, no database. Adapters run the outputs **in order**: a `Journal` output always precedes the
//! `Send` of the same commit, and the adapter must persist it before sending (spec D10).
mod dark;
mod linger;
pub(crate) mod lobby;
pub(crate) mod play;

use tapstone_progression::Loadout;
use tapstone_proto::frame::{Begin, Doll, Equip, FRAME_MAX, Frame, Header, MatchResult};
use tapstone_rules::{Applied, Chain, Game, HouseRules, Record};

use crate::decks::DeckBook;
use crate::registry::Registry;

pub use dark::{HANDBACK_NAK_MS, HANDOVER_BOUND_MS, RecoveredMatch};
pub use lobby::Claim;
pub use play::HEAD_MS;

pub struct CoreConfig {
    /// The arena's own node id (the gateway's, as seen on the mesh).
    pub node: u8,
    pub rules: HouseRules,
    /// First 4 B of the running build's hash, the `ruleset` in `L`.
    pub ruleset: u32,
    pub registry_id: u32,
    /// 0030 `progression = flat`.
    pub flat: bool,
    /// Unix seconds at `now_ms == 0`, for `match` ids and the transcript's `start_ts`.
    pub epoch_unix: u32,
}

#[derive(Debug, Clone)]
pub enum Input {
    Frame {
        src: u8,
        rssi: i8,
        mac_ok: bool,
        bytes: Vec<u8>,
    },
    Tick,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Output {
    Send { dst: u8, frame: Vec<u8> },
    Journal(JournalOp),
    View(crate::view::ViewModel),
    MatchOver(Box<MatchOver>),
    Log(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum JournalOp {
    Begin {
        match_id: u32,
        rules: [u8; 9],
        nodes: [u8; 2],
        figurines: [[u8; 7]; 2],
        decks: [Vec<u16>; 2],
        start_unix: u32,
    },
    Record {
        match_id: u32,
        record: [u8; 24],
        hash: Option<[u8; 8]>,
    },
    End {
        match_id: u32,
        result: MatchResult,
    },
}

/// Everything the ledger and the poster need once a match ends.
#[derive(Debug, Clone, PartialEq)]
pub struct MatchOver {
    pub match_id: u32,
    pub result: MatchResult,
    /// Seat 0 / 1's mesh nodes, so the binary can send each station its post-match `D`.
    pub nodes: [u8; 2],
    pub figurines: [[u8; 7]; 2],
    /// Seat 0 / 1 winner, `None` for a desync.
    pub winner: Option<u8>,
    /// The round the match ended in (0030's "abandoned before round 3" rule).
    pub round: u8,
    pub tsx1: Vec<u8>,
    pub json: tapstone_sim::Transcript,
}

/// The ledger, as the core sees it: read a commander at claim time, serve and change loadouts.
/// Implemented by `ledger::Ledger` in production and by `FixedStats` in tests.
pub trait StatsSource {
    /// `(level, loadout, castle faction ok)` for this figurine, creating the commander on first
    /// sight. `Err` carries an `arena_refusal` code.
    fn commander(&mut self, figurine: [u8; 7], castle: u16) -> Result<(u8, Loadout), u8>;
    fn doll(&mut self, figurine: [u8; 7], seat: u8) -> Option<Doll>;
    fn equip(&mut self, figurine: [u8; 7], e: &Equip, registry: &Registry) -> Result<Doll, u8>;
}

pub trait Signer {
    /// `(sig_kind, sig)` over `transcript_sha ‖ match ‖ winner ‖ reason` (protocol §7).
    fn sign(&self, r: &MatchResult, match_id: u32) -> (u8, [u8; 64]);
}

pub struct Unsigned;
impl Signer for Unsigned {
    fn sign(&self, _: &MatchResult, _: u32) -> (u8, [u8; 64]) {
        (0, [0; 64])
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Committed {
    pub record: Record,
    pub hash: Option<[u8; 8]>,
    pub applied: Applied,
    pub lseq: u16,
}

pub(crate) struct Match {
    pub id: u32,
    pub game: Game,
    pub chain: Option<Chain>,
    pub log: Vec<Committed>,
    pub nodes: [u8; 2],
    pub figurines: [[u8; 7]; 2],
    pub decks: [Vec<u16>; 2],
    /// The `B` frame the shrines build their game from (#67), kept to re-send.
    pub begin: Begin,
    pub sigils: [u32; 2],
    pub started_ms: u64,
    pub start_unix: u32,
    pub acked: [Option<u16>; 2],
    pub last_heard: [u64; 2],
    pub last_tx: [u64; 2],
    pub tries: [u8; 2],
    pub last_lseq: [Option<u16>; 2],
    pub last_broadcast: u64,
    pub paused: bool,
    /// Set while a revived arena is taking the hand-back (spec §7).
    pub dark: Option<dark::Dark>,
    /// A revived arena's handover time: first hand-back verified → resumed (#98 b/c).
    pub handover_ms: Option<u64>,
    /// 0036: UIDs drawn since they were last shuffled in, per seat, and the ones still in hand.
    pub drawn: [std::collections::HashSet<[u8; 7]>; 2],
    pub in_hand: [std::collections::HashSet<[u8; 7]>; 2],
}

/// The one implementation of "a copy is drawn once per shuffle-in" (0036 as corrected in #60),
/// replayed by every path that adds a record to the log: `commit`, `recover` and the hand-back.
/// A draw marks the UID drawn and in hand; a cast or charge takes it out of the hand, and it stays
/// drawn (played this match); a mulligan shuffles the hand back in, so those UIDs may be drawn again.
pub(crate) fn track_uids(m: &mut Match, r: &tapstone_rules::Record) {
    use tapstone_rules::Kind;
    let s = r.seat as usize & 1;
    match r.kind {
        Kind::Draw => {
            m.drawn[s].insert(r.uid);
            m.in_hand[s].insert(r.uid);
        }
        Kind::Charge | Kind::CastUnit | Kind::CastSpell => {
            m.in_hand[s].remove(&r.uid);
        }
        Kind::Mulligan => {
            let back: Vec<_> = m.in_hand[s].drain().collect();
            for uid in back {
                m.drawn[s].remove(&uid);
            }
        }
        _ => {}
    }
}

pub(crate) enum Table {
    Lobby(lobby::Lobby),
    Match(Box<Match>),
}

pub struct ArenaCore {
    pub(crate) cfg: CoreConfig,
    pub(crate) stats: Box<dyn StatsSource + Send>,
    pub(crate) decks: DeckBook,
    pub(crate) registry: Registry,
    pub(crate) signer: Box<dyn Signer + Send>,
    pub(crate) table: Table,
    pub(crate) last_beacon: Option<u64>,
    /// A finished match still being delivered (the RESULT linger).
    pub(crate) linger: Option<linger::Linger>,
    /// The last match's id, so the next one never reuses it (#76 follow-up).
    pub(crate) last_match: Option<u32>,
}

impl ArenaCore {
    pub fn new(
        cfg: CoreConfig,
        stats: Box<dyn StatsSource + Send>,
        decks: DeckBook,
        registry: Registry,
        signer: Box<dyn Signer + Send>,
    ) -> ArenaCore {
        ArenaCore {
            cfg,
            stats,
            decks,
            registry,
            signer,
            table: Table::Lobby(lobby::Lobby::default()),
            last_beacon: None,
            linger: None,
            last_match: None,
        }
    }

    pub fn handle(&mut self, input: Input, now: u64) -> Vec<Output> {
        let mut out = Vec::new();
        match input {
            Input::Tick => self.tick(now, &mut out),
            // A frame from the arena's own node cannot be a shrine's. On katana's bench a gateway's
            // roster put its own id on the peer's MAC, so a shrine's claim arrived named as the
            // arena, which seated itself and sent its `B` to itself for good (run-s14, #132). The
            // shrine retransmits; its next copy, rightly named, is the one that counts.
            Input::Frame { src, .. } if src == self.cfg.node => {}
            Input::Frame { src, bytes, .. } => {
                if let Some((h, f)) = Frame::decode(&bytes) {
                    self.frame(src, h, f, now, &mut out);
                }
            }
        }
        out
    }

    pub(crate) fn send(&self, out: &mut Vec<Output>, dst: u8, match_id: u32, f: &Frame) {
        let mut buf = [0u8; FRAME_MAX];
        let n = f.encode(
            &Header {
                match_id,
                src: self.cfg.node,
            },
            &mut buf,
        );
        out.push(Output::Send {
            dst,
            frame: buf[..n].to_vec(),
        });
    }

    fn frame(&mut self, src: u8, h: Header, f: Frame, now: u64, out: &mut Vec<Output>) {
        if matches!(self.table, Table::Lobby(_)) {
            if self.linger_frame(src, &f, out) {
                return;
            }
            self.lobby_frame(src, f, now, out);
        } else {
            self.play_frame(src, h, f, now, out);
        }
    }

    fn tick(&mut self, now: u64, out: &mut Vec<Output>) {
        self.linger_tick(now, out);
        if matches!(self.table, Table::Lobby(_)) {
            self.lobby_tick(now, out);
        } else {
            self.play_tick(now, out);
        }
    }

    /// Committed records in the running match (0 in the lobby). Test and diagnostics helper.
    pub fn log_len(&self) -> usize {
        match &self.table {
            Table::Match(m) => m.log.len(),
            Table::Lobby(_) => 0,
        }
    }

    /// A revived arena whose hand-back is not yet verified (spec §7 steps 2-5): it commits nothing
    /// until it is (#95). Test and diagnostics helper.
    pub fn resuming(&self) -> bool {
        match &self.table {
            Table::Match(m) => m.dark.as_ref().is_some_and(|d| !d.resumed),
            Table::Lobby(_) => false,
        }
    }

    /// A revived arena whose first hand-back is verified but which has not resumed: it is waiting
    /// for the interim to step down and hand back the rest (#98 b/c). Test and diagnostics helper.
    pub fn handover_open(&self) -> bool {
        match &self.table {
            Table::Match(m) => m
                .dark
                .as_ref()
                .is_some_and(|d| !d.resumed && d.stage != dark::Stage::HandBack),
            Table::Lobby(_) => false,
        }
    }

    /// How long the last handover took, from the first hand-back verified to resumed (#98 b/c).
    /// Test and diagnostics helper; `None` until a revived arena resumes.
    pub fn handover_ms(&self) -> Option<u64> {
        match &self.table {
            Table::Match(m) => m.handover_ms,
            Table::Lobby(_) => None,
        }
    }

    /// The running match's genesis hash, once its chain has started (#67's tests compare it with
    /// each follower's).
    pub fn genesis(&self) -> Option<[u8; 8]> {
        match &self.table {
            Table::Match(m) => m.chain.map(|_| m.begin.genesis),
            Table::Lobby(_) => None,
        }
    }

    /// The running match's id (`None` in the lobby).
    pub fn match_id(&self) -> Option<u32> {
        match &self.table {
            Table::Match(m) => Some(m.id),
            Table::Lobby(_) => None,
        }
    }

    /// The arena's own node id (the gateway's).
    pub fn node(&self) -> u8 {
        self.cfg.node
    }

    /// The mesh node sitting in `seat`, while a match runs. A dev-route tap is fed to the core as
    /// if that node had sent it, so the dev path and the real path are one path.
    pub fn seat_node(&self, seat: u8) -> Option<u8> {
        match &self.table {
            Table::Match(_) => self.seated().get(seat as usize).copied(),
            Table::Lobby(_) => None,
        }
    }

    /// The nodes holding a seat, in seat order: the lobby's claims so far, or the match's seat
    /// map. The harness waits on it to fix claim order under loss; the lobby view shows it.
    pub fn seated(&self) -> Vec<u8> {
        match &self.table {
            Table::Match(m) => m.nodes.to_vec(),
            Table::Lobby(l) => l.claims.iter().map(|c| c.node).collect(),
        }
    }

    /// The board, for the canvas: the current game if a match is running.
    pub fn view(&self) -> crate::view::ViewModel {
        match &self.table {
            Table::Match(m) => crate::view::ViewModel::of_match(m, None),
            Table::Lobby(l) => crate::view::ViewModel::of_lobby(l),
        }
    }
}
