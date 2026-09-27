use tapstone_rules::HouseRules;
use tapstone_sim::balance::{run_variant, variant_rules, variants};
use tapstone_sim::{play_seeded, play_seeded_with};

#[test]
fn balance_is_deterministic_for_a_fixed_seed_range() {
    let a = run_variant("baseline", HouseRules::default(), 50, 500, 1);
    let b = run_variant("baseline", HouseRules::default(), 50, 500, 1);
    assert_eq!(a, b, "the same seed range must aggregate identically");
}

#[test]
fn jobs_do_not_change_results() {
    let one = run_variant("baseline", HouseRules::default(), 64, 500, 1);
    let eight = run_variant("baseline", HouseRules::default(), 64, 500, 8);
    assert_eq!(
        one, eight,
        "games are pure given their seed: threading must not move a number"
    );
}

#[test]
fn variants_actually_differ() {
    let two = run_variant("bonus2", variant_rules("bonus2").unwrap(), 200, 500, 4);
    let zero = run_variant("bonus0", variant_rules("bonus0").unwrap(), 200, 500, 4);
    assert_ne!(
        (two.seat0_wins, two.seat1_wins),
        (zero.seat0_wins, zero.seat1_wins),
        "the second-player bonus must move the win split (direction not asserted)"
    );
}

#[test]
fn play_seeded_is_play_seeded_with_defaults() {
    // The goldens are pinned to `play_seeded`; this pins `play_seeded` to the new entry point.
    for seed in [1u64, 2, 3, 17] {
        assert_eq!(
            play_seeded(seed, 500),
            play_seeded_with(seed, 500, HouseRules::default())
        );
    }
}

#[test]
fn every_named_variant_is_reachable_by_name() {
    for (name, rules) in variants() {
        assert_eq!(
            variant_rules(name),
            Some(rules),
            "{name} is not reachable by name"
        );
    }
}

// ---- the picker's stopping condition (2026-09-21) --------------------------------------

use tapstone_sim::{Style, play_seeded_styled};

#[test]
fn play_out_is_more_active_than_pass_early() {
    // The whole finding: the choices were never the artefact, the activity level was.
    let (mut out, mut early) = (0usize, 0usize);
    for seed in 1..=60u64 {
        out += play_seeded_styled(seed, 500, HouseRules::default(), Style::PlayOut)
            .records
            .len();
        early += play_seeded_styled(seed, 500, HouseRules::default(), Style::PassEarly)
            .records
            .len();
    }
    assert!(
        out > early,
        "PlayOut {out} records vs PassEarly {early} — it is not playing out"
    );
}

#[test]
fn playing_out_a_turn_does_not_mean_trying_illegal_actions() {
    // A picker could look busier merely by proposing more refused taps. This one must not:
    // it offers only actions it has already established are available.
    for seed in 1..=40u64 {
        let t = play_seeded_styled(seed, 500, HouseRules::default(), Style::PlayOut);
        assert_eq!(t.refusals, 0, "seed {seed} refused {} taps", t.refusals);
    }
}

#[test]
fn both_styles_stay_reachable_and_deterministic() {
    for style in [Style::PlayOut, Style::PassEarly] {
        let a = play_seeded_styled(7, 500, HouseRules::default(), style);
        let b = play_seeded_styled(7, 500, HouseRules::default(), style);
        assert_eq!(a.final_hash, b.final_hash, "{style:?} is not deterministic");
    }
    assert_ne!(
        play_seeded_styled(7, 500, HouseRules::default(), Style::PlayOut).final_hash,
        play_seeded_styled(7, 500, HouseRules::default(), Style::PassEarly).final_hash,
        "the two styles must actually differ"
    );
}

// ---- the human seat --------------------------------------------------------------------

use tapstone_rules::{Game, Kind};
use tapstone_sim::human::legal_choices;
use tapstone_sim::{CASTLES, Decks, build_deck_from};

/// The menu is legal BY CONSTRUCTION: every entry was trial-applied by the engine before being
/// offered. This pins that, because the alternative — re-deriving legality in the UI — is a
/// second implementation of the rules that is free to drift from the first.
#[test]
fn every_offered_choice_is_accepted_by_the_engine() {
    let decks = [
        build_deck_from(9, 0, Decks::default()),
        build_deck_from(9, 1, Decks::default()),
    ];
    let mut g = Game::new(HouseRules::default(), CASTLES, [&decks[0], &decks[1]]).started();
    for _ in 0..40 {
        if g.phase != tapstone_rules::Phase::Playing {
            break;
        }
        let seat = g.active;
        let choices = legal_choices(&g, seat);
        assert!(
            !choices.is_empty(),
            "a seat always has at least Pass, or a draw it owes (0036)"
        );
        for c in &choices {
            let mut probe = g;
            assert!(
                probe.apply(&c.tap).is_ok(),
                "offered an illegal choice: {}",
                c.label
            );
        }
        // Advance by Pass, or, while a draw is owed (0036), by a draw: then nothing else is legal.
        let next = choices
            .iter()
            .find(|c| c.tap.kind == Kind::Pass)
            .or_else(|| choices.iter().find(|c| c.tap.kind == Kind::Draw))
            .expect("Pass is always legal once no draw is owed");
        if g.seats[seat as usize].owed_draws() > 0 {
            assert!(
                choices.iter().all(|c| c.tap.kind == Kind::Draw),
                "only draws while one is owed"
            );
        }
        g.apply(&next.tap).unwrap();
    }
}

#[test]
fn a_seat_that_cannot_act_is_still_offered_pass() {
    let decks = [
        build_deck_from(3, 0, Decks::default()),
        build_deck_from(3, 1, Decks::default()),
    ];
    let g = Game::new(HouseRules::default(), CASTLES, [&decks[0], &decks[1]]).started();
    let choices = legal_choices(&g, g.active);
    assert!(choices.iter().any(|c| c.tap.kind == Kind::Pass));
}

// ---- the divergence read ---------------------------------------------------------------

use tapstone_sim::divergence::analyse;

/// The picker aims removal at the nearest enemy by construction, so a picker game must never
/// register that divergence. If this ever fires, the detector and the picker disagree about what
/// "nearest" means and the human numbers are being read against the wrong control.
#[test]
fn a_picker_game_never_diverges_on_removal_targeting() {
    for seed in 1..=25u64 {
        for style in [Style::PlayOut, Style::PassEarly] {
            let t = play_seeded_styled(seed, 500, HouseRules::default(), style);
            let f = analyse(&t, 0).expect("a scripted transcript replays");
            let off = f.iter().filter(|x| x.kind == "removal-off-nearest").count();
            assert_eq!(
                off, 0,
                "seed {seed} {style:?} reported removal off the nearest target"
            );
        }
    }
}

/// PlayOut passes only when its own candidates are exhausted, so it should almost never register
/// "passed with resources". Asserted as a low ceiling rather than zero, because the picker picks
/// ONE unit card and then looks for a lane: if that card has nowhere to go it passes while a
/// cheaper unit would have fit. That is a real limitation of the picker, not of the detector, and
/// the control range exists so a human's count is read against it rather than against zero.
#[test]
fn play_out_rarely_passes_with_resources() {
    let mut total = 0;
    for seed in 1..=25u64 {
        let t = play_seeded_styled(seed, 500, HouseRules::default(), Style::PlayOut);
        total += analyse(&t, 0)
            .unwrap()
            .iter()
            .filter(|x| x.kind == "passed-with-resources")
            .count();
    }
    assert!(
        total <= 25,
        "PlayOut passed with resources {total} times over 25 games"
    );
}

// ---- decks as data ---------------------------------------------------------------------

use tapstone_sim::DECK_SIZE;
use tapstone_sim::deck::{COPY_LIMIT, load, load_named, slug};

/// The shipped deck files must BE the compiled-in lists, card for card and in order. If they ever
/// drift, a seedless run stops matching its own goldens — so this is the guard that let decks
/// become data without touching a single transcript.
#[test]
fn the_shipped_deck_files_are_the_compiled_in_lists() {
    let rules = HouseRules::default();
    for (seat, name) in [(0u8, "ember-neutral"), (1u8, "tide-neutral")] {
        let d = load_named(name, &rules).unwrap_or_else(|e| panic!("{e}"));
        let built: Vec<u16> = Decks::default()
            .designs(seat)
            .iter()
            .copied()
            .cycle()
            .take(DECK_SIZE)
            .collect();
        assert_eq!(
            d.cards, built,
            "{name} has drifted from the compiled-in list"
        );
        assert_eq!(
            d.castle, CASTLES[seat as usize],
            "{name} claims the wrong castle"
        );
    }
}

#[test]
fn slugs_are_what_the_file_stem_must_match() {
    assert_eq!(slug("Hearth March"), "hearth-march");
    assert_eq!(slug("Ember  Neutral!"), "ember-neutral");
}

fn write_tmp(stem: &str, body: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join("tapstone-deck-tests");
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join(format!("{stem}.toml"));
    std::fs::write(&p, body).unwrap();
    p
}

/// Each rejection is a separate sentence the loader has to be able to say. A loader that only
/// fails on malformed TOML would accept every one of these.
#[test]
fn a_deck_is_rejected_for_each_reason_it_should_be() {
    let rules = HouseRules::default();
    let n = usize::from(rules.deck_size);
    // A legal list (the shipped Ember one), so each case below fails for its own reason only.
    let ids = |k: usize| {
        Decks::default()
            .designs(0)
            .iter()
            .cycle()
            .take(k)
            .map(|d| format!("\"st1-{d:03}\""))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let good_cards = ids(n);
    let cases: Vec<(&str, String, &str)> = vec![
        (
            "unknown key",
            format!(
                "name=\"X\"\nowner=\"jp\"\ncastle=\"st1-000\"\ncards=[{good_cards}]\nsigil=\"\"\nfoo=1\n"
            ),
            "unknown",
        ),
        (
            "wrong count",
            "name=\"X\"\nowner=\"jp\"\ncastle=\"st1-000\"\ncards=[\"st1-002\"]\nsigil=\"\"\n"
                .to_string(),
            "house rules ask for",
        ),
        (
            "castle as a card",
            format!(
                "name=\"X\"\nowner=\"jp\"\ncastle=\"st1-000\"\ncards=[\"st1-000\", {}]\nsigil=\"\"\n",
                ids(n - 1)
            ),
            "cannot be a deck card",
        ),
        (
            "non-castle as castle",
            format!(
                "name=\"X\"\nowner=\"jp\"\ncastle=\"st1-002\"\ncards=[{good_cards}]\nsigil=\"\"\n"
            ),
            "not a castle",
        ),
        (
            "card not in the set",
            format!(
                "name=\"X\"\nowner=\"jp\"\ncastle=\"st1-000\"\ncards=[\"st1-099\", {}]\nsigil=\"\"\n",
                ids(n - 1)
            ),
            "not in the compiled set",
        ),
        (
            "empty owner",
            format!(
                "name=\"X\"\nowner=\"\"\ncastle=\"st1-000\"\ncards=[{good_cards}]\nsigil=\"\"\n"
            ),
            "owner",
        ),
    ];
    for (what, body, expect) in cases {
        let p = write_tmp("x", &body);
        let e = load(&p, &rules).expect_err(&format!("{what} should have been rejected"));
        assert!(
            e.message.contains(expect),
            "{what}: message {:?} does not mention {expect:?}",
            e.message
        );
    }
    // the stem check needs a file whose name disagrees with its `name`
    let p = write_tmp(
        "not-the-slug",
        &format!(
            "name=\"X\"\nowner=\"jp\"\ncastle=\"st1-000\"\ncards=[{good_cards}]\nsigil=\"\"\n"
        ),
    );
    let e = load(&p, &rules).expect_err("stem mismatch should have been rejected");
    assert!(e.message.contains("file stem"), "{:?}", e.message);
}

/// #147: at most `COPY_LIMIT` copies of one design. The control is the same list at exactly the
/// limit, so the rejection is the fourth copy's and nothing else's.
#[test]
fn a_fourth_copy_of_a_design_is_rejected_and_a_third_is_not() {
    assert_eq!(COPY_LIMIT, 3);
    let rules = HouseRules::default();
    let designs = Decks::default().designs(0);
    let at_limit: Vec<u16> = designs.iter().copied().cycle().take(DECK_SIZE).collect();
    let body = |cards: &[u16]| {
        let list = cards
            .iter()
            .map(|d| format!("\"st1-{d:03}\""))
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "name=\"Copy Limit\"\nowner=\"jp\"\ncastle=\"st1-000\"\ncards=[{list}]\nsigil=\"\"\n"
        )
    };
    let d = load(&write_tmp("copy-limit", &body(&at_limit)), &rules)
        .unwrap_or_else(|e| panic!("three copies each must load: {e}"));
    assert_eq!(d.most_copies(), COPY_LIMIT);

    let mut over = at_limit.clone();
    let last = over.len() - 1;
    over[last] = designs[0]; // a fourth copy of the first design, in place of another's third
    let e = load(&write_tmp("copy-limit", &body(&over)), &rules)
        .expect_err("a fourth copy must be refused");
    assert!(
        e.message
            .contains(&format!("4 copies of st1-{:03}", designs[0]))
            && e.message.contains("3"),
        "{:?}",
        e.message
    );
}

/// The shipped lists are #147's: 30 cards, ten designs, three of each, and every new design in
/// its faction's list.
#[test]
fn the_shipped_decks_are_ten_designs_at_three_copies() {
    let rules = HouseRules::default();
    for (name, new) in [
        ("ember-neutral", &[14u16, 15, 16, 17][..]),
        ("tide-neutral", &[18, 19][..]),
    ] {
        let d = load_named(name, &rules).unwrap_or_else(|e| panic!("{e}"));
        let t = d.copies();
        assert_eq!(d.cards.len(), 30, "{name}");
        assert_eq!(t.len(), 10, "{name}: {t:?}");
        assert!(t.values().all(|&n| n == COPY_LIMIT), "{name}: {t:?}");
        for c in new {
            assert_eq!(t.get(c), Some(&COPY_LIMIT), "{name} lacks st1-{c:03}");
        }
    }
    assert_eq!(
        DECK_SIZE,
        usize::from(rules.deck_size),
        "the sim's size is the house rule's"
    );
}

// ---- known-answer tests for the detectors ----------------------------------------------

use tapstone_rules::state::{Seat, Unit};
use tapstone_sim::divergence::{baseline, is_off_nearest};
use tapstone_sim::{Setup, play_seeded_setup, replay};

fn seat_with(cells: &[(usize, usize)]) -> Seat {
    let mut s = Seat::empty();
    for &(l, c) in cells {
        s.cells[l][c] = Some(Unit {
            design: 7,
            attack: 2,
            toughness: 3,
            damage: 0,
            keyword: None,
            entered_round: 0,
        });
    }
    s
}

/// The defect: `nearest_enemy` returned the first LANE at the front-most depth, so aiming at an
/// equally-forward unit in another lane read as a divergence. It is not a choice about depth at
/// all — it is a tie the picker resolves by lane order.
#[test]
fn removal_at_an_equally_forward_target_is_not_a_divergence() {
    let opp = seat_with(&[(0, 2), (2, 2)]); // two enemies, both in the front row
    assert!(
        !is_off_nearest(&opp, 2),
        "same depth in another lane is a tie, not a divergence"
    );
    assert!(
        is_off_nearest(&opp, 1),
        "the mid row IS behind the front row"
    );
    assert!(is_off_nearest(&opp, 0), "the back row certainly is");
}

#[test]
fn reaching_behind_is_judged_against_the_front_most_enemy() {
    let opp = seat_with(&[(1, 0)]); // one enemy, in the back row
    assert!(
        !is_off_nearest(&opp, 0),
        "the only enemy IS the nearest, wherever it stands"
    );
    assert!(
        !is_off_nearest(&Seat::empty(), 0),
        "no enemies, nothing to be off"
    );
}

/// Usefulness must come from the engine's report, not a label. On a fresh board every lane but
/// the commander's is empty (0029), so every advance there is legal and moves nothing, while an
/// advance in the commander's lane moves it.
#[test]
fn a_zero_move_advance_is_legal_and_not_useful() {
    let decks = [
        build_deck_from(5, 0, Decks::default()),
        build_deck_from(5, 1, Decks::default()),
    ];
    let g = Game::new(
        HouseRules::default(),
        tapstone_sim::CASTLES,
        [&decks[0], &decks[1]],
    )
    .started();
    let choices = legal_choices(&g, g.active);
    let commander_lane = tapstone_rules::state::COMMANDER_LANE as i8;
    let (in_commander_lane, empty): (Vec<_>, Vec<_>) = choices
        .iter()
        .filter(|c| c.tap.kind == Kind::Advance)
        .partition(|c| c.tap.lane == commander_lane);
    assert!(!empty.is_empty(), "advancing an empty lane is legal");
    assert!(
        empty.iter().all(|c| !c.is_useful(&g)),
        "an advance that moves nothing must not count as a resource"
    );
    assert!(
        !in_commander_lane.is_empty() && in_commander_lane.iter().all(|c| c.is_useful(&g)),
        "an advance that moves the commander is a real action"
    );
    assert!(
        choices
            .iter()
            .any(|c| c.tap.kind == Kind::Charge && c.is_useful(&g)),
        "charging is a real action"
    );
}

/// The control has to be for the seat the human played: the ranges genuinely differ.
#[test]
fn the_control_is_seat_specific() {
    let rules = HouseRules::default();
    let a = baseline(rules, 500, 12, Style::PlayOut, 0);
    let b = baseline(rules, 500, 12, Style::PlayOut, 1);
    assert_ne!(
        a, b,
        "seat 0 and seat 1 controls are identical — the seat is not being threaded"
    );
}

fn target_of(seat: u8, lane: u8, cell: u8) -> u8 {
    (seat << 4) | (lane << 2) | cell
}

/// The menu must not be a strict subset of the rules. Dropping own-side damage and destroy as
/// "strictly dominated" was wrong: `cast_unit` refuses with `CellOccupied`, so killing your own
/// spent unit to free an entry cell is a real tactic. Input is matched against the menu, so a move
/// the menu cannot express is a move the transcript can never record — in a tool built to find
/// what a person does that a picker cannot.
#[test]
fn a_damage_spell_may_be_aimed_at_your_own_unit() {
    let decks = [
        build_deck_from(5, 0, Decks::default()),
        build_deck_from(5, 1, Decks::default()),
    ];
    let mut g = Game::new(HouseRules::default(), CASTLES, [&decks[0], &decks[1]]).started();
    g.seats[0].cells[1][0] = Some(Unit {
        design: 8,
        attack: 1,
        toughness: 2,
        damage: 0,
        keyword: None,
        entered_round: 0,
    });
    g.seats[0].charged = 4;
    g.seats[0].spent = 0;
    g.seats[0].hand[0] = 9; // Tidal Lash — damage 3, units only
    g.seats[0].hand[1] = 12; // Mend — heal 2
    g.seats[0].hand_len = 2;

    let own = target_of(0, 1, 0);
    let choices = legal_choices(&g, 0);
    let burn = choices
        .iter()
        .find(|c| c.tap.kind == Kind::CastSpell && c.tap.card == 9 && c.tap.target == own)
        .expect("burning your own unit is legal and must be offered");
    assert!(
        burn.is_useful(&g),
        "it frees an entry cell — it is sometimes correct"
    );

    let heal = choices
        .iter()
        .find(|c| c.tap.kind == Kind::CastSpell && c.tap.card == 12 && c.tap.target == own)
        .expect("healing is offered even when pointless");
    assert!(
        !heal.is_useful(&g),
        "healing an undamaged unit does nothing"
    );
}

/// Mutating `declined-to-deploy` back to Advance-only failed nothing, so here is its guard: the
/// pickers cast while able to deploy often enough that narrowing it would show.
#[test]
fn declined_to_deploy_counts_casting_not_only_advancing() {
    let mut from_a_cast = 0;
    for seed in 1..=40u64 {
        let t = play_seeded_styled(seed, 500, HouseRules::default(), Style::PlayOut);
        from_a_cast += analyse(&t, 0)
            .unwrap()
            .iter()
            .filter(|f| f.kind == "declined-to-deploy" && f.detail.starts_with("cast "))
            .count();
    }
    assert!(
        from_a_cast > 0,
        "no cast-attributed findings — the detector is Advance-only again"
    );
}

/// Mutating `analyse()` back to rebuilding decks from the seed also failed nothing. With decks
/// that are not the default, a seed-rebuilt game holds different cards, the recorded taps stop
/// being legal, and the replay refuses — which is what this catches.
#[test]
fn the_analysis_reads_the_decks_the_game_was_played_with() {
    let t = play_seeded_setup(
        9,
        500,
        Setup {
            rules: HouseRules::default(),
            style: Style::PlayOut,
            decks: Decks::Swapped,
            ..Setup::default()
        },
    );
    assert!(replay(&t).is_ok(), "the transcript itself replays");
    assert!(
        analyse(&t, 0).is_ok(),
        "analysis rebuilt the decks from the seed and read a different game"
    );
}

// ---- balance's ad-hoc variant, per-seat records and mixed pickers (feat/sim-balance-adhoc) ----

use tapstone_sim::balance::{adhoc_variant, run_variant_setup};

/// The ad-hoc variant is the default rules with exactly the overrides given, and a run of it
/// reports those rules back — so a table row can't claim rules it didn't play.
#[test]
fn the_adhoc_variant_carries_the_given_house_rules() {
    let (label, rules) = adhoc_variant(Some(1), Some(16), Some(8), Some(12));
    let d = HouseRules::default();
    assert_eq!(
        rules,
        HouseRules {
            second_player_bonus: 1,
            castle_life: 16,
            pressure_from: 8,
            stop_round: 12,
            ..d
        }
    );
    assert_eq!(label, "b1 life16 from8 stop12");
    // Omitted overrides fall back to the defaults, not to zero.
    let (_, partial) = adhoc_variant(None, Some(10), None, None);
    assert_eq!(
        partial,
        HouseRules {
            castle_life: 10,
            ..d
        }
    );
    let run = run_variant_setup(
        &label,
        Setup {
            rules,
            ..Setup::default()
        },
        20,
        500,
        2,
    );
    assert_eq!(run.rules.castle_life, 16);
    assert_eq!(run.rules.pressure_from, 8);
    assert_eq!(run.rules.stop_round, 12);
    assert_eq!(run.rules.second_player_bonus, 1);
}

/// Records split by seat must add back up to the records counted per game, on real games, and
/// neither seat's share may be empty — a split that dumps everything on one seat also sums.
#[test]
fn records_by_seat_sum_to_the_records() {
    for decks in [Decks::Asymmetric, Decks::MirrorEmber, Decks::MirrorTide] {
        let run = run_variant_setup(
            "baseline",
            Setup {
                decks,
                ..Setup::default()
            },
            200,
            500,
            4,
        );
        let total = (run.mean_records * f64::from(run.games)).round() as u64;
        assert_eq!(
            run.records_by_seat[0] + run.records_by_seat[1],
            total,
            "{decks:?}: per-seat records must sum to the records"
        );
        assert!(
            run.records_by_seat[0] > 0 && run.records_by_seat[1] > 0,
            "{decks:?}: both seats commit records every game"
        );
        let g = f64::from(run.games);
        assert!((run.mean_records_by_seat[0] - run.records_by_seat[0] as f64 / g).abs() < 1e-9);
        assert!((run.mean_records_by_seat[1] - run.records_by_seat[1] as f64 / g).abs() < 1e-9);
    }
}

/// Seat 1's own picker must change the games; naming seat 1 the same picker as seat 0 must not.
#[test]
fn picker1_changes_the_result_and_the_same_picker_does_not() {
    let base = Setup {
        style: Style::PlayOut,
        decks: Decks::MirrorEmber,
        ..Setup::default()
    };
    let same = run_variant_setup("same", base, 200, 500, 4);
    let named_same = run_variant_setup(
        "same",
        Setup {
            style1: Some(Style::PlayOut),
            ..base
        },
        200,
        500,
        4,
    );
    assert_eq!(same, named_same, "style1 = style is the same-picker run");
    let mixed = run_variant_setup(
        "same",
        Setup {
            style1: Some(Style::PassEarly),
            ..base
        },
        200,
        500,
        4,
    );
    assert_ne!(
        (same.seat0_wins, same.records_by_seat),
        (mixed.seat0_wins, mixed.records_by_seat),
        "seat 1 on pass-early must play different games from seat 1 on play-out"
    );
}
