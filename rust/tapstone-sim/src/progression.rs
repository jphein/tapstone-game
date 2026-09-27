//! The arena's side of 0030/0031, as far as the sim needs it: turn a level and a loadout into the
//! final commander stats a `ClaimSeat` carries, and measure 0030's balance bound.
//!
//! The engine never sees any of this (0029); it lives here so the bound can be tested. When the
//! arena's ledger code exists it should share these tables, not copy them.
use tapstone_rules::{Commander, HouseRules};

use crate::balance::{BalanceRun, run_variant_setup};
use crate::{Decks, Setup, Style};

// The tables live in tapstone-progression so the arena derives ClaimSeat stats from the same
// object this bound run measures (arena spec D5). Re-exported so callers keep their paths.
pub use tapstone_progression::{
    ATTACK_AT, ITEM_KEYWORDS, Item, LEVEL_MAX, THIRD_SLOT_AT, TOUGHNESS_AT, commander_at,
    level_bonus, slots, try_commander_at,
};

/// Every DISTINCT legal full kit at max level, enumerated from the tables: every slot filled with
/// a look or a keyword, at most one keyword. Looks are free, so kits that differ only in looks
/// collapse to one commander, and the list is bare plus one per keyword.
pub fn max_loadouts() -> Vec<(String, Commander)> {
    let n = slots(LEVEL_MAX);
    let mut out: Vec<(String, Commander)> = Vec::new();
    for keyword in std::iter::once(None).chain(ITEM_KEYWORDS.iter().copied().map(Some)) {
        let mut gear = vec![Item::Look; n - usize::from(keyword.is_some())];
        gear.extend(keyword.map(Item::Keyword));
        let c = commander_at(LEVEL_MAX, &gear);
        if out.iter().any(|(_, o)| *o == c) {
            continue;
        }
        let kw = keyword.map_or(" bare".to_string(), |k| format!(" {k:?}"));
        out.push((format!("{}/{}{kw}", c.attack, c.toughness), c));
    }
    out
}

/// A veteran against a fresh level-1 commander on a mirror, with the veteran in each seat for
/// the same seed range. The mirror has a seat effect of its own (0026), so a one-seat number
/// would mix it into the commander's.
pub struct VeteranRun {
    /// Veteran in seat 0.
    pub seat0: BalanceRun,
    /// Veteran in seat 1.
    pub seat1: BalanceRun,
}

impl VeteranRun {
    pub fn veteran_wins_seat0(&self) -> f64 {
        self.seat0.seat0_win_rate()
    }
    pub fn veteran_wins_seat1(&self) -> f64 {
        1.0 - self.seat1.seat0_win_rate()
    }
    /// The seat-balanced rate: each seat weighted equally.
    pub fn veteran_win_rate(&self) -> f64 {
        (self.veteran_wins_seat0() + self.veteran_wins_seat1()) / 2.0
    }
    /// Veteran wins and games, pooled over both halves. The halves are the same size, so the
    /// pooled rate IS the seat-balanced mean.
    pub fn veteran_wins(&self) -> (u32, u32) {
        (
            self.seat0.seat0_wins + self.seat1.seat1_wins,
            self.seat0.games + self.seat1.games,
        )
    }
    /// 95% Wilson interval of the seat-balanced rate.
    pub fn interval(&self) -> (f64, f64) {
        let (k, n) = self.veteran_wins();
        wilson95(k, n)
    }
    /// Over the bound unless the WHOLE interval is at or under it (verification.md: a budget
    /// check asserts headroom, not non-exceedance).
    pub fn over(&self, bound: f64) -> bool {
        let (k, n) = self.veteran_wins();
        over_bound(k, n, bound)
    }

    pub fn verdict(&self, bound: f64) -> Verdict {
        let (k, n) = self.veteran_wins();
        verdict(k, n, bound)
    }
}

/// 95% Wilson score interval for `k` successes in `n` trials. Unlike the normal approximation it
/// keeps a nonzero width at p = 0 and p = 1, so a 100% cell is never reported as exact.
pub fn wilson95(k: u32, n: u32) -> (f64, f64) {
    if n == 0 {
        return (0.0, 1.0);
    }
    let z = 1.96f64;
    let (n, p) = (f64::from(n), f64::from(k) / f64::from(n));
    let denom = 1.0 + z * z / n;
    let centre = (p + z * z / (2.0 * n)) / denom;
    let half = z * (p * (1.0 - p) / n + z * z / (4.0 * n * n)).sqrt() / denom;
    ((centre - half).max(0.0), (centre + half).min(1.0))
}

/// `bound` is a fraction. True when the Wilson upper bound exceeds it.
pub fn over_bound(k: u32, n: u32, bound: f64) -> bool {
    verdict(k, n, bound) != Verdict::Clear
}

/// How a rate stands against a bound, judged on its 95% Wilson interval.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Verdict {
    /// The whole interval is under the bound: headroom shown.
    Clear,
    /// The interval straddles the bound: the sample has not decided. Rerun with more games.
    Unresolved,
    /// The whole interval is over the bound: a real breach at any sample size.
    Over,
}

pub fn verdict(k: u32, n: u32, bound: f64) -> Verdict {
    let (lo, hi) = wilson95(k, n);
    if hi <= bound {
        Verdict::Clear
    } else if lo > bound {
        Verdict::Over
    } else {
        Verdict::Unresolved
    }
}

pub fn veteran_vs_fresh(
    veteran: Commander,
    style: Style,
    games: u32,
    taps: usize,
    jobs: usize,
) -> VeteranRun {
    veteran_vs_fresh_on(
        veteran,
        HouseRules::default(),
        style,
        Decks::MirrorEmber,
        games,
        taps,
        jobs,
    )
}

pub fn veteran_vs_fresh_on(
    veteran: Commander,
    rules: HouseRules,
    style: Style,
    decks: Decks,
    games: u32,
    taps: usize,
    jobs: usize,
) -> VeteranRun {
    let fresh = Commander::LEVEL_1;
    let run = |commanders| {
        run_variant_setup(
            "veteran",
            Setup {
                rules,
                style,
                style1: None,
                decks,
                commanders,
            },
            games,
            taps,
            jobs,
        )
    };
    VeteranRun {
        seat0: run([veteran, fresh]),
        seat1: run([fresh, veteran]),
    }
}
