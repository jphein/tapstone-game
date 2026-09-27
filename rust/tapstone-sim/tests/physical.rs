//! The sim's paper deck (0036): what a player at the table does, so the sim taps draws as they do.
use tapstone_rules::{Commander, Game, HouseRules, Kind, Phase};
use tapstone_sim::physical::PhysicalDecks;
use tapstone_sim::{Arbiter, CASTLES, ScriptedSeat, build_deck, claim, tap};

fn sorted(xs: &[u16]) -> Vec<u16> {
    let mut v = xs.to_vec();
    v.sort_unstable();
    v
}

fn start(seed: u64) -> (Arbiter, PhysicalDecks, [Vec<u16>; 2]) {
    let decks = [build_deck(seed, 0), build_deck(seed, 1)];
    let mut a = Arbiter::new(Game::new(
        HouseRules::default(),
        CASTLES,
        [&decks[0], &decks[1]],
    ));
    a.commit(claim(1, CASTLES[1], Commander::LEVEL_1)).unwrap();
    a.commit(claim(0, CASTLES[0], Commander::LEVEL_1)).unwrap();
    let paper = PhysicalDecks::new(seed, decks.clone());
    (a, paper, decks)
}

#[test]
fn the_opening_hands_are_the_top_of_the_shuffle() {
    // The paper order is the shuffle the sim always used, so a game draws exactly the cards it
    // drew when the engine held the order, until a mulligan.
    for seed in 1..=20u64 {
        let (mut a, mut paper, decks) = start(seed);
        paper.pay(&mut a);
        for (s, deck) in decks.iter().enumerate() {
            let n = a.game.seats[s].hand_len();
            assert_eq!(n, 5 + s, "seed {seed} seat {s}");
            assert_eq!(
                &a.game.seats[s].hand[..n],
                &deck[..n],
                "seed {seed} seat {s}"
            );
        }
        let draws = a
            .records
            .iter()
            .filter(|c| c.record.kind == Kind::Draw)
            .count();
        assert_eq!(draws, 11, "every opening card is a Draw record");
    }
}

#[test]
fn after_paying_the_paper_deck_is_exactly_the_engines_list() {
    for seed in 1..=40u64 {
        let (mut a, mut paper, _) = start(seed);
        let mut seats = [ScriptedSeat::new(seed, 0), ScriptedSeat::new(seed, 1)];
        let (mut refused, mut mulligans) = (0, 0);
        for _ in 0..500 {
            paper.pay(&mut a);
            if a.game.phase != Phase::Playing {
                break;
            }
            for s in 0..2u8 {
                let g = &a.game.seats[s as usize];
                assert_eq!(
                    g.owed_draws(),
                    0,
                    "seed {seed}: seat {s} still owes after paying"
                );
                assert_eq!(
                    sorted(paper.paper(s)),
                    sorted(&g.deck[..g.deck_len as usize]),
                    "seed {seed} seat {s}"
                );
            }
            let act = a.game.active;
            let r = seats[act as usize].next_tap(&a.game);
            if r.kind == Kind::Mulligan {
                mulligans += 1;
            }
            if a.commit(r).is_err() {
                refused += 1;
                if refused >= 3 {
                    a.commit(tap(act, Kind::Pass, 0, -1, 0, 0)).unwrap();
                    refused = 0;
                }
            } else {
                refused = 0;
            }
        }
        let _ = mulligans;
    }
}

#[test]
fn a_mulligan_is_visible_to_the_invariant() {
    // Positive control for the test above: find a seed whose scripted seat mulligans, and check
    // the returned hand really is back in the paper deck after paying, not just in the engine.
    for seed in 1..=200u64 {
        let (mut a, mut paper, _) = start(seed);
        paper.pay(&mut a);
        let hand: Vec<u16> = a.game.seats[0].hand[..5].to_vec();
        if a.commit(tap(0, Kind::Mulligan, 0, -1, 0, 0)).is_ok() {
            assert_eq!(a.game.seats[0].owed_draws(), 5);
            paper.pay(&mut a);
            let g = &a.game.seats[0];
            let mut all = paper.paper(0).to_vec();
            all.extend_from_slice(&g.hand[..g.hand_len()]);
            for c in hand {
                assert!(all.contains(&c), "seed {seed}: a returned card vanished");
            }
            assert_eq!(
                sorted(paper.paper(0)),
                sorted(&g.deck[..g.deck_len as usize])
            );
            return;
        }
    }
    panic!("no seed allowed a mulligan");
}
