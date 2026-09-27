//! #76: a seat that reboots while the arena is dark rejoins through the interim arbiter (seat 0's
//! shrine, 0029). Its `J` is answered from the interim's own record list: `B` rebuilt from the
//! interim's state, then `H` chunks carrying each seat's last lseq. Before this, nothing answered
//! and the rebooted seat waited for the arena (protocol §4.5's deferral).
mod harness;
use harness::*;
use tapstone_proto::frame::{halt_reason, result_reason};

fn sorted(mut v: Vec<u16>) -> Vec<u16> {
    v.sort_unstable();
    v
}

struct Run {
    net: Net,
    /// Seat 1's last committed lseq before the reboot, from the harness's own record of what was
    /// committed (never from the follower under test).
    last_before: u16,
    /// Seat 1 had rejoined (applied up to the interim's head and stopped rejoining) while dark.
    rejoined_dark: bool,
    /// Seat 1's records the interim committed after the reboot, while dark: counted in the
    /// interim's own record list, not from lseqs (a restarted counter's lseq 1 must still count).
    committed_after: usize,
    /// The game ended during the dark window (read then, before the revival plays it out).
    ended_dark: bool,
}

/// Into the match, dark for `before` steps, seat 1 reboots with nothing kept (the JOIN path), up to
/// 3,000 steps for it to rejoin and tap while still dark, then the arena revives and the match
/// plays out. `before = 0` reboots the instant the arena goes dark, so the interim has committed
/// nothing for seat 1 and must dedupe from the lseqs it followed.
fn run(seed: u64, before: usize, set: impl FnOnce(&mut Net)) -> Run {
    let mut net = Net::new(seed, 0.0, 0.0);
    set(&mut net);
    while net.shrines[0].follower.records().len() < 20 && net.over.is_empty() {
        net.step();
    }
    assert!(
        net.over.is_empty(),
        "seed {seed}/{before}: over before the arena went dark"
    );
    net.go_dark();
    for _ in 0..before {
        net.step();
    }
    // The interim's own lseq ledger, as the arena would have had it.
    let last_before = net.interim_lseq[1].max(net.shrines[1].follower.last_lseq()[1]);
    net.reboot(1, true);
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
        if !s.rejoining && s.follower.halted().is_none() {
            rejoined_dark = true;
        }
        if seat1_since(&net) > 0
            || net.shrines[0].follower.game.phase != tapstone_rules::Phase::Playing
        {
            break;
        }
    }
    let committed_after = seat1_since(&net);
    let ended_dark = net.shrines[0].follower.game.phase != tapstone_rules::Phase::Playing;
    net.revive();
    net.run(40_000);
    Run {
        net,
        last_before,
        rejoined_dark,
        committed_after,
        ended_dark,
    }
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

/// The baseline, 20/20: the rebooted seat rejoins through the interim while the arena is dark,
/// commits new taps there above its old lseq, and the match converges after the arena returns.
#[test]
fn a_seat_rebooted_while_the_arena_is_dark_rejoins_through_the_interim() {
    let mut tapped = 0;
    for (seed, before) in (1..=20u64).flat_map(|s| [(s, 0), (s, 5)]) {
        let r = run(seed, before, |_| {});
        let s = &r.net.shrines[1];
        tapped += usize::from(!r.ended_dark);
        assert!(
            r.net.interim_replies > 0,
            "seed {seed}/{before}: the interim never answered"
        );
        assert!(
            r.rejoined_dark,
            "seed {seed}/{before}: never rejoined while dark"
        );
        assert!(
            r.committed_after > 0 || r.ended_dark,
            "seed {seed}/{before}: the rebooted seat committed nothing while dark"
        );
        let low: Vec<u16> = s
            .proposed
            .iter()
            .copied()
            .filter(|&l| l <= r.last_before)
            .collect();
        assert!(
            low.is_empty(),
            "seed {seed}/{before}: reused lseqs {low:?} (last before {})",
            r.last_before
        );
        assert!(converged(&r.net), "seed {seed}/{before}: did not converge");
        let twice = r.net.lseqs_committed_twice();
        assert!(
            twice.is_empty(),
            "seed {seed}/{before}: committed twice under one lseq: {twice:?}"
        );
    }
    // The "committed while dark" clause is excused when the game ended in the dark window; an
    // excuse that covered every case would make it blind (it once read the phase after revival).
    assert!(
        tapped >= 30,
        "only {tapped} of 40 cases reached a tap while dark"
    );
}

/// The rebuilt `B` the rebooted seat receives names both original lists and the interim's genesis:
/// compared with the lists the arena began from (the harness's own copy), for 20 seeds.
#[test]
fn the_rebuilt_begin_matches_the_arenas() {
    for (seed, before) in (1..=20u64).flat_map(|s| [(s, 0), (s, 5)]) {
        let r = run(seed, before, |_| {});
        let (_, got) = r.net.shrines[1].begin.expect("the rebooted seat took a B");
        let (_, want) = r.net.shrines[0].begin.expect("the interim's own B");
        for s in 0..2 {
            assert_eq!(
                sorted(got.deck(s).to_vec()),
                sorted(want.deck(s).to_vec()),
                "seed {seed}/{before} seat {s}"
            );
        }
        assert_eq!(got.genesis, want.genesis, "seed {seed}/{before}");
        assert_eq!(
            r.net.shrines[1].follower.genesis(),
            Some(want.genesis),
            "seed {seed}/{before}"
        );
    }
}

/// Control 1, the deferral: with the interim not answering, the rebooted seat never rejoins while
/// dark. The baseline differs from this only in `interim_answers`.
#[test]
fn without_the_interims_answer_the_rebooted_seat_waits() {
    for (seed, before) in (1..=20u64).flat_map(|s| [(s, 0), (s, 5)]) {
        let r = run(seed, before, |n| n.interim_answers = false);
        assert!(
            !r.rejoined_dark,
            "seed {seed}/{before}: rejoined with nobody answering"
        );
        assert_eq!(r.committed_after, 0, "seed {seed}/{before}");
    }
}

/// Control 2, the reconstruction: one card of the rebuilt `B` changed is caught at genesis.
#[test]
fn a_wrong_rebuilt_card_is_caught_at_genesis() {
    for (seed, before) in (1..=20u64).flat_map(|s| [(s, 0), (s, 5)]) {
        let r = run(seed, before, |n| n.corrupt_interim_begin = true);
        let x = r.net.shrines[1].follower.halted().expect("halted");
        assert_eq!(
            (x.at_mseq, x.reason),
            (1, halt_reason::HASH),
            "seed {seed}/{before}"
        );
        assert_eq!(r.committed_after, 0, "seed {seed}/{before}");
    }
}

/// Control 3, the resume point: without `H`'s per-seat last lseq, the rebooted counter restarts
/// below its old value and proposes lseqs it already used (the ruling's "never", broken). The
/// interim's dedupe, seeded from every lseq it followed, keeps any of them from committing twice;
/// the desk shrine re-proposes with a fresh lseq every 100 ms, so it climbs past and plays on. The
/// baseline differs from this only in the zeroed `last_lseq`, and proposes no used lseq at all.
#[test]
fn without_the_last_lseq_the_rebooted_seat_reuses_lseqs_and_the_dedupe_holds() {
    let mut checked = 0;
    for (seed, before) in (1..=20u64).flat_map(|s| [(s, 0), (s, 5)]) {
        let r = run(seed, before, |n| n.zero_interim_lseq = true);
        let twice = r.net.lseqs_committed_twice();
        assert!(
            twice.is_empty(),
            "seed {seed}/{before}: committed twice under one lseq: {twice:?}"
        );
        if r.ended_dark {
            continue; // the game ended during the dark window: the seat never tapped
        }
        let low = r.net.shrines[1]
            .proposed
            .iter()
            .filter(|&&l| l <= r.last_before)
            .count();
        assert!(
            low > 0,
            "seed {seed}/{before}: never proposed a used lseq: the control cannot see"
        );
        checked += 1;
    }
    // The skip above once read the phase after the revival, when every match is over, and so
    // skipped all 40 cases: the control passed while checking nothing.
    assert!(checked >= 30, "only {checked} of 40 cases were checked");
}
