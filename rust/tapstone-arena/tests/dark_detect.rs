//! Arena-dark DETECTION (lead ruling 2026-09-27, arena spec §7 step 1): a shrine in a match that
//! hears nothing from the arena for `DARK_MS` (3 s, three missed head re-broadcasts) goes dark by
//! itself, and seat 0's shrine takes the interim role. The rest of the dark suite declares the
//! window god's-eye (`go_dark`); these tests use the shrines' own detector.
mod harness;
use harness::*;
use tapstone_proto::shrine::DARK_MS;
use tapstone_sim::replay;

/// A match in play with the arena silently dead: nothing reaches it, nothing leaves it, and no
/// one is told.
fn silent_arena(seed: u64, into: usize) -> Net {
    let mut net = Net::new(seed, 0.0, 0.0);
    net.detect_dark = true;
    while net.shrines[0].follower.records().len() < into && net.over.is_empty() {
        net.step();
    }
    assert!(
        net.over.is_empty(),
        "seed {seed}: over before the arena died"
    );
    net.arena_up = false;
    net
}

#[test]
fn dark_is_detected_at_3_s_of_silence_and_not_before() {
    let mut net = silent_arena(3, 20);
    let heard = [0, 1].map(|i| net.shrines[i].dark.last_arena.expect("heard the arena"));
    for _ in 0..1_000 {
        net.step();
        for (i, &t) in heard.iter().enumerate() {
            let quiet = net.now.saturating_sub(t);
            let on = net.shrines[i].dark.on;
            assert_eq!(
                on,
                quiet >= DARK_MS,
                "shrine {i}: dark {on} after {quiet} ms of silence"
            );
        }
        if net.now >= heard[0].max(heard[1]) + DARK_MS + 100 {
            break;
        }
    }
    assert!(
        net.shrines.iter().all(|s| s.dark.on),
        "both shrines went dark"
    );
    assert_eq!(DARK_MS, 3_000);
}

#[test]
fn a_detected_dark_window_is_carried_by_the_interim_and_handed_back() {
    for seed in [1u64, 4, 9] {
        let mut net = silent_arena(seed, 20);
        let before = net.shrines[0].follower.records().len();
        // Past the 3 s detection, then a while of interim play.
        for _ in 0..(DARK_MS / 10 + 300) {
            net.step();
        }
        let during = net.shrines[0].follower.records().len();
        assert!(
            net.shrines.iter().all(|s| s.dark.on),
            "seed {seed}: dark detected"
        );
        assert!(
            during > before,
            "seed {seed}: the interim committed nothing"
        );
        net.revive();
        assert!(net.run(40_000), "seed {seed}: no result after revival");
        assert!(
            net.shrines.iter().all(|s| !s.dark.on),
            "seed {seed}: dark ended at handover"
        );
        let over = net.over.last().unwrap();
        assert!(
            replay(&over.json).unwrap().matches(&over.json),
            "seed {seed}"
        );
        for s in &net.shrines {
            assert_eq!(
                s.follower.head_hash(),
                over.result.chain,
                "seed {seed} node {}",
                s.node
            );
        }
        assert!(net.lseqs_committed_twice().is_empty(), "seed {seed}");
    }
}

/// The control: with detection off and no one declaring dark, a silent arena stalls the match.
#[test]
fn control_without_detection_a_silent_arena_stalls_the_match() {
    let mut net = silent_arena(4, 20);
    net.detect_dark = false;
    let before = net.shrines[0].follower.records().len();
    for _ in 0..(DARK_MS / 10 + 300) {
        net.step();
    }
    assert!(net.shrines.iter().all(|s| !s.dark.on));
    assert_eq!(
        net.shrines[0].follower.records().len(),
        before,
        "nothing commits without an arbiter"
    );
}
