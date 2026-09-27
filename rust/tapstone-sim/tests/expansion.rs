//! Set 1's expansion (#147, approved 2026-09-27): the shipped decks reach the engine as 30 cards,
//! three of each of ten designs, and every new design is actually cast. Ported from the proposal's
//! evidence branch (`scratch/pollux-expansion-sim`, `tests/proposed.rs`), where each check was
//! perturbed once and seen red.
use std::collections::BTreeMap;
use tapstone_rules::{Game, HouseRules};
use tapstone_sim::balance::run_variant_setup;
use tapstone_sim::{CASTLES, DECK_SIZE, Decks, Setup, Style, build_deck_from};

const NEW_EMBER: [u16; 4] = [14, 15, 16, 17];
const NEW_TIDE: [u16; 2] = [18, 19];

fn tally(deck: &[u16]) -> BTreeMap<u16, u32> {
    let mut m = BTreeMap::new();
    for &c in deck {
        *m.entry(c).or_insert(0) += 1;
    }
    m
}

#[test]
fn each_deck_is_thirty_cards_three_of_ten_designs() {
    for (decks, seat, new) in [
        (Decks::MirrorEmber, 0u8, &NEW_EMBER[..]),
        (Decks::MirrorTide, 1, &NEW_TIDE[..]),
    ] {
        let deck = build_deck_from(7, seat, decks);
        assert_eq!(deck.len(), 30, "{decks:?}");
        let t = tally(&deck);
        assert_eq!(t.len(), 10, "{decks:?}: {t:?}");
        assert!(t.values().all(|&n| n == 3), "{decks:?}: {t:?}");
        for c in new {
            assert_eq!(t.get(c), Some(&3), "{decks:?} lacks new design {c}");
        }
    }
}

#[test]
fn the_engine_holds_all_thirty() {
    let rules = HouseRules::default();
    assert_eq!(usize::from(rules.deck_size), DECK_SIZE);
    let d = [
        build_deck_from(3, 0, Decks::default()),
        build_deck_from(3, 1, Decks::default()),
    ];
    let g = Game::new(rules, CASTLES, [&d[0], &d[1]]);
    assert_eq!(g.seats[0].deck_len, 30);
    assert_eq!(g.seats[1].deck_len, 30);
}

#[test]
fn every_new_card_is_actually_cast() {
    let run = run_variant_setup(
        "expansion",
        Setup {
            style: Style::PlayOut,
            ..Setup::default()
        },
        200,
        500,
        4,
    );
    assert_eq!(run.rules.deck_size, 30);
    for name in [
        "Forge Runner",
        "Bellows Raider",
        "Slag Brute",
        "Magma Burst",
        "Brine Skimmer",
        "Trench Leviathan",
    ] {
        assert!(
            run.mean_casts(name) > 0.1,
            "{name}: {}",
            run.mean_casts(name)
        );
    }
}
