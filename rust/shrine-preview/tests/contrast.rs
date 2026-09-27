//! The palette's legibility invariants, checked on the host.
//!
//! Lives here rather than in `shrine-render` because it needs `powf`, which is std-only, and a
//! firmware crate should not carry float math for a design-time assertion it never evaluates at
//! runtime. The constants come from the renderer; only the arithmetic is local.

use embedded_graphics::pixelcolor::Rgb565;
use embedded_graphics::prelude::RgbColor;
use shrine_preview::palette::*;

/// Relative luminance, WCAG 2.x, from the quantised Rgb565 the panel will actually light.
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

/// The finding that produced the dark well: every foreground the HUD uses is illegible on every
/// tinted band. `HEALTH_MID` on `WARM` measures 1.13:1 — the castle life vanishes exactly in
/// sudden death, when it is checked every turn, on the active player's own band.
///
/// Asserted rather than fixed-and-forgotten so re-tinting a band, or adding a faction hue, cannot
/// quietly reintroduce it.
#[test]
fn readouts_are_illegible_directly_on_a_tinted_band() {
    for tint in [EMBER, TIDE, WARM] {
        for fg in [HEALTH_OK, HEALTH_MID, HEALTH_LOW, TEXT] {
            let c = contrast(fg, tint);
            assert!(
                c < MIN_CONTRAST,
                "a readout now clears {MIN_CONTRAST}:1 on a tint at {c:.2}:1 — if a colour \
                 changed, the dark well may no longer be needed"
            );
        }
    }
}

/// The fix: readouts sit in a `PANEL` well, and the well is legible on every band.
#[test]
fn the_dark_well_is_legible_on_every_band() {
    for tint in BAND_TINTS {
        if tint == PANEL {
            continue;
        }
        assert!(
            contrast(PANEL, tint) >= MIN_CONTRAST,
            "the well must stand off its band"
        );
    }
    for fg in [HEALTH_OK, HEALTH_MID, HEALTH_LOW, TEXT] {
        assert!(
            contrast(fg, PANEL) >= MIN_CONTRAST,
            "every readout must be legible inside the well"
        );
    }
}

/// The worst case is worth naming, because it is the one that motivated the change.
#[test]
fn health_mid_on_sudden_death_gold_is_the_worst_case() {
    let c = contrast(HEALTH_MID, WARM);
    assert!(
        c < 1.2,
        "HEALTH_MID on WARM measured {c:.2}:1; it was 1.13:1 when the dark well was introduced"
    );
}
