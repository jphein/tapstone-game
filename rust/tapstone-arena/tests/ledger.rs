use tapstone_arena::core::StatsSource;
use tapstone_arena::ledger::Ledger;
use tapstone_arena::registry::Registry;
use tapstone_proto::frame::{Equip, NONE8, NONE16, equip_op};
use tapstone_rules::Keyword;

const FIG: [u8; 7] = [0x04, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0x01];

fn ledger() -> (tempfile::TempDir, Ledger) {
    let dir = tempfile::tempdir().unwrap();
    let l = Ledger::open(&dir.path().join("ledger.sqlite")).unwrap();
    (dir, l)
}

#[test]
fn a_new_figurine_becomes_a_level_one_commander_with_nothing_worn() {
    let (_d, mut l) = ledger();
    assert_eq!(l.commander(FIG, 0), Ok((1, [None; 3])));
    let doll = l.doll(FIG, 0).unwrap();
    assert_eq!(
        (doll.level, doll.xp, doll.xp_next, doll.slots, doll.inv_len),
        (1, 0, 5, 2, 0)
    );
    assert_eq!((doll.loadout, doll.keyword), ([NONE16; 3], NONE8));
}

#[test]
fn equipping_loot_needs_the_item_in_inventory_and_a_legal_kit() {
    let (_d, mut l) = ledger();
    l.commander(FIG, 0).unwrap();
    let equip = |slot, design| Equip {
        slot,
        op: equip_op::LOOT,
        design,
        uid: [0; 7],
    };
    assert!(
        l.equip(FIG, &equip(0, 0), &Registry::Trusting).is_err(),
        "not owned yet"
    );
    l.grant_for_test(FIG, 0); // Ember Sabre, weapon, haste
    l.grant_for_test(FIG, 2); // Hearthguard Plate, armour, taunt (min level 3, owned anyway)
    // Ash Locket, trinket (a look). Owned, so its refusal below is the closed slot, not ownership.
    l.grant_for_test(FIG, 4);
    let doll = l.equip(FIG, &equip(0, 0), &Registry::Trusting).unwrap();
    assert_eq!((doll.loadout[0], doll.keyword), (0, Keyword::Haste.code()));
    assert!(
        l.equip(FIG, &equip(1, 2), &Registry::Trusting).is_err(),
        "a second keyword is refused (0031)"
    );
    assert!(
        l.equip(FIG, &equip(2, 4), &Registry::Trusting).is_err(),
        "the trinket slot is closed at level 1"
    );
    let cleared = l
        .equip(
            FIG,
            &Equip {
                slot: 0,
                op: equip_op::CLEAR,
                design: 0,
                uid: [0; 7],
            },
            &Registry::Trusting,
        )
        .unwrap();
    assert_eq!((cleared.loadout[0], cleared.keyword), (NONE16, NONE8));
}

#[test]
fn the_ledger_survives_a_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("ledger.sqlite");
    {
        let mut l = Ledger::open(&p).unwrap();
        l.commander(FIG, 0).unwrap();
        l.grant_for_test(FIG, 0);
        l.equip(
            FIG,
            &Equip {
                slot: 0,
                op: equip_op::LOOT,
                design: 0,
                uid: [0; 7],
            },
            &Registry::Trusting,
        )
        .unwrap();
    }
    let mut l = Ledger::open(&p).unwrap();
    assert_eq!(l.commander(FIG, 0).unwrap().1[0], Some(0));
}

use tapstone_arena::ledger::{LedgerEvent, roll_seed};
use tapstone_proto::frame::{MatchResult, result_reason};

const OTHER: [u8; 7] = [0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x02];

fn result(sha_byte: u8, winner: u8, reason: u8) -> (MatchResult, [[u8; 7]; 2]) {
    (
        MatchResult::unsigned(40, winner, reason, [0; 8], [sha_byte; 32]),
        [FIG, OTHER],
    )
}

fn seated(l: &mut Ledger) {
    l.commander(FIG, 0).unwrap();
    l.commander(OTHER, 1).unwrap();
}

#[test]
fn a_win_is_three_xp_a_loss_one_and_a_second_application_changes_nothing() {
    let (_d, mut l) = ledger();
    seated(&mut l);
    let (r, figs) = result(1, 0, result_reason::LETHAL);
    let ev = l.apply_result(0xA1, &r, figs, Some(0), 6).unwrap();
    assert!(ev.contains(&LedgerEvent::Xp { seat: 0, amount: 3 }));
    assert!(ev.contains(&LedgerEvent::Xp { seat: 1, amount: 1 }));
    let again = l.apply_result(0xA1, &r, figs, Some(0), 6).unwrap();
    assert!(again.is_empty(), "a result applies once (spec §8.2)");
    assert_eq!(l.doll(OTHER, 1).unwrap().xp, 1);
}

#[test]
fn a_win_drops_loot_and_every_third_consecutive_loss_does() {
    let (_d, mut l) = ledger();
    seated(&mut l);
    for (i, sha) in [2u8, 3, 4].into_iter().enumerate() {
        let (r, figs) = result(sha, 0, result_reason::LETHAL);
        let ev = l
            .apply_result(0xB0 + i as u32, &r, figs, Some(0), 6)
            .unwrap();
        let loser_drop = ev.iter().any(|e| {
            matches!(
                e,
                LedgerEvent::Drop { seat: 1, .. } | LedgerEvent::Melt { seat: 1, .. }
            )
        });
        assert_eq!(loser_drop, i == 2, "loss {} of 3", i + 1);
        assert!(
            ev.iter().any(|e| matches!(
                e,
                LedgerEvent::Drop { seat: 0, .. } | LedgerEvent::Melt { seat: 0, .. }
            )),
            "the winner always gets a drop"
        );
    }
}

#[test]
fn an_abandoned_match_before_round_three_pays_nothing() {
    let (_d, mut l) = ledger();
    seated(&mut l);
    let (r, figs) = result(5, 0, result_reason::TIMEOUT);
    assert!(
        l.apply_result(0xC1, &r, figs, Some(0), 2)
            .unwrap()
            .is_empty()
    );
    let (r, figs) = result(6, 0, result_reason::TIMEOUT);
    let ev = l.apply_result(0xC2, &r, figs, Some(0), 3).unwrap();
    assert!(
        ev.contains(&LedgerEvent::Xp { seat: 0, amount: 3 }),
        "from round 3 the stayer gets a win"
    );
    assert!(
        ev.iter().any(|e| matches!(
            e,
            LedgerEvent::Drop { seat: 0, .. } | LedgerEvent::Melt { seat: 0, .. }
        )),
        "and the win's drop (0031 ruling, spec §8.2)"
    );
    assert!(
        !ev.iter()
            .any(|e| matches!(e, LedgerEvent::Xp { seat: 1, .. })),
        "the leaver gets nothing"
    );
}

#[test]
fn a_desync_pays_nothing_and_is_recorded_halted() {
    let (_d, mut l) = ledger();
    seated(&mut l);
    let (r, figs) = result(7, 0xFF, result_reason::DESYNC);
    assert!(l.apply_result(0xD1, &r, figs, None, 6).unwrap().is_empty());
    assert_eq!(
        l.match_state_of(0xD1).as_deref(),
        Some("halted"),
        "the schema's state for a desync"
    );
    let (r, figs) = result(8, 0, result_reason::TIMEOUT);
    l.apply_result(0xD2, &r, figs, Some(0), 5).unwrap();
    assert_eq!(l.match_state_of(0xD2).as_deref(), Some("abandoned"));
}

#[test]
fn a_duplicate_drop_melts_into_one_xp_and_so_does_a_full_grid() {
    let (_d, mut l) = ledger();
    seated(&mut l);
    // Find a sha whose winner roll is item 0 or 1 (level-1 eligible), give that item first.
    let sha = (0u8..=255)
        .find(|b| tapstone_arena::ledger::roll_for(&l, FIG, &[*b; 32], 0).is_some())
        .unwrap();
    let pick = tapstone_arena::ledger::roll_for(&l, FIG, &[sha; 32], 0).unwrap();
    l.grant_for_test(FIG, pick);
    let (r, figs) = result(sha, 0, result_reason::LETHAL);
    let ev = l.apply_result(0xE1, &r, figs, Some(0), 6).unwrap();
    assert!(ev.contains(&LedgerEvent::Melt {
        seat: 0,
        design: pick,
        why: "duplicate"
    }));
    assert!(
        ev.contains(&LedgerEvent::Xp { seat: 0, amount: 1 }),
        "the melt's 1 XP (0031)"
    );
    assert_eq!(
        l.doll(FIG, 0).unwrap().xp,
        4,
        "stored: the win's 3 XP plus the melt's 1, not just an event"
    );
}

#[test]
fn the_roll_is_a_function_of_the_transcript() {
    assert_eq!(roll_seed(&[9; 32], 0), roll_seed(&[9; 32], 0));
    assert_ne!(roll_seed(&[9; 32], 0), roll_seed(&[9; 32], 1));
    assert_ne!(roll_seed(&[9; 32], 0), roll_seed(&[8; 32], 0));
}

#[test]
fn a_full_grid_melts_a_new_item() {
    assert_eq!(
        tapstone_arena::ledger::melt_reason(&[0; 12], 5),
        Some("grid full")
    );
    assert_eq!(
        tapstone_arena::ledger::melt_reason(&[0, 1], 1),
        Some("duplicate")
    );
    assert_eq!(tapstone_arena::ledger::melt_reason(&[0, 1], 2), None);
}

use tapstone_arena::core::{JournalOp, RecoveredMatch};

#[test]
fn the_journal_round_trips_an_in_flight_match_and_forgets_a_finished_one() {
    let (_d, mut l) = ledger();
    let begin = JournalOp::Begin {
        match_id: 7,
        rules: tapstone_rules::HouseRules::default().bytes(),
        nodes: [163, 164],
        figurines: [FIG, OTHER],
        decks: [vec![2; 25], vec![6; 25]],
        start_unix: 99,
    };
    let rec = JournalOp::Record {
        match_id: 7,
        record: [1; 24],
        hash: Some([2; 8]),
    };
    l.journal(&begin).unwrap();
    l.journal(&rec).unwrap();
    let back = l.in_flight().unwrap().expect("one match in flight");
    assert_eq!(
        back,
        RecoveredMatch::from_journal(&[begin.clone(), rec.clone()]).unwrap()
    );
    l.journal(&JournalOp::End {
        match_id: 7,
        result: MatchResult::unsigned(1, 0, 0, [0; 8], [0; 32]),
    })
    .unwrap();
    assert!(l.in_flight().unwrap().is_none());
}

#[test]
fn an_outbox_row_is_due_until_it_is_done() {
    let (_d, mut l) = ledger();
    l.enqueue("scry", 7, b"TSX1...", "application/vnd.tapstone.tsx1", 100)
        .unwrap();
    let due = l.due(100).unwrap();
    assert_eq!(due.len(), 1);
    l.retry(due[0].id, 100).unwrap(); // first failure: next attempt 1 s later
    assert!(l.due(100).unwrap().is_empty());
    assert_eq!(l.due(101).unwrap().len(), 1);
    l.done(due[0].id, 101).unwrap();
    assert!(l.due(10_000).unwrap().is_empty());
}

#[test]
fn a_backup_is_a_real_readable_ledger_and_only_the_newest_twenty_are_kept() {
    let (d, mut l) = ledger();
    l.commander(FIG, 0).unwrap();
    for m in 0..25u32 {
        l.backup(m, 20).unwrap();
    }
    let dir = d.path().join("backups");
    let mut names: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    assert_eq!(names.len(), 20, "{names:?}");
    assert!(
        !names.contains(&"ledger-00000000.sqlite".to_string()),
        "the oldest were pruned"
    );
    let mut copy = Ledger::open(&dir.join("ledger-00000018.sqlite")).unwrap();
    assert_eq!(
        copy.commander(FIG, 0),
        Ok((1, [None; 3])),
        "the backup holds the commander"
    );
}

// ---- The ledger's claims, each by a test rather than by reading the code (lead, after #78) ----

/// (A) A drop into a full grid melts: twelve distinct items held, the win's roll is a thirteenth,
/// so it melts, and the stored XP rises by exactly the melt's 1 on top of the win's 3.
#[test]
fn a_drop_into_a_full_grid_melts_and_pays_exactly_one_xp() {
    let (_d, mut l) = ledger();
    seated(&mut l);
    for design in 100..112u16 {
        l.grant_for_test(FIG, design); // twelve distinct designs, none of them set 1's loot
    }
    let key = tapstone_arena::ledger::hex(&FIG);
    assert_eq!(l.inventory(&key).unwrap().len(), 12, "a full grid");
    let xp0 = l.doll(FIG, 0).unwrap().xp;
    let (r, figs) = result(40, 0, result_reason::LETHAL);
    let ev = l.apply_result(0xF1, &r, figs, Some(0), 6).unwrap();
    assert!(
        ev.iter().any(|e| matches!(
            e,
            LedgerEvent::Melt {
                seat: 0,
                why: "grid full",
                ..
            }
        )),
        "the drop melts because the grid is full: {ev:?}"
    );
    assert_eq!(
        u32::from(l.doll(FIG, 0).unwrap().xp - xp0),
        tapstone_progression::XP_WIN + tapstone_progression::XP_MELT,
        "stored: the win plus exactly one melt XP"
    );
    assert_eq!(
        l.inventory(&key).unwrap().len(),
        12,
        "nothing was added to a full grid"
    );
}

/// (B) A win resets the loss streak (0031 ruling): loss, loss, win, loss is a streak of one, so
/// that last loss drops nothing, where a third loss in a row would drop.
#[test]
fn a_win_resets_the_loss_streak() {
    let (_d, mut l) = ledger();
    seated(&mut l);
    // OTHER (seat 1) loses, loses, wins, loses.
    for (i, winner) in [0u8, 0, 1, 0].into_iter().enumerate() {
        let (r, figs) = result(50 + i as u8, winner, result_reason::LETHAL);
        let ev = l
            .apply_result(0xF10 + i as u32, &r, figs, Some(winner), 6)
            .unwrap();
        if i == 3 {
            assert!(
                !ev.iter().any(|e| matches!(
                    e,
                    LedgerEvent::Drop { seat: 1, .. } | LedgerEvent::Melt { seat: 1, .. }
                )),
                "the loss after a win is the first of a new streak: no drop ({ev:?})"
            );
        }
    }
    assert_eq!(
        l.loss_streak_of(OTHER),
        Some(1),
        "stored: the streak restarted at the win"
    );
}

/// (C) The leaver of a match abandoned from round 3 gets nothing, and its stored streak and XP
/// are unchanged (0030, 0031).
#[test]
fn an_abandonment_leaves_the_leavers_streak_and_xp_untouched() {
    let (_d, mut l) = ledger();
    seated(&mut l);
    let (r, figs) = result(60, 0, result_reason::LETHAL);
    l.apply_result(0xF20, &r, figs, Some(0), 6).unwrap(); // OTHER: one loss
    let (xp0, streak0) = (l.doll(OTHER, 1).unwrap().xp, l.loss_streak_of(OTHER));
    assert_eq!((xp0, streak0), (1, Some(1)));
    let (r, figs) = result(61, 0, result_reason::TIMEOUT);
    l.apply_result(0xF21, &r, figs, Some(0), 3).unwrap(); // OTHER left from round 3
    assert_eq!(
        l.doll(OTHER, 1).unwrap().xp,
        xp0,
        "the leaver's XP is unchanged"
    );
    assert_eq!(
        l.loss_streak_of(OTHER),
        streak0,
        "the leaver's streak is unchanged"
    );
}

/// (D) Each refused equip names its reason: the second keyword and the locked trinket slot come
/// from the kit rule itself, not from ownership.
#[test]
fn an_illegal_kit_names_the_kit_rule_it_breaks() {
    use tapstone_arena::ledger::EquipRefusal;
    use tapstone_progression::LoadoutError;
    let (_d, mut l) = ledger();
    l.commander(FIG, 0).unwrap();
    for d in [0, 2, 4] {
        l.grant_for_test(FIG, d);
    }
    let equip = |slot, design| Equip {
        slot,
        op: equip_op::LOOT,
        design,
        uid: [0; 7],
    };
    l.equip(FIG, &equip(0, 0), &Registry::Trusting).unwrap();
    assert_eq!(
        l.equip_check(FIG, &equip(1, 2), &Registry::Trusting),
        Err(EquipRefusal::Kit(LoadoutError::SecondKeyword))
    );
    assert_eq!(
        l.equip_check(FIG, &equip(2, 4), &Registry::Trusting),
        Err(EquipRefusal::Kit(LoadoutError::SlotLocked(2)))
    );
    assert_eq!(
        l.equip_check(FIG, &equip(1, 5), &Registry::Trusting),
        Err(EquipRefusal::NotOwned)
    );
}

/// (E) Foreign keys are on: an inventory row for an unknown commander is refused. The control:
/// with foreign keys explicitly OFF the same insert is accepted, so the refusal is the FK's.
/// (Removing the pragma alone proves nothing: the bundled SQLite defaults foreign keys on.)
#[test]
fn an_orphan_inventory_row_is_refused_by_the_foreign_key() {
    let (_d, mut l) = ledger();
    assert!(
        l.try_grant([9; 7], 0).is_err(),
        "no commander [9; 7]: the FK refuses the row"
    );
    l.set_foreign_keys_for_test(false).unwrap();
    assert!(
        l.try_grant([9; 7], 0).is_ok(),
        "control: with FKs off the same row is accepted"
    );
}

/// An in-memory ledger has no directory for its backups, so a backup is refused rather than
/// written to ./backups in whatever directory the process runs from.
#[test]
fn an_in_memory_ledger_refuses_a_backup() {
    let l = Ledger::open(std::path::Path::new(":memory:")).unwrap();
    let existed = std::path::Path::new("backups").exists();
    assert!(l.backup(1, 20).is_err(), "no file, no backup");
    assert_eq!(
        std::path::Path::new("backups").exists(),
        existed,
        "and no ./backups was created"
    );
}
