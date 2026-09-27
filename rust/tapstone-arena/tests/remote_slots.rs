//! Two remote slots and no bot (0038; JP against a second player, both in Roblox): both desk shrines off,
//! a remote shrine per slot, each claiming once its own slot is joined, the first to claim seat 0.
//! Driven through `RemoteLink` directly, with no HTTP.
use std::collections::HashSet;

use tapstone_arena::core::{ArenaCore, CoreConfig, Input, Output, Unsigned};
use tapstone_arena::link::Link;
use tapstone_arena::link::desk::{ARENA_NODE, DeskLink, copy_uid};
use tapstone_arena::link::remote::{REMOTE_NODE, RemoteLink};
use tapstone_arena::registry::Registry;
use tapstone_rules::{HouseRules, Kind};
use tapstone_sim::deck::load_named;

const DECKS: [&str; 2] = ["ember-neutral", "tide-neutral"];

struct Table {
    link: RemoteLink<DeskLink>,
    core: ArenaCore,
    over: u32,
}

/// Roblox against Roblox: both desk shrines off, slot 0 holding Ember and slot 1 Tide.
fn table(seed: u64) -> Table {
    let (mut desk, mut book, stats) = DeskLink::new(seed);
    desk.off = [true, true];
    let rules = HouseRules::default();
    let decks: Vec<_> = DECKS
        .iter()
        .map(|d| load_named(d, &rules).unwrap())
        .collect();
    for d in &decks {
        book.push(d.clone());
    }
    let link = RemoteLink::with_slots(desk, seed, &decks);
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
    Table {
        link,
        core,
        over: 0,
    }
}

impl Table {
    /// One 10 ms step, as the arena loop runs it: gate the slots, poll, handle, send.
    fn step(&mut self, now: u64, joined: [bool; 2]) {
        let seated = self.core.seated();
        self.link.remote().unwrap().gate_slots(&joined, &seated);
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
                    Output::MatchOver(_) => self.over += 1,
                    _ => {}
                }
            }
        }
    }
}

/// Plays each slot in `people` with the first useful non-mulligan choice (as tests/desk_table.rs
/// does), both slots joined, until a match ends. Returns (matches finished, taps per slot).
fn play(seed: u64, people: [bool; 2], steps: u64) -> (u32, [u32; 2], Table) {
    let mut t = table(seed);
    let mut taps = [0; 2];
    for step in 0..steps {
        let now = step * 10;
        t.step(now, [true, true]);
        if t.over > 0 {
            break;
        }
        for slot in 0..2 {
            if !people[slot] {
                continue;
            }
            let g = t.link.shrine_at(slot).follower.game;
            let pick = t
                .link
                .remote()
                .unwrap()
                .choices_at(slot)
                .into_iter()
                .find(|c| c.tap.kind != Kind::Mulligan && c.is_useful(&g));
            if let Some(c) = pick {
                assert!(
                    t.link.remote().unwrap().propose_at(slot, now, c.tap),
                    "slot {slot}'s menu choice was not sent"
                );
                taps[slot] += 1;
            }
        }
    }
    (t.over, taps, t)
}

#[test]
fn two_remote_slots_finish_a_match_by_proposals_alone() {
    let (over, taps, _) = play(11, [true, true], 40_000);
    assert_eq!(over, 1, "the match never finished");
    for (slot, n) in taps.iter().enumerate() {
        assert!(*n >= 5, "slot {slot} made only {n} taps");
    }
}

/// The control: slot 1 joined but nobody choosing for it, the match stalls. So the run above
/// finishes because of both slots' proposals, not because either shrine plays itself.
#[test]
fn with_slot_one_left_alone_the_match_stalls() {
    let (over, taps, t) = play(11, [true, false], 40_000);
    assert_eq!(over, 0, "the match finished with slot 1 unplayed");
    assert_eq!(taps[1], 0);
    assert_eq!(
        t.core.seated().len(),
        2,
        "it stalled in play, not in the lobby"
    );
}

#[test]
fn a_slot_claims_only_once_it_is_joined_and_the_first_to_claim_is_seat_zero() {
    let mut t = table(11);
    for step in 0..300u64 {
        t.step(step * 10, [false, false]);
    }
    assert!(
        t.core.seated().is_empty(),
        "a slot claimed with nobody joined"
    );
    for step in 300..600u64 {
        t.step(step * 10, [false, true]);
    }
    assert_eq!(
        t.core.seated(),
        vec![REMOTE_NODE + 1],
        "slot 1 alone, joined first"
    );
    for step in 600..900u64 {
        t.step(step * 10, [true, true]);
    }
    assert_eq!(t.core.seated(), vec![REMOTE_NODE + 1, REMOTE_NODE]);
    assert_eq!(t.link.shrine_at(1).seat(), Some(0));
    assert_eq!(t.link.shrine_at(0).seat(), Some(1));
    let r = t.link.remote().unwrap();
    assert_eq!((r.seat_at(0), r.seat_at(1)), (Some(1), Some(0)));
}

/// The control: joined together, slot 0 is seat 0 (the order above is claim order, not slot
/// order held backwards).
#[test]
fn joined_together_slot_zero_claims_first() {
    let mut t = table(11);
    for step in 0..300u64 {
        t.step(step * 10, [true, true]);
    }
    assert_eq!(t.core.seated(), vec![REMOTE_NODE, REMOTE_NODE + 1]);
}

#[test]
fn the_slots_figurines_and_copies_are_their_own() {
    let t = table(11);
    assert_eq!(t.link.remote_slots(), 2);
    let desk: Vec<[u8; 7]> = (0..2)
        .flat_map(|i| {
            let mut v = vec![[4, 0, 0, 0, 0, 0, i as u8]];
            v.extend((0..40).map(move |k| copy_uid(i, k)));
            v
        })
        .collect();
    let uids: Vec<[u8; 7]> = t.link.virtual_uids().into_iter().map(|(u, _)| u).collect();
    let deck_len: usize = (0..2).map(|s| t.link.shrine_at(s).deck.len()).sum();
    assert_eq!(
        uids.len(),
        2 + deck_len,
        "a figurine and every copy per slot"
    );
    assert_eq!(
        uids.iter().collect::<HashSet<_>>().len(),
        uids.len(),
        "two slots share a UID"
    );
    assert!(
        uids.iter().all(|u| !desk.contains(u)),
        "a slot's UID is a desk shrine's"
    );
    let r = &t.link;
    assert_ne!(r.shrine_at(0).figurine(), r.shrine_at(1).figurine());
    assert_eq!(
        (r.shrine_at(0).node, r.shrine_at(1).node),
        (REMOTE_NODE, REMOTE_NODE + 1)
    );
    assert_eq!((r.shrine_at(0).index, r.shrine_at(1).index), (2, 3));
}
