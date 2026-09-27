//! The hub with two remote slots (0038, JP against a second player): a code per slot, a token that maps
//! to its slot and reaches only its slot's menu, one wrong-code lock for the table, and a seat
//! that is unknown until the loop sets it. Pure: no HTTP.
use rand::SeedableRng;
use rand::rngs::StdRng;
use tapstone_arena::core::StatsSource;
use tapstone_arena::link::remote::{GuestStats, MenuItem, credit};
use tapstone_arena::remote::{FREE_WRONG, Hub, JoinError, ProposeError};
use tapstone_arena::view::ViewModel;
use tapstone_rules::{Kind, Record};

fn hub() -> Hub {
    Hub::with_slots(StdRng::seed_from_u64(7), 2)
}

fn item(key: &str) -> MenuItem {
    MenuItem {
        key: key.into(),
        label: key.into(),
        kind: "Pass".into(),
        useful: true,
    }
}

fn tap(seat: u8) -> Record {
    tapstone_sim::tap(seat, Kind::Pass, 0, -1, 0, 0)
}

/// A code that is neither slot's.
fn wrong(h: &Hub) -> String {
    ["AAAAAA", "BBBBBB", "CCCCCC"]
        .into_iter()
        .find(|c| (0..h.slots()).all(|s| h.code_of(s) != *c))
        .unwrap()
        .into()
}

#[test]
fn each_slot_has_its_own_code_and_its_token_maps_to_it() {
    let mut h = hub();
    assert_eq!(h.slots(), 2);
    let (a, b) = (h.code_of(0).to_string(), h.code_of(1).to_string());
    assert_ne!(a, b, "two slots share a code");
    assert_eq!(h.open_codes(), vec![a.clone(), b.clone()]);
    let jb = h.redeem(&b).unwrap();
    assert_eq!(jb.slot, 1);
    assert_eq!(
        h.open_codes(),
        vec![a.clone()],
        "a joined slot's code is closed"
    );
    let ja = h.redeem(&a).unwrap();
    assert_eq!(ja.slot, 0);
    assert_ne!(ja.token, jb.token);
    assert_eq!(h.slot_of(&ja.token), Some(0));
    assert_eq!(h.slot_of(&jb.token), Some(1));
    assert_eq!(h.slot_of(&"0".repeat(32)), None);
    assert!(h.open_codes().is_empty());
    assert_eq!(h.redeem(&a).map(|j| j.slot), Err(JoinError::Taken));
    assert!(h.is_joined(0) && h.is_joined(1));
}

#[test]
fn codes_differ_across_many_matches() {
    let mut h = hub();
    for _ in 0..500 {
        assert_ne!(h.code_of(0), h.code_of(1));
        h.new_match();
    }
}

#[test]
fn a_slots_token_reaches_only_its_own_menu() {
    let mut h = hub();
    let (a, b) = (h.code_of(0).to_string(), h.code_of(1).to_string());
    let ta = h.redeem(&a).unwrap().token;
    let tb = h.redeem(&b).unwrap().token;
    h.set_menu_at(0, vec![item("a")], vec![tap(0)]);
    h.set_menu_at(1, vec![item("b1"), item("b2")], vec![tap(1), tap(1)]);
    let sa = h.slot_of(&ta).unwrap();
    let sb = h.slot_of(&tb).unwrap();
    assert_eq!(h.menu_at(sa).1, &[item("a")][..]);
    assert_eq!(h.menu_at(sb).1.len(), 2);
    // Slot 0's token holds slot 0's menu number; with it, slot 1's menu is not reachable.
    let na = h.menu_at(sa).0;
    let nb = h.menu_at(sb).0;
    assert_eq!(h.take_at(sa, na, 1), Err(ProposeError::BadIndex));
    assert_eq!(h.take_at(sa, na, 0), Ok(tap(0)));
    assert_eq!(
        h.menu_at(1).1.len(),
        2,
        "taking slot 0's menu spent slot 1's"
    );
    assert_eq!(h.take_at(sb, nb, 1), Ok(tap(1)));
}

/// The control: numbered alike, the two menus are still apart (take_at uses the slot, not the
/// number, to find the menu).
#[test]
fn the_same_menu_number_in_two_slots_takes_each_slots_own_tap() {
    let mut h = hub();
    h.set_menu_at(0, vec![item("a")], vec![tap(0)]);
    h.set_menu_at(1, vec![item("b")], vec![tap(1)]);
    let (na, nb) = (h.menu_at(0).0, h.menu_at(1).0);
    assert_eq!(na, nb);
    assert_eq!(h.take_at(1, nb, 0), Ok(tap(1)));
    assert_eq!(h.take_at(0, na, 0), Ok(tap(0)));
}

#[test]
fn the_wrong_code_budget_is_the_sources_not_each_slots() {
    let mut h = hub();
    let w = wrong(&h);
    for _ in 0..FREE_WRONG {
        assert_eq!(h.redeem(&w).map(|j| j.slot), Err(JoinError::Wrong));
    }
    for s in 0..2 {
        let c = h.code_of(s).to_string();
        assert!(
            matches!(h.redeem(&c), Err(JoinError::Throttled(_))),
            "slot {s}: a second slot is not a second budget"
        );
    }
    h.new_match();
    let c = h.code_of(1).to_string();
    assert!(h.redeem(&c).is_ok(), "the strikes last one match");
}

#[test]
fn each_slots_seat_is_its_own_and_unknown_until_the_loop_sets_it() {
    let mut h = hub();
    let c = h.code_of(1).to_string();
    assert_eq!(h.redeem(&c).unwrap().seat, None);
    h.set_seat_at(1, Some(0));
    assert_eq!(h.seat_at(1), Some(0));
    assert_eq!(h.seat_at(0), None, "slot 1's seat landed on slot 0");
    h.set_seat_at(0, Some(1));
    assert_eq!((h.seat_at(0), h.seat_at(1)), (Some(1), Some(0)));
    h.new_match();
    assert_eq!(
        (h.seat_at(0), h.seat_at(1)),
        (None, None),
        "claim order can differ next match"
    );
}

#[test]
fn an_old_token_views_until_its_own_slots_next_join() {
    let mut h = hub();
    let (a, b) = (h.code_of(0).to_string(), h.code_of(1).to_string());
    let ta = h.redeem(&a).unwrap().token;
    let tb = h.redeem(&b).unwrap().token;
    h.new_match();
    assert_eq!(h.slot_of(&ta), None);
    assert!(h.may_view(&ta) && h.may_view(&tb));
    let b = h.code_of(1).to_string();
    h.redeem(&b).unwrap();
    assert!(h.may_view(&ta), "slot 1's join retired slot 0's old token");
    assert!(!h.may_view(&tb));
}

#[test]
fn a_new_match_spends_every_slots_menu() {
    let mut h = hub();
    h.set_menu_at(0, vec![item("a")], vec![tap(0)]);
    h.set_menu_at(1, vec![item("b")], vec![tap(1)]);
    let n1 = h.menu_at(1).0;
    h.new_match();
    assert_eq!(h.take_at(1, n1, 0), Err(ProposeError::Stale));
    assert!(h.menu_at(0).1.is_empty() && h.menu_at(1).1.is_empty());
}

#[test]
fn the_view_carries_the_open_codes_only_when_there_are_some() {
    let mut v = ViewModel::default();
    assert!(!serde_json::to_string(&v).unwrap().contains("remote_codes"));
    v.remote_codes = vec!["K7Q2MX".into(), "P3WZ9A".into()];
    assert!(
        serde_json::to_string(&v)
            .unwrap()
            .contains(r#""remote_codes":["K7Q2MX","P3WZ9A"]"#)
    );
}

/// Two guests: neither reaches the inner ledger, which here refuses everything.
#[test]
fn every_guest_in_the_set_is_a_fresh_commander_never_written() {
    struct Refuse;
    impl StatsSource for Refuse {
        fn commander(&mut self, _: [u8; 7], _: u16) -> Result<(u8, [Option<u16>; 3]), u8> {
            Err(99)
        }
        fn doll(&mut self, _: [u8; 7], _: u8) -> Option<tapstone_proto::frame::Doll> {
            panic!("a guest reached the ledger")
        }
        fn equip(
            &mut self,
            _: [u8; 7],
            _: &tapstone_proto::frame::Equip,
            _: &tapstone_arena::registry::Registry,
        ) -> Result<tapstone_proto::frame::Doll, u8> {
            Err(98)
        }
    }
    let g = [[4, 0, 0, 0, 0, 0, 2], [4, 0, 0, 0, 0, 0, 3]];
    let mut s: GuestStats<_, Vec<[u8; 7]>> = GuestStats {
        inner: Refuse,
        guest: g.to_vec(),
    };
    for f in g {
        assert_eq!(s.commander(f, 0), Ok((1, [None; 3])));
        assert!(s.doll(f, 0).is_none());
    }
    assert_eq!(
        s.commander([4, 0, 0, 0, 0, 0, 1], 0),
        Err(99),
        "the control"
    );
}

/// The result's credit mask: no guest earns, every real figurine does.
#[test]
fn the_credit_mask_skips_every_guest() {
    let (real, g0, g1) = (
        [4, 0xAA, 0, 0, 0, 0, 1],
        [4, 0, 0, 0, 0, 0, 2],
        [4, 0, 0, 0, 0, 0, 3],
    );
    assert_eq!(credit([real, g0], &[g0]), [true, false]);
    assert_eq!(credit([g1, g0], &[g0, g1]), [false, false]);
    assert_eq!(
        credit([real, real], &[]),
        [true, true],
        "the control: no guests"
    );
}
