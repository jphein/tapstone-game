//! smol#558: a seat that reboots mid-match while the arena is dark, with the shrines' own detector
//! (`DARK_MS`) and nobody declaring the window. The rebooted shrine kept nothing, so it knows
//! neither its seat nor the interim's node, and its silence detector cannot start: it has no match
//! in play to be silent about. `dark_rejoin.rs` is the same rejoin with the window declared
//! god's-eye (`Net::reboot` tells a shrine booting into it). Here the shrine must discover it: a
//! `J` for a `B` that nobody answers for `DARK_MS` means the arena is dark, so it goes dark and
//! broadcasts the `J`, and the interim's answer (`B` rebuilt, then `H`, #76) names its seat and the
//! interim's node. No new frame.
mod harness;
use harness::*;
use tapstone_proto::frame::result_reason;
use tapstone_proto::shrine::DARK_MS;
use tapstone_rules::Phase;

struct Run {
    net: Net,
    /// The rebooted seat had rejoined (caught up, not rejoining, not halted) while still dark.
    rejoined_dark: bool,
    /// Seat 1's records the interim committed after the reboot, counted in the interim's own list.
    committed_after: usize,
    /// The game ended during the dark window (read then, before the revival plays it out).
    ended_dark: bool,
}

/// Into the match, the arena silently dead (nothing reaches it, nothing leaves it, no one is
/// told), both shrines detect it, `before` steps of interim play, then seat 1 reboots with
/// nothing kept (the JOIN path). Up to 3,000 steps to rejoin and tap while still dark, then the
/// arena revives from its journal and the match plays out. `None`: the match ended in the dark
/// window before the reboot, so there was no seat to rejoin.
fn run(seed: u64, before: usize, discovers: bool) -> Option<Run> {
    run_with(seed, before, discovers, false)
}

/// As [`run`]; `rematch` sends both shrines (the rebooted one too) back to the lobby after the
/// match, to claim a second one.
fn run_with(seed: u64, before: usize, discovers: bool, rematch: bool) -> Option<Run> {
    let mut net = Net::new(seed, 0.0, 0.0);
    net.detect_dark = true;
    for s in &mut net.shrines {
        s.rematch = rematch;
    }
    net.seatless_discovers = discovers;
    while net.shrines[0].follower.records().len() < 20 && net.over.is_empty() {
        net.step();
    }
    assert!(
        net.over.is_empty(),
        "seed {seed}: over before the arena died"
    );
    net.arena_up = false;
    for _ in 0..1_000 {
        if net.shrines.iter().all(|s| s.dark.on) {
            break;
        }
        net.step();
    }
    assert!(
        net.shrines.iter().all(|s| s.dark.on),
        "seed {seed}: both shrines detected dark"
    );
    for _ in 0..before {
        net.step();
    }
    if net.shrines[0].follower.game.phase != Phase::Playing {
        return None;
    }
    assert!(!net.dark, "the harness declared nothing");
    net.reboot(1, true);
    net.shrines[1].rematch = rematch;
    assert!(
        !net.shrines[1].dark.on && net.shrines[1].seat().is_none(),
        "seed {seed}/{before}: the rebooted shrine was told nothing"
    );
    let reboot_at = net.shrines[0].follower.records().len();
    let seat1_since = |net: &Net| {
        net.shrines[0].follower.records()[reboot_at..]
            .iter()
            .filter_map(|b| tapstone_rules::Record::decode(b))
            .filter(|r| r.seat == 1)
            .count()
    };
    let mut rejoined_dark = false;
    for _ in 0..3_000 {
        net.step();
        let s = &net.shrines[1];
        if !s.rejoining && s.seat() == Some(1) && s.follower.halted().is_none() {
            rejoined_dark = true;
        }
        if seat1_since(&net) > 0 || net.shrines[0].follower.game.phase != Phase::Playing {
            break;
        }
    }
    let committed_after = seat1_since(&net);
    let ended_dark = net.shrines[0].follower.game.phase != Phase::Playing;
    net.revive();
    net.run(40_000);
    Some(Run {
        net,
        rejoined_dark,
        committed_after,
        ended_dark,
    })
}

fn converged(net: &Net) -> bool {
    net.over.last().is_some_and(|o| {
        [result_reason::LETHAL, result_reason::STOP].contains(&o.result.reason)
            && net
                .shrines
                .iter()
                .all(|s| s.follower.head_hash() == o.result.chain)
    })
}

fn cases() -> impl Iterator<Item = (u64, usize)> {
    (1..=20u64).flat_map(|s| [(s, 0), (s, 50)])
}

/// The fix, 40 cases: the seatless rebooted seat discovers the dark window, rejoins through the
/// interim, commits new taps there, and the match converges once the arena returns.
#[test]
fn a_seatless_rebooted_seat_discovers_the_dark_window_and_rejoins() {
    let mut tapped = 0;
    for (seed, before) in cases() {
        let Some(r) = run(seed, before, true) else {
            continue;
        };
        tapped += usize::from(!r.ended_dark);
        assert!(
            r.rejoined_dark,
            "seed {seed}/{before}: never rejoined while dark"
        );
        assert!(
            r.committed_after > 0 || r.ended_dark,
            "seed {seed}/{before}: the rebooted seat committed nothing while dark"
        );
        assert_eq!(
            r.net.shrines[1].begin.map(|(_, b)| b.genesis),
            r.net.shrines[0].begin.map(|(_, b)| b.genesis),
            "seed {seed}/{before}: the rebuilt B names the match's genesis"
        );
        assert!(converged(&r.net), "seed {seed}/{before}: did not converge");
        let twice = r.net.lseqs_committed_twice();
        assert!(
            twice.is_empty(),
            "seed {seed}/{before}: committed twice under one lseq: {twice:?}"
        );
    }
    // Excused: a match that ended before the reboot (no seat to rejoin), and the "committed while
    // dark" clause when it ended after it. A floor on the cases actually checked (verification.md,
    // "a skip guard needs a floor").
    eprintln!("{tapped} of 40 cases reached a tap while dark");
    assert!(
        tapped >= 30,
        "only {tapped} of 40 cases reached a tap while dark"
    );
}

/// The control, the fix off: the rebooted seat's `J` goes to the dead arena, nobody answers, and
/// its seat stalls for the whole dark window. It differs from the fix only in `seatless_discovers`.
#[test]
fn control_without_discovery_the_seatless_seat_stalls() {
    let mut stalled = 0;
    for (seed, before) in cases() {
        let Some(r) = run(seed, before, false) else {
            continue;
        };
        assert!(
            !r.rejoined_dark,
            "seed {seed}/{before}: rejoined with the J going nowhere"
        );
        assert_eq!(r.committed_after, 0, "seed {seed}/{before}");
        assert!(
            !r.ended_dark,
            "seed {seed}/{before}: ended with seat 1 stalled"
        );
        stalled += 1;
        assert!(
            r.net.shrines[1].dark.to_arena == 0 && r.net.shrines[1].begin_asks == 0,
            "seed {seed}/{before}: the stalled seat's J never went on the dark route"
        );
        // A stall, not a fork: the revived arena answers the J and the match still converges.
        assert!(converged(&r.net), "seed {seed}/{before}: did not converge");
    }
    eprintln!("{stalled} of 40 cases stalled");
    assert!(
        stalled >= 30,
        "only {stalled} of 40 cases were still in play at the reboot"
    );
}

/// The lead on #174: the rejoin leaves its `J` stamp (`asked_begin`) behind, and a rematch must
/// not read it. The arena is alive for match 2, and seat 1's match-2 `B` is dropped five times, so
/// seat 1 asks for it by `J` (#67), the rematch `J`. Neither shrine may enter a dark window from
/// match 1's end until `DARK_MS` past seat 1 taking match 2's `B`. A stale stamp would read as a
/// `J` unanswered for longer than `DARK_MS` and declare dark at once. It is harmless only because
/// discovery reads the stamp while the shrine has no `B` at all, and a `B`, once taken, is never
/// dropped (a reboot builds a fresh shrine). Removing that guard turns this red.
#[test]
fn a_rematch_after_a_seatless_rejoin_does_not_go_dark() {
    let mut checked = 0;
    for (seed, before) in cases() {
        let Some(r) = run_with(seed, before, true, true) else {
            continue;
        };
        let mut net = r.net;
        // Both shrines may be into match 2's lobby already, so match 1 is judged by its result.
        let played = [result_reason::LETHAL, result_reason::STOP];
        assert!(
            net.over
                .first()
                .is_some_and(|o| played.contains(&o.result.reason)),
            "seed {seed}/{before}: match 1 did not finish"
        );
        assert!(
            net.shrines[1].dark.asked_begin.is_some(),
            "seed {seed}/{before}: the rejoin left no stamp: nothing stale to read"
        );
        let m1 = net.over[0].match_id;
        net.drop_begin[1] = 5;
        let asks = net.shrines[1].begin_asks;
        let mut begun_at = None;
        for _ in 0..20_000 {
            net.step();
            for (i, s) in net.shrines.iter().enumerate() {
                assert!(
                    !s.dark.on,
                    "seed {seed}/{before}: shrine {i} went dark with the arena alive at {}",
                    net.now
                );
            }
            let s = &net.shrines[1];
            if begun_at.is_none() && s.follower.begun().is_some_and(|id| id != m1) {
                begun_at = Some(net.now);
            }
            if begun_at.is_some_and(|t| net.now >= t + DARK_MS + 500) {
                break;
            }
        }
        assert!(
            begun_at.is_some(),
            "seed {seed}/{before}: seat 1 never took match 2's B"
        );
        assert!(
            net.shrines[1].begin_asks > asks,
            "seed {seed}/{before}: seat 1 never asked for match 2's B: no rematch J"
        );
        checked += 1;
    }
    eprintln!("{checked} of 40 rematches checked");
    assert!(checked >= 30, "only {checked} of 40 rematches were checked");
}

/// The seatless probe (#174) goes dark at exactly `DARK_MS` after its first unanswered `J`, and
/// not before: the same 3 s rule `dark_detect.rs` pins for a seated shrine. Lead gate,
/// 2026-09-27: a probe firing at `DARK_MS / 3` passed every other test.
#[test]
fn the_seatless_probe_goes_dark_at_dark_ms_and_not_before() {
    let mut net = Net::new(3, 0.0, 0.0);
    net.detect_dark = true;
    net.seatless_discovers = true;
    while net.shrines[0].follower.records().len() < 20 && net.over.is_empty() {
        net.step();
    }
    assert!(net.over.is_empty(), "over before the arena died");
    net.arena_up = false;
    net.reboot(1, true);
    let mut checked = 0;
    for _ in 0..2_000 {
        net.step();
        let s = &net.shrines[1];
        if s.seat().is_some() {
            break; // the interim answered with B: the probe's job is done
        }
        if let Some(t) = s.dark.asked_begin {
            let waited = net.now.saturating_sub(t);
            assert_eq!(
                s.dark.on,
                waited >= DARK_MS,
                "seatless shrine: dark {} after {waited} ms without an answer to its J",
                s.dark.on
            );
            checked += 1;
            if s.dark.on {
                break;
            }
        }
    }
    assert!(
        net.shrines[1].dark.on || net.shrines[1].seat().is_some(),
        "the probe fired"
    );
    assert!(checked >= 100, "only {checked} steps observed the stamp");
}
