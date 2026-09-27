mod harness;
use harness::*;
use tapstone_arena::core::JournalOp;
use tapstone_rules::{Kind, Phase, Record};

#[test]
fn two_castle_taps_start_a_match_in_claim_order_with_arena_stats() {
    let mut net = Net::new(1, 0.0, 0.0);
    for _ in 0..10 {
        net.step();
    }
    let begin = net.journal.iter().find_map(|j| match j {
        JournalOp::Begin { nodes, .. } => Some(*nodes),
        _ => None,
    });
    assert_eq!(
        begin,
        Some(NODES),
        "shrine 0 claimed first, so it is seat 0"
    );
    let claims: Vec<Record> = net
        .journal
        .iter()
        .filter_map(|j| match j {
            JournalOp::Record { record, .. } => {
                Record::decode(record).filter(|r| r.kind == Kind::ClaimSeat)
            }
            _ => None,
        })
        .collect();
    assert_eq!(claims.len(), 2);
    for (seat, c) in claims.iter().enumerate() {
        assert_eq!(c.seat as usize, seat);
        assert_eq!(
            (c.target, c.aux, c.lane),
            (2, 4, -1),
            "the arena's stats, not the proposal's 0/0"
        );
    }
    for s in &net.shrines {
        assert_eq!(
            s.follower.game.phase,
            Phase::Playing,
            "node {} did not start",
            s.node
        );
    }
}

#[test]
fn an_unknown_deck_is_refused_and_seats_nobody() {
    let mut net = Net::new(2, 0.0, 0.0);
    net.shrines[1].deck = heapless::Vec::from_slice(&[13; 25]).unwrap(); // beacons a sigil the arena does not know
    for _ in 0..10 {
        net.step();
    }
    assert!(
        !net.journal
            .iter()
            .any(|j| matches!(j, JournalOp::Begin { .. }))
    );
}

#[test]
fn the_core_names_each_seats_node_once_seated() {
    let mut net = Net::new(1, 0.0, 0.0);
    assert_eq!(net.core.seat_node(0), None, "lobby: nobody is seated yet");
    net.step(); // shrine 0 claims; the match has not started
    assert_eq!(net.core.seated(), vec![NODES[0]], "one claim held");
    assert_eq!(
        net.core.seat_node(0),
        None,
        "a claim in the lobby is not a seat in a match"
    );
    for _ in 0..10 {
        net.step();
    }
    assert_eq!(
        (
            net.core.seat_node(0),
            net.core.seat_node(1),
            net.core.seat_node(2)
        ),
        (Some(NODES[0]), Some(NODES[1]), None)
    );
}
