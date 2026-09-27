//! #67: a shrine learns the seat map, both deck lists and the house rules from the arena's `B`, and
//! builds its game from received frames alone. The desk shrines the harness runs hold only their own
//! deck, so every harness test now runs on frame-built followers; these tests aim at `B` itself.
mod harness;
use harness::*;
use tapstone_proto::frame::{halt_reason, result_reason};

/// Step until both followers and the arena have a genesis (or panic after `max` steps).
fn until_genesis(net: &mut Net, max: usize) {
    for _ in 0..max {
        if net.core.genesis().is_some()
            && net.shrines.iter().all(|s| s.follower.genesis().is_some())
        {
            return;
        }
        net.step();
    }
    panic!(
        "seed {}: no genesis on every node after {max} steps",
        net.seed
    );
}

/// The whole match converged: a lethal or stop result, and both followers at its chain head.
fn converged(net: &Net) -> bool {
    net.over.last().is_some_and(|o| {
        [result_reason::LETHAL, result_reason::STOP].contains(&o.result.reason)
            && net
                .shrines
                .iter()
                .all(|s| s.follower.head_hash() == o.result.chain)
    })
}

/// The issue's test: over 20 seeds at 10% loss and 5% duplication, each follower, built from
/// frames only, reaches the arbiter's genesis hash, then its final hash.
#[test]
fn followers_built_from_frames_reach_the_arbiters_genesis_under_loss() {
    for seed in 1..=20u64 {
        let mut net = Net::new(seed, 0.10, 0.05);
        until_genesis(&mut net, 5_000);
        let want = net.core.genesis().unwrap();
        for s in &net.shrines {
            assert_eq!(
                s.follower.genesis(),
                Some(want),
                "seed {seed} node {} genesis",
                s.node
            );
            assert!(
                s.begin.is_some(),
                "seed {seed} node {}: began without a B?",
                s.node
            );
        }
        assert!(net.run(40_000), "seed {seed}: no result");
        assert!(converged(&net), "seed {seed}: did not converge");
    }
}

/// The seat map comes from `B`: with shrine 1 claiming first, shrine 1 is seat 0 and plays it. The
/// old follower assumed index = seat and would have halted here (desk.rs's former `lobby_game`).
#[test]
fn the_seat_map_comes_from_begin() {
    for seed in 1..=20u64 {
        let mut net = Net::new(seed, 0.0, 0.0);
        net.claim_first = 1;
        until_genesis(&mut net, 5_000);
        assert_eq!(
            net.core.seated(),
            vec![NODES[1], NODES[0]],
            "seed {seed}: claim order"
        );
        assert_eq!(
            (net.shrines[1].seat(), net.shrines[0].seat()),
            (Some(0), Some(1)),
            "seed {seed}"
        );
        assert!(net.run(40_000), "seed {seed}: no result");
        assert!(
            converged(&net),
            "seed {seed}: did not converge with the seats swapped"
        );
    }
}

/// The control the issue names: one changed deck byte in the `B` one shrine receives is a different
/// game. It is caught at the record that starts the chain, and the match is void (DESYNC), never
/// played on. Measured against the baseline above, which differs from this only in the flipped byte.
#[test]
fn one_changed_deck_byte_is_caught_at_genesis() {
    for seed in 1..=20u64 {
        let mut net = Net::new(seed, 0.0, 0.0);
        let who = (seed % 2) as usize;
        net.corrupt_begin[who] = true;
        assert!(net.run(5_000), "seed {seed}: no result");
        let x = net.shrines[who]
            .follower
            .halted()
            .expect("the corrupted shrine halted");
        assert_eq!((x.at_mseq, x.reason), (1, halt_reason::HASH), "seed {seed}");
        assert_eq!(
            net.over[0].result.reason,
            result_reason::DESYNC,
            "seed {seed}"
        );
        assert!(
            net.shrines[1 - who].follower.halted().is_none(),
            "seed {seed}: the clean shrine"
        );
    }
}

/// A dropped `B` is retransmitted by the arena: a seat that has acked nothing gets `B` again ahead of
/// every commit retransmit. The shrine's own ask is off here, so the retransmit alone converges.
#[test]
fn a_dropped_begin_is_retransmitted() {
    for seed in 1..=20u64 {
        let mut net = Net::new(seed, 0.0, 0.0);
        let who = (seed % 2) as usize;
        net.drop_begin[who] = 1;
        for s in &mut net.shrines {
            s.ask_begin = false;
        }
        assert!(net.run(40_000), "seed {seed}: no result");
        assert!(converged(&net), "seed {seed}: did not converge");
        assert_eq!(
            net.drop_begin[who], 0,
            "seed {seed}: the drop never happened"
        );
        assert_eq!(
            net.shrines[who].begin_asks, 0,
            "seed {seed}: asked, though asking was off"
        );
    }
}

/// ... and re-asked for: a shrine that hears a commit with no `B` sends `J role=seat`. The arena's
/// retransmit is still running here, so this shows the ask is made and does no harm; that the answer
/// to a seat's `J` carries `B` is shown by reboot.rs's JOIN path, whose shrine has no `B` and gets no
/// retransmit (its seat has acked), and which fails when the arena answers `J` without `B`.
#[test]
fn a_dropped_begin_is_asked_for() {
    for seed in 1..=20u64 {
        let mut net = Net::new(seed, 0.0, 0.0);
        let who = (seed % 2) as usize;
        net.drop_begin[who] = 5;
        assert!(net.run(40_000), "seed {seed}: no result");
        assert!(converged(&net), "seed {seed}: did not converge");
        assert!(
            net.shrines[who].begin_asks > 0,
            "seed {seed}: never asked for B"
        );
    }
}

/// The positive control for "frames only": with every `B` to one shrine dropped, that shrine never
/// builds a game, whatever else it hears, and the match cannot finish. If the follower could get its
/// game anywhere else, this would converge.
#[test]
fn without_any_begin_a_shrine_never_builds_a_game() {
    for seed in 1..=5u64 {
        let mut net = Net::new(seed, 0.0, 0.0);
        let who = (seed % 2) as usize;
        net.drop_begin[who] = u32::MAX;
        assert!(
            !net.run(3_000),
            "seed {seed}: a match finished without one seat's B"
        );
        assert_eq!(net.shrines[who].follower.begun(), None, "seed {seed}");
        assert!(
            net.shrines[who].begin_asks > 0,
            "seed {seed}: it kept asking"
        );
        assert!(
            net.shrines[who].follower.records().is_empty(),
            "seed {seed}"
        );
    }
}

/// Oracle on #86, at the shrine: a shrine whose game is the last match's (over) never acks the
/// next match's commits as duplicates, and asks for the new match's B instead. And a shrine no B
/// seats has no seat (never its index).
#[test]
fn a_shrine_drops_another_matchs_commits_and_has_no_seat_without_a_b() {
    use tapstone_proto::frame::{Frame, Header};
    let mut net = Net::new(1, 0.0, 0.0);
    assert_eq!(net.shrines[0].seat(), None, "no B yet, no seat");
    assert!(net.run(40_000));
    let s = &mut net.shrines[1];
    assert_eq!(s.seat(), Some(1));
    let (id, _) = s.begin.unwrap();
    let old = net.sent_commits.get(&0).cloned().unwrap();
    let Some((_, Frame::Commit(c))) = Frame::decode(&old) else {
        panic!()
    };
    let other = Header {
        match_id: id ^ 1,
        src: ARENA,
    };
    let s = &mut net.shrines[1];
    assert!(
        s.rx(&other, &Frame::Commit(c)).is_empty(),
        "no ack for another match's commit"
    );
    assert!(s.heard_unbegun, "it asks for the new match's B");
    let same = Header {
        match_id: id,
        src: ARENA,
    };
    assert!(
        !s.rx(&same, &Frame::Commit(c)).is_empty(),
        "control: its own match's copy is acked"
    );
}
