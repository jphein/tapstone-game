//! PNG export produces a real device-sized frame.

use shrine_preview::battlefield::{Opts, View};
use shrine_preview::{export, game, geom, panel};

/// Export must produce a 320×240 PNG at scale 1, so a pixel in the file is a pixel on the glass.
#[test]
fn writes_a_320x240_png() {
    let snap = game::at_round(21, 5, 400).expect("seed 21");
    let p = panel::battlefield(
        &snap.game,
        View::Seat(0),
        &geom::vertical_asymmetric(),
        &Opts::default(),
    );
    let dir = std::env::temp_dir().join("shrine-preview-export-test");
    let path = dir.join("bf.png");
    export::save(&p, &path, 1).expect("png written");

    let bytes = std::fs::read(&path).expect("read back");
    assert_eq!(&bytes[1..4], b"PNG", "not a PNG");
    let w = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let h = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    assert_eq!((w, h), (geom::W as u32, geom::H as u32));
    let _ = std::fs::remove_dir_all(&dir);
}
