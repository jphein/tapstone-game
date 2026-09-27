//! A person in one desk seat (the headset build, spec 2026-09-25 §2): the seat's shrine makes no
//! taps of its own, and every tap it sends is one the person chose from the engine's own menu.
use tapstone_arena::link::desk::DeskTable;
use tapstone_rules::Kind;

/// Plays seat `i`'s turns with the first useful non-mulligan choice (a mulligan owes the hand
/// back, so always taking it would loop). Returns (finished, taps the person made).
fn play(seed: u64, i: usize, person: bool) -> (bool, u32) {
    let mut table = DeskTable::new(seed);
    table.link.manual[i] = true;
    let mut taps = 0;
    for step in 0..40_000u64 {
        let now = step * 10;
        table.step(now);
        if table.done() {
            return (true, taps);
        }
        if !person {
            continue;
        }
        let g = table.link.shrines[i].follower.game;
        let pick = table
            .choices(i)
            .into_iter()
            .find(|c| c.tap.kind != Kind::Mulligan && c.is_useful(&g));
        if let Some(c) = pick {
            assert!(table.propose(i, now, c.tap), "a menu choice was not sent");
            taps += 1;
        }
    }
    (false, taps)
}

#[test]
fn a_person_in_one_seat_finishes_a_desk_match() {
    for i in 0..2 {
        let (done, taps) = play(11, i, true);
        assert!(done, "shrine {i}'s person never finished the match");
        assert!(taps >= 5, "shrine {i}'s person made only {taps} taps");
    }
}

/// The control: the same seat with nobody choosing stalls, so the test above finishes because
/// of the person's taps, not because the shrine still plays itself.
#[test]
fn a_manual_seat_left_alone_stalls() {
    let (done, taps) = play(11, 0, false);
    assert!(!done, "a manual seat finished a match with no person");
    assert_eq!(taps, 0);
}

/// Nothing is offered off-turn or while a tap is pending, so a double pinch can't send twice.
#[test]
fn no_choices_while_a_tap_is_pending() {
    let mut table = DeskTable::new(11);
    table.link.manual[0] = true;
    for step in 0..40_000u64 {
        let now = step * 10;
        table.step(now);
        let first = table.choices(0).into_iter().next();
        if let Some(c) = first {
            assert!(table.propose(0, now, c.tap));
            assert!(
                table.choices(0).is_empty(),
                "choices offered while a tap is pending"
            );
            assert!(
                !table.propose(0, now, c.tap),
                "a second tap was sent while one is pending"
            );
            return;
        }
    }
    panic!("the person was never offered a choice");
}
