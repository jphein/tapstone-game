//! A host framebuffer for the renderer to draw into.

use embedded_graphics::{pixelcolor::Rgb565, prelude::*, primitives::Rectangle};
use embedded_graphics_simulator::SimulatorDisplay;
use tapstone_rules::state::Game;

use shrine_render::battlefield::{Opts, View};
use shrine_render::flourish::Flourish;
use shrine_render::geom::{self, Layout};
use shrine_render::palette as pal;

/// A 320×240 RGB565 surface, the same geometry as the panel.
pub type Panel = SimulatorDisplay<Rgb565>;

/// A blank panel at the device's real size.
pub fn blank() -> Panel {
    let mut d: Panel = SimulatorDisplay::new(Size::new(geom::W as u32, geom::H as u32));
    let _ = Rectangle::new(Point::zero(), Size::new(geom::W as u32, geom::H as u32))
        .into_styled(embedded_graphics::primitives::PrimitiveStyle::with_fill(
            pal::BG,
        ))
        .draw(&mut d);
    d
}

/// Draw the battlefield onto a fresh panel.
pub fn battlefield(game: &Game, view: View, layout: &Layout, opts: &Opts<'_>) -> Panel {
    let mut d = blank();
    shrine_render::battlefield::draw(&mut d, game, view, layout, opts);
    d
}

/// Draw one flourish frame onto a fresh panel.
pub fn flourish_frame(
    fl: &Flourish,
    game: &Game,
    view: View,
    layout: &Layout,
    frame: usize,
) -> Panel {
    let mut d = blank();
    fl.draw_frame(&mut d, game, view, layout, frame);
    d
}

/// Screen adapters: each creates a panel, draws one screen into it, and returns it.
///
/// The renderer's own entry points take `&mut D` because firmware owns its framebuffer. These
/// wrappers exist only so the preview CLI can treat a screen as a value.
pub mod screen {
    use super::{Panel, blank};
    use embedded_graphics::pixelcolor::Rgb565;
    use tapstone_rules::state::Game;

    pub fn idle(faction_name: &str, accent: Rgb565) -> Panel {
        let mut d = blank();
        shrine_render::screens::idle(&mut d, faction_name, accent);
        d
    }
    pub fn pairing(rival: &str, rssi: u8, ruleset_ok: bool) -> Panel {
        let mut d = blank();
        shrine_render::screens::pairing(&mut d, rival, rssi, ruleset_ok);
        d
    }
    pub fn setup(game: &Game, near: u8, they_ready: bool) -> Panel {
        let mut d = blank();
        shrine_render::screens::setup(&mut d, game, near, they_ready);
        d
    }
    pub fn result(game: &Game, near: u8, rounds: u8, taps: usize, sigil: &str) -> Panel {
        let mut d = blank();
        shrine_render::screens::result(&mut d, game, near, rounds, taps, sigil);
        d
    }
}
