//! Host-side harness for the Tapstone rules: scripted seats, an arbiter that commits taps and
//! keeps the hash chain, and JSON transcripts with golden games.
pub mod arbiter;
pub mod balance;
pub mod deck;
pub mod divergence;
pub mod human;
pub mod physical;
pub mod progression;
pub mod replay;
pub mod seat;
pub mod transcript;

use rand::SeedableRng;
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use tapstone_rules::state::{DECK_MAX, SEATS};
use tapstone_rules::{Commander, Game, HouseRules, Kind, Phase, Record};

pub use arbiter::{Arbiter, Committed};
pub use replay::{Replay, ReplayError, replay};
pub use seat::{ScriptedSeat, Style};
pub use transcript::Transcript;

/// Seat 0 plays Ember + Neutral, seat 1 Tide + Neutral: #147's lists (2026-09-27), each its
/// faction's eight designs plus the two neutrals, cycled to three copies of each.
pub const DECK_DESIGNS: [&[u16]; SEATS] = [
    &[2, 3, 4, 5, 14, 15, 16, 17, 11, 12],
    &[6, 7, 8, 9, 10, 13, 18, 19, 11, 12],
];
pub const CASTLES: [u16; SEATS] = [0, 1];
/// `HouseRules::default().deck_size`; `tests/balance.rs` holds the two equal.
pub const DECK_SIZE: usize = 30;

/// Which decks the two seats hold. A mirror is the control that separates a SEAT effect from a
/// DECK effect, and until now it needed a source edit — which meant the one experiment that can
/// tell those apart was the one nobody could reproduce.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Decks {
    /// Seat 0 Ember + Neutral, seat 1 Tide + Neutral — the shipped pairing.
    #[default]
    Asymmetric,
    /// Both seats play seat 0's list. Any asymmetry left is the seat's, not the deck's.
    MirrorEmber,
    /// Both seats play seat 1's list.
    MirrorTide,
    /// Seat 0 takes Tide, seat 1 takes Ember: does the edge follow the seat or the cards?
    Swapped,
}

impl Decks {
    pub fn designs(self, seat: u8) -> &'static [u16] {
        let (a, b) = (DECK_DESIGNS[0], DECK_DESIGNS[1]);
        match (self, seat) {
            (Decks::Asymmetric, s) => DECK_DESIGNS[s as usize],
            (Decks::MirrorEmber, _) => a,
            (Decks::MirrorTide, _) => b,
            (Decks::Swapped, 0) => b,
            (Decks::Swapped, _) => a,
        }
    }

    pub fn parse(name: &str) -> Option<Decks> {
        Some(match name {
            "asymmetric" => Decks::Asymmetric,
            "mirror-ember" => Decks::MirrorEmber,
            "mirror-tide" => Decks::MirrorTide,
            "swapped" => Decks::Swapped,
            _ => return None,
        })
    }
}

/// Everything that makes a game other than its seed. Bundled because these travel together and a
/// balance number is meaningless without all of them.
#[derive(Clone, Copy, Debug)]
pub struct Setup {
    pub rules: HouseRules,
    pub style: Style,
    /// Seat 1's picker, when it differs from seat 0's. `None` is the same picker as `style`, which
    /// is every run before mixed pickers existed, so no golden or baseline moves.
    pub style1: Option<Style>,
    pub decks: Decks,
    /// Each seat's commander, final stats as the arena would derive them (0029–0031).
    pub commanders: [Commander; SEATS],
}

impl Default for Setup {
    fn default() -> Self {
        Setup {
            rules: HouseRules::default(),
            style: Style::default(),
            style1: None,
            decks: Decks::default(),
            commanders: [Commander::LEVEL_1; SEATS],
        }
    }
}

/// Cycle the seat's design list to `DECK_SIZE` cards, then shuffle with a seat-specific stream.
pub fn build_deck(seed: u64, seat: u8) -> Vec<u16> {
    build_deck_from(seed, seat, Decks::default())
}

pub fn build_deck_from(seed: u64, seat: u8, decks: Decks) -> Vec<u16> {
    let list: Vec<u16> = decks
        .designs(seat)
        .iter()
        .copied()
        .cycle()
        .take(DECK_SIZE.min(DECK_MAX))
        .collect();
    shuffle_for(seed, seat, list)
}

/// The seat's shuffle, factored out so a deck loaded from `decks/*.toml` and the compiled-in
/// default go through exactly the same stream. If they did not, a deck file expressing today's
/// list would still produce a different game, and the goldens would move for no reason.
pub fn shuffle_for(seed: u64, seat: u8, mut deck: Vec<u16>) -> Vec<u16> {
    let stream = seed ^ (seat as u64 + 1).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    deck.shuffle(&mut StdRng::seed_from_u64(stream));
    deck
}

/// A bare tap: the arbiter fills seq, time_ms, uid and auth.
pub fn tap(seat: u8, kind: Kind, card: u16, lane: i8, target: u8, aux: u8) -> Record {
    Record {
        seq: 0,
        seat,
        kind,
        card,
        lane,
        target,
        aux,
        time_ms: 0,
        uid: [0; 7],
        auth: 0,
    }
}

/// A `ClaimSeat` tap carrying the commander's final stats: `target` = attack, `aux` = toughness,
/// `lane` = keyword code or -1 (0029).
pub fn claim(seat: u8, castle: u16, c: Commander) -> Record {
    let kw = c.keyword.map_or(-1, |k| k.code() as i8);
    tap(seat, Kind::ClaimSeat, castle, kw, c.attack, c.toughness)
}

/// Play one seeded game to the end (or `max_taps` attempts) under the default house rules.
pub fn play_seeded(seed: u64, max_taps: usize) -> Transcript {
    play_seeded_with(seed, max_taps, HouseRules::default())
}

/// Play one seeded game under `rules`. Pure in `(seed, max_taps, rules)`: the decks, both seats and
/// every tap derive from the seed, so the same arguments always give the same transcript.
pub fn play_seeded_with(seed: u64, max_taps: usize, rules: HouseRules) -> Transcript {
    play_seeded_styled(seed, max_taps, rules, Style::default())
}

/// As `play_seeded_with`, choosing the seat picker. Every balance number is conditional on the
/// picker that produced it, so the picker is an input rather than a constant.
pub fn play_seeded_styled(
    seed: u64,
    max_taps: usize,
    rules: HouseRules,
    style: Style,
) -> Transcript {
    play_seeded_setup(
        seed,
        max_taps,
        Setup {
            rules,
            style,
            ..Setup::default()
        },
    )
}

/// The honest entry point: rules, picker and decks are all inputs.
pub fn play_seeded_setup(seed: u64, max_taps: usize, setup: Setup) -> Transcript {
    let (arbiter, decks) = play_seeded_parts(seed, max_taps, setup);
    Transcript::from_arbiter(seed, &arbiter, decks)
}

/// The game behind `play_seeded_with`, with the arbiter kept so a caller can read the final board
/// (castle life) that the transcript does not carry.
pub(crate) fn play_seeded_parts(
    seed: u64,
    max_taps: usize,
    setup: Setup,
) -> (Arbiter, [Vec<u16>; 2]) {
    let (rules, style) = (setup.rules, setup.style);
    let style1 = setup.style1.unwrap_or(style);
    let decks = [
        build_deck_from(seed, 0, setup.decks),
        build_deck_from(seed, 1, setup.decks),
    ];
    let game = Game::new(rules, CASTLES, [&decks[0], &decks[1]]);
    let mut arbiter = Arbiter::new(game);
    let mut seats = [
        ScriptedSeat::with_style(seed, 0, style),
        ScriptedSeat::with_style(seed, 1, style1),
    ];
    // 0036: the engine gets the lists; the paper order lives here, drawn from the top by taps.
    let mut paper = physical::PhysicalDecks::new(seed, decks.clone());

    // Lobby: seat 1 claims first so `Started` comes from seat 0's claim.
    arbiter
        .commit(claim(1, CASTLES[1], setup.commanders[1]))
        .expect("seat 1 claim");
    arbiter
        .commit(claim(0, CASTLES[0], setup.commanders[0]))
        .expect("seat 0 claim");

    let mut attempts = 0;
    let mut refused_in_a_row = 0;
    while arbiter.game.phase == Phase::Playing && attempts < max_taps {
        // Every owed draw is tapped first (both seats: the off-turn seat's opening hand too). Draw
        // taps do not count against `max_taps`, which budgets the seats' decisions.
        paper.pay(&mut arbiter);
        if arbiter.game.phase != Phase::Playing {
            break;
        }
        let active = arbiter.game.active;
        let next = seats[active as usize].next_tap(&arbiter.game);
        attempts += 1;
        match arbiter.commit(next) {
            Ok(_) => refused_in_a_row = 0,
            Err(_) => {
                refused_in_a_row += 1;
                if refused_in_a_row >= 3 {
                    arbiter
                        .commit(tap(active, Kind::Pass, 0, -1, 0, 0))
                        .expect("a pass by the active seat is always legal");
                    refused_in_a_row = 0;
                }
            }
        }
    }
    (arbiter, decks)
}
