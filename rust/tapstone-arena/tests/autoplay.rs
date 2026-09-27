//! The shrine firmware's own chooser (`tapstone_proto::shrine::Autoplay`, tapstone#132 item c)
//! plays whole desk matches against the real arena core. The desk seats are manual here and every
//! tap comes from the chooser through `DeskTable::propose`, the path a person's tap takes.
use tapstone_arena::link::desk::DeskTable;
use tapstone_proto::shrine::{Autoplay, Chooser, tap};
use tapstone_rules::{Game, Kind, Phase, Record};

/// A chooser that only ever passes: the control. Sudden death ends its matches too, so "finished"
/// alone cannot show that Autoplay plays.
struct PassOnly;
impl Chooser for PassOnly {
    fn seated(&mut self, _: u8) {}
    fn next_tap(&mut self, _: &Game, seat: u8) -> Record {
        tap(seat, Kind::Pass, 0, -1, 0, 0)
    }
}

struct Played {
    over: bool,
    /// Committed casts and charges, both seats.
    cards: usize,
    records: usize,
}

fn play<C: Chooser>(seed: u64, mut choosers: [C; 2]) -> Played {
    let mut t = DeskTable::new(seed);
    t.link.manual = [true; 2];
    let mut seated = [false; 2];
    for step in 0..60_000u64 {
        let now = step * 10;
        t.step(now);
        for i in 0..2 {
            let sh = &t.link.shrines[i];
            let Some(seat) = sh.seat() else { continue };
            if !seated[i] {
                choosers[i].seated(seat as u8);
                seated[i] = true;
            }
            if !sh.my_move() {
                continue;
            }
            // A manual seat's owed draws are its person's taps too (0036).
            let g: Game = sh.follower.game;
            let r = if g.seats[seat].owed_draws() > 0 {
                let c = g
                    .top_of_list(seat as u8)
                    .expect("a seat that owes has a card");
                tap(seat as u8, Kind::Draw, c, -1, 0, 0)
            } else {
                choosers[i].next_tap(&g, seat as u8)
            };
            t.propose(i, now, r);
        }
        if t.done() {
            break;
        }
    }
    let sh = &t.link.shrines[0];
    let cards = sh
        .follower
        .records()
        .iter()
        .filter_map(|b| Record::decode(b))
        .filter(|r| matches!(r.kind, Kind::CastUnit | Kind::CastSpell | Kind::Charge))
        .count();
    Played {
        over: t.done()
            && t.link
                .shrines
                .iter()
                .all(|s| s.follower.game.phase == Phase::Over),
        cards,
        records: sh.follower.records().len(),
    }
}

#[test]
fn autoplay_seats_finish_every_match_and_play_cards() {
    let mut bad = Vec::new();
    for seed in 1..=40u64 {
        let p = play(seed, [Autoplay::new(seed), Autoplay::new(seed ^ 0xA5)]);
        if !p.over || p.cards < 4 {
            bad.push((seed, p.over, p.cards, p.records));
        }
    }
    assert!(
        bad.is_empty(),
        "(seed, over, cards, records) that fell short: {bad:?}"
    );
}

#[test]
fn control_pass_only_finishes_but_plays_no_card() {
    let p = play(1, [PassOnly, PassOnly]);
    assert!(p.over, "sudden death ends even a table of passes");
    assert_eq!(
        p.cards, 0,
        "the instrument counts casts and charges, and a pass is neither"
    );
}
