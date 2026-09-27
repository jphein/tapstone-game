//! A shrine that reboots mid-match (ruled 2026-09-23, "resume from resync"): its lseq counter is
//! lost, so the arena must never confirm a new tap with an old commit that happens to share its
//! lseq, and the shrine must resume above its seat's last committed lseq before it proposes.
mod harness;
use harness::*;
use tapstone_proto::frame::{Frame, Tap, arena_refusal};
use tapstone_rules::{Kind, Record};

fn draw(seat: usize, card: u16, uid: [u8; 7]) -> Record {
    let mut r = tapstone_sim::tap(seat as u8, Kind::Draw, card, -1, 0, 0);
    r.uid = uid;
    r
}

fn propose(net: &mut Net, seat: usize, lseq: u16, record: Record) -> Option<Frame> {
    let reply = net.inject(NODES[seat], Frame::Tap(Tap::Propose { lseq, record }));
    net.drain();
    reply
}

fn top(net: &Net, seat: usize) -> u16 {
    net.shrines[seat]
        .follower
        .game
        .top_of_list(seat as u8)
        .expect("an undrawn copy")
}

/// Oracle's finding on #74: on a dedupe hit the arena re-sent the old commit with that lseq, and a
/// rebooted shrine took it as the confirmation of its new tap. The tap was lost silently. A
/// retransmit of the same tap is confirmed; a different tap under a used lseq is refused.
#[test]
fn a_used_lseq_confirms_only_the_tap_it_committed() {
    let mut net = Net::new(1, 0.0, 0.0);
    net.step_until_seat_owes_draws(0);
    let card = top(&net, 0);
    let first = draw(0, card, [4, 9, 9, 9, 9, 9, 1]);
    let Some(Frame::Commit(c)) = propose(&mut net, 0, 900, first) else {
        panic!("the first tap under lseq 900 commits");
    };
    // The same tap again (its C was lost): the same commit comes back.
    match propose(&mut net, 0, 900, first) {
        Some(Frame::Commit(again)) => assert_eq!(again.mseq, c.mseq, "the old commit, re-sent"),
        other => panic!("a true retransmit must be re-confirmed, got {other:?}"),
    }
    // A different tap under the same lseq (a rebooted counter): refused, never confirmed.
    net.step_until_seat_owes_draws(0);
    let other = draw(0, top(&net, 0), [4, 9, 9, 9, 9, 9, 2]);
    let before = net.journaled();
    match propose(&mut net, 0, 900, other) {
        Some(Frame::Tap(Tap::Reject { reason, .. })) => {
            assert_eq!(reason, arena_refusal::STALE_LSEQ)
        }
        other => panic!("a different tap under a used lseq was not refused: {other:?}"),
    }
    assert_eq!(net.journaled(), before, "and not committed");
}

/// Twenty records into the match, shrine `seed % 2` reboots (a fresh follower, lseq 0), then
/// the match plays to its end.
fn reboot_run(seed: u64, via_join: bool, resume: bool) -> (Net, usize) {
    let mut net = Net::new(seed, 0.0, 0.0);
    net.resume_from_resync = resume;
    while net.shrines[0].follower.records().len() < 20 && net.over.is_empty() {
        net.step();
    }
    assert!(
        net.over.is_empty(),
        "seed {seed}: the duel ended before the reboot"
    );
    let who = (seed % 2) as usize;
    net.reboot(who, via_join);
    assert!(net.run(20_000), "seed {seed}: no result after the reboot");
    (net, who)
}

/// The baseline every control is measured against: 20 of 20 seeds converge with a reboot, and
/// the rebooted shrine is never refused as stale nor falsely confirmed. (Oracle's first probe was
/// blind because its baseline converged on 9 of 20.)
fn assert_converged(net: &Net, seed: u64) {
    let over = net.over.last().unwrap();
    assert!(
        [
            tapstone_proto::frame::result_reason::LETHAL,
            tapstone_proto::frame::result_reason::STOP
        ]
        .contains(&over.result.reason),
        "seed {seed}: ended by {}",
        over.result.reason
    );
    assert!(
        tapstone_sim::replay(&over.json)
            .unwrap()
            .matches(&over.json),
        "seed {seed}: replay"
    );
    for s in &net.shrines {
        assert_eq!(
            s.follower.head_hash(),
            over.result.chain,
            "seed {seed} node {} head",
            s.node
        );
        assert_eq!(
            s.false_confirms, 0,
            "seed {seed} node {}: a new tap confirmed by an old commit",
            s.node
        );
    }
}

#[test]
fn a_shrine_rebooted_mid_match_resyncs_by_nak_and_resumes_above_its_last_lseq() {
    for seed in 1..=20u64 {
        let (net, who) = reboot_run(seed, false, true);
        assert_converged(&net, seed);
        assert_eq!(
            net.shrines[who].stale_rejects, 0,
            "seed {seed}: the rebooted shrine proposed a used lseq"
        );
    }
}

#[test]
fn a_shrine_rebooted_mid_match_resyncs_by_join_and_resumes_above_its_last_lseq() {
    for seed in 1..=20u64 {
        let (net, who) = reboot_run(seed, true, true);
        assert_converged(&net, seed);
        assert_eq!(
            net.shrines[who].stale_rejects, 0,
            "seed {seed}: the rebooted shrine proposed a used lseq"
        );
    }
}

/// The control, on both paths: a rebooted shrine that does NOT resume (its counter restarts at 1)
/// is caught. The arena refuses every reused lseq as stale, none is falsely confirmed, and the
/// match still converges on all 20 seeds. The baseline above differs from this only in the resume.
#[test]
fn without_resume_every_reused_lseq_is_caught_and_the_match_still_converges() {
    for via_join in [false, true] {
        for seed in 1..=20u64 {
            let (net, who) = reboot_run(seed, via_join, false);
            assert_converged(&net, seed);
            assert!(
                net.shrines[who].stale_rejects > 0,
                "seed {seed} (join {via_join}): a counter restarted at 1 was never refused: the control cannot see"
            );
        }
    }
}

/// Oracle's low note on #75. A rebooted shrine whose first commits are an OLD retransmit (a copy
/// of mseq 5, twice) catches up to mseq 5 and, under the old rule, "finishes" rejoining there,
/// far below the head. It then proposes with a counter learned from records up to 5 only. STALE
/// catches most of those; a byte-identical tap (a Pass) re-confirms an old commit, which
/// false_confirms cannot see. So rejoin now ends only once the shrine has stayed caught up for a
/// head re-broadcast period, or has heard R. It must still be rejoining after the old copies, and
/// it must never propose an lseq at or below its pre-reboot last.
#[test]
fn a_rebooted_shrine_that_first_hears_an_old_retransmit_waits_for_the_head() {
    for seed in 1..=20u64 {
        let mut net = Net::new(seed, 0.0, 0.0);
        while net.shrines[0].follower.records().len() < 30 && net.over.is_empty() {
            net.step();
        }
        assert!(net.over.is_empty(), "seed {seed}: over before the reboot");
        let who = 1;
        let last_before = net.shrines[who].follower.last_lseq()[who];
        let old = net
            .sent_commits
            .get(&5)
            .cloned()
            .expect("mseq 5 was broadcast");
        net.reboot(who, false);
        net.deliver(who, &old); // a gap: NAK 0..4
        net.drain(); // the replay of 0..4
        net.deliver(who, &old); // the duplicate: mseq 5 applies
        net.drain();
        // One step, so the shrine's act evaluates the rule (the rejoin decision is made there, not
        // on receipt: asserting straight after the drain would pass whatever the rule).
        net.step();
        assert!(
            net.shrines[who].rejoining,
            "seed {seed}: rejoin ended at mseq 5, below the head ({} journaled)",
            net.journaled()
        );
        assert!(net.run(20_000), "seed {seed}: no result");
        let low: Vec<u16> = net.shrines[who]
            .proposed
            .iter()
            .copied()
            .filter(|&l| l <= last_before)
            .collect();
        assert!(
            low.is_empty(),
            "seed {seed}: proposed used lseqs {low:?} (last before the reboot {last_before})"
        );
    }
}
