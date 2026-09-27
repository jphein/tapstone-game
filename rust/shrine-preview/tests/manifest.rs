//! The documented numbers must match the ones the code computes.
//!
//! `preview/MANIFEST.md` quotes per-frame costs, budget shares and dirty-pixel counts that were
//! copied by hand from `shrine-preview flourish-cost`. Nothing stopped the two drifting, and a
//! hand-copied number in a document is exactly what someone quotes later with no way to know it
//! was hand-copied — the phase 1 README's linked-size figure failed in precisely that way, and it
//! was only caught because someone re-ran the command.
//!
//! This closes the class: every figure below is recomputed and compared against the document.
//! If the model changes, the test names the stale line rather than leaving the document to be
//! believed.

use shrine_preview::{cost, flourish, geom};

fn manifest() -> String {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../../preview/MANIFEST.md");
    std::fs::read_to_string(p).unwrap_or_else(|e| panic!("{p}: {e}"))
}

/// Assert the document contains `needle`, with a message that says what it should have been.
fn documents(hay: &str, needle: &str, what: &str) {
    assert!(
        hay.contains(needle),
        "MANIFEST.md no longer documents {what} as {needle:?} — the code now says otherwise, so \
         one of the two is stale"
    );
}

/// The panel and budget constants the manifest quotes in prose.
#[test]
fn the_manifest_quotes_the_real_panel_constants() {
    let m = manifest();
    documents(&m, "320×240", "the panel size");
    assert_eq!(geom::W, 320);
    assert_eq!(geom::H, 240);

    // "28.6 ms" full repaint and "33.3 ms" draw budget.
    documents(
        &m,
        &format!("{:.1} ms", cost::FULL_REPAINT_MS),
        "the full repaint cost",
    );
    documents(
        &m,
        &format!("{:.1} ms", cost::DRAW_BUDGET_MS),
        "the draw budget",
    );
}

/// Every per-frame figure in the flourish cost table.
#[test]
fn the_flourish_cost_table_matches_the_code() {
    let m = manifest();
    let fl = flourish::Flourish {
        lane: 1,
        design: 5,
        amount: 2,
    };

    // Dirty-pixel counts, written with a thousands separator in the table.
    let mut seen = std::collections::BTreeSet::new();
    for n in 0..flourish::TOTAL_FRAMES {
        let r = fl.dirty(n);
        seen.insert(r.size.width * r.size.height);
    }
    assert_eq!(
        seen.len(),
        3,
        "the table has three distinct dirty-pixel rows; the code now produces {}",
        seen.len()
    );
    for px in &seen {
        let with_sep = format!("{},{:03}", px / 1000, px % 1000);
        documents(&m, &with_sep, "a dirty-pixel count");
    }

    // The worst frame, and the share of budget it spends.
    let worst = (0..flourish::TOTAL_FRAMES)
        .map(|n| cost::verdict(&[fl.dirty(n)]).chosen_ms().1)
        .fold(0.0f32, f32::max);
    documents(&m, &format!("{worst:.1} ms"), "the worst frame cost");
    let share = (100.0 * worst / cost::DRAW_BUDGET_MS).round() as i32;
    documents(&m, &format!("{share} %"), "the share of budget spent");
    documents(&m, &format!("{} %", 100 - share), "the headroom left");
}

/// The lane-versus-per-row comparison, which is the firmware-shaping result.
#[test]
fn the_lane_window_table_matches_the_code() {
    let m = manifest();
    let col = cost::lane_column();
    let rows = cost::lane_column_by_rows::<6>();

    let px = col.size.width * col.size.height;
    documents(
        &m,
        &format!("{},{:03}", px / 1000, px % 1000),
        "the lane column pixel count",
    );

    let col_lo = cost::cost_ms(&[col], cost::Strategy::Windows, cost::SETUP_RANGE_MS.0);
    let col_hi = cost::cost_ms(&[col], cost::Strategy::Windows, cost::SETUP_RANGE_MS.1);
    documents(
        &m,
        &format!("{col_lo:.1} – {col_hi:.1} ms"),
        "the lane column cost",
    );

    let rows_hi = cost::cost_ms(&rows, cost::Strategy::Windows, cost::SETUP_RANGE_MS.1);
    let rows_share = (100.0 * rows_hi / cost::DRAW_BUDGET_MS).round() as i32;
    let col_share = (100.0 * col_hi / cost::DRAW_BUDGET_MS).round() as i32;
    documents(
        &m,
        &format!("{rows_share} %"),
        "the per-row share of budget",
    );
    documents(
        &m,
        &format!("{col_share} %"),
        "the lane column share of budget",
    );
}

/// The manifest states which seed and round produced the images; it must be one the sim can reach.
#[test]
fn the_documented_state_is_reproducible() {
    let m = manifest();
    documents(&m, "seed = 21", "the seed");
    documents(&m, "round 5", "the round");
    let snap = shrine_preview::game::at_round(21, 5, 400).expect("seed 21 must replay");
    assert_eq!(snap.round, 5, "seed 21 no longer reaches round 5");
    let units: usize = snap.game.seats.iter().map(|s| s.units()).sum();
    documents(&m, &format!("{units} units"), "the unit count");
}
