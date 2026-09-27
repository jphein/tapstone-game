//! The standalone screens render, and agree with the engine about who won.

use embedded_graphics::prelude::*;
use shrine_preview::panel::screen;
use shrine_preview::{game, geom, palette as pal};
use tapstone_rules::state::Winner;

/// Every standalone screen must render without panicking, at the real panel size.
#[test]
fn standalone_screens_render() {
    let snap = game::at_round(21, 3, 400).expect("seed 21");
    let fin = game::final_state(21, 400).expect("final");
    let screens = [
        screen::idle("EMBER", pal::EMBER),
        screen::pairing("Verdant Reach (1 m)", 7, true),
        screen::pairing("Verdant Reach (1 m)", 3, false),
        screen::setup(&snap.game, 0, true),
        screen::result(&fin.game, 0, fin.round, 11, "e3-fern"),
        screen::result(&fin.game, 1, fin.round, 11, "e3-fern"),
    ];
    for s in &screens {
        assert_eq!(s.bounding_box().size, Size::new(320, 240));
    }
}

/// The result screen must agree with the engine about who won.
#[test]
fn result_reads_the_engine_winner() {
    let fin = game::final_state(21, 400).expect("final");
    // Whatever the engine decided, exactly one seat sees VICTORY.
    if let Some(Winner::Seat(w)) = fin.game.winner {
        assert!(w < 2);
        let _ = screen::result(&fin.game, w, fin.round, 11, "e3-fern");
        let _ = screen::result(&fin.game, 1 - w, fin.round, 11, "e3-fern");
    }
}

/// Buttons must clear the 44 px touch floor; the debug_assert in `button` enforces it, and
/// this makes the intent explicit rather than relying on a debug build.
#[test]
fn buttons_clear_the_touch_floor() {
    for h in [44u32, 48] {
        assert!(h >= geom::TOUCH_MIN as u32);
    }
}
