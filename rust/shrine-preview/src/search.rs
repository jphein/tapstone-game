//! Bounded searches for engine states the station's view overrides stand in for.
//!
//! Each override is justified only if no real game reaches its state within a stated bound, so
//! the search, its bound and its answer are code, and the fixtures and captions read them.

use tapstone_rules::state::{COMMANDER_DESIGN, Game, Phase};
use tapstone_sim::{Decks, Setup, Style};

use crate::game;

/// The search bound for every state: seeds `0..SEEDS`, under every picker and deck pairing below.
pub const SEEDS: u64 = 2000;
pub const STYLES: [Style; 2] = [Style::PlayOut, Style::PassEarly];
pub const DECKS: [Decks; 3] = [Decks::Asymmetric, Decks::MirrorEmber, Decks::MirrorTide];

/// Where a real state was found: the game that reaches it and the record after which it holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Found {
    pub seed: u64,
    pub style: Style,
    pub decks: Decks,
    /// Records applied before the state (the transition's before-state) and after it.
    pub record: usize,
}

/// The states searched for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Wanted {
    /// Seat 0's commander, on the board, healed: its damage goes down in one record.
    Heal,
    /// Seat 0's commander, on the board, struck and surviving: its damage goes up in one record.
    Struck,
    /// Seat 0's commander fallen past its return round, waiting on an occupied back cell (0029).
    BlockedReturn,
    /// Seat 0 in play with no undrawn copies left (0036's exhausted deck).
    ExhaustedDeck,
}

pub const WANTED: [Wanted; 4] = [
    Wanted::Heal,
    Wanted::Struck,
    Wanted::BlockedReturn,
    Wanted::ExhaustedDeck,
];

fn commander_damage(g: &Game) -> Option<u8> {
    g.seats[0]
        .cells
        .iter()
        .flatten()
        .flatten()
        .find(|u| u.design == COMMANDER_DESIGN)
        .map(|u| u.damage)
}

/// Does the transition `before -> after` show the wanted state?
pub fn matches(w: Wanted, before: &Game, after: &Game) -> bool {
    match w {
        Wanted::Heal => matches!(
            (commander_damage(before), commander_damage(after)),
            (Some(b), Some(a)) if a < b
        ),
        Wanted::Struck => matches!(
            (commander_damage(before), commander_damage(after)),
            (Some(b), Some(a)) if a > b
        ),
        Wanted::BlockedReturn => {
            let c = after.seats[0].commander;
            let back = after.seats[0].cells[c.lane as usize][0];
            after.phase == Phase::Playing
                && c.returns > 0
                && after.round > c.returns
                && back.is_some_and(|u| u.design != COMMANDER_DESIGN)
        }
        Wanted::ExhaustedDeck => after.phase == Phase::Playing && after.seats[0].deck_len == 0,
    }
}

/// The setup a search game plays under: the fixtures' commanders, with the picker and decks varied.
pub fn setup(style: Style, decks: Decks) -> Setup {
    Setup {
        style,
        decks,
        ..crate::station::setup()
    }
}

/// What a search saw, so a "none found" can be checked for blindness: how many games replayed,
/// how many failed to, and how many records were examined.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Coverage {
    pub games: usize,
    pub errors: usize,
    pub records: usize,
}

/// Search every seed, picker and pairing, one replay per game, for all of `WANTED` at once, under
/// `rules`. Returns the first find for each (in `WANTED` order) and the coverage.
pub fn search_with(rules: tapstone_rules::HouseRules) -> ([Option<Found>; 4], Coverage) {
    let mut found = [None; 4];
    let mut cov = Coverage::default();
    'all: for decks in DECKS {
        for style in STYLES {
            for seed in 0..SEEDS {
                cov.games += 1;
                let setup = Setup {
                    rules,
                    ..setup(style, decks)
                };
                let r = game::each_transition(seed, 400, setup, |b, a, record| {
                    cov.records += 1;
                    for (i, w) in WANTED.iter().enumerate() {
                        if found[i].is_none() && matches(*w, b, a) {
                            found[i] = Some(Found {
                                seed,
                                style,
                                decks,
                                record,
                            });
                        }
                    }
                    found.iter().all(Option::is_some)
                });
                cov.errors += r.is_err() as usize;
                if found.iter().all(Option::is_some) {
                    break 'all;
                }
            }
        }
    }
    (found, cov)
}

/// The search at the default table.
pub fn search() -> ([Option<Found>; 4], Coverage) {
    search_with(tapstone_rules::HouseRules::default())
}
