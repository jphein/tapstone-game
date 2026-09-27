//! Wrong join codes are throttled per source, never for the whole table (0038, amended
//! 2026-09-27). The prototype locked joining for everyone after ten wrong codes, so anyone holding
//! the tunnel URL could lock the real seats out until the next match. Pure: no HTTP.
use std::net::IpAddr;
use std::time::{Duration, Instant};

use rand::SeedableRng;
use rand::rngs::StdRng;
use tapstone_arena::remote::{BACKOFF_CAP, FREE_WRONG, Hub, JoinError, SOURCES_KEPT, source_key};

fn hub(slots: usize) -> Hub {
    Hub::with_slots(StdRng::seed_from_u64(11), slots)
}

/// A code guaranteed to be no slot's.
fn wrong(h: &Hub) -> String {
    let codes: Vec<&str> = (0..h.slots()).map(|s| h.code_of(s)).collect();
    ["AAAAAA", "BBBBBB", "CCCCCC"]
        .into_iter()
        .find(|c| !codes.contains(c))
        .unwrap()
        .to_string()
}

fn secs(s: f64) -> Duration {
    Duration::from_secs_f64(s)
}

/// The defect itself: a URL-holder hammering wrong codes, then the real seats joining.
#[test]
fn one_sources_wrong_codes_never_refuse_another_sources_right_code() {
    let mut h = hub(2);
    let t0 = Instant::now();
    let w = wrong(&h);
    let mut evaluated = 0;
    for i in 0..10_000u32 {
        // ten a second for 1000 s: far past any budget the table used to have
        match h.redeem_from("troll", &w, t0 + secs(f64::from(i) / 10.0)) {
            Err(JoinError::Wrong) => evaluated += 1,
            Err(JoinError::Throttled(_)) => {}
            other => panic!("{other:?}"),
        }
    }
    // the floor: the troll really was evaluated past the free budget, then really throttled
    assert!(
        evaluated > FREE_WRONG as usize && evaluated < 100,
        "{evaluated} evaluated"
    );
    let now = t0 + secs(1000.0);
    for (s, seat) in [(0, "roblox-server"), (1, "another-server")] {
        let c = h.code_of(s).to_string();
        assert_eq!(
            h.redeem_from(seat, &c, now).map(|j| j.slot),
            Ok(s),
            "slot {s}"
        );
    }
}

#[test]
fn a_source_gets_ten_wrong_codes_then_waits_and_is_not_evaluated_meanwhile() {
    let mut h = hub(1);
    let t0 = Instant::now();
    let (w, code) = (wrong(&h), h.code().to_string());
    for _ in 0..FREE_WRONG {
        assert_eq!(h.redeem_from("a", &w, t0), Err(JoinError::Wrong));
    }
    assert_eq!(
        h.redeem_from("a", &w, t0),
        Err(JoinError::Throttled(secs(1.0)))
    );
    // while it waits, even the right code is not looked at: the wait is what bounds guessing
    assert_eq!(
        h.redeem_from("a", &code, t0 + secs(0.5)),
        Err(JoinError::Throttled(secs(0.5)))
    );
    assert!(!h.joined());
    // waiting out the backoff, the right code joins; the throttled tries didn't extend it
    assert!(h.redeem_from("a", &code, t0 + secs(1.0)).is_ok());
}

/// The control: nine wrong codes are not a wait.
#[test]
fn nine_wrong_codes_do_not_throttle() {
    let mut h = hub(1);
    let t0 = Instant::now();
    let (w, code) = (wrong(&h), h.code().to_string());
    for _ in 0..FREE_WRONG - 1 {
        assert_eq!(h.redeem_from("a", &w, t0), Err(JoinError::Wrong));
    }
    assert!(h.redeem_from("a", &code, t0).is_ok());
}

#[test]
fn the_wait_doubles_per_wrong_code_and_caps() {
    let mut h = hub(1);
    let mut t = Instant::now();
    let w = wrong(&h);
    for _ in 0..FREE_WRONG - 1 {
        assert_eq!(h.redeem_from("a", &w, t), Err(JoinError::Wrong));
    }
    let mut waits = Vec::new();
    for _ in 0..9 {
        assert_eq!(h.redeem_from("a", &w, t), Err(JoinError::Wrong));
        let Err(JoinError::Throttled(d)) = h.redeem_from("a", &w, t) else {
            panic!("not throttled after a wrong code past the budget");
        };
        waits.push(d.as_secs());
        t += d;
    }
    assert_eq!(waits, [1, 2, 4, 8, 16, 32, 60, 60, 60]);
    assert_eq!(BACKOFF_CAP, secs(60.0));
}

#[test]
fn a_new_match_clears_every_sources_strikes() {
    let mut h = hub(1);
    let t0 = Instant::now();
    let w = wrong(&h);
    for _ in 0..FREE_WRONG {
        assert_eq!(h.redeem_from("a", &w, t0), Err(JoinError::Wrong));
    }
    h.new_match();
    let code = h.code().to_string();
    assert!(h.redeem_from("a", &code, t0).is_ok());
}

/// Memory is bounded: past SOURCES_KEPT, new wrong-guessers share one record (and its wait),
/// while a source that has never sent a wrong code is still evaluated at once.
#[test]
fn sources_past_the_cap_share_one_record() {
    let mut h = hub(2);
    let t0 = Instant::now();
    let w = wrong(&h);
    for i in 0..SOURCES_KEPT {
        assert_eq!(
            h.redeem_from(&format!("s{i}"), &w, t0),
            Err(JoinError::Wrong)
        );
    }
    assert_eq!(h.sources_kept(), SOURCES_KEPT);
    for i in 0..FREE_WRONG {
        assert_eq!(
            h.redeem_from(&format!("late{i}"), &w, t0),
            Err(JoinError::Wrong)
        );
    }
    assert!(matches!(
        h.redeem_from("late-next", &w, t0),
        Err(JoinError::Throttled(_))
    ));
    assert_eq!(
        h.sources_kept(),
        SOURCES_KEPT + 1,
        "the cap plus the shared record"
    );
    // a kept source with one strike is unaffected
    let c = h.code_of(0).to_string();
    assert!(h.redeem_from("s0", &c, t0).is_ok());
}

fn ip(s: &str) -> Option<IpAddr> {
    Some(s.parse().unwrap())
}

#[test]
fn the_source_is_cloudflares_client_address_only_behind_a_loopback_peer() {
    // a tunnel's requests come from cloudflared on loopback, carrying the client's address
    assert_eq!(
        source_key(ip("127.0.0.1"), Some("203.0.113.9")),
        "203.0.113.9"
    );
    assert_eq!(source_key(ip("::1"), Some("203.0.113.9")), "203.0.113.9");
    // any other peer is its own source: a header it sends is its own claim, ignored
    assert_eq!(
        source_key(ip("192.0.2.20"), Some("203.0.113.9")),
        "192.0.2.20"
    );
    // a header that isn't an address is ignored
    assert_eq!(source_key(ip("127.0.0.1"), Some("x, y")), "127.0.0.1");
    assert_eq!(source_key(ip("127.0.0.1"), None), "127.0.0.1");
    assert_eq!(source_key(None, None), "local");
    // IPv6 clients are keyed by their /64: one host holds a whole /64
    assert_eq!(
        source_key(ip("::1"), Some("2001:db8:1:2:aaaa::1")),
        source_key(ip("::1"), Some("2001:db8:1:2:bbbb::9"))
    );
    assert_ne!(
        source_key(ip("::1"), Some("2001:db8:1:2::1")),
        source_key(ip("::1"), Some("2001:db8:1:3::1"))
    );
}
