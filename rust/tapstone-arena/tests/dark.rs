mod harness;
use harness::*;
use tapstone_proto::frame::result_reason;
use tapstone_sim::replay;

/// Play into the match until seat 0's shrine holds `into` records, kill the arena, let seat 0's
/// shrine arbitrate for `dark_steps`, revive the arena from its journal, and play to the end.
/// (Counted in records, not steps: scripted duels end in 48-95 steps, so a fixed 150 steps was
/// past the result.)
fn dark_run(seed: u64, into: usize, dark_steps: usize, corrupt: bool) -> Net {
    let mut net = Net::new(seed, 0.0, 0.0);
    while net.shrines[0].follower.records().len() < into && net.over.is_empty() {
        net.step();
    }
    assert!(
        net.over.is_empty(),
        "seed {seed}: the duel ended before the arena went dark"
    );
    let before = net.shrines[0].follower.records().len();
    net.go_dark();
    for _ in 0..dark_steps {
        net.step();
    }
    let during = net.shrines[0].follower.records().len();
    assert!(
        during > before,
        "seed {seed}: nothing was committed while the arena was dark"
    );
    net.corrupt_handback = corrupt;
    net.revive();
    assert!(net.run(40_000), "seed {seed}: no result after revival");
    net
}

#[test]
fn a_revived_arena_takes_the_hand_back_and_finishes_the_match() {
    for seed in [1u64, 4, 9] {
        let net = dark_run(seed, 20, 10, false);
        let over = net.over.last().unwrap();
        assert!([result_reason::LETHAL, result_reason::STOP].contains(&over.result.reason));
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
        assert_eq!(
            over.json.records.len(),
            net.shrines[0].follower.records().len(),
            "the arena holds every record"
        );
    }
}

#[test]
fn a_corrupted_hand_back_halts_instead_of_being_believed() {
    let net = dark_run(4, 20, 10, true);
    assert_eq!(
        net.over.last().unwrap().result.reason,
        result_reason::DESYNC
    );
}

/// Ruled 2026-09-23: the hand-back carries each seat's last committed lseq, so a revived arena
/// dedupes a retransmitted tap the interim arbiter already committed. (Neither the journal nor
/// the handed-back records hold lseqs; without this a revived arena treats every lseq as new, and
/// a retransmitted Pass would pass twice.) The control: a fresh lseq still commits.
#[test]
fn a_revived_arena_does_not_recommit_a_tap_the_interim_committed() {
    use tapstone_proto::frame::{Frame, Tap};
    use tapstone_rules::Kind;
    // At the handover: the arena knows the dark gap only from the hand-back.
    let mut net = dark_run_until_handover(1);
    // The expected lseqs come from the harness's own record of what the interim committed while
    // dark, never from the follower under test (a follower that forgot them would agree with itself).
    let last = net.interim_lseq;
    assert!(
        last.iter().any(|&l| l > 0),
        "the interim committed taps while dark"
    );
    for s in (0..2usize).filter(|&s| last[s] > 0) {
        let pass = tapstone_sim::tap(s as u8, Kind::Pass, 0, -1, 0, 0);
        // The last tap the interim committed, and an OLDER one: the dedupe is `lseq <= last`
        // (lseq is monotonic per seat), not an equality with the last.
        let mut retransmits = vec![last[s]];
        if last[s] > 1 {
            retransmits.push(last[s] - 1);
        }
        for lseq in retransmits {
            let before = journaled(&net);
            let reply = net.inject(NODES[s], Frame::Tap(Tap::Propose { lseq, record: pass }));
            assert_eq!(
                journaled(&net),
                before,
                "seat {s}: lseq {lseq} was committed again"
            );
            // The dedupe answers, not the engine: the arena knows this lseq only from H, so it
            // cannot confirm the tap and refuses it as stale (the shrine then re-syncs). An engine
            // refusal would carry a rules code, never STALE_LSEQ.
            assert!(
                matches!(
                    reply,
                    Some(Frame::Tap(Tap::Reject { reason, .. }))
                        if reason == tapstone_proto::frame::arena_refusal::STALE_LSEQ
                ),
                "seat {s}: lseq {lseq} reached the engine ({reply:?}) instead of the dedupe"
            );
        }
        // Control: the same tap under a fresh lseq reaches the engine and gets an answer.
        let fresh = net.inject(
            NODES[s],
            Frame::Tap(Tap::Propose {
                lseq: last[s] + 100,
                record: pass,
            }),
        );
        assert!(
            matches!(
                fresh,
                Some(Frame::Commit(_) | Frame::Tap(Tap::Reject { .. }))
            ),
            "seat {s}: a fresh lseq must be answered, got {fresh:?}"
        );
    }
}

/// Into the match, dark for 10 steps, revived with both shrines quiet, and stepped until the
/// arena has resumed arbitrating.
fn dark_run_until_handover(seed: u64) -> Net {
    let mut net = Net::new(seed, 0.0, 0.0);
    while net.shrines[0].follower.records().len() < 20 {
        net.step();
    }
    net.go_dark();
    for _ in 0..10 {
        net.step();
    }
    // No taps from here to the handover: nothing for the revived arena to overhear, so every lseq
    // it knows about the dark gap came through the hand-back.
    net.manual = [true, true];
    net.revive();
    // The handover ends when the arena arbitrates again: since #98 b/c that is after its second
    // hand-back round, not at its first commit (which only ends the harness's dark routing).
    let mut steps = 0;
    while net.dark || net.core.resuming() {
        net.step();
        steps += 1;
        assert!(steps < 1_000, "no handover");
    }
    net.manual = [false, false];
    net
}

/// Committed records the arena has journaled (this task predates `ArenaCore::log_len`).
fn journaled(net: &Net) -> usize {
    net.journal
        .iter()
        .filter(|j| matches!(j, tapstone_arena::core::JournalOp::Record { .. }))
        .count()
}
