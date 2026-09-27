//! The arena's last commit reaches seat 1 and not seat 0, and then the arena dies (#98, the
//! sub-class found after #160: 19 of the 20 DESYNCs left at loss 0.2). Seat 0's shrine becomes
//! the interim holding one record fewer than seat 1. Before the fix it arbitrated that mseq itself,
//! seat 1 held another record there, and seat 1 halted on the interim's next commit: the two
//! shrines forked in the dark window, which no revived arena can mend.
mod harness;
use harness::*;
use tapstone_proto::frame::{Frame, result_reason};

const SEEDS: u64 = 40;

struct Ahead {
    net: Net,
    /// The mseq of the commit only seat 1 heard.
    at: usize,
    /// That commit's record, as the arena journaled it.
    arenas: [u8; 24],
}

/// Into the match, then one step whose arena commit reaches seat 1 alone before the arena dies.
/// Dark for 50 steps, revived from the journal, played out. `None` when the match ended first.
fn ahead_run(seed: u64, syncs: bool) -> Option<Ahead> {
    let mut net = Net::new(seed, 0.0, 0.0);
    net.interim_syncs = syncs;
    while net.shrines[0].follower.records().len() < 20 && net.over.is_empty() {
        net.step();
    }
    for _ in 0..200 {
        if !net.over.is_empty() {
            return None;
        }
        let held = net.shrines.iter().map(|s| s.follower.records().len()).max();
        // Only what was on the wire when the step began is delivered: a commit the arena sends in
        // answer to a tap stays queued.
        net.step_dropping(&[]);
        if net.journaled() > held.unwrap_or(0) {
            let commits: Vec<Vec<u8>> = net
                .wire
                .iter()
                .filter(|(from, _, b)| {
                    *from == ARENA && matches!(Frame::decode(b), Some((_, Frame::Commit(_))))
                })
                .map(|(_, _, b)| b.clone())
                .collect();
            for b in &commits {
                net.deliver(1, b);
            }
            let at = net.journaled() - 1;
            let arenas = net.journal_record(at);
            let [s0, s1] = [0, 1].map(|i| net.shrines[i].follower.records().len());
            net.go_dark();
            if s1 <= s0 {
                return None;
            }
            for _ in 0..50 {
                net.step();
            }
            net.revive();
            net.run(40_000);
            return Some(Ahead { net, at, arenas });
        }
        net.drain();
    }
    None
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

/// Seat 1 one commit ahead of the interim, on a lossless mesh: every match converges, and the
/// record at that mseq is the arena's, which seat 1 held (the interim adopted it before
/// arbitrating), not one the interim arbitrated in its place.
#[test]
fn an_interim_behind_seat_1_adopts_its_records_before_arbitrating() {
    let (mut ahead, mut failed) = (0, Vec::new());
    for seed in 1..=SEEDS {
        let Some(run) = ahead_run(seed, true) else {
            continue;
        };
        ahead += 1;
        let kept = run.net.shrines[0]
            .follower
            .records()
            .get(run.at)
            .is_some_and(|r| r[..24] == run.arenas[..]);
        if !converged(&run.net) || !kept {
            let reasons: Vec<u8> = run.net.over.iter().map(|o| o.result.reason).collect();
            failed.push(format!("seed {seed} {reasons:?} kept={kept}"));
        }
    }
    // The floor, counted from the condition itself: seat 1 held more records at go_dark.
    assert!(ahead >= 30, "only {ahead} of {SEEDS} runs had seat 1 ahead");
    // The control: the same runs with an interim that arbitrates at once still fork.
    let forked = (1..=SEEDS)
        .filter_map(|seed| ahead_run(seed, false))
        .filter(|run| !converged(&run.net))
        .count();
    assert!(
        forked >= 20,
        "only {forked} runs forked with the catch-up off: the scenario no longer reproduces #98"
    );
    assert!(
        failed.is_empty(),
        "{} of {ahead} runs with seat 1 ahead failed: {failed:?}",
        failed.len()
    );
}
