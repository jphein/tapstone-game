//! Arena-dark recovery on a lossy mesh where a broadcast is lost per receiver (the harness's
//! default since Oracle's review of #100). Before, one draw decided a broadcast for both shrines,
//! so a handover commit or a RESULT could never reach one shrine and not the other, and dark
//! recovery was never tested above loss 0 (#98).
mod harness;
use harness::*;
use tapstone_proto::frame::result_reason;

const SEEDS: u64 = 20;
/// Loss only, duplication only, both (core_loss's rates).
const MESHES: [(f64, f64); 3] = [(0.10, 0.0), (0.0, 0.10), (0.10, 0.05)];

/// Into the match, the arena dark for 50 steps (the interim arbitrates), revived from its journal,
/// and played out.
fn dark_run(seed: u64, loss: f64, dup: f64) -> Net {
    let mut net = Net::new(seed, loss, dup);
    while net.shrines[0].follower.records().len() < 20 && net.over.is_empty() {
        net.step();
    }
    net.go_dark();
    for _ in 0..50 {
        net.step();
    }
    net.revive();
    net.run(40_000);
    net
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

/// The capability itself, with its control in the same test: per-receiver loss lets an arena
/// broadcast reach one shrine and not the other; the old one-draw model never does.
#[test]
fn per_receiver_loss_lets_one_shrine_miss_a_broadcast_the_other_hears() {
    let (mut per_receiver, mut shared) = (0u32, 0u32);
    for seed in 1..=10u64 {
        let mut a = Net::new(seed, 0.10, 0.05);
        a.run(40_000);
        per_receiver += a.one_sided;
        let mut b = Net::new(seed, 0.10, 0.05);
        b.per_receiver_loss = false;
        b.run(40_000);
        shared += b.one_sided;
    }
    eprintln!("one-sided arena broadcasts: per-receiver {per_receiver}, shared {shared}");
    assert!(
        per_receiver > 0,
        "per-receiver loss never split a broadcast"
    );
    assert_eq!(shared, 0, "the one-draw model split a broadcast");
}

/// Dark recovery on three lossy meshes, 20 seeds each: every match converges after the revival.
/// #98: 3 of these 60 ended DESYNC with the head re-broadcast (a) and the two-round handover (b/c)
/// in, all one mechanism: the arena journaled a commit and died before any shrine heard it, so the
/// interim arbitrated that mseq itself; `dark_unsent` reproduces it losslessly.
#[test]
fn arena_dark_recovery_converges_on_a_lossy_mesh() {
    let mut failed = Vec::new();
    for (loss, dup) in MESHES {
        for seed in 1..=SEEDS {
            let net = dark_run(seed, loss, dup);
            if !converged(&net) {
                let reasons: Vec<u8> = net.over.iter().map(|o| o.result.reason).collect();
                failed.push(format!("loss {loss} dup {dup} seed {seed} {reasons:?}"));
            }
        }
    }
    assert!(
        failed.is_empty(),
        "{} of 60 did not converge: {failed:?}",
        failed.len()
    );
}

/// A harsher mesh (loss 0.2, dup 0.05), 200 seeds: every match converges after the revival.
/// #98: with #160 in, 20 of these 200 still ended DESYNC, 19 of them with seat 1 holding more
/// records than the interim at go_dark (the arena's last commit reached seat 1 alone), so the
/// interim arbitrated those mseqs itself and the shrines forked. The interim now catches up from
/// seat 1 before its first commit (`dark_fork`).
#[test]
fn on_a_harsher_mesh_dark_recovery_converges() {
    let (mut ahead, mut failed) = (0, Vec::new());
    for seed in 1..=200 {
        let mut net = Net::new(seed, 0.20, 0.05);
        while net.shrines[0].follower.records().len() < 20 && net.over.is_empty() {
            net.step();
        }
        let [s0, s1] = [0, 1].map(|i| net.shrines[i].follower.records().len());
        ahead += usize::from(s1 > s0);
        net.go_dark();
        for _ in 0..50 {
            net.step();
        }
        net.revive();
        net.run(40_000);
        if !converged(&net) {
            let reasons: Vec<u8> = net.over.iter().map(|o| o.result.reason).collect();
            failed.push(format!("seed {seed} {reasons:?} seat 1 ahead={}", s1 > s0));
        }
    }
    // The floor, counted from the condition itself: runs that went dark with seat 1 ahead.
    assert!(
        ahead >= 20,
        "only {ahead} of 200 runs went dark with seat 1 ahead"
    );
    assert!(
        failed.is_empty(),
        "{} of 200 did not converge: {failed:?}",
        failed.len()
    );
}
