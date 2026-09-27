mod harness;
use harness::*;
use tapstone_proto::frame::result_reason;
use tapstone_sim::replay;

#[test]
fn ten_percent_loss_and_five_percent_duplication_still_converge() {
    // 200 seeds, not 10: at 10% loss about 30% of duels end with a follower short of the result
    // unless the arena lingers (state-machine.md RESULT), and seeds 1-10 alone passed by luck once
    // the harness's frame traffic changed.
    for seed in 1..=200u64 {
        let mut net = Net::new(seed, 0.10, 0.05);
        assert!(net.run(60_000), "seed {seed}: no result under loss");
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
    }
}

#[test]
fn a_silent_seat_pauses_the_match_and_then_times_it_out() {
    let mut net = Net::new(3, 0.0, 0.0);
    // Well into the match: past the opening hands and a few turns. (A fixed 200 steps was not:
    // scripted seats tap at once, and seed 3's whole duel is over inside 2 s.)
    let mut warm = 0;
    while net.shrines[0].follower.records().len() < 20 && warm < 5_000 {
        net.step();
        warm += 1;
    }
    assert!(
        net.over.is_empty(),
        "the duel ended before shrine 1 fell silent"
    );
    assert_eq!(net.shrines[0].follower.records().len(), 20);
    // Shrine 1 goes silent: drop everything it sends from now on.
    let silent = net.shrines[1].node;
    let mut steps = 0;
    while net.over.is_empty() && steps < 20_000 {
        net.step_dropping_from(silent);
        steps += 1;
    }
    let over = net.over.last().expect("the lost seat timed the match out");
    assert_eq!(over.result.reason, result_reason::TIMEOUT);
    assert_eq!(
        over.winner,
        Some(0),
        "the seat still present wins (protocol §4.5)"
    );
    assert!(
        steps as u64 * 10 >= 120_000,
        "timed out after {} ms, before the 120 s pause timeout",
        steps * 10
    );
}

/// The RESULT linger (state-machine.md RESULT, ruled "linger A" 2026-09-23) is bounded: once both
/// seats ack the final commit, or 5 s after the result, the arena is a plain lobby again.
#[test]
fn the_result_linger_ends() {
    let mut net = Net::new(2, 0.0, 0.0);
    assert!(net.run_until_result(20_000), "the lossless duel ended");
    let t_result = net.now;
    while net.core.lingering() && net.now - t_result < 10_000 {
        net.step();
    }
    assert!(
        net.now - t_result < 1_000,
        "lossless: both seats acked the final commit, yet the linger stayed {} ms",
        net.now - t_result
    );
    // A lossy duel whose linger is still open at the result (a follower behind), then silence.
    let mut net = (1..=200u64)
        .map(|seed| {
            let mut n = Net::new(seed, 0.10, 0.05);
            let mut steps = 0;
            while n.over.is_empty() && steps < 20_000 {
                n.step();
                steps += 1;
            }
            n
        })
        .find(|n| !n.over.is_empty() && n.core.lingering())
        .expect("some lossy duel ends with a seat behind");
    // Silence both shrines: nobody can NAK or ack now, so only the 5 s bound can close it.
    let silent = [net.shrines[0].node, net.shrines[1].node];
    let t0 = net.now;
    while net.core.lingering() && net.now - t0 < 10_000 {
        net.step_dropping(&silent);
    }
    assert!(!net.core.lingering(), "the linger outlived its 5 s bound");
    assert!(
        net.now - t0 >= 5_000,
        "closed after {} ms, before 5 s with a seat behind",
        net.now - t0
    );
}

/// A lossy duel stopped right at its result, with the RESULT linger still open.
fn lingering_net() -> Net {
    (1..=200u64)
        .map(|seed| {
            let mut n = Net::new(seed, 0.10, 0.05);
            let mut steps = 0;
            while n.over.is_empty() && steps < 20_000 {
                n.step();
                steps += 1;
            }
            n
        })
        .find(|n| !n.over.is_empty() && n.core.lingering())
        .expect("some lossy duel ends with a seat behind")
}

/// Oracle's low gap on #74: the match is over, so a play tap during the linger is swallowed. It is
/// neither committed nor refused, and the linger goes on.
#[test]
fn a_play_tap_during_the_linger_is_swallowed() {
    use tapstone_proto::frame::{Frame, Tap};
    let mut net = lingering_net();
    let before = net.journaled();
    let pass = tapstone_sim::tap(0, tapstone_rules::Kind::Pass, 0, -1, 0, 0);
    let reply = net.inject(
        NODES[0],
        Frame::Tap(Tap::Propose {
            lseq: 60_000,
            record: pass,
        }),
    );
    assert_eq!(
        reply, None,
        "no commit and no refusal for a tap after the result"
    );
    assert_eq!(net.journaled(), before, "nothing journaled");
    assert!(net.core.lingering(), "the linger goes on");
}

/// Oracle's low gap on #74: a new match may start while the last one lingers. Both castles are
/// claimed afresh, the new match begins, and the linger for the old one ends at the next tick.
#[test]
fn a_new_match_started_mid_linger_ends_the_linger() {
    use tapstone_proto::frame::{Frame, Lobby, Tap, lobby_flags};
    let mut net = lingering_net();
    let begins = |n: &Net| {
        n.journal
            .iter()
            .filter(|j| matches!(j, tapstone_arena::core::JournalOp::Begin { .. }))
            .count()
    };
    let before = begins(&net);
    for (i, &node) in NODES.iter().enumerate() {
        let beacon = Frame::Lobby(Lobby {
            seat_pref: i as u8,
            deck_sigil: tapstone_proto::ids::deck_sigil(&net.shrines[i].deck),
            ruleset: 1,
            registry: 2,
            rules: tapstone_proto::ids::rules_id(&tapstone_rules::HouseRules::default()),
            flags: lobby_flags::WANTS_MATCH,
        });
        net.inject(node, beacon);
    }
    for (i, &node) in NODES.iter().enumerate() {
        let mut claim = tapstone_sim::tap(
            i as u8,
            tapstone_rules::Kind::ClaimSeat,
            tapstone_sim::CASTLES[i],
            -1,
            0,
            0,
        );
        claim.uid = [4, 0, 0, 0, 0, 0, i as u8];
        net.inject(
            node,
            Frame::Tap(Tap::Propose {
                lseq: 1,
                record: claim,
            }),
        );
    }
    assert_eq!(begins(&net), before + 1, "the new match began");
    assert_eq!(net.core.seated(), NODES.to_vec(), "seated in claim order");
    let all = [NODES[0], NODES[1]];
    net.step_dropping(&all); // one tick, nobody heard
    assert!(
        !net.core.lingering(),
        "the old match's linger ended when the new one started"
    );
}
