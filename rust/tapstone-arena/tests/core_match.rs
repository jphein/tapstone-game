mod harness;
use harness::*;
use tapstone_proto::frame::result_reason;
use tapstone_sim::replay;

fn check_three_way(net: &Net) {
    let over = net.over.last().expect("the match ended");
    // 1. The arena's own transcript replays through a fresh engine without the arbiter.
    let r = replay(&over.json).expect("replays");
    assert!(
        r.matches(&over.json),
        "an independent replay disagrees with the arena's hashes"
    );
    // 2. Both followers sit at the arena's head, record for record.
    let arena_head: [u8; 8] = over.result.chain;
    for s in &net.shrines {
        assert_eq!(s.follower.head_hash(), arena_head, "node {} head", s.node);
        assert_eq!(
            s.follower.records().len(),
            over.json.records.len(),
            "node {} records",
            s.node
        );
    }
    // 3. The TSX1 bytes carry exactly those records after the 36-byte header.
    assert_eq!(over.tsx1.len(), 36 + 32 * over.json.records.len());
    assert_eq!(&over.tsx1[..4], b"TSX1");
}

#[test]
fn scripted_duels_end_with_arena_followers_and_replay_agreeing() {
    for seed in 1..=20u64 {
        let mut net = Net::new(seed, 0.0, 0.0);
        assert!(net.run(20_000), "seed {seed}: no result");
        let over = net.over.last().unwrap();
        assert!(
            [result_reason::LETHAL, result_reason::STOP].contains(&over.result.reason),
            "seed {seed}: ended by {}",
            over.result.reason
        );
        check_three_way(&net);
    }
}

#[test]
#[ignore = "diagnostic: run with --ignored --nocapture to see the games"]
fn show_the_games() {
    for seed in 1..=5u64 {
        let mut net = Net::new(seed, 0.0, 0.0);
        assert!(net.run(20_000));
        let o = net.over.last().unwrap();
        let draws = o.json.records.iter().filter(|r| r.kind == "Draw").count();
        println!(
            "seed {seed}: {} records ({draws} draws), round {}, reason {}, winner {:?}, sim {} ms",
            o.json.records.len(),
            o.round,
            o.result.reason,
            o.winner,
            net.now
        );
    }
}
