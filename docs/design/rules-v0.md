# Rules v0 — the first table test (DRAFT)

> **2026-09-23:** the board is drawn on the arena, not on the shrines (0028), and each seat has a commander (0029). Where this file says "shrine" for the board, read "arena".
Date: 2026-09-20 · Status: a minimal, playable draft to argue with. Assumes decision-matrix picks
Q1 → charge-the-shrine mana (decision 0007), Q2-D (cards are tapped, not placed), Q5–Q7 proposals.

## Components
Two shrines, paired. Two 30-card decks (one or two factions each; 25 until 0040). No mat needed for v0.

## Setup
Each player taps their **castle card** to claim a seat; seat 0 always goes first, so whoever claims
seat 0 opens the game (the engine has no coin). Draw 5 (second player 6). **Mulligan** once per
seat, on its first turn before any other action: the hand is set aside and the same count is drawn
from the remaining deck order (no penalty in v0; the engine refuses a later or second mulligan).

## The battlefield
Three lanes, drawn as three vertical columns on the panel (enemy at the top, you at the bottom, mirrored on the other shrine). Each lane has three cells per side: back, mid, front. Your castle sits behind your back
cells; the enemy castle behind theirs. Castles have 20 hit points.

## Turn (v0 plays alternating turns for the first table test; the ring-and-rounds structure in Q19 replaces this once the arena exists)
1. **Draw** one (the shrine shows your hand count; your hand is the physical cards).
2. **Mana** (decision 0007): once per turn a **Charge** tap removes a card from your hand and adds
   one permanent mana. Casting spends from charged minus what you spent this turn; spent resets
   at the start of your turn, so charged mana is available again every turn.
3. **Act**, any order, one tap per action:
   - **Summon**: tap a unit card; the shrine asks for a lane (touch). It enters your back cell
     (a **Rush** unit enters the mid cell). The entry cell must be empty.
   - **Cast**: tap a spell card; the shrine asks for a target if needed.
   - **Advance**: touch a lane; every unit of yours in it moves one cell forward if the next cell is
     empty, front-most first. A unit may advance only if it entered on an earlier round or has
     **Haste**. (One touch per lane per turn.)
4. **Combat** happens automatically at end of every turn, for both seats' units, simultaneous:
   damage is tallied first and applied together. **Targeting ruling (decision 0021):** if the enemy
   lane holds a **Taunt** unit, every attacker in that lane hits the nearest Taunt (front → back).
   Otherwise a melee unit attacks only from the front cell, hitting the enemy front cell or, if it is
   empty, the castle; a **Ranged** unit attacks from any cell, hitting the nearest enemy in the lane
   (front → back) or the castle. **Shield 1** absorbs one damage per combat. Units whose damage
   reaches their toughness die, swept after combat and after spells.
5. **Pass**: two-finger touch, or the shrine's pass button, or a 60-second timer.

## Cards
- **Unit**: cost, attack, toughness, one keyword at most in v0: **Ranged** (attacks from any cell),
  **Shield 1** (ignores one damage per combat), **Haste** (may Advance the turn it enters), **Rush**
  (enters the mid cell instead of the back cell), **Taunt** (every enemy attacker in this lane must
  hit it first).
- **Spell**: cost, effect from a closed list: damage N to a unit (or the castle where the card
  allows it), heal N, destroy a unit with toughness ≤ N, shift a unit one lane sideways, draw N.
  Mana and hand are checked before the effect resolves; a refused target costs nothing. A spell
  that brings a castle to 0 ends the game immediately.
- **Castle**: your faction's castle card; claims your seat and may have one passive.

## Second-player balance
Cards and Castles gives the second player a Medal of Bravery; v0 gives the second player one extra
card in the opening hand (6 instead of 5). Tune in playtest.

## Sudden death and end
From round 8 each castle loses 2 hit points at the start of its owner's turn. The game ends when
round 12 has been completed by both seats, or at once when a castle reaches 0: the higher castle
wins; tie goes to the player with more units on the board, then to the second player.

**Balance note (2026-09-22, third revision — read the warning first).** This note has now been
rewritten twice in two days because the instrument behind it was never validated. **Treat every
win-rate number in this repo as carrying the name of the picker that produced it.** The scripted
seats are not players, and the balance answer moves further when the picker changes than when the
rules change.

**The harness cannot currently answer balance questions.** Two pickers that differ in exactly one
respect — whether a seat keeps acting while it still has mana, cards and un-advanced lanes, or
passes early — give opposite answers to the same question. With the seat effect cancelled by
symmetry, Ember beats Tide 67.1% under the shipped picker and 44.9% under one that simply plays out
its turn. The shipped picker's *choices* are fine; three "smarter" variants (choosing units by
time-to-front, advancing the lane that makes progress, aiming removal at the biggest threat) were
each inert within noise. Its *activity level* is the artefact, and under-deployment punishes the
higher-curve deck, which is Tide.

**What this retracts.** The 2026-09-21 note's headline claims were all picker-conditional and should
not be relied on: that Ember beats Tide about 2:1 (it reverses), that the front-cell race decides
~88% of games (under a picker that plays out its turn both seats reach a front cell ~95% of the time
and it stops discriminating — it was a symptom of under-deployment, not a property of the rules),
and that one cheap Haste body is worth ~17 points (the Haste premium collapses to ~2.5 and Rush
overtakes it). **Do not redesign Tide on this evidence.** The claim that no house-rule constant
matters is also picker-conditional: `second_player_bonus` alone moves the mirror result 3 points
under the shipped picker and 17 under the other one.

**One finding is picker-independent and verifiable from the test suite: the second player gets two
extra cards, not one.** Decision 0011 grants `second_player_bonus` of 1 on top of a bonus the turn
structure already gives, because seat 0 never draws on its first turn while seat 1 draws before
its own. `tests/rules.rs` asserts exactly this and has since phase 1: after seat 0's first turn,
seat 1 holds 7 cards where seat 0 played its first turn with 5. Under a picker that converts cards
into plays, each extra card is worth almost exactly one extra summon, and the compensation
overshoots badly in both directions — equalise the counts and going first is worth 64–68%; leave
the shipped bonus in place and going second is worth 78–83%. The shipped picker hides this because
cards are nearly worthless to something that stops playing early.

**Also measured, and modest under both pickers:** Shield 1 absorbs about 7% of the damage its owner
takes, and Taunt pulls about 3% off its own castle, since Taunt only does anything when the Taunt
body is not itself in the front cell and the front cell is empty.

**Re-run 2026-09-22, picker fixed.** The picker now plays out its turn (`Style::PlayOut`, the
default; `PassEarly` preserves the old behaviour and reproduces every previous number to the
decimal). The engine was not touched — the golden transcripts moved because they pin the seat
heuristics, not the rules. Results below are named for their picker, and none of it is evidence
about human play.

**The constants came alive, as expected.** Spread across the nine house-rule variants is 14.6
points under play-out against 3.8 under pass-early; `castle_life 16` and `pressure_from 6` land on
50.0 where `castle_life 24` sits at 35.9. The earlier "no constant matters" was an artefact of a
picker too passive to feel them.

**The deck finding inverted and is now withdrawn.** Mirrors that sat on 50% under the old picker
are 26/74 under play-out, so there is a large *seat* effect, and the deck effect is smaller and no
longer cleanly signed — both decks appear to gain when facing the other, which points at a
conflation with game length rather than a transitive strength ordering. No direction is claimed.
What survives is the method: mirror and swap to separate seat from deck.

**The second-player compensation looks backwards, and this is the actionable one.** In a true
mirror under play-out, seat 0 wins 42.0% with `second_player_bonus` at 0, 26.1% at 1, and 17.9% at
2 — so a card is worth roughly 8 points, against ~2 under the old picker. That vindicates treating
the bonus as untested rather than ineffective: a mana-bound picker could not convert a card a
competent one can. But note the mirror is **already 42/58 with the bonus at zero**, because seat 1
also draws before its first turn while seat 0 never does. Decision 0011's bonus was designed to
help a second player assumed to be disadvantaged; it currently takes a 58% advantage to 74%. Two
independent pickers agree on the direction and roughly on the size. **This is a rules question and
it wants a ruling before the first table test.**

**What has to happen before any balance claim is trustworthy.** Fix the picker so a seat plays out
its turn, regenerate the goldens, and re-run the sweep on top of it. Then build two or three
*independently designed* pickers of different style — aggressive, controlling, and a shallow
one-ply search that evaluates the resulting board — and report every balance claim as a range
across all of them. A constant that moves the win rate the same way under all three is a real
effect; one that moves under only one is an artefact. The engine itself is not in question here:
both harnesses drive the shipped rules and agree with the engine's own combat output exactly.

## What the shrine enforces
Everything above. The physical cards are your hand and your deck; the screen is the board. A tap
the rules don't allow is refused with a reason on screen and a red LED pulse.

## What v0 deliberately leaves out
Hidden information tricks, counters, interrupts, unit abilities that trigger on the opponent's
turn (they need instant-speed taps and a priority system), more than two players, resource cards.
