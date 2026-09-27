//! A scripted seat: a seeded, weighted random player that chooses kind/card/lane/target/aux only.
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use tapstone_rules::cards::design;
use tapstone_rules::state::{CELLS, LANES, Seat};
use tapstone_rules::{CardKind, Effect, Game, Keyword, Kind, Record};

use crate::tap;

pub struct ScriptedSeat {
    rng: StdRng,
    seat: u8,
    style: Style,
}

#[derive(Clone, Copy)]
enum Category {
    Charge,
    Unit,
    Spell,
    Advance,
    Pass,
}

/// How a seat decides when to STOP acting. The weights choosing *which* action are identical in
/// both; only the stopping condition differs, because that is the whole finding: Oracle rebuilt
/// this picker, validated it at 0 differing games over 2000, changed only the stopping rule, and
/// the Ember/Tide gap reversed. The choices were never the artefact — the activity level was.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Style {
    /// Keep acting while any legal action remains; pass only when none does.
    #[default]
    PlayOut,
    /// The shipped behaviour up to 2026-09-21: the weighted roll picks a STARTING point in the
    /// category order and a roll landing on Pass ends the turn with mana, cards and un-advanced
    /// lanes still in hand. Kept reachable on purpose — every balance number is conditional on
    /// its picker, so the honest end state reports a range across pickers, not one number.
    PassEarly,
}

const ORDER: [Category; 5] = [
    Category::Charge,
    Category::Unit,
    Category::Spell,
    Category::Advance,
    Category::Pass,
];
/// Cumulative weights 40/30/10/10/10 over ORDER.
const CUMULATIVE: [u32; 5] = [40, 70, 80, 90, 100];

impl ScriptedSeat {
    pub fn new(seed: u64, seat: u8) -> ScriptedSeat {
        ScriptedSeat::with_style(seed, seat, Style::default())
    }

    pub fn with_style(seed: u64, seat: u8, style: Style) -> ScriptedSeat {
        ScriptedSeat {
            rng: StdRng::seed_from_u64(seed ^ 0xA5A5u64.wrapping_mul(seat as u64 + 1)),
            seat,
            style,
        }
    }

    pub fn next_tap(&mut self, g: &Game) -> Record {
        let me = &g.seats[self.seat as usize];
        if !me.acted() && !me.mulliganed() && self.rng.random_bool(0.25) {
            return tap(self.seat, Kind::Mulligan, 0, -1, 0, 0);
        }
        let pass = tap(self.seat, Kind::Pass, 0, -1, 0, 0);
        match self.style {
            Style::PassEarly => {
                let roll = self.rng.random_range(0..100u32);
                let start = CUMULATIVE
                    .iter()
                    .position(|&c| roll < c)
                    .unwrap_or(ORDER.len() - 1);
                for cat in &ORDER[start..] {
                    let pick = match cat {
                        Category::Charge => self.charge(me),
                        Category::Unit => self.unit(me),
                        Category::Spell => self.spell(g, me),
                        Category::Advance => self.advance(me),
                        Category::Pass => Some(pass),
                    };
                    if let Some(r) = pick {
                        return r;
                    }
                }
                pass
            }
            // Offer every action that is actually available, then pick among THOSE by the same
            // relative weights. Pass is not a candidate while anything else is legal, so a turn
            // ends because the seat is out of moves rather than because a die said so.
            Style::PlayOut => {
                let candidates = [
                    (40u32, self.charge(me)),
                    (30, self.unit(me)),
                    (10, self.spell(g, me)),
                    (10, self.advance(me)),
                ];
                let live: Vec<(u32, Record)> = candidates
                    .into_iter()
                    .filter_map(|(w, r)| r.map(|r| (w, r)))
                    .collect();
                let total: u32 = live.iter().map(|(w, _)| *w).sum();
                if total == 0 {
                    return pass;
                }
                let mut roll = self.rng.random_range(0..total);
                for (w, r) in live {
                    if roll < w {
                        return r;
                    }
                    roll -= w;
                }
                pass
            }
        }
    }

    fn hand<'a>(&self, me: &'a Seat) -> &'a [u16] {
        &me.hand[..me.hand_len()]
    }

    /// Charge the cheapest card in hand, once per round.
    fn charge(&self, me: &Seat) -> Option<Record> {
        if me.charged_this_round() {
            return None;
        }
        let card = self
            .hand(me)
            .iter()
            .copied()
            .min_by_key(|&c| design(c).map_or(u8::MAX, |d| d.cost))?;
        Some(tap(self.seat, Kind::Charge, card, -1, 0, 0))
    }

    /// The most expensive affordable unit into the lane with the fewest own units whose entry cell is free.
    fn unit(&self, me: &Seat) -> Option<Record> {
        let mana = me.available_mana();
        let mut best: Option<(u8, u16, usize)> = None;
        for &card in self.hand(me) {
            let Some(d) = design(card) else { continue };
            let CardKind::Unit { keyword, .. } = d.kind else {
                continue;
            };
            if d.cost > mana {
                continue;
            }
            let entry = if keyword == Some(Keyword::Rush) { 1 } else { 0 };
            if best.is_none_or(|(cost, _, _)| d.cost > cost) {
                best = Some((d.cost, card, entry));
            }
        }
        let (_, card, entry) = best?;
        let lane = (0..LANES)
            .filter(|&l| me.cells[l][entry].is_none())
            .min_by_key(|&l| me.cells[l].iter().flatten().count())?;
        Some(tap(self.seat, Kind::CastUnit, card, lane as i8, 0, 0))
    }

    /// The first affordable spell in hand that has a target.
    fn spell(&self, g: &Game, me: &Seat) -> Option<Record> {
        let mana = me.available_mana();
        let opp_idx = 1 - (self.seat & 1) as usize;
        let opp = &g.seats[opp_idx];
        for &card in self.hand(me) {
            let Some(d) = design(card) else { continue };
            let CardKind::Spell(effect) = d.kind else {
                continue;
            };
            if d.cost > mana {
                continue;
            }
            let (target, aux) = match effect {
                Effect::Damage { castle_ok, .. } => match nearest_enemy(opp) {
                    Some((l, c)) => (target_byte(opp_idx, l, c), 0),
                    None if castle_ok => (0xFF, 0),
                    None => continue,
                },
                Effect::Heal { .. } => match most_damaged(me) {
                    Some((l, c)) => (target_byte(self.seat as usize, l, c), 0),
                    None => continue,
                },
                Effect::Destroy { max_toughness } => {
                    match enemy_with_toughness_at_most(opp, max_toughness) {
                        Some((l, c)) => (target_byte(opp_idx, l, c), 0),
                        None => continue,
                    }
                }
                Effect::Shift => match shiftable_enemy(opp) {
                    Some((l, c, aux)) => (target_byte(opp_idx, l, c), aux),
                    None => continue,
                },
                Effect::Draw { .. } => (0, 0),
            };
            return Some(tap(self.seat, Kind::CastSpell, card, -1, target, aux));
        }
        None
    }

    /// Advance a random lane where the seat has units and has not advanced yet this turn.
    fn advance(&mut self, me: &Seat) -> Option<Record> {
        let lanes: Vec<usize> = (0..LANES)
            .filter(|&l| !me.lane_advanced(l) && me.cells[l].iter().any(Option::is_some))
            .collect();
        if lanes.is_empty() {
            return None;
        }
        let lane = lanes[self.rng.random_range(0..lanes.len())];
        Some(tap(self.seat, Kind::Advance, 0, lane as i8, 0, 0))
    }
}

fn target_byte(seat: usize, lane: usize, cell: usize) -> u8 {
    ((seat as u8) << 4) | ((lane as u8) << 2) | cell as u8
}

/// Front-most enemy unit, scanning cells front to back and lanes low to high.
fn nearest_enemy(opp: &Seat) -> Option<(usize, usize)> {
    (0..CELLS).rev().find_map(|c| {
        (0..LANES)
            .find(|&l| opp.cells[l][c].is_some())
            .map(|l| (l, c))
    })
}

fn most_damaged(me: &Seat) -> Option<(usize, usize)> {
    let mut best: Option<(u8, usize, usize)> = None;
    for (l, lane) in me.cells.iter().enumerate() {
        for (c, cell) in lane.iter().enumerate() {
            if let Some(u) = cell
                && u.damage > 0
                && best.is_none_or(|(d, _, _)| u.damage > d)
            {
                best = Some((u.damage, l, c));
            }
        }
    }
    best.map(|(_, l, c)| (l, c))
}

fn enemy_with_toughness_at_most(opp: &Seat, max: u8) -> Option<(usize, usize)> {
    for (l, lane) in opp.cells.iter().enumerate() {
        for (c, cell) in lane.iter().enumerate() {
            if cell.is_some_and(|u| u.toughness <= max) {
                return Some((l, c));
            }
        }
    }
    None
}

/// An enemy unit with a free neighbouring cell in an adjacent lane; aux 0 = toward lane 0, 1 = toward lane 2.
fn shiftable_enemy(opp: &Seat) -> Option<(usize, usize, u8)> {
    for (l, lane) in opp.cells.iter().enumerate() {
        for (c, cell) in lane.iter().enumerate() {
            if cell.is_none() {
                continue;
            }
            if l > 0 && opp.cells[l - 1][c].is_none() {
                return Some((l, c, 0));
            }
            if l + 1 < LANES && opp.cells[l + 1][c].is_none() {
                return Some((l, c, 1));
            }
        }
    }
    None
}
