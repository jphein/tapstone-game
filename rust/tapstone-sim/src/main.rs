use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use tapstone_sim::balance::{
    BalanceRun, adhoc_variant, run_variant_setup, variant_rules, variants,
};
use tapstone_sim::{Decks, Setup, Style};
use tapstone_sim::{Transcript, play_seeded, replay};

const GOLDEN_SEEDS: [u64; 3] = [1, 2, 3];
const GOLDEN_TAPS: usize = 500;

#[derive(Parser)]
#[command(
    name = "tapstone-sim",
    about = "Scripted-seat harness for the Tapstone rules"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Play one seeded game and print a summary or the JSON transcript.
    Play {
        #[arg(long)]
        seed: u64,
        /// Drive this seat from the terminal; the other is played by --picker. The engine and the
        /// arbiter are the real ones, so the transcript replays and hashes like any other game.
        #[arg(long)]
        human: Option<u8>,
        /// Which picker plays the other seat. Playing against play-out and against pass-early are
        /// different experiments.
        #[arg(long, default_value = "play-out")]
        picker: String,
        /// Where to write the transcript (default: human-seed<N>.json for a human game).
        #[arg(long)]
        out: Option<PathBuf>,
        /// Deck file (by stem, from decks/) for the human's seat. Omit for the built-in list.
        #[arg(long)]
        deck: Option<String>,
        /// Deck file for the opponent's seat.
        #[arg(long)]
        deck_opponent: Option<String>,
        #[arg(long, default_value_t = GOLDEN_TAPS)]
        taps: usize,
        #[arg(long)]
        json: bool,
    },
    /// Manage the golden transcripts under golden/.
    Golden {
        #[command(subcommand)]
        op: GoldenOp,
    },
    /// Replay a transcript through a fresh engine and compare with the hashes it carries.
    Replay { file: PathBuf },
    /// Validate every deck file under decks/.
    Decks,
    /// Read a human game against what the pickers can structurally produce.
    Divergence {
        file: PathBuf,
        /// Which seat the human played.
        #[arg(long, default_value_t = 0)]
        human: u8,
        /// Games per picker for the control ranges.
        #[arg(long, default_value_t = 20)]
        control_games: u32,
    },
    /// Search the house-rule constants for a configuration that makes a MIRROR opening fair.
    Fairness {
        #[arg(long, default_value_t = 4000)]
        games: u32,
        #[arg(long, default_value_t = GOLDEN_TAPS)]
        taps: usize,
        /// Which deck pairing. A mirror is the only one that can answer "is the SEAT fair".
        #[arg(long, default_value = "mirror-ember")]
        decks: String,
        /// Report every configuration whose mirror win rate is within this many points of 50.
        #[arg(long, default_value_t = 2.0)]
        tolerance: f64,
        /// Grid axes, comma-separated. Castle life is the finest lever available here: a card is
        /// a coarse step and a hit point is not, so this is where a sub-card correction would live.
        #[arg(long, default_value = "0,1,2")]
        bonus: String,
        #[arg(long, default_value = "10,12,16,20,24")]
        life: String,
        #[arg(long, default_value = "3,4,6,8,10")]
        from: String,
        #[arg(long, default_value = "10,12,16")]
        stop: String,
        #[arg(long)]
        jobs: Option<usize>,
    },
    /// 0030's balance bound: every max-level full-kit commander against a fresh one on a mirror,
    /// the veteran in each seat, under both pickers. Also the fresh-vs-fresh mirror for 0026.
    /// Exits 1 if any loadout's Wilson upper end is over the bound.
    Commander {
        #[arg(long, default_value_t = 4000)]
        games: u32,
        #[arg(long, default_value_t = GOLDEN_TAPS)]
        taps: usize,
        #[arg(long, default_value = "mirror-ember")]
        decks: String,
        /// The bound, in percent (0030).
        #[arg(long, default_value_t = 60.0)]
        bound: f64,
        /// Override the house rule `commander_fall` (castle loss on a commander death).
        #[arg(long)]
        fall: Option<u8>,
        /// Override the house rule `commander_return` (rounds until it comes back).
        #[arg(long = "return")]
        return_rounds: Option<u8>,
        /// Only these rows (label prefixes, repeatable); omit for all.
        #[arg(long = "row")]
        only: Vec<String>,
        #[arg(long)]
        jobs: Option<usize>,
    },
    /// Sweep house-rule variants over a seed range and report the outcome split.
    Balance {
        /// Games per variant; the seeds are always 1..=games.
        #[arg(long, default_value_t = 500)]
        games: u32,
        #[arg(long, default_value_t = GOLDEN_TAPS)]
        taps: usize,
        /// Variant name, repeatable. Omit for every built-in variant.
        #[arg(long = "variant")]
        variants: Vec<String>,
        #[arg(long)]
        json: bool,
        /// Threads. Games are pure given their seed, so this changes speed, never results.
        #[arg(long)]
        jobs: Option<usize>,
        /// Which seat picker produced these numbers. Every balance figure is conditional on it.
        #[arg(long, default_value = "play-out")]
        picker: String,
        /// Seat 1's picker, when it should differ from seat 0's (a person against a bot). Omit
        /// for the same picker on both seats.
        #[arg(long)]
        picker1: Option<String>,
        /// Deck pairing: asymmetric (the shipped Ember vs Tide), mirror-ember, mirror-tide,
        /// swapped. Only a mirror can say whether the SEAT is fair.
        #[arg(long, default_value = "asymmetric")]
        decks: String,
        /// Any of these four builds ONE ad-hoc variant (the defaults with only these changed),
        /// labelled like a fairness row. With no --variant it runs alone; name built-ins with
        /// --variant to put them in the same table.
        #[arg(long)]
        bonus: Option<u8>,
        #[arg(long)]
        life: Option<u8>,
        #[arg(long)]
        from: Option<u8>,
        #[arg(long)]
        stop: Option<u8>,
    },
}

#[derive(Subcommand)]
enum GoldenOp {
    /// Rewrite golden/seed-{1,2,3}.json from the current engine.
    Update,
    /// Recompute each golden game and exit 1 on any mismatch.
    Check,
}

/// One row per variant, plus a header naming the seed range so a run is reproducible.
fn print_balance_table(runs: &[BalanceRun], games: u32, taps: usize, jobs: usize, picker: &str) {
    println!(
        "tapstone-sim balance — picker {picker}, seeds 1..={games}, {taps} taps/game, {jobs} jobs"
    );
    // 11 wide, as the built-in labels always were, so their rows stay byte-for-byte what they
    // were; an ad-hoc label ("b1 life16 from8 stop12") widens the column for the whole table.
    let w = runs
        .iter()
        .map(|r| r.label.len())
        .max()
        .unwrap_or(0)
        .max(11);
    println!(
        "{:<w$} {:>6} {:>7} {:>6} {:>7} {:>7} {:>6} {:>6} {:>10} {:>7} {:>7} {:>7} {:>7} {:>7}",
        "variant",
        "games",
        "seat0%",
        "±95%",
        "seat1%",
        "lethal",
        "stop",
        "unfin",
        "rounds",
        "min-max",
        "recs/g",
        "mull/g",
        "recs0/g",
        "recs1/g"
    );
    for r in runs {
        let pct = |n: u32| {
            if r.games == 0 {
                0.0
            } else {
                100.0 * f64::from(n) / f64::from(r.games)
            }
        };
        println!(
            "{:<w$} {:>6} {:>7.1} {:>6.1} {:>7.1} {:>7} {:>6} {:>6} {:>10.2} {:>7} {:>7.1} {:>7.2} {:>7.1} {:>7.1}",
            r.label,
            r.games,
            100.0 * r.seat0_win_rate(),
            100.0 * r.seat0_win_rate_ci95(),
            pct(r.seat1_wins),
            r.ended_by_lethal,
            r.ended_at_stop,
            r.unfinished,
            r.rounds.mean,
            format!("{}-{}", r.rounds.min, r.rounds.max),
            r.mean_records,
            f64::from(r.mulligans) / f64::from(r.games.max(1)),
            r.mean_records_by_seat[0],
            r.mean_records_by_seat[1],
        );
    }
}

fn golden_path(seed: u64) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("golden")
        .join(format!("seed-{seed}.json"))
}

fn main() -> ExitCode {
    match Cli::parse().cmd {
        Cmd::Play {
            seed,
            taps,
            json,
            human,
            picker,
            out,
            deck,
            deck_opponent,
        } => {
            if let Some(h) = human {
                if h as usize >= 2 {
                    eprintln!("--human takes 0 or 1");
                    return ExitCode::FAILURE;
                }
                let Some(style) = (match picker.as_str() {
                    "play-out" => Some(Style::PlayOut),
                    "pass-early" => Some(Style::PassEarly),
                    _ => None,
                }) else {
                    eprintln!("unknown picker {picker:?}; known: play-out, pass-early");
                    return ExitCode::FAILURE;
                };
                let rules = tapstone_rules::HouseRules::default();
                // A named deck for a seat, or that seat's compiled-in list. The built-ins stay the
                // default so a seedless run — and every golden — is byte-for-byte what it was.
                let mut lists = [
                    (
                        tapstone_sim::CASTLES[0],
                        tapstone_sim::Decks::default()
                            .designs(0)
                            .iter()
                            .copied()
                            .cycle()
                            .take(tapstone_sim::DECK_SIZE)
                            .collect::<Vec<u16>>(),
                    ),
                    (
                        tapstone_sim::CASTLES[1],
                        tapstone_sim::Decks::default()
                            .designs(1)
                            .iter()
                            .copied()
                            .cycle()
                            .take(tapstone_sim::DECK_SIZE)
                            .collect::<Vec<u16>>(),
                    ),
                ];
                for (seat, want) in [(h as usize, &deck), (1 - h as usize, &deck_opponent)] {
                    if let Some(name) = want {
                        match tapstone_sim::deck::load_named(name, &rules) {
                            Ok(d) => {
                                println!(
                                    "  seat {seat}: {} ({} cards, {})",
                                    d.name,
                                    d.cards.len(),
                                    d.owner
                                );
                                lists[seat] = (d.castle, d.cards);
                            }
                            Err(e) => {
                                eprintln!("{e}");
                                return ExitCode::FAILURE;
                            }
                        }
                    }
                }
                let t = match tapstone_sim::human::play_human(seed, taps, h, style, lists, rules) {
                    Ok(t) => t,
                    Err(e) => {
                        eprintln!("play: {e}");
                        return ExitCode::FAILURE;
                    }
                };
                let path = out.unwrap_or_else(|| PathBuf::from(format!("human-seed{seed}.json")));
                let text = serde_json::to_string_pretty(&t).expect("transcript serialises");
                if let Err(e) = std::fs::write(&path, text + "\n") {
                    eprintln!("{}: {e}", path.display());
                    return ExitCode::FAILURE;
                }
                println!(
                    "  transcript: {} ({} records, final_hash {})",
                    path.display(),
                    t.records.len(),
                    t.final_hash
                );
                return ExitCode::SUCCESS;
            }
            let t = play_seeded(seed, taps);
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&t).expect("transcript serialises")
                );
            } else {
                println!("{}", t.summary());
            }
            ExitCode::SUCCESS
        }
        Cmd::Golden {
            op: GoldenOp::Update,
        } => {
            for seed in GOLDEN_SEEDS {
                let t = play_seeded(seed, GOLDEN_TAPS);
                let path = golden_path(seed);
                let mut text = serde_json::to_string_pretty(&t).expect("transcript serialises");
                text.push('\n');
                if let Err(e) = std::fs::write(&path, text) {
                    eprintln!("{}: {e}", path.display());
                    return ExitCode::FAILURE;
                }
                println!("{} <- {}", path.display(), t.summary());
            }
            ExitCode::SUCCESS
        }
        Cmd::Golden {
            op: GoldenOp::Check,
        } => {
            let mut ok = true;
            for seed in GOLDEN_SEEDS {
                let path = golden_path(seed);
                let golden: Option<Transcript> = std::fs::read_to_string(&path)
                    .ok()
                    .and_then(|s| serde_json::from_str(&s).ok());
                let now = play_seeded(seed, GOLDEN_TAPS);
                match golden {
                    Some(g) if g == now => println!("seed {seed}: ok"),
                    Some(g) => {
                        ok = false;
                        println!(
                            "seed {seed}: MISMATCH (golden {} vs now {})",
                            g.final_hash, now.final_hash
                        );
                    }
                    None => {
                        ok = false;
                        println!(
                            "seed {seed}: golden missing or unreadable at {}",
                            path.display()
                        );
                    }
                }
            }
            if ok {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
        Cmd::Balance {
            games,
            taps,
            variants: names,
            json,
            jobs,
            picker,
            picker1,
            decks,
            bonus,
            life,
            from,
            stop,
        } => {
            let parse_picker = |name: &str| match name {
                "play-out" => Some(Style::PlayOut),
                "pass-early" => Some(Style::PassEarly),
                _ => None,
            };
            let Some(style) = parse_picker(&picker) else {
                eprintln!("unknown picker {picker:?}; known: play-out, pass-early");
                return ExitCode::FAILURE;
            };
            let style1 = match picker1.as_deref().map(|p| (p, parse_picker(p))) {
                None => None,
                Some((_, Some(s))) => Some(s),
                Some((p, None)) => {
                    eprintln!("unknown picker1 {p:?}; known: play-out, pass-early");
                    return ExitCode::FAILURE;
                }
            };
            let Some(deck_pairing) = Decks::parse(&decks) else {
                eprintln!(
                    "unknown decks {decks:?}; known: asymmetric, mirror-ember, mirror-tide, swapped"
                );
                return ExitCode::FAILURE;
            };
            let adhoc = [bonus, life, from, stop]
                .iter()
                .any(Option::is_some)
                .then(|| adhoc_variant(bonus, life, from, stop));
            let jobs = jobs
                .filter(|j| *j > 0)
                .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
            let mut chosen: Vec<(String, _)> = if names.is_empty() && adhoc.is_some() {
                Vec::new()
            } else if names.is_empty() {
                variants()
                    .into_iter()
                    .map(|(n, r)| (n.to_string(), r))
                    .collect()
            } else {
                let mut out = Vec::new();
                for name in &names {
                    match variant_rules(name) {
                        Some(r) => out.push((name.clone(), r)),
                        None => {
                            let known: Vec<&str> = variants().into_iter().map(|(n, _)| n).collect();
                            eprintln!("unknown variant {name:?}; known: {}", known.join(", "));
                            return ExitCode::FAILURE;
                        }
                    }
                }
                out
            };
            chosen.extend(adhoc);
            let runs: Vec<BalanceRun> = chosen
                .iter()
                .map(|(label, rules)| {
                    run_variant_setup(
                        label,
                        Setup {
                            rules: *rules,
                            style,
                            style1,
                            decks: deck_pairing,
                            ..Setup::default()
                        },
                        games,
                        taps,
                        jobs,
                    )
                })
                .collect();
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&runs).expect("runs serialise")
                );
            } else {
                // The header names everything the numbers are conditional on, and says nothing new
                // for a default run, so a baseline table reads exactly as it always did.
                let mut who = picker.clone();
                if let Some(p1) = picker1.as_deref().filter(|p1| *p1 != picker) {
                    who = format!("{who} (seat 1: {p1})");
                }
                if deck_pairing != Decks::default() {
                    who = format!("{who}, decks {deck_pairing:?}");
                }
                print_balance_table(&runs, games, taps, jobs, &who);
            }
            ExitCode::SUCCESS
        }
        Cmd::Commander {
            games,
            taps,
            decks,
            bound,
            fall,
            return_rounds,
            only,
            jobs,
        } => {
            let d = tapstone_rules::HouseRules::default();
            let rules = tapstone_rules::HouseRules {
                commander_fall: fall.unwrap_or(d.commander_fall),
                commander_return: return_rounds.unwrap_or(d.commander_return),
                ..d
            };
            use tapstone_sim::progression::{
                ITEM_KEYWORDS, Item, LEVEL_MAX, Verdict, commander_at, max_loadouts,
                veteran_vs_fresh_on,
            };
            let Some(decks) = Decks::parse(&decks) else {
                eprintln!(
                    "unknown decks {decks:?}; known: asymmetric, mirror-ember, mirror-tide, swapped"
                );
                return ExitCode::FAILURE;
            };
            let jobs = jobs
                .filter(|j| *j > 0)
                .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
            let pickers = [
                ("play-out", Style::PlayOut),
                ("pass-early", Style::PassEarly),
            ];
            println!(
                "tapstone-sim commander — decks {decks:?}, seeds 1..={games} per seat, {taps} taps, {jobs} jobs, commander_fall {} commander_return {}",
                rules.commander_fall, rules.commander_return
            );
            println!(
                "\nfresh vs fresh (seat 0 win %, the 0026 mirror with commanders on the board):"
            );
            for (name, style) in pickers {
                let r = run_variant_setup(
                    "fresh",
                    Setup {
                        rules,
                        style,
                        decks,
                        ..Setup::default()
                    },
                    games,
                    taps,
                    jobs,
                );
                let (lo, hi) = tapstone_sim::progression::wilson95(r.seat0_wins, r.games);
                println!(
                    "  {name:<10} seat0 {:>5.1} [{:.2}-{:.2}]  rounds {:.2}  lethal {}/{}",
                    100.0 * r.seat0_win_rate(),
                    100.0 * lo,
                    100.0 * hi,
                    r.rounds.mean,
                    r.ended_by_lethal,
                    r.games
                );
            }
            println!(
                "\nveteran win % vs a fresh level-1 commander (as seat 0 / as seat 1 / seat-balanced [95% Wilson]); OVER = upper end > {bound}%:"
            );
            println!("{:<22} {:>38} {:>38}", "loadout", "play-out", "pass-early");
            // Single steps first — each level milestone bare, then level 1 wearing one item — so a
            // failing bound says WHICH row of the table to shrink, then every max-level full kit.
            let mut rows: Vec<(String, tapstone_rules::Commander)> = Vec::new();
            let mut last = commander_at(1, &[]);
            for level in 2..=LEVEL_MAX {
                let c = commander_at(level, &[]);
                if c != last {
                    rows.push((format!("L{level} bare {}/{}", c.attack, c.toughness), c));
                    last = c;
                }
            }
            for item in [Item::Look]
                .into_iter()
                .chain(ITEM_KEYWORDS.iter().copied().map(Item::Keyword))
            {
                rows.push((format!("L1 +{item:?}"), commander_at(1, &[item])));
            }
            rows.extend(
                max_loadouts()
                    .into_iter()
                    .map(|(n, c)| (format!("L{LEVEL_MAX} {n}"), c)),
            );
            rows.retain(|(label, _)| {
                only.is_empty() || only.iter().any(|o| label.starts_with(o.as_str()))
            });
            // A filter that matches nothing checks nothing, and a gate that checked nothing must
            // not pass (verification.md: the lint arm that skipped its own chip and exited 0).
            if rows.is_empty() {
                eprintln!("no loadout matches --row {only:?}: nothing was checked");
                return ExitCode::from(2);
            }
            let mut worst_overall = Verdict::Clear;
            let (mut over_n, mut unresolved_n) = (0, 0);
            for (label, c) in rows {
                let mut cells = Vec::new();
                let mut worst = Verdict::Clear;
                for (_, style) in pickers {
                    let v = veteran_vs_fresh_on(c, rules, style, decks, games, taps, jobs);
                    let (lo, hi) = v.interval();
                    // Judged on the interval's upper end: a point under the bound whose
                    // interval crosses it has not shown headroom.
                    worst = worst.max(v.verdict(bound / 100.0));
                    cells.push(format!(
                        "{:>5.1} /{:>5.1} /{:>5.1} [{:>6.2}-{:>6.2}]",
                        100.0 * v.veteran_wins_seat0(),
                        100.0 * v.veteran_wins_seat1(),
                        100.0 * v.veteran_win_rate(),
                        100.0 * lo,
                        100.0 * hi
                    ));
                }
                over_n += usize::from(worst == Verdict::Over);
                unresolved_n += usize::from(worst == Verdict::Unresolved);
                worst_overall = worst_overall.max(worst);
                println!(
                    "{label:<22} {:>38} {:>38}{}",
                    cells[0],
                    cells[1],
                    match worst {
                        Verdict::Clear => "",
                        Verdict::Unresolved => "  UNRESOLVED",
                        Verdict::Over => "  OVER",
                    }
                );
            }
            println!(
                "\n{over_n} loadout(s) over the {bound}% bound, {unresolved_n} unresolved at {games} games, under at least one picker"
            );
            // A gate, like `golden check`, and it fails closed: only a run whose every interval is
            // under the bound passes. An interval that straddles the bound is not a breach but an
            // undecided sample, so it exits 2 with a rerun instruction instead of 1, which would
            // read as a regression (PR #54's review: at --games 1000 the gate passed by 0.05).
            match worst_overall {
                Verdict::Clear => ExitCode::SUCCESS,
                Verdict::Unresolved => {
                    eprintln!(
                        "unresolved: rerun with more games (the README gate uses --games 4000)"
                    );
                    ExitCode::from(2)
                }
                Verdict::Over => ExitCode::FAILURE,
            }
        }
        Cmd::Fairness {
            games,
            taps,
            decks,
            tolerance,
            bonus,
            life,
            from,
            stop,
            jobs,
        } => {
            let axis = |s: &str| -> Option<Vec<u8>> {
                s.split(',').map(|v| v.trim().parse::<u8>().ok()).collect()
            };
            let (Some(bonuses), Some(lives), Some(froms), Some(stops)) =
                (axis(&bonus), axis(&life), axis(&from), axis(&stop))
            else {
                eprintln!("grid axes must be comma-separated integers");
                return ExitCode::FAILURE;
            };
            let Some(decks) = Decks::parse(&decks) else {
                eprintln!(
                    "unknown decks {decks:?}; known: asymmetric, mirror-ember, mirror-tide, swapped"
                );
                return ExitCode::FAILURE;
            };
            let jobs = jobs
                .filter(|j| *j > 0)
                .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
            let base = tapstone_rules::HouseRules::default();
            let mut rows: Vec<(String, BalanceRun, BalanceRun)> = Vec::new();
            // The grid deliberately runs PAST the plausible range on the low side: if the fair
            // point is unreachable, that claim is only worth making once the boundary has been
            // tested rather than assumed from the edge of a conveniently chosen grid.
            for &bonus in &bonuses {
                for &life in &lives {
                    for &from in &froms {
                        for &stop in &stops {
                            let rules = tapstone_rules::HouseRules {
                                second_player_bonus: bonus,
                                castle_life: life,
                                pressure_from: from,
                                stop_round: stop,
                                ..base
                            };
                            let label = format!("b{bonus} life{life} from{from} stop{stop}");
                            let po = run_variant_setup(
                                &label,
                                Setup {
                                    rules,
                                    style: Style::PlayOut,
                                    decks,
                                    ..Setup::default()
                                },
                                games,
                                taps,
                                jobs,
                            );
                            let pe = run_variant_setup(
                                &label,
                                Setup {
                                    rules,
                                    style: Style::PassEarly,
                                    decks,
                                    ..Setup::default()
                                },
                                games,
                                taps,
                                jobs,
                            );
                            rows.push((label, po, pe));
                        }
                    }
                }
            }
            rows.sort_by(|a, b| {
                let d = |r: &BalanceRun| (r.seat0_win_rate() * 100.0 - 50.0).abs();
                d(&a.1).partial_cmp(&d(&b.1)).unwrap()
            });
            println!(
                "tapstone-sim fairness — decks {decks:?}, seeds 1..={games}, {taps} taps, {jobs} jobs\n                 A MIRROR: both seats play the same list, so anything left is the SEAT, not the cards.\n"
            );
            println!(
                "{:<26} {:>15} {:>15} {:>7} {:>6} {:>6} {:>18}",
                "config",
                "play-out",
                "pass-early",
                "rounds",
                "lethal",
                "stop",
                "stop decided L/U/S"
            );
            // Derived from the defaults, not typed: the typed copy still said bonus 1 after 0026
            // shipped bonus 0.
            let shipped = format!(
                "b{} life{} from{} stop{}",
                base.second_player_bonus, base.castle_life, base.pressure_from, base.stop_round
            );
            let mut shown = 0;
            for (label, po, pe) in &rows {
                let off = (po.seat0_win_rate() * 100.0 - 50.0).abs();
                if off > tolerance && *label != shipped {
                    continue;
                }
                shown += 1;
                println!(
                    "{:<26} {:>7.1} ±{:<6.1} {:>7.1} ±{:<6.1} {:>7.2} {:>6} {:>6} {:>6}/{:>4}/{:>4}{}",
                    label,
                    100.0 * po.seat0_win_rate(),
                    100.0 * po.seat0_win_rate_ci95(),
                    100.0 * pe.seat0_win_rate(),
                    100.0 * pe.seat0_win_rate_ci95(),
                    po.rounds.mean,
                    po.ended_by_lethal,
                    po.ended_at_stop,
                    po.stop_decided_by_life,
                    po.stop_decided_by_units,
                    po.stop_decided_by_seat,
                    if *label == shipped {
                        "   <- as shipped"
                    } else {
                        ""
                    },
                );
            }
            // >>> BOTH PICKERS, NOT THE FLATTERING ONE. <<< A configuration fair under one and
            // not the other is tuned to a heuristic rather than to the rules, and reporting the
            // kinder of the two — or their average — would hide exactly that.
            let both = rows
                .iter()
                .filter(|(_, po, pe)| {
                    (po.seat0_win_rate() * 100.0 - 50.0).abs() <= tolerance
                        && (pe.seat0_win_rate() * 100.0 - 50.0).abs() <= tolerance
                })
                .count();
            println!(
                "\n{shown} of {} within ±{tolerance} of 50/50 under play-out; {both} under BOTH pickers.",
                rows.len()
            );
            // Say what the tolerance filter hid. An empty table otherwise reads as "no result"
            // when it means "every row is unfair by more than the tolerance" (the first-match
            // measurement, 2026-09-25, printed a header and nothing else).
            let hidden = rows.len() - shown;
            if hidden > 0 {
                println!(
                    "{hidden} row(s) hidden by --tolerance {tolerance}; --tolerance 100 shows every row."
                );
            }
            ExitCode::SUCCESS
        }
        Cmd::Decks => {
            let rules = tapstone_rules::HouseRules::default();
            let (ok, bad) = tapstone_sim::deck::load_all(&rules);
            for d in &ok {
                println!(
                    "  {:<16} {:<20} castle {:<3} {} cards, most copies of one design: {}",
                    tapstone_sim::deck::slug(&d.name),
                    d.name,
                    d.castle,
                    d.cards.len(),
                    d.most_copies()
                );
            }
            for e in &bad {
                eprintln!("{e}");
            }
            println!("\n  {} deck(s) valid, {} rejected", ok.len(), bad.len());
            if bad.is_empty() {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
        Cmd::Divergence {
            file,
            human,
            control_games,
        } => {
            let text = match std::fs::read_to_string(&file) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("{}: {e}", file.display());
                    return ExitCode::FAILURE;
                }
            };
            let t: Transcript = match serde_json::from_str(&text) {
                Ok(t) => t,
                Err(e) => {
                    eprintln!("{}: not a transcript: {e}", file.display());
                    return ExitCode::FAILURE;
                }
            };
            let findings = match tapstone_sim::divergence::analyse(&t, human) {
                Ok(f) => f,
                Err(e) => {
                    eprintln!("{}: {e}", file.display());
                    return ExitCode::FAILURE;
                }
            };
            let rules = (&t.house_rules).into();
            let controls = vec![
                (
                    "play-out",
                    tapstone_sim::divergence::baseline(
                        rules,
                        GOLDEN_TAPS,
                        control_games,
                        Style::PlayOut,
                        human,
                    ),
                ),
                (
                    "pass-early",
                    tapstone_sim::divergence::baseline(
                        rules,
                        GOLDEN_TAPS,
                        control_games,
                        Style::PassEarly,
                        human,
                    ),
                ),
            ];
            print!(
                "{}",
                tapstone_sim::divergence::report(&t, human, &findings, &controls)
            );
            ExitCode::SUCCESS
        }
        Cmd::Replay { file } => {
            let text = match std::fs::read_to_string(&file) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("{}: {e}", file.display());
                    return ExitCode::FAILURE;
                }
            };
            let t: Transcript = match serde_json::from_str(&text) {
                Ok(t) => t,
                Err(e) => {
                    eprintln!("{}: not a transcript: {e}", file.display());
                    return ExitCode::FAILURE;
                }
            };
            match replay(&t) {
                Ok(r) if r.matches(&t) => {
                    println!(
                        "{}: ok ({} records, final_hash {})",
                        file.display(),
                        t.records.len(),
                        r.final_hash
                    );
                    ExitCode::SUCCESS
                }
                Ok(r) => {
                    let first = r
                        .hashes
                        .iter()
                        .zip(&t.records)
                        .enumerate()
                        .find(|(_, (h, rec))| **h != rec.hash);
                    match first {
                        Some((i, (mine, rec))) => println!(
                            "{}: MISMATCH at record {i} (seq {}): file {} vs replay {}",
                            file.display(),
                            rec.seq,
                            rec.hash.as_deref().unwrap_or("null"),
                            mine.as_deref().unwrap_or("null")
                        ),
                        None => println!(
                            "{}: MISMATCH (file {} vs replay {})",
                            file.display(),
                            t.final_hash,
                            r.final_hash
                        ),
                    }
                    ExitCode::FAILURE
                }
                Err(e) => {
                    println!("{}: replay failed: {e}", file.display());
                    ExitCode::FAILURE
                }
            }
        }
    }
}
