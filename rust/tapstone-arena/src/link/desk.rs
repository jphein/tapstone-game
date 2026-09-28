//! Desk mode (spec §9): the whole stack with two scripted shrines and no radio.
//!
//! The shrine here is the one the tests run: `tests/harness.rs` re-exports `DeskShrine` as its
//! `Shrine`, and keeps only the harness-only machinery (loss injection, dark mode, the god's-eye
//! claim-order wait). A desk mode whose shrines differed from the tested ones would demo something
//! the tests never checked (verification.md, "one object").
use std::collections::VecDeque;
use std::ops::{Deref, DerefMut};

use tapstone_progression::Loadout;
use tapstone_proto::frame::{
    BROADCAST, Doll, Equip, Frame, GRID_MAX, Header, NONE8, NONE16, arena_refusal,
};
use tapstone_proto::shrine::{self, Chooser, Shrine};
use tapstone_rules::{Game, Record};
use tapstone_sim::deck::Deck;
use tapstone_sim::human::{Choice, legal_choices};
use tapstone_sim::{CASTLES, ScriptedSeat, build_deck};

use super::{Link, Rx};
use crate::core::{ArenaCore, CoreConfig, Input, Output, StatsSource, Unsigned};
use crate::decks::DeckBook;
use crate::registry::Registry;

/// The arena's node id on the desk mesh (defined beside the shrine, `tapstone_proto::shrine`).
pub use tapstone_proto::shrine::ARENA_NODE;
/// The desk shrines' node ids, seat order.
pub const DESK_NODES: [u8; 2] = [163, 164];

/// Commander stats for desk play: every figurine is its fixed (level, loadout), indexed by the
/// figurine uid's last byte (the shrine index).
pub struct FixedStats(pub [(u8, Loadout); 2]);

impl StatsSource for FixedStats {
    fn commander(&mut self, figurine: [u8; 7], _castle: u16) -> Result<(u8, Loadout), u8> {
        Ok(self.0[figurine[6] as usize & 1])
    }
    fn doll(&mut self, _: [u8; 7], seat: u8) -> Option<Doll> {
        Some(Doll {
            seat,
            level: 1,
            xp: 0,
            xp_next: 5,
            slots: 2,
            loadout: [NONE16; 3],
            inv_len: 0,
            inv: [0; GRID_MAX],
            keyword: NONE8,
            name_seed: 0,
        })
    }
    fn equip(&mut self, _: [u8; 7], _: &Equip, _: &Registry) -> Result<Doll, u8> {
        Err(arena_refusal::BAD_LOADOUT)
    }
}

/// Shrine `shrine`'s synthetic tag UID for copy `k` of its deck list (`tapstone_proto::shrine`).
pub use tapstone_proto::shrine::{copy_uid, same_tap};

/// Seed `seed`'s shuffle for both decks (the shared digital shuffle; spec §17 question 0), and the
/// deck book the arena resolves their sigils against.
pub fn desk_decks(seed: u64) -> ([Vec<u16>; 2], DeckBook) {
    let decks = [build_deck(seed, 0), build_deck(seed, 1)];
    let book = DeckBook::new(
        (0..2)
            .map(|i| Deck {
                name: format!("d{i}"),
                owner: "t".into(),
                castle: CASTLES[i],
                cards: decks[i].clone(),
                sigil: String::new(),
            })
            .collect(),
    );
    (decks, book)
}

/// One MATCH frame as bytes.
pub fn encode(src: u8, match_id: u32, f: &Frame) -> Vec<u8> {
    shrine::encode(src, match_id, f).to_vec()
}

/// `tapstone-sim`'s `ScriptedSeat` as the shrine's [`Chooser`]: seated anew by every `B`.
pub struct Scripted {
    pub seed: u64,
    pub ai: ScriptedSeat,
}

impl Chooser for Scripted {
    fn seated(&mut self, seat: u8) {
        self.ai = ScriptedSeat::new(self.seed, seat);
    }
    fn next_tap(&mut self, g: &Game, _seat: u8) -> Record {
        self.ai.next_tap(g)
    }
}

/// A shrine without the radio: the shrine firmware's own seat (`tapstone_proto::shrine::Shrine`)
/// with a `ScriptedSeat` choosing its taps. One object: the desk, the arena's tests and the
/// firmware run the same state machine; this wrapper only adds `Vec`s and the sim's menu.
/// Every field and the no-`Vec` methods are the inner [`Shrine`]'s, reached through `Deref`.
pub struct DeskShrine {
    pub inner: Shrine<Scripted>,
    /// Every play-tap lseq this shrine has proposed, in order (a test instrument; the `no_std`
    /// core keeps only the count, `proposals`).
    pub proposed: Vec<u16>,
}

impl Deref for DeskShrine {
    type Target = Shrine<Scripted>;
    fn deref(&self) -> &Shrine<Scripted> {
        &self.inner
    }
}

impl DerefMut for DeskShrine {
    fn deref_mut(&mut self) -> &mut Shrine<Scripted> {
        &mut self.inner
    }
}

// The shrine's rejoin wait is one arena head period; the two live in different crates, so the
// build holds them equal (play.rs is the arena's, the shrine's copy is for `no_std` firmware).
const _: () = assert!(shrine::HEAD_MS == crate::core::play::HEAD_MS);

impl DeskShrine {
    /// Shrine `i`, holding its own `deck` only.
    pub fn new(seed: u64, i: usize, deck: &[u16]) -> DeskShrine {
        DeskShrine::with(seed, i, DESK_NODES[i], CASTLES[i], deck)
    }

    /// A desk-style shrine on any node. `index` names its figurine (`figurine()`) and its copies'
    /// UIDs (`copy_uid(index, k)`); the remote seat (0038) is index 2 on node 165.
    pub fn with(seed: u64, index: usize, node: u8, castle: u16, deck: &[u16]) -> DeskShrine {
        let chooser = Scripted {
            seed,
            ai: ScriptedSeat::new(seed, index as u8),
        };
        DeskShrine {
            inner: Shrine::new(seed, index, node, castle, deck, chooser),
            proposed: Vec::new(),
        }
    }

    /// `Shrine::act`, as `Vec`s.
    pub fn act(&mut self, now: u64, may_claim: bool, manual: bool) -> Vec<(u8, Vec<u8>)> {
        let before = self.inner.proposals;
        let mut out = Vec::new();
        self.inner.act_to(now, may_claim, manual, &mut |d, b| {
            out.push((d, b.to_vec()))
        });
        self.note_proposal(before);
        out
    }

    /// `Shrine::propose`, as `Vec`s: empty when nothing was sent.
    pub fn propose(&mut self, now: u64, tap: Record) -> Vec<(u8, Vec<u8>)> {
        let before = self.inner.proposals;
        let mut out = Vec::new();
        self.inner
            .propose_to(now, tap, &mut |d, b| out.push((d, b.to_vec())));
        self.note_proposal(before);
        out
    }

    /// `Shrine::rx`, as `Vec`s.
    pub fn rx(&mut self, h: &Header, f: &Frame) -> Vec<(u8, Vec<u8>)> {
        let mut out = Vec::new();
        self.inner
            .rx_to(h, f, &mut |d, b| out.push((d, b.to_vec())));
        out
    }

    fn note_proposal(&mut self, before: u32) {
        if self.inner.proposals != before {
            self.proposed.push(self.inner.lseq);
        }
    }

    /// This shrine's legal moves now (tapstone-sim's menu: every choice trial-applied to the
    /// engine), or none when it is not its seat's move or a tap is still pending.
    pub fn choices(&self) -> Vec<Choice> {
        match self.seat() {
            Some(seat) if self.my_move() => legal_choices(&self.follower.game, seat as u8),
            _ => Vec::new(),
        }
    }
}

/// Two desk shrines as a `Link`: frames the arena sends are delivered to the shrines at once, and
/// their replies wait in a queue for the next `poll`.
/// The frames a desk-style shrine sent that reach the arena, as the arena receives them.
/// Shrine-to-shrine traffic (a beacon addressed to another shrine) means nothing here.
pub(crate) fn arena_bound(src: u8, frames: Vec<(u8, Vec<u8>)>) -> impl Iterator<Item = Rx> {
    frames
        .into_iter()
        .filter(|(dst, _)| *dst == ARENA_NODE || *dst == BROADCAST)
        .map(move |(_, bytes)| Rx {
            src,
            rssi: -40,
            mac_ok: true,
            bytes,
        })
}

pub struct DeskLink {
    pub shrines: [DeskShrine; 2],
    /// A manual shrine makes no play taps of its own (it still claims its seat and answers the
    /// arena): its person's taps arrive through `DeskTable::propose`.
    pub manual: [bool; 2],
    /// An off shrine is unplugged: it neither acts nor hears. The remote seat's desk table
    /// (0038) runs the bot on shrine 0 and turns shrine 1 off.
    pub off: [bool; 2],
    out: VecDeque<Rx>,
}

impl DeskLink {
    /// Seed `seed`'s table: the link, the deck book and the stats for `ArenaCore::new`.
    pub fn new(seed: u64) -> (DeskLink, DeckBook, FixedStats) {
        let (decks, book) = desk_decks(seed);
        let link = DeskLink {
            shrines: [
                DeskShrine::new(seed, 0, &decks[0]),
                DeskShrine::new(seed, 1, &decks[1]),
            ],
            manual: [false; 2],
            off: [false; 2],
            out: VecDeque::new(),
        };
        (link, book, FixedStats([(1, [None; 3]); 2]))
    }

    fn queue(&mut self, src: u8, frames: Vec<(u8, Vec<u8>)>) {
        self.out.extend(arena_bound(src, frames));
    }
}

impl Link for DeskLink {
    fn send(&mut self, dst: u8, frame: &[u8]) {
        let Some((h, f)) = Frame::decode(frame) else {
            return;
        };
        for i in 0..2 {
            if self.off[i] {
                continue;
            }
            let node = self.shrines[i].node;
            if dst == BROADCAST || dst == node {
                let replies = self.shrines[i].rx(&h, &f);
                self.queue(node, replies);
            }
        }
    }

    fn poll(&mut self, now: u64) -> Vec<Rx> {
        for i in 0..2 {
            if self.off[i] {
                continue;
            }
            // The desk mesh is lossless and in order: shrine 0's claim reaches the arena before
            // shrine 1's once shrine 0 has sent it, so seat order matches the lobby game.
            let may_claim = i == 0 || self.shrines[0].lseq >= 1;
            let frames = self.shrines[i].act(now, may_claim, self.manual[i]);
            let node = self.shrines[i].node;
            self.queue(node, frames);
        }
        self.out.drain(..).collect()
    }
}

/// One desk table on a caller's clock: the arena core and two desk shrines, stepped 10 ms at a
/// time. `record_desk_match` is this with nobody at the table; tapstone-web is this with a person
/// in one seat (`link.manual`).
pub struct DeskTable {
    pub link: DeskLink,
    pub core: ArenaCore,
    over: bool,
}

impl DeskTable {
    pub fn new(seed: u64) -> DeskTable {
        let (link, book, stats) = DeskLink::new(seed);
        let cfg = CoreConfig {
            node: ARENA_NODE,
            rules: Default::default(),
            ruleset: 1,
            registry_id: 0,
            flat: false,
            epoch_unix: 1_789_980_000,
        };
        let core = ArenaCore::new(
            cfg,
            Box::new(stats),
            book,
            Registry::Trusting,
            Box::new(Unsigned),
        );
        DeskTable {
            link,
            core,
            over: false,
        }
    }

    /// One step at `now` ms: every frame the shrines sent since the last step, then a tick.
    /// Returns every view the board is sent, one JSON line each.
    pub fn step(&mut self, now: u64) -> Vec<String> {
        let mut views = Vec::new();
        let mut inputs: Vec<Input> = self
            .link
            .poll(now)
            .into_iter()
            .map(|r| Input::Frame {
                src: r.src,
                rssi: r.rssi,
                mac_ok: r.mac_ok,
                bytes: r.bytes,
            })
            .collect();
        inputs.push(Input::Tick);
        for input in inputs {
            for o in self.core.handle(input, now) {
                match o {
                    Output::Send { dst, frame } => self.link.send(dst, &frame),
                    Output::View(v) => views.push(serde_json::to_string(&v).unwrap_or_default()),
                    Output::MatchOver(_) => self.over = true,
                    _ => {}
                }
            }
        }
        views
    }

    /// The match is over and its RESULT linger has closed (the binary's `--once` rule).
    pub fn done(&self) -> bool {
        self.over && !self.core.lingering()
    }

    /// Shrine `i`'s legal moves now (`DeskShrine::choices`).
    pub fn choices(&self, i: usize) -> Vec<Choice> {
        self.link.shrines[i].choices()
    }

    /// Send `tap` from shrine `i`, as its person chose it. False when the shrine did not send it.
    pub fn propose(&mut self, i: usize, now: u64, tap: Record) -> bool {
        let frames = self.link.shrines[i].propose(now, tap);
        let sent = !frames.is_empty();
        let node = self.link.shrines[i].node;
        self.link.queue(node, frames);
        sent
    }
}

/// A whole desk match on a simulated clock (10 ms steps) with a fixed epoch: every view the board is
/// sent, one JSON line each, until the match is over and its RESULT linger has closed (the binary's
/// `--once` rule). Deterministic, unlike `--record` on the real clock, so its output can be a
/// committed fixture that a test keeps current (tests/fixture.rs).
pub fn record_desk_match(seed: u64) -> Vec<String> {
    let mut table = DeskTable::new(seed);
    let mut views = Vec::new();
    for step in 0..20_000u64 {
        views.extend(table.step(step * 10));
        if table.done() {
            break;
        }
    }
    views
}
