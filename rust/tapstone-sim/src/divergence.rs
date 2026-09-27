//! What did the human do that no picker would have done?
//!
//! Designed before any human game existed, deliberately: an analysis written after the data can be
//! tuned, however honestly, to whatever the player happened to do. The four behaviours below are
//! the ones the pickers structurally cannot produce, so finding them is evidence that the
//! mana-bound heuristic model is wrong — and finding none is evidence it is closer than we feared.
//!
//! **This is a legible anecdote, not a measurement.**
//!
//! One game is one game. The value is that "he held Flare for two rounds and then cast it into a
//! front cell" is a sentence a designer can act on, and that ten such sentences start to rhyme.
//! Nothing here computes a rate or an interval, because with a dozen games neither would mean
//! anything and both would look as though they did.
use std::collections::HashMap;

use tapstone_rules::cards::design;
use tapstone_rules::state::{CELLS, LANES, Seat};
use tapstone_rules::{CardKind, Effect, Game, HouseRules, Kind, Phase};

use crate::human::legal_choices;
use crate::replay::{ReplayError, decode_record};
use crate::transcript::Transcript;
use crate::{CASTLES, Style, play_seeded_styled};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    /// One of the four hypotheses, as a stable key.
    pub kind: &'static str,
    pub round: u8,
    pub detail: String,
}

pub const KINDS: [(&str, &str); 4] = [
    ("held-a-card", "held a card that was already castable"),
    ("declined-to-deploy", "could deploy and did something else"),
    (
        "removal-off-nearest",
        "aimed removal away from the nearest target",
    ),
    (
        "passed-with-resources",
        "passed with a legal action still available",
    ),
];

fn card_name(id: u16) -> &'static str {
    design(id).map_or("?", |d| d.name)
}

/// The front-most occupied CELL DEPTH on the enemy side. Depth, not a cell: the picker scans
/// front to back and returns the first LANE it meets at that depth, so using its answer whole made
/// its tie-break the definition of "nearest" — two enemies at the same depth in different lanes,
/// and aiming at the second looked like a divergence. It is not; it is a coin toss the picker
/// happens to resolve by lane order.
fn nearest_depth(opp: &Seat) -> Option<usize> {
    (0..CELLS)
        .rev()
        .find(|&c| (0..LANES).any(|l| opp.cells[l][c].is_some()))
}

/// Cell 2 is the front, so a strictly SMALLER index is further back. Only that is a choice.
pub fn is_off_nearest(opp: &Seat, target_cell: usize) -> bool {
    nearest_depth(opp).is_some_and(|n| target_cell < n)
}

fn is_removal(card: u16) -> bool {
    matches!(
        design(card).map(|d| d.kind),
        Some(CardKind::Spell(Effect::Damage { .. }))
            | Some(CardKind::Spell(Effect::Destroy { .. }))
    )
}

/// Replay the transcript and read the human's decisions against what the pickers can produce.
pub fn analyse(t: &Transcript, human: u8) -> Result<Vec<Finding>, ReplayError> {
    // The decks the game was PLAYED with, not a guess rebuilt from the seed. `replay()` already
    // reads them; this did not, which was harmless only while `play` had no deck option — and it
    // has one now, so the analysis would have read a different game than the one played.
    let mut g = Game::new((&t.house_rules).into(), CASTLES, [&t.decks[0], &t.decks[1]]);
    let mut out: Vec<Finding> = Vec::new();
    // card id -> the first round it was castable while continuously in hand
    let mut castable_since: HashMap<u16, u8> = HashMap::new();
    // rounds in which the human deployed, so "declined to deploy" is judged per turn not per tap
    let mut deployed_this_round: Option<u8> = None;

    for rj in &t.records {
        let r = decode_record(rj)?;
        let acting_human = g.phase == Phase::Playing && r.seat == human;

        if acting_human {
            let me = &g.seats[(human & 1) as usize];
            let opp = &g.seats[1 - (human & 1) as usize];
            let choices = legal_choices(&g, human);

            // what is castable right now, by card
            let castable: Vec<u16> = choices
                .iter()
                .filter(|c| matches!(c.tap.kind, Kind::CastUnit | Kind::CastSpell))
                .map(|c| c.tap.card)
                .collect();
            for &card in &castable {
                castable_since.entry(card).or_insert(g.round);
            }
            // a card that left the hand, or stopped being castable, stops being "held"
            let in_hand: Vec<u16> = me.hand[..me.hand_len()].to_vec();
            castable_since.retain(|card, _| in_hand.contains(card) && castable.contains(card));

            let can_deploy = choices.iter().any(|c| c.tap.kind == Kind::CastUnit);
            // >>> "A LEGAL ACTION" IS NOT THE SAME AS "A RESOURCE". <<<
            // An advance of a lane holding no units is legal and moves nothing, so counting it as
            // something the player declined makes passing look deliberate when there was nothing
            // to do. The control caught this: it showed PlayOut "passing with resources" 2–9 times
            // a game, which is impossible by construction — PlayOut passes only when its own
            // candidates are exhausted. The label was wrong, not the picker.
            // Usefulness now comes from the engine's own Applied via Choice::is_useful(), not
            // from a substring of the UI label: keying an analysis to a human-facing string means
            // rewording a menu silently changes what is measured.
            let useful: Vec<&crate::human::Choice> = choices
                .iter()
                .filter(|c| c.tap.kind != Kind::Pass && c.is_useful(&g))
                .collect();
            let non_pass = !useful.is_empty();

            // >>> OUTSIDE the match on purpose. <<<
            // Advancing OR casting a spell while a unit could have been deployed. As a match arm
            // this matched Advance alone — CastSpell is claimed by the arm above — while the
            // report called the hypothesis "could deploy and did something else", so a player who
            // burned a spell instead of developing produced no finding at all.
            if matches!(r.kind, Kind::Advance | Kind::CastSpell)
                && can_deploy
                && deployed_this_round != Some(g.round)
            {
                out.push(Finding {
                    kind: "declined-to-deploy",
                    round: g.round,
                    detail: format!(
                        "{} while able to deploy a unit ({} mana available) — racing rather than \
                         developing",
                        if r.kind == Kind::Advance {
                            format!("advanced lane {}", r.lane)
                        } else {
                            format!("cast {}", card_name(r.card))
                        },
                        me.available_mana()
                    ),
                });
            }

            match r.kind {
                Kind::CastUnit | Kind::CastSpell => {
                    // HELD: castable in an earlier round, and only cast now.
                    if let Some(&since) = castable_since.get(&r.card)
                        && since < g.round
                    {
                        out.push(Finding {
                            kind: "held-a-card",
                            round: g.round,
                            detail: format!(
                                "{} was castable from round {since} and was cast in round {} — \
                                 {} round(s) held; no picker ever does this",
                                card_name(r.card),
                                g.round,
                                g.round - since
                            ),
                        });
                    }
                    if r.kind == Kind::CastUnit {
                        deployed_this_round = Some(g.round);
                    }
                    // REMOVAL: aimed somewhere other than the picker's front-to-back nearest.
                    if r.kind == Kind::CastSpell && is_removal(r.card) && r.target != 0xFF {
                        let (ts, tl, tc) = ((r.target >> 4) & 1, (r.target >> 2) & 3, r.target & 3);
                        if usize::from(ts) != usize::from(human & 1)
                            && is_off_nearest(opp, usize::from(tc))
                            && let Some(n) = nearest_depth(opp)
                        {
                            out.push(Finding {
                                kind: "removal-off-nearest",
                                round: g.round,
                                detail: format!(
                                    "{} aimed at lane {tl} {}, reaching past a target in the {} \
                                     row",
                                    card_name(r.card),
                                    ["back", "mid", "front"][usize::from(tc)],
                                    ["back", "mid", "front"][n]
                                ),
                            });
                        }
                    }
                }

                Kind::Pass if non_pass => {
                    let castables = castable.len();
                    out.push(Finding {
                        kind: "passed-with-resources",
                        round: g.round,
                        detail: format!(
                            "passed with {} mana, {castables} castable card(s) and {} useful \
                             action(s) available",
                            me.available_mana(),
                            useful.len()
                        ),
                    });
                }
                _ => {}
            }
        }

        g.apply(&r).map_err(|refusal| ReplayError::Refused {
            seq: r.seq,
            refusal,
        })?;
        if g.active != human {
            deployed_this_round = None;
        }
    }
    Ok(out)
}

/// (hypothesis key, fewest seen in one game, most seen in one game)
pub type ControlRange = (&'static str, u32, u32);

/// (picker name, its range per hypothesis)
pub type Control<'a> = (&'a str, Vec<ControlRange>);

/// **The picker's own rate is the control, and without it the counts mean nothing.**
///
/// Three of the four behaviours are things a picker does not do ON PURPOSE but can still produce
/// by accident: it can leave a castable card and cast it next turn simply because the weights sent
/// it elsewhere. So "the human held a card twice" is only evidence if a picker playing the same
/// rules holds one less often than that. This runs the same analysis over the pickers' own games
/// and reports the range, so a reader can see which of the human's counts are actually unusual.
pub fn baseline(
    rules: HouseRules,
    taps: usize,
    games: u32,
    style: Style,
    // The seat this control is FOR. All eight ranges differ by seat, so a seat-1 human read
    // against a seat-0 control is read against a control that does not apply to him.
    seat: u8,
) -> Vec<ControlRange> {
    let mut lo: HashMap<&str, u32> = HashMap::new();
    let mut hi: HashMap<&str, u32> = HashMap::new();
    for seed in 1..=u64::from(games) {
        let t = play_seeded_styled(seed, taps, rules, style);
        let f = analyse(&t, seat).expect("a scripted transcript replays");
        for (key, _) in KINDS {
            let n = f.iter().filter(|x| x.kind == key).count() as u32;
            lo.entry(key).and_modify(|v| *v = (*v).min(n)).or_insert(n);
            hi.entry(key).and_modify(|v| *v = (*v).max(n)).or_insert(n);
        }
    }
    KINDS.iter().map(|(k, _)| (*k, lo[k], hi[k])).collect()
}

/// A page a designer can read, grouped by hypothesis with the turns attached.
pub fn report(t: &Transcript, human: u8, findings: &[Finding], controls: &[Control<'_>]) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "divergence — seed {}, human = seat {human}, {} records, {} rounds\n\n",
        t.seed,
        t.records.len(),
        t.rounds
    ));
    for (key, title) in KINDS {
        let hits: Vec<&Finding> = findings.iter().filter(|f| f.kind == key).collect();
        let turns: Vec<String> = hits.iter().map(|f| f.round.to_string()).collect();
        s.push_str(&format!(
            "  {:<22} {:>2}{}\n",
            key,
            hits.len(),
            if turns.is_empty() {
                String::new()
            } else {
                format!("   round(s) {}", turns.join(", "))
            }
        ));
        s.push_str(&format!("      {title}\n"));
        for (picker, ranges) in controls {
            if let Some((_, lo, hi)) = ranges.iter().find(|(k, _, _)| *k == key) {
                s.push_str(&format!(
                    "      control: {picker} does this {lo}–{hi} times in a game of its own\n"
                ));
            }
        }
        for f in hits {
            s.push_str(&format!("      · round {}: {}\n", f.round, f.detail));
        }
        s.push('\n');
    }
    s.push_str(
        "  One game is an anecdote. This report exists to make it a LEGIBLE one: each line is a\n\
         \x20 sentence about play a designer can act on or dismiss. No rate is computed and no\n\
         \x20 interval is quoted, because over a dozen games neither would mean anything.\n\
         \x20 Read each count against its control line: a human doing something the picker also\n\
         \x20 does at that rate is not evidence of anything, however human it looks.\n",
    );
    s
}
