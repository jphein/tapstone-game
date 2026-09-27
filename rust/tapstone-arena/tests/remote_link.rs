//! The remote seat (0038): a manual desk-style shrine beside the table's link, claiming only once
//! someone has joined and only second (so it is seat 1), played through the engine's own menu.
use tapstone_arena::core::{ArenaCore, CoreConfig, Input, Output, Unsigned};
use tapstone_arena::link::Link;
use tapstone_arena::link::desk::{ARENA_NODE, DESK_NODES, DeskLink};
use tapstone_arena::link::remote::{REMOTE_NODE, RemoteLink};
use tapstone_arena::registry::Registry;
use tapstone_rules::{HouseRules, Kind};
use tapstone_sim::deck::load_named;

struct Table {
    link: RemoteLink<DeskLink>,
    core: ArenaCore,
    over: u32,
}

/// The Roblox side's test table: the desk bot on shrine 0, shrine 1 off, the remote seat holding
/// the repo's Ember deck.
fn table(seed: u64) -> Table {
    let (mut desk, mut book, stats) = DeskLink::new(seed);
    desk.off[1] = true;
    desk.shrines[0].rematch = true;
    let deck = load_named("ember-neutral", &HouseRules::default()).unwrap();
    book.push(deck.clone());
    let link = RemoteLink::new(desk, seed, &deck);
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
    /// One 10 ms step, as the arena loop runs it: gate the remote seat, poll, handle, send.
    fn step(&mut self, now: u64, joined: bool) {
        let seated = self.core.seated();
        self.link.remote().unwrap().gate(joined, &seated);
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

/// Plays the remote seat with the first useful non-mulligan choice, as the web gate does, until
/// a match ends. Returns (matches finished, taps made, the table).
fn play(seed: u64, person: bool, joined: bool, steps: u64) -> (u32, u32, Table) {
    let mut t = table(seed);
    let mut taps = 0;
    for step in 0..steps {
        let now = step * 10;
        t.step(now, joined);
        if t.over > 0 {
            break;
        }
        if !person {
            continue;
        }
        let g = t.link.shrine.follower.game;
        let pick = t
            .link
            .remote()
            .unwrap()
            .choices()
            .into_iter()
            .find(|c| c.tap.kind != Kind::Mulligan && c.is_useful(&g));
        if let Some(c) = pick {
            assert!(
                t.link.remote().unwrap().propose(now, c.tap),
                "a menu choice was not sent"
            );
            taps += 1;
        }
    }
    (t.over, taps, t)
}

#[test]
fn a_remote_seat_finishes_a_match_against_a_desk_shrine() {
    let (over, taps, _) = play(11, true, true, 40_000);
    assert_eq!(over, 1, "the match never finished");
    assert!(taps >= 5, "the remote seat made only {taps} taps");
}

/// The control: joined but nobody choosing, the match stalls (the one above finishes because of
/// the remote player's taps, not because the shrine plays itself).
#[test]
fn a_remote_seat_left_alone_stalls() {
    let (over, taps, _) = play(11, false, true, 40_000);
    assert_eq!((over, taps), (0, 0));
}

#[test]
fn with_nobody_joined_the_remote_shrine_never_claims() {
    let (_, _, mut t) = play(11, false, false, 3_000);
    assert_eq!(t.core.seated(), vec![DESK_NODES[0]]);
    assert_eq!(
        t.link.remote().unwrap().seat(),
        None,
        "a seat with no claim"
    );
}

#[test]
fn the_remote_seat_is_seat_one() {
    let (_, _, mut t) = play(11, false, true, 3_000);
    assert_eq!(t.core.seated(), vec![DESK_NODES[0], REMOTE_NODE]);
    assert_eq!(t.link.shrine.seat(), Some(1));
    assert_eq!(t.link.remote().unwrap().seat(), Some(1));
}
