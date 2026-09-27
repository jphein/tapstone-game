//! The arena journals a commit and dies before any shrine hears it (#98, the sub-class Oracle found
//! after #97 + #99 + #100). The interim then arbitrates that mseq itself, so the revived arena's
//! journaled head is a record no shrine ever held: the "last agreed hash" it asks the hand-back
//! from was never agreed. Before the fix every such run ended DESYNC, voiding a match both shrines
//! agree on.
mod harness;
use harness::*;
use tapstone_arena::core::JournalOp;
use tapstone_proto::frame::result_reason;

const SEEDS: u64 = 40;

struct Unsent {
    net: Net,
    /// The mseq of the commit the arena journaled and never sent.
    at: usize,
    /// The interim committed a different record at the mseq of the arena's unsent commit.
    forked: bool,
}

/// Into the match, then one step whose arena commit stays on the wire, lost with it when the arena
/// dies (`go_dark` clears the wire). Dark for 50 steps, revived from the journal, played out.
/// With `restart`, the revived arena dies right after it journals that mseq again, and a third
/// process recovers from the journal holding both records there.
fn unsent_run(seed: u64, loss: f64, dup: f64, restart: bool) -> Option<Unsent> {
    let mut net = Net::new(seed, loss, dup);
    while net.shrines[0].follower.records().len() < 20 && net.over.is_empty() {
        net.step();
    }
    // `step_dropping(&[])` delivers only what was on the wire when it began; a commit the arena
    // sends in answer to a tap stays queued, so it dies with the arena.
    let mut tries = 0;
    loop {
        if !net.over.is_empty() || tries == 200 {
            return None;
        }
        let held = net.shrines.iter().map(|s| s.follower.records().len()).max();
        net.step_dropping(&[]);
        if net.journaled() > held.unwrap_or(0) {
            break;
        }
        net.drain();
        tries += 1;
    }
    let at = net.journaled() - 1;
    let journaled = net.journal_record(at);
    net.go_dark();
    for _ in 0..50 {
        net.step();
    }
    let forked = net.shrines[0]
        .follower
        .records()
        .get(at)
        .is_some_and(|r| r[..24] != journaled[..]);
    net.revive();
    if restart && forked {
        let first = net.journal.len();
        let mut steps = 0;
        while net.journal.len() == first || !rewritten(&net, first, at) {
            assert!(
                steps < 20_000,
                "seed {seed}: the revived arena never journaled mseq {at}"
            );
            net.step();
            steps += 1;
        }
        // The arena dies right after that write: the journal ends there, and nothing it said after
        // (on the wire, or a result) survives it.
        let cut = first
            + net.journal[first..]
                .iter()
                .position(|j| is_record_at(j, at))
                .expect("rewritten");
        net.journal.truncate(cut + 1);
        net.over.clear();
        net.go_dark();
        net.revive();
    }
    net.run(40_000);
    Some(Unsent { net, at, forked })
}

fn is_record_at(j: &JournalOp, mseq: usize) -> bool {
    matches!(j, JournalOp::Record { record, .. } if u16::from_le_bytes([record[0], record[1]]) as usize == mseq)
}

/// The arena journaled a record at `mseq` again since the journal held `from` ops.
fn rewritten(net: &Net, from: usize, mseq: usize) -> bool {
    net.journal[from..].iter().any(|j| is_record_at(j, mseq))
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

fn check(restart: bool) {
    let (mut forked, mut failed) = (0, Vec::new());
    for seed in 1..=SEEDS {
        let Some(run) = unsent_run(seed, 0.0, 0.0, restart) else {
            continue;
        };
        if !run.forked {
            continue;
        }
        forked += 1;
        let interims = run.net.shrines[0].follower.records()[run.at][..24].to_vec();
        if !converged(&run.net) || run.net.journal_record(run.at)[..] != interims[..] {
            let reasons: Vec<u8> = run.net.over.iter().map(|o| o.result.reason).collect();
            failed.push(format!("seed {seed} {reasons:?}"));
        }
    }
    // The floor, counted from the condition itself: the interim's record at the unsent mseq.
    assert!(forked >= 30, "only {forked} of {SEEDS} runs forked");
    assert!(
        failed.is_empty(),
        "{} of {forked} forked runs did not converge on the interim's record: {failed:?}",
        failed.len()
    );
}

/// The arena's unsent commit, forked by the interim, on a lossless mesh: every match converges
/// on the shrines' history, and the arena's journaled record at that mseq ends as the interim's.
#[test]
fn a_journaled_commit_no_shrine_heard_is_replaced_by_the_interims() {
    check(false);
}

/// ...and a journal holding both records at that mseq recovers the later one: an arena that dies
/// again right after the rewind resumes on the shrines' history, not its own dropped commit.
#[test]
fn a_rewound_journal_recovers_the_interims_record() {
    check(true);
}
