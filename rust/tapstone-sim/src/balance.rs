//! Balance sweeps: play a fixed seed range under a house-rule variant and aggregate the outcomes.
//!
//! What this measures is the behaviour of the *scripted seats*, which are weighted heuristics, not
//! players: they never bluff, never hold removal for a threat and never race. An asymmetry here is
//! evidence about the rules as these heuristics exercise them, not about human play.
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tapstone_rules::cards::design;
use tapstone_rules::{HouseRules, state::SEATS};

use crate::transcript::{HouseRulesJson, Transcript};
use crate::{Setup, Style, play_seeded_parts};

/// One variant built from flags: the shipped defaults with only the given house rules changed.
/// The label names all four levers, the same form `fairness` prints, so a row reads the same in
/// both tables. Omitted levers keep the default, never zero.
pub fn adhoc_variant(
    bonus: Option<u8>,
    life: Option<u8>,
    from: Option<u8>,
    stop: Option<u8>,
) -> (String, HouseRules) {
    let d = HouseRules::default();
    let rules = HouseRules {
        second_player_bonus: bonus.unwrap_or(d.second_player_bonus),
        castle_life: life.unwrap_or(d.castle_life),
        pressure_from: from.unwrap_or(d.pressure_from),
        stop_round: stop.unwrap_or(d.stop_round),
        ..d
    };
    let label = format!(
        "b{} life{} from{} stop{}",
        rules.second_player_bonus, rules.castle_life, rules.pressure_from, rules.stop_round
    );
    (label, rules)
}

/// The built-in variants, in table order. `baseline` is the shipped default.
pub fn variants() -> Vec<(&'static str, HouseRules)> {
    let d = HouseRules::default();
    vec![
        ("baseline", d),
        (
            "bonus2",
            HouseRules {
                second_player_bonus: 2,
                ..d
            },
        ),
        (
            "bonus0",
            HouseRules {
                second_player_bonus: 0,
                ..d
            },
        ),
        (
            "pressure6",
            HouseRules {
                pressure_from: 6,
                ..d
            },
        ),
        (
            "pressure10",
            HouseRules {
                pressure_from: 10,
                ..d
            },
        ),
        (
            "stop10",
            HouseRules {
                stop_round: 10,
                ..d
            },
        ),
        (
            "stop16",
            HouseRules {
                stop_round: 16,
                ..d
            },
        ),
        (
            "life24",
            HouseRules {
                castle_life: 24,
                ..d
            },
        ),
        (
            "life16",
            HouseRules {
                castle_life: 16,
                ..d
            },
        ),
    ]
}

pub fn variant_rules(name: &str) -> Option<HouseRules> {
    variants()
        .into_iter()
        .find(|(n, _)| *n == name)
        .map(|(_, r)| r)
}

#[derive(Serialize, Deserialize, PartialEq, Debug, Clone)]
pub struct RoundStats {
    pub min: u8,
    pub max: u8,
    pub mean: f64,
    /// round reached → games
    pub histogram: BTreeMap<u8, u32>,
}

#[derive(Serialize, Deserialize, PartialEq, Debug, Clone)]
pub struct BalanceRun {
    pub label: String,
    pub rules: HouseRulesJson,
    pub games: u32,
    pub seat0_wins: u32,
    pub seat1_wins: u32,
    /// A castle reached 0.
    pub ended_by_lethal: u32,
    /// Both seats completed the stop round with both castles standing.
    pub ended_at_stop: u32,
    /// Hit the tap budget without finishing.
    pub unfinished: u32,
    /// Of the games that reached the stop round, how the winner was decided there. Both were
    /// nearly dead code under the old picker, so whether a candidate brings them to life is part
    /// of judging it: a configuration that is perfectly fair and decides everything on a tiebreak
    /// has moved the problem rather than solved it.
    pub stop_decided_by_life: u32,
    pub stop_decided_by_units: u32,
    pub stop_decided_by_seat: u32,
    pub rounds: RoundStats,
    pub mean_records: f64,
    /// Every committed record, by the seat that committed it (claims and draws included), summed
    /// over the run. Integers, so `[0] + [1]` is exactly the records counted per game.
    pub records_by_seat: [u64; SEATS],
    /// `records_by_seat` per game: the split a wall-time estimate needs when the seats tap at
    /// different speeds (a person and a bot).
    pub mean_records_by_seat: [f64; SEATS],
    pub mean_refusals: f64,
    /// Card name → total casts (`CastUnit` and `CastSpell`) over the whole run.
    pub cards_cast: BTreeMap<String, u32>,
    pub mulligans: u32,
}

impl BalanceRun {
    pub fn seat0_win_rate(&self) -> f64 {
        if self.games == 0 {
            0.0
        } else {
            f64::from(self.seat0_wins) / f64::from(self.games)
        }
    }

    /// Half-width of the 95% confidence interval on the seat 0 win rate (normal approximation).
    pub fn seat0_win_rate_ci95(&self) -> f64 {
        if self.games == 0 {
            return 0.0;
        }
        let p = self.seat0_win_rate();
        1.96 * (p * (1.0 - p) / f64::from(self.games)).sqrt()
    }

    pub fn mean_casts(&self, card: &str) -> f64 {
        if self.games == 0 {
            return 0.0;
        }
        f64::from(self.cards_cast.get(card).copied().unwrap_or(0)) / f64::from(self.games)
    }
}

/// Integer-only accumulator: every mean is divided out once at the end, so a run split across
/// threads adds exactly the same numbers in any order.
#[derive(Clone)]
struct Acc {
    games: u32,
    seat0_wins: u32,
    seat1_wins: u32,
    ended_by_lethal: u32,
    ended_at_stop: u32,
    stop_decided_by_life: u32,
    stop_decided_by_units: u32,
    stop_decided_by_seat: u32,
    unfinished: u32,
    rounds_sum: u64,
    rounds_min: u8,
    rounds_max: u8,
    histogram: BTreeMap<u8, u32>,
    records_sum: u64,
    records_by_seat: [u64; SEATS],
    refusals_sum: u64,
    cards_cast: BTreeMap<String, u32>,
    mulligans: u32,
}

impl Acc {
    fn new() -> Acc {
        Acc {
            games: 0,
            seat0_wins: 0,
            seat1_wins: 0,
            ended_by_lethal: 0,
            ended_at_stop: 0,
            stop_decided_by_life: 0,
            stop_decided_by_units: 0,
            stop_decided_by_seat: 0,
            unfinished: 0,
            rounds_sum: 0,
            rounds_min: u8::MAX,
            rounds_max: 0,
            histogram: BTreeMap::new(),
            records_sum: 0,
            records_by_seat: [0; SEATS],
            refusals_sum: 0,
            cards_cast: BTreeMap::new(),
            mulligans: 0,
        }
    }

    fn add(&mut self, t: &Transcript, castle_life: [u8; SEATS], units: [usize; SEATS]) {
        self.games += 1;
        match t.winner.as_deref() {
            Some("seat0") => self.seat0_wins += 1,
            Some("seat1") => self.seat1_wins += 1,
            _ => {}
        }
        if !t.game_over {
            self.unfinished += 1;
        } else if castle_life.contains(&0) {
            self.ended_by_lethal += 1;
        } else {
            self.ended_at_stop += 1;
            // Mirrors the engine's own finish(): life, then units, then seat 1.
            if castle_life[0] != castle_life[1] {
                self.stop_decided_by_life += 1;
            } else if units[0] != units[1] {
                self.stop_decided_by_units += 1;
            } else {
                self.stop_decided_by_seat += 1;
            }
        }
        self.rounds_sum += u64::from(t.rounds);
        self.rounds_min = self.rounds_min.min(t.rounds);
        self.rounds_max = self.rounds_max.max(t.rounds);
        *self.histogram.entry(t.rounds).or_insert(0) += 1;
        self.records_sum += t.records.len() as u64;
        self.refusals_sum += u64::from(t.refusals);
        for r in &t.records {
            self.records_by_seat[usize::from(r.seat)] += 1;
            match r.kind.as_str() {
                "Mulligan" => self.mulligans += 1,
                "CastUnit" | "CastSpell" => {
                    let name = design(r.card).map_or("unknown", |d| d.name);
                    *self.cards_cast.entry(name.to_string()).or_insert(0) += 1;
                }
                _ => {}
            }
        }
    }

    fn merge(&mut self, o: Acc) {
        self.games += o.games;
        self.seat0_wins += o.seat0_wins;
        self.seat1_wins += o.seat1_wins;
        self.ended_by_lethal += o.ended_by_lethal;
        self.ended_at_stop += o.ended_at_stop;
        self.stop_decided_by_life += o.stop_decided_by_life;
        self.stop_decided_by_units += o.stop_decided_by_units;
        self.stop_decided_by_seat += o.stop_decided_by_seat;
        self.unfinished += o.unfinished;
        self.rounds_sum += o.rounds_sum;
        self.rounds_min = self.rounds_min.min(o.rounds_min);
        self.rounds_max = self.rounds_max.max(o.rounds_max);
        for (k, v) in o.histogram {
            *self.histogram.entry(k).or_insert(0) += v;
        }
        self.records_sum += o.records_sum;
        for (mine, theirs) in self.records_by_seat.iter_mut().zip(o.records_by_seat) {
            *mine += theirs;
        }
        self.refusals_sum += o.refusals_sum;
        for (k, v) in o.cards_cast {
            *self.cards_cast.entry(k).or_insert(0) += v;
        }
        self.mulligans += o.mulligans;
    }

    fn finish(self, label: &str, rules: HouseRules) -> BalanceRun {
        let n = f64::from(self.games);
        let per_game = |sum: u64| if self.games == 0 { 0.0 } else { sum as f64 / n };
        BalanceRun {
            label: label.to_string(),
            rules: HouseRulesJson::from(&rules),
            games: self.games,
            seat0_wins: self.seat0_wins,
            seat1_wins: self.seat1_wins,
            ended_by_lethal: self.ended_by_lethal,
            ended_at_stop: self.ended_at_stop,
            stop_decided_by_life: self.stop_decided_by_life,
            stop_decided_by_units: self.stop_decided_by_units,
            stop_decided_by_seat: self.stop_decided_by_seat,
            unfinished: self.unfinished,
            rounds: RoundStats {
                min: if self.games == 0 { 0 } else { self.rounds_min },
                max: self.rounds_max,
                mean: per_game(self.rounds_sum),
                histogram: self.histogram,
            },
            mean_records: per_game(self.records_sum),
            records_by_seat: self.records_by_seat,
            mean_records_by_seat: self.records_by_seat.map(per_game),
            mean_refusals: per_game(self.refusals_sum),
            cards_cast: self.cards_cast,
            mulligans: self.mulligans,
        }
    }
}

/// Play seeds `1..=games` under `rules` and aggregate. `jobs` only splits the seed range across
/// threads; each game is pure given its seed, so the result is identical for every `jobs`.
pub fn run_variant(
    label: &str,
    rules: HouseRules,
    games: u32,
    taps: usize,
    jobs: usize,
) -> BalanceRun {
    run_variant_styled(label, rules, games, taps, jobs, Style::default())
}

/// As `run_variant`, naming the picker. A balance number without its picker's name is not a
/// result, so this is the honest entry point and `run_variant` is the convenience default.
pub fn run_variant_styled(
    label: &str,
    rules: HouseRules,
    games: u32,
    taps: usize,
    jobs: usize,
    style: Style,
) -> BalanceRun {
    run_variant_setup(
        label,
        Setup {
            rules,
            style,
            ..Setup::default()
        },
        games,
        taps,
        jobs,
    )
}

/// The full form: rules, picker and decks together, because a balance number needs all three.
pub fn run_variant_setup(
    label: &str,
    setup: Setup,
    games: u32,
    taps: usize,
    jobs: usize,
) -> BalanceRun {
    let rules = setup.rules;
    let seeds: Vec<u64> = (1..=u64::from(games)).collect();
    if seeds.is_empty() {
        return Acc::new().finish(label, rules);
    }
    let chunk = seeds.len().div_ceil(jobs.max(1)).max(1);
    let parts: Vec<Acc> = std::thread::scope(|scope| {
        let handles: Vec<_> = seeds
            .chunks(chunk)
            .map(|chunk| {
                scope.spawn(move || {
                    let mut acc = Acc::new();
                    for &seed in chunk {
                        let (arbiter, decks) = play_seeded_parts(seed, taps, setup);
                        let g = &arbiter.game;
                        let life = [g.seats[0].castle.life, g.seats[1].castle.life];
                        let units = [g.seats[0].units(), g.seats[1].units()];
                        acc.add(
                            &Transcript::from_arbiter(seed, &arbiter, decks),
                            life,
                            units,
                        );
                    }
                    acc
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("a sim thread panicked"))
            .collect()
    });
    let mut total = Acc::new();
    for part in parts {
        total.merge(part);
    }
    total.finish(label, rules)
}
