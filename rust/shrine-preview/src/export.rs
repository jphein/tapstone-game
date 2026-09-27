//! PNG export.
//!
//! `embedded-graphics-simulator` is pulled in with `default-features = false`, which drops SDL2 —
//! the crate then builds and writes PNGs on a headless machine with nothing installed. Verified
//! before any of this was built on top of it.

use embedded_graphics_simulator::OutputSettingsBuilder;
use std::path::Path;

use crate::panel::Panel;

/// Write `panel` to `path`, creating parent directories.
///
/// `scale` is for looking at the result on a desktop monitor; the device is always 1. Exported
/// assets keep scale 1 so a pixel in the file is a pixel on the glass and nobody can mistake a
/// comfortable-looking 3x render for a legible 1x one.
pub fn save(panel: &Panel, path: &Path, scale: u32) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let settings = OutputSettingsBuilder::new().scale(scale.max(1)).build();
    panel
        .to_rgb_output_image(&settings)
        .save_png(path)
        .map_err(|e| format!("{}: {e}", path.display()))
}
