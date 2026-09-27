//! Decision 0032's station: motion, cost, voice, contrast and geometry, checked against renders.
//!
//! Most checks here measure a **render** rather than restating the code that drew it, because
//! that is the instrument that has disagreed with this renderer before (0027): a frame diff, a
//! column of pixels that must stay black, the pixel under a label. Each such instrument has a
//! control that shows it can fail for the reason the mechanism could actually be wrong.

use embedded_graphics::{pixelcolor::Rgb565, prelude::*, primitives::Rectangle, text::Alignment};
use embedded_graphics_simulator::SimulatorDisplay;
use shrine_preview::station as fx;
use shrine_preview::{cost, geom, palette as pal, panel};
use shrine_render::commander::{self, ITEMS, Presence, ReturnState, SLOTS, Slot, SlotExt};
use shrine_render::draws::{self, DrawWhy};
use shrine_render::ink::{self, Ink};
use shrine_render::motion::{self, Motion, Scene};
use shrine_render::station::{self, Desk};
use shrine_render::voice::{self, Dark, REFUSALS, VOICE_VARIANTS, Voice};
use tapstone_rules::cards::SET1;

type Panel = SimulatorDisplay<Rgb565>;

// ---------------------------------------------------------------------------------------------
// Motion: every changed pixel inside the frame's one rectangle
// ---------------------------------------------------------------------------------------------

/// Pixels that differ between `a` and `b` outside `r`.
fn escapes(a: &Panel, b: &Panel, r: Rectangle) -> Vec<Point> {
    let mut out = Vec::new();
    for y in 0..geom::H {
        for x in 0..geom::W {
            let p = Point::new(x, y);
            if a.get_pixel(p) != b.get_pixel(p) && !r.contains(p) {
                out.push(p);
            }
        }
    }
    out
}

/// The device pushes only `dirty(n)` on frame `n`. Anything that changes outside it stays
/// stale on the glass while the host render looks perfect — so diff the renders.
#[test]
fn every_motion_changes_pixels_only_inside_its_dirty_rect() {
    let mut failures = Vec::new();
    for m in fx::motions() {
        let mut prev = fx::scene(&m.before());
        for n in 0..m.frames() {
            let now = fx::frame(&m, n);
            let e = escapes(&prev, &now, m.dirty(n));
            if !e.is_empty() {
                failures.push(format!(
                    "{} frame {n}: {} px changed outside {:?}, first at {:?}",
                    m.name(),
                    e.len(),
                    m.dirty(n),
                    e[0]
                ));
            }
            prev = now;
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// The motion must end on exactly the static screen for the new state, or the next static
/// redraw needs a second window to clean up after it.
#[test]
fn every_motion_ends_on_its_static_after_screen() {
    for m in fx::motions() {
        let last = fx::frame(&m, m.frames() - 1);
        let after = fx::scene(&m.after());
        let e = escapes(&last, &after, Rectangle::zero());
        assert!(
            e.is_empty(),
            "{} ends {} px away from its after screen",
            m.name(),
            e.len()
        );
    }
}

/// Control: the diff instrument can see a change. With an empty rectangle, every frame that
/// pushes must register as escaping; if it did not, the containment test above is blind.
#[test]
fn control_the_frame_diff_sees_every_pushing_frame() {
    for m in fx::motions() {
        let mut prev = fx::scene(&m.before());
        let mut pushes = 0;
        for n in 0..m.frames() {
            let now = fx::frame(&m, n);
            if prev.to_ne_bytes() != now.to_ne_bytes() {
                pushes += 1;
                assert!(
                    !escapes(&prev, &now, Rectangle::zero()).is_empty(),
                    "{} frame {n} changed bytes but the diff saw nothing",
                    m.name()
                );
            }
            prev = now;
        }
        assert!(
            pushes > 0,
            "{} never changes the screen: it depicts nothing",
            m.name()
        );
    }
}

/// Each motion must depict its consequence (0025's flourish lesson): the after screen differs
/// from the before screen for every motion except the breath, which returns to rest.
#[test]
fn every_motion_but_breath_changes_the_state_it_depicts() {
    for m in fx::motions() {
        let (b, a) = (fx::scene(&m.before()), fx::scene(&m.after()));
        let same = b.to_ne_bytes() == a.to_ne_bytes();
        if matches!(m, Motion::Breath(_)) {
            assert!(same, "breath must return to rest");
        } else {
            assert!(!same, "{} ends where it began", m.name());
        }
    }
}

/// 0014's cycle, as frames: 1-2-3-2-1 with the pose visibly changing.
#[test]
fn breath_cycles_three_distinct_poses() {
    let m = &fx::motions()[1];
    let p = |k: usize| fx::frame(m, k * motion::BREATH_HOLD).to_ne_bytes();
    assert_ne!(p(0), p(1));
    assert_ne!(p(1), p(2));
    assert_ne!(p(0), p(2));
    assert_eq!(p(1), p(3), "pose 2 on the way down is pose 2 on the way up");
    assert_eq!(p(0), p(4));
}

// ---------------------------------------------------------------------------------------------
// Cost: headroom, not non-exceedance
// ---------------------------------------------------------------------------------------------

/// Every motion must leave most of the draw budget for engine, mesh, touch and audio — not merely
/// fit. `docs/verification.md`: "a budget check must assert headroom, not non-exceedance".
#[test]
fn every_motion_leaves_more_than_half_the_budget() {
    for m in fx::motions() {
        let c = fx::motion_cost(&m);
        assert!(
            c.worst_ms < cost::DRAW_BUDGET_MS / 2.0,
            "{}: worst frame {:.1} ms of {:.1}",
            c.name,
            c.worst_ms,
            cost::DRAW_BUDGET_MS
        );
        assert!(
            c.worst_ms < cost::FULL_REPAINT_MS / 2.0,
            "{} is not meaningfully cheaper than a repaint",
            c.name
        );
    }
}

/// The upper bound that makes the rectangle a rectangle and not the panel: no frame may dirty
/// more than the lane column 0025 costed (the perturbation that once passed silently).
#[test]
fn no_motion_frame_is_larger_than_a_lane_column() {
    let lane = cost::lane_column();
    let lane_px = lane.size.width * lane.size.height;
    for m in fx::motions() {
        for n in 0..m.frames() {
            let r = m.dirty(n);
            assert!(
                r.size.width * r.size.height <= lane_px,
                "{} frame {n} dirties {:?}, more than a lane column",
                m.name(),
                r
            );
            assert!(
                r.top_left.x >= 0
                    && r.top_left.y >= 0
                    && r.top_left.x + r.size.width as i32 <= geom::W
                    && r.top_left.y + r.size.height as i32 <= geom::H,
                "{} frame {n} leaves the panel",
                m.name()
            );
        }
    }
}

/// 0032's own claim, checked: the breath's rectangle is the figure's box, smaller than the lane
/// column costed at 40%.
#[test]
fn breath_is_cheaper_than_the_lane_column_0032_compares_it_to() {
    let breath = fx::motion_cost(&fx::motions()[1]);
    let lane = cost::verdict(&[cost::lane_column()]).chosen_ms().1;
    assert!(
        breath.worst_ms < lane,
        "breath {:.1} ms vs lane {:.1} ms",
        breath.worst_ms,
        lane
    );
    assert_eq!(breath.max_px, (station::DOLL_PX * station::DOLL_PX) as u32);
}

// ---------------------------------------------------------------------------------------------
// The voice band
// ---------------------------------------------------------------------------------------------

/// Every sentence the shrine can say, with the longest real names the set contains.
fn every_voice() -> Vec<Voice<'static>> {
    let mut v = vec![
        Voice::Invite,
        Voice::Lobby,
        Voice::Listening,
        Voice::SecondKeyword,
        Voice::Silent,
    ];
    for c in SET1 {
        v.push(Voice::CastOrCharge { card: c.name });
        v.push(Voice::Lane {
            card: c.name,
            secs: 10,
        });
        v.push(Voice::Target {
            card: c.name,
            secs: 10,
        });
        v.push(Voice::CastleAt {
            castle: c.name,
            life: 100,
        });
    }
    v.extend(REFUSALS.iter().map(|r| Voice::Refused(*r)));
    for n in 1..=9 {
        v.push(Voice::Return(ReturnState::In(n)));
    }
    v.push(Voice::Return(ReturnState::ThisTurn));
    v.push(Voice::Return(ReturnState::Blocked));
    v.push(Voice::Returned);
    v.push(Voice::Loadout { secs: 10 });
    for it in ITEMS {
        for slot in SLOTS {
            v.push(Voice::Equipped {
                item: it.name,
                slot,
            });
        }
        v.push(Voice::Loot { item: it.name });
        v.push(Voice::Melted { item: it.name });
    }
    for level in 1..=commander::LEVEL_MAX {
        v.push(Voice::LevelUp {
            level,
            gain: commander::level_gain(level).unwrap_or(""),
        });
    }
    v.extend(Dark::ALL.iter().map(|d| Voice::Dark(*d)));
    for n in 1..=9u8 {
        for why in [DrawWhy::Opening, DrawWhy::Mulligan, DrawWhy::TurnStart] {
            v.push(Voice::Draw { n, why });
        }
    }
    for c in SET1 {
        v.push(Voice::Draw {
            n: 9,
            why: DrawWhy::Spell { card: c.name },
        });
        for left in [0u8, 9] {
            v.push(Voice::Drew { card: c.name, left });
        }
    }
    v.push(Voice::MulliganOffer);
    v.push(Voice::MulliganPrompt { secs: 3 });
    for it in ITEMS {
        v.push(Voice::TooLow {
            item: it.name,
            level: commander::LEVEL_MAX,
        });
    }
    v.push(Voice::DeckEmpty);
    v.push(Voice::Heard {
        words: "cast the tidecaller into lane two and then pass the turn please",
    });
    v
}

#[test]
fn every_voice_variant_is_enumerated() {
    let mut seen = [false; VOICE_VARIANTS];
    for v in every_voice() {
        seen[v.index()] = true;
    }
    assert!(
        seen.iter().all(|s| *s),
        "a Voice variant is missing from every_voice: {seen:?}"
    );
}

/// 0027's overflow, not again: every fixed sentence fits the band untruncated.
#[test]
fn every_sentence_fits_the_band_without_truncation() {
    let budget = voice::budget_chars();
    for v in every_voice() {
        let t = v.text();
        assert!(
            t.is_ascii(),
            "{t:?} has a glyph the ASCII font draws as '?'"
        );
        assert!(t.len() <= budget, "{t:?} is {} chars of {budget}", t.len());
    }
}

/// The dynamic sentence keeps its reason when the heard words are long.
#[test]
fn a_long_mishearing_loses_its_words_not_its_reason() {
    let t = Voice::Heard {
        words: "cast the tidecaller into lane two and then pass the turn please",
    }
    .text();
    assert!(t.ends_with("not an answer here"), "{t:?}");
}

fn right_margin_is_clear(p: &Panel) -> bool {
    (voice::BAND_Y + 1..geom::H).all(|y| {
        (geom::W - voice::MARGIN_R..geom::W).all(|x| p.get_pixel(Point::new(x, y)) == pal::PANEL)
    })
}

/// The render agrees: the band's right margin carries no glyph pixel for any sentence.
#[test]
fn no_sentence_reaches_the_band_margin_on_the_panel() {
    for v in every_voice() {
        let mut p = panel::blank();
        voice::draw(&mut p, &v);
        assert!(
            right_margin_is_clear(&p),
            "{:?} draws into the margin",
            v.text()
        );
    }
}

/// Control: the margin instrument sees an overflow. An unfitted 60-character line must mark it.
#[test]
fn control_the_margin_check_sees_an_overflow() {
    let mut p = panel::blank();
    voice::draw(&mut p, &Voice::Silent);
    ink::label(
        &mut p,
        "0123456789012345678901234567890123456789012345678901234567890",
        Point::new(voice::TEXT_X, voice::BAND_Y + 6),
        shrine_render::battlefield::tier_status(),
        Ink::WellText,
        Alignment::Left,
    );
    assert!(!right_margin_is_clear(&p));
}

// ---------------------------------------------------------------------------------------------
// Contrast: 0027's well rule, both halves
// ---------------------------------------------------------------------------------------------

fn luminance(c: Rgb565) -> f32 {
    let f = |v: u8, bits: u8| {
        let x = v as f32 / ((1u16 << bits) - 1) as f32;
        if x <= 0.03928 {
            x / 12.92
        } else {
            ((x + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * f(c.r(), 5) + 0.7152 * f(c.g(), 6) + 0.0722 * f(c.b(), 5)
}
fn contrast(a: Rgb565, b: Rgb565) -> f32 {
    let (la, lb) = (luminance(a), luminance(b));
    let (hi, lo) = if la > lb { (la, lb) } else { (lb, la) };
    (hi + 0.05) / (lo + 0.05)
}

#[test]
fn every_ink_clears_the_floor_on_its_own_ground() {
    for i in Ink::ALL {
        let (fg, bg) = i.pair();
        let c = contrast(fg, bg);
        assert!(c >= pal::MIN_CONTRAST, "{i:?} measures {c:.2}:1");
    }
}

/// The other half: readouts drawn raw on the level-up light would be illegible, so the well
/// under each label is load-bearing, not decoration.
#[test]
fn readouts_raw_on_the_level_up_light_would_be_illegible() {
    let core = shrine_render::sprite::mix(station::LIGHT, pal::BG, 1);
    for fg in [pal::HEALTH_OK, pal::WARM, pal::TEXT] {
        assert!(
            contrast(fg, core) < pal::MIN_CONTRAST,
            "{fg:?} is legible on the light; the well may be moot"
        );
    }
}

/// The render agrees: under full light, the title's ground is its well, not the light.
#[test]
fn the_title_cuts_a_well_through_the_level_up_light() {
    let m = fx::motions()
        .into_iter()
        .find(|m| matches!(m, Motion::LevelUp { .. }))
        .unwrap();
    let full = fx::frame(&m, station::LIGHT_STAGES as usize - 1);
    // Inside the "VICTORY" glyph box, between letters' strokes: the first pixel column.
    let under_title = full.get_pixel(Point::new(station::M + 1, station::TITLE_Y));
    assert_eq!(under_title, pal::PANEL);
    // Control: the light really is on in that frame, just outside the label box.
    let light = full.get_pixel(Point::new(
        station::M + station::DOLL_PX / 2,
        station::TITLE_Y + 16,
    ));
    assert_ne!(
        light,
        pal::BG,
        "the light never reached the title row: the check above is moot"
    );
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

/// No touch target enters the push-to-talk hit area, and every one clears the 44 px floor.
#[test]
fn touch_targets_clear_the_floor_and_the_push_to_talk_strip() {
    let mut targets: Vec<Rectangle> = SLOTS.iter().map(|s| station::socket_rect(*s)).collect();
    targets.extend((0..commander::INVENTORY).map(station::cell_rect));
    for r in targets {
        assert!(
            r.size.width as i32 >= geom::TOUCH_MIN && r.size.height as i32 >= geom::TOUCH_MIN,
            "{r:?}"
        );
        assert!(
            r.top_left.y + r.size.height as i32 <= voice::PTT_TOP,
            "{r:?} enters the PTT strip"
        );
    }
    assert_eq!(geom::H - voice::PTT_TOP, geom::TOUCH_MIN);
}

/// Left-column text never spills toward the sockets: the gutter between them stays black on
/// every desk and station screen and every motion frame.
#[test]
fn the_left_column_never_spills_into_its_gutter() {
    let gutter = |p: &Panel| {
        (0..voice::PTT_TOP).all(|y| {
            (station::COL_R + 1..station::SOCKET_X)
                .all(|x| p.get_pixel(Point::new(x, y)) == pal::BG)
        })
    };
    // Idle and dark centre the figure and have no left column.
    for s in fx::screens()
        .iter()
        .filter(|s| !s.name.starts_with("s1") && !s.name.starts_with("s5"))
    {
        assert!(gutter(&s.panel), "{} spills into the gutter", s.name);
    }
    for m in fx::motions()
        .iter()
        .filter(|m| !matches!(m.before(), Scene::Idle { .. }))
    {
        for n in 0..m.frames() {
            assert!(
                gutter(&fx::frame(m, n)),
                "{} frame {n} spills into the gutter",
                m.name()
            );
        }
    }
    // Control: a label that is too long does reach the gutter.
    let mut p = panel::blank();
    ink::label(
        &mut p,
        "a name much too long",
        Point::new(station::M, 4),
        shrine_render::battlefield::tier_status(),
        Ink::Text,
        Alignment::Left,
    );
    assert!(!gutter(&p));
}

/// The glanceable state is the engine's, not invented: the numbers drawn come from the Game.
#[test]
fn the_station_reads_the_real_game() {
    let g = fx::game_state();
    let s = fx::station_screen(fx::live(), Voice::Silent).st;
    let seat = &g.seats[0];
    assert_eq!(s.castle_life, seat.castle.life);
    assert_eq!(s.charged, seat.charged);
    assert_eq!(s.spent, seat.spent);
    assert_eq!(s.hand, seat.hand_len);
    assert_eq!(s.round, g.round);
    assert_eq!(s.mana, seat.available_mana());
    assert!(
        s.spent > 0,
        "the fixture must be mid-turn, or the spent ring is never drawn"
    );
}

/// 0032 puts the loot chest in "the inventory's first free cell"; a full grid has none, so the
/// drop melts (lead's call): 1 XP, the borrowed cell restored, nothing discarded.
#[test]
fn a_full_inventory_melts_the_drop_and_discards_nothing() {
    assert_eq!(motion::loot_cell(&fx::ledger_full()), None);
    assert!(motion::loot_cell(&fx::ledger()).is_some());
    let m = fx::motions()
        .into_iter()
        .find(|m| matches!(m, Motion::Melt { .. }))
        .expect("the melt is among the motions");
    let (Scene::Desk(b), Scene::Desk(a)) = (m.before(), m.after()) else {
        unreachable!()
    };
    assert_eq!(a.grid, b.grid, "a melt must not change the inventory");
    assert_eq!(a.cmdr.xp, b.cmdr.xp + 1, "a melt is worth exactly 1 XP");
    // And the reveal really shows the item before it melts.
    assert!((0..m.frames()).any(|n| matches!(
        m.scene(n),
        Scene::Desk(k) if matches!(k.grid[motion::MELT_CELL], station::Cell::Item { new: true, .. })
    )));
}

/// A fallen commander's locator marks the cell it will return to (0029: back cell, same lane).
#[test]
fn the_fallen_locator_marks_the_return_cell() {
    let mut p = panel::blank();
    station::station(
        &mut p,
        &fx::fallen_screen(fx::back_lane(false), fx::game_state().round + 1),
    );
    let r = station::loc_cell(fx::back_lane(false) as usize, 0);
    assert_eq!(p.get_pixel(r.top_left), pal::WARM);
}

/// Every placeholder overlay draws something and fits its cell as an icon.
#[test]
fn every_overlay_is_nonempty_and_fits_a_cell() {
    for it in ITEMS {
        let b = shrine_render::sprite::overlay_bounds(it);
        let k = (36 / b.size.width.max(b.size.height) as i32)
            .clamp(1, shrine_render::sprite::ICON_MAX_SCALE);
        assert!(
            b.size.width as i32 * k <= 46 && b.size.height as i32 * k <= 46,
            "{} is too big for a cell",
            it.name
        );
    }
}

// ---------------------------------------------------------------------------------------------
// Band invariance: firmware rasterises strips
// ---------------------------------------------------------------------------------------------

fn banded(s: &Scene<'_>, n: usize) -> Panel {
    let rows = (geom::H + n as i32 - 1) / n as i32;
    let mut out = panel::blank();
    for b in 0..n {
        let y0 = b as i32 * rows;
        if y0 >= geom::H {
            break;
        }
        let rows = rows.min(geom::H - y0);
        let mut strip: Panel = SimulatorDisplay::new(Size::new(geom::W as u32, rows as u32));
        {
            let mut t = strip.translated(Point::new(0, -y0));
            s.draw(&mut t);
        }
        for y in 0..rows {
            for x in 0..geom::W {
                let _ =
                    Pixel(Point::new(x, y0 + y), strip.get_pixel(Point::new(x, y))).draw(&mut out);
            }
        }
    }
    out
}

#[test]
fn every_station_scene_is_band_invariant() {
    let mut scenes: Vec<Scene<'static>> = Vec::new();
    for m in fx::motions() {
        scenes.push(m.before());
        scenes.push(m.after());
        scenes.push(m.scene(m.frames() / 2));
    }
    scenes.push(Scene::Desk(Desk::lobby(
        fx::commander(),
        &fx::ledger(),
        Voice::Invite,
    )));
    for s in &scenes {
        let one = fx::scene(s).to_ne_bytes();
        for n in [4, 7, 16] {
            assert_eq!(
                one,
                banded(s, n).to_ne_bytes(),
                "a station scene differs in {n} bands"
            );
        }
    }
}

/// The motion table in `preview/station/MANIFEST.md` is recomputed row by row from real renders,
/// so a changed motion names its stale row instead of leaving the document to be believed.
#[test]
fn the_station_manifest_matches_the_code() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../preview/station/MANIFEST.md"
    );
    let doc = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    for m in fx::motions() {
        let row = fx::manifest_row(&m);
        assert!(
            doc.contains(&row),
            "station MANIFEST.md no longer documents {row:?}; one of the two is stale"
        );
    }
    let label = fx::state_label(&fx::mid_turn());
    assert!(
        doc.contains(&label),
        "station MANIFEST.md does not name the fixture state {label:?}"
    );
}

/// 0031 after review: an item grants Ranged, Shield 1, Haste or Taunt — never Rush.
#[test]
fn no_item_grants_a_keyword_0031_excludes() {
    for it in ITEMS {
        if let commander::Effect::Keyword(k) = it.effect {
            assert!(
                commander::item_keyword_allowed(k),
                "{} grants {k:?}",
                it.name
            );
        }
    }
    assert!(!commander::item_keyword_allowed(
        tapstone_rules::cards::Keyword::Rush
    ));
}

// ---------------------------------------------------------------------------------------------
// Review fixes (Oracle on #50): the voice agrees with the state, and the state is possible
// ---------------------------------------------------------------------------------------------

fn station_scenes() -> Vec<station::StationScreen<'static>> {
    // Static screens only — every motion's before and after, and the waiting screen. Inside a
    // motion the band is deliberately one push behind the figure (it gets its own frame, after),
    // so a mid-motion frame may still show the previous sentence; the after screen may not.
    let mut v = Vec::new();
    for m in fx::motions() {
        for sc in [m.before(), m.after()] {
            if let Scene::Station(s) = sc {
                v.push(s);
            }
        }
    }
    v.push(fx::fallen_screen(
        fx::back_lane(true),
        fx::game_state().round.saturating_sub(1),
    ));
    v
}

/// No sentence in the band contradicts the state drawn beside it, on any station frame.
#[test]
fn every_station_voice_agrees_with_its_state() {
    for s in station_scenes() {
        assert!(
            station::voice_agrees(&s.voice, &s.st),
            "{:?} contradicts {:?}",
            s.voice,
            s.st
        );
    }
}

/// The refusal is the engine's, and its numbers are the drawn readout's.
#[test]
fn the_refusal_is_the_engines_and_matches_the_mana_readout() {
    let (_, r) = fx::engine_refusal();
    let tapstone_rules::rules::Refusal::NoMana { need, have } = r else {
        panic!("the engine refused for another reason: {r:?}")
    };
    let st = fx::station_screen(fx::live(), Voice::Refused(r)).st;
    assert_eq!(
        have,
        st.mana(),
        "the refusal's 'you have' must be the well's number"
    );
    assert!(need > have);
    // The readout the well draws is built from the same number.
    assert!(station::voice_agrees(&Voice::Refused(r), &st));
}

/// Control: the agreement check sees the defect Oracle found — "you have 1" beside "4 of 4".
#[test]
fn control_a_planted_contradiction_is_caught() {
    let st = fx::station_screen(fx::live(), Voice::Silent).st;
    let lie = tapstone_rules::rules::Refusal::NoMana {
        need: st.mana() + 2,
        have: st.mana() + 1,
    };
    assert!(!station::voice_agrees(&Voice::Refused(lie), &st));
    assert!(
        !station::voice_agrees(&Voice::Return(ReturnState::In(2)), &st),
        "on board, nothing returns"
    );
    let blocked = fx::fallen_screen(fx::back_lane(true), st.round);
    assert!(!station::voice_agrees(
        &Voice::Return(ReturnState::ThisTurn),
        &blocked.st
    ));
}

/// The spent-mana ring is drawn, distinguishable from an available pip, and drawn only when
/// something was spent.
#[test]
fn spent_mana_draws_rings_and_available_mana_draws_dots() {
    let count = |p: &Panel, c: Rgb565| {
        let w = station::MANA_WELL;
        let mut n = 0;
        for y in w.top_left.y..w.top_left.y + w.size.height as i32 {
            for x in w.top_left.x..w.top_left.x + w.size.width as i32 {
                n += (p.get_pixel(Point::new(x, y)) == c) as usize;
            }
        }
        n
    };
    let s = fx::station_screen(fx::live(), Voice::Silent);
    assert!(s.st.spent > 0 && s.st.mana() > 0);
    let mut p = panel::blank();
    station::station(&mut p, &s);
    let (rings, dots) = (
        count(&p, Ink::Spent.pair().0),
        count(&p, Ink::Mana.pair().0),
    );
    // TEXT_DIM also draws the well's labels, so compare against a render with nothing spent.
    let mut none = s;
    none.st.spent = 0;
    none.st.mana = none.st.charged;
    let mut q = panel::blank();
    station::station(&mut q, &none);
    assert!(
        rings > count(&q, Ink::Spent.pair().0),
        "spent mana drew no ring"
    );
    assert!(
        dots < count(&q, Ink::Mana.pair().0),
        "spent mana still drew as available"
    );
    assert!(dots > 0, "available mana drew nothing");
}

/// The instrument: did the castle lose at least the fall penalty between `b` and `a`? (At least,
/// because the engine tallies the penalty with the combat's castle damage, 0029.)
fn paid_fall_penalty(b: &station::StationScreen<'_>, a: &station::StationScreen<'_>) -> bool {
    b.st.castle_life.saturating_sub(a.st.castle_life) >= b.st.fall_penalty
}

/// Control for `paid_fall_penalty`: it must be seen to **fail**. Oracle found it never had been.
/// A real engine record with no death drops the castle by less than the penalty, and a planted
/// one-point drop does too — both must read as "not paid".
#[test]
fn control_the_fall_penalty_check_fails_when_the_castle_pays_less() {
    // Run at the default penalty and at a table with none, where every drop is "paid" and the
    // planted case must not underflow (Oracle's nit on #57).
    for fall in [tapstone_rules::HouseRules::default().commander_fall, 0] {
        let setup = tapstone_sim::Setup {
            rules: tapstone_rules::HouseRules {
                commander_fall: fall,
                ..Default::default()
            },
            ..fx::setup()
        };
        // A real transition: from round 2 (so the before-state is in play, not the lobby), the
        // first record at which seat 0's commander is alive — a turn with no death.
        let (b, a) = shrine_preview::game::first_where_setup(fx::FALL_SEED, 400, setup, |g| {
            g.phase == tapstone_rules::state::Phase::Playing
                && g.round >= 2
                && g.seats[0].commander.returns == 0
        })
        .expect("replays")
        .expect("a live-commander record exists");
        let (sb, sa) = (fx::station_of_game(&b.game), fx::station_of_game(&a.game));
        let pen = sb.st.fall_penalty;
        assert_eq!(pen, fall, "the station reads the table's penalty");
        assert_eq!(
            b.game.seats[0].commander.returns, 0,
            "no death in the control transition"
        );
        let drop = sb.st.castle_life.saturating_sub(sa.st.castle_life);
        if pen > 0 {
            assert!(
                drop < pen,
                "the control transition must drop the castle by less than the penalty"
            );
            assert!(
                !paid_fall_penalty(&sb, &sa),
                "a non-death record reads as a paid fall"
            );
            // Planted: one point short of the penalty.
            let mut short = sb;
            short.st.castle_life = sb.st.castle_life.saturating_sub(pen - 1);
            assert!(
                !paid_fall_penalty(&sb, &short),
                "a drop one short of the penalty reads as paid"
            );
        } else {
            // No penalty: nothing can fall short of it.
            assert!(paid_fall_penalty(&sb, &sa));
        }
        // The boundary: exactly the penalty is paid.
        let mut exact = sb;
        exact.st.castle_life = sb.st.castle_life.saturating_sub(pen);
        assert!(paid_fall_penalty(&sb, &exact));
    }
}

/// 0029: a fall costs the castle the game's fall penalty. In the engine it is tallied with the
/// combat's castle damage (seed 11: the drop is at least the penalty), and the view-side fall
/// debits exactly the penalty. Both ends are checked, and the castle well gets its own frame.
#[test]
fn a_fall_debits_the_castle_by_the_fall_penalty() {
    let pen = |s: &station::StationScreen<'_>| s.st.fall_penalty;
    assert_eq!(
        fx::game_state().rules.commander_fall,
        pen(&fx::engine_station(Voice::Silent))
    );
    // The engine's own fall.
    let m = fx::fall();
    let (Scene::Station(b), Scene::Station(a)) = (m.before(), m.after()) else {
        unreachable!()
    };
    assert!(
        paid_fall_penalty(&b, &a),
        "engine castle {} -> {}: less than the {} penalty",
        b.st.castle_life,
        a.st.castle_life,
        pen(&b)
    );
    // The view's fall, from the same before-state: exactly the penalty.
    let v = Motion::fall(b);
    let Scene::Station(va) = v.after() else {
        unreachable!()
    };
    assert_eq!(va.st.castle_life, b.st.castle_life.saturating_sub(pen(&b)));
    // The castle well changes on a frame whose rectangle is the castle well.
    let n = (0..m.frames())
        .find(|n| m.dirty(*n) == station::CASTLE_WELL)
        .expect("a fall pushes the castle well");
    let (p0, p1) = (fx::frame(&m, n - 1), fx::frame(&m, n));
    assert!(
        !escapes(&p0, &p1, Rectangle::zero()).is_empty(),
        "the castle frame changes nothing"
    );
    // Control: a fall that forgets the castle has no castle frame at all.
    let forgot = Motion::Fall {
        before: b,
        after: station::StationScreen {
            st: shrine_render::commander::Station {
                castle_life: b.st.castle_life,
                ..a.st
            },
            ..a
        },
    };
    assert!((0..forgot.frames()).all(|n| forgot.dirty(n) != station::CASTLE_WELL));
}

/// A real death in end-of-turn combat changes more than the castle; every well it changes
/// settles on a frame of its own (the containment test then proves each stays in its rectangle).
#[test]
fn a_real_fall_settles_every_well_it_changed() {
    let m = fx::fall();
    let (Scene::Station(b), Scene::Station(a)) = (m.before(), m.after()) else {
        unreachable!()
    };
    let changed: Vec<usize> = (0..station::WELL_COUNT)
        .filter(|i| station::well_changed(&b.st, &a.st, *i))
        .collect();
    assert!(
        changed.len() > 1,
        "seed {} no longer turns the round with the death: {changed:?}",
        fx::FALL_SEED
    );
    for i in changed {
        assert!(
            (0..m.frames()).any(|n| m.dirty(n) == station::WELLS[i]),
            "well {i} never settles"
        );
    }
}

/// The engine's return round is the death round plus the game's delay (0029).
#[test]
fn the_engine_fall_sets_the_return_round() {
    let (b, a) = fx::real_fall();
    let s = shrine_render::commander::Station::from_game(&a.game, 0).unwrap();
    let shrine_render::commander::Presence::Fallen { return_round, .. } = s.presence else {
        panic!("{:?}", s.presence)
    };
    // Dying in round r sets return round r + delay (0029), r being the round the death record ran in.
    assert_eq!(return_round, b.game.round + a.game.rules.commander_return);
}

/// The return math saturates: a blocked commander's return round is in the past.
#[test]
fn return_math_saturates_and_a_blocked_return_waits() {
    assert_eq!(commander::rounds_until(3, 5), 0);
    assert_eq!(commander::rounds_until(7, 5), 2);
    // Control: the naive subtraction this guards against really does wrap.
    assert_eq!(3u8.wrapping_sub(5), 254);
    let round = fx::game_state().round;
    let blocked = fx::fallen_screen(fx::back_lane(true), round.saturating_sub(1));
    assert!(fx::is_blocked(&blocked));
    assert_eq!(fx::claimed_rounds(&blocked), Some(0));
    assert_eq!(blocked.voice, Voice::Return(ReturnState::Blocked));
    let free = fx::fallen_screen(fx::back_lane(false), round);
    assert_eq!(free.st.return_state(), Some(ReturnState::ThisTurn));
}

/// The contrast check itself can fail: planted pairs below the floor must be rejected.
#[test]
fn control_the_contrast_check_rejects_planted_pairs() {
    for (fg, bg) in [
        (pal::HEALTH_MID, pal::WARM),
        (pal::TEXT_DIM, pal::DIMMED),
        (pal::DIMMED, pal::PANEL),
    ] {
        assert!(
            contrast(fg, bg) < pal::MIN_CONTRAST,
            "{fg:?} on {bg:?} passes; the planted pair is not a failure"
        );
    }
}

/// The longest commander name goes through every screen that draws one, without spilling.
#[test]
fn a_max_length_name_fits_every_screen() {
    let c = commander::Commander {
        name: fx::LONG_NAME,
        ..fx::commander()
    };
    let gutter = |p: &Panel| {
        (0..voice::PTT_TOP).all(|y| {
            (station::COL_R + 1..station::SOCKET_X)
                .all(|x| p.get_pixel(Point::new(x, y)) == pal::BG)
        })
    };
    let edges = |p: &Panel| {
        (0..voice::BAND_Y).all(|y| {
            [0, 1, 2, geom::W - 3, geom::W - 2, geom::W - 1]
                .iter()
                .all(|x| p.get_pixel(Point::new(*x, y)) == pal::BG)
        })
    };
    let mut lobby = panel::blank();
    station::lobby(&mut lobby, &Desk::lobby(c, &fx::ledger(), Voice::Invite));
    assert!(gutter(&lobby), "lobby title spills");
    let mut st = panel::blank();
    station::station(
        &mut st,
        &station::StationScreen {
            cmdr: c,
            ..fx::station_screen(fx::live(), Voice::Silent)
        },
    );
    assert!(gutter(&st), "station title spills");
    let mut idle = panel::blank();
    station::idle(&mut idle, Some(&c), fx::SIGIL, Default::default());
    assert!(edges(&idle), "idle name reaches the panel edge");
}

/// Every body and overlay stays inside the 48 px base box at every breath pose, stagger and drop
/// the motions use — otherwise the figure draws outside the doll rectangle the device pushes.
#[test]
fn every_sprite_stays_inside_its_base_box_at_every_pose() {
    use shrine_render::sprite::{self, Bounds, Look, Pose};
    let inside = |b: &Bounds| {
        b.rect().is_none_or(|r| {
            r.top_left.x >= 0
                && r.top_left.y >= 0
                && r.top_left.x + r.size.width as i32 <= sprite::HERO
                && r.top_left.y + r.size.height as i32 <= sprite::HERO
        })
    };
    for breath in 0..3u8 {
        for dx in [-2, 0, 2] {
            for dy in [0, station::FALL_DROP] {
                for reach in [
                    None,
                    Some(sprite::Held::Back),
                    Some(sprite::Held::Face(pal::EMBER)),
                ] {
                    let p = Pose {
                        breath,
                        look: Look::Normal,
                        dx,
                        dy,
                        reach,
                    };
                    let mut b = Bounds::default();
                    sprite::hero(&mut b, tapstone_rules::cards::Faction::Ember, p);
                    assert!(inside(&b), "hero leaves its box at {p:?}");
                    for it in ITEMS {
                        let mut b = Bounds::default();
                        sprite::overlay(&mut b, it, p);
                        assert!(
                            inside(&b),
                            "{} leaves the box at {p:?}: {:?}",
                            it.name,
                            b.rect()
                        );
                    }
                }
            }
        }
    }
}

/// Looks are the point of gear under 0034: no two weapons may draw the same overlay.
#[test]
fn every_weapon_has_its_own_silhouette() {
    use shrine_render::sprite::{self, Pose};
    let weapons: Vec<_> = ITEMS.iter().filter(|i| i.slot == Slot::Weapon).collect();
    let draw = |it: &commander::Item| {
        let mut p = panel::blank();
        let mut s = sprite::Scaled {
            inner: &mut p,
            origin: Point::zero(),
            k: 1,
        };
        sprite::overlay(&mut s, it, Pose::default());
        p.to_ne_bytes()
    };
    for (i, a) in weapons.iter().enumerate() {
        for b in &weapons[i + 1..] {
            if a.faction == b.faction {
                assert_ne!(draw(a), draw(b), "{} and {} look identical", a.name, b.name);
            }
        }
    }
}

/// 0034: every commander is 2/4 whatever its level or gear; gear adds at most Haste or Taunt.
/// The base is the engine's `LEVEL_1`, so there is no second table to drift.
#[test]
fn levels_and_gear_never_change_attack_or_toughness() {
    let base = tapstone_rules::Commander::LEVEL_1;
    let of = |slot: Slot| {
        std::iter::once(None)
            .chain(
                ITEMS
                    .iter()
                    .filter(move |d| d.slot == slot)
                    .map(|d| Some(d.id)),
            )
            .collect::<Vec<_>>()
    };
    let (mut legal, mut illegal) = (0, 0);
    for level in 1..=commander::LEVEL_MAX {
        for w in of(Slot::Weapon) {
            for a in of(Slot::Armour) {
                for t in of(Slot::Trinket) {
                    let c = commander::Commander {
                        xp: commander::level_start(level),
                        loadout: [w, a, t],
                        ..fx::commander()
                    };
                    match c.claim() {
                        Ok(s) => {
                            legal += 1;
                            assert_eq!((s.attack, s.toughness), (base.attack, base.toughness));
                            if let Some(k) = s.keyword {
                                assert!(
                                    tapstone_rules::state::COMMANDER_KEYWORDS.contains(&k),
                                    "{k:?}"
                                );
                            }
                        }
                        Err(_) => illegal += 1,
                    }
                }
            }
        }
    }
    assert!(
        legal > 0 && illegal > 0,
        "the sweep must see both legal and refused kits"
    );
    // Controls: the Sabre does grant Haste; Sabre + Hearthguard Plate is a second keyword; a
    // trinket before level 7 is a locked slot. Progression's own errors, not the station's.
    let lv = |level: u8, loadout| commander::Commander {
        xp: commander::level_start(level),
        loadout,
        ..fx::commander()
    };
    let sabre = fx::item_id("Ember Sabre");
    let plate = fx::item_id("Hearthguard Plate");
    let locket = fx::item_id("Ash Locket");
    assert_eq!(
        lv(4, [Some(sabre), None, None]).claim().unwrap().keyword,
        Some(tapstone_rules::cards::Keyword::Haste)
    );
    assert_eq!(
        lv(4, [Some(sabre), Some(plate), None]).claim(),
        Err(tapstone_progression::LoadoutError::SecondKeyword)
    );
    assert_eq!(
        lv(6, [None, None, Some(locket)]).claim(),
        Err(tapstone_progression::LoadoutError::SlotLocked(2))
    );
}

/// One source (the lead's ruling): the station's equip legality is exactly progression's
/// `derive_commander`, for every item at every level, bare and with a keyword item already worn.
/// `min_level` gates the loot table, not equipping. Control: a planted station-side min-level gate
/// disagrees with ClaimSeat somewhere, and the same comparison catches it.
#[test]
fn equip_legality_is_derive_commanders_for_every_item_and_level() {
    // Every place a gate disagrees with ClaimSeat, as (item id, level, a keyword item worn?).
    let disagreements = |gate: &dyn Fn(&commander::Commander<'_>, u16) -> bool| {
        let mut out = Vec::new();
        for level in 1..=commander::LEVEL_MAX {
            for worn in [None, Some(fx::item_id("Ember Sabre"))] {
                let c = commander::Commander {
                    xp: commander::level_start(level),
                    loadout: [worn, None, None],
                    ..fx::commander()
                };
                for d in ITEMS {
                    let mut next = c.loadout;
                    next[d.slot.index()] = Some(d.id);
                    let claimseat = tapstone_progression::derive_commander(level, &next).is_ok();
                    if gate(&c, d.id) != claimseat {
                        out.push((d.id, level, worn.is_some()));
                    }
                }
            }
        }
        out
    };
    let station = |c: &commander::Commander<'_>, id: u16| c.can_equip(id).is_ok();
    assert_eq!(
        disagreements(&station),
        vec![],
        "the station and ClaimSeat disagree on an equip"
    );

    // Control: re-insert the min-level check. It must go red exactly where it would have bitten:
    // it1-002 (Hearthguard Plate, min_level 3) at level 1, with nothing worn.
    let planted = |c: &commander::Commander<'_>, id: u16| {
        commander::item(id).is_some_and(|d| d.min_level <= c.level()) && c.can_equip(id).is_ok()
    };
    let plate = fx::item_id("Hearthguard Plate");
    assert_eq!(plate, 2, "it1-002 is design id 2");
    assert!(
        disagreements(&planted).contains(&(plate, 1, false)),
        "control: the planted min-level gate did not go red at it1-002, level 1"
    );

    // The one level gate that remains: the third slot, which ClaimSeat also refuses.
    let early = commander::Commander {
        xp: commander::level_start(commander::TRINKET_LEVEL - 1),
        loadout: [None; 3],
        ..fx::commander()
    };
    assert_eq!(
        early.can_equip(fx::item_id("Ash Locket")),
        Err(commander::EquipRefusal::Loadout(
            tapstone_progression::LoadoutError::SlotLocked(2)
        ))
    );
}

/// One source: the station's stats are the engine seat's, and the engine seat's are the lobby's
/// claim — the numbers the lobby promised are the numbers in play.
#[test]
fn the_station_shows_the_engines_commander_and_it_is_the_lobbys_claim() {
    let g = fx::game_state();
    let st = fx::engine_station(Voice::Silent).st;
    let engine = g.seats[0].commander;
    assert_eq!(
        (st.attack, st.toughness, st.keyword),
        (engine.attack, engine.toughness, engine.keyword)
    );
    let claim = fx::commander().claim().expect("the fixture kit is legal");
    assert_eq!(
        (claim.attack, claim.toughness, claim.keyword),
        (engine.attack, engine.toughness, engine.keyword)
    );
    assert_eq!(
        engine.keyword,
        Some(tapstone_rules::cards::Keyword::Haste),
        "the fixture must carry a keyword to prove anything"
    );
    // Control: seat 1 played the bare base, so it does not match seat 0's claim.
    assert_ne!(g.seats[1].commander.keyword, claim.keyword);
}

/// Derived, not typed: at a table whose fall penalty is 2, the station never renders −3 — the
/// engine's fall and the view's fall both follow `rules.commander_fall`.
#[test]
fn a_non_default_fall_penalty_is_what_the_station_shows() {
    let rules = tapstone_rules::HouseRules {
        commander_fall: 2,
        ..Default::default()
    };
    assert_ne!(
        rules.commander_fall,
        tapstone_rules::HouseRules::default().commander_fall
    );
    let setup = tapstone_sim::Setup {
        rules,
        ..fx::setup()
    };
    let (b, a) = shrine_preview::game::first_where_setup(fx::FALL_SEED, 400, setup, |g| {
        g.seats[0].commander.returns > 0
    })
    .expect("replays")
    .expect("the fall seed still kills seat 0's commander at fall = 2");
    let (sb, sa) = (fx::station_of_game(&b.game), fx::station_of_game(&a.game));
    assert_eq!(
        sb.st.fall_penalty, 2,
        "the station must read the table's penalty"
    );
    assert!(sb.st.castle_life - sa.st.castle_life >= 2);
    // The view-side fall from the same state debits exactly 2, not a typed 3.
    let Scene::Station(v) = Motion::fall(sb).after() else {
        unreachable!()
    };
    assert_eq!(v.st.castle_life, sb.st.castle_life - 2);
}

// ---------------------------------------------------------------------------------------------
// 0036: every draw is a tap
// ---------------------------------------------------------------------------------------------

/// The opening hand is derived from the rules exactly as the engine owes it: at genesis each
/// seat owes `opening_hand` draws, at the default table and at a non-default one.
#[test]
fn the_opening_hand_is_the_engines_deal() {
    for rules in [
        tapstone_rules::HouseRules::default(),
        tapstone_rules::HouseRules {
            hand: 4,
            second_player_bonus: 2,
            ..Default::default()
        },
    ] {
        let setup = tapstone_sim::Setup {
            rules,
            ..fx::setup()
        };
        let (_, g) = shrine_preview::game::first_where_setup(fx::SEED, 400, setup, |g| {
            g.phase == tapstone_rules::state::Phase::Playing
        })
        .expect("replays")
        .expect("starts");
        for seat in 0..2u8 {
            // 0036 (#63): at genesis the opening hand is owed, not dealt.
            assert_eq!(g.game.seats[seat as usize].hand_len, 0);
            assert_eq!(
                g.game.seats[seat as usize].owed_draws(),
                draws::opening_hand(&g.game.rules, seat),
                "seat {seat} at hand {} bonus {}",
                rules.hand,
                rules.second_player_bonus
            );
        }
        // Control: the two seats differ by exactly the bonus, so the check can tell them apart.
        assert_eq!(
            draws::opening_hand(&rules, 1) - draws::opening_hand(&rules, 0),
            rules.second_player_bonus
        );
    }
}

/// The mulligan window is the engine's: open for seat 0 at genesis, closed for seat 1 (not active)
/// and closed for seat 0 once it has acted.
#[test]
fn the_mulligan_window_comes_from_the_engine() {
    let g = fx::genesis();
    assert!(draws::mulligan_open(&g, 0));
    assert!(!draws::mulligan_open(&g, 1), "control: the inactive seat");
    assert!(
        !draws::mulligan_open(&fx::game_state(), 0),
        "control: a seat that has acted"
    );
}

/// Every 0036 screen's band agrees with its state, and a planted wrong count is caught.
#[test]
fn every_draw_screen_agrees_with_its_state() {
    let screens = [
        fx::opening(0, 0),
        fx::opening(1, 0),
        fx::opening(0, 3),
        fx::opening(0, 5),
        fx::turn_start(),
        fx::spell_draw(),
    ];
    for s in screens {
        assert!(
            station::voice_agrees(&s.voice, &s.st),
            "{:?} vs owed {}",
            s.voice,
            s.st.owed
        );
    }
    let s = fx::opening(0, 3);
    assert!(!station::voice_agrees(
        &Voice::Draw {
            n: s.st.owed + 1,
            why: DrawWhy::Opening
        },
        &s.st
    ));
    assert!(
        !station::voice_agrees(&Voice::MulliganOffer, &s.st),
        "no mulligan while draws are owed"
    );
    assert!(!station::voice_agrees(
        &Voice::Drew {
            card: "x",
            left: s.st.owed + 1
        },
        &s.st
    ));
}

/// The spell-draw screen is the engine's: the band names a real draw spell whose count is what the
/// engine says is owed, and the spell's cost is inside what the seat has spent this turn.
#[test]
fn the_spell_draw_is_the_engines() {
    let s = fx::spell_draw();
    let Voice::Draw {
        n,
        why: DrawWhy::Spell { card },
    } = s.voice
    else {
        panic!("{:?}", s.voice)
    };
    let d = SET1.iter().find(|d| d.name == card).unwrap();
    let tapstone_rules::cards::CardKind::Spell(tapstone_rules::cards::Effect::Draw { count }) =
        d.kind
    else {
        panic!("{card} is not a draw spell")
    };
    assert_eq!((n, s.st.owed), (count, count));
    assert!(
        s.st.spent >= d.cost,
        "the spell's cost is not in what was spent"
    );
    assert!(station::voice_agrees(&s.voice, &s.st));
}

fn count_px(p: &Panel, r: Rectangle, c: Rgb565) -> usize {
    let mut n = 0;
    for y in r.top_left.y..r.top_left.y + r.size.height as i32 {
        for x in r.top_left.x..r.top_left.x + r.size.width as i32 {
            n += (p.get_pixel(Point::new(x, y)) == c) as usize;
        }
    }
    n
}

/// Owing draws is visible on the figure: a face-down card carrying the count. Nothing is owed,
/// nothing is held (control).
#[test]
fn owing_draws_shows_a_numbered_card_on_the_figure() {
    let (fg, bg) = Ink::OnCard.pair();
    let render = |s: &station::StationScreen<'_>| {
        let mut p = panel::blank();
        station::station(&mut p, s);
        p
    };
    let owing = render(&fx::opening(0, 3));
    assert!(count_px(&owing, station::DOLL, bg) > 0, "no face-down card");
    assert!(
        count_px(&owing, station::DOLL, fg) > 0,
        "no count on the card"
    );
    let none = render(&fx::opening(0, 5));
    assert_eq!(
        count_px(&none, station::DOLL, bg),
        0,
        "a card is held with nothing owed"
    );
}

/// The mulligan touch target clears the touch floor, stays out of the push-to-talk strip and off
/// the ROUND label, and is drawn only while the window is open.
#[test]
fn the_mulligan_target_is_a_real_touch_target_only_when_open() {
    let t = station::mulligan_target();
    assert!(
        t.size.width as i32 >= geom::TOUCH_MIN && t.size.height as i32 >= geom::TOUCH_MIN,
        "{t:?}"
    );
    assert!(t.top_left.y + t.size.height as i32 <= voice::PTT_TOP);
    assert!(
        t.top_left.x + (t.size.width as i32) < station::WELL_X + station::WELL_W / 2,
        "it runs into ROUND"
    );
    let edge = |s: &station::StationScreen<'_>| {
        let mut p = panel::blank();
        station::station(&mut p, s);
        p.get_pixel(t.top_left) == pal::WARM
    };
    assert!(edge(&fx::opening(0, 5)), "the open window draws no target");
    assert!(
        !edge(&fx::turn_start()),
        "control: a closed window draws one anyway"
    );
}

/// A draw acknowledgement depicts its consequence: one more in hand, one fewer owed, the name in
/// the band — and the last draw of a hand lowers the arm.
#[test]
fn a_draw_ack_moves_one_card_from_owed_to_hand() {
    for m in fx::draw_motions()
        .into_iter()
        .filter(|m| matches!(m, Motion::DrawAck { .. }))
    {
        let (Scene::Station(b), Scene::Station(a)) = (m.before(), m.after()) else {
            unreachable!()
        };
        assert_eq!(a.st.hand, b.st.hand + 1);
        assert_eq!(a.st.owed, b.st.owed - 1);
        assert!(matches!(a.voice, Voice::Drew { left, .. } if left == a.st.owed));
        assert_eq!(a.resting_pose().reach.is_some(), a.st.owed > 0);
    }
}

/// Motion names key the filmstrip files and the manifest rows, so they must be unique.
#[test]
fn every_motion_has_a_unique_name() {
    let names: Vec<_> = fx::motions().iter().map(|m| m.name()).collect();
    let mut seen = std::collections::BTreeSet::new();
    for n in &names {
        assert!(seen.insert(*n), "two motions are both named {n:?}");
    }
}

/// 0036 as clarified (#61): a mulligan owes as many draws as the hand it returned — tested on a
/// hand one larger than the opening hand (seat 1 after its turn-start draw), where the old
/// "fresh opening hand" reading would have owed one fewer.
#[test]
fn a_mulligan_owes_the_hand_it_returned() {
    let mut s = fx::opening(1, 0);
    s.st.hand = s.st.opening + 1;
    s.st.owed = 0;
    s.st.mulligan_open = true;
    let Scene::Station(a) = (Motion::Mulligan { before: s }).after() else {
        unreachable!()
    };
    assert_eq!(
        a.st.owed,
        s.st.opening + 1,
        "owed must be the returned hand, not the opening hand"
    );
    assert_eq!(a.st.hand, 0);
    assert_ne!(
        a.st.owed, s.st.opening,
        "control: the two readings differ for this hand"
    );
}

// ---------------------------------------------------------------------------------------------
// The castle during the mulligan window (the lead's ruling on #59)
// ---------------------------------------------------------------------------------------------

/// The mulligan is reachable by cards alone: tap the castle, tap it again within 3 s. Nothing is
/// sent after the first tap. Control: under 0009's immediate pass, the same two taps pass the turn
/// and then are refused — the mulligan is unreachable without touch.
#[test]
fn a_card_only_mulligan_is_reachable_and_immediate_pass_makes_it_impossible() {
    use draws::{CastleRule, CastleTaps, Resolved, SECOND_TAP_MS, Sent};
    let g = fx::opening(0, 5);
    let open = g.st.mulligan_open;
    assert!(open, "the fixture must be in the window");
    let taps = [0u32, SECOND_TAP_MS / 2];

    let mut ruled = CastleTaps::new(CastleRule::PromptInWindow);
    assert_eq!(
        ruled.tap(taps[0], open),
        Resolved::default(),
        "the first tap must send nothing"
    );
    assert!(ruled.prompting(), "the 3 s prompt must be showing");
    assert_eq!(ruled.tap(taps[1], open).now, Some(Sent::Mulligan));
    assert!(ruled.my_turn, "a mulligan does not end the turn");

    let mut old = CastleTaps::new(CastleRule::Immediate);
    let sent: Vec<_> = taps.iter().filter_map(|t| old.tap(*t, open).now).collect();
    assert_eq!(sent, vec![Sent::Pass, Sent::Refused]);
    assert!(
        !sent.contains(&Sent::Mulligan),
        "control: immediate pass reaches the mulligan anyway"
    );
}

/// Oracle on #59: the window is read at every tap, never snapshotted. Act first (charge), and the
/// engine closes the window — the next castle tap passes at once. Control: the stale snapshot
/// (window still "open") would open a prompt whose mulligan the engine then refuses.
#[test]
fn after_acting_a_castle_tap_passes_at_once() {
    use draws::{CastleRule, CastleTaps, Sent};
    let mut g = fx::genesis();
    // Draw the whole opening hand for real, so seat 0 can act.
    while g.seats[0].owed_draws() > 0 {
        let card = g.seats[0].deck[0]; // any design with an undrawn copy
        g.apply(&tapstone_sim::tap(
            0,
            tapstone_rules::event::Kind::Draw,
            card,
            -1,
            0,
            0,
        ))
        .expect("an owed draw is accepted");
    }
    let before = draws::mulligan_open(&g, 0);
    assert!(before, "the window is open before acting");
    let card = g.seats[0].hand[0];
    g.apply(&tapstone_sim::tap(
        0,
        tapstone_rules::event::Kind::Charge,
        card,
        -1,
        0,
        0,
    ))
    .expect("the charge is accepted");
    let now = draws::mulligan_open(&g, 0);
    assert!(!now, "acting closes the engine's window");

    let mut c = CastleTaps::new(CastleRule::PromptInWindow);
    assert_eq!(
        c.tap(0, now).now,
        Some(Sent::Pass),
        "a castle tap after acting passes at once"
    );

    let mut stale = CastleTaps::new(CastleRule::PromptInWindow);
    assert_eq!(
        stale.tap(0, before).now,
        None,
        "control: the snapshot opens a prompt"
    );
}

/// Expiry keeps and passes; the outcome depends only on the taps' times, never on tick cadence;
/// outside the window a castle tap passes at once (0009).
#[test]
fn the_castle_prompt_expires_to_keep_and_pass_whatever_the_tick_cadence() {
    use draws::{CastleRule, CastleTaps, Resolved, SECOND_TAP_MS, Sent};
    let late = SECOND_TAP_MS + 1;
    // Ticked every second.
    let mut ticked = CastleTaps::new(CastleRule::PromptInWindow);
    ticked.tap(0, true);
    let mut from_ticks = None;
    for t in (1000..late).step_by(1000) {
        from_ticks = from_ticks.or(ticked.tick(t));
    }
    let ticked_tap = ticked.tap(late, true);
    // Never ticked.
    let mut bare = CastleTaps::new(CastleRule::PromptInWindow);
    bare.tap(0, true);
    let bare_tap = bare.tap(late, true);
    assert_eq!(
        bare_tap,
        Resolved {
            expired: Some(Sent::Pass),
            now: Some(Sent::Refused)
        },
        "a late tap reads as the lapse (keep and pass), then is refused: the turn has passed"
    );
    let ticked_total: Vec<_> = [from_ticks, ticked_tap.expired, ticked_tap.now]
        .into_iter()
        .flatten()
        .collect();
    let bare_total: Vec<_> = [bare_tap.expired, bare_tap.now]
        .into_iter()
        .flatten()
        .collect();
    assert_eq!(
        ticked_total, bare_total,
        "the tick cadence changed the outcome"
    );

    let mut outside = CastleTaps::new(CastleRule::PromptInWindow);
    assert_eq!(outside.tap(0, false).now, Some(Sent::Pass));
}

/// The prompt state agrees with the station, and is rendered (d3b).
#[test]
fn the_mulligan_prompt_agrees_with_its_state() {
    let s = fx::mulligan_prompt();
    assert!(station::voice_agrees(&s.voice, &s.st));
    assert!(
        !station::voice_agrees(&s.voice, &fx::turn_start().st),
        "control: no prompt outside the window"
    );
}

// ---------------------------------------------------------------------------------------------
// Static outline rings: nothing may paint the 1 px ring outside an outlined rectangle
// ---------------------------------------------------------------------------------------------

fn ring(r: Rectangle) -> Vec<Point> {
    let (x0, y0) = (r.top_left.x - 1, r.top_left.y - 1);
    let (x1, y1) = (
        r.top_left.x + r.size.width as i32,
        r.top_left.y + r.size.height as i32,
    );
    let mut v = Vec::new();
    for x in x0..=x1 {
        v.push(Point::new(x, y0));
        v.push(Point::new(x, y1));
    }
    for y in y0..=y1 {
        v.push(Point::new(x0, y));
        v.push(Point::new(x1, y));
    }
    v.retain(|p| p.x >= 0 && p.y >= 0 && p.x < geom::W && p.y < geom::H);
    v
}

/// Ring pixels of `r` that differ between a render with the outline and one without it.
fn ring_spill(with: &Panel, without: &Panel, r: Rectangle) -> usize {
    ring(r)
        .into_iter()
        .filter(|p| with.get_pixel(*p) != without.get_pixel(*p))
        .count()
}

/// The always-drawn wells sit on the ground with a gutter round them: their ring is ground on
/// every station and draw screen.
fn well_ring_dirty(p: &Panel) -> usize {
    let mut n = 0;
    for w in station::WELLS {
        n += ring(w)
            .into_iter()
            .filter(|q| p.get_pixel(*q) != pal::BG)
            .count();
    }
    n
}

#[test]
fn no_outline_paints_outside_its_rectangle() {
    // The frame-diff sees a stroke only when a motion repaints it; these checks cover the static
    // screens, where the mulligan outline lives.
    let open = fx::opening(0, 5);
    let closed = station::StationScreen {
        st: shrine_render::commander::Station {
            mulligan_open: false,
            ..open.st
        },
        voice: Voice::Silent,
        ..open
    };
    let (mut a, mut b) = (panel::blank(), panel::blank());
    station::station(
        &mut a,
        &station::StationScreen {
            voice: Voice::Silent,
            ..open
        },
    );
    station::station(&mut b, &closed);
    assert_eq!(
        ring_spill(&a, &b, station::mulligan_target()),
        0,
        "the mulligan outline spills"
    );

    for s in fx::draw_screens()
        .iter()
        .chain(fx::screens().iter())
        .filter(|s| s.name.starts_with("s3") || s.name.starts_with('d'))
    {
        assert_eq!(
            well_ring_dirty(&s.panel),
            0,
            "{}: a well's ring is painted",
            s.name
        );
    }
}

/// Control: plant the exact defect — a centre-aligned 2 px stroke — and both checks must fire.
#[test]
fn control_a_planted_outline_spill_is_caught() {
    use embedded_graphics::primitives::PrimitiveStyle;
    let open = fx::opening(0, 5);
    let (mut a, mut b) = (panel::blank(), panel::blank());
    station::station(&mut a, &open);
    station::station(&mut b, &open);
    let _ = station::mulligan_target()
        .into_styled(PrimitiveStyle::with_stroke(pal::WARM, 2))
        .draw(&mut a);
    assert!(
        ring_spill(&a, &b, station::mulligan_target()) > 0,
        "a centred stroke went unseen"
    );

    let mut c = panel::blank();
    station::station(&mut c, &open);
    let _ = station::CASTLE_WELL
        .into_styled(PrimitiveStyle::with_stroke(pal::TEXT, 2))
        .draw(&mut c);
    assert!(well_ring_dirty(&c) > 0, "a spill round a well went unseen");
}

/// While a draw is owed the band must ask for it. Control: the real fall at a round turn, with the
/// return whisper in the band over its owed turn-start draw — the defect its render showed.
#[test]
fn an_owed_draw_owns_the_band() {
    let Scene::Station(a) = fx::fall().after() else {
        unreachable!()
    };
    assert!(
        a.st.owed > 0,
        "the fixture fall must owe a draw to test this"
    );
    assert!(station::voice_agrees(&a.voice, &a.st), "{:?}", a.voice);
    assert!(matches!(a.voice, Voice::Draw { .. }));
    let whisper = a.st.return_state().map(Voice::Return).unwrap();
    assert!(
        !station::voice_agrees(&whisper, &a.st),
        "a whisper over an owed draw passed"
    );
}

/// The station's XP bar reads progression's table (#65), the one the arena derives from. Pinned to
/// 0030's ruling — flat 5 XP a level — so changing the table without a ruling turns this red, which
/// the perturbation check shows. And the view's (level, XP into level) maps back to the same level
/// through progression's own `level_for_xp`, for every fixture commander.
#[test]
fn the_station_reads_progressions_xp_table() {
    for level in 1..commander::LEVEL_MAX {
        assert_eq!(
            commander::xp_to_next(level),
            Some(5),
            "0030: flat 5 XP a level (level {level})"
        );
    }
    assert_eq!(commander::xp_to_next(commander::LEVEL_MAX), None);
    // The fixtures are written as "level 4, 3 in" and "level 6, 3 in"; progression must read their
    // totals back as exactly that.
    for (c, level) in [(fx::commander(), 4), (fx::commander_l6(), 6)] {
        assert_eq!(c.level(), level, "{} at {} XP", c.name, c.xp);
        assert_eq!(c.xp_into_level(), 3);
    }
}

/// Oracle's case (noted in the 0032 amendment): castle tap opens the prompt, the seat then acts
/// within the 3 s (the window closes), and the prompt expires to Pass — no mulligan is left.
#[test]
fn a_prompt_followed_by_an_action_still_expires_to_pass() {
    use draws::{CastleRule, CastleTaps, SECOND_TAP_MS, Sent};
    let mut c = CastleTaps::new(CastleRule::PromptInWindow);
    assert_eq!(c.tap(0, true).now, None, "the prompt opens");
    // A charge at 1 s closes the engine's window; nothing is sent by the castle yet.
    assert_eq!(c.tick(1_000), None);
    assert_eq!(c.tick(SECOND_TAP_MS + 1), Some(Sent::Pass), "expiry passes");
}

/// The pinned finds are what `search-states` answers, within its bound, with every game replayed.
/// The exhausted deck is found nowhere in that bound, which is what justifies its override.
#[test]
fn the_state_search_finds_what_the_fixtures_pin() {
    use shrine_preview::search::{self, Wanted};
    let (found, cov) = search::search();
    assert_eq!(
        cov.errors, 0,
        "a replay failed: the search is blind for that game"
    );
    assert_eq!(
        cov.games,
        search::SEEDS as usize * search::STYLES.len() * search::DECKS.len()
    );
    let at = |w: Wanted| found[search::WANTED.iter().position(|x| *x == w).unwrap()];
    assert_eq!(at(Wanted::Heal), Some(fx::HEAL_AT));
    assert_eq!(at(Wanted::Struck), Some(fx::STRUCK_AT));
    assert_eq!(at(Wanted::BlockedReturn), Some(fx::BLOCKED_AT));
    assert_eq!(
        at(Wanted::ExhaustedDeck),
        None,
        "a real exhausted deck exists: convert the override"
    );
}

/// Positive control for the exhausted-deck negative: the predicate can fire. At a table with an
/// 8-card deck a real game runs out, so "none at 25 cards" is a finding, not a blind instrument.
#[test]
fn control_the_exhausted_deck_search_can_see_an_exhaustion() {
    use shrine_preview::search::{self, Wanted};
    let rules = tapstone_rules::HouseRules {
        deck_size: 8,
        ..Default::default()
    };
    let (found, cov) = search::search_with(rules);
    assert_eq!(cov.errors, 0);
    let i = search::WANTED
        .iter()
        .position(|x| *x == Wanted::ExhaustedDeck)
        .unwrap();
    assert!(
        found[i].is_some(),
        "the exhausted-deck predicate never fires, even on a tiny deck"
    );
}

/// The converted states are what they claim: a real heal and a real hit on the commander, and a
/// real commander waiting past its return round on an occupied back cell.
#[test]
fn the_converted_states_are_real() {
    let hp = |s: &station::StationScreen<'_>| match s.st.presence {
        Presence::OnBoard { hp, .. } => hp,
        Presence::Fallen { .. } => 0,
    };
    for (f, up) in [(fx::HEAL_AT, true), (fx::STRUCK_AT, false)] {
        let (Scene::Station(b), Scene::Station(a)) =
            (fx::real_hit(f).before(), fx::real_hit(f).after())
        else {
            unreachable!()
        };
        assert!(
            hp(&b) > 0 && hp(&a) > 0,
            "the commander must survive the hit"
        );
        assert_eq!(hp(&a) > hp(&b), up, "{f:?}");
    }
    let (_, g) = fx::found_states(fx::BLOCKED_AT);
    let s = fx::station_of_game(&g);
    assert_eq!(s.st.return_state(), Some(ReturnState::Blocked));
    // An owed draw owns the band (the waiting state arrives at a turn start, which owes a draw);
    // otherwise the band says it waits.
    let want = if s.st.owed > 0 {
        matches!(s.voice, Voice::Draw { .. })
    } else {
        s.voice == Voice::Return(ReturnState::Blocked)
    };
    assert!(want, "{:?} with {} owed", s.voice, s.st.owed);
    assert!(station::voice_agrees(&s.voice, &s.st));
}
