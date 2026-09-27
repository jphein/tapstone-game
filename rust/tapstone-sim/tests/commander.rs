//! Seating a leveled/geared commander in the sim (0029–0031).
use tapstone_rules::{Commander, Keyword};
use tapstone_sim::{Setup, play_seeded_setup, replay};

fn geared() -> Commander {
    Commander::stats(3, 7, Some(Keyword::Taunt))
}

#[test]
fn a_setup_seats_its_commanders_through_the_claim_records() {
    let setup = Setup {
        commanders: [geared(), Commander::LEVEL_1],
        ..Setup::default()
    };
    let t = play_seeded_setup(7, 500, setup);
    let claims: Vec<_> = t
        .records
        .iter()
        .filter(|r| r.kind == "ClaimSeat")
        .map(|r| (r.seat, r.lane, r.target, r.aux))
        .collect();
    assert_eq!(
        claims,
        vec![(1, -1, 2, 4), (0, Keyword::Taunt.code() as i8, 3, 7)],
        "seat 1 claims first, then seat 0; stats ride in lane/target/aux"
    );
    let r = replay(&t).expect("replays");
    assert!(
        r.matches(&t),
        "a replay rebuilt from the records alone reproduces every hash"
    );
}

#[test]
fn the_commanders_change_the_game() {
    let fresh = Setup::default();
    let strong = Setup {
        commanders: [geared(), Commander::LEVEL_1],
        ..Setup::default()
    };
    let moved = (1..=40u64)
        .filter(|&s| {
            play_seeded_setup(s, 500, fresh).final_hash
                != play_seeded_setup(s, 500, strong).final_hash
        })
        .count();
    assert_eq!(
        moved, 40,
        "commander stats are hashed at genesis, so every chain moves"
    );
}

#[test]
fn default_setup_is_two_level_one_commanders() {
    assert_eq!(Setup::default().commanders, [Commander::LEVEL_1; 2]);
}

// ---- 0030's balance bound as a measurement ---------------------------------------------

use tapstone_sim::Style;
use tapstone_sim::progression::{
    Item, VeteranRun, commander_at, level_bonus, max_loadouts, slots, veteran_vs_fresh,
};

#[test]
fn levels_give_no_stats_and_the_third_slot_is_a_look_slot() {
    // 0034: "Levels give no attack and no toughness"; the third slot still opens at level 7.
    for level in 1..=10 {
        assert_eq!(level_bonus(level), (0, 0), "level {level}");
        assert_eq!(
            commander_at(level, &[]),
            Commander::LEVEL_1,
            "level {level}"
        );
    }
    assert_eq!((slots(6), slots(7)), (2, 3));
}

#[test]
fn gear_is_haste_or_taunt_or_a_look() {
    // 0034: gear effects are only Haste or Taunt, one per commander; every other item is a look.
    assert_eq!(
        commander_at_checked(10, &[Item::Look, Item::Look, Item::Keyword(Keyword::Haste)]),
        Some(Commander::stats(2, 4, Some(Keyword::Haste)))
    );
    assert_eq!(
        commander_at_checked(10, &[Item::Look; 3]),
        Some(Commander::LEVEL_1),
        "a look changes nothing"
    );
    assert!(
        commander_at_checked(6, &[Item::Look; 3]).is_none(),
        "three items need level 7"
    );
    for k in [Keyword::Ranged, Keyword::Shield1, Keyword::Rush] {
        assert!(
            commander_at_checked(10, &[Item::Keyword(k)]).is_none(),
            "{k:?} is not an item effect"
        );
    }
    assert!(
        commander_at_checked(
            10,
            &[Item::Keyword(Keyword::Taunt), Item::Keyword(Keyword::Haste)]
        )
        .is_none(),
        "one keyword per commander"
    );
}

fn commander_at_checked(level: u8, gear: &[Item]) -> Option<Commander> {
    tapstone_sim::progression::try_commander_at(level, gear)
}

#[test]
fn the_max_loadouts_are_every_distinct_legal_kit_at_level_ten() {
    let all = max_loadouts();
    let stats: Vec<Commander> = all.iter().map(|(_, c)| *c).collect();
    assert_eq!(
        stats,
        vec![
            Commander::LEVEL_1,
            Commander::stats(2, 4, Some(Keyword::Haste)),
            Commander::stats(2, 4, Some(Keyword::Taunt)),
        ],
        "looks are free, so the distinct kits are bare, Haste and Taunt"
    );
    // Every kit the sim can seat must be one the engine accepts.
    for (name, c) in &all {
        let mut g = tapstone_rules::Game::new(
            tapstone_rules::HouseRules::default(),
            [0, 1],
            [&[2u16; 25], &[2u16; 25]],
        );
        assert_eq!(g.set_commander(0, *c), Ok(()), "{name}");
    }
}

#[test]
fn a_veteran_run_seats_the_veteran_in_both_seats() {
    // Fresh against fresh: the two halves are the plain mirror, so the veteran's rate is the
    // average of seat 0's rate and seat 1's rate — exactly 50% by construction.
    let v = veteran_vs_fresh(Commander::LEVEL_1, Style::PlayOut, 40, 500, 2);
    assert_eq!(v.seat0.games + v.seat1.games, 80);
    assert!((v.veteran_win_rate() - 0.5).abs() < 1e-9);
    // A veteran that differs from fresh must be in seat 0 for one half and seat 1 for the other.
    // Fresh-vs-fresh cannot see a missing swap (both halves are the same mirror), so compare each
    // half with the game it claims to be.
    let vet = geared();
    let v = veteran_vs_fresh(vet, Style::PlayOut, 40, 500, 2);
    let run = |commanders| {
        tapstone_sim::balance::run_variant_setup(
            "veteran",
            Setup {
                commanders,
                decks: tapstone_sim::Decks::MirrorEmber,
                ..Setup::default()
            },
            40,
            500,
            2,
        )
    };
    assert_eq!(v.seat0, run([vet, Commander::LEVEL_1]), "veteran in seat 0");
    assert_eq!(v.seat1, run([Commander::LEVEL_1, vet]), "veteran in seat 1");
    assert_ne!(v.seat0, v.seat1, "the halves must be different games");
}

#[test]
fn the_interval_is_wilson_and_never_zero_width() {
    use tapstone_sim::progression::wilson95;
    let (lo, hi) = wilson95(4000, 4000);
    assert!(hi > 1.0 - 1e-12);
    assert!(
        lo < 0.9995 && lo > 0.998,
        "p = 1 still has a lower bound below 1: {lo}"
    );
    let (lo, hi) = wilson95(0, 4000);
    assert_eq!(lo, 0.0);
    assert!(hi > 0.0005);
    let (lo, hi) = wilson95(2000, 4000);
    assert!(
        (0.5 - lo - (hi - 0.5)).abs() < 1e-12,
        "symmetric at p = 1/2"
    );
    assert!((hi - 0.5 - 0.0155).abs() < 0.0005, "≈ ±1.55 at n = 4000");
}

#[test]
fn the_bound_is_judged_on_the_upper_bound_not_the_point() {
    use tapstone_sim::progression::over_bound;
    // A point estimate under the bound whose interval crosses it has not shown headroom.
    assert!(
        over_bound(119, 200, 0.60),
        "59.5% of 200 (≈ ±6.8) must read OVER"
    );
    assert!(
        over_bound(5950, 10_000, 0.60),
        "59.5% of 10000 (≈ ±1) must read OVER"
    );
    assert!(!over_bound(2200, 4000, 0.60), "55.0 ±1.5 is clear of 60");
    assert!(over_bound(2500, 4000, 0.60), "62.5 is over on any reading");
}
#[test]
fn the_gate_tells_an_unresolved_sample_from_a_real_breach() {
    use tapstone_sim::progression::{Verdict, verdict};
    // A short run whose interval straddles the bound has not decided anything; it must not read
    // as a breach (it looked exactly like a regression at --games 1000, PR #54's review).
    assert_eq!(verdict(119, 200, 0.60), Verdict::Unresolved, "59.5% of 200");
    assert_eq!(
        verdict(5950, 10_000, 0.60),
        Verdict::Unresolved,
        "59.5% of 10000"
    );
    assert_eq!(
        verdict(121, 200, 0.60),
        Verdict::Unresolved,
        "60.5% of 200: lower end under"
    );
    // Still fail closed: only an interval wholly under the bound is clear.
    assert_eq!(verdict(2200, 4000, 0.60), Verdict::Clear, "55.0 ±1.5");
    assert_eq!(
        verdict(2500, 4000, 0.60),
        Verdict::Over,
        "62.5: lower end over 60"
    );
    // Agreement with the older predicate, so the two cannot drift.
    for (k, n) in [
        (119, 200),
        (5950, 10_000),
        (2200, 4000),
        (2500, 4000),
        (4000, 4000),
    ] {
        let v = verdict(k, n, 0.60);
        assert_eq!(
            v != Verdict::Clear,
            tapstone_sim::progression::over_bound(k, n, 0.60)
        );
    }
}

/// The positive control: the instrument must be able to see a commander that is far too strong.
/// Without it a "≤ 60%" could come from a sim in which commanders simply never matter.
#[test]
fn the_bound_can_fail() {
    let god = Commander::stats(12, 30, Some(Keyword::Haste));
    for style in [Style::PlayOut, Style::PassEarly] {
        let v: VeteranRun = veteran_vs_fresh(god, style, 200, 500, 4);
        assert!(
            v.interval().0 > 0.6,
            "{style:?}: a 12/30 Haste commander wins only {:.1}% — the instrument is blind",
            100.0 * v.veteran_win_rate()
        );
    }
}

#[test]
fn the_arenas_derivation_and_the_bound_runs_kits_are_one_set() {
    use std::collections::BTreeSet;
    use tapstone_progression::{ITEMS, LEVEL_MAX, derive_commander};
    let per_slot = |slot: usize| -> Vec<Option<u16>> {
        std::iter::once(None)
            .chain(
                ITEMS
                    .iter()
                    .filter(|d| d.slot as usize == slot)
                    .map(|d| Some(d.id)),
            )
            .collect()
    };
    let mut derived = BTreeSet::new();
    for w in per_slot(0) {
        for a in per_slot(1) {
            for t in per_slot(2) {
                let Ok(c) = derive_commander(LEVEL_MAX, &[w, a, t]) else {
                    continue;
                };
                let mut g = tapstone_rules::Game::new(
                    Default::default(),
                    [0, 1],
                    [&[2u16; 25], &[2u16; 25]],
                );
                assert_eq!(
                    g.set_commander(0, c),
                    Ok(()),
                    "the engine refuses a derivable kit {c:?}"
                );
                derived.insert(format!("{c:?}"));
            }
        }
    }
    let measured: BTreeSet<String> = max_loadouts()
        .iter()
        .map(|(_, c)| format!("{c:?}"))
        .collect();
    assert_eq!(
        derived, measured,
        "the bound measures a different set from what the arena can seat"
    );
}
