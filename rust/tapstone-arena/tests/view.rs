mod harness;
use harness::*;
use tapstone_rules::state::{CELLS, COMMANDER_DESIGN, LANES};

/// Every cell the view draws must be the cell the engine holds, checked against a follower's
/// engine: a separate object from the core's, so the view cannot agree with itself.
fn view_matches_engine(net: &Net) {
    let v = net.core.view();
    let g = &net.shrines[0].follower.game;
    assert_eq!((v.round, v.active), (g.round, g.active));
    for (s, seat) in g.seats.iter().enumerate() {
        let vs = &v.seats[s];
        assert_eq!(
            (vs.life, vs.charged, vs.spent, vs.hand),
            (seat.castle.life, seat.charged, seat.spent, seat.hand_len)
        );
        assert_eq!(
            vs.owed_draws,
            seat.owed_draws(),
            "seat {s} owed draws (0036, carried from 11b)"
        );
        for l in 0..LANES {
            for c in 0..CELLS {
                match (&seat.cells[l][c], &vs.cells[l][c]) {
                    (None, None) => {}
                    (Some(u), Some(vu)) => {
                        assert_eq!(
                            (vu.attack, vu.toughness, vu.damage),
                            (u.attack, u.toughness, u.damage),
                            "seat {s} {l}/{c}"
                        );
                        assert_eq!(vu.commander, u.design == COMMANDER_DESIGN);
                    }
                    (e, w) => panic!("seat {s} lane {l} cell {c}: engine {e:?}, view {w:?}"),
                }
            }
        }
    }
}

#[test]
fn the_view_is_the_engine_at_every_point_of_a_match() {
    let mut net = Net::new(5, 0.0, 0.0);
    let mut checked = 0;
    for _ in 0..3000 {
        net.step();
        if net.core.view().phase == "playing"
            && net.wire.is_empty()
            && net.shrines[0].follower.records().len() == net.core_log_len()
        {
            view_matches_engine(&net);
            checked += 1;
        }
        if !net.over.is_empty() {
            break;
        }
    }
    assert!(checked > 20, "only {checked} points were comparable");
}

#[test]
fn the_final_board_stays_up_after_the_result() {
    let mut net = Net::new(6, 0.0, 0.0);
    assert!(net.run(20_000));
    let v = net.core.view();
    assert_eq!(v.phase, "lobby");
    let last = v
        .last_over
        .as_ref()
        .expect("the finished board is kept for the canvas");
    assert_eq!(last.phase, "over");
    assert!(last.winner.is_some());
}

#[test]
fn the_view_serialises_with_stable_keys() {
    let net = Net::new(7, 0.0, 0.0);
    let json = serde_json::to_value(net.core.view()).unwrap();
    for k in [
        "phase",
        "match_id",
        "round",
        "active",
        "seq",
        "seats",
        "lobby",
        "last",
        "winner",
        "head",
        "last_over",
    ] {
        assert!(json.get(k).is_some(), "missing key {k}");
    }
}

/// A timeout is the arena's call, which the engine never saw: the kept board must still name the
/// seat that stayed as the winner.
#[test]
fn a_timed_out_board_names_the_seat_that_stayed() {
    let mut net = Net::new(3, 0.0, 0.0);
    while net.shrines[0].follower.records().len() < 20 {
        net.step();
    }
    let silent = net.shrines[1].node;
    let mut steps = 0;
    while net.over.is_empty() && steps < 20_000 {
        net.step_dropping_from(silent);
        steps += 1;
    }
    assert_eq!(
        net.over.last().expect("timed out").result.reason,
        tapstone_proto::frame::result_reason::TIMEOUT
    );
    let v = net.core.view();
    let last = v.last_over.as_ref().expect("the board is kept");
    assert_eq!((last.phase.as_str(), last.winner), ("over", Some(0)));
}

/// Whether a record of this kind carries a card the last event should name. An exhaustive match
/// with no wildcard, so a new Kind is a compile error here rather than a silently stale list.
fn names_a_card(k: tapstone_rules::Kind) -> bool {
    use tapstone_rules::Kind;
    match k {
        Kind::Draw | Kind::Charge | Kind::CastUnit | Kind::CastSpell | Kind::ClaimSeat => true,
        Kind::Mulligan | Kind::Advance | Kind::Pass | Kind::Leave => false,
    }
}

/// The last event names a card only for the kinds that carry one (a draw, a charge, a cast, the
/// castle claim). A Pass, an Advance or a Mulligan names none: design 0 is a real card, and it must
/// not be shown. Every kind a duel can commit is seen at least once across the seeds scanned;
/// only Leave is excluded, because v0's engine always refuses it, so it is never committed.
#[test]
fn the_last_event_names_a_card_only_for_kinds_that_carry_one() {
    use std::collections::BTreeSet;
    use tapstone_rules::Kind;
    let kinds: Vec<Kind> = (0..=u8::MAX).filter_map(Kind::from_u8).collect();
    let reachable: BTreeSet<String> = kinds
        .iter()
        .filter(|k| **k != Kind::Leave)
        .map(|k| format!("{k:?}"))
        .collect();
    let mut seen = BTreeSet::new();
    for seed in 1..=40u64 {
        let mut net = Net::new(seed, 0.0, 0.0);
        for _ in 0..3000 {
            net.step();
            if let Some(last) = net.core.view().last.as_ref() {
                let kind = *kinds
                    .iter()
                    .find(|k| format!("{k:?}") == last.kind)
                    .unwrap_or_else(|| panic!("an unknown kind {}", last.kind));
                assert_eq!(
                    last.card.is_some(),
                    names_a_card(kind),
                    "seed {seed}: {} named {:?}",
                    last.kind,
                    last.card
                );
                seen.insert(last.kind.clone());
            }
            if !net.over.is_empty() {
                break;
            }
        }
        if reachable.is_subset(&seen) {
            return;
        }
    }
    let missing: Vec<_> = reachable.difference(&seen).collect();
    panic!("40 seeds never showed {missing:?} as a last event, so those kinds went unchecked");
}
