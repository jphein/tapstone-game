//! Flourish invariants: geometry, cost, and that the animation depicts a consequence.

use embedded_graphics::prelude::*;
use embedded_graphics::primitives::Rectangle;
use shrine_preview::battlefield::View;
use shrine_preview::flourish::*;
use shrine_preview::{cost, game, geom, palette as pal, panel};

fn f() -> Flourish {
    Flourish {
        lane: 1,
        design: 5,
        amount: 2,
    }
}

/// The design rule, asserted: every frame dirties exactly one contiguous rectangle.
///
/// `dirty` returns a single `Rectangle` by type, so this checks the thing that could still go
/// wrong — that the rectangle is real, inside the panel, and not silently empty.
#[test]
fn every_frame_dirties_one_real_rectangle() {
    let fl = f();
    for n in 0..TOTAL_FRAMES {
        let r = fl.dirty(n);
        assert!(
            r.size.width > 0 && r.size.height > 0,
            "frame {n} dirties nothing"
        );
        assert!(
            r.top_left.x >= 0 && r.top_left.y >= 0,
            "frame {n} starts off-panel"
        );
        assert!(
            r.top_left.x + r.size.width as i32 <= geom::W
                && r.top_left.y + r.size.height as i32 <= geom::H,
            "frame {n} overflows the panel"
        );
    }
}

/// The token must actually travel from my wall to theirs, not hover.
#[test]
fn the_token_crosses_the_board() {
    let fl = f();
    let start = fl.token_at(0).y;
    let end = fl.token_at(RISE_FRAMES - 1).y;
    assert!(end < start, "the token must move toward the enemy castle");
    // The token travels the whole gap between the walls, less its own height. Derived from
    // the constraint rather than typed: a 30 px token in the 168 px cell band can cross
    // exactly 138 px, and writing 140 here was wrong the first time.
    assert_eq!(
        start - end,
        geom::CELL_BAND - TOKEN_H,
        "the token must cross the full band, less its own height"
    );
}

/// The rise stays inside its own lane column, which is what keeps it affordable.
#[test]
fn the_rise_stays_in_one_lane_column() {
    let fl = f();
    for n in 0..RISE_FRAMES {
        let r = fl.dirty(n);
        assert_eq!(r.size.width, geom::LANE_CROSS_V as u32);
        assert_eq!(r.top_left.x, geom::lane_x(fl.lane));
    }
}

/// The dirty rect must cover where the token was as well as where it is, or the trail smears.
#[test]
fn the_dirty_rect_covers_the_trail() {
    let fl = f();
    for n in 1..RISE_FRAMES {
        let r = fl.dirty(n);
        let prev = fl.token_at(n - 1);
        let now = fl.token_at(n);
        let (top, bot) = (r.top_left.y, r.top_left.y + r.size.height as i32);
        assert!(
            top <= prev.y && bot >= prev.y + TOKEN_H,
            "frame {n} leaves a trail"
        );
        assert!(
            top <= now.y && bot >= now.y + TOKEN_H,
            "frame {n} clips the token"
        );
    }
}

/// Impact and tick must merge the wall and HUD into one band rather than costing two windows.
///
/// Both bounds matter. The lower one says the band covers what it must; the **upper** one says
/// it is still a band. Without the upper bound this check passed when the region was expanded
/// to the whole panel — a perturbation that should obviously have failed, and did not, because
/// a full-screen region silently falls back to a 29 ms full repaint that still "fits".
#[test]
fn impact_and_tick_use_one_tight_merged_band() {
    let fl = f();
    for n in RISE_FRAMES..TOTAL_FRAMES {
        let r = fl.dirty(n);
        assert_eq!(r.top_left, Point::zero());
        assert!(
            r.size.height as i32 >= geom::HUD + geom::WALL,
            "frame {n}: the band must cover both the HUD and the wall"
        );
        assert!(
            r.size.height as i32 <= geom::HUD + geom::WALL + 4,
            "frame {n}: the band has grown past the wall - it is no longer a band"
        );
    }
}

/// Fitting the budget is not enough; the flourish has to leave room for everything else.
///
/// A full repaint costs 29 ms of a 33.3 ms draw budget, so a design that degrades to
/// full-screen repaints technically "fits" while leaving nothing for the engine, the mesh and
/// the touch poll. This asserts real headroom, which is what the one-band rule buys.
#[test]
fn the_flourish_leaves_most_of_the_budget_unspent() {
    let fl = f();
    let worst = (0..TOTAL_FRAMES)
        .map(|n| cost::verdict(&[fl.dirty(n)]).chosen_ms().1)
        .fold(0.0f32, f32::max);
    assert!(
        worst < cost::DRAW_BUDGET_MS / 2.0,
        "worst frame costs {worst:.1} ms; the one-band design should stay well under \
         half the {:.1} ms budget, not merely inside it",
        cost::DRAW_BUDGET_MS
    );
    // "Meaningfully cheaper than a full repaint" means at most half of one. `/ 3.0` was fitted to
    // the figure observed under the old wire constant and came within 1 ms of failing when that
    // constant was corrected; a third is not a principle, a half is the claim being made.
    assert!(
        worst < cost::FULL_REPAINT_MS / 2.0,
        "worst frame costs {worst:.1} ms, which is not meaningfully cheaper than the \
         {:.1} ms full repaint it is supposed to avoid",
        cost::FULL_REPAINT_MS
    );
}

/// The verdict this whole exercise exists to produce: does the flourish fit the budget at
/// every frame, no matter where in the plausible range the per-window overhead sits?
#[test]
fn every_frame_fits_the_draw_budget_robustly() {
    let fl = f();
    for n in 0..TOTAL_FRAMES {
        let v = cost::verdict(&[fl.dirty(n)]);
        assert!(
            v.robust(),
            "frame {n} ({} px) costs up to {:.1} ms against a {:.1} ms budget",
            v.dirty_px,
            v.chosen_ms().1,
            cost::DRAW_BUDGET_MS
        );
    }
}

/// The flourish must depict a consequence. A hit animation that leaves the castle life
/// unchanged teaches the player that the flourish means nothing, which is worse than showing
/// no animation at all. The first version did exactly that and it took a render to notice.
#[test]
fn the_tick_actually_changes_the_life_it_depicts() {
    let fl = f();
    let snap = game::at_round(21, 5, 400).expect("seed 21");
    let before = snap.game.seats[1].castle.life;
    assert!(before >= fl.amount, "seed must have life left to lose");

    // Rendering is the only observable, so compare the frames themselves: the last rise frame
    // and the first tick frame must differ somewhere in the HUD band.
    let l = geom::vertical_asymmetric();
    let rise = panel::flourish_frame(&fl, &snap.game, View::Seat(0), &l, RISE_FRAMES - 1);
    let tick = panel::flourish_frame(
        &fl,
        &snap.game,
        View::Seat(0),
        &l,
        RISE_FRAMES + IMPACT_FRAMES,
    );
    assert_ne!(
        rise.to_ne_bytes(),
        tick.to_ne_bytes(),
        "the tick frame is identical to the rise frame - nothing changed"
    );

    // And the board handed to the renderer must genuinely carry the reduced life.
    let last = panel::flourish_frame(&fl, &snap.game, View::Seat(0), &l, TOTAL_FRAMES - 1);
    assert_ne!(
        rise.to_ne_bytes(),
        last.to_ne_bytes(),
        "the flourish ends on the same board it started - no damage was shown"
    );
}

/// The struck wall keeps its own faction colour. Painting it the attacker's hue reads as the
/// wall changing hands, which is a louder and different claim than "it was hit".
#[test]
fn the_struck_wall_is_not_recoloured_to_the_attacker() {
    let fl = f();
    let snap = game::at_round(21, 5, 400).expect("seed 21");
    let l = geom::vertical_asymmetric();
    // Seat 0 is Ember and the flourish is a Flare, so an attacker-coloured wall would be
    // Ember orange. Sample the shake frames' wall band and assert it is not that.
    let ember = pal::EMBER;
    for n in RISE_FRAMES + 1..RISE_FRAMES + IMPACT_FRAMES {
        let fr = panel::flourish_frame(&fl, &snap.game, View::Seat(0), &l, n);
        let px = fr.get_pixel(Point::new(160, geom::HUD + geom::WALL / 2));
        assert_ne!(
            (px.r(), px.g(), px.b()),
            (ember.r(), ember.g(), ember.b()),
            "frame {n} paints the enemy wall in the attacker's colour"
        );
    }
}

/// Crossing the panel vertically is affordable; doing the same thing cell-by-cell is not.
/// This is the counter-intuitive result the device table warns about, made concrete.
#[test]
fn one_window_per_frame_beats_per_cell_updates() {
    let fl = f();
    let one = cost::cost_ms(
        &[fl.dirty(0)],
        cost::Strategy::Windows,
        cost::WINDOW_SETUP_MS,
    );
    let per_cell: Vec<_> = (0..3)
        .map(|i| {
            Rectangle::new(
                Point::new(geom::lane_x(fl.lane), geom::CELL_BAND_TOP + i * 36),
                Size::new(geom::LANE_CROSS_V as u32, 36),
            )
        })
        .collect();
    let many = cost::cost_ms(&per_cell, cost::Strategy::Windows, cost::WINDOW_SETUP_MS);
    assert!(
        many > one * 2.0,
        "per-cell {many:.1} ms vs one window {one:.1} ms"
    );
}
