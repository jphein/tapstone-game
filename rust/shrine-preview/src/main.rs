//! `shrine-preview` — render the Tapstone shrine screens at exactly 320x240 and export PNGs.

use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

use shrine_preview::{
    battlefield::{Opts, View},
    cost, export, flourish, game, geom, panel,
};

#[derive(Parser)]
#[command(
    name = "shrine-preview",
    about = "Pixel-accurate previews of the shrine screens"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Copy, Clone, PartialEq, Eq, ValueEnum)]
enum LayoutArg {
    /// The UX doc as written: 3 rows per lane. Cannot show both seats' tracks.
    Doc3,
    /// Six rows at 28 px: the whole board, below both the sprite and touch floors.
    V6,
    /// Four rows at 42 px: front two cells per seat.
    V4,
    /// Lanes as rows, six cells at 49x64: the only layout meeting every stated constraint.
    H6,
}

impl LayoutArg {
    fn resolve(self) -> geom::Layout {
        match self {
            LayoutArg::Doc3 => geom::doc_three_row(),
            LayoutArg::V6 => geom::vertical_full(),
            LayoutArg::V4 => geom::vertical_front_two(),
            LayoutArg::H6 => geom::horizontal_full(),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, ValueEnum)]
enum ViewArg {
    Seat0,
    Seat1,
    Spectator,
}

impl ViewArg {
    fn resolve(self) -> View {
        match self {
            ViewArg::Seat0 => View::Seat(0),
            ViewArg::Seat1 => View::Seat(1),
            ViewArg::Spectator => View::Spectator,
        }
    }
}

#[derive(Subcommand)]
enum Cmd {
    /// Render one battlefield from a real game state.
    Battlefield {
        #[arg(long, default_value_t = 7)]
        seed: u64,
        #[arg(long, default_value_t = 6)]
        turn: u8,
        #[arg(long, value_enum, default_value_t = LayoutArg::H6)]
        layout: LayoutArg,
        #[arg(long, value_enum, default_value_t = ViewArg::Seat0)]
        view: ViewArg,
        #[arg(long, default_value = "preview/battlefield.png")]
        out: PathBuf,
        #[arg(long, default_value_t = 1)]
        scale: u32,
    },
    /// Render the same game state under every candidate layout, for the open ruling.
    Layouts {
        #[arg(long, default_value_t = 7)]
        seed: u64,
        #[arg(long, default_value_t = 6)]
        turn: u8,
        #[arg(long, default_value = "preview/layouts")]
        out: PathBuf,
        #[arg(long, default_value_t = 1)]
        scale: u32,
    },
    /// Render all ten screens against the ruled layout.
    All {
        #[arg(long, default_value_t = 21)]
        seed: u64,
        #[arg(long, default_value_t = 5)]
        turn: u8,
        #[arg(long, default_value = "preview/screens")]
        out: PathBuf,
        #[arg(long, default_value_t = 1)]
        scale: u32,
    },
    /// Render the card-to-castle flourish as a numbered frame sequence.
    Flourish {
        #[arg(long, default_value_t = 21)]
        seed: u64,
        #[arg(long, default_value_t = 5)]
        turn: u8,
        #[arg(long, default_value_t = 1)]
        lane: usize,
        /// Card design id; 5 is Flare, the Ember damage spell.
        #[arg(long, default_value_t = 5)]
        design: u16,
        #[arg(long, default_value = "preview/flourish")]
        out: PathBuf,
        #[arg(long, default_value_t = 1)]
        scale: u32,
    },
    /// Cost the flourish in milliseconds per frame, under both push strategies.
    FlourishCost {
        #[arg(long, default_value_t = 1)]
        lane: usize,
    },
    /// Render 0032's station screens, every motion as a filmstrip, and the comparison sheets.
    Station {
        #[arg(long, default_value = "preview/station")]
        out: PathBuf,
    },
    /// Cost every station motion per frame, across the plausible per-window range.
    StationCost,
    /// Search seeds, pickers and deck pairings for the states the station's overrides stand in for.
    SearchStates,
    /// Write the voice-clip manifest (0033): every sentence the shrine can speak.
    Clips {
        #[arg(long, default_value = "../game/voice/clips.tsv")]
        out: PathBuf,
    },
    /// Print the geometry audit: what each layout costs against the doc's own floors.
    Audit,
    /// Find the busiest board across a range of seeds and rounds.
    ///
    /// An empty board renders identically at every lane depth, which would make the comparison
    /// useless; this picks a state where the layouts actually differ.
    Scan {
        #[arg(long, default_value_t = 24)]
        seeds: u64,
        #[arg(long, default_value_t = 14)]
        rounds: u8,
    },
}

fn main() {
    if let Err(e) = run() {
        eprintln!("shrine-preview: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    match Cli::parse().cmd {
        Cmd::Battlefield {
            seed,
            turn,
            layout,
            view,
            out,
            scale,
        } => {
            let snap = game::at_round(seed, turn, 400)?;
            let l = layout.resolve();
            let p = panel::battlefield(&snap.game, view.resolve(), &l, &Opts::default());
            export::save(&p, &out, scale)?;
            println!(
                "{}  seed {seed} round {} ({} of {} records)  layout {}",
                out.display(),
                snap.round,
                snap.applied,
                snap.total,
                l.name
            );
        }
        Cmd::Layouts {
            seed,
            turn,
            out,
            scale,
        } => {
            let snap = game::at_round(seed, turn, 400)?;
            for l in geom::all() {
                for (tag, v) in [("seat0", View::Seat(0)), ("seat1", View::Seat(1))] {
                    let p = panel::battlefield(&snap.game, v, &l, &Opts::default());
                    let path = out.join(format!("{}-{tag}.png", l.name));
                    export::save(&p, &path, scale)?;
                    println!("{}", path.display());
                }
            }
            println!(
                "seed {seed}, round {} — same state, every layout",
                snap.round
            );
        }
        Cmd::All {
            seed,
            turn,
            out,
            scale,
        } => {
            let l = geom::vertical_asymmetric();
            let mid = game::at_round(seed, turn, 400)?;
            // The previous turn's board, so arrival marks answer "what changed since my last
            // turn". A real shrine keeps the frame it last drew; this reconstructs the same thing.
            let prev = turn
                .checked_sub(1)
                .filter(|r| *r >= 1)
                .and_then(|r| game::at_round(seed, r, 400).ok());
            let fin = game::final_state(seed, 400)?;
            let late = game::at_round(seed, mid.game.rules.pressure_from.max(turn), 400)?;

            let mut n = 0usize;
            let mut put = |name: &str, p: &panel::Panel| -> Result<(), String> {
                let path = out.join(format!("{name}.png"));
                export::save(p, &path, scale)?;
                println!("{}", path.display());
                n += 1;
                Ok(())
            };

            // Four standalone screens.
            put(
                "01-idle",
                &panel::screen::idle("EMBER", shrine_preview::palette::EMBER),
            )?;
            put(
                "02-pairing",
                &panel::screen::pairing("Verdant Reach (1 m)", 7, true),
            )?;
            put("03-setup", &panel::screen::setup(&mid.game, 0, true))?;
            put(
                "08-result",
                &panel::screen::result(&fin.game, 0, fin.round, 11, "e3-fern"),
            )?;

            // Six battlefield states: the doc is explicit that these are not screen changes.
            let base = Opts {
                prev: prev.as_ref().map(|s| &s.game),
                ..Default::default()
            };
            let bf = |v: View, o: Opts| panel::battlefield(&mid.game, v, &l, &o);
            put("04-battlefield", &bf(View::Seat(0), base))?;
            put(
                "05-targeting",
                &bf(
                    View::Seat(0),
                    Opts {
                        targeting: true,
                        ..Default::default()
                    },
                ),
            )?;
            put(
                "06-combat",
                &bf(
                    View::Seat(0),
                    Opts {
                        resolving: Some(1),
                        ..Default::default()
                    },
                ),
            )?;
            put(
                "07-sudden-death",
                &panel::battlefield(
                    &late.game,
                    View::Seat(0),
                    &l,
                    &Opts {
                        sudden_death: true,
                        ..Default::default()
                    },
                ),
            )?;
            put("09-spectator", &bf(View::Spectator, base))?;
            put(
                "10-disconnected",
                &bf(
                    View::Seat(0),
                    Opts {
                        overlay: Some("rival lost - waiting 27s"),
                        ..Default::default()
                    },
                ),
            )?;

            println!(
                "{n} screens, layout {}, seed {seed} round {} (sudden death at round {})",
                l.name, mid.round, late.round
            );
        }
        Cmd::Flourish {
            seed,
            turn,
            lane,
            design,
            out,
            scale,
        } => {
            let l = geom::vertical_asymmetric();
            let snap = game::at_round(seed, turn, 400)?;
            let fl = flourish::Flourish {
                lane,
                design,
                amount: 2,
            };
            for n in 0..flourish::TOTAL_FRAMES {
                let p = panel::flourish_frame(&fl, &snap.game, View::Seat(0), &l, n);
                let path = out.join(format!("frame-{n:02}.png"));
                export::save(&p, &path, scale)?;
            }
            println!(
                "{} frames -> {}  (seed {seed} round {}, lane {}, {})",
                flourish::TOTAL_FRAMES,
                out.display(),
                snap.round,
                lane + 1,
                shrine_render::battlefield::name_of(design)
            );
        }
        Cmd::FlourishCost { lane } => flourish_cost(lane),
        Cmd::Station { out } => station(&out)?,
        Cmd::StationCost => station_cost(),
        Cmd::SearchStates => {
            use shrine_preview::search;
            let t = std::time::Instant::now();
            let (found, cov) = search::search();
            println!(
                "coverage: {} games, {} replay errors, {} records",
                cov.games, cov.errors, cov.records
            );
            for (w, f) in search::WANTED.iter().zip(found) {
                match f {
                    Some(f) => println!(
                        "{w:?}: seed {} {:?} {:?}, record {}",
                        f.seed, f.style, f.decks, f.record
                    ),
                    None => println!(
                        "{w:?}: none within seeds 0..{} x {:?} x {:?}",
                        search::SEEDS,
                        search::STYLES,
                        search::DECKS
                    ),
                }
            }
            println!("searched in {:.1} s", t.elapsed().as_secs_f32());
        }
        Cmd::Clips { out } => {
            let e = shrine_preview::clips::entries();
            if let Some(dir) = out.parent() {
                std::fs::create_dir_all(dir).map_err(|x| format!("{}: {x}", dir.display()))?;
            }
            std::fs::write(&out, shrine_preview::clips::tsv(&e))
                .map_err(|x| format!("{}: {x}", out.display()))?;
            let est = shrine_preview::clips::estimate(&e);
            println!(
                "{}: {} clips ({} streamed, {} silent), {} characters",
                out.display(),
                est.clips,
                e.iter()
                    .filter(|x| x.kind == shrine_preview::clips::Kind::Streamed)
                    .count(),
                e.iter()
                    .filter(|x| x.kind == shrine_preview::clips::Kind::Silent)
                    .count(),
                est.chars
            );
            println!(
                "ESTIMATE (assumed {} chars/s, 0033's codec rates at 22,050 Hz): {:.0} s of speech, ~{:.1} MB ADPCM, ~{:.1} MB 16-bit",
                shrine_preview::clips::ASSUMED_CHARS_PER_S,
                est.seconds,
                est.adpcm_bytes / 1e6,
                est.pcm16_bytes / 1e6
            );
        }
        Cmd::Audit => audit(),
        Cmd::Scan { seeds, rounds } => {
            let mut best = (0u64, 0u8, 0usize, 0usize);
            for seed in 1..=seeds {
                for round in 1..=rounds {
                    let Ok(s) = game::at_round(seed, round, 400) else {
                        continue;
                    };
                    if s.round != round {
                        continue;
                    }
                    let units: usize = s.game.seats.iter().map(|x| x.units()).sum();
                    // Prefer boards with units on BOTH sides and something in the back cells.
                    let back: usize = s
                        .game
                        .seats
                        .iter()
                        .map(|x| x.cells.iter().filter(|l| l[0].is_some()).count())
                        .sum();
                    let both = s.game.seats.iter().all(|x| x.units() > 0);
                    let score = units * 2 + back * 3 + if both { 6 } else { 0 };
                    if score > best.2 {
                        best = (seed, round, score, units);
                    }
                }
            }
            println!(
                "busiest: seed {} round {} -> {} units (score {})",
                best.0, best.1, best.3, best.2
            );
        }
    }
    Ok(())
}

fn audit() {
    println!(
        "Panel 320x240. Between HUD bands: {} px. After two {} px walls: {} px for cells.",
        geom::BETWEEN_HUD,
        geom::WALL,
        geom::CELL_BAND
    );
    println!(
        "The engine tracks {} cells per lane (3 per seat).\n",
        geom::CELLS_PER_LANE
    );
    println!("Criteria, in the weighting the lane-depth ruling uses:");
    println!("  board  - whole board incl. back cells, where units develop");
    println!("  lanes  - on-screen lane index matches the apron's left-to-right pads (dec 0018)");
    println!("  spr32  - sprite clears decision 0014's 32 px base");
    println!(
        "  touch  - 44 px target; weighted LOWEST (dec 0009 / 0018 make touch the fallback)\n"
    );
    println!(
        "{:<10} {:>10} {:>8} {:>7} {:>6} {:>6} {:>6}",
        "layout", "my cell", "sprite", "board", "lanes", "spr32", "touch"
    );
    for l in geom::all() {
        println!(
            "{:<10} {:>5}x{:<4} {:>8} {:>7} {:>6} {:>6} {:>6}",
            l.name,
            l.cell_adv,
            l.cell_cross,
            l.sprite,
            if l.shows_whole_board() {
                "full"
            } else {
                "PART"
            },
            if l.lane_index_matches_apron() {
                "ok"
            } else {
                "ROT"
            },
            if l.sprite_base_ok() { "ok" } else { "FAIL" },
            if l.touchable_near() { "ok" } else { "fail" },
        );
    }
    println!(
        "\nTheir cells: v6-asym draws them at {} px as read-only stat chips; every other",
        geom::vertical_asymmetric().far_adv
    );
    println!("layout draws both sides at the same size.");
}

/// The question this whole prototype exists to answer: what does the flourish cost per frame, and
/// does the answer survive being wrong about the one extrapolated constant in the model?
fn flourish_cost(lane: usize) {
    let fl = flourish::Flourish {
        lane,
        design: 5,
        amount: 2,
    };
    println!(
        "Panel 320x240. Full repaint {:.1} ms (raster {:.1} + wire {:.1}).",
        cost::FULL_REPAINT_MS,
        cost::RASTER_FULL_MS,
        cost::WIRE_FULL_MS
    );
    println!(
        "15 fps interval {:.1} ms; draw budget {:.1} ms (half, per decision 0010).",
        cost::FRAME_INTERVAL_MS,
        cost::DRAW_BUDGET_MS
    );
    println!(
        "Per-window overhead is ONE extrapolated point: {:.2} ms. Range tested {:.2}-{:.2} ms.\n",
        cost::WINDOW_SETUP_MS,
        cost::SETUP_RANGE_MS.0,
        cost::SETUP_RANGE_MS.1
    );

    println!(
        "{:<6} {:<8} {:>10} {:>9} {:>9} {:>9}  verdict",
        "frame", "phase", "dirty px", "1 window", "per-cell", "full"
    );
    let mut worst: f32 = 0.0;
    for n in 0..flourish::TOTAL_FRAMES {
        let r = fl.dirty(n);
        let v = cost::verdict(&[r]);
        let (best, wst) = v.chosen_ms();
        worst = worst.max(wst);
        // What the naive optimisation would cost: the same area split per cell.
        let cells = (r.size.height as i32 / 36).max(1) as usize;
        let split: Vec<_> = (0..cells)
            .map(|i| {
                embedded_graphics::primitives::Rectangle::new(
                    embedded_graphics::prelude::Point::new(
                        r.top_left.x,
                        r.top_left.y + i as i32 * 36,
                    ),
                    embedded_graphics::prelude::Size::new(r.size.width, 36),
                )
            })
            .collect();
        let per_cell = cost::cost_ms(&split, cost::Strategy::Windows, cost::WINDOW_SETUP_MS);
        println!(
            "{:<6} {:<8} {:>10} {:>8.2} {:>9.1} {:>8.1}  {}",
            n,
            format!("{:?}", fl.phase(n)),
            v.dirty_px,
            best,
            per_cell,
            cost::FULL_REPAINT_MS,
            if v.robust() {
                "fits"
            } else if v.marginal() {
                "NEEDS A DEVICE MEASUREMENT"
            } else {
                "OVER BUDGET"
            }
        );
    }
    println!(
        "\nWorst frame {:.2} ms of {:.1} ms budget - {:.0}% spent, {:.0}% left for engine, mesh and touch.",
        worst,
        cost::DRAW_BUDGET_MS,
        100.0 * worst / cost::DRAW_BUDGET_MS,
        100.0 * (1.0 - worst / cost::DRAW_BUDGET_MS)
    );
    let (lo, hi) = (
        cost::break_even_px(cost::SETUP_RANGE_MS.1),
        cost::break_even_px(cost::SETUP_RANGE_MS.0),
    );
    println!(
        "Break-even: one window beats a full repaint below {:.0}-{:.0} px ({:.0}-{:.0}% of the panel),",
        lo,
        hi,
        100.0 * lo / cost::FRAME_PX,
        100.0 * hi / cost::FRAME_PX
    );
    println!(
        "depending on where the real per-window overhead sits. The flourish's largest frame is"
    );
    println!(
        "{:.0}% of the panel, so it is nowhere near that line either way.",
        100.0 * 12160.0 / cost::FRAME_PX
    );

    // The firmware-shaping comparison: what is the right unit of animation on this panel?
    let col = cost::lane_column();
    let rows = cost::lane_column_by_rows::<6>();
    let col_px = col.size.width * col.size.height;
    println!("\nIs a lane the right window? The whole lane column, costed three ways:");
    println!(
        "  one lane-column window   {:>6} px   {:>5.1} - {:>5.1} ms",
        col_px,
        cost::cost_ms(&[col], cost::Strategy::Windows, cost::SETUP_RANGE_MS.0),
        cost::cost_ms(&[col], cost::Strategy::Windows, cost::SETUP_RANGE_MS.1)
    );
    println!(
        "  same column, 6 per-row   {:>6} px   {:>5.1} - {:>5.1} ms   <- can exceed the budget",
        col_px,
        cost::cost_ms(&rows, cost::Strategy::Windows, cost::SETUP_RANGE_MS.0),
        cost::cost_ms(&rows, cost::Strategy::Windows, cost::SETUP_RANGE_MS.1)
    );
    println!(
        "  full repaint             {:>6} px   {:>5.1} ms",
        cost::FRAME_PX as u32,
        cost::FULL_REPAINT_MS
    );
    println!(
        "The column wins outright at both ends, so the natural unit of animation on this panel is"
    );
    println!("a LANE - which is also the natural unit of the game.");
}

/// Outline `r` on a copy of `p`, for the filmstrip only (never on an exported device frame).
fn outlined(p: &panel::Panel, r: embedded_graphics::primitives::Rectangle) -> panel::Panel {
    use embedded_graphics::prelude::*;
    use embedded_graphics::primitives::PrimitiveStyle;
    let mut q = p.clone();
    let _ = r
        .into_styled(PrimitiveStyle::with_stroke(
            embedded_graphics::pixelcolor::Rgb565::new(31, 0, 31),
            1,
        ))
        .draw(&mut q);
    q
}

fn station(out: &std::path::Path) -> Result<(), String> {
    use shrine_preview::station as fx;
    let shots = fx::screens();
    for s in &shots {
        let path = out.join(format!("{}.png", s.name));
        export::save(&s.panel, &path, 1)?;
        println!("{}", path.display());
    }
    let refs: Vec<(&str, &panel::Panel)> = shots.iter().map(|s| (s.caption, &s.panel)).collect();
    let sheet = fx::sheet(&refs, 3, 2);
    let sp = out.parent().unwrap_or(out).join("station-screens.png");
    export::save(&sheet, &sp, 1)?;
    println!("{}", sp.display());

    // 0036: the draw-tap states, as their own sheet.
    let draws = fx::draw_screens();
    for s in &draws {
        let path = out.join(format!("{}.png", s.name));
        export::save(&s.panel, &path, 1)?;
        println!("{}", path.display());
    }
    let refs: Vec<(&str, &panel::Panel)> = draws.iter().map(|s| (s.caption, &s.panel)).collect();
    let dp = out.parent().unwrap_or(out).join("station-draws.png");
    export::save(&fx::sheet(&refs, 3, 2), &dp, 1)?;
    println!("{}", dp.display());

    let mut strips = Vec::new();
    for m in fx::motions() {
        let slug = m.name().replace([' ', '(', ')'], "").replace('-', "");
        // Every station motion is now an engine record (fall and return from `FALL_SEED`; struck and
        // heal found by `search-states`), so no filmstrip carries an override label.
        let first = "before";
        let mut frames = vec![(first.to_string(), fx::scene(&m.before()))];
        for n in 0..m.frames() {
            frames.push((format!("{n}"), outlined(&fx::frame(&m, n), m.dirty(n))));
        }
        let refs: Vec<(&str, &panel::Panel)> =
            frames.iter().map(|(l, p)| (l.as_str(), p)).collect();
        let strip = fx::sheet(&refs, 6, 1);
        let path = out.join(format!("motion-{slug}.png"));
        export::save(&strip, &path, 1)?;
        println!("{}", path.display());
        strips.push(path);
    }
    let mt = fx::mid_turn();
    println!(
        "{} screens, {} motions ({}; commander and art are placeholders; items are set 1's)",
        shots.len(),
        strips.len(),
        fx::state_label(&mt)
    );
    Ok(())
}

fn station_cost() {
    println!(
        "draw budget {:.1} ms/frame at 15 fps; full repaint {:.1} ms; lane column (0025) {:.0}%",
        cost::DRAW_BUDGET_MS,
        cost::FULL_REPAINT_MS,
        cost::verdict(&[cost::lane_column()]).chosen_ms().1 / cost::DRAW_BUDGET_MS * 100.0
    );
    println!(
        "{:<14} {:>6} {:>6} {:>8} {:>9} {:>9} {:>7}",
        "motion", "frames", "pushes", "max px", "best ms", "worst ms", "budget"
    );
    for m in shrine_preview::station::motions() {
        let c = shrine_preview::station::motion_cost(&m);
        println!(
            "{:<14} {:>6} {:>6} {:>8} {:>9.2} {:>9.2} {:>6.0}%",
            c.name,
            c.frames,
            c.pushes,
            c.max_px,
            c.best_ms,
            c.worst_ms,
            c.worst_ms / cost::DRAW_BUDGET_MS * 100.0
        );
    }
    println!("\nMANIFEST.md rows (pinned by tests/manifest.rs):");
    for m in shrine_preview::station::motions() {
        println!("{}", shrine_preview::station::manifest_row(&m));
    }
}
