# 0026 — The second-player bonus goes to zero; the residual is structural and deferred
Date: 2026-09-22 · Supersedes the compensation in 0011 · Delegated by JP

> **Value superseded by 0035 (2026-09-23):** the commander moved the seat edge to seat 0, so the bonus returns to 1. The method here, optimising the worst case across pickers, is what chose it.

`second_player_bonus` becomes **0**. The remaining unfairness is real, is not reachable through the
house-rule constants, and is deliberately **not** fixed yet.

## What 0011 assumed, and what is actually true

0011 gave the second player an extra opening card on the Cards and Castles precedent, assuming the
second player is disadvantaged. In this engine they are not. Seat 1 also draws before its first turn
while seat 0 never does, so the shipped rules hand the second player **two** extra cards, not one —
`tests/rules.rs` has asserted seat 1 at 7 cards against seat 0's 5 since phase 1, and nobody read
what it implied. A compensation designed to correct a disadvantage was compounding an advantage.

## Why zero, when zero is not fair either

Measured on a mirror (identical decks, identical rules, so any deviation from 50% is rule-level):

| configuration | play-out picker | pass-early picker |
|---|---|---|
| as shipped (bonus 1) | 27.6 ±1.4 | 49.6 ±1.5 |
| bonus 0 | 43.0 | ~53.2 |

The two pickers disagree **in sign** here, and that is the whole reason for the ruling. Under the
weaker picker the shipped value looks nearly perfect; under the stronger one it is 22 points out.
If a human sits somewhere between the two, then shipped is between 0.4 and 22.4 points from fair
while bonus 0 is between 3.2 and 7.0. **Zero has the far better worst case**, and under uncertainty
this large the worst case is the number to optimise. Zero is also the only move available that costs
nothing else: it does not shorten the game, change the card set or touch turn structure.

## Confirmed 2026-09-22: no value of the bonus can land on fair

Measured at the shipped length on a mirror, 4000 games per cell:

| bonus | play-out | pass-early | rounds |
|---|---|---|---|
| 0 | 42.7 ±1.5 | 52.6 ±1.5 | 7.31 |
| 1 *(was shipped)* | 27.6 ±1.4 | 49.6 ±1.5 | 7.22 |
| 2 | 18.2 ±1.2 | 47.8 ±1.5 | 7.08 |

Zero buys 15.1 points under play-out and costs 3.0 under pass-early, which is the trade this
decision takes. **But one card moves the mirror 15.1 points and the fair point sits *inside* that
single step. There is no fractional card, so `second_player_bonus` cannot land on 50 at any value.**
That is the sharpest form of the finding: this is not a badly-chosen number, it is a lever with
coarser resolution than the target.

Widening to 90 configurations: fair is reachable under play-out alone (21 of 90), but under **both**
pickers only 2 of 90 qualify — and both keep `bonus = 1` with a 4.5-round game, which is a different
game rather than a fairer one. Castle life *is* a finer lever than a card, but it reaches fair only
by shortening the match, trading fairness against length instead of correcting the asymmetry.

**The shape the data points at is the shape the type cannot express.** The compensation that would
land on 50 at a playable length is sub-card and *asymmetric* — seat 0 starting with a couple more
hit points than seat 1 — and `castle_life` is a single `u8` applied to both seats. 0011's successor
therefore needs a structural change, not a different number. The other structural candidate remains
the turn-1 draw asymmetry.

## A number that will mislead you later, recorded now

With `bonus = 0` in place, the **real asymmetric matchup** (Ember against Tide) measures 48.9 ±2.2
under play-out — very nearly fair. **Do not read that as the opening being fixed.** It is two errors
cancelling: Ember's deck advantage now roughly offsets seat 1's structural advantage. The mirror,
which is the only measurement that isolates a seat effect, is still 42.7. Under pass-early the same
asymmetric matchup is 69.8, because there the deck effect dominates and there is no seat effect left
to cancel it.

So the shipped configuration will look fair to anyone who measures the game as it is actually
played, and will stay unfair the moment the decks are balanced against each other. Whoever fixes
the deck matchup must re-measure the seat asymmetry at the same time, or a correction in one will
silently expose the other.

## Why the residual is not being fixed

A 225-configuration search over `second_player_bonus` × `castle_life` × `pressure_from` ×
`stop_round`, 4000 games each, found **no configuration that is fair at a playable game length**.
The best inside the plausible range is 47.5 ±1.5, with 50 outside the interval; at the ~7-round
length 0011 targets, the best available is about 43%. Fair configurations do exist and every one of
them is a 4.5–6 round game — `castle_life` and `pressure_from` are not independent levers, they
work only by shortening the match so the second player's compounding advantage has less time to
accrue.

So the residual needs a **structural** answer, and the likeliest candidate is the turn-1 draw
asymmetry itself, which is turn structure rather than a house rule. That change is deferred on
purpose. A card is worth roughly 8 points to a picker that spends cards mechanically; to a person
choosing *when* to spend one it may be worth much more or much less, and **that uncertainty is
larger than every difference the sweep measured**. Fixing a 7-point residual precisely against a
heuristic would be fitting the rules to the instrument. The first table test settles it.

## A finding worth acting on separately

The endgame rules are dead code and fairness does not revive them. Across nearly every
configuration tested, games end 4000/4000 by lethal; the stop round fires a handful of times and
the tiebreak decides single-digit numbers of games. Pressure from round 8 and the round-12 stop
were designed for a game that does not happen. That is a separate question from fairness and wants
its own ruling.

## Standing caveat

Every number here comes from weighted heuristics that never bluff, never hold a card for a purpose
and never race. They are evidence about the rules under two named pickers, not about human play.
