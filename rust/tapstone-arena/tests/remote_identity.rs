//! The remote seat at a real table (0038, spec §6): its virtual copies resolve in a strict
//! registry without shadowing a real one, and its commander is a guest the ledger never writes.
use tapstone_arena::core::StatsSource;
use tapstone_arena::ledger::{Ledger, LedgerEvent};
use tapstone_arena::link::remote::GuestStats;
use tapstone_arena::registry::Registry;
use tapstone_proto::frame::{MatchResult, result_reason};

const REAL: [u8; 7] = [0x04, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0x01];
const GUEST: [u8; 7] = [4, 0, 0, 0, 0, 0, 2];

fn ledger() -> (tempfile::TempDir, Ledger) {
    let dir = tempfile::tempdir().unwrap();
    let l = Ledger::open(&dir.path().join("ledger.sqlite")).unwrap();
    (dir, l)
}

#[test]
fn a_strict_registry_learns_virtual_copies_but_never_over_a_real_one() {
    let mut r =
        Registry::from_jsonl(r#"{"uid":"04:AA:BB:CC:DD:EE:01","design":"st1-003"}"#).unwrap();
    assert_eq!(r.resolve(GUEST), None);
    r.add_virtual(GUEST, 0).unwrap();
    assert_eq!(r.resolve(GUEST), Some(0));
    assert!(
        r.add_virtual(REAL, 5).is_err(),
        "a virtual copy shadowed a real one"
    );
    assert_eq!(r.resolve(REAL), Some(3));
}

#[test]
fn a_trusting_registry_has_nothing_to_learn() {
    let mut r = Registry::Trusting;
    r.add_virtual(GUEST, 0).unwrap();
    assert_eq!(r.resolve_or(GUEST, 7), Some(7));
}

#[test]
fn the_guest_is_a_fresh_level_one_commander_and_is_never_written() {
    let (_d, l) = ledger();
    let mut s = GuestStats {
        inner: l,
        guest: GUEST,
    };
    assert_eq!(s.commander(GUEST, 0), Ok((1, [None; 3])));
    assert!(s.doll(GUEST, 1).is_none());
    assert!(
        s.inner.doll(GUEST, 1).is_none(),
        "the guest was written to the ledger"
    );
    assert_eq!(s.commander(REAL, 0), Ok((1, [None; 3])));
    assert!(
        s.inner.doll(REAL, 0).is_some(),
        "a real figurine must still reach the ledger"
    );
}

#[test]
fn a_result_credits_the_shrine_player_and_skips_the_guest() {
    let (_d, mut l) = ledger();
    l.commander(REAL, 0).unwrap(); // only the shrine player has a row, as with a guest seated
    let r = MatchResult::unsigned(40, 0, result_reason::LETHAL, [0; 8], [1; 32]);
    let ev = l
        .apply_result_credit(0xB1, &r, [REAL, GUEST], Some(0), 6, [true, false])
        .unwrap();
    assert!(ev.contains(&LedgerEvent::Xp { seat: 0, amount: 3 }));
    assert!(
        !ev.iter()
            .any(|e| matches!(e, LedgerEvent::Xp { seat: 1, .. }))
    );
    assert_eq!(l.doll(REAL, 0).unwrap().xp, 3);
}

/// The control: why the credit mask exists. Crediting both seats with a guest that has no row
/// fails, and main.rs would stop the arena on that error.
#[test]
fn crediting_a_guest_that_was_never_written_fails() {
    let (_d, mut l) = ledger();
    l.commander(REAL, 0).unwrap();
    let r = MatchResult::unsigned(40, 0, result_reason::LETHAL, [0; 8], [1; 32]);
    assert!(l.apply_result(0xB2, &r, [REAL, GUEST], Some(0), 6).is_err());
}
