//! Where in a real match do front-cell arrivals actually happen?
//!
//! Kept as a test rather than a throwaway script: it proves the derivation fires on real engine
//! output, not only on the synthetic before-states the unit tests build, and it names a
//! seed/round pair where the marker is worth rendering.
use shrine_preview::battlefield::arrived_at_front;
use shrine_preview::game;
use tapstone_rules::state::{CELLS, LANES};

#[test]
fn arrivals_occur_in_real_play() {
    let mut hits = Vec::new();
    for seed in 1..=24u64 {
        for round in 2..=12u8 {
            let (Ok(prev), Ok(now)) = (
                game::at_round(seed, round - 1, 400),
                game::at_round(seed, round, 400),
            ) else {
                continue;
            };
            if now.round != round {
                continue;
            }
            let mut n = 0;
            for seat in 0..2u8 {
                for lane in 0..LANES {
                    if let Some(u) = now.game.seats[seat as usize].cells[lane][CELLS - 1]
                        && arrived_at_front(Some(&prev.game), seat, lane, &u)
                    {
                        n += 1;
                    }
                }
            }
            if n > 0 {
                hits.push((seed, round, n));
            }
        }
    }
    assert!(
        !hits.is_empty(),
        "the arrival derivation never fires on real play, which would mean it is broken"
    );
    let best = hits.iter().max_by_key(|h| h.2).unwrap();
    println!(
        "arrivals in {} states; busiest seed {} round {} with {}",
        hits.len(),
        best.0,
        best.1,
        best.2
    );
}
