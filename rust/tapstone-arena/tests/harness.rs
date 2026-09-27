//! Two simulated shrines on an in-memory mesh around one ArenaCore. Each shrine is the reference
//! follower (tapstone-proto) plus a ScriptedSeat choosing its taps, i.e. the shrine firmware's logic
//! without the radio. Loss and duplication are injected on the mesh, seeded, so a failure replays.
#![allow(dead_code)]
use std::collections::VecDeque;

use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use tapstone_arena::core::{ArenaCore, CoreConfig, Input, MatchOver, Output, Unsigned};
use tapstone_arena::decks::DeckBook;
use tapstone_arena::link::desk::{ARENA_NODE, DESK_NODES, desk_decks, encode};
/// The shrine the tests drive is desk mode's shrine: one object (Task 21).
pub use tapstone_arena::link::desk::{DeskShrine as Shrine, FixedStats};
use tapstone_arena::registry::Registry;
use tapstone_progression::Loadout;
use tapstone_proto::frame::*;
use tapstone_rules::{HouseRules, Phase, Record};
use tapstone_sim::CASTLES;
use tapstone_sim::deck::Deck;

pub const ARENA: u8 = ARENA_NODE;
/// How long the interim waits for seat 1 to catch it up before arbitrating anyway (#98).
pub const SYNC_BOUND_MS: u64 = 1_000;
pub const NODES: [u8; 2] = DESK_NODES;

pub struct Net {
    pub core: ArenaCore,
    pub shrines: [Shrine; 2],
    pub now: u64,
    pub wire: VecDeque<(u8, u8, Vec<u8>)>, // (from, to, bytes); to = 255 broadcast
    pub rng: StdRng,
    pub loss: f64,
    pub dup: f64,
    pub over: Vec<MatchOver>,
    pub journal: Vec<tapstone_arena::core::JournalOp>,
    pub arena_up: bool,
    pub dark: bool,
    pub corrupt_handback: bool,
    pub stats: [(u8, Loadout); 2],
    pub interim_lseq: [u16; 2],
    /// A manual seat makes no play taps of its own (it still claims); a test injects them.
    pub manual: [bool; 2],
    pub seed: u64,
    /// Resume above the seat's last committed lseq after a re-sync (ruled 2026-09-23). Off only to
    /// show that the arena catches a counter that went backwards; copied onto a shrine before it hears a frame.
    pub resume_from_resync: bool,
    /// Every commit the arena broadcast, by mseq (the latest copy), so a test can replay an old one.
    pub sent_commits: std::collections::BTreeMap<u16, Vec<u8>>,
    /// The shrine whose claim goes first, so is seat 0 (#67: seats come from B, not from the index).
    pub claim_first: usize,
    /// `B` frames to drop on their way to each shrine, beyond the mesh's own loss (#67).
    pub drop_begin: [u32; 2],
    /// Flip one deck byte of every `B` delivered to each shrine (#67's control).
    pub corrupt_begin: [bool; 2],
    /// `B` frames delivered to each shrine (after drops).
    pub begins_heard: [u32; 2],
    /// Drop every `R` on its way to each shrine, beyond the mesh's own loss (#101).
    pub drop_result: [bool; 2],
    /// `R` frames delivered to each shrine (after drops).
    pub results_heard: [u32; 2],
    /// While dark, the interim answers a seat's `J` and `N` (#76). Off: the deferral this replaced.
    pub interim_answers: bool,
    /// #98: before its first commit in a dark window, the interim asks seat 1 (`N`) for any record
    /// past its own head and adopts the `H` answer. Off: the interim arbitrates at once.
    pub interim_syncs: bool,
    /// The interim has caught up with seat 1 this dark window (or gave up waiting, `SYNC_BOUND_MS`).
    pub interim_synced: bool,
    /// When the interim first and last asked seat 1 to catch it up, this dark window.
    pub sync_asked: Option<(u64, u64)>,
    /// The taps that reached the interim while it waited, one per seat in arrival order (a
    /// retransmit replaces its seat's), arbitrated once it has caught up.
    pub sync_held: Vec<(u16, Record)>,
    /// Records the interim adopted from seat 1's answer (a test instrument).
    pub sync_adopted: u32,
    /// Flip one card of the `B` the interim rebuilds (#76's control on the reconstruction).
    pub corrupt_interim_begin: bool,
    /// Zero the per-seat `last_lseq` in the interim's `H` answer (#76's control on the resume).
    pub zero_interim_lseq: bool,
    /// `J`/`N` answers the interim sent (a test instrument).
    pub interim_replies: u32,
    /// Every commit's (seat, lseq), by mseq, as first sent by the arena or the interim: the
    /// harness's own record, for "no tap is committed twice under one lseq".
    pub committed: std::collections::BTreeMap<u16, (u8, u16)>,
    /// Frames shrine 0 addressed to the arena while the harness dark flag is set (`go_dark` → the
    /// first revived-arena commit a shrine hears) that were not taps (its `J` for a `B` it never
    /// received, #91): no arbiter's business, they go on the air to the arena, which hears them
    /// once it has revived. A test instrument.
    pub dark_to_arena: u32,
    /// Taps (its own or seat 1's) that reached an interim holding no game, so went unarbitrated
    /// (#91). A test instrument.
    pub gameless_taps: u32,
    /// A broadcast is lost per receiver, at delivery: one listener missing a frame does not mean
    /// every listener missed it, which is what a mesh does. On by default (Oracle on #100: the
    /// one-draw model never let a handover or a RESULT reach one shrine and not the other). Off
    /// only for a golden recorded under the old model, where one draw decided a broadcast for
    /// every receiver. A lossless mesh behaves the same either way.
    pub per_receiver_loss: bool,
    /// Arena broadcasts that reached exactly one of the two shrines. A test instrument: it can be
    /// nonzero only when broadcast loss is drawn per receiver.
    pub one_sided: u32,
    /// Seat 1's `J`/`N` that reached an interim holding no game, so went unanswered (#91). A test
    /// instrument.
    pub gameless_asks: u32,
    /// Rejects the interim sent seat 1. A test instrument: a gameless interim must send none, since
    /// it arbitrates nothing (#91).
    pub interim_rejects: u32,
    /// Frames the arena processed while resuming and still resuming after (#95): frames that
    /// complete the hand-back end the resumption, so they are not counted. A test instrument.
    pub resuming_frames: u32,
    /// Of those, taps. A test instrument.
    pub resuming_taps: u32,
    /// Ticks the arena processed while resuming and still resuming after. A test instrument.
    pub resuming_ticks: u32,
    /// Of those frames and ticks, the ones (other than a hand-back chunk) across which the arena's
    /// log changed length.
    /// The invariant is zero: a resuming arena commits nothing (#95); its log grows only by a
    /// verified hand-back (the first round, and since #98 b/c the second).
    pub resuming_log_changes: u32,
    /// The revived arena's handover time (#98 b/c), kept once seen: the core forgets it when the
    /// match ends. A test instrument.
    pub handover_ms_seen: Option<u64>,
    /// The interim ACKed the revived arena's head while the handover was open (seen on the wire).
    pub interim_acked_head: bool,
    /// Resumptions without that ACK (#98 b/c; Oracle on #100). The invariant is zero.
    pub no_ack_resumes: u32,
}

impl Net {
    /// Seed `seed`'s shuffle for both decks (the shared digital shuffle; spec §17 question 0).
    /// Shrine 0 claims first, so it is seat 0.
    pub fn new(seed: u64, loss: f64, dup: f64) -> Net {
        let (decks, book) = desk_decks(seed);
        let cfg = CoreConfig {
            node: ARENA,
            rules: HouseRules::default(),
            ruleset: 1,
            registry_id: 2,
            flat: false,
            epoch_unix: 1_789_980_000,
        };
        let core = ArenaCore::new(
            cfg,
            Box::new(FixedStats([(1, [None; 3]); 2])),
            book,
            Registry::Trusting,
            Box::new(Unsigned),
        );
        Net {
            core,
            shrines: [
                Shrine::new(seed, 0, &decks[0]),
                Shrine::new(seed, 1, &decks[1]),
            ],
            now: 0,
            wire: VecDeque::new(),
            rng: StdRng::seed_from_u64(seed ^ 0x5EED),
            loss,
            dup,
            over: vec![],
            journal: vec![],
            arena_up: true,
            dark: false,
            corrupt_handback: false,
            stats: [(1, [None; 3]); 2],
            interim_lseq: [0; 2],
            manual: [false; 2],
            seed,
            resume_from_resync: true,
            sent_commits: Default::default(),
            claim_first: 0,
            drop_begin: [0; 2],
            corrupt_begin: [false; 2],
            begins_heard: [0; 2],
            drop_result: [false; 2],
            results_heard: [0; 2],
            interim_answers: true,
            interim_syncs: true,
            interim_synced: false,
            sync_asked: None,
            sync_held: Vec::new(),
            sync_adopted: 0,
            corrupt_interim_begin: false,
            zero_interim_lseq: false,
            interim_replies: 0,
            committed: Default::default(),
            dark_to_arena: 0,
            gameless_taps: 0,
            per_receiver_loss: true,
            one_sided: 0,
            gameless_asks: 0,
            interim_rejects: 0,
            resuming_frames: 0,
            resuming_taps: 0,
            resuming_ticks: 0,
            resuming_log_changes: 0,
            handover_ms_seen: None,
            interim_acked_head: false,
            no_ack_resumes: 0,
        }
    }

    fn encode(src: u8, match_id: u32, f: &Frame) -> Vec<u8> {
        encode(src, match_id, f)
    }

    pub fn put(&mut self, from: u8, to: u8, bytes: Vec<u8>) {
        // A broadcast on a lossy mesh is lost per receiver, in `heard`. Everything else draws here
        // as it always did, so a lossless mesh replays unchanged.
        let per_receiver = to == BROADCAST && self.loss > 0.0 && self.per_receiver_loss;
        if !per_receiver && self.rng.random_bool(self.loss) {
            return;
        }
        if self.rng.random_bool(self.dup) {
            self.wire.push_back((from, to, bytes.clone()));
        }
        self.wire.push_back((from, to, bytes));
    }

    /// Whether one receiver hears a frame addressed `to`: a broadcast is lost per receiver.
    fn heard(&mut self, to: u8) -> bool {
        to != BROADCAST
            || self.loss == 0.0
            || !self.per_receiver_loss
            || !self.rng.random_bool(self.loss)
    }

    fn run_core(&mut self, input: Input) {
        if !self.arena_up {
            return;
        }
        let now = self.now;
        // #98 b/c: the interim's ACK of the arena's head while the handover is open, observed on
        // the wire (not from the core's stages), and any resumption that happens without one.
        let ack_head = self.core.handover_open()
            && matches!(&input, Input::Frame { src, bytes, .. }
                if *src == NODES[0]
                    && matches!(Frame::decode(bytes), Some((_, Frame::Ack(a)))
                        if a.mseq as usize + 1 == self.core.log_len()));
        let was_resuming = self.core.resuming();
        let open_before = self.core.handover_open();
        // #95's invariant, measured on every frame the arena processes: one that finds it resuming
        // and leaves it resuming must not change its log.
        let tap = matches!(&input, Input::Frame { bytes, .. }
            if matches!(Frame::decode(bytes), Some((_, Frame::Tap(_)))));
        let handback = matches!(&input, Input::Frame { bytes, .. }
            if matches!(Frame::decode(bytes), Some((_, Frame::Handback(_)))));
        // Ticks too (Oracle on #97): a tick-driven append would otherwise be invisible.
        let frame = matches!(input, Input::Frame { .. });
        let before = self.core.resuming().then(|| self.core.log_len());
        let outputs = self.core.handle(input, now);
        // The one frame allowed to grow the log while resuming: the hand-back chunk that completes
        // round one and opens the handover (Oracle on #100: the exemption was every `H`).
        let opens = handback && !open_before && self.core.handover_open();
        if let Some(len) = before
            && self.core.resuming()
        {
            self.resuming_frames += u32::from(frame);
            self.resuming_ticks += u32::from(!frame);
            self.resuming_taps += u32::from(tap);
            self.resuming_log_changes += u32::from(!opens && self.core.log_len() != len);
        }
        self.interim_acked_head |= ack_head;
        let ended = outputs.iter().any(|o| matches!(o, Output::MatchOver(_)));
        if was_resuming && !self.core.resuming() && !ended && !self.interim_acked_head {
            self.no_ack_resumes += 1;
        }
        if let Some(ms) = self.core.handover_ms() {
            self.handover_ms_seen = Some(ms);
        }
        for o in outputs {
            match o {
                Output::Send { dst, frame } => {
                    if let Some((_, Frame::Commit(c))) = Frame::decode(&frame) {
                        self.committed
                            .entry(c.mseq)
                            .or_insert((c.record.seat, c.lseq));
                        self.sent_commits.insert(c.mseq, frame.clone());
                    }
                    self.put(ARENA, dst, frame)
                }
                Output::Journal(j) => self.journal.push(j),
                Output::MatchOver(m) => self.over.push(*m),
                Output::View(_) | Output::Log(_) => {}
            }
        }
    }

    /// One scheduler step: every shrine beacons or taps, the core ticks, and the wire drains.
    pub fn step(&mut self) {
        self.now += 10;
        for i in 0..2 {
            self.shrine_act(i);
        }
        self.run_core(Input::Tick);
        self.drain();
    }

    /// Deliver everything on the wire (and whatever that sends), without new taps or ticks.
    pub fn drain(&mut self) {
        while let Some((from, to, bytes)) = self.wire.pop_front() {
            if (to == ARENA || (to == BROADCAST && from != ARENA)) && self.heard(to) {
                self.run_core(Input::Frame {
                    src: from,
                    rssi: -40,
                    mac_ok: true,
                    bytes: bytes.clone(),
                });
            }
            let mut got = 0;
            for i in 0..2 {
                if self.shrines[i].node != from
                    && (to == BROADCAST || to == self.shrines[i].node)
                    && self.heard(to)
                {
                    got += 1;
                    self.shrine_rx(i, &bytes);
                }
            }
            if from == ARENA && to == BROADCAST && got == 1 {
                self.one_sided += 1;
            }
        }
    }

    fn shrine_act(&mut self, i: usize) {
        // The second shrine claims only once the arena holds the first one's claim, so claim order
        // is fixed even under loss. The followers no longer need it (the seat map comes in B,
        // #67); the tests do, because dark mode makes shrine `claim_first` the interim arbiter and
        // they index shrines by seat. The harness looks at the core here, which a shrine cannot.
        let first = self.claim_first;
        let may_claim = i == first || self.core.seated().first() == Some(&self.shrines[first].node);
        let now = self.now;
        let node = self.shrines[i].node;
        for (dst, bytes) in self.shrines[i].act(now, may_claim, self.manual[i]) {
            if self.dark && dst == ARENA {
                // The arena is dark: seat 0's shrine arbitrates (its own taps in place), and seat
                // 1 proposes to it instead (0029, spec §7).
                let Some((_, f)) = Frame::decode(&bytes) else {
                    continue;
                };
                if i == 0 {
                    // Only a tap is the interim's to arbitrate. Anything else it addresses to the
                    // arena (its `J` for a `B` it never received, #91) goes on the air to the
                    // arena as ever: nobody hears it while the arena is dead, and the revived arena
                    // does, before any shrine has heard its handover.
                    match f {
                        Frame::Tap(Tap::Propose { lseq, record }) => {
                            self.interim_commit((lseq, record))
                        }
                        _ => {
                            self.dark_to_arena += 1;
                            self.put(node, dst, bytes);
                        }
                    }
                } else {
                    self.put(node, NODES[0], bytes);
                }
            } else {
                self.put(node, dst, bytes);
            }
        }
    }

    /// A shrine's reply: while the arena is dark, what seat 1 addresses to the arena goes to the
    /// interim arbiter instead, as its taps do (0029).
    fn reply(&mut self, i: usize, dst: u8, bytes: Vec<u8>) {
        let node = self.shrines[i].node;
        let dst = if self.dark && i == 1 && dst == ARENA {
            NODES[0]
        } else {
            dst
        };
        self.put(node, dst, bytes);
    }

    fn shrine_rx(&mut self, i: usize, bytes: &[u8]) {
        let mut bytes = bytes.to_vec();
        if bytes.get(14) == Some(&b'B') {
            if self.drop_begin[i] > 0 {
                self.drop_begin[i] -= 1;
                return;
            }
            // Only the first match's B: a second match (rematch tests) must be clean.
            if self.corrupt_begin[i] && self.over.is_empty() {
                // Seat 0's first design, low byte: rules 9 · nodes 2 · genesis 8 · len 1 in.
                bytes[HEADER_LEN + 9 + 2 + 8 + 1] ^= 0x01;
            }
            self.begins_heard[i] += 1;
        }
        if bytes.get(14) == Some(&b'R') {
            if self.drop_result[i] {
                return;
            }
            self.results_heard[i] += 1;
        }
        let Some((h, f)) = Frame::decode(&bytes) else {
            return;
        };
        self.shrines[i].resume_from_resync = self.resume_from_resync;
        match f {
            Frame::Commit(_) => {
                // The first commit from the revived arena is the handover.
                if self.dark && h.src == ARENA {
                    self.dark = false;
                }
                for (dst, b) in self.shrines[i].rx(&h, &f) {
                    self.reply(i, dst, b);
                }
            }
            // Seat 1's tap reaches the interim arbiter while the arena is dark.
            Frame::Tap(Tap::Propose { lseq, record }) if i == 0 && self.dark => {
                self.interim_commit((lseq, record));
            }
            // The revived arena asks for the gap: answer with every hand-back chunk.
            Frame::Join(j) if i == 0 && j.role == join_role::ARENA => {
                self.send_handback(j.have_mseq, u64::MAX, ARENA);
            }
            // It NAKs the chunks it is missing.
            Frame::HandbackNak(k) if i == 0 => {
                self.send_handback(k.from_mseq, k.bitmap, ARENA);
            }
            // #76: while the arena is dark, a seat's J (a reboot) or N (a gap) reaches the interim,
            // which answers from its own record list: `B` rebuilt from its state for a J, then `H`
            // chunks, the hand-back's shape, carrying each seat's last lseq.
            Frame::Join(j)
                if i == 0
                    && self.dark
                    && self.interim_answers
                    && j.role == join_role::SEAT
                    && self.interim_has_game() =>
            {
                // Counted before the B is built, so an answer attempted without a game shows in the
                // count (and the test's own assert), not as a panic here.
                self.interim_replies += 1;
                let Some(mut b) = self.shrines[0].follower.begin_frame() else {
                    return;
                };
                if self.corrupt_interim_begin {
                    b.decks[1][0] ^= 0x0001;
                }
                let id = self.shrines[0].begin.map_or(0, |(id, _)| id);
                let bytes = Self::encode(NODES[0], id, &Frame::Begin(b));
                self.put(NODES[0], h.src, bytes);
                self.send_handback(j.have_mseq, u64::MAX, h.src);
            }
            Frame::Nak(n)
                if i == 0
                    && self.dark
                    && self.interim_answers
                    && h.src != ARENA
                    && self.interim_has_game() =>
            {
                self.interim_replies += 1;
                self.send_handback(n.from, u64::MAX, h.src);
            }
            // #98: the interim's catch-up `N`, before its first commit: seat 1 answers with what it
            // holds from `from` (one empty chunk when nothing).
            Frame::Nak(n) if i == 1 && self.dark && h.src == NODES[0] => {
                if self.shrines[1].follower.handback(n.from, 0).is_some() {
                    self.send_handback_from(1, n.from, u64::MAX, NODES[0]);
                } else if self.shrines[1].follower.begun().is_some() {
                    // Seat 1 is behind the interim: nothing past `from`, said as one empty chunk.
                    let hb = Handback {
                        from_mseq: n.from,
                        idx: 0,
                        count: 1,
                        n: 0,
                        last_lseq: self.shrines[1].follower.last_lseq(),
                        records: [[0; 32]; HANDBACK_RECORDS],
                    };
                    let id = self.shrines[1].begin.map_or(0, |(id, _)| id);
                    let b = Self::encode(NODES[1], id, &Frame::Handback(hb));
                    self.put(NODES[1], NODES[0], b);
                }
            }
            // ...and the interim adopts the answer, then arbitrates from the common head.
            Frame::Handback(hb)
                if i == 0 && self.dark && h.src == NODES[1] && !self.interim_synced =>
            {
                let before = self.shrines[0].follower.next_mseq();
                for (dst, b) in self.shrines[0].rx(&h, &f) {
                    self.reply(0, dst, b);
                }
                let after = self.shrines[0].follower.next_mseq();
                self.sync_adopted += u32::from(after - before);
                let end =
                    hb.from_mseq as usize + hb.idx as usize * HANDBACK_RECORDS + hb.n as usize;
                if hb.idx + 1 == hb.count && after as usize >= end {
                    self.interim_synced = true;
                    for tap in std::mem::take(&mut self.sync_held) {
                        self.interim_commit(tap);
                    }
                }
            }
            // #91: a gameless would-be interim has nothing to answer a seat's J or N from.
            Frame::Join(_) | Frame::Nak(_)
                if i == 0 && self.dark && h.src != ARENA && !self.interim_has_game() =>
            {
                self.gameless_asks += 1;
            }
            Frame::Tap(Tap::Reject { .. })
            | Frame::Result(_)
            | Frame::Begin(_)
            | Frame::Handback(_) => {
                for (dst, b) in self.shrines[i].rx(&h, &f) {
                    self.reply(i, dst, b);
                }
            }
            _ => {}
        }
    }

    /// As `step`, but frames sent by `node` vanish (a shrine that lost power).
    pub fn step_dropping_from(&mut self, node: u8) {
        self.step_dropping(&[node]);
    }

    /// As `step`, but frames sent by any of `nodes` vanish, and they hear nothing.
    pub fn step_dropping(&mut self, nodes: &[u8]) {
        self.now += 10;
        for i in 0..2 {
            if !nodes.contains(&self.shrines[i].node) {
                self.shrine_act(i);
            }
        }
        self.run_core(Input::Tick);
        let wire: Vec<_> = self
            .wire
            .drain(..)
            .filter(|(from, _, _)| !nodes.contains(from))
            .collect();
        for (from, to, bytes) in wire {
            if (to == ARENA || (to == BROADCAST && from != ARENA)) && self.heard(to) {
                self.run_core(Input::Frame {
                    src: from,
                    rssi: -40,
                    mac_ok: true,
                    bytes: bytes.clone(),
                });
            }
            for i in 0..2 {
                if self.shrines[i].node != from
                    && !nodes.contains(&self.shrines[i].node)
                    && (to == BROADCAST || to == self.shrines[i].node)
                    && self.heard(to)
                {
                    self.shrine_rx(i, &bytes);
                }
            }
        }
    }

    /// Step until a result exists (no trailing drain), or `max_steps` pass.
    pub fn run_until_result(&mut self, max_steps: usize) -> bool {
        for _ in 0..max_steps {
            if !self.over.is_empty() {
                return true;
            }
            self.step();
        }
        !self.over.is_empty()
    }

    /// The arena process dies: nothing reaches it, and seat 0's shrine becomes the interim
    /// arbiter (0029: the shrine that tapped first).
    pub fn go_dark(&mut self) {
        self.arena_up = false;
        self.dark = true;
        self.interim_synced = false;
        self.sync_asked = None;
        self.sync_held.clear();
        self.wire.clear();
        for s in &mut self.shrines {
            s.pending = None;
        }
    }

    /// A new arena process, rebuilt from the journal the old one wrote.
    pub fn revive(&mut self) {
        let rec = tapstone_arena::core::RecoveredMatch::from_journal(&self.journal)
            .expect("journal holds the match");
        let decks = rec.decks.clone();
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
        let cfg = CoreConfig {
            node: ARENA,
            rules: HouseRules::default(),
            ruleset: 1,
            registry_id: 2,
            flat: false,
            epoch_unix: 1_789_980_000,
        };
        let (core, out) = ArenaCore::recover(
            cfg,
            Box::new(FixedStats(self.stats)),
            book,
            Registry::Trusting,
            Box::new(Unsigned),
            rec,
            self.now,
        );
        self.core = core;
        self.arena_up = true;
        self.interim_acked_head = false;
        for o in out {
            if let Output::Send { dst, frame } = o {
                self.put(ARENA, dst, frame);
            }
        }
    }

    /// Hand one frame to the core as if `from` sent it. Its outputs go where `run_core` sends them
    /// (the wire, the journal); the first frame addressed to `from` or broadcast is returned too.
    pub fn inject(&mut self, from: u8, f: Frame) -> Option<Frame> {
        // Stamped with the running match's id, as a shrine's frames are (the arena drops a match
        // frame from any other match).
        let bytes = Self::encode(from, self.core.match_id().unwrap_or(0), &f);
        let now = self.now;
        let mut first = None;
        for o in self.core.handle(
            Input::Frame {
                src: from,
                rssi: -40,
                mac_ok: true,
                bytes,
            },
            now,
        ) {
            match o {
                Output::Send { dst, frame } => {
                    if first.is_none() && (dst == from || dst == BROADCAST) {
                        first = Frame::decode(&frame).map(|(_, f)| f);
                    }
                    self.put(ARENA, dst, frame);
                }
                Output::Journal(j) => self.journal.push(j),
                Output::MatchOver(m) => self.over.push(*m),
                Output::View(_) | Output::Log(_) => {}
            }
        }
        first
    }

    /// Shrine `i` loses power mid-match and boots again: a fresh follower, lseq 0, nothing pending.
    /// It re-syncs by NAKing its gap, or by JOIN when `via_join`. On the NAK path it kept the
    /// match's `B` with its match id and seat (§4.5's kept state; a gap NAK needs a game to apply
    /// to). On the JOIN path it kept nothing, and learns `B` from the arena's answer (#67).
    pub fn reboot(&mut self, i: usize, via_join: bool) {
        let kept = self.shrines[i].begin;
        let mut s = Shrine::new(self.seed ^ 0xB007, i, &self.shrines[i].deck.clone());
        if let (false, Some((id, b))) = (via_join, kept) {
            s.take_begin(id, &b);
        }
        s.rejoining = true;
        s.join = via_join;
        self.shrines[i] = s;
    }

    /// Hand one frame straight to shrine `i`, as if the mesh delivered it now.
    pub fn deliver(&mut self, i: usize, bytes: &[u8]) {
        self.shrine_rx(i, bytes);
    }

    /// Committed records the arena has journaled.
    pub fn journaled(&self) -> usize {
        self.journal
            .iter()
            .filter(|j| matches!(j, tapstone_arena::core::JournalOp::Record { .. }))
            .count()
    }

    /// The journaled record at `mseq`, as the arena last wrote it (a later write at the same mseq
    /// replaces an earlier one, as `RecoveredMatch::from_journal` reads it).
    pub fn journal_record(&self, mseq: usize) -> [u8; 24] {
        self.journal
            .iter()
            .rev()
            .find_map(|j| match j {
                tapstone_arena::core::JournalOp::Record { record, .. }
                    if u16::from_le_bytes([record[0], record[1]]) as usize == mseq =>
                {
                    Some(*record)
                }
                _ => None,
            })
            .expect("journaled")
    }

    /// Step until seat `seat` owes at least one draw on its own turn (0036), or panic after 5,000
    /// steps.
    pub fn step_until_seat_owes_draws(&mut self, seat: usize) {
        for _ in 0..5_000 {
            let g = &self.shrines[seat].follower.game;
            if g.phase == Phase::Playing && g.seats[seat].owed_draws() > 0 && g.active == seat as u8
            {
                return;
            }
            self.step();
        }
        panic!("seat {seat} never owed a draw");
    }

    pub fn core_log_len(&self) -> usize {
        self.core.log_len()
    }

    /// Run until the match ends or `max_steps` pass.
    pub fn run(&mut self, max_steps: usize) -> bool {
        for _ in 0..max_steps {
            self.step();
            if !self.over.is_empty() {
                // Drain the trailing acks/commits so every follower reaches the head: at least 20
                // steps, and for as long as the arena lingers on the result (bounded at 5 s).
                let mut n = 0;
                while (n < 20 || self.core.lingering()) && n < 1_000 {
                    self.step();
                    n += 1;
                }
                return true;
            }
        }
        false
    }
}

impl Net {
    /// (seat, lseq) pairs committed under more than one mseq: a tap committed twice. Lobby claims
    /// and hand-back re-sends (lseq 0) are not taps.
    pub fn lseqs_committed_twice(&self) -> Vec<(u8, u16)> {
        let mut seen = std::collections::BTreeSet::new();
        let mut twice = Vec::new();
        for (&mseq, &pair) in &self.committed {
            if mseq >= 2 && pair.1 > 0 && !seen.insert(pair) {
                twice.push(pair);
            }
        }
        twice
    }

    /// Seat 0's shrine holds the match's `B`. Without it, it is no interim: it has no game to
    /// arbitrate or to answer from, so while the arena is dark nobody arbitrates and the match
    /// waits for the arena to revive (0028's "the arena is dark, the match waits"; #91).
    fn interim_has_game(&self) -> bool {
        self.shrines[0].begin.is_some()
    }

    fn interim_commit(&mut self, (lseq, r): (u16, Record)) {
        if !self.interim_has_game() {
            self.gameless_taps += 1;
            return;
        }
        if !self.interim_caught_up() {
            // Held, and arbitrated the moment seat 1's answer lands (the proposer's retransmit
            // would otherwise cost 100 ms); a retransmit meanwhile replaces its seat's.
            self.sync_held.retain(|(_, h)| h.seat != r.seat);
            self.sync_held.push((lseq, r));
            return;
        }
        let now = self.now as u32;
        let seat = r.seat;
        // An interim arbiter dedupes retransmits by (seat, lseq), exactly as the arena does, from
        // every lseq it has seen committed: the ones it committed AND the ones it followed before
        // the arena went dark (its follower's per-seat last). Deduping from the dark window alone
        // let a rebooted seat's restarted counter through (found on #76).
        let seen = self.shrines[0].follower.last_lseq()[(seat & 1) as usize];
        if self.interim_lseq[seat as usize].max(seen) >= lseq {
            return;
        }
        match self.shrines[0].follower.arbitrate(r, lseq, now) {
            Ok(c) => {
                self.interim_lseq[seat as usize] = lseq;
                self.committed.entry(c.mseq).or_insert((seat, lseq));
                // The interim's commits carry the match id, as the arena's do: a follower drops a
                // commit from any other match (Oracle on #86).
                let id = self.shrines[0].begin.map_or(0, |(id, _)| id);
                let b = Self::encode(NODES[0], id, &Frame::Commit(c));
                self.put(NODES[0], BROADCAST, b);
                if seat == 0 {
                    // The interim never hears its own commits back, so it notes its own taps here:
                    // without it, a copy it drew while dark was drawn again after the revival, and
                    // the arena refused it forever (COPY_DRAWN; found on #76).
                    self.shrines[0].pending = None;
                    self.shrines[0].note_own(&c.record);
                }
            }
            Err(e) => {
                let reject = Frame::Tap(Tap::Reject {
                    lseq,
                    reason: refusal_code(&e),
                });
                let b = Self::encode(NODES[0], 0, &reject);
                if seat == 0 {
                    self.shrines[0].pending = None;
                    self.shrines[0].refused = self.shrines[0].refused.saturating_add(1);
                } else {
                    self.interim_rejects += 1;
                    self.put(NODES[0], NODES[1], b);
                }
            }
        }
    }
}

impl Net {
    fn send_handback(&mut self, from: u16, bitmap: u64, dst: u8) {
        self.send_handback_from(0, from, bitmap, dst);
    }

    /// `H` chunks of shrine `i`'s record list from `from`, to `dst`: the interim's (seat 0) as
    /// ever, or seat 1's answering the interim's catch-up `N` (#98).
    fn send_handback_from(&mut self, i: usize, from: u16, bitmap: u64, dst: u8) {
        let Some(first) = self.shrines[i].follower.handback(from, 0) else {
            return;
        };
        for idx in 0..first.count {
            if bitmap & (1 << idx) == 0 {
                continue;
            }
            let mut hb = self.shrines[i].follower.handback(from, idx).unwrap();
            if i == 0 && self.corrupt_handback && idx == first.count - 1 {
                hb.records[0][30] ^= 0x01; // one byte of one carried hash
            }
            if i == 0 && self.zero_interim_lseq && dst != ARENA {
                hb.last_lseq = [0; 2];
            }
            let id = self.shrines[i].begin.map_or(0, |(id, _)| id);
            let b = Self::encode(NODES[i], id, &Frame::Handback(hb));
            self.put(NODES[i], dst, b);
        }
    }

    /// #98: whether the interim may arbitrate yet. The arena's last commits can reach seat 1 and
    /// not seat 0 before it dies; an interim that arbitrated those mseqs itself forked the two
    /// shrines, and seat 1 halted on its next commit. So before its first commit in a dark window
    /// the interim sends seat 1 an `N` from its own next mseq, every 100 ms, and seat 1 answers
    /// with `H` chunks of whatever it holds past that (none: one empty chunk). The interim adopts
    /// them through its follower, checked record by record as any `H`, and arbitrates from the
    /// common head. A seat 1 that never answers (unreachable, or holding no game) is waited for
    /// `SYNC_BOUND_MS`, then the interim arbitrates as before. No new frame: the `N` and `H` of
    /// #76, the other way round.
    fn interim_caught_up(&mut self) -> bool {
        if !self.interim_syncs || self.interim_synced {
            return true;
        }
        let now = self.now;
        let (first, last) = *self.sync_asked.get_or_insert((now, 0));
        if now.saturating_sub(first) >= SYNC_BOUND_MS {
            self.interim_synced = true;
            return true;
        }
        if last == 0 || now.saturating_sub(last) >= 100 {
            self.sync_asked = Some((first, now.max(1)));
            let from = self.shrines[0].follower.next_mseq();
            let id = self.shrines[0].begin.map_or(0, |(id, _)| id);
            let n = Frame::Nak(Nak { from, to: from });
            let b = Self::encode(NODES[0], id, &n);
            self.put(NODES[0], NODES[1], b);
        }
        false
    }
}
