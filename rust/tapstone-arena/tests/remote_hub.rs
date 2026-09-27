//! The remote seat's state (spec §2): join codes, the wrong-code throttle, match-scoped tokens, numbered views
//! and the numbered menu. Pure: no HTTP.
use rand::SeedableRng;
use rand::rngs::StdRng;
use tapstone_arena::link::remote::MenuItem;
use tapstone_arena::remote::{CODE_ALPHABET, Hub, JoinError, ProposeError, VIEWS_KEPT};
use tapstone_rules::{Kind, Record};

fn hub() -> Hub {
    Hub::new(StdRng::seed_from_u64(7))
}

/// A code guaranteed not to be the hub's.
fn wrong(h: &Hub) -> &'static str {
    if h.code() == "AAAAAA" {
        "BBBBBB"
    } else {
        "AAAAAA"
    }
}

fn item(key: &str) -> MenuItem {
    MenuItem {
        key: key.into(),
        label: key.into(),
        kind: "Pass".into(),
        useful: true,
    }
}

fn pass() -> Record {
    tapstone_sim::tap(1, Kind::Pass, 0, -1, 0, 0)
}

#[test]
fn a_code_is_six_unambiguous_characters() {
    let h = hub();
    assert_eq!(h.code().len(), 6);
    assert!(h.code().bytes().all(|b| CODE_ALPHABET.contains(&b)));
    for b in *b"0O1I" {
        assert!(!CODE_ALPHABET.contains(&b), "{} is ambiguous", b as char);
    }
}

#[test]
fn the_right_code_gives_one_token_and_a_second_join_is_refused() {
    let mut h = hub();
    let code = h.code().to_string();
    let token = h.join(&code).unwrap();
    assert_eq!(token.len(), 32);
    assert!(
        token
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    );
    assert!(h.joined());
    assert!(h.authorized(&token));
    assert!(!h.authorized(&"0".repeat(32)));
    assert_eq!(h.join(&code), Err(JoinError::Taken));
}

#[test]
fn a_wrong_code_is_refused() {
    let mut h = hub();
    let w = wrong(&h);
    assert_eq!(h.join(w), Err(JoinError::Wrong));
    assert!(!h.joined());
}

/// Ten wrong codes throttle their source (tests/remote_throttle.rs has the rest: other sources,
/// the backoff, the cap).
#[test]
fn ten_wrong_codes_throttle_their_source_until_it_waits_or_the_next_match() {
    let mut h = hub();
    let code = h.code().to_string();
    let w = wrong(&h);
    for _ in 0..10 {
        assert_eq!(h.join(w), Err(JoinError::Wrong));
    }
    assert!(
        matches!(h.join(&code), Err(JoinError::Throttled(_))),
        "the right code after ten wrong ones, from the same source"
    );
    h.new_match();
    let code = h.code().to_string();
    assert!(h.join(&code).is_ok(), "the strikes last one match");
}

/// The control: nine wrong codes are not a wait.
#[test]
fn nine_wrong_codes_do_not_lock() {
    let mut h = hub();
    let code = h.code().to_string();
    let w = wrong(&h);
    for _ in 0..9 {
        assert_eq!(h.join(w), Err(JoinError::Wrong));
    }
    assert!(h.join(&code).is_ok());
}

#[test]
fn a_token_dies_with_its_match() {
    let mut h = hub();
    let code = h.code().to_string();
    let token = h.join(&code).unwrap();
    h.new_match();
    assert!(!h.authorized(&token), "a token from the previous match");
    assert!(!h.joined());
    assert!(
        h.may_view(&token),
        "the old token can still read the final board"
    );
    let code = h.code().to_string();
    h.join(&code).unwrap();
    assert!(
        !h.may_view(&token),
        "the next join retires the old token entirely"
    );
}

#[test]
fn views_are_numbered_without_gaps_or_repeats() {
    let mut h = hub();
    for i in 0..5 {
        assert_eq!(h.publish_view(&format!(r#"{{"i":{i}}}"#)), i + 1);
    }
    let (mut after, mut seen) = (0, Vec::new());
    while let Some((n, v)) = h.view_after(after) {
        seen.push((n, v.to_string()));
        after = n;
    }
    assert_eq!(
        seen.iter().map(|s| s.0).collect::<Vec<_>>(),
        vec![1, 2, 3, 4, 5]
    );
    assert_eq!(seen[2].1, r#"{"i":2}"#);
    assert!(h.view_after(5).is_none());
}

#[test]
fn a_poller_far_behind_gets_the_oldest_view_kept() {
    let mut h = hub();
    for i in 0..(VIEWS_KEPT as u64 + 88) {
        h.publish_view(&format!("{i}"));
    }
    assert_eq!(h.view_after(0).unwrap().0, 89);
}

#[test]
fn an_unchanged_menu_keeps_its_number() {
    let mut h = hub();
    h.set_menu(vec![item("p")], vec![pass()]);
    let n = h.menu().0;
    h.set_menu(vec![item("p")], vec![pass()]);
    assert_eq!(h.menu().0, n);
    h.set_menu(vec![item("q")], vec![pass()]);
    assert_eq!(h.menu().0, n + 1);
}

#[test]
fn a_stale_menu_is_refused_and_a_spent_one_cannot_replay() {
    let mut h = hub();
    h.set_menu(vec![item("p")], vec![pass()]);
    let n = h.menu().0;
    assert_eq!(h.take(n + 1, 0), Err(ProposeError::Stale));
    assert_eq!(h.take(n, 1), Err(ProposeError::BadIndex));
    assert_eq!(h.take(n, 0), Ok(pass()));
    assert_eq!(
        h.take(n, 0),
        Err(ProposeError::Stale),
        "a spent menu was taken twice"
    );
    assert!(h.menu().1.is_empty());
}

/// The arena seat the remote shrine holds (spec §2 "seat", in join and choices): unknown until its
/// claim lands, and unknown again once the match is over.
#[test]
fn the_seat_is_null_until_the_claim_lands() {
    let mut h = hub();
    assert_eq!(h.seat(), None);
    h.set_seat(Some(1));
    assert_eq!(h.seat(), Some(1));
    h.new_match();
    assert_eq!(h.seat(), None, "a finished match's seat outlived it");
}
