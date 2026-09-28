//! Desk mode runs the shrine the tests ran (Task 21, verification.md "one object"). This is the
//! re-runnable evidence: a 30-seed lossy fingerprint of whole duels, recorded from the test
//! harness's own shrine before it moved into `link/desk.rs`, must be reproduced exactly by the desk
//! shrine. The control shows the fingerprint can see a 10 ms timing change.
mod harness;
use harness::*;

const GOLDEN: &str = include_str!("golden/fingerprint-30.txt");

/// One line per seed: round, reason, winner, chain head, follower lengths, every record.
fn fingerprint(claim_retry_ms: u64) -> Vec<String> {
    (1..=30u64)
        .map(|seed| {
            let mut net = Net::v0(seed, 0.10, 0.05);
            // The golden was recorded when one draw decided a broadcast for every receiver.
            net.per_receiver_loss = false;
            for s in &mut net.shrines {
                s.claim_retry_ms = claim_retry_ms;
            }
            assert!(net.run(60_000), "seed {seed}: no result");
            let o = net.over.last().unwrap();
            let recs: Vec<String> = o
                .json
                .records
                .iter()
                .map(|r| format!("{}{}{}", r.kind, r.card, r.seat))
                .collect();
            format!(
                "FP {seed} {} {} {:?} {:02x?} {:?} {}",
                o.round,
                o.result.reason,
                o.winner,
                o.result.chain,
                net.shrines
                    .iter()
                    .map(|s| s.follower.records().len())
                    .collect::<Vec<_>>(),
                recs.join(",")
            )
        })
        .collect()
}

fn golden() -> Vec<&'static str> {
    GOLDEN.lines().filter(|l| !l.starts_with('#')).collect()
}

#[test]
fn the_desk_shrine_reproduces_the_pre_move_harness_fingerprint() {
    let now = fingerprint(100);
    let want = golden();
    assert_eq!(want.len(), 30, "the golden holds 30 seeds");
    for (i, (got, want)) in now.iter().zip(&want).enumerate() {
        assert_eq!(
            got,
            want,
            "seed {}: the desk shrine diverged from the harness shrine",
            i + 1
        );
    }
}

/// The control: the fingerprint is sensitive enough to see a 10 ms change in when a shrine
/// re-sends its claim. If it were not, its agreement above would prove nothing.
#[test]
fn the_fingerprint_sees_a_ten_millisecond_timing_change() {
    let changed = fingerprint(110);
    let differ = changed
        .iter()
        .zip(golden())
        .filter(|(a, b)| a.as_str() != *b)
        .count();
    assert!(
        differ > 0,
        "a 110 ms claim retry left all 30 seeds identical: the fingerprint is blind"
    );
    println!("{differ} of 30 seeds moved with a 10 ms change");
}

/// The recipe in the golden's header: rewrite the golden from today's code, keeping its `#` header.
/// Run it only for a deliberate behaviour change, read the diff, and say why in the commit.
#[test]
#[ignore = "rewrites tests/golden/fingerprint-30.txt"]
fn regenerate_the_golden() {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/fingerprint-30.txt");
    let header: String = GOLDEN
        .lines()
        .filter(|l| l.starts_with('#'))
        .map(|l| format!("{l}\n"))
        .collect();
    let body: String = fingerprint(100).iter().map(|l| format!("{l}\n")).collect();
    std::fs::write(&path, header + &body).expect("write the golden");
}
