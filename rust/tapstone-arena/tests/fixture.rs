//! The canvas fixtures (web/fixtures/desk-seed11.jsonl, #82, and desk-seed1.jsonl, a match with
//! neutral casts for the tea house doors, #131) are what the engine produces TODAY. A
//! fixture recorded before a view change freezes the old behaviour into every replay: the first
//! one captioned 23 Advances "Ember Castle" after #81 fixed that. So the committed file is checked
//! against a fresh deterministic recording (simulated clock, fixed epoch): the is-current pattern.
use tapstone_arena::link::desk::record_desk_match;

const FIXTURE: &str = include_str!("../web/fixtures/desk-seed11.jsonl");
const NEUTRAL_FIXTURE: &str = include_str!("../web/fixtures/desk-seed1.jsonl");

/// `Ok` when the committed fixture is exactly a fresh recording, else the first differing line.
fn check(committed: &str, fresh: &[String]) -> Result<(), String> {
    let lines: Vec<&str> = committed.lines().collect();
    if lines.len() != fresh.len() {
        return Err(format!(
            "{} lines committed, {} recorded",
            lines.len(),
            fresh.len()
        ));
    }
    match lines.iter().zip(fresh).position(|(a, b)| *a != b.as_str()) {
        Some(i) => Err(format!("line {} differs", i + 1)),
        None => Ok(()),
    }
}

#[test]
fn the_canvas_fixture_is_current() {
    let fresh = record_desk_match(11);
    if let Err(e) = check(FIXTURE, &fresh) {
        panic!(
            "web/fixtures/desk-seed11.jsonl is stale ({e}). Regenerate it: \
             cargo test -p tapstone-arena --test fixture -- --ignored regenerate_the_fixture"
        );
    }
}

#[test]
fn the_neutral_casts_fixture_is_current() {
    let fresh = record_desk_match(1);
    if let Err(e) = check(NEUTRAL_FIXTURE, &fresh) {
        panic!(
            "web/fixtures/desk-seed1.jsonl is stale ({e}). Regenerate it: \
             cargo test -p tapstone-arena --test fixture -- --ignored regenerate_the_fixture"
        );
    }
    // What it's for: the tea house doors need a real neutral cast to see (Mend or Deep Breath).
    let neutral = fresh
        .iter()
        .filter(|l| {
            l.contains(r#""kind":"CastSpell","card":"Mend""#)
                || l.contains(r#""kind":"CastSpell","card":"Deep Breath""#)
        })
        .count();
    assert!(neutral >= 1, "seed 1 no longer casts a neutral card");
}

/// The stale control: a fixture one view behind today's is caught, so the check above can fail.
#[test]
fn a_stale_fixture_is_caught() {
    let fresh = record_desk_match(11);
    let mut stale: Vec<String> = fresh.clone();
    stale[10] = stale[10].replace("\"round\":", "\"round\":9");
    assert!(
        check(&stale.join("\n"), &fresh).is_err(),
        "a changed view went unseen"
    );
    assert!(
        check(&fresh[..fresh.len() - 1].join("\n"), &fresh).is_err(),
        "a missing view went unseen"
    );
    assert!(
        check(&fresh.join("\n"), &fresh).is_ok(),
        "the fresh recording is current"
    );
}

/// The recipe: rewrite the fixture from today's engine. Read the diff before committing.
#[test]
#[ignore = "rewrites web/fixtures/desk-seed11.jsonl and desk-seed1.jsonl"]
fn regenerate_the_fixture() {
    for seed in [11, 1] {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("web/fixtures/desk-seed{seed}.jsonl"));
        let body: String = record_desk_match(seed)
            .iter()
            .map(|l| format!("{l}\n"))
            .collect();
        std::fs::write(path, body).expect("write the fixture");
    }
}
