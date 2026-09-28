//! The arena journals a commit and dies before any shrine hears it (#98, the sub-class Oracle found
//! after #97 + #99 + #100). The interim then arbitrates that mseq itself, so the revived arena's
//! journaled head is a record no shrine ever held: the "last agreed hash" it asks the hand-back
//! from was never agreed. Before the fix every such run ended DESYNC, voiding a match both shrines
//! agree on.
mod harness;
use harness::*;
use tapstone_arena::core::JournalOp;
use tapstone_arena::core::{HANDBACK_NAK_MS, HEAD_MS};
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

/// #167: the arena's unsent commit, and the interim arbitrates exactly one record of its own at
/// that mseq before the arena revives. The interim then holds as many records as the journal, so
/// its answer to the revived arena's `J` is an empty tail: a hand-back that verifies nothing, least
/// of all the arena's head. With `seat1_missed`, seat 1 never heard the interim's record, so the
/// only record it could take at that mseq is one the arena sends it.
struct Short {
    net: Net,
    at: usize,
    /// The interim held its own record at `at`, and nothing past it, when the arena revived.
    one_own: bool,
}

fn short_run(seed: u64, seat1_missed: bool) -> Option<Short> {
    let mut net = Net::new(seed, 0.0, 0.0);
    while net.shrines[0].follower.records().len() < 20 && net.over.is_empty() {
        net.step();
    }
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
    // Dark only until the interim has committed one record of its own: it waits out its catch-up
    // from seat 1 (`SYNC_BOUND_MS`) first when seat 1 cannot hear it.
    let mut steps = 0;
    while net.shrines[0].follower.records().len() <= at {
        if steps == 1_000 || !net.over.is_empty() {
            return None;
        }
        net.deaf[1] = seat1_missed;
        net.step();
        steps += 1;
    }
    net.deaf[1] = false;
    let held = net.shrines[0].follower.records();
    let one_own = held.len() == at + 1
        && held[at][..24] != journaled[..]
        && (!seat1_missed || net.shrines[1].follower.records().len() == at);
    net.revive();
    if seat1_missed {
        // The interim hears nothing from the revived arena for longer than a head re-broadcast
        // period (its `J` lost, as seed 1660 of #167's sweep): the re-broadcast is then the first
        // arena frame on the air, and seat 1 hears it.
        for _ in 0..(HEAD_MS / 10 + 20) {
            net.step_dropping(&[NODES[0]]);
        }
    }
    net.run(40_000);
    Some(Short { net, at, one_own })
}

fn check_short(seat1_missed: bool) {
    let (mut shaped, mut failed) = (0, Vec::new());
    for seed in 1..=SEEDS {
        let Some(run) = short_run(seed, seat1_missed) else {
            continue;
        };
        if !run.one_own {
            continue;
        }
        shaped += 1;
        let interims = run.net.shrines[0].follower.records()[run.at][..24].to_vec();
        if !converged(&run.net) || run.net.journal_record(run.at)[..] != interims[..] {
            let reasons: Vec<u8> = run.net.over.iter().map(|o| o.result.reason).collect();
            failed.push(format!("seed {seed} {reasons:?}"));
        }
    }
    // The floor, counted from the condition itself: the interim held one record of its own at the
    // unsent mseq and nothing past it.
    assert!(shaped >= 30, "only {shaped} of {SEEDS} runs had the shape");
    assert!(
        failed.is_empty(),
        "{} of {shaped} runs did not converge on the interim's record: {failed:?}",
        failed.len()
    );
}

/// #167: an empty hand-back is no evidence the arena's head was agreed. Before the fix round one
/// completed on it, and the interim's ACK at that mseq ended the match DESYNC.
#[test]
fn an_empty_hand_back_does_not_agree_an_unsent_head() {
    check_short(false);
}

/// #167: ...and seat 1, which missed the interim's record, must not be sent the arena's unagreed
/// one. Before the fix the head re-broadcast (#98(a)) went to both shrines: seat 1 took the
/// arena's record, the interim's ACK rewound it, and seat 1 was forked for good.
#[test]
fn an_unagreed_head_reaches_no_shrine_but_the_interim() {
    check_short(true);
}

/// #167: an empty tail on a head the interim agrees (it committed nothing while the arena was
/// dark) is taken as soon as its ACK agrees the head: the arena asks again at the next tick, not a
/// whole `HANDBACK_NAK_MS` after its last `J`. Measured from the revival to round one verified.
#[test]
fn an_agreed_empty_tail_is_taken_within_one_nak_period() {
    let (mut shaped, mut slow) = (0, Vec::new());
    for seed in 1..=SEEDS {
        let mut net = Net::new(seed, 0.0, 0.0);
        while net.shrines[0].follower.records().len() < 20 && net.over.is_empty() {
            net.step();
        }
        net.go_dark();
        let held = net.shrines[0].follower.records().len();
        if held != net.journaled() {
            continue;
        }
        shaped += 1;
        net.revive();
        let t0 = net.now;
        let verified = |net: &Net| {
            net.logs
                .iter()
                .find(|(_, l)| l.starts_with("hand-back verified"))
                .map(|&(t, _)| t - t0)
        };
        while verified(&net).is_none() && net.now - t0 < 10 * HANDBACK_NAK_MS {
            net.step();
        }
        match verified(&net) {
            Some(ms) if ms < HANDBACK_NAK_MS => {}
            ms => slow.push(format!("seed {seed} {ms:?} ms")),
        }
    }
    // The floor, counted from the condition itself: the interim held exactly the journal.
    assert!(shaped >= 30, "only {shaped} of {SEEDS} runs had the shape");
    assert!(
        slow.is_empty(),
        "{} of {shaped} runs took {HANDBACK_NAK_MS} ms or more to verify round one: {slow:?}",
        slow.len()
    );
}
