//! #91: a seat whose `B` was dropped across a dark window. Seat 0's shrine is the would-be interim
//! (0029), but without `B` it holds no game: it cannot arbitrate, and what it addresses to the
//! arena is its `J` for the missing `B`, not a tap. Nobody arbitrates, the match waits (0028: "the
//! arena is dark, the match waits"), and it resumes when the arena revives. Before the fix the
//! harness treated every frame shrine 0 addressed to the dark arena as its own tap and panicked on
//! the `J` (`unreachable!()` in `tap_record_of`).
mod harness;
use harness::*;
use tapstone_arena::link::desk::encode;
use tapstone_proto::frame::{Frame, Nak, result_reason};

const SEEDS: u64 = 20;
/// 3 s dark: long past the arena's own retransmit and the shrine's `J` cadence.
const DARK_STEPS: usize = 300;

struct Run {
    net: Net,
    /// Records the arena had journaled when it went dark.
    journaled_at_dark: usize,
    /// Commits anyone had sent (the harness's own record) when it went dark, and at the revival.
    committed_at_dark: usize,
    committed_at_revive: usize,
}

/// Seat `who` hears no `B` until after the revival. The match reaches genesis, the arena goes dark
/// for `DARK_STEPS`, then `B` is let through again, the arena revives from its journal and the
/// match plays out. A lossless mesh.
fn run(seed: u64, who: usize) -> Run {
    run_on(seed, who, 0.0, 0.0)
}

/// As `run`, on a mesh that loses and duplicates frames. At loss 0 the dark window plays out the
/// same way for every seed (Oracle on #96: identical counters on all 20 seeds), so 20 lossless seeds are one case;
/// the mesh's own seeded loss is what varies it.
fn run_on(seed: u64, who: usize, loss: f64, dup: f64) -> Run {
    let mut net = Net::new(seed, loss, dup);
    net.drop_begin[who] = u32::MAX;
    for _ in 0..5_000 {
        if net.core.genesis().is_some() {
            break;
        }
        net.step();
    }
    assert!(
        net.core.genesis().is_some(),
        "seed {seed}/{who}: no genesis"
    );
    assert!(
        net.shrines[who].begin.is_none(),
        "seed {seed}/{who}: took a B it should not have heard"
    );
    net.go_dark();
    let journaled_at_dark = net.journaled();
    let committed_at_dark = net.committed.len();
    for _ in 0..DARK_STEPS {
        net.step();
    }
    let committed_at_revive = net.committed.len();
    net.drop_begin[who] = 0;
    net.revive();
    net.run(40_000);
    Run {
        net,
        journaled_at_dark,
        committed_at_dark,
        committed_at_revive,
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

/// Seat 0 lost its `B`: no panic, nothing is committed while the harness dark flag is set before
/// the revival (`go_dark` → `revive`; the flag itself lasts to the first revived-arena commit), the
/// match moves again after
/// it, seat 0 gets its `B`, and no tap is committed twice. Convergence is a later test's.
#[test]
fn a_gameless_would_be_interim_arbitrates_nothing_and_the_match_waits_for_the_arena() {
    let mut gameless = 0;
    for seed in 1..=SEEDS {
        let r = run(seed, 0);
        // The case itself, counted where the routing decides: shrine 0 sent the arena something
        // that was not a tap while the harness dark flag was set (`go_dark` → first revived-arena
        // commit). Each one is a frame the old routing fed to
        // `unreachable!()`, so this also proves every seed met the defect.
        assert!(
            r.net.dark_to_arena > 0,
            "seed {seed}: shrine 0 never addressed the dark arena without a game"
        );
        gameless += usize::from(r.net.gameless_taps > 0);
        assert_eq!(
            r.committed_at_revive, r.committed_at_dark,
            "seed {seed}: something was committed between going dark and the revival"
        );
        assert_eq!(
            r.net.interim_rejects, 0,
            "seed {seed}: a gameless interim refused a tap it could not arbitrate"
        );
        assert_eq!(
            r.net.interim_lseq, [0; 2],
            "seed {seed}: the interim arbitrated"
        );
        assert!(
            r.net.journaled() > r.journaled_at_dark,
            "seed {seed}: the match never moved after the revival"
        );
        assert!(
            r.net.begins_heard[0] > 0,
            "seed {seed}: seat 0 never got its B"
        );
        let twice = r.net.lseqs_committed_twice();
        assert!(twice.is_empty(), "seed {seed}: committed twice: {twice:?}");
    }
    // Seat 1's taps reach the gameless interim only when seat 1 has something to tap while dark:
    // count the seeds that exercised that half, so the "nothing committed" clause cannot pass by
    // never meeting a tap.
    assert!(
        gameless >= (SEEDS / 2) as usize,
        "only {gameless} of {SEEDS} seeds sent a tap to the gameless interim"
    );
}

/// The second seat to re-sync while the would-be interim has no `B`: seat 1 reboots with nothing
/// kept (the JOIN path), so its `J` reaches a gameless interim, which has nothing to answer from.
/// A gap `N` is checked too, hand-delivered: no shrine sends one here, since a shrine NAKs only a
/// gap it heard and nobody commits while dark with a gameless interim. Nothing answers either until
/// the arena revives.
#[test]
fn a_gameless_would_be_interim_answers_no_rejoining_seat() {
    for seed in 1..=SEEDS {
        let mut net = Net::new(seed, 0.0, 0.0);
        net.drop_begin[0] = u32::MAX;
        while net.core.genesis().is_none() {
            net.step();
        }
        let id = net.core.match_id().expect("the match started");
        net.go_dark();
        net.reboot(1, true);
        for _ in 0..DARK_STEPS {
            net.step();
        }
        // The J half's own assert (Oracle on #96: it was enforced only by the harness's expect()).
        assert_eq!(
            net.interim_replies, 0,
            "seed {seed}: a gameless interim answered seat 1's J"
        );
        // The case, counted where the interim hears it: seat 1's own J reached the gameless interim.
        let asks = net.gameless_asks;
        assert!(
            asks > 0,
            "seed {seed}: seat 1 never asked the gameless interim"
        );
        assert!(
            net.shrines[1].begin.is_none(),
            "seed {seed}: seat 1 took a B while dark"
        );
        let nak = Frame::Nak(Nak {
            from: 0,
            to: 0xFFFF,
        });
        net.deliver(0, &encode(NODES[1], id, &nak));
        assert_eq!(
            net.gameless_asks,
            asks + 1,
            "seed {seed}: the N never reached the interim"
        );
        net.drain();
        assert_eq!(
            net.interim_replies, 0,
            "seed {seed}: a gameless interim answered"
        );
    }
}

/// ...and after the revival the match converges, 20/20. The revived arena drops taps until its
/// hand-back completes: before that (#95) it committed them on top of its journaled prefix, and the
/// late hand-back voided the match as a false DESYNC.
#[test]
fn a_gameless_would_be_interim_converges_after_the_revival() {
    for seed in 1..=SEEDS {
        let r = run(seed, 0);
        let reasons: Vec<u8> = r.net.over.iter().map(|o| o.result.reason).collect();
        assert!(
            converged(&r.net),
            "seed {seed}: did not converge (result reasons {reasons:?}; DESYNC is {})",
            result_reason::DESYNC
        );
    }
}

/// The other seat: seat 1 lost its `B`. The interim holds a game, so it arbitrates and answers seat
/// 1's `J` (its rebuilt `B` is dropped too); seat 1 catches up after the revival and the match
/// converges with no tap committed twice.
#[test]
fn seat_1_without_its_begin_across_a_dark_window_converges_after_the_revival() {
    for seed in 1..=SEEDS {
        let r = run(seed, 1);
        assert_eq!(
            r.net.dark_to_arena, 0,
            "seed {seed}: the interim had a game"
        );
        assert_eq!(
            r.net.gameless_taps, 0,
            "seed {seed}: the interim had a game"
        );
        assert!(
            r.net.interim_replies > 0,
            "seed {seed}: seat 1 never asked the interim"
        );
        assert!(
            r.net.begins_heard[1] > 0,
            "seed {seed}: seat 1 never got its B"
        );
        assert!(converged(&r.net), "seed {seed}: did not converge");
        let twice = r.net.lseqs_committed_twice();
        assert!(twice.is_empty(), "seed {seed}: committed twice: {twice:?}");
    }
}

/// The meshes the lossy runs use: loss only, duplication only, both (core_loss's rates).
const MESHES: [(f64, f64); 3] = [(0.10, 0.0), (0.0, 0.10), (0.10, 0.05)];

/// Every lossy run: each mesh, each seat without its `B`, 20 seeds.
fn lossy_runs() -> Vec<(String, Run)> {
    let mut v = Vec::new();
    for (loss, dup) in MESHES {
        for who in 0..2 {
            for seed in 1..=SEEDS {
                v.push((
                    format!("loss {loss} dup {dup} seat {who} seed {seed}"),
                    run_on(seed, who, loss, dup),
                ));
            }
        }
    }
    v
}

/// On lossy and duplicating meshes, with either seat's `B` dropped across the dark window, the
/// match converges after the revival and no tap is committed twice.
/// #98: before its (a) fix (the head re-broadcast while resuming) and its (b)/(c) fix (the handover
/// in two rounds), 12 of these 120 runs failed, identically with #95's tap drop disabled.
#[test]
fn under_loss_and_duplication_the_match_converges_after_the_revival() {
    let runs = lossy_runs();
    let mut windows = std::collections::BTreeSet::new();
    for (name, r) in &runs {
        let reasons: Vec<u8> = r.net.over.iter().map(|o| o.result.reason).collect();
        assert!(
            converged(&r.net),
            "{name}: did not converge (result reasons {reasons:?})"
        );
        let twice = r.net.lseqs_committed_twice();
        assert!(twice.is_empty(), "{name}: committed twice: {twice:?}");
        windows.insert((r.net.resuming_frames, r.net.journaled()));
    }
    // The point of the lossy runs is that they differ: count the distinct (frames the arena
    // processed while resuming, records journaled) pairs, so 120 runs cannot be one case again.
    eprintln!("distinct windows: {} of {}", windows.len(), runs.len());
    assert!(
        windows.len() >= runs.len() / 2,
        "only {} distinct runs of {}",
        windows.len(),
        runs.len()
    );
}

/// #95's invariant, pinned: a resuming arena's log does not change across any frame that leaves
/// it resuming, measured on every frame the arena processed, over the lossless and lossy runs.
#[test]
fn a_resuming_arena_commits_nothing() {
    let mut runs: Vec<(String, Run)> = (0..2)
        .flat_map(|who| {
            (1..=SEEDS)
                .map(move |seed| (format!("lossless seat {who} seed {seed}"), run(seed, who)))
        })
        .collect();
    runs.extend(lossy_runs());
    let (mut frames, mut taps) = (0u64, 0u64);
    for (name, r) in &runs {
        assert_eq!(
            r.net.resuming_log_changes, 0,
            "{name}: the log changed while resuming"
        );
        frames += u64::from(r.net.resuming_frames);
        taps += u64::from(r.net.resuming_taps);
        // The instrument must see its subject. #95's case, a gameless seat 0 on a lossless mesh, sends
        // the resuming arena taps every time; counted at the arena (the harness's `run_core`), not
        // inferred from the scenario.
        if name.starts_with("lossless seat 0") {
            assert!(
                r.net.resuming_taps > 0,
                "{name}: no tap reached the resuming arena"
            );
        }
        // The tick path is measured too: every run's arena processed ticks while resuming.
        assert!(
            r.net.resuming_ticks > 0,
            "{name}: no tick measured while resuming"
        );
    }
    eprintln!(
        "resuming: {frames} frames, {taps} taps over {} runs",
        runs.len()
    );
}

/// #98(a): on every lossy run the revived arena finishes resuming. Without the head re-broadcast
/// while resuming, an interim that lost a replayed prefix commit could never hand back from `from`,
/// and the arena stayed resuming for the rest of the run (8 of the 120 runs). #98's (b) and (c)
/// happen after resumption, so they are not this test's.
#[test]
fn on_a_lossy_mesh_the_revived_arena_finishes_resuming() {
    for (name, r) in lossy_runs() {
        assert!(!r.net.core.resuming(), "{name}: still resuming at the end");
    }
}

use tapstone_arena::core::HANDOVER_BOUND_MS;

/// #98 b/c: the handover in two rounds. On every lossy run, the handover (first hand-back
/// verified → resumed) finished inside the arena's own `HANDOVER_BOUND_MS` (the longest measured,
/// 1010 ms over 660 runs, with 3× margin). Counted from the arena's `handover_ms`.
#[test]
fn every_lossy_handover_completes_inside_the_bound() {
    let mut seen = Vec::new();
    for (name, r) in lossy_runs() {
        if let Some(ms) = r.net.handover_ms_seen {
            seen.push((ms, name));
        }
    }
    seen.sort();
    eprintln!("handovers: {} runs, longest {:?}", seen.len(), seen.last());
    assert!(
        seen.len() >= 100,
        "only {} of 120 lossy runs recorded a handover",
        seen.len()
    );
    let (longest, name) = seen.last().unwrap();
    assert!(
        *longest <= HANDOVER_BOUND_MS,
        "{name}: handover took {longest} ms"
    );
}

/// #98 b/c, what happens when the interim does not answer: the match waits (0028). The interim
/// goes silent the moment the first hand-back is verified (`handover_open`), for 30 s, far past
/// `HANDOVER_BOUND_MS`. The arena commits nothing and stays resuming the whole
/// time, never resuming on a log that may be incomplete; when the interim returns, the handover
/// completes and the match converges. Lossless, dark long enough that the interim committed taps.
#[test]
fn an_unreachable_interim_leaves_the_match_waiting_then_it_resumes() {
    let mut exercised = 0;
    for seed in 1..=SEEDS {
        let mut net = Net::new(seed, 0.0, 0.0);
        while net.shrines[0].follower.records().len() < 20 {
            net.step();
        }
        net.go_dark();
        for _ in 0..50 {
            net.step();
        }
        assert!(
            net.interim_lseq.iter().any(|&l| l > 0),
            "seed {seed}: the interim committed nothing"
        );
        net.revive();
        let mut steps = 0;
        while !net.core.handover_open() && net.over.is_empty() {
            net.step();
            steps += 1;
            assert!(
                steps < 1_000,
                "seed {seed}: the first hand-back never verified"
            );
            assert!(
                net.core.resuming() || !net.over.is_empty(),
                "seed {seed}: resumed without an open handover"
            );
        }
        // A game the interim finished while dark ends at the first hand-back: nothing to wait for.
        if !net.over.is_empty() {
            continue;
        }
        exercised += 1;
        let len = net.core_log_len();
        for _ in 0..3_000 {
            net.step_dropping_from(NODES[0]);
        }
        assert!(
            net.core.resuming(),
            "seed {seed}: resumed without the interim"
        );
        assert_eq!(
            net.core_log_len(),
            len,
            "seed {seed}: committed without the interim"
        );
        assert!(
            net.over.is_empty(),
            "seed {seed}: the match ended without the interim"
        );
        net.run(40_000);
        assert!(
            converged(&net),
            "seed {seed}: did not converge once the interim returned"
        );
        assert!(
            net.lseqs_committed_twice().is_empty(),
            "seed {seed}: committed twice"
        );
    }
    // Counted where the case is decided: seeds whose handover was open when the interim went away.
    eprintln!("unreachable interim: {exercised} of {SEEDS} seeds exercised");
    assert!(
        exercised >= (SEEDS / 2) as usize,
        "only {exercised} of {SEEDS} seeds had an open handover when the interim went away"
    );
}

/// #98 b/c, the interim dying mid-dark: seat 0 goes silent while the arena is still dark, stays
/// silent through the revival and 30 s after it, then returns. The revived arena never gets even its
/// first hand-back, so it commits nothing, stays resuming and produces no result the whole time
/// (the match waits, 0028); once the interim is back, the handover completes and the match
/// converges.
#[test]
fn an_interim_that_dies_mid_dark_leaves_the_match_waiting_then_it_resumes() {
    let mut exercised = 0;
    for seed in 1..=SEEDS {
        let mut net = Net::new(seed, 0.0, 0.0);
        while net.shrines[0].follower.records().len() < 20 {
            net.step();
        }
        net.go_dark();
        for _ in 0..20 {
            net.step();
        }
        if !net.over.is_empty()
            || net.shrines[0].follower.game.phase != tapstone_rules::Phase::Playing
        {
            continue; // the game ended while dark: nothing to wait for
        }
        for _ in 0..20 {
            net.step_dropping_from(NODES[0]); // dies mid-dark
        }
        net.revive();
        let len = net.core_log_len();
        for _ in 0..3_000 {
            net.step_dropping_from(NODES[0]);
        }
        exercised += 1;
        assert!(
            net.core.resuming(),
            "seed {seed}: resumed without the interim"
        );
        assert!(
            !net.core.handover_open(),
            "seed {seed}: a first hand-back without the interim"
        );
        assert_eq!(
            net.core_log_len(),
            len,
            "seed {seed}: committed without the interim"
        );
        assert!(
            net.over.is_empty(),
            "seed {seed}: the match ended without the interim"
        );
        net.run(40_000);
        assert!(
            converged(&net),
            "seed {seed}: did not converge once the interim returned"
        );
        assert!(
            net.lseqs_committed_twice().is_empty(),
            "seed {seed}: committed twice"
        );
    }
    eprintln!("interim dead mid-dark: {exercised} of {SEEDS} seeds exercised");
    assert!(
        exercised >= (SEEDS / 2) as usize,
        "only {exercised} of {SEEDS} seeds exercised"
    );
}

/// #98 b/c (Oracle on #100): no revived arena resumes without the interim's ACK of its head. The
/// ACK is observed on the wire by the harness, not read from the core's stages, and every run is
/// checked, lossless and lossy. Before the fix a late or duplicate round-one hand-back with an
/// empty tail completed "round two" and resumed with no ACK (80 of 660 runs in Oracle's probe).
#[test]
fn no_revived_arena_resumes_without_the_interims_ack() {
    let mut runs: Vec<(String, Run)> = (0..2)
        .flat_map(|who| {
            (1..=SEEDS)
                .map(move |seed| (format!("lossless seat {who} seed {seed}"), run(seed, who)))
        })
        .collect();
    runs.extend(lossy_runs());
    let mut acked = 0;
    for (name, r) in &runs {
        assert_eq!(
            r.net.no_ack_resumes, 0,
            "{name}: resumed without the interim's ACK"
        );
        acked += usize::from(r.net.interim_acked_head);
    }
    // The instrument saw its subject: runs where the ACK was observed during an open handover.
    eprintln!(
        "no-ACK check: {acked} of {} runs saw the interim ACK the head",
        runs.len()
    );
    assert!(
        acked >= runs.len() / 2,
        "only {acked} of {} runs saw the ACK",
        runs.len()
    );
}
