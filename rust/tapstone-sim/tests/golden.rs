use tapstone_sim::{Transcript, play_seeded};

#[test]
fn seeded_games_are_reproducible_and_end() {
    let a = play_seeded(1, 500);
    let b = play_seeded(1, 500);
    assert_eq!(a.final_hash, b.final_hash);
    assert!(a.game_over, "500 taps is plenty to reach round 12");
    assert!(a.records.len() < 500);
}

#[test]
fn different_seeds_diverge() {
    assert_ne!(
        play_seeded(1, 500).final_hash,
        play_seeded(2, 500).final_hash
    );
}

#[test]
fn transcript_roundtrips_through_json() {
    let t = play_seeded(3, 500);
    let s = serde_json::to_string_pretty(&t).unwrap();
    let back: Transcript = serde_json::from_str(&s).unwrap();
    assert_eq!(back, t);
}

#[test]
fn goldens_match() {
    for seed in [1u64, 2, 3] {
        let t = play_seeded(seed, 500);
        let path = format!("{}/golden/seed-{seed}.json", env!("CARGO_MANIFEST_DIR"));
        let golden: Transcript =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            t.final_hash, golden.final_hash,
            "seed {seed} diverged from its golden transcript"
        );
        assert_eq!(t.records.len(), golden.records.len());
    }
}
