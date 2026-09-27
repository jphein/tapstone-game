//! The radio match (tapstone#132 item 1): the arena's remote seat against a desk-style shrine whose
//! every frame crosses a gateway. Here the "radio" is the `@TS1` line codec in both directions and a
//! node map, so what the hardware run adds is only the air; the bin (`radio_shrine`) drives the same
//! `RadioShrine` over `SerialLink`.
use tapstone_arena::core::{ArenaCore, CoreConfig, Input, Output, Unsigned};
use tapstone_arena::decks::DeckBook;
use tapstone_arena::link::desk::{ARENA_NODE, FixedStats, copy_uid};
use tapstone_arena::link::lines::{GwLine, PREFIX, parse, tx_line};
use tapstone_arena::link::radio::{RadioShrine, registry_rows};
use tapstone_arena::link::remote::RemoteLink;
use tapstone_arena::link::trace::{Dir, join, parse_trace};
use tapstone_arena::link::{Link, Rx};
use tapstone_arena::registry::Registry;
use tapstone_proto::frame::{BROADCAST, Frame};
use tapstone_rules::{HouseRules, Kind};
use tapstone_sim::deck::{Deck, load_named};
use tapstone_sim::replay::replay;

/// The two gateways' node ids on the bench (smol#549: boards 61 and 62).
const ARENA_GW: u8 = 61;
const SHRINE_GW: u8 = 62;

fn deck(stem: &str) -> Deck {
    load_named(stem, &HouseRules::default()).unwrap()
}

/// Board 62's side of the air: every frame goes out as a `TX` line and comes back in as the `RX`
/// line the other gateway would write, so the codec is exercised both ways. Frames addressed to a
/// node the far gateway is not, and is not broadcast to, are counted and dropped, as the air would.
struct Air {
    shrine: RadioShrine,
    manual: bool,
    to_arena: Vec<Rx>,
    /// Frames the shrine addressed to anything but the arena's gateway or broadcast.
    misaddressed: u32,
    tx_id: u32,
    /// The next `poison` shrine frames arrive named as the arena gateway's own node: the roster
    /// fault seen on katana's bench (the receiving gateway put its own id on the peer's MAC).
    poison: u32,
}

/// One frame over the air: `TX` line out of the sender, `RX` line out of the receiver.
fn over_air(tx_id: u32, src: u8, dst: u8, frame: &[u8]) -> Rx {
    let tx = tx_line(tx_id, dst, frame);
    let hex = tx.trim_end().rsplit(' ').next().unwrap().to_string();
    match parse(&format!("{PREFIX}RX {src} -40 1 {hex}\n")) {
        GwLine::Rx {
            src,
            rssi,
            mac_ok,
            bytes,
        } => Rx {
            src,
            rssi,
            mac_ok,
            bytes,
        },
        other => panic!("the RX line did not parse: {other:?}"),
    }
}

impl Air {
    fn up(&mut self, frames: Vec<(u8, Vec<u8>)>) {
        for (dst, f) in frames {
            if dst != ARENA_GW && dst != BROADCAST {
                self.misaddressed += 1;
                continue;
            }
            self.tx_id += 1;
            let src = if self.poison > 0 {
                self.poison -= 1;
                ARENA_GW
            } else {
                SHRINE_GW
            };
            self.to_arena.push(over_air(self.tx_id, src, dst, &f));
        }
    }
}

impl Link for Air {
    fn send(&mut self, dst: u8, frame: &[u8]) {
        if dst != SHRINE_GW && dst != BROADCAST {
            return;
        }
        self.tx_id += 1;
        let rx = over_air(self.tx_id, ARENA_GW, dst, frame);
        let replies = self.shrine.rx(&rx);
        self.up(replies);
    }

    fn poll(&mut self, now: u64) -> Vec<Rx> {
        let frames = self.shrine.tick(now, self.manual);
        self.up(frames);
        std::mem::take(&mut self.to_arena)
    }
}

struct Table {
    link: RemoteLink<Air>,
    core: ArenaCore,
    over: Vec<tapstone_arena::core::MatchOver>,
}

/// Gateway mode as `main.rs` builds it: a strict registry from `registry_rows` plus the remote
/// slot's virtual copies, the repo's deck book, the arena on its gateway's node.
fn table(seed: u64, manual: bool, poison: u32) -> Table {
    let tide = deck("tide-neutral");
    let ember = deck("ember-neutral");
    let shrine = RadioShrine::new(seed, 0, SHRINE_GW, &tide, ARENA_GW);
    let air = Air {
        shrine,
        manual,
        to_arena: Vec::new(),
        misaddressed: 0,
        tx_id: 0,
        poison,
    };
    let mut registry = Registry::from_jsonl(&registry_rows(0, &tide)).unwrap();
    let link = RemoteLink::at_gateway(air, seed, &[ember], &mut registry).unwrap();
    let cfg = CoreConfig {
        node: ARENA_GW,
        rules: Default::default(),
        ruleset: 1,
        registry_id: 0,
        flat: false,
        epoch_unix: 1_789_980_000,
    };
    let core = ArenaCore::new(
        cfg,
        Box::new(FixedStats([(1, [None; 3]); 2])),
        DeckBook::load_repo().unwrap(),
        registry,
        Box::new(Unsigned),
    );
    Table {
        link,
        core,
        over: Vec::new(),
    }
}

impl Table {
    fn step(&mut self, now: u64) {
        let seated = self.core.seated();
        self.link.remote().unwrap().gate(true, &seated);
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
                    Output::MatchOver(m) => self.over.push(*m),
                    _ => {}
                }
            }
        }
    }
}

/// The remote seat plays the first useful non-mulligan choice (remote_smoke.py's picker).
fn play(seed: u64, manual: bool, steps: u64) -> (u32, Table) {
    play_poisoned(seed, manual, 0, steps)
}

fn play_poisoned(seed: u64, manual: bool, poison: u32, steps: u64) -> (u32, Table) {
    let mut t = table(seed, manual, poison);
    let mut taps = 0;
    for step in 0..steps {
        let now = step * 10;
        t.step(now);
        if !t.over.is_empty() {
            break;
        }
        let g = t.link.shrine.follower.game;
        let pick = t
            .link
            .remote()
            .unwrap()
            .choices()
            .into_iter()
            .find(|c| c.tap.kind != Kind::Mulligan && c.is_useful(&g));
        if let Some(c) = pick
            && t.link.remote().unwrap().propose(now, c.tap)
        {
            taps += 1;
        }
    }
    (taps, t)
}

#[test]
fn a_radio_shrine_plays_a_whole_match_against_the_remote_seat() {
    let (taps, t) = play(11, false, 60_000);
    assert_eq!(t.over.len(), 1, "the match never finished over the air");
    let m = &t.over[0];
    assert!(m.winner.is_some(), "a result without a winner");
    assert!(taps >= 5, "the remote seat made only {taps} taps");
    let shrine = &t.link.inner.shrine.shrine;
    assert_eq!(
        shrine.seat(),
        Some(0),
        "the radio shrine claims first, so seat 0"
    );
    assert!(
        shrine.proposed.len() >= 5,
        "the radio shrine made {} taps",
        shrine.proposed.len()
    );
    assert_eq!(
        t.link.inner.misaddressed, 0,
        "a shrine frame named a node the air cannot reach"
    );
    // The shrine's own chain, computed on the far side of the air, ends where the arena's does.
    assert_eq!(
        shrine.follower.head_hash(),
        m.result.chain,
        "the chains split over the air"
    );
    // And an independent replay of the arena's transcript re-derives every hash.
    let r = replay(&m.json).unwrap();
    assert!(r.matches(&m.json), "the arena's transcript does not replay");
}

/// The control: the same table with the radio shrine proposing nothing never reaches a result.
/// The remote seat still plays whenever the engine offers it a move, so what stalls it is the
/// silent shrine, not a table that could never start.
#[test]
fn a_silent_radio_shrine_stalls_the_match() {
    let (taps, t) = play(11, true, 60_000);
    assert!(t.over.is_empty(), "a match finished with one seat silent");
    assert!(
        t.core.seated().len() == 2,
        "the control never seated both, so it tests nothing"
    );
    assert!(
        t.link.inner.shrine.shrine.proposed.is_empty(),
        "the silent shrine proposed"
    );
    // The remote seat took what it could (its draws), then waited on seat 0 forever.
    assert!(
        taps < 20,
        "the remote seat made {taps} taps with its opponent silent"
    );
}

#[test]
fn every_shrine_frame_is_addressed_to_the_arena_gateway_or_broadcast() {
    let mut s = RadioShrine::new(3, 0, SHRINE_GW, &deck("tide-neutral"), ARENA_GW);
    let mut seen = 0;
    for step in 0..200u64 {
        for (dst, bytes) in s.tick(step * 10, false) {
            assert_ne!(
                dst, ARENA_NODE,
                "the desk arena's node 200 would be unknown-dst on the air"
            );
            assert!(dst == ARENA_GW || dst == BROADCAST, "dst {dst}");
            let (h, _) = Frame::decode(&bytes).expect("a frame");
            assert_eq!(
                h.src, SHRINE_GW,
                "the header names the shrine's own gateway node"
            );
            seen += 1;
        }
    }
    assert!(
        seen > 0,
        "the shrine sent nothing in the lobby, so this checked nothing"
    );
}

/// A desk shrine beacons its lobby every 10 ms tick; over the air that is 100 frames a second from
/// one seat. The radio shrine keeps one per `beacon_ms` and lets claims through untouched.
#[test]
fn lobby_beacons_are_throttled_and_claims_are_not() {
    let mut s = RadioShrine::new(3, 0, SHRINE_GW, &deck("tide-neutral"), ARENA_GW);
    let (mut lobbies, mut claims) = (0, 0);
    for step in 0..100u64 {
        for (_, bytes) in s.tick(step * 10, false) {
            match Frame::decode(&bytes).unwrap().1 {
                Frame::Lobby(_) => lobbies += 1,
                Frame::Tap(_) => claims += 1,
                _ => {}
            }
        }
    }
    // 1 s of ticks: at 250 ms, beacons at 0, 250, 500, 750.
    assert_eq!(lobbies, 4, "lobby beacons in 1 s");
    // The claim re-sends every 100 ms until answered: 10 in 1 s.
    assert_eq!(claims, 10, "claims in 1 s");
}

#[test]
fn registry_rows_resolve_every_copy_and_the_figurine() {
    let tide = deck("tide-neutral");
    let reg = Registry::from_jsonl(&registry_rows(0, &tide)).unwrap();
    assert_eq!(
        reg.len(),
        tide.cards.len() + 1,
        "one row per copy plus the figurine"
    );
    for (k, &design) in tide.cards.iter().enumerate() {
        assert_eq!(reg.resolve(copy_uid(0, k)), Some(design), "copy {k}");
    }
    assert_eq!(
        reg.resolve([4, 0, 0, 0, 0, 0, 0]),
        Some(tide.castle),
        "the figurine"
    );
    // Slot 0 of the remote seat is index 2: none of its UIDs may already be registered.
    let ember = deck("ember-neutral");
    let link = RemoteLink::new(tapstone_arena::link::desk::DeskLink::new(1).0, 1, &ember);
    let mut reg = reg;
    for (uid, design) in link.virtual_uids() {
        reg.add_virtual(uid, design)
            .expect("a remote UID collides with the radio shrine's");
    }
}

#[test]
fn trace_lines_parse_and_join_into_per_leg_counts() {
    // Sender (board A's trace): three TX lines and their TXOKs; one TXERR.
    let a = "\
1000 > @TS1 TX 1 62 aabb
1100 < @TS1 TXOK 1
2000 > @TS1 TX 2 255 ccdd
2050 < @TS1 TXOK 2
3000 > @TS1 TX 3 62 aabb
3010 < @TS1 TXERR 3 unknown-dst
4000 > @TS1 TX 4 62 eeff
4010 < @TS1 TXOK 4
4020 < INFO - smol: an ordinary log
6000 > @TS1 TX 5 62 aabb
6010 < @TS1 TXOK 5
7000 > @TS1 TX 6 62 1111
20000 > @TS1 TX 7 62 2222
20010 < @TS1 TXOK 7
";
    // Receiver (board B): frame 1 at +1.5 ms, frame 2 at +3 ms, frame 4 lost, frame 5 (the same
    // bytes as 1 and the TXERR'd 3) at +0.4 ms, and one foreign RX.
    let b = "\
2500 < @TS1 RX 61 -40 1 aabb
5000 < @TS1 RX 61 -41 1 ccdd
6400 < @TS1 RX 61 -40 1 AABB
9000 < @TS1 RX 70 -80 1 0102
";
    let ta = parse_trace(a).unwrap();
    let tb = parse_trace(b).unwrap();
    assert_eq!(ta.len(), 14);
    assert_eq!(ta[0].dir, Dir::Out);
    assert_eq!(ta[8].dir, Dir::In);
    let leg = join(&ta, &tb, 1_000_000);
    assert_eq!(leg.tx, 7);
    assert_eq!(leg.txok, 5);
    assert_eq!(leg.txerr, vec![(3, "unknown-dst".to_string())]);
    assert_eq!(leg.delivered, 3);
    // Frame 6 got neither TXOK nor TXERR: its gateway never said it left.
    assert_eq!(leg.unanswered, 1);
    // Frame 7 was sent after the receiver's trace ends (9000): nobody was listening.
    assert_eq!(leg.after_close, 1);
    // Undelivered while the receiver listened: 3 (TXERR), 4 (the air) and 6 (unanswered).
    assert_eq!(leg.lost, 3);
    assert_eq!(
        leg.air_lost(),
        1,
        "only frame 4 left its gateway and did not arrive"
    );
    assert_eq!(leg.foreign_rx, 1);
    // Frame 5's RX goes to frame 5 (400 µs): not to frame 1 again, nor to the TXERR'd frame 3.
    assert_eq!(leg.latency_us, vec![1500, 3000, 400]);
    assert_eq!(leg.quantile(0.5), Some(1500));
    assert_eq!(leg.quantile(1.0), Some(3000));
    assert_eq!(leg.logs, 1);
    assert!(
        parse_trace("12 x @TS1 PING").is_err(),
        "a bad direction is an error"
    );
}

/// A strict registry (gateway mode) resolves every cast and charge by the UID the shrine tapped
/// (play.rs `needs_card`), so a desk-style shrine at a real table must name a copy it drew. With
/// `stamp_uids`, each cast or charge carries the UID of a drawn copy of that design still in hand,
/// and no copy is played twice.
#[test]
fn stamped_casts_name_a_drawn_copy_of_their_design_once() {
    let (_, t) = play(11, false, 60_000);
    let shrine = &t.link.inner.shrine.shrine;
    assert!(shrine.stamp_uids, "the radio shrine stamps");
    let m = &t.over[0];
    let mut drawn = std::collections::HashSet::new();
    let mut played = std::collections::HashSet::new();
    let mut casts = 0;
    for r in &m.json.records {
        if r.seat != 0 {
            continue;
        }
        match r.kind.as_str() {
            "Draw" => {
                drawn.insert(r.uid.clone());
            }
            "Mulligan" => drawn.clear(),
            "Charge" | "CastUnit" | "CastSpell" => {
                casts += 1;
                assert_ne!(r.uid, "00000000000000", "an unstamped cast committed");
                assert!(
                    drawn.contains(&r.uid),
                    "cast {} names a copy never drawn",
                    r.uid
                );
                assert!(played.insert(r.uid.clone()), "copy {} played twice", r.uid);
            }
            _ => {}
        }
    }
    assert!(
        casts >= 3,
        "only {casts} casts by seat 0, so this checked little"
    );
}

/// `stamp` picks a copy of the tap's own design, not merely the first copy in hand.
#[test]
fn stamp_names_a_copy_of_the_taps_design() {
    let tide = deck("tide-neutral");
    let mut s = RadioShrine::new(3, 0, SHRINE_GW, &tide, ARENA_GW).shrine;
    // Two copies of different designs in hand, the wanted one second.
    let k_other = 0;
    let k_want = (1..tide.cards.len())
        .find(|&k| tide.cards[k] != tide.cards[k_other])
        .expect("a deck of one design");
    s.hand_uids = heapless::Vec::from_slice(&[copy_uid(0, k_other), copy_uid(0, k_want)]).unwrap();
    let mut tap = tapstone_sim::tap(0, Kind::CastUnit, tide.cards[k_want], 0, 0, 0);
    s.stamp(&mut tap);
    assert_eq!(tap.uid, copy_uid(0, k_want));
    // Not a card tap: untouched. Stamping off: untouched.
    let mut pass = tapstone_sim::tap(0, Kind::Pass, 0, -1, 0, 0);
    s.stamp(&mut pass);
    assert_eq!(pass.uid, [0; 7]);
    s.stamp_uids = false;
    let mut tap = tapstone_sim::tap(0, Kind::CastUnit, tide.cards[k_want], 0, 0, 0);
    s.stamp(&mut tap);
    assert_eq!(tap.uid, [0; 7]);
}

/// The gateway names an RX's sender by its roster (the link layer); the frame names itself in its
/// header. On katana's bench the roster sometimes put the receiver's OWN id on the peer's MAC, so
/// a frame from node 62 arrived as src 61. `src_mismatch` counts those, on the receiver.
#[test]
fn join_counts_rx_whose_link_src_differs_from_the_header() {
    use tapstone_arena::link::desk::encode;
    let f = encode(
        62,
        7,
        &Frame::Join(tapstone_proto::frame::Join {
            role: 0,
            have_mseq: 0,
        }),
    );
    let h: String = f.iter().map(|b| format!("{b:02x}")).collect();
    let a = format!("100 > @TS1 TX 1 61 {h}\n200 > @TS1 TX 2 61 {h}\n");
    let b = format!("150 < @TS1 RX 62 -40 1 {h}\n250 < @TS1 RX 61 -40 1 {h}\n");
    let leg = join(
        &parse_trace(&a).unwrap(),
        &parse_trace(&b).unwrap(),
        1_000_000,
    );
    assert_eq!(leg.delivered, 2);
    assert_eq!(
        leg.src_mismatch, 1,
        "the RX named 61 carries a header from 62"
    );
}

/// katana, run-s14: the arena gateway's roster named seat B's first claim as the arena's OWN node,
/// and the arena seated node 61, then sent its `B` to itself forever (TXERR self-dst) while the
/// real shrine sat in the lobby. A frame naming the arena's own node is dropped, so the claim's
/// retransmit, correctly named, takes the seat.
#[test]
fn frames_named_as_the_arenas_own_node_are_dropped() {
    let (_, t) = play_poisoned(11, false, 30, 60_000);
    assert!(
        t.link.inner.poison == 0,
        "the poisoned frames were all sent, so this saw them"
    );
    assert_eq!(
        t.over.len(),
        1,
        "the match never finished after a poisoned lobby"
    );
    assert_eq!(
        t.over[0].nodes,
        [SHRINE_GW, 165],
        "the arena seated the wrong node"
    );
}

/// The remote seat, played through `propose` the way `/remote/*` plays it, casts under its slot's
/// virtual copies in a strict registry: every cast or charge it commits names one of them, once.
#[test]
fn remote_seat_casts_commit_under_its_slots_virtual_uids() {
    let (_, t) = play(11, false, 60_000);
    let virtuals: std::collections::HashSet<String> = t
        .link
        .virtual_uids()
        .into_iter()
        .map(|(u, _)| u.iter().map(|b| format!("{b:02x}")).collect())
        .collect();
    let m = &t.over[0];
    let mut played = std::collections::HashSet::new();
    let mut casts = 0;
    for r in m.json.records.iter().filter(|r| r.seat == 1) {
        if matches!(r.kind.as_str(), "Charge" | "CastUnit" | "CastSpell") {
            casts += 1;
            assert!(
                virtuals.contains(&r.uid.to_lowercase()),
                "remote cast {} is no virtual copy",
                r.uid
            );
            assert!(
                played.insert(r.uid.clone()),
                "remote copy {} played twice",
                r.uid
            );
        }
    }
    assert!(
        casts >= 3,
        "only {casts} remote casts, so this checked little"
    );
}

/// A remote slot's virtual copy may never shadow a real card: `at_gateway` refuses a table whose
/// registry already names one of the slot's UIDs, and the real row still resolves to its design.
#[test]
fn at_gateway_refuses_a_virtual_uid_that_names_a_real_card() {
    use tapstone_arena::link::remote::REMOTE_INDEX;
    let tide = deck("tide-neutral");
    let ember = deck("ember-neutral");
    let k = (0..tide.cards.len().min(ember.cards.len()))
        .find(|&k| tide.cards[k] != ember.cards[k])
        .expect("the decks differ somewhere");
    // Real cards registered under exactly the UIDs the remote slot would claim.
    let mut reg = Registry::from_jsonl(&registry_rows(REMOTE_INDEX, &tide)).unwrap();
    let inner = tapstone_arena::link::desk::DeskLink::new(1).0;
    assert!(
        RemoteLink::at_gateway(inner, 1, &[ember], &mut reg).is_err(),
        "a virtual copy shadowed a real card"
    );
    assert_eq!(
        reg.resolve(copy_uid(REMOTE_INDEX, k)),
        Some(tide.cards[k]),
        "the real row moved"
    );
}
