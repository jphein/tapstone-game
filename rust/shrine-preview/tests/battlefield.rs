//! Battlefield invariants that need a real engine state.
//!
//! These live in `shrine-preview` rather than `shrine-render` because they drive `tapstone-sim`,
//! which is std. The renderer's own `src/` stays `no_std` and test-free so it can be vendored
//! byte-identical.

use shrine_preview::battlefield::*;
use shrine_preview::geom::{self, Layout};
use shrine_preview::{game, panel};
use tapstone_rules::state::{CELLS, LANES};

fn layouts() -> Vec<Layout> {
    vec![
        geom::vertical_full(),
        geom::vertical_front_two(),
        geom::horizontal_full(),
    ]
}

/// The near seat's back cell must be the slot closest to the near castle, for every layout.
#[test]
fn index_zero_is_my_own_back_cell() {
    for l in layouts() {
        let s = slot(View::Seat(0), &l, 0);
        assert_eq!(s.seat, 0, "{}", l.name);
        if l.per_seat == CELLS {
            assert_eq!(s.cell, 0, "{} index 0 must be my back cell", l.name);
        }
    }
}

/// The far end of the axis must be the opponent's deepest *drawn* cell — their back cell when
/// the layout shows the whole board, and their cell 1 when it drops the back cell to a badge.
#[test]
fn last_index_is_their_deepest_drawn_cell() {
    for l in layouts() {
        let last = l.per_seat * 2 - 1;
        let s = slot(View::Seat(0), &l, last);
        assert_eq!(s.seat, 1, "{}", l.name);
        assert_eq!(
            s.cell,
            CELLS - l.per_seat,
            "{} far end must be their deepest drawn cell",
            l.name
        );
        if l.shows_whole_board() {
            assert_eq!(
                s.cell, 0,
                "{} shows everything, so it must reach their back cell",
                l.name
            );
        }
    }
}

/// Front cells must meet across the middle: that is where combat is resolved.
#[test]
fn front_cells_meet_at_the_midline() {
    for l in layouts() {
        let n = l.per_seat;
        let mine = slot(View::Seat(0), &l, n - 1);
        let theirs = slot(View::Seat(0), &l, n);
        assert_eq!(mine.cell, CELLS - 1, "{} near side of midline", l.name);
        assert_eq!(theirs.cell, CELLS - 1, "{} far side of midline", l.name);
        assert_ne!(mine.seat, theirs.seat);
    }
}

/// The mirroring claim, stated as a test: seat 1 sees the same board inverted.
#[test]
fn the_two_seats_see_mirrored_boards() {
    let l = geom::vertical_full();
    let n2 = l.per_seat * 2;
    for idx in 0..n2 {
        let a = slot(View::Seat(0), &l, idx);
        let b = slot(View::Seat(1), &l, n2 - 1 - idx);
        assert_eq!(
            (a.seat, a.cell),
            (b.seat, b.cell),
            "index {idx} for seat 0 must be the opposite index for seat 1"
        );
    }
}

/// A spectator is not mirrored: it borrows seat 0's frame.
#[test]
fn spectator_matches_seat_zero() {
    let l = geom::horizontal_full();
    for idx in 0..l.per_seat * 2 {
        assert_eq!(slot(View::Spectator, &l, idx), slot(View::Seat(0), &l, idx));
    }
}

/// Every cell must land inside the panel, with none overlapping the HUD bands.
#[test]
fn cells_stay_inside_the_panel() {
    for l in layouts() {
        for lane in 0..LANES {
            for idx in 0..l.per_seat * 2 {
                let r = slot_rect(&l, lane, idx);
                let (x0, y0) = (r.top_left.x, r.top_left.y);
                let (x1, y1) = (x0 + r.size.width as i32, y0 + r.size.height as i32);
                assert!(
                    x0 >= 0 && y0 >= geom::HUD,
                    "{} lane {lane} idx {idx} runs into the top HUD",
                    l.name
                );
                assert!(
                    x1 <= geom::W,
                    "{} lane {lane} idx {idx} overflows width",
                    l.name
                );
                assert!(
                    y1 <= geom::H - geom::HUD,
                    "{} lane {lane} idx {idx} overflows into the bottom HUD",
                    l.name
                );
            }
        }
    }
}

/// Cells within a lane must not overlap each other.
#[test]
fn cells_do_not_overlap() {
    for l in layouts() {
        for lane in 0..LANES {
            let rects: Vec<_> = (0..l.per_seat * 2)
                .map(|i| slot_rect(&l, lane, i))
                .collect();
            for (i, a) in rects.iter().enumerate() {
                for b in rects.iter().skip(i + 1) {
                    let ax1 = a.top_left.x + a.size.width as i32;
                    let ay1 = a.top_left.y + a.size.height as i32;
                    let bx1 = b.top_left.x + b.size.width as i32;
                    let by1 = b.top_left.y + b.size.height as i32;
                    let disjoint = ax1 <= b.top_left.x
                        || bx1 <= a.top_left.x
                        || ay1 <= b.top_left.y
                        || by1 <= a.top_left.y;
                    assert!(disjoint, "{} overlapping cells in lane {lane}", l.name);
                }
            }
        }
    }
}

/// The UX doc's bottom band puts life, mana and the whole prompt sentence on one 24 px line.
/// At the type tiers the doc itself specifies, that row does not fit across 320 px. This is a
/// measurement, not a preference: if the prompt is shortened or the tier drops, update it.
#[test]
fn the_docs_bottom_band_overflows_320() {
    let w = bottom_band_width(20, 6, DOC_PROMPT);
    assert!(
        w > geom::W,
        "expected the doc's bottom row to overflow; measured {w} px against {} px",
        geom::W
    );
    // Record the size of the overflow so a change to the prompt or tier shows up here.
    assert_eq!(w, 4 + 2 * 10 + 8 + 6 * 7 + 6 + DOC_PROMPT.len() as i32 * 6);
}

/// The shipped prompt must fit across 320 px. This is the line `bottom_band_width` holds:
/// shorten the sentence before dropping a type tier, because life and mana are glanceable
/// state read at speed while the prompt is read once.
#[test]
fn the_shipped_prompt_fits() {
    let w = bottom_band_width(20, 6, PROMPT);
    assert!(
        w <= geom::W,
        "the prompt must fit; measured {w} px against {} px",
        geom::W
    );
}

/// `Prompt::WORST` must name every variant. The compiler already forces `Prompt::index` to
/// handle a new variant; this forces `WORST` to carry one too, so the pair cannot drift.
/// Without this, adding a variant compiles and silently escapes every prompt check.
#[test]
fn worst_covers_every_variant() {
    let mut seen = [false; PROMPT_VARIANTS];
    for p in Prompt::WORST {
        seen[p.index()] = true;
    }
    for (i, hit) in seen.iter().enumerate() {
        assert!(*hit, "Prompt::WORST names no case with index {i}");
    }
}

/// Every prompt, at its worst case, must fit the band it shares — including the targeting
/// prompt, which is what clipped: it carries a card name, and "Pearl Shieldbearer" is 13
/// characters longer than "Flare".
#[test]
fn every_prompt_fits_the_worst_band() {
    // Worst band: a three-digit castle life and a full eight mana pips leave the least room.
    let budget = prompt_budget_chars(255, 8);
    for p in Prompt::WORST {
        let fitted = fit(&p.text(), budget);
        let w = bottom_band_width(255, 8, &fitted);
        assert!(
            w <= geom::W,
            "{p:?} still needs {w} px of {} after fitting",
            geom::W
        );
    }
}

/// Fitting must be lossless for the prompts a player sees constantly; truncation is a
/// safety net for long card names, not the normal case.
#[test]
fn everyday_prompts_are_not_truncated() {
    let budget = prompt_budget_chars(20, 6);
    for p in [
        Prompt::YourTurn,
        Prompt::TheirTurn,
        Prompt::Resolving(2),
        Prompt::Targeting {
            card: "Flare",
            secs: 5,
        },
    ] {
        let t = p.text();
        assert_eq!(fit(&t, budget), t, "{p:?} should not need truncating");
    }
}

/// A cut must be visible, so a clipped prompt reads as clipped rather than as a sentence that
/// happens to end at the panel edge — which is exactly how the targeting bug hid.
#[test]
fn fit_marks_what_it_cuts() {
    assert_eq!(fit("abcdefgh", 5), "abc..");
    assert_eq!(fit("abc", 5), "abc");
    assert_eq!(fit("abcdefgh", 2), "..");
}

/// The budget must follow the band's contents rather than being a tuned constant.
#[test]
fn the_budget_shrinks_as_the_band_fills() {
    assert!(prompt_budget_chars(255, 8) < prompt_budget_chars(9, 0));
}

/// With no previous frame there can be no arrival marks. A shrine joining mid-game must not
/// claim a unit just arrived when it may have stood there for three rounds.
#[test]
fn no_previous_frame_means_no_arrival_marks() {
    let snap = game::at_round(21, 5, 400).expect("seed 21");
    for seat in 0..2u8 {
        for lane in 0..LANES {
            if let Some(u) = snap.game.seats[seat as usize].cells[lane][CELLS - 1] {
                assert!(!arrived_at_front(None, seat, lane, &u));
                assert_ne!(
                    mark_for(None, seat, lane, CELLS - 1, &u, snap.game.round),
                    Mark::Front
                );
            }
        }
    }
}

/// A unit that was already in the front cell last frame has not just arrived.
#[test]
fn a_standing_unit_is_not_an_arrival() {
    let snap = game::at_round(21, 5, 400).expect("seed 21");
    // Diffing a state against itself must produce no arrivals at all.
    for seat in 0..2u8 {
        for lane in 0..LANES {
            if let Some(u) = snap.game.seats[seat as usize].cells[lane][CELLS - 1] {
                assert!(
                    !arrived_at_front(Some(&snap.game), seat, lane, &u),
                    "a state diffed against itself cannot contain an arrival"
                );
            }
        }
    }
}

/// An empty front cell that becomes occupied is an arrival.
#[test]
fn filling_an_empty_front_cell_is_an_arrival() {
    let mut before = game::at_round(21, 5, 400).expect("seed 21").game;
    let after = before;
    // Clear every front cell in the "before" frame; everything present after has arrived.
    for seat in 0..2usize {
        for lane in 0..LANES {
            before.seats[seat].cells[lane][CELLS - 1] = None;
        }
    }
    let mut found = 0;
    for seat in 0..2u8 {
        for lane in 0..LANES {
            if let Some(u) = after.seats[seat as usize].cells[lane][CELLS - 1] {
                assert!(arrived_at_front(Some(&before), seat, lane, &u));
                assert_eq!(
                    mark_for(Some(&before), seat, lane, CELLS - 1, &u, after.round),
                    Mark::Front
                );
                found += 1;
            }
        }
    }
    assert!(
        found > 0,
        "seed 21 round 5 should have someone in a front cell"
    );
}

/// A mark is only ever claimed for the front cell; back and mid cells cannot "arrive".
#[test]
fn only_the_front_cell_can_be_an_arrival() {
    let snap = game::at_round(21, 5, 400).expect("seed 21");
    let empty = {
        let mut g = snap.game;
        for seat in 0..2usize {
            for lane in 0..LANES {
                g.seats[seat].cells[lane] = [None; CELLS];
            }
        }
        g
    };
    for seat in 0..2u8 {
        for lane in 0..LANES {
            for cell in 0..CELLS - 1 {
                if let Some(u) = snap.game.seats[seat as usize].cells[lane][cell] {
                    assert_ne!(
                        mark_for(Some(&empty), seat, lane, cell, &u, snap.game.round),
                        Mark::Front,
                        "cell {cell} is not the front cell"
                    );
                }
            }
        }
    }
}

/// Rendering a real game must not panic for any layout or view.
#[test]
fn renders_a_real_game() {
    let snap = game::at_round(7, 6, 400).expect("seed 7");
    for l in layouts() {
        for v in [View::Seat(0), View::Seat(1), View::Spectator] {
            let _ = panel::battlefield(&snap.game, v, &l, &Opts::default());
        }
    }
}
