//! The voice-clip manifest (0033): complete, one-source, and committed.

use shrine_preview::clips::{self, Kind};
use shrine_render::battlefield::fit;
use shrine_render::voice::{self, VOICE_VARIANTS, Voice};
use tapstone_rules::HouseRules;
use tapstone_rules::cards::{CardKind, SET1};

fn committed() -> String {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../../game/voice/clips.tsv");
    std::fs::read_to_string(p).unwrap_or_else(|e| panic!("{p}: {e}"))
}

/// Every Voice variant has at least one entry.
#[test]
fn every_voice_variant_has_a_clip() {
    let e = clips::entries();
    assert_eq!(
        clips::missing(&e),
        Vec::<usize>::new(),
        "variants with no clip"
    );
}

/// Control: the coverage check sees a missing variant. Drop one variant's entries and it must be
/// reported — for every variant, so no single blind spot can hide.
#[test]
fn control_a_planted_missing_variant_is_caught() {
    let all = clips::entries();
    for idx in 0..VOICE_VARIANTS {
        let without: Vec<_> = all
            .iter()
            .filter(|e| e.voice.index() != idx)
            .cloned()
            .collect();
        assert_eq!(
            clips::missing(&without),
            vec![idx],
            "dropping variant {idx} went unnoticed"
        );
    }
}

/// Every clip's text is what the band renders for that state: the same function, and the band
/// shows it whole (`fit` leaves it untouched), in the ASCII the font can draw.
#[test]
fn every_clip_is_what_the_band_shows() {
    for e in clips::entries() {
        assert_eq!(e.text, e.voice.text().as_str(), "{}", e.key);
        if e.kind == Kind::Clip {
            assert_eq!(
                fit(&e.text, voice::budget_chars()).as_str(),
                e.text,
                "{} is truncated on the band",
                e.key
            );
            assert!(e.text.is_ascii() && !e.text.is_empty(), "{}", e.key);
        }
    }
}

/// Keys are unique, so a clip file can be named by its key.
#[test]
fn keys_are_unique() {
    let mut seen = std::collections::BTreeSet::new();
    for e in clips::entries() {
        assert!(seen.insert(e.key.clone()), "duplicate key {}", e.key);
    }
}

/// Only STT output is streamed, and only silence is silent: everything the shrine chooses to say
/// is a pre-rendered clip (0033).
#[test]
fn only_dynamic_text_is_streamed() {
    for e in clips::entries() {
        match e.kind {
            Kind::Streamed => assert!(e.voice.is_dynamic(), "{}", e.key),
            Kind::Silent => assert_eq!(e.voice, Voice::Silent),
            Kind::Clip => assert!(!e.voice.is_dynamic(), "{}", e.key),
        }
    }
}

/// Slots come from the data, not from typed lists: counts follow the card table and the rules.
#[test]
fn slot_expansions_follow_the_data() {
    let e = clips::entries();
    let count = |v: &str| e.iter().filter(|x| x.variant == v).count();
    let rules = HouseRules::default();
    let castles = SET1
        .iter()
        .filter(|d| matches!(d.kind, CardKind::Castle))
        .count();
    let deck = SET1
        .iter()
        .filter(|d| !matches!(d.kind, CardKind::Castle))
        .count();
    let units = SET1
        .iter()
        .filter(|d| matches!(d.kind, CardKind::Unit { .. }))
        .count();
    assert_eq!(count("castle_at"), castles * rules.castle_life as usize);
    assert_eq!(count("cast_or_charge"), deck);
    assert_eq!(count("lane"), units);
    assert_eq!(count("drew"), deck * clips::max_owed(&rules) as usize);
}

/// The committed file is exactly what the code produces; a stale manifest names itself.
#[test]
fn the_committed_manifest_is_current() {
    assert!(
        clips::is_current(&committed(), &clips::tsv(&clips::entries())),
        "game/voice/clips.tsv is stale: run `cargo run -p shrine-preview -- clips`"
    );
}

/// Control: the real check (`is_current`) rejects the committed file with one word changed.
#[test]
fn control_a_stale_manifest_is_detected() {
    let stale = committed().replacen(
        "set your castle on the stone",
        "set your castle on a stone",
        1,
    );
    assert_ne!(
        stale,
        committed(),
        "the planted edit did not change the file"
    );
    assert!(!clips::is_current(&stale, &clips::tsv(&clips::entries())));
}

/// The lead's battery ruling: the manifest's battery clips are exactly the thresholds.
#[test]
fn battery_clips_are_exactly_the_thresholds() {
    use shrine_render::voice::{BATTERY_THRESHOLDS, Dark};
    let mut got: Vec<u8> = clips::entries()
        .iter()
        .filter_map(|e| match e.voice {
            Voice::Dark(Dark::BatteryLow { pct }) => Some(pct),
            _ => None,
        })
        .collect();
    got.sort_unstable();
    let mut want = BATTERY_THRESHOLDS.to_vec();
    want.sort_unstable();
    assert_eq!(got, want);
}

/// Each threshold speaks once per crossing, the most urgent one when several are crossed at once,
/// and charging back above a threshold lets it speak again.
#[test]
fn the_battery_speaks_once_per_crossing_and_resets_on_charge() {
    use shrine_render::voice::BatteryAnnouncer;
    let mut b = BatteryAnnouncer::default();
    let said: Vec<_> = [30, 20, 19, 15, 10, 9, 5, 4, 3]
        .iter()
        .map(|p| b.update(*p))
        .collect();
    assert_eq!(
        said,
        [
            None,
            Some(20),
            None,
            None,
            Some(10),
            None,
            Some(5),
            None,
            None
        ]
    );
    // Control: the same levels a second time say nothing (no repetition while below).
    assert_eq!(b.update(4), None);
    // A drop straight past every threshold says only the most urgent.
    let mut jump = BatteryAnnouncer::default();
    assert_eq!(jump.update(4), Some(5));
    assert_eq!(jump.update(4), None);
    // Charging resets: back above 20, then down again, speaks 20 again.
    assert_eq!(jump.update(40), None);
    assert_eq!(jump.update(20), Some(20));
}

/// Hysteresis (the lead's call): ADC jitter across a threshold speaks it once. Control: the same
/// jitter with no hysteresis repeats "battery 20%" on every dip.
#[test]
fn battery_jitter_does_not_repeat_the_announcement() {
    use shrine_render::voice::{BATTERY_REARM_PCT, BatteryAnnouncer};
    let jitter = [22u8, 20, 21, 20, 21, 20, 21, 20];
    let spoken =
        |mut b: BatteryAnnouncer| jitter.iter().filter(|p| b.update(**p) == Some(20)).count();
    assert_eq!(
        spoken(BatteryAnnouncer::default()),
        1,
        "jitter repeated the announcement"
    );
    assert_eq!(
        spoken(BatteryAnnouncer::with_rearm(1)),
        4,
        "control: no hysteresis must repeat"
    );
    // Re-arming needs the full margin: 20 + 2.
    let mut b = BatteryAnnouncer::default();
    assert_eq!(b.update(20), Some(20));
    assert_eq!(b.update(20 + BATTERY_REARM_PCT - 1), None);
    assert_eq!(b.update(20), None, "one point above is not a re-arm");
    assert_eq!(b.update(20 + BATTERY_REARM_PCT), None);
    assert_eq!(b.update(20), Some(20), "the full margin re-arms");
}
