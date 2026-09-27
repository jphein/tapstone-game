//! Cards or picker? A second picker with different priorities, measured against the shipped one.
//!
//! Preserved as-run. This is the harness that showed the Ember/Tide gap is an artefact of the
//! shipped picker stopping early — it reverses under a picker that plays out its turn — and the
//! numbers quoted in `docs/design/rules-v0.md` came from exactly this code. Its worth is that it
//! is unmodified, so the lints below are silenced rather than refactored away: "cleaning up" the
//! shadow combat model's index loops is precisely the edit that could break the property the
//! whole thing rests on, which is that it reproduces the engine's own `combat_damage` exactly.
//! Its own positive controls are the guard: the replica must match `ScriptedSeat` on every game,
//! and the shadow model must match the engine on every combat. If either stops holding, the
//! numbers stop being attributable to this file.
#![allow(
    unused_variables,
    dead_code,
    clippy::needless_range_loop,
    clippy::match_single_binding
)]
//! Positive control: the same code with the shipped policies must reproduce ScriptedSeat exactly.
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};
use tapstone_rules::cards::{Keyword, design};
use tapstone_rules::state::Unit;
use tapstone_rules::state::{CELLS, DECK_MAX, LANES, Seat};
use tapstone_rules::{
    Applied, CardKind, Commander, Effect, Game, HouseRules, Kind, Phase, Record, Winner,
};
use tapstone_sim::{Arbiter, CASTLES, DECK_DESIGNS, ScriptedSeat, build_deck, claim, tap};

const DECK_SIZE: usize = 25;

fn deck_from(list: &[u16], seed: u64, seat: u8) -> Vec<u16> {
    let mut d: Vec<u16> = list
        .iter()
        .copied()
        .cycle()
        .take(DECK_SIZE.min(DECK_MAX))
        .collect();
    let stream = seed ^ (seat as u64 + 1).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    d.shuffle(&mut StdRng::seed_from_u64(stream));
    d
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum UnitPick {
    Expensive,
    FastFront,
}
#[derive(Clone, Copy, PartialEq, Debug)]
enum AdvPick {
    Random,
    Progress,
}
#[derive(Clone, Copy, PartialEq, Debug)]
enum RemPick {
    Nearest,
    Biggest,
}
#[derive(Clone, Copy, PartialEq, Debug)]
enum Cats {
    Weighted,
    FullTurn,
}

#[derive(Clone, Copy, Debug)]
struct Policy {
    unit: UnitPick,
    adv: AdvPick,
    rem: RemPick,
    cats: Cats,
}
const SHIPPED: Policy = Policy {
    unit: UnitPick::Expensive,
    adv: AdvPick::Random,
    rem: RemPick::Nearest,
    cats: Cats::Weighted,
};
const TACTICIAN: Policy = Policy {
    unit: UnitPick::FastFront,
    adv: AdvPick::Progress,
    rem: RemPick::Biggest,
    cats: Cats::FullTurn,
};

#[derive(Clone, Copy, PartialEq)]
enum Cat {
    Charge,
    Unit,
    Spell,
    Advance,
    Pass,
}

struct Picker {
    rng: StdRng,
    seat: u8,
    p: Policy,
}

/// Turns from now until this design could stand in a front cell, if summoned this turn.
/// Entry is cell 0, or cell 1 with Rush; a unit may advance the turn it enters only with Haste.
fn turns_to_front(kw: Option<Keyword>) -> u8 {
    match kw {
        Some(Keyword::Rush) => 1,  // enters mid, one advance next turn
        Some(Keyword::Haste) => 1, // enters back, advances immediately, one more next turn
        _ => 2,                    // enters back, cannot advance this turn
    }
}

impl Picker {
    fn new(seed: u64, seat: u8, p: Policy) -> Self {
        Picker {
            rng: StdRng::seed_from_u64(seed ^ 0xA5A5u64.wrapping_mul(seat as u64 + 1)),
            seat,
            p,
        }
    }
    fn hand<'a>(&self, me: &'a Seat) -> &'a [u16] {
        &me.hand[..me.hand_len()]
    }

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

    fn unit(&self, me: &Seat) -> Option<Record> {
        let mana = me.available_mana();
        let mut best: Option<(u8, u16, usize)> = None;
        for &card in self.hand(me) {
            let Some(d) = design(card) else { continue };
            let CardKind::Unit {
                keyword, attack, ..
            } = d.kind
            else {
                continue;
            };
            if d.cost > mana {
                continue;
            }
            let entry = if keyword == Some(Keyword::Rush) { 1 } else { 0 };
            match self.p.unit {
                UnitPick::Expensive => {
                    if best.is_none_or(|(cost, _, _)| d.cost > cost) {
                        best = Some((d.cost, card, entry));
                    }
                }
                UnitPick::FastFront => {
                    // rank: sooner to the front, then higher attack, then cheaper
                    let key = (turns_to_front(keyword), 255 - attack, d.cost);
                    let cur = best.map(|(_, c, _)| {
                        let dd = design(c).unwrap();
                        let CardKind::Unit {
                            keyword: k,
                            attack: a,
                            ..
                        } = dd.kind
                        else {
                            unreachable!()
                        };
                        (turns_to_front(k), 255 - a, dd.cost)
                    });
                    if cur.is_none_or(|k| key < k) {
                        best = Some((d.cost, card, entry));
                    }
                }
            }
        }
        let (_, card, entry) = best?;
        let lane = match self.p.adv {
            _ => (0..LANES)
                .filter(|&l| me.cells[l][entry].is_none())
                .min_by_key(|&l| me.cells[l].iter().flatten().count())?,
        };
        Some(tap(self.seat, Kind::CastUnit, card, lane as i8, 0, 0))
    }

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
                Effect::Damage { castle_ok, .. } => match self.pick_enemy(opp) {
                    Some((l, c)) => (tgt(opp_idx, l, c), 0),
                    None if castle_ok => (0xFF, 0),
                    None => continue,
                },
                Effect::Heal { .. } => match most_damaged(me) {
                    Some((l, c)) => (tgt(self.seat as usize, l, c), 0),
                    None => continue,
                },
                Effect::Destroy { max_toughness } => match self.pick_destroy(opp, max_toughness) {
                    Some((l, c)) => (tgt(opp_idx, l, c), 0),
                    None => continue,
                },
                Effect::Shift => match shiftable(opp) {
                    Some((l, c, a)) => (tgt(opp_idx, l, c), a),
                    None => continue,
                },
                Effect::Draw { .. } => (0, 0),
            };
            return Some(tap(self.seat, Kind::CastSpell, card, -1, target, aux));
        }
        None
    }

    fn pick_enemy(&self, opp: &Seat) -> Option<(usize, usize)> {
        match self.p.rem {
            RemPick::Nearest => nearest_enemy(opp),
            RemPick::Biggest => {
                let mut best: Option<(u8, usize, usize)> = None;
                for l in 0..LANES {
                    for c in 0..CELLS {
                        if let Some(u) = opp.cells[l][c] {
                            // threat = attack, front cell counts double (it is attacking now)
                            let threat = u.attack * if c == CELLS - 1 { 2 } else { 1 };
                            if best.is_none_or(|(b, _, _)| threat > b) {
                                best = Some((threat, l, c));
                            }
                        }
                    }
                }
                best.map(|(_, l, c)| (l, c))
            }
        }
    }
    fn pick_destroy(&self, opp: &Seat, max: u8) -> Option<(usize, usize)> {
        match self.p.rem {
            RemPick::Nearest => {
                for l in 0..LANES {
                    for c in 0..CELLS {
                        if opp.cells[l][c].is_some_and(|u| u.toughness <= max) {
                            return Some((l, c));
                        }
                    }
                }
                None
            }
            RemPick::Biggest => {
                let mut best: Option<(u8, usize, usize)> = None;
                for l in 0..LANES {
                    for c in 0..CELLS {
                        if let Some(u) = opp.cells[l][c] {
                            if u.toughness > max {
                                continue;
                            }
                            let threat = u.attack * if c == CELLS - 1 { 2 } else { 1 };
                            if best.is_none_or(|(b, _, _)| threat > b) {
                                best = Some((threat, l, c));
                            }
                        }
                    }
                }
                best.map(|(_, l, c)| (l, c))
            }
        }
    }

    fn advance(&mut self, me: &Seat, round: u8) -> Option<Record> {
        let lanes: Vec<usize> = (0..LANES)
            .filter(|&l| !me.lane_advanced(l) && me.cells[l].iter().any(Option::is_some))
            .collect();
        if lanes.is_empty() {
            return None;
        }
        let lane = match self.p.adv {
            AdvPick::Random => lanes[self.rng.random_range(0..lanes.len())],
            AdvPick::Progress => {
                // prefer a lane where an advance actually lands a unit in the front cell,
                // then a lane whose front-most mover is closest to the front.
                *lanes
                    .iter()
                    .max_by_key(|&&l| {
                        let mut score = 0i32;
                        for c in (0..CELLS - 1).rev() {
                            if let Some(u) = me.cells[l][c] {
                                let may =
                                    u.entered_round < round || u.keyword == Some(Keyword::Haste);
                                if may && me.cells[l][c + 1].is_none() {
                                    score = score.max(if c + 1 == CELLS - 1 {
                                        100 + u.attack as i32
                                    } else {
                                        10 + c as i32
                                    });
                                }
                            }
                        }
                        score
                    })
                    .unwrap()
            }
        };
        Some(tap(self.seat, Kind::Advance, 0, lane as i8, 0, 0))
    }

    fn next_tap(&mut self, g: &Game) -> Record {
        let me = &g.seats[(self.seat & 1) as usize];
        if !me.acted() && !me.mulliganed() && self.rng.random_bool(0.25) {
            return tap(self.seat, Kind::Mulligan, 0, -1, 0, 0);
        }
        let roll = self.rng.random_range(0..100u32);
        let order = [Cat::Charge, Cat::Unit, Cat::Spell, Cat::Advance, Cat::Pass];
        let cum = [40u32, 70, 80, 90, 100];
        let seq: Vec<Cat> = match self.p.cats {
            Cats::Weighted => {
                let start = cum
                    .iter()
                    .position(|&c| roll < c)
                    .unwrap_or(order.len() - 1);
                order[start..].to_vec()
            }
            // Play the whole turn: bank mana, deploy, walk forward, then spells, then pass.
            Cats::FullTurn => vec![Cat::Charge, Cat::Unit, Cat::Advance, Cat::Spell, Cat::Pass],
        };
        let round = g.round;
        for cat in seq {
            let pick = match cat {
                Cat::Charge => self.charge(me),
                Cat::Unit => self.unit(me),
                Cat::Spell => self.spell(g, me),
                Cat::Advance => self.advance(me, round),
                Cat::Pass => Some(tap(self.seat, Kind::Pass, 0, -1, 0, 0)),
            };
            if let Some(r) = pick {
                return r;
            }
        }
        tap(self.seat, Kind::Pass, 0, -1, 0, 0)
    }
}

fn tgt(s: usize, l: usize, c: usize) -> u8 {
    ((s as u8) << 4) | ((l as u8) << 2) | c as u8
}
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
fn shiftable(opp: &Seat) -> Option<(usize, usize, u8)> {
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

#[derive(Default, Clone, Copy)]
struct Shadow {
    castle: [u32; 2],
    shield_absorbed: [u32; 2],
    taunt_saved: [u32; 2],
    mismatches: u32,
}

fn tgt_in_lane(enemy: &[Option<Unit>; CELLS], ranged: bool, taunt_on: bool) -> Option<usize> {
    let order = [CELLS - 1, 1, 0];
    if taunt_on
        && let Some(&t) = order
            .iter()
            .find(|&&c| matches!(enemy[c], Some(u) if u.keyword == Some(Keyword::Taunt)))
    {
        return Some(t);
    }
    if ranged {
        order.iter().copied().find(|&c| enemy[c].is_some())
    } else if enemy[CELLS - 1].is_some() {
        Some(CELLS - 1)
    } else {
        None
    }
}

/// Recompute one combat from the board. `taunt_on=false` is the counterfactual "Taunt does nothing".
fn shadow_combat(g: &Game, taunt_on: bool) -> ([u32; 2], [[[u32; CELLS]; LANES]; 2]) {
    let mut castle = [0u32; 2];
    let mut hits = [[[0u32; CELLS]; LANES]; 2];
    for me in 0..2usize {
        let opp = 1 - me;
        for lane in 0..LANES {
            for cell in 0..CELLS {
                let Some(u) = g.seats[me].cells[lane][cell] else {
                    continue;
                };
                let ranged = u.keyword == Some(Keyword::Ranged);
                if cell != CELLS - 1 && !ranged {
                    continue;
                }
                match tgt_in_lane(&g.seats[opp].cells[lane], ranged, taunt_on) {
                    Some(tc) => hits[opp][lane][tc] += u.attack as u32,
                    None => castle[opp] += u.attack as u32,
                }
            }
        }
    }
    (castle, hits)
}

struct Res {
    w0: bool,
    rounds: u8,
    records: usize,
    front: [Option<u32>; 2],
    capped: bool,
    refusals: u32,
    taps: [u32; 2],
    summons: [u32; 2],
    life: [u8; 2],
    both_zero: bool,
    sh: Shadow,
    dmg_by_round: [[u32; 14]; 2],
}

fn play_x(
    seed: u64,
    decks: [Vec<u16>; 2],
    rules: HouseRules,
    pol: [Policy; 2],
    extra_s0: u32,
) -> Res {
    let g = Game::new(rules, CASTLES, [&decks[0], &decks[1]]);
    let mut a = Arbiter::new(g);
    a.commit(claim(1, CASTLES[1], Commander::LEVEL_1)).unwrap();
    a.commit(claim(0, CASTLES[0], Commander::LEVEL_1)).unwrap();
    // Optional: hand seat 0 extra cards to cancel the draw-schedule asymmetry (seat 0 never draws on
    // turn 1). Since 0036 that is extra owed draws, paid as taps like any other.
    a.game.seats[0].owe(extra_s0 as u8);
    let mut paper = tapstone_sim::physical::PhysicalDecks::new(seed, decks.clone());
    let mut p = [Picker::new(seed, 0, pol[0]), Picker::new(seed, 1, pol[1])];
    let (mut att, mut refused, mut turn) = (0usize, 0u32, 0u32);
    let mut front = [None, None];
    let mut taps = [0u32; 2];
    let mut summons = [0u32; 2];
    let mut sh = Shadow::default();
    let mut dmg_by_round = [[0u32; 14]; 2];
    while a.game.phase == Phase::Playing && att < 500 {
        // 0036: every owed draw is a tap, paid from the paper deck before a seat acts.
        paper.pay(&mut a);
        if a.game.phase != Phase::Playing {
            break;
        }
        let act = a.game.active;
        let r = p[act as usize].next_tap(&a.game);
        att += 1;
        let is_pass = r.kind == Kind::Pass;
        let was_unit = r.kind == Kind::CastUnit;
        let (pred, hits) = if is_pass {
            shadow_combat(&a.game, true)
        } else {
            ([0; 2], Default::default())
        };
        let (pred_nt, _) = if is_pass {
            shadow_combat(&a.game, false)
        } else {
            ([0; 2], Default::default())
        };
        if is_pass {
            for i in 0..2 {
                // Taunt saved the castle exactly the damage it pulled off it.
                sh.taunt_saved[i] += pred_nt[i].saturating_sub(pred[i]);
                for l in 0..LANES {
                    for c in 0..CELLS {
                        if let Some(u) = a.game.seats[i].cells[l][c]
                            && u.keyword == Some(Keyword::Shield1)
                            && hits[i][l][c] > 0
                        {
                            sh.shield_absorbed[i] += 1;
                        }
                    }
                }
            }
        }
        let round_now = a.game.round as usize;
        match a.commit(r) {
            Ok(ap) => {
                refused = 0;
                taps[act as usize] += 1;
                if was_unit {
                    summons[act as usize] += 1;
                }
                if let Applied::TurnEnded { combat_damage } = ap {
                    for i in 0..2 {
                        if combat_damage[i] as u32 != pred[i] {
                            sh.mismatches += 1;
                        }
                        dmg_by_round[i][round_now.min(13)] += combat_damage[i] as u32;
                    }
                }
                if is_pass {
                    turn += 1;
                }
            }
            Err(_) => {
                refused += 1;
                if refused >= 3 {
                    let _ = a.commit(tap(act, Kind::Pass, 0, -1, 0, 0));
                    turn += 1;
                    refused = 0;
                }
            }
        }
        for i in 0..2 {
            if (0..LANES).any(|l| a.game.seats[i].cells[l][CELLS - 1].is_some()) {
                front[i].get_or_insert(turn);
            }
        }
    }
    Res {
        w0: a.game.winner == Some(Winner::Seat(0)),
        rounds: a.game.round,
        records: a.records.len(),
        front,
        capped: att >= 500,
        refusals: a.refusals,
        taps,
        summons,
        life: [a.game.seats[0].castle.life, a.game.seats[1].castle.life],
        both_zero: a.game.seats[0].castle.life == 0 && a.game.seats[1].castle.life == 0,
        sh,
        dmg_by_round,
    }
}

fn play(seed: u64, decks: [Vec<u16>; 2], rules: HouseRules, pol: [Policy; 2]) -> Res {
    play_x(seed, decks, rules, pol, 0)
}

fn ci(p: f64, n: usize) -> f64 {
    1.96 * (p * (1.0 - p) / n as f64).sqrt() * 100.0
}

fn go(label: &str, d0: &[u16], d1: &[u16], pol: [Policy; 2], n: usize) -> f64 {
    let hr = HouseRules::default();
    let rs: Vec<Res> = (1..=n as u64)
        .map(|s| play(s, [deck_from(d0, s, 0), deck_from(d1, s, 1)], hr, pol))
        .collect();
    let w = rs.iter().filter(|r| r.w0).count();
    let p = w as f64 / n as f64;
    let f0 = rs.iter().filter(|r| r.front[0].is_some()).count() as f64 / n as f64 * 100.0;
    let f1 = rs.iter().filter(|r| r.front[1].is_some()).count() as f64 / n as f64 * 100.0;
    println!(
        "{label:<44} seat0 {:5.1}% ±{:.1}  rounds {:4.1}  reaches-front s0 {:4.1}% s1 {:4.1}%  capped {}",
        p * 100.0,
        ci(p, n),
        rs.iter().map(|r| r.rounds as f64).sum::<f64>() / n as f64,
        f0,
        f1,
        rs.iter().filter(|r| r.capped).count()
    );
    println!(
        "      taps/game s0 {:5.2} s1 {:5.2} | summons s0 {:5.2} s1 {:5.2} | refusals/game {:5.2} | end life s0 {:4.2} s1 {:4.2} | BOTH castles 0 in {:4.1}% of games",
        rs.iter().map(|r| r.taps[0] as f64).sum::<f64>() / n as f64,
        rs.iter().map(|r| r.taps[1] as f64).sum::<f64>() / n as f64,
        rs.iter().map(|r| r.summons[0] as f64).sum::<f64>() / n as f64,
        rs.iter().map(|r| r.summons[1] as f64).sum::<f64>() / n as f64,
        rs.iter().map(|r| r.refusals as f64).sum::<f64>() / n as f64,
        rs.iter().map(|r| r.life[0] as f64).sum::<f64>() / n as f64,
        rs.iter().map(|r| r.life[1] as f64).sum::<f64>() / n as f64,
        rs.iter().filter(|r| r.both_zero).count() as f64 / n as f64 * 100.0
    );
    p
}

fn main() {
    let n: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(4000);
    let hr = HouseRules::default();
    let ember: Vec<u16> = DECK_DESIGNS[0].to_vec();
    let tide: Vec<u16> = DECK_DESIGNS[1].to_vec();

    // ---- POSITIVE CONTROL: my replica with the shipped policy must equal ScriptedSeat ----
    let mut bad = 0;
    for s in 1..=2000u64 {
        let decks = [build_deck(s, 0), build_deck(s, 1)];
        let mine = play(s, decks.clone(), hr, [SHIPPED, SHIPPED]);
        // reference: the shipped seat, driven identically
        let g = Game::new(hr, CASTLES, [&decks[0], &decks[1]]);
        let mut a = Arbiter::new(g);
        a.commit(claim(1, CASTLES[1], Commander::LEVEL_1)).unwrap();
        a.commit(claim(0, CASTLES[0], Commander::LEVEL_1)).unwrap();
        let mut ss = [ScriptedSeat::new(s, 0), ScriptedSeat::new(s, 1)];
        let mut paper = tapstone_sim::physical::PhysicalDecks::new(s, decks.clone());
        let (mut att, mut refused) = (0usize, 0u32);
        while a.game.phase == Phase::Playing && att < 500 {
            // 0036: every owed draw is a tap, paid from the paper deck before a seat acts.
            paper.pay(&mut a);
            if a.game.phase != Phase::Playing {
                break;
            }

            let act = a.game.active;
            let r = ss[act as usize].next_tap(&a.game);
            att += 1;
            if a.commit(r).is_ok() {
                refused = 0;
            } else {
                refused += 1;
                if refused >= 3 {
                    let _ = a.commit(tap(act, Kind::Pass, 0, -1, 0, 0));
                    refused = 0;
                }
            }
        }
        let ref_w0 = a.game.winner == Some(Winner::Seat(0));
        if mine.w0 != ref_w0 || mine.rounds != a.game.round || mine.records != a.records.len() {
            bad += 1;
        }
    }
    println!(
        "positive control — replica with SHIPPED policy vs ScriptedSeat over 2000 games: {bad} differing games"
    );
    if bad > 0 {
        println!("  !! replica is not faithful; policy comparisons below would be unsound");
    }
    println!();

    println!("=== cards or picker?  n={n}  (seat0 = Ember unless stated) ===");
    go(
        "Ember(shipped)   v Tide(shipped)   [ref]",
        &ember,
        &tide,
        [SHIPPED, SHIPPED],
        n,
    );
    go(
        "Ember(shipped)   v Tide(TACTICIAN)",
        &ember,
        &tide,
        [SHIPPED, TACTICIAN],
        n,
    );
    go(
        "Ember(TACTICIAN) v Tide(TACTICIAN)",
        &ember,
        &tide,
        [TACTICIAN, TACTICIAN],
        n,
    );
    go(
        "Ember(TACTICIAN) v Tide(shipped)",
        &ember,
        &tide,
        [TACTICIAN, SHIPPED],
        n,
    );
    println!();
    println!("--- one axis at a time, applied to Tide only (ref 68-69% for Ember) ---");
    for (nm, p) in [
        (
            "cats=FullTurn (plays out the turn)",
            Policy {
                cats: Cats::FullTurn,
                ..SHIPPED
            },
        ),
        (
            "unit=FastFront (deploy for tempo)",
            Policy {
                unit: UnitPick::FastFront,
                ..SHIPPED
            },
        ),
        (
            "adv=Progress (walk to the front)",
            Policy {
                adv: AdvPick::Progress,
                ..SHIPPED
            },
        ),
        (
            "rem=Biggest (kill the real threat)",
            Policy {
                rem: RemPick::Biggest,
                ..SHIPPED
            },
        ),
    ] {
        go(
            &format!("  Ember(shipped) v Tide({nm})"),
            &ember,
            &tide,
            [SHIPPED, p],
            n,
        );
    }
    println!();
    println!("--- and applied to Ember only, to see who each policy helps more ---");
    for (nm, p) in [
        (
            "cats=FullTurn",
            Policy {
                cats: Cats::FullTurn,
                ..SHIPPED
            },
        ),
        (
            "unit=FastFront",
            Policy {
                unit: UnitPick::FastFront,
                ..SHIPPED
            },
        ),
        (
            "adv=Progress",
            Policy {
                adv: AdvPick::Progress,
                ..SHIPPED
            },
        ),
    ] {
        go(
            &format!("  Ember({nm}) v Tide(shipped)"),
            &ember,
            &tide,
            [p, SHIPPED],
            n,
        );
    }
    println!();
    let line =
        |lbl: &str, d0: &Vec<u16>, d1: &Vec<u16>, b: u8, pol: [Policy; 2], extra: u32| -> f64 {
            let hrb = HouseRules {
                second_player_bonus: b,
                ..hr
            };
            let rs: Vec<Res> = (1..=n as u64)
                .map(|s| {
                    play_x(
                        s,
                        [deck_from(d0, s, 0), deck_from(d1, s, 1)],
                        hrb,
                        pol,
                        extra,
                    )
                })
                .collect();
            let w = rs.iter().filter(|r| r.w0).count();
            let p = w as f64 / n as f64;
            println!(
                "{lbl:<52} seat0 {:5.1}% ±{:.1}   rounds {:4.1}  summons s0 {:5.2} s1 {:5.2}",
                p * 100.0,
                ci(p, n),
                rs.iter().map(|r| r.rounds as f64).sum::<f64>() / n as f64,
                rs.iter().map(|r| r.summons[0] as f64).sum::<f64>() / n as f64,
                rs.iter().map(|r| r.summons[1] as f64).sum::<f64>() / n as f64
            );
            p
        };
    // averaged over both seats: cancels the positional effect by symmetry
    let deck_vs = |lbl: &str, d0: &Vec<u16>, d1: &Vec<u16>, pol: Policy| {
        let hrb = hr;
        let f = |x: &Vec<u16>, y: &Vec<u16>| {
            let rs: Vec<Res> = (1..=n as u64)
                .map(|s| {
                    play_x(
                        s,
                        [deck_from(x, s, 0), deck_from(y, s, 1)],
                        hrb,
                        [pol, pol],
                        0,
                    )
                })
                .collect();
            rs.iter().filter(|r| r.w0).count() as f64 / n as f64
        };
        let a = f(d0, d1);
        let b = 1.0 - f(d1, d0);
        println!(
            "{lbl:<46} first deck wins {:5.1}% averaged over both seats  (as s0 {:5.1}%, as s1 {:5.1}%)",
            (a + b) / 2.0 * 100.0,
            a * 100.0,
            b * 100.0
        );
        (a + b) / 2.0
    };
    println!("--- A. card count is the whole mirror asymmetry (TACTICIAN, identical decks) ---");
    let liney = |lbl: &str, d: &Vec<u16>, b: u8, pol: [Policy; 2], extra: u32| {
        let hrb = HouseRules {
            second_player_bonus: b,
            ..hr
        };
        let rs: Vec<Res> = (1..=n as u64)
            .map(|s| play_x(s, [deck_from(d, s, 0), deck_from(d, s, 0)], hrb, pol, extra))
            .collect();
        let w = rs.iter().filter(|r| r.w0).count();
        println!(
            "{lbl:<52} seat0 {:5.1}% ±{:.1}   summons s0 {:5.2} s1 {:5.2}",
            w as f64 / n as f64 * 100.0,
            ci(w as f64 / n as f64, n),
            rs.iter().map(|r| r.summons[0] as f64).sum::<f64>() / n as f64,
            rs.iter().map(|r| r.summons[1] as f64).sum::<f64>() / n as f64
        );
    };
    liney(
        "mirror Ember TACT bonus=1 (as shipped)",
        &ember,
        1,
        [TACTICIAN, TACTICIAN],
        0,
    );
    liney(
        "mirror Ember TACT bonus=0",
        &ember,
        0,
        [TACTICIAN, TACTICIAN],
        0,
    );
    liney(
        "mirror Ember TACT bonus=0, seat0 +1 card (cards equal)",
        &ember,
        0,
        [TACTICIAN, TACTICIAN],
        1,
    );
    liney(
        "mirror Ember TACT bonus=1, seat0 +2 cards (cards equal)",
        &ember,
        1,
        [TACTICIAN, TACTICIAN],
        2,
    );
    liney(
        "mirror Tide  TACT bonus=1, seat0 +2 cards (cards equal)",
        &tide,
        1,
        [TACTICIAN, TACTICIAN],
        2,
    );
    liney(
        "mirror Ember SHIPPED bonus=1, seat0 +2 cards",
        &ember,
        1,
        [SHIPPED, SHIPPED],
        2,
    );
    println!();
    println!("--- B. the deck gap under each picker, seat effect cancelled by symmetry ---");
    deck_vs("Ember vs Tide, both SHIPPED", &ember, &tide, SHIPPED);
    deck_vs("Ember vs Tide, both TACTICIAN", &ember, &tide, TACTICIAN);
    println!();
    println!("--- C. keyword swaps under the stronger picker (Tidecaller replaced) ---");
    let t_fast: Vec<u16> = vec![6, 2, 8, 9, 10, 13, 11, 12];
    let t_rush: Vec<u16> = vec![6, 3, 8, 9, 10, 13, 11, 12];
    let t_tnt: Vec<u16> = vec![6, 4, 8, 9, 10, 13, 11, 12];
    deck_vs(
        "Ember vs Tide+Haste(Whelp),  TACTICIAN",
        &ember,
        &t_fast,
        TACTICIAN,
    );
    deck_vs(
        "Ember vs Tide+Rush(Vanguard),TACTICIAN",
        &ember,
        &t_rush,
        TACTICIAN,
    );
    deck_vs(
        "Ember vs Tide+Taunt(Warden), TACTICIAN",
        &ember,
        &t_tnt,
        TACTICIAN,
    );
    println!();
    println!("--- D. do Shield 1 and Taunt absorb anything? (shadow combat, validated) ---");
    for (nm, pol) in [("SHIPPED", SHIPPED), ("TACTICIAN", TACTICIAN)] {
        let rs: Vec<Res> = (1..=n as u64)
            .map(|s| {
                play_x(
                    s,
                    [deck_from(&ember, s, 0), deck_from(&tide, s, 1)],
                    hr,
                    [pol, pol],
                    0,
                )
            })
            .collect();
        let mm: u32 = rs.iter().map(|r| r.sh.mismatches).sum();
        println!(
            "  {nm}: shadow-vs-engine castle-damage mismatches = {mm} (0 means the model is exact)"
        );
        for i in 0..2 {
            let who = if i == 0 { "Ember s0" } else { "Tide  s1" };
            println!(
                "    {who}: Shield 1 absorbed {:5.2} dmg/game | Taunt pulled {:5.2} dmg/game off its own castle | total castle dmg taken {:5.2}",
                rs.iter()
                    .map(|r| r.sh.shield_absorbed[i] as f64)
                    .sum::<f64>()
                    / n as f64,
                rs.iter().map(|r| r.sh.taunt_saved[i] as f64).sum::<f64>() / n as f64,
                rs.iter()
                    .map(|r| r.dmg_by_round[i].iter().sum::<u32>() as f64)
                    .sum::<f64>()
                    / n as f64
            );
        }
        for i in 0..2 {
            let who = if i == 0 { "Ember s0" } else { "Tide  s1" };
            let v: Vec<String> = (1..13)
                .map(|rd| {
                    format!(
                        "{:.1}",
                        rs.iter().map(|r| r.dmg_by_round[i][rd] as f64).sum::<f64>() / n as f64
                    )
                })
                .collect();
            println!("    {who} castle dmg by round 1..12: [{}]", v.join(" "));
        }
    }
}
