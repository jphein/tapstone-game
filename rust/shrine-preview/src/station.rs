//! Fixtures for 0032's station screens, shared by the CLI and the tests so both draw the same
//! thing.
//!
//! The glanceable match state (castle life, mana, hand, round) comes from a **real engine game**
//! (seed 21, round 5, as 0027's screens). The commander, its loadout and its ledger are
//! **placeholders**: the rules crate has no commanders yet (`feat/commander-rules` is adding them),
//! so they are view-side literals shaped like 0029–0031. Swap them for engine and ledger reads when
//! those exist; nothing else here needs to change.

use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use embedded_graphics_simulator::SimulatorDisplay;
use shrine_render::commander::{
    Commander, INVENTORY, Ledger, Presence, ReturnState, Station, rounds_until,
};
use shrine_render::motion::{Motion, Scene};
use shrine_render::sprite::Pose;
use shrine_render::station::{self, Desk, StationScreen, Title};
use shrine_render::voice::{Dark, Voice};
use tapstone_rules::cards::{self, CardKind, Faction};
use tapstone_rules::event::Kind;
use tapstone_rules::rules::Refusal;
use tapstone_rules::state::{Game, LANES, Phase};

use crate::game;
use crate::panel::{Panel, blank};

pub const SEED: u64 = 21;
/// The earliest round the mid-turn search accepts.
pub const FROM_ROUND: u8 = 3;
pub const SIGIL: &str = "amber-wren";
/// The longest commander name the station must draw. **Placeholder** until the ledger fixes a
/// field width; every screen fits it (the tests draw one through each).
pub const NAME_MAX: usize = 16;
pub const LONG_NAME: &str = "Wwwwwwwwwwwwwwww";
const _: () = assert!(LONG_NAME.len() == NAME_MAX);

/// Total XP for a commander `into` XP past the start of `level` — derived from progression, so
/// the fixtures say "level 4, 3 in" rather than typing a total that means that only today.
fn at(level: u8, into: u32) -> u32 {
    shrine_render::commander::level_start(level) + into
}

/// The item design id named `name` in progression's generated table.
pub fn item_id(name: &str) -> u16 {
    shrine_render::commander::ITEMS
        .iter()
        .find(|d| d.name == name)
        .unwrap_or_else(|| panic!("no item named {name} in set 1"))
        .id
}

/// A level-4 Ember commander wearing the Ember Sabre (Haste) and the Driftcloak (a look).
pub fn commander() -> Commander<'static> {
    Commander {
        name: "Kestrel",
        faction: Faction::Ember,
        xp: at(4, 3),
        loadout: [
            Some(item_id("Ember Sabre")),
            Some(item_id("Driftcloak")),
            None,
        ],
    }
}

/// A level-6 commander one win from level 7, which opens the trinket slot.
pub fn commander_l6() -> Commander<'static> {
    Commander {
        xp: at(6, 3),
        ..commander()
    }
}

/// The item the fixture loot drops: set 1's one design the ledger does not own yet.
pub fn loot_item() -> u16 {
    item_id("Pearl Charm")
}

/// Every set-1 item but the loot one, in table order: room for the chest, and a grid of twelve.
pub fn ledger() -> Ledger {
    let mut inventory = [None; INVENTORY];
    let owned = shrine_render::commander::ITEMS
        .iter()
        .map(|d| d.id)
        .filter(|id| *id != loot_item());
    for (i, id) in owned.enumerate() {
        inventory[i] = Some(id);
    }
    Ledger { inventory }
}

/// Every cell full: a drop melts (lead's call, 2026-09-23).
///
/// **Unreachable in set 1:** a full grid needs twelve distinct designs (duplicates melt, 0031) and
/// set 1 has six, so this fixture repeats designs to show the future case. A view override.
pub fn ledger_full() -> Ledger {
    let n = shrine_render::commander::ITEMS.len();
    Ledger {
        inventory: core::array::from_fn(|i| Some((i % n) as u16)),
    }
}

/// A unit in seat 0's hand it cannot afford right now, and a lane it could go in.
fn unaffordable(g: &Game) -> Option<(u16, i8)> {
    let s = &g.seats[0];
    let lane = (0..LANES).find(|l| s.cells[*l][0].is_none())? as i8;
    s.hand[..s.hand_len()]
        .iter()
        .copied()
        .find(|id| {
            cards::design(*id).is_some_and(|d| {
                matches!(d.kind, CardKind::Unit { .. }) && d.cost > s.available_mana()
            })
        })
        .map(|id| (id, lane))
}

/// The sim setup every station fixture plays under: seat 0 fields **the lobby commander's own
/// claim** (so the Haste the lobby shows is the Haste the engine plays), seat 1 a level-1 base.
pub fn setup() -> tapstone_sim::Setup {
    tapstone_sim::Setup {
        commanders: [
            commander()
                .claim()
                .expect("the fixture loadout is one ClaimSeat accepts"),
            tapstone_rules::Commander::LEVEL_1,
        ],
        ..tapstone_sim::Setup::default()
    }
}

/// Is seat 0's back cell in `lane` taken by something other than its own commander?
fn back_taken(g: &Game, lane: usize) -> bool {
    g.seats[0].cells[lane][0].is_some_and(|u| u.design != tapstone_rules::COMMANDER_DESIGN)
}

/// A real mid-turn engine state: seat 0 to act, from round 3, with mana partly **spent** and some
/// left, a unit in hand it cannot afford, and a lane whose back cell a unit holds (for the waiting
/// commander). Found by replaying seed 21 record by record, never edited by hand.
pub fn mid_turn() -> game::Snapshot {
    game::first_where_setup(SEED, 400, setup(), |g| {
        g.phase == Phase::Playing
            && g.round >= FROM_ROUND
            && g.active == 0
            && g.seats[0].spent > 0
            && g.seats[0].available_mana() > 0
            && unaffordable(g).is_some()
            && (0..LANES).any(|l| back_taken(g, l))
            && Presence::from_seat(&g.seats[0])
                .is_some_and(|p| matches!(p, Presence::OnBoard { .. }))
    })
    .expect("seed 21 replays")
    .expect("seed 21 has a mid-turn state with spent mana and an unaffordable unit")
    .1
}

/// The seed whose game holds a real commander death and return for seat 0 under [`setup`].
/// Seed 21's commander never dies; seed 11's dies in end-of-turn combat as the round turns, so
/// its record also changes the round, hand and mana — the case a synthetic fall cannot show.
pub const FALL_SEED: u64 = 11;

/// The engine's station for seat 0 at `g`, with the band derived from its state.
pub fn station_of_game(g: &Game) -> StationScreen<'static> {
    let st = Station::from_game(g, 0).expect("a commander is fielded");
    StationScreen {
        cmdr: commander(),
        st,
        pose: Pose::default(),
        voice: band_for(&st),
        wells: None,
    }
}

/// What the band says for an engine state: an owed draw first — the engine refuses everything
/// else, so the draw is the standing prompt — then a fallen commander's return, then nothing.
/// (The return is still spoken; the band returns to the prompt, 0032's draw amendment point 3.)
pub fn band_for(st: &Station) -> Voice<'static> {
    if st.owed > 0 {
        let why = if st.round <= 1 {
            shrine_render::draws::DrawWhy::Opening
        } else {
            shrine_render::draws::DrawWhy::TurnStart
        };
        return Voice::Draw { n: st.owed, why };
    }
    match st.presence {
        Presence::Fallen { .. } => st
            .return_state()
            .map(Voice::Return)
            .unwrap_or(Voice::Silent),
        Presence::OnBoard { .. } => Voice::Silent,
    }
}

/// The first real death of seat 0's commander: the engine states either side of that record.
pub fn real_fall() -> (game::Snapshot, game::Snapshot) {
    game::first_where_setup(FALL_SEED, 400, setup(), |g| {
        g.seats[0].commander.returns > 0
    })
    .expect("the fall seed replays")
    .expect("the fall seed kills seat 0's commander")
}

/// The real return that follows it: the record after which the commander is on the board again.
pub fn real_return() -> (game::Snapshot, game::Snapshot) {
    let back = real_fall().1.game.seats[0].commander.returns;
    game::first_where_setup(FALL_SEED, 400, setup(), move |g| {
        g.round >= back && g.seats[0].commander.returns == 0
    })
    .expect("the fall seed replays")
    .expect("the fall seed returns seat 0's commander")
}

/// How the manifest names the fixture state, so the document and the code cannot disagree.
pub fn state_label(s: &game::Snapshot) -> String {
    format!(
        "seed = {SEED}, round {}, after record {} of {}",
        s.round, s.applied, s.total
    )
}

pub fn game_state() -> Game {
    mid_turn().game
}

/// The refusal **the engine itself** returns for casting that unit now, not a typed one.
pub fn engine_refusal() -> (u16, Refusal) {
    let mut g = game_state();
    let (card, lane) = unaffordable(&g).expect("mid_turn guarantees one");
    let r = g
        .apply(&tapstone_sim::tap(0, Kind::CastUnit, card, lane, 0, 0))
        .expect_err("the engine must refuse an unaffordable cast");
    (card, r)
}

/// A lane with seat 0's back cell taken by a unit / free, in the fixture state.
pub fn back_lane(occupied: bool) -> u8 {
    let g = game_state();
    (0..LANES)
        .find(|l| back_taken(&g, *l) == occupied)
        .expect("fixture state has both kinds of lane") as u8
}

/// The engine's station at the fixture state, with the band set to `voice`.
pub fn engine_station(voice: Voice<'static>) -> StationScreen<'static> {
    StationScreen {
        cmdr: commander(),
        st: Station::from_game(&game_state(), 0).expect("the fixture game has a commander"),
        pose: Pose::default(),
        voice,
        wells: None,
    }
}

/// The engine's station with the commander's presence **overridden**, for motion fixtures whose
/// before-state the fixture game does not reach (a heal, a hit to a set toughness). Everything
/// else — castle, mana, hand, round, stats, house rules — is still the engine's.
pub fn station_screen(presence: Presence, voice: Voice<'static>) -> StationScreen<'static> {
    let mut s = engine_station(voice);
    s.st.presence = presence;
    s
}

/// A fallen station with the band saying what the state implies. The castle pays the game's own
/// fall penalty (`rules.commander_fall`), since the override skips the engine event that would.
pub fn fallen_screen(lane: u8, return_round: u8) -> StationScreen<'static> {
    let mut s = station_screen(Presence::Fallen { lane, return_round }, Voice::Silent);
    s.st.castle_life = s.st.castle_life.saturating_sub(s.st.fall_penalty);
    StationScreen {
        voice: s
            .st
            .return_state()
            .map(Voice::Return)
            .unwrap_or(Voice::Silent),
        ..s
    }
}

/// The live commander **as the engine has it** at the fixture state, so `station_screen(live(), …)`
/// is exactly the engine's station.
pub fn live() -> Presence {
    engine_station(Voice::Silent).st.presence
}

pub fn lobby_desk() -> Desk<'static> {
    Desk::lobby(commander(), &ledger(), Voice::Loadout { secs: 5 })
}

/// The result desk after a win: XP not yet filled, the bar's starting point.
pub fn result_desk(c: Commander<'static>, l: &Ledger) -> Desk<'static> {
    Desk {
        title: Title::Result {
            word: "VICTORY",
            won: Some(true),
        },
        ..Desk::lobby(c, l, Voice::Lobby)
    }
}

fn desk_of(s: Scene<'static>) -> Desk<'static> {
    match s {
        Scene::Desk(k) => k,
        _ => unreachable!("a desk motion ends on a desk"),
    }
}

fn station_of(s: Scene<'static>) -> StationScreen<'static> {
    match s {
        Scene::Station(k) => k,
        _ => unreachable!("a station motion ends on a station"),
    }
}

/// Real states the station once stood in for, found by `shrine-preview search-states` within
/// seeds 0..2000 × both pickers × three pairings (`search::SEEDS`, `STYLES`, `DECKS`). Pinned
/// here so fixtures do not re-search; a test re-runs the search and holds these to its answer.
pub const HEAL_AT: crate::search::Found = crate::search::Found {
    seed: 0,
    style: tapstone_sim::Style::PlayOut,
    decks: tapstone_sim::Decks::Asymmetric,
    record: 49,
};
pub const STRUCK_AT: crate::search::Found = crate::search::Found {
    seed: 0,
    style: tapstone_sim::Style::PlayOut,
    decks: tapstone_sim::Decks::Asymmetric,
    record: 38,
};
pub const BLOCKED_AT: crate::search::Found = crate::search::Found {
    seed: 404,
    style: tapstone_sim::Style::PlayOut,
    decks: tapstone_sim::Decks::Asymmetric,
    record: 76,
};

/// The engine states either side of a pinned find.
pub fn found_states(f: crate::search::Found) -> (Game, Game) {
    game::transition_at(
        f.seed,
        400,
        crate::search::setup(f.style, f.decks),
        f.record,
    )
    .expect("a pinned find replays")
}

/// A real hit on seat 0's commander, before and after from the engine.
pub fn real_hit(f: crate::search::Found) -> Motion<'static> {
    let (b, a) = found_states(f);
    Motion::Hit {
        before: station_of_game(&b),
        after: station_of_game(&a),
    }
}

/// The real fall, before and after straight from the engine.
pub fn fall() -> Motion<'static> {
    let (b, a) = real_fall();
    Motion::Fall {
        before: station_of_game(&b.game),
        after: station_of_game(&a.game),
    }
}

/// The real return, before and after straight from the engine.
pub fn ret() -> Motion<'static> {
    let (b, a) = real_return();
    let after = station_of_game(&a.game);
    Motion::Return {
        before: station_of_game(&b.game),
        // "back on the field" is the band's line unless a draw is owed, which it must ask for.
        after: if after.st.owed == 0 {
            StationScreen {
                voice: Voice::Returned,
                ..after
            }
        } else {
            after
        },
    }
}

/// Every motion 0032 names, driven from the fixtures above.
pub fn motions() -> Vec<Motion<'static>> {
    let win = result_desk(commander_l6(), &ledger());
    let filled = desk_of(
        (Motion::XpFill {
            before: win,
            gain: 3,
        })
        .after(),
    );
    vec![
        Motion::Breath(Scene::Idle {
            cmdr: Some(commander()),
            sigil: SIGIL,
            pose: Pose::default(),
        }),
        Motion::Breath(Scene::Station(station_screen(live(), Voice::Silent))),
        // Struck and healed: both real engine records (`search-states`, pinned above).
        real_hit(STRUCK_AT),
        real_hit(HEAL_AT),
        fall(),
        ret(),
        // The (look-only) Tide Trident goes over the worn Haste Sabre: the swap frame is
        // exercised, and the keyword chip goes away — the only rule effect gear still has (0034).
        Motion::Equip {
            before: lobby_desk(),
            cell: ledger()
                .inventory
                .iter()
                .position(|c| *c == Some(item_id("Tide Trident")))
                .expect("the ledger holds the trident"),
        },
        Motion::XpFill {
            before: win,
            gain: 3,
        },
        Motion::LevelUp { before: filled },
        Motion::Loot {
            before: filled,
            item: loot_item(),
            cell: ledger().first_free().expect("fixture ledger has room"),
        },
        Motion::Melt {
            before: result_desk(commander(), &ledger_full()),
            item: loot_item(),
        },
    ]
    .into_iter()
    .chain(draw_motions())
    .collect()
}

/// A named static screen.
pub struct Shot {
    pub name: &'static str,
    pub caption: &'static str,
    pub panel: Panel,
}

fn shot<F: FnOnce(&mut Panel)>(name: &'static str, caption: &'static str, f: F) -> Shot {
    let mut p = blank();
    f(&mut p);
    Shot {
        name,
        caption,
        panel: p,
    }
}

/// Every static station screen, in 0032's order.
pub fn screens() -> Vec<Shot> {
    let c = commander();
    let win = result_desk(commander_l6(), &ledger());
    let levelled = desk_of(
        (Motion::LevelUp {
            before: desk_of(
                (Motion::XpFill {
                    before: win,
                    gain: 3,
                })
                .after(),
            ),
        })
        .after(),
    );
    let looted = desk_of(
        (Motion::Loot {
            before: levelled,
            item: loot_item(),
            cell: ledger().first_free().unwrap(),
        })
        .after(),
    );
    let (refused_card, refusal) = engine_refusal();
    let _ = refused_card;
    let g = game_state();
    // A real spell and a real unit from seat 0's own deck, for the two prompts.
    let deck = &g.seats[0].deck[..g.seats[0].deck_len as usize];
    let first = |unit: bool| {
        deck.iter()
            .filter_map(|id| cards::design(*id))
            .find(|d| matches!(d.kind, CardKind::Unit { .. }) == unit)
            .map(|d| d.name)
            .unwrap_or("?")
    };
    let (unit, spell) = (first(true), first(false));
    let fallen = station_of(fall().after());
    vec![
        shot("s1-idle", "1 idle: last commander", |p| {
            station::idle(p, Some(&c), SIGIL, Pose::default())
        }),
        shot("s1-idle-hooded", "1 idle: no commander yet", |p| {
            station::idle(p, None, SIGIL, Pose::default())
        }),
        shot("s2-lobby", "2 lobby / loadout", |p| {
            station::lobby(p, &lobby_desk())
        }),
        shot("s3-station", "3 station: lane prompt (unit)", |p| {
            station::station(
                p,
                &station_screen(
                    live(),
                    Voice::Lane {
                        card: unit,
                        secs: 5,
                    },
                ),
            )
        }),
        shot(
            "s3-station-target",
            "3 station: target prompt (spell)",
            |p| {
                station::station(
                    p,
                    &station_screen(
                        live(),
                        Voice::Target {
                            card: spell,
                            secs: 5,
                        },
                    ),
                )
            },
        ),
        shot("s3-station-refused", "3 station: engine refusal", |p| {
            station::station(p, &station_screen(live(), Voice::Refused(refusal)))
        }),
        shot(
            "s3-station-fallen",
            "3 station: fallen (engine, seed 11)",
            |p| station::station(p, &fallen),
        ),
        shot(
            "s3-station-waiting",
            "3 station: waiting (engine, seed 404)",
            |p| station::station(p, &station_of_game(&found_states(BLOCKED_AT).1)),
        ),
        shot(
            "s3-station-listening",
            "3 station: push-to-talk (optional)",
            |p| station::station(p, &station_screen(live(), Voice::Listening)),
        ),
        shot("s4-result", "4 result: level-up + loot", |p| {
            station::result(p, &looted)
        }),
        shot("s5-dark-arena", "5 dark: arena gone", |p| {
            station::dark(p, Some(&c), Dark::ArenaGone)
        }),
        shot("s5-dark-battery", "5 dark: battery low", |p| {
            station::dark(
                p,
                Some(&c),
                Dark::BatteryLow {
                    pct: shrine_render::voice::SLEEP_WARNING_PCT,
                },
            )
        }),
    ]
}

/// The rounds a fallen screen claims, for the return-math tests.
pub fn claimed_rounds(s: &StationScreen<'_>) -> Option<u8> {
    match s.st.presence {
        Presence::Fallen { return_round, .. } => Some(rounds_until(return_round, s.st.round)),
        _ => None,
    }
}

pub fn is_blocked(s: &StationScreen<'_>) -> bool {
    s.st.return_state() == Some(ReturnState::Blocked)
}

/// Render one motion frame.
pub fn frame(m: &Motion<'_>, n: usize) -> Panel {
    let mut p = blank();
    m.draw_frame(&mut p, n);
    p
}

pub fn scene(s: &Scene<'_>) -> Panel {
    let mut p = blank();
    s.draw(&mut p);
    p
}

/// Lay panels out on a labelled sheet at `scale`, `cols` per row. Captions go on the sheet,
/// never on a frame, so every frame stays an exact device image.
pub fn sheet(shots: &[(&str, &Panel)], cols: usize, scale: u32) -> SimulatorDisplay<Rgb565> {
    use embedded_graphics::mono_font::{MonoTextStyle, ascii::FONT_7X14};
    use embedded_graphics::primitives::{PrimitiveStyle, Rectangle};
    use embedded_graphics::text::{Baseline, Text, TextStyleBuilder};
    let (w, h) = (320 * scale as i32, 240 * scale as i32);
    let pad = 12;
    let cap = 20;
    let rows = shots.len().div_ceil(cols) as i32;
    let sw = cols as i32 * (w + pad) + pad;
    let sh = rows * (h + cap + pad) + pad;
    let mut out: SimulatorDisplay<Rgb565> = SimulatorDisplay::new(Size::new(sw as u32, sh as u32));
    let _ = Rectangle::new(Point::zero(), Size::new(sw as u32, sh as u32))
        .into_styled(PrimitiveStyle::with_fill(Rgb565::new(4, 8, 5)))
        .draw(&mut out);
    let style = MonoTextStyle::new(&FONT_7X14, Rgb565::new(28, 58, 28));
    let ts = TextStyleBuilder::new().baseline(Baseline::Top).build();
    for (i, (label, p)) in shots.iter().enumerate() {
        let (c, r) = ((i % cols) as i32, (i / cols) as i32);
        let x0 = pad + c * (w + pad);
        let y0 = pad + r * (h + cap + pad);
        let _ = Text::with_text_style(label, Point::new(x0, y0), style, ts).draw(&mut out);
        for y in 0..240 {
            for x in 0..320 {
                let px = p.get_pixel(Point::new(x, y));
                let _ = Rectangle::new(
                    Point::new(x0 + x * scale as i32, y0 + cap + y * scale as i32),
                    Size::new(scale, scale),
                )
                .into_styled(PrimitiveStyle::with_fill(px))
                .draw(&mut out);
            }
        }
    }
    out
}

/// One motion's cost: its worst pushed frame, at both ends of the per-window range.
#[derive(Clone, Copy, Debug)]
pub struct MotionCost {
    pub name: &'static str,
    pub frames: usize,
    /// Frames that actually push pixels (a held breath pose pushes nothing).
    pub pushes: usize,
    pub max_px: u32,
    pub best_ms: f32,
    pub worst_ms: f32,
}

/// Cost a motion from its real renders: a frame pushes only if it differs from the one before.
pub fn motion_cost(m: &Motion<'_>) -> MotionCost {
    use shrine_render::cost;
    let mut prev = scene(&m.before()).to_ne_bytes();
    let (mut pushes, mut max_px, mut best, mut worst) = (0, 0u32, 0f32, 0f32);
    for n in 0..m.frames() {
        let now = frame(m, n).to_ne_bytes();
        if now != prev {
            pushes += 1;
            let v = cost::verdict(&[m.dirty(n)]);
            let (b, w) = v.chosen_ms();
            max_px = max_px.max(v.dirty_px);
            best = best.max(b);
            worst = worst.max(w);
        }
        prev = now;
    }
    MotionCost {
        name: m.name(),
        frames: m.frames(),
        pushes,
        max_px,
        best_ms: best,
        worst_ms: worst,
    }
}

/// The motion's row in `preview/MANIFEST.md`, exactly as the manifest test expects it.
pub fn manifest_row(m: &Motion<'_>) -> String {
    let c = motion_cost(m);
    let share = (100.0 * c.worst_ms / shrine_render::cost::DRAW_BUDGET_MS).round() as i32;
    let px = if c.max_px >= 1000 {
        format!("{},{:03}", c.max_px / 1000, c.max_px % 1000)
    } else {
        format!("{}", c.max_px)
    };
    format!(
        "| {} | {} | {} | {} | {:.1} – {:.1} ms | {} % |",
        c.name, c.frames, c.pushes, px, c.best_ms, c.worst_ms, share
    )
}

// ---------------------------------------------------------------------------------------------
// 0036: every draw is a tap. Real engine states, with only the owed-draws count standing in.
// ---------------------------------------------------------------------------------------------

/// The engine's first playing state (genesis done, round 1, seat 0 to act) in the fixture game.
pub fn genesis() -> Game {
    game::first_where_setup(SEED, 400, setup(), |g| g.phase == Phase::Playing)
        .expect("seed 21 replays")
        .expect("seed 21 starts")
        .1
        .game
}

/// The first engine state in the fixture game where `pred` holds. Draw taps are real since #63, so
/// every 0036 fixture is a state the engine reached — no counts are set by hand.
fn engine_where(pred: impl Fn(&Game) -> bool) -> Game {
    engine_where_in(SEED, pred)
}

fn engine_where_in(seed: u64, pred: impl Fn(&Game) -> bool) -> Game {
    game::first_where_setup(seed, 400, setup(), pred)
        .expect("the fixture seed replays")
        .unwrap_or_else(|| panic!("seed {seed} never reaches the state the fixture asks for"))
        .1
        .game
}

/// The seed whose game casts a draw spell for seat 0 under [`setup`]: seed 21's never does.
pub const SPELL_SEED: u64 = 1;

fn cmdr_for(seat: u8) -> Commander<'static> {
    if seat == 0 {
        commander()
    } else {
        Commander {
            name: "Marrow",
            faction: Faction::Tide,
            loadout: [None, Some(item_id("Driftcloak")), None],
            ..commander()
        }
    }
}

/// A seat's station during the real opening hand, once it has drawn `drawn` cards. The owed count
/// and the hand are the engine's; the band says what they imply.
pub fn opening(seat: u8, drawn: u8) -> StationScreen<'static> {
    let g = engine_where(|g| {
        let s = &g.seats[seat as usize];
        g.phase == Phase::Playing
            && g.round == 1
            && s.hand_len == drawn
            && s.hand_len + s.owed_draws() == shrine_render::draws::opening_hand(&g.rules, seat)
    });
    let st = Station::from_game(&g, seat).expect("a commander is fielded at genesis");
    StationScreen {
        cmdr: cmdr_for(seat),
        st,
        pose: Pose::default(),
        voice: if st.owed > 0 {
            Voice::Draw {
                n: st.owed,
                why: shrine_render::draws::DrawWhy::Opening,
            }
        } else if st.mulligan_open {
            Voice::MulliganOffer
        } else {
            Voice::Silent
        },
        wells: None,
    }
}

/// The engine's first seat-0 turn start after round 1, with its turn-start draw owed.
pub fn turn_start_game() -> Game {
    engine_where(|g| {
        g.phase == Phase::Playing && g.round >= 2 && g.active == 0 && g.seats[0].owed_draws() == 1
    })
}

pub fn turn_start() -> StationScreen<'static> {
    let st = Station::from_game(&turn_start_game(), 0).expect("a commander is fielded");
    StationScreen {
        cmdr: commander(),
        st,
        pose: Pose::default(),
        voice: Voice::Draw {
            n: st.owed,
            why: shrine_render::draws::DrawWhy::TurnStart,
        },
        wells: None,
    }
}

/// The refusal the engine gives any other tap while a draw is owed: charge a card from hand at the
/// turn start and take the engine's `Err`.
pub fn draw_owed_refusal() -> Refusal {
    let mut g = turn_start_game();
    let card = g.seats[0].hand[0];
    g.apply(&tapstone_sim::tap(0, Kind::Charge, card, -1, 0, 0))
        .expect_err("the engine must refuse a charge while a draw is owed")
}

/// The design seat 0 draws `k`-th (0-based) in the real opening hand.
pub fn nth_draw(k: usize) -> (u16, &'static str) {
    let g = engine_where(|g| {
        g.phase == Phase::Playing && g.round == 1 && g.seats[0].hand_len as usize == k + 1
    });
    let id = g.seats[0].hand[k];
    (id, cards::design(id).map(|d| d.name).unwrap_or("?"))
}

/// A real draw spell: the first state where seat 0 owes more than one draw after round 1, which
/// only a spell can cause. The name is the spell's; the owed count, the spend and the hand are the
/// engine's.
pub fn spell_draw() -> StationScreen<'static> {
    let g = engine_where_in(SPELL_SEED, |g| {
        g.phase == Phase::Playing && g.round >= 2 && g.active == 0 && g.seats[0].owed_draws() >= 2
    });
    let st = Station::from_game(&g, 0).expect("a commander is fielded");
    let deep = cards::SET1
        .iter()
        .find(|d| matches!(d.kind, CardKind::Spell(cards::Effect::Draw { count }) if count == st.owed))
        .expect("the owed count is a draw spell's");
    StationScreen {
        cmdr: commander(),
        st,
        pose: Pose::default(),
        voice: Voice::Draw {
            n: st.owed,
            why: shrine_render::draws::DrawWhy::Spell { card: deep.name },
        },
        wells: None,
    }
}

/// The mulligan window after one castle tap: the 3 s prompt is showing, nothing has been sent.
pub fn mulligan_prompt() -> StationScreen<'static> {
    StationScreen {
        voice: Voice::MulliganPrompt {
            secs: (shrine_render::draws::SECOND_TAP_MS / 1000) as u8,
        },
        ..opening(0, 5)
    }
}

/// Every 0036 station state, in the order a match meets them.
pub fn draw_screens() -> Vec<Shot> {
    let mid = opening(0, 3);
    let owing = turn_start();
    let spell = spell_draw();
    let after_mull = station_of(
        (Motion::Mulligan {
            before: opening(0, 5),
        })
        .after(),
    );
    vec![
        shot("d1-opening", "a opening hand: 5 owed (seat 0)", |p| {
            station::station(p, &opening(0, 0))
        }),
        shot(
            "d1-opening-seat1",
            "b opening hand: 6 owed (seat 1, 0035)",
            |p| station::station(p, &opening(1, 0)),
        ),
        shot("d2-opening-mid", "c 3 drawn, 2 owed", |p| {
            station::station(p, &mid)
        }),
        shot("d3-mulligan-offer", "d mulligan window (engine)", |p| {
            station::station(p, &opening(0, 5))
        }),
        shot(
            "d3b-mulligan-prompt",
            "d2 castle tapped in the window: 3 s prompt",
            |p| station::station(p, &mulligan_prompt()),
        ),
        shot("d4-mulliganed", "e after mulligan: 5 owed again", |p| {
            station::station(p, &after_mull)
        }),
        shot("d5-turn-start", "f turn start: draw 1", |p| {
            station::station(p, &owing)
        }),
        shot("d6-refused", "g other tap while owing", |p| {
            station::station(
                p,
                &StationScreen {
                    voice: Voice::Refused(draw_owed_refusal()),
                    ..owing
                },
            )
        }),
        shot("d7-spell-draw", "h a spell: draw 2", |p| {
            station::station(p, &spell)
        }),
        shot(
            "d8-deck-empty",
            "i exhausted deck (view override: no seed <2000)",
            |p| {
                station::station(
                    p,
                    &StationScreen {
                        st: Station {
                            owed: 0,
                            ..owing.st
                        },
                        voice: Voice::DeckEmpty,
                        ..owing
                    },
                )
            },
        ),
    ]
}

/// The two 0036 motions: a draw acknowledged mid-hand, the last one of a hand, and a mulligan.
pub fn draw_motions() -> Vec<Motion<'static>> {
    let (c3, n3) = nth_draw(3);
    let (c4, n4) = nth_draw(4);
    vec![
        Motion::DrawAck {
            before: opening(0, 3),
            card: c3,
            name: n3,
        },
        Motion::DrawAck {
            before: opening(0, 4),
            card: c4,
            name: n4,
        },
        Motion::Mulligan {
            before: opening(0, 5),
        },
    ]
}
