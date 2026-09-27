//! Banded rendering: does the renderer draw correctly into a strip?
//!
//! The firmware will not hand the renderer a full framebuffer. `BOARD.md`'s house rule for this
//! panel is strip-rasterise plus windowed contiguous writes, and the memory arithmetic forces it:
//! a band is `640 × rows` bytes against 96,676 B of free internal memory, so four bands is 38 KB
//! (40 %) and sixteen is 9.6 KB (10 %).
//!
//! # The oracle
//!
//! Rendering in N bands and compositing must produce a **byte-identical** image to rendering in
//! one pass, for every N and every screen. If a single pixel differs, something is being drawn
//! relative to the band rather than to the panel — which is the whole failure mode, and one that
//! a screenshot would hide because each band looks plausible on its own.
//!
//! This is the same shape as the golden replay in the firmware, and the same shape as the
//! byte-equality check that proved the `no_std` split behaviour-preserving: a fixture that was
//! produced by a different path than the code under test, so it can disagree.

use embedded_graphics::{pixelcolor::Rgb565, prelude::*, primitives::Rectangle};
use embedded_graphics_simulator::SimulatorDisplay;
use shrine_preview::battlefield::{Opts, View};
use shrine_preview::{flourish, game, geom, palette as pal, panel};
use tapstone_rules::state::Game;

type Panel = SimulatorDisplay<Rgb565>;

/// Something the renderer can draw, independent of the surface it draws onto.
///
/// A trait rather than a closure because Rust closures cannot be generic, and the whole point is
/// that the same drawing code runs against a full panel and against a strip.
trait Screen {
    fn draw<D: DrawTarget<Color = Rgb565>>(&self, d: &mut D);
}

struct Battlefield<'a> {
    game: &'a Game,
    view: View,
    layout: geom::Layout,
    opts: Opts<'a>,
}
impl Screen for Battlefield<'_> {
    fn draw<D: DrawTarget<Color = Rgb565>>(&self, d: &mut D) {
        shrine_render::battlefield::draw(d, self.game, self.view, &self.layout, &self.opts);
    }
}

struct FlourishFrame<'a> {
    fl: flourish::Flourish,
    game: &'a Game,
    layout: geom::Layout,
    frame: usize,
}
impl Screen for FlourishFrame<'_> {
    fn draw<D: DrawTarget<Color = Rgb565>>(&self, d: &mut D) {
        self.fl
            .draw_frame(d, self.game, View::Seat(0), &self.layout, self.frame);
    }
}

struct Idle;
impl Screen for Idle {
    fn draw<D: DrawTarget<Color = Rgb565>>(&self, d: &mut D) {
        shrine_render::screens::idle(d, "EMBER", pal::EMBER);
    }
}

struct Pairing;
impl Screen for Pairing {
    fn draw<D: DrawTarget<Color = Rgb565>>(&self, d: &mut D) {
        shrine_render::screens::pairing(d, "Verdant Reach (1 m)", 7, true);
    }
}

struct Setup<'a>(&'a Game);
impl Screen for Setup<'_> {
    fn draw<D: DrawTarget<Color = Rgb565>>(&self, d: &mut D) {
        shrine_render::screens::setup(d, self.0, 0, true);
    }
}

struct Result_<'a>(&'a Game, u8);
impl Screen for Result_<'_> {
    fn draw<D: DrawTarget<Color = Rgb565>>(&self, d: &mut D) {
        shrine_render::screens::result(d, self.0, 0, self.1, 11, "e3-fern");
    }
}

fn blank() -> Panel {
    let mut d: Panel = SimulatorDisplay::new(Size::new(geom::W as u32, geom::H as u32));
    let _ = Rectangle::new(Point::zero(), Size::new(geom::W as u32, geom::H as u32))
        .into_styled(embedded_graphics::primitives::PrimitiveStyle::with_fill(
            pal::BG,
        ))
        .draw(&mut d);
    d
}

/// Render in one pass, the way the preview does today.
fn whole<S: Screen>(s: &S) -> Panel {
    let mut d = blank();
    s.draw(&mut d);
    d
}

/// Render in `n` horizontal bands and composite them.
///
/// Each band gets its own small buffer and is drawn by translating the panel's coordinate space
/// so absolute coordinates land in the strip. This is what the firmware does: rasterise a strip
/// into internal SRAM, blit it, reuse the buffer.
fn banded<S: Screen>(s: &S, n: usize) -> Panel {
    // Band counts that do not divide 240 are allowed: the firmware picks its band height from a
    // memory budget, not from what divides the panel, so the last strip is short. Handling that
    // here is the difference between answering "is 16 bands safe" and "is any band count safe".
    let rows = (geom::H + n as i32 - 1) / n as i32;
    let mut out = blank();

    for b in 0..n {
        let y0 = b as i32 * rows;
        if y0 >= geom::H {
            break;
        }
        let rows = rows.min(geom::H - y0);
        // The strip buffer: 320 x rows, exactly what the firmware would allocate.
        let mut strip: Panel = SimulatorDisplay::new(Size::new(geom::W as u32, rows as u32));
        let _ = Rectangle::new(Point::zero(), Size::new(geom::W as u32, rows as u32))
            .into_styled(embedded_graphics::primitives::PrimitiveStyle::with_fill(
                pal::BG,
            ))
            .draw(&mut strip);

        // Shift the panel's coordinates into the strip, then draw the WHOLE screen. Anything
        // outside the strip is clipped by the target; anything inside must land where it would
        // have on a full panel.
        {
            let mut t = strip.translated(Point::new(0, -y0));
            s.draw(&mut t);
        }

        // Blit the strip into the composite.
        for y in 0..rows {
            for x in 0..geom::W {
                let c = strip.get_pixel(Point::new(x, y));
                let _ = Pixel(Point::new(x, y0 + y), c).draw(&mut out);
            }
        }
    }
    out
}

/// Every band count that divides 240 and is plausible for the memory budget.
///
/// 4 bands is 38 KB of 96,676 B free internal memory (40 %); 16 bands is 9.6 KB (10 %).
///
/// 7 and 9 are deliberately included: they do not divide 240, so the last strip is short. If the
/// renderer only worked for divisors, band count would be constrained by the renderer rather than
/// by memory, which is the question the firmware needs answered.
const BAND_COUNTS: [usize; 8] = [2, 4, 7, 8, 9, 12, 16, 24];

fn assert_identical<S: Screen>(s: &S, name: &str) {
    let one = whole(s).to_ne_bytes();
    for n in BAND_COUNTS {
        let many = banded(s, n).to_ne_bytes();
        if one != many {
            let diffs = one.iter().zip(many.iter()).filter(|(a, b)| a != b).count();
            panic!(
                "{name}: rendering in {n} bands differs from one pass in {diffs} bytes — \
                 something is drawn relative to the band rather than the panel"
            );
        }
    }
}

#[test]
fn the_battlefield_is_band_invariant() {
    let snap = game::at_round(21, 5, 400).expect("seed 21");
    for (tag, view) in [
        ("seat0", View::Seat(0)),
        ("seat1", View::Seat(1)),
        ("spectator", View::Spectator),
    ] {
        assert_identical(
            &Battlefield {
                game: &snap.game,
                view,
                layout: geom::vertical_asymmetric(),
                opts: Opts::default(),
            },
            &format!("battlefield {tag}"),
        );
    }
}

/// Every candidate layout, because band boundaries fall differently against each one's rows.
#[test]
fn every_layout_is_band_invariant() {
    let snap = game::at_round(21, 5, 400).expect("seed 21");
    for l in geom::all() {
        assert_identical(
            &Battlefield {
                game: &snap.game,
                view: View::Seat(0),
                layout: l,
                opts: Opts::default(),
            },
            l.name,
        );
    }
}

/// The battlefield's other states, since each draws extra bands of its own.
#[test]
fn battlefield_states_are_band_invariant() {
    let snap = game::at_round(21, 5, 400).expect("seed 21");
    let base = geom::vertical_asymmetric();
    let cases = [
        (
            "targeting",
            Opts {
                targeting: true,
                ..Default::default()
            },
        ),
        (
            "resolving",
            Opts {
                resolving: Some(1),
                ..Default::default()
            },
        ),
        (
            "sudden death",
            Opts {
                sudden_death: true,
                ..Default::default()
            },
        ),
        (
            "overlay",
            Opts {
                overlay: Some("rival lost - waiting 27s"),
                ..Default::default()
            },
        ),
    ];
    for (name, opts) in cases {
        assert_identical(
            &Battlefield {
                game: &snap.game,
                view: View::Seat(0),
                layout: base,
                opts,
            },
            name,
        );
    }
}

#[test]
fn the_standalone_screens_are_band_invariant() {
    let snap = game::at_round(21, 5, 400).expect("seed 21");
    let fin = game::final_state(21, 400).expect("final");
    assert_identical(&Idle, "idle");
    assert_identical(&Pairing, "pairing");
    assert_identical(&Setup(&snap.game), "setup");
    assert_identical(&Result_(&fin.game, fin.round), "result");
}

/// The flourish, whose whole point is that it moves across band boundaries.
#[test]
fn every_flourish_frame_is_band_invariant() {
    let snap = game::at_round(21, 5, 400).expect("seed 21");
    let fl = flourish::Flourish {
        lane: 1,
        design: 5,
        amount: 2,
    };
    for n in 0..flourish::TOTAL_FRAMES {
        assert_identical(
            &FlourishFrame {
                fl,
                game: &snap.game,
                layout: geom::vertical_asymmetric(),
                frame: n,
            },
            &format!("flourish frame {n}"),
        );
    }
}

/// The oracle must be able to fail. A screen drawn at a band-relative offset has to be caught,
/// or the whole suite above is decoration.
#[test]
fn the_oracle_detects_band_relative_drawing() {
    struct BandRelative;
    impl Screen for BandRelative {
        fn draw<D: DrawTarget<Color = Rgb565>>(&self, d: &mut D) {
            // The real failure mode: asking the TARGET where it is. On a full panel
            // `bounding_box()` is 320x240; on a strip it is 320xrows, so anything positioned
            // from it lands once per band instead of once per screen.
            //
            // Note what does NOT reproduce the bug: drawing at a fixed absolute point. Under
            // `translated()` that is corrected into the strip and clipped, so it behaves
            // identically either way - which is exactly why the first version of this control
            // passed and proved nothing.
            let bb = d.bounding_box();
            let _ = Rectangle::new(bb.top_left + Point::new(4, 4), Size::new(40, 12))
                .into_styled(embedded_graphics::primitives::PrimitiveStyle::with_fill(
                    pal::WARN,
                ))
                .draw(d);
        }
    }
    // In one pass this paints one box; in N bands it paints N, one per strip.
    let one = whole(&BandRelative).to_ne_bytes();
    let many = banded(&BandRelative, 4).to_ne_bytes();
    assert_ne!(
        one, many,
        "the oracle cannot see band-relative drawing, so it proves nothing about the rest"
    );
}

/// The composite path itself must be lossless, or a pass could be hiding a real difference.
#[test]
fn compositing_one_band_is_the_identity() {
    let snap = game::at_round(21, 5, 400).expect("seed 21");
    let s = Battlefield {
        game: &snap.game,
        view: View::Seat(0),
        layout: geom::vertical_asymmetric(),
        opts: Opts::default(),
    };
    assert_eq!(
        whole(&s).to_ne_bytes(),
        banded(&s, 1).to_ne_bytes(),
        "a single band must reproduce the one-pass render exactly"
    );
}

/// And the committed PNGs must still be what the one-pass path produces, so this test is anchored
/// to the images in the repo rather than only to itself.
#[test]
fn the_one_pass_render_still_matches_the_committed_png() {
    let snap = game::at_round(21, 5, 400).expect("seed 21");
    // The committed image was rendered by `shrine-preview all`, which supplies the previous
    // frame so arrival marks appear. Comparing against `Opts::default()` finds a 570-byte
    // difference that is the FRONT markers, not a regression - the first version of this test
    // did exactly that and accused the renderer.
    let prev = game::at_round(21, 4, 400).ok();
    let opts = Opts {
        prev: prev.as_ref().map(|s| &s.game),
        ..Default::default()
    };
    let p = panel::battlefield(
        &snap.game,
        View::Seat(0),
        &geom::vertical_asymmetric(),
        &opts,
    );
    let committed = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../preview/screens/04-battlefield.png"
    );
    let want = Panel::load_png(committed).expect("committed png loads");
    assert_eq!(
        p.to_ne_bytes(),
        want.to_ne_bytes(),
        "the renderer no longer reproduces the committed battlefield image"
    );
}
