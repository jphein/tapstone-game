//! An off desk shrine is unplugged: it neither claims nor hears (the remote seat's desk table runs
//! one desk shrine, the bot, and turns the other off; plan 2026-09-26 A1).
use tapstone_arena::link::desk::{DESK_NODES, DeskTable};

#[test]
fn an_off_shrine_neither_claims_nor_hears() {
    let mut table = DeskTable::new(11);
    table.link.off[1] = true;
    for step in 0..2_000u64 {
        table.step(step * 10);
        assert!(
            !table.core.seated().contains(&DESK_NODES[1]),
            "the off shrine claimed a seat at step {step}"
        );
    }
    assert_eq!(
        table.core.seated(),
        vec![DESK_NODES[0]],
        "only the live shrine claimed"
    );
    assert_eq!(table.link.shrines[1].lseq, 0, "the off shrine sent nothing");
    assert!(
        table.link.shrines[1].follower.begun().is_none(),
        "the off shrine heard a match begin"
    );
}

/// The control: with both shrines on, the same 20 s seat both (so the test above sees `off`,
/// not a table too slow to seat anyone). Checked every step: a two-bot match can finish inside
/// 20 s and leave the lobby empty again.
#[test]
fn with_both_shrines_on_both_are_seated() {
    let mut table = DeskTable::new(11);
    let seated_both = (0..2_000u64).any(|step| {
        table.step(step * 10);
        table.core.seated() == DESK_NODES.to_vec()
    });
    assert!(seated_both, "two live desk shrines never both held a seat");
}
