//! 0036 as corrected in #60: a physical copy (a UID) is drawn at most once per shuffle-in. The
//! engine never sees a UID, so this is the arena's rule (spec §5.2, `arena_refusal::COPY_DRAWN`).
mod harness;
use harness::*;
use tapstone_proto::frame::{Frame, Tap, arena_refusal};
use tapstone_rules::{Kind, Phase, Record};

fn record(seat: usize, kind: Kind, card: u16, uid: [u8; 7]) -> Record {
    Record {
        seq: 0,
        seat: seat as u8,
        kind,
        card,
        lane: -1,
        target: 0,
        aux: 0,
        time_ms: 0,
        uid,
        auth: 0,
    }
}

/// Propose a draw of `card` with `uid` as seat `seat`'s shrine; return the core's answer, then
/// deliver what it sent so the followers stay at the head.
fn propose_draw(net: &mut Net, seat: usize, card: u16, uid: [u8; 7], lseq: u16) -> Option<Frame> {
    let r = record(seat, Kind::Draw, card, uid);
    let reply = net.inject(NODES[seat], Frame::Tap(Tap::Propose { lseq, record: r }));
    net.drain();
    reply
}

/// The design seat `seat` would draw next: the top of its list, as its follower sees it.
fn top(net: &Net, seat: usize) -> u16 {
    net.shrines[seat]
        .follower
        .game
        .top_of_list(seat as u8)
        .expect("an undrawn copy")
}

/// An lseq the seat has not used: above its shrine's live counter. (Since resume-from-resync, a
/// shrine's counter rises to the highest lseq committed for its seat, the injected ones included,
/// so a fixed "fresh" lseq such as 901 may already be taken by the time it is injected.)
fn fresh_lseq(net: &Net, seat: usize) -> u16 {
    net.shrines[seat].lseq + 100
}

fn is_commit(f: &Option<Frame>) -> bool {
    matches!(f, Some(Frame::Commit(_)))
}

fn refusal(f: &Option<Frame>) -> Option<u8> {
    match f {
        Some(Frame::Tap(Tap::Reject { reason, .. })) => Some(*reason),
        _ => None,
    }
}

#[test]
fn the_same_physical_copy_cannot_be_drawn_twice_in_a_match() {
    let mut net = Net::new(1, 0.0, 0.0);
    net.step_until_seat_owes_draws(0);
    let uid = [4, 9, 9, 9, 9, 9, 1];
    let card = top(&net, 0);
    let first = propose_draw(&mut net, 0, card, uid, 900);
    assert!(is_commit(&first), "first draw of this copy: {first:?}");
    net.step_until_seat_owes_draws(0);
    let card = top(&net, 0);
    let lseq = fresh_lseq(&net, 0);
    let again = propose_draw(&mut net, 0, card, uid, lseq);
    assert_eq!(
        refusal(&again),
        Some(arena_refusal::COPY_DRAWN),
        "a copy drawn twice was not refused: {again:?}"
    );
}

/// The control the lead required after Oracle's review of #58. The test above cannot tell "once per
/// shuffle-in" from "once per match": both refuse its second draw. Here a mulligan shuffles the
/// hand back in, so a returned copy must be drawable again.
#[test]
fn a_mulligan_returns_the_copies_so_they_may_be_drawn_again() {
    let mut net = Net::new(1, 0.0, 0.0);
    net.manual[0] = true; // seat 0 taps only what this test injects
    let mut steps = 0;
    while net.shrines[0].follower.game.phase != Phase::Playing {
        net.step();
        steps += 1;
        assert!(steps < 1_000, "the match never started");
    }
    // Pay every draw seat 0 owes (the whole opening hand, and its turn draw if seat 1 went
    // first) with known UIDs: the engine refuses Mulligan with DrawOwed until they are paid.
    let mut hand: Vec<(u16, [u8; 7])> = Vec::new();
    let mut lseq = 900;
    loop {
        let g = &net.shrines[0].follower.game;
        if g.seats[0].owed_draws() > 0 {
            let card = top(&net, 0);
            let uid = [4, 7, 7, 7, 7, 0, hand.len() as u8];
            let r = propose_draw(&mut net, 0, card, uid, lseq);
            assert!(is_commit(&r), "opening draw {}: {r:?}", hand.len());
            hand.push((card, uid));
            lseq += 1;
        } else if g.active == 0 {
            break;
        } else {
            net.step(); // seat 1 plays its turn
            steps += 1;
            assert!(steps < 5_000, "seat 0 never got a turn");
        }
    }
    assert!(hand.len() >= 2, "seat 0 drew {} cards", hand.len());
    let m = record(0, Kind::Mulligan, 0, [0; 7]);
    let r = net.inject(NODES[0], Frame::Tap(Tap::Propose { lseq, record: m }));
    net.drain();
    assert!(is_commit(&r), "the mulligan: {r:?}");
    lseq += 1;
    let owed = net.shrines[0].follower.game.seats[0].owed_draws();
    assert_eq!(
        owed as usize,
        hand.len(),
        "a mulligan owes the hand size returned (#61)"
    );
    // Redraw a returned copy by its own UID: it was shuffled back in, so this commits.
    let (card, uid) = hand[0];
    let redraw = propose_draw(&mut net, 0, card, uid, lseq);
    assert!(
        is_commit(&redraw),
        "a copy returned by a mulligan was refused: {redraw:?}"
    );
}

/// A revived arena rebuilds the drawn set from its journal: a copy drawn before the arena went
/// dark stays drawn after it comes back.
#[test]
fn a_revived_arena_remembers_which_copies_were_drawn() {
    let mut net = Net::new(1, 0.0, 0.0);
    net.step_until_seat_owes_draws(0);
    let uid = [4, 9, 9, 9, 9, 9, 2];
    let card = top(&net, 0);
    let first = propose_draw(&mut net, 0, card, uid, 900);
    assert!(is_commit(&first), "first draw of this copy: {first:?}");
    net.go_dark();
    for _ in 0..10 {
        net.step();
    }
    net.revive();
    let mut steps = 0;
    while net.dark {
        net.step();
        steps += 1;
        assert!(steps < 1_000, "the arena never took the hand-back");
    }
    net.step_until_seat_owes_draws(0);
    let card = top(&net, 0);
    let lseq = fresh_lseq(&net, 0);
    let again = propose_draw(&mut net, 0, card, uid, lseq);
    assert_eq!(
        refusal(&again),
        Some(arena_refusal::COPY_DRAWN),
        "the revived arena forgot a drawn copy: {again:?}"
    );
}

/// A copy drawn while the arena was dark (committed by the interim arbiter, seen by the arena only
/// in the hand-back) stays drawn too: the hand-back path replays the same rule.
#[test]
fn a_copy_drawn_while_the_arena_was_dark_stays_drawn() {
    let mut net = Net::new(1, 0.0, 0.0);
    net.step_until_seat_owes_draws(0);
    let before = net.shrines[0].follower.records().len();
    net.go_dark(); // seat 0 owes a draw on its own turn: its shrine draws while the arena is dark
    for _ in 0..10 {
        net.step();
    }
    let uid = tapstone_rules::Record::decode(
        net.shrines[0].follower.records()[before..]
            .iter()
            .map(|b| b[..24].try_into().unwrap())
            .find(|b: &[u8; 24]| {
                tapstone_rules::Record::decode(b)
                    .is_some_and(|r| r.kind == Kind::Draw && r.seat == 0)
            })
            .as_ref()
            .expect("seat 0 drew while the arena was dark"),
    )
    .unwrap()
    .uid;
    net.revive();
    let mut steps = 0;
    while net.dark {
        net.step();
        steps += 1;
        assert!(steps < 1_000, "the arena never took the hand-back");
    }
    net.step_until_seat_owes_draws(0);
    let card = top(&net, 0);
    let lseq = fresh_lseq(&net, 0);
    let again = propose_draw(&mut net, 0, card, uid, lseq);
    assert_eq!(
        refusal(&again),
        Some(arena_refusal::COPY_DRAWN),
        "a copy drawn while dark was forgotten: {again:?}"
    );
}
