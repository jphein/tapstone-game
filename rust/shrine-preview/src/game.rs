//! Real engine states for the preview to draw.
//!
//! The battlefield screen is worth nothing if it renders a hand-written board. This module drives
//! `tapstone_sim::play_seeded` and replays the transcript one record at a time, stopping at a
//! chosen round, so what lands on the panel is what the rules crate actually produced.
//!
//! The replay loop mirrors `tapstone_sim::replay::replay` deliberately: if that function changes
//! shape, this should be updated alongside it rather than quietly drifting.

use tapstone_rules::state::{Game, Phase};
use tapstone_sim::{CASTLES, Setup, play_seeded, play_seeded_setup, replay::decode_record};

/// Where a replay stopped, and why.
#[derive(Clone, Copy, Debug)]
pub struct Snapshot {
    pub game: Game,
    /// Records applied before stopping.
    pub applied: usize,
    /// Total records in the transcript.
    pub total: usize,
    /// The round actually reached, which may be short of the one asked for.
    pub round: u8,
}

/// Play `seed` and replay it until `round` begins, or until the game ends.
///
/// `round` is 1-based to match the HUD's `T7`. Asking for a round past the end of the match
/// returns the final state rather than failing: a preview of the last board is more useful than
/// an error, and `Snapshot::round` reports what was really reached.
pub fn at_round(seed: u64, round: u8, max_taps: usize) -> Result<Snapshot, String> {
    let t = play_seeded(seed, max_taps);
    let mut g = Game::new((&t.house_rules).into(), CASTLES, [&t.decks[0], &t.decks[1]]);

    let total = t.records.len();
    let mut applied = 0usize;

    for rj in &t.records {
        // Stop *before* applying the record that would carry us past the requested round, so the
        // board shown is the one a player would be looking at during that round.
        if g.phase == Phase::Playing && g.round >= round {
            break;
        }
        let r = decode_record(rj).map_err(|e| format!("record {}: {e:?}", rj.seq))?;
        g.apply(&r)
            .map_err(|refusal| format!("record {} refused: {refusal:?}", rj.seq))?;
        applied += 1;
        if g.phase == Phase::Over {
            break;
        }
    }

    Ok(Snapshot {
        game: g,
        applied,
        total,
        round: g.round,
    })
}

/// Replay `seed` record by record and stop at the first state where `pred` holds.
///
/// `at_round` can only stop at a round boundary, where every seat has spent nothing yet. Screens
/// that need a mid-turn state (mana partly spent, a card that cannot be afforded) use this, so the
/// state is still one the engine produced rather than a hand-edited copy.
pub fn first_where(
    seed: u64,
    max_taps: usize,
    pred: impl Fn(&Game) -> bool,
) -> Result<Option<Snapshot>, String> {
    first_where_setup(seed, max_taps, Setup::default(), pred).map(|o| o.map(|(_, now)| now))
}

/// As `first_where`, under a chosen sim `Setup` (house rules, picker, decks, **commanders**), and
/// returning the state **before** the record that made `pred` true as well as the one after — the
/// two ends of a real transition, for motions that should be driven by the engine.
pub fn first_where_setup(
    seed: u64,
    max_taps: usize,
    setup: Setup,
    pred: impl Fn(&Game) -> bool,
) -> Result<Option<(Snapshot, Snapshot)>, String> {
    let t = play_seeded_setup(seed, max_taps, setup);
    let mut g = Game::new((&t.house_rules).into(), CASTLES, [&t.decks[0], &t.decks[1]]);
    let total = t.records.len();
    let snap = |g: Game, applied| Snapshot {
        game: g,
        applied,
        total,
        round: g.round,
    };
    let mut prev = snap(g, 0);
    for (applied, rj) in t.records.iter().enumerate() {
        if pred(&g) {
            return Ok(Some((prev, snap(g, applied))));
        }
        prev = snap(g, applied);
        let r = decode_record(rj).map_err(|e| format!("record {}: {e:?}", rj.seq))?;
        g.apply(&r)
            .map_err(|refusal| format!("record {} refused: {refusal:?}", rj.seq))?;
    }
    Ok(pred(&g).then_some((prev, snap(g, total))))
}

/// Replay one seeded game under `setup` and hand every committed transition to `visit` as
/// (state before the record, state after it). `visit` returns `true` to stop early. Used by the
/// state searches, which look at several predicates in one replay rather than one per predicate.
pub fn each_transition(
    seed: u64,
    max_taps: usize,
    setup: Setup,
    mut visit: impl FnMut(&Game, &Game, usize) -> bool,
) -> Result<(), String> {
    let t = play_seeded_setup(seed, max_taps, setup);
    let mut g = Game::new((&t.house_rules).into(), CASTLES, [&t.decks[0], &t.decks[1]]);
    for (applied, rj) in t.records.iter().enumerate() {
        let before = g;
        let r = decode_record(rj).map_err(|e| format!("record {}: {e:?}", rj.seq))?;
        g.apply(&r)
            .map_err(|refusal| format!("record {} refused: {refusal:?}", rj.seq))?;
        if visit(&before, &g, applied + 1) {
            break;
        }
    }
    Ok(())
}

/// The engine states either side of record `record` (1-based: the state after `record` records
/// have been applied, and the one before it) in one seeded game under `setup`.
pub fn transition_at(
    seed: u64,
    max_taps: usize,
    setup: Setup,
    record: usize,
) -> Result<(Game, Game), String> {
    let mut out = None;
    each_transition(seed, max_taps, setup, |b, a, n| {
        if n == record {
            out = Some((*b, *a));
            true
        } else {
            false
        }
    })?;
    out.ok_or_else(|| format!("seed {seed} has no record {record}"))
}

/// The final state of a seeded match — used by the result and sudden-death screens.
pub fn final_state(seed: u64, max_taps: usize) -> Result<Snapshot, String> {
    at_round(seed, u8::MAX, max_taps)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tapstone_rules::state::LANES;

    /// A mid-match snapshot must actually be mid-match, with the engine in Playing.
    #[test]
    fn replays_to_a_playable_round() {
        let s = at_round(7, 5, 400).expect("seed 7 replays");
        assert_eq!(s.game.phase, Phase::Playing);
        assert!(s.game.round >= 1);
        assert!(s.applied > 0, "some records must have been applied");
        assert!(s.applied <= s.total);
    }

    /// Stopping early must be genuinely earlier than playing the whole transcript.
    #[test]
    fn stopping_early_applies_fewer_records() {
        let early = at_round(7, 2, 400).expect("early");
        let late = at_round(7, 8, 400).expect("late");
        assert!(
            early.applied < late.applied,
            "round 2 ({}) should apply fewer records than round 8 ({})",
            early.applied,
            late.applied
        );
    }

    /// Asking past the end returns the finished game rather than an error.
    #[test]
    fn overshooting_returns_the_final_state() {
        let s = final_state(7, 400).expect("final");
        assert!(matches!(s.game.phase, Phase::Over | Phase::Playing));
    }

    /// The same seed and round must give the same board every time; the whole preview rests on it.
    #[test]
    fn snapshots_are_deterministic() {
        let a = at_round(3, 6, 400).expect("a");
        let b = at_round(3, 6, 400).expect("b");
        assert_eq!(a.game, b.game);
        assert_eq!(a.applied, b.applied);
    }

    /// By a mid match round there should be something on the board worth drawing.
    #[test]
    fn a_mid_match_board_has_units() {
        let s = at_round(7, 6, 400).expect("seed 7");
        let units: usize = s.game.seats.iter().map(|st| st.units()).sum();
        assert!(units > 0, "nothing to render at round {}", s.round);
        for seat in &s.game.seats {
            assert_eq!(seat.cells.len(), LANES);
        }
    }
}
