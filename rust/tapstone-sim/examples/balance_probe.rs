//! Oracle's balance-mechanism harness v2. Drives the shipped ScriptedSeat/Arbiter exactly as
//! play_seeded does, instrumented. Conditional statistics; custom deck lists for card-level probes.
use rand::SeedableRng;
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use tapstone_rules::cards::{Keyword, design};
use tapstone_rules::state::{CELLS, DECK_MAX, LANES};
use tapstone_rules::{Applied, CardKind, Commander, Game, HouseRules, Kind, Phase, Record, Winner};
use tapstone_sim::{
    Arbiter, CASTLES, DECK_DESIGNS, DECK_SIZE, ScriptedSeat, build_deck, claim, play_seeded, tap,
};

const SEATS: usize = 2;

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

#[derive(Default, Clone)]
struct Out {
    winner: Option<u8>,
    rounds: u8,
    lethal: bool,
    fell: [bool; SEATS],
    tiebreak: &'static str,
    combats: u32,
    combat_taken: [u32; SEATS],
    pressure_taken: [u32; SEATS],
    spell_taken: [u32; SEATS],
    final_taken: [u32; SEATS],
    front_turn: [Option<u32>; SEATS],
    firstdmg_turn: [Option<u32>; SEATS],
    firstcast_turn: [Option<u32>; SEATS],
    attacker_ticks: [u32; SEATS],
    front_ticks: [u32; SEATS],
    blocked_ticks: [u32; SEATS], // combats where seat i's lane-front was occupied by the enemy => melee blocked
    summons: [u32; SEATS],
    charges: [u32; SEATS],
    spells: [u32; SEATS],
    hand_end: [u8; SEATS],
    idle_units: [u32; SEATS],
    undef_ticks: [u32; SEATS], // combats where seat i had units on board but NONE in a front cell
    undef_dmg: [u32; SEATS],   // castle damage seat i took during exactly those combats
    onboard_ticks: [u32; SEATS],
    removal_front: [u32; SEATS], // removal/damage spells aimed at an enemy unit IN a front cell
    removal_other: [u32; SEATS], // ...aimed at an enemy unit not in a front cell (wasted tempo)
}

fn attackers(g: &Game, s: usize) -> u32 {
    let mut n = 0;
    for l in 0..LANES {
        for c in 0..CELLS {
            if let Some(u) = g.seats[s].cells[l][c]
                && (c == CELLS - 1 || u.keyword == Some(Keyword::Ranged))
            {
                n += 1;
            }
        }
    }
    n
}
fn idle(g: &Game, s: usize) -> u32 {
    let mut n = 0;
    for l in 0..LANES {
        for c in 0..CELLS {
            if let Some(u) = g.seats[s].cells[l][c]
                && c != CELLS - 1
                && u.keyword != Some(Keyword::Ranged)
            {
                n += 1;
            }
        }
    }
    n
}
fn in_front(g: &Game, s: usize) -> u32 {
    (0..LANES)
        .filter(|&l| g.seats[s].cells[l][CELLS - 1].is_some())
        .count() as u32
}

struct Run {
    a: Arbiter,
    o: Out,
    turn: u32,
}

impl Run {
    fn step(&mut self, r: tapstone_rules::Record) -> bool {
        let g = &self.a.game;
        let active = (g.active & 1) as usize;
        let lb = [g.seats[0].castle.life, g.seats[1].castle.life];
        let atk = [attackers(g, 0), attackers(g, 1)];
        let frt = [in_front(g, 0), in_front(g, 1)];
        let idl = [idle(g, 0), idle(g, 1)];
        let onboard = [g.seats[0].units() as u32, g.seats[1].units() as u32];
        let kind = r.kind;
        let tgt = r.target;
        let card = r.card;
        let res = self.a.commit(r);
        let g = &self.a.game;
        let d = |i: usize| lb[i].saturating_sub(g.seats[i].castle.life) as u32;
        let combat_tick = |o: &mut Out| {
            for i in 0..SEATS {
                o.attacker_ticks[i] += atk[i];
                o.front_ticks[i] += frt[i];
                o.idle_units[i] += idl[i];
                o.blocked_ticks[i] += frt[1 - i];
                if onboard[i] > 0 {
                    o.onboard_ticks[i] += 1;
                    if frt[i] == 0 {
                        o.undef_ticks[i] += 1;
                    }
                }
            }
            o.combats += 1;
        };
        let ok = match res {
            Ok(a) => {
                match a {
                    Applied::TurnEnded { combat_damage } => {
                        for i in 0..SEATS {
                            self.o.combat_taken[i] += combat_damage[i] as u32;
                            self.o.pressure_taken[i] +=
                                d(i).saturating_sub(combat_damage[i] as u32);
                            if combat_damage[i] > 0 {
                                self.o.firstdmg_turn[1 - i].get_or_insert(self.turn);
                            }
                            if onboard[i] > 0 && frt[i] == 0 {
                                self.o.undef_dmg[i] += combat_damage[i] as u32;
                            }
                        }
                        combat_tick(&mut self.o);
                        self.turn += 1;
                    }
                    Applied::GameEnded(_) => {
                        for i in 0..SEATS {
                            self.o.final_taken[i] += d(i);
                            if d(i) > 0 {
                                self.o.firstdmg_turn[1 - i].get_or_insert(self.turn);
                            }
                        }
                        if kind == Kind::Pass {
                            combat_tick(&mut self.o);
                        }
                        self.turn += 1;
                    }
                    Applied::Spell => {
                        self.o.spells[active] += 1;
                        // Was this removal pointed at something that could actually attack?
                        if matches!(card, 9 | 13) && tgt != 0xFF {
                            let (ts, _tl, tc) = (
                                ((tgt >> 4) & 1) as usize,
                                ((tgt >> 2) & 3) as usize,
                                (tgt & 3) as usize,
                            );
                            if ts != active {
                                if tc == CELLS - 1 {
                                    self.o.removal_front[active] += 1;
                                } else {
                                    self.o.removal_other[active] += 1;
                                }
                            }
                        }
                        for i in 0..SEATS {
                            self.o.spell_taken[i] += d(i);
                            if d(i) > 0 {
                                self.o.firstdmg_turn[1 - i].get_or_insert(self.turn);
                            }
                        }
                    }
                    Applied::Summoned { .. } => {
                        self.o.summons[active] += 1;
                        self.o.firstcast_turn[active].get_or_insert(self.turn);
                    }
                    Applied::Charged => self.o.charges[active] += 1,
                    _ => {}
                }
                true
            }
            Err(_) => false,
        };
        let g = &self.a.game;
        for i in 0..SEATS {
            if in_front(g, i) > 0 {
                self.o.front_turn[i].get_or_insert(self.turn);
            }
        }
        ok
    }
}

/// Would this tap spend removal (Tidal Lash / Riptide) on an enemy unit that is NOT in a front
/// cell — i.e. on something that, by the blocking rule, is neither attacking nor defending?
fn wasteful_removal(r: &Record) -> bool {
    if r.kind != Kind::CastSpell || !matches!(r.card, 9 | 13) || r.target == 0xFF {
        return false;
    }
    let ts = ((r.target >> 4) & 1) as usize;
    let tc = (r.target & 3) as usize;
    ts != (r.seat & 1) as usize && tc != CELLS - 1
}

/// "Patient" seat: the shipped picker, except it declines to fire removal at a non-front target and
/// asks itself for another action instead (up to 6 tries, then gives in). Everything else identical.
fn next_tap_maybe_patient(s: &mut ScriptedSeat, g: &Game, patient: bool) -> Record {
    let mut r = s.next_tap(g);
    if !patient {
        return r;
    }
    for _ in 0..6 {
        if !wasteful_removal(&r) {
            break;
        }
        r = s.next_tap(g);
    }
    r
}

fn run_p(seed: u64, decks: [Vec<u16>; 2], rules: HouseRules, patient: [bool; 2]) -> Out {
    let game = Game::new(rules, CASTLES, [&decks[0], &decks[1]]);
    let mut r = Run {
        a: Arbiter::new(game),
        o: Out::default(),
        turn: 0,
    };
    r.a.commit(claim(1, CASTLES[1], Commander::LEVEL_1))
        .unwrap();
    r.a.commit(claim(0, CASTLES[0], Commander::LEVEL_1))
        .unwrap();
    let mut seats = [ScriptedSeat::new(seed, 0), ScriptedSeat::new(seed, 1)];
    let mut paper = tapstone_sim::physical::PhysicalDecks::new(seed, decks.clone());
    let (mut att, mut refused) = (0usize, 0u32);
    while r.a.game.phase == Phase::Playing && att < 500 {
        // 0036: every owed draw is a tap, paid from the paper deck before a seat acts.
        paper.pay(&mut r.a);
        if r.a.game.phase != Phase::Playing {
            break;
        }
        let active = r.a.game.active;
        let next = next_tap_maybe_patient(
            &mut seats[active as usize],
            &r.a.game,
            patient[active as usize],
        );
        att += 1;
        if r.step(next) {
            refused = 0;
        } else {
            refused += 1;
            if refused >= 3 {
                r.step(tap(active, Kind::Pass, 0, -1, 0, 0));
                refused = 0;
            }
        }
    }
    let g = &r.a.game;
    r.o.rounds = g.round;
    r.o.fell = [g.seats[0].castle.life == 0, g.seats[1].castle.life == 0];
    r.o.lethal = r.o.fell[0] || r.o.fell[1];
    r.o.hand_end = [g.seats[0].hand_len, g.seats[1].hand_len];
    r.o.winner = g.winner.map(|w| match w {
        Winner::Seat(s) => s,
        Winner::Draw => 2,
    });
    r.o.tiebreak = if g.seats[0].castle.life != g.seats[1].castle.life {
        "life"
    } else if g.seats[0].units() != g.seats[1].units() {
        "units"
    } else {
        "seat1-default"
    };
    r.o
}

fn go_p(label: &str, d0: &[u16], d1: &[u16], rules: HouseRules, n: usize, patient: [bool; 2]) {
    let outs: Vec<Out> = (1..=n as u64)
        .map(|s| {
            run_p(
                s,
                [deck_from(d0, s, 0), deck_from(d1, s, 1)],
                rules,
                patient,
            )
        })
        .collect();
    let w0 = outs.iter().filter(|o| o.winner == Some(0)).count();
    let p = w0 as f64 / n as f64;
    let rf: u64 = outs.iter().map(|o| o.removal_front[1] as u64).sum();
    let ro: u64 = outs.iter().map(|o| o.removal_other[1] as u64).sum();
    println!(
        "{label:<34} seat0 {:5.1}% ±{:.1}   lethal {:5.1}%   rounds {:4.1}   | seat1 removal at a front target {:3.0}% of {} casts",
        p * 100.0,
        ci(p, n),
        outs.iter().filter(|o| o.lethal).count() as f64 / n as f64 * 100.0,
        mean(outs.iter().map(|o| o.rounds as f64)),
        if rf + ro > 0 {
            100.0 * rf as f64 / (rf + ro) as f64
        } else {
            0.0
        },
        rf + ro
    );
}

fn run(seed: u64, decks: [Vec<u16>; 2], rules: HouseRules) -> Out {
    let game = Game::new(rules, CASTLES, [&decks[0], &decks[1]]);
    let mut r = Run {
        a: Arbiter::new(game),
        o: Out::default(),
        turn: 0,
    };
    r.a.commit(claim(1, CASTLES[1], Commander::LEVEL_1))
        .unwrap();
    r.a.commit(claim(0, CASTLES[0], Commander::LEVEL_1))
        .unwrap();
    let mut seats = [ScriptedSeat::new(seed, 0), ScriptedSeat::new(seed, 1)];
    let mut paper = tapstone_sim::physical::PhysicalDecks::new(seed, decks.clone());
    let (mut att, mut refused) = (0usize, 0u32);
    while r.a.game.phase == Phase::Playing && att < 500 {
        // 0036: every owed draw is a tap, paid from the paper deck before a seat acts.
        paper.pay(&mut r.a);
        if r.a.game.phase != Phase::Playing {
            break;
        }
        let active = r.a.game.active;
        let next = seats[active as usize].next_tap(&r.a.game);
        att += 1;
        if r.step(next) {
            refused = 0;
        } else {
            refused += 1;
            if refused >= 3 {
                r.step(tap(active, Kind::Pass, 0, -1, 0, 0));
                refused = 0;
            }
        }
    }
    let g = &r.a.game;
    r.o.rounds = g.round;
    r.o.fell = [g.seats[0].castle.life == 0, g.seats[1].castle.life == 0];
    r.o.lethal = r.o.fell[0] || r.o.fell[1];
    r.o.hand_end = [g.seats[0].hand_len, g.seats[1].hand_len];
    r.o.winner = g.winner.map(|w| match w {
        Winner::Seat(s) => s,
        Winner::Draw => 2,
    });
    r.o.tiebreak = if g.seats[0].castle.life != g.seats[1].castle.life {
        "life"
    } else if g.seats[0].units() != g.seats[1].units() {
        "units"
    } else {
        "seat1-default"
    };
    r.o
}

fn ci(p: f64, n: usize) -> f64 {
    1.96 * (p * (1.0 - p) / n as f64).sqrt() * 100.0
}
fn mean(v: impl Iterator<Item = f64>) -> f64 {
    let (s, n) = v.fold((0.0, 0usize), |(s, n), x| (s + x, n + 1));
    if n == 0 { 0.0 } else { s / n as f64 }
}

fn go(label: &str, d0: &[u16], d1: &[u16], rules: HouseRules, n: usize, verbose: bool) -> f64 {
    let outs: Vec<Out> = (1..=n as u64)
        .map(|s| run(s, [deck_from(d0, s, 0), deck_from(d1, s, 1)], rules))
        .collect();
    let w0 = outs.iter().filter(|o| o.winner == Some(0)).count();
    let p = w0 as f64 / n as f64;
    let lethal = outs.iter().filter(|o| o.lethal).count();
    println!(
        "{label:<34} seat0 {:5.1}% ±{:.1}   lethal {:5.1}%   rounds {:4.1}",
        p * 100.0,
        ci(p, n),
        lethal as f64 / n as f64 * 100.0,
        mean(outs.iter().map(|o| o.rounds as f64))
    );
    if verbose {
        for i in 0..SEATS {
            let reached = outs.iter().filter(|o| o.front_turn[i].is_some()).count();
            println!(
                "      seat{i}: reaches a FRONT cell in {:5.1}% of games, first at turn {:5.2} (conditional) | \
front-ticks {:5.2}  attacker-ticks {:5.2}  idle units/combat {:4.2} | castle dmg dealt: combat {:5.2} spell {:5.2} | \
pressure taken {:4.2} | summons {:4.2} charges {:4.2} spells {:4.2} | hand_end {:4.2} | had units but none in front: {:5.1}% of its on-board combats, taking {:5.2} castle dmg in them | removal aimed at a FRONT (attacking) enemy {:3.0}% of {} casts",
                reached as f64 / n as f64 * 100.0,
                mean(
                    outs.iter()
                        .filter_map(|o| o.front_turn[i].map(|t| t as f64))
                ),
                mean(outs.iter().map(|o| o.front_ticks[i] as f64)),
                mean(outs.iter().map(|o| o.attacker_ticks[i] as f64)),
                mean(
                    outs.iter()
                        .map(|o| o.idle_units[i] as f64 / o.combats.max(1) as f64)
                ),
                mean(
                    outs.iter()
                        .map(|o| (o.combat_taken[1 - i] + o.final_taken[1 - i]) as f64)
                ),
                mean(outs.iter().map(|o| o.spell_taken[1 - i] as f64)),
                mean(outs.iter().map(|o| o.pressure_taken[i] as f64)),
                mean(outs.iter().map(|o| o.summons[i] as f64)),
                mean(outs.iter().map(|o| o.charges[i] as f64)),
                mean(outs.iter().map(|o| o.spells[i] as f64)),
                mean(outs.iter().map(|o| o.hand_end[i] as f64)),
                100.0 * outs.iter().map(|o| o.undef_ticks[i] as f64).sum::<f64>()
                    / outs
                        .iter()
                        .map(|o| o.onboard_ticks[i] as f64)
                        .sum::<f64>()
                        .max(1.0),
                mean(outs.iter().map(|o| o.undef_dmg[i] as f64)),
                {
                    let f: f64 = outs.iter().map(|o| o.removal_front[i] as f64).sum();
                    let t: f64 = f + outs.iter().map(|o| o.removal_other[i] as f64).sum::<f64>();
                    if t > 0.0 { 100.0 * f / t } else { 0.0 }
                },
                outs.iter()
                    .map(|o| (o.removal_front[i] + o.removal_other[i]) as u64)
                    .sum::<u64>()
            );
        }
        let stop = n - lethal;
        let tb = |t: &str| outs.iter().filter(|o| !o.lethal && o.tiebreak == t).count();
        println!(
            "      ends: lethal {lethal} (seat0 castle fell {}, seat1 {})  | stop-round {stop}: life {} units {} seat1-default {}",
            outs.iter().filter(|o| o.fell[0]).count(),
            outs.iter().filter(|o| o.fell[1]).count(),
            tb("life"),
            tb("units"),
            tb("seat1-default")
        );
        let racew = |who: usize| {
            let sel: Vec<&Out> = outs
                .iter()
                .filter(|o| match (o.front_turn[0], o.front_turn[1]) {
                    (Some(a), Some(b)) => {
                        if who == 0 {
                            a < b
                        } else {
                            b < a
                        }
                    }
                    (Some(_), None) => who == 0,
                    (None, Some(_)) => who == 1,
                    _ => false,
                })
                .collect();
            (
                sel.iter().filter(|o| o.winner == Some(who as u8)).count() as f64
                    / sel.len().max(1) as f64
                    * 100.0,
                sel.len(),
            )
        };
        let (a, na) = racew(0);
        let (b, nb) = racew(1);
        println!(
            "      front race: seat0 first n={na} -> wins {a:.1}% | seat1 first n={nb} -> wins {b:.1}%"
        );
    }
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

    // POSITIVE CONTROLS
    let dc = (1..=50u64).all(|s| {
        deck_from(&ember, s, 0) == build_deck(s, 0) && deck_from(&tide, s, 1) == build_deck(s, 1)
    });
    println!(
        "positive control 1 — my deck builder reproduces tapstone_sim::build_deck on 50 seeds: {}",
        if dc { "YES" } else { "NO" }
    );
    let mut mm = 0;
    let mut w = 0;
    for s in 1..=60u64 {
        let mine = run(s, [deck_from(&ember, s, 0), deck_from(&tide, s, 1)], hr);
        let t = play_seeded(s, 500);
        let tw = t.winner.as_deref().map(|x| match x {
            "seat0" => 0u8,
            "seat1" => 1,
            _ => 2,
        });
        if mine.winner != tw || mine.rounds != t.rounds {
            mm += 1;
        }
        if mine.winner == Some(0) {
            w += 1;
        }
    }
    println!(
        "positive control 2 — instrumented loop vs play_seeded, 60 seeds: {mm} mismatches; seat0 {w}/60 (scan said 41/60)"
    );
    println!();

    println!("=== 1. DOES THE ADVANTAGE FOLLOW THE SEAT OR THE DECK?  n={n} ===");
    go("A  Ember(s0) v Tide(s1)", &ember, &tide, hr, n, true);
    go(
        "B  Tide(s0) v Ember(s1)  [swap]",
        &tide,
        &ember,
        hr,
        n,
        true,
    );
    println!();
    println!("=== 2. PURE POSITION: identical decks, so only seat order + bonus differ ===");
    let big = n * 4;
    let me = go("C  mirror Ember", &ember, &ember, hr, big, false);
    let mt = go("D  mirror Tide", &tide, &tide, hr, big, false);
    println!(
        "   pooled positional win rate for seat 0: {:.2}% ±{:.2} over {} games",
        (me + mt) / 2.0 * 100.0,
        ci((me + mt) / 2.0, big * 2),
        big * 2
    );
    println!();
    println!("=== 3. WHICH CARD PROPERTY IS THE ADVANTAGE?  n={n} ===");
    println!("   -- add/remove a card (deck size in designs changes) --");
    let mut t_burn = tide.clone();
    t_burn.push(5);
    let mut t_haste = tide.clone();
    t_haste.push(2);
    let mut t_taunt = tide.clone();
    t_taunt.push(4);
    let e_noburn: Vec<u16> = ember.iter().copied().filter(|&c| c != 5).collect();
    go(
        "   Ember v Tide            (ref)",
        &ember,
        &tide,
        hr,
        n,
        false,
    );
    go(
        "   Ember v Tide+Flare      (reach)",
        &ember,
        &t_burn,
        hr,
        n,
        false,
    );
    go(
        "   Ember v Tide+Whelp      (haste)",
        &ember,
        &t_haste,
        hr,
        n,
        false,
    );
    go(
        "   Ember v Tide+Warden     (taunt)",
        &ember,
        &t_taunt,
        hr,
        n,
        false,
    );
    go(
        "   Ember-Flare v Tide      (-reach)",
        &e_noburn,
        &tide,
        hr,
        n,
        false,
    );
    println!("   -- SWAPS: unit count and deck size held constant, only the keyword changes --");
    let e_slow: Vec<u16> = vec![7, 7, 4, 5, 11, 12]; // Whelp+Vanguard -> 2x Tidecaller (no keyword)
    let t_fast: Vec<u16> = vec![6, 2, 8, 9, 10, 13, 11, 12]; // Tidecaller -> Cinder Whelp (Haste)
    let t_rush: Vec<u16> = vec![6, 3, 8, 9, 10, 13, 11, 12]; // Tidecaller -> Ashen Vanguard (Rush)
    let t_tnt2: Vec<u16> = vec![6, 4, 8, 9, 10, 13, 11, 12]; // Tidecaller -> Hearth Warden (Taunt)
    go(
        "   Ember_slow v Tide   (-Haste/Rush)",
        &e_slow,
        &tide,
        hr,
        n,
        true,
    );
    go(
        "   Ember v Tide_fast   (+Haste)",
        &ember,
        &t_fast,
        hr,
        n,
        false,
    );
    go(
        "   Ember v Tide_rush   (+Rush)",
        &ember,
        &t_rush,
        hr,
        n,
        false,
    );
    go(
        "   Ember v Tide_taunt  (+Taunt)",
        &ember,
        &t_tnt2,
        hr,
        n,
        false,
    );
    go(
        "   Ember_slow v Tide_fast (both)",
        &e_slow,
        &t_fast,
        hr,
        n,
        false,
    );
    println!(
        "   -- mirror of the slow deck: is position still neutral when nobody can reach the front? --"
    );
    go("   mirror Ember_slow", &e_slow, &e_slow, hr, n, false);
    println!();
    println!(
        "=== 6. RULES OR PICKER? give Tide patience with its removal, change nothing else ==="
    );
    go_p(
        "   Ember v Tide          (shipped)",
        &ember,
        &tide,
        hr,
        n,
        [false, false],
    );
    go_p(
        "   Ember v Tide-patient  (holds)",
        &ember,
        &tide,
        hr,
        n,
        [false, true],
    );
    println!();
    println!("=== 5. SEPARATING 'acts first' FROM 'extra cards' (mirrors, high n) ===");
    let hn = n * 4;
    for (nm, list) in [("mirror-Ember", &ember), ("mirror-Tide", &tide)] {
        for b in [0u8, 1, 2] {
            let r = HouseRules {
                second_player_bonus: b,
                ..hr
            };
            go(&format!("   {nm} bonus={b}"), list, list, r, hn, false);
        }
    }
    println!();
    println!("=== 4. deck composition (what the picker is handed) ===");
    for (nm, list) in [("Ember", &ember), ("Tide", &tide)] {
        let (mut u, mut s, mut atk, mut cost) = (0, 0, 0u32, 0u32);
        for &c in list.iter() {
            let d = design(c).unwrap();
            cost += d.cost as u32;
            match d.kind {
                CardKind::Unit { attack, .. } => {
                    u += 1;
                    atk += attack as u32;
                }
                CardKind::Spell(_) => s += 1,
                _ => {}
            }
        }
        println!(
            "   {nm:<6} {} designs: {u} units (total attack {atk}), {s} spells, mean cost {:.2}; unit share of a {DECK_SIZE}-card deck {:.0}%",
            list.len(),
            cost as f64 / list.len() as f64,
            u as f64 / list.len() as f64 * 100.0
        );
    }
}
