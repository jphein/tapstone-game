# 0034 — Progression is breadth, not power
Date: 2026-09-23 · Delegated by JP ("as you suggest") · Supersedes 0030's level bonuses and 0031's stat items · 0030's bound stands

A commander still levels from 1 to 10, keeps its XP, wears gear and collects loot. **None of that adds
combat stats.** Every commander fights at base 2/4. A level buys **options**, and gear buys **a
sidegrade or a look**. The ≤60% bound in 0030 is kept, and this ruling is what passes it.

## What was measured

`scratch/commander-station/morpheus.md` and `morpheus-opening.md`, from PR #49's harness: a veteran
against an ungeared level-1 commander, mirror decks, seat-averaged, 4,000 seeds per seat order,
under both scripted pickers. Oracle independently reproduced the as-ruled +1 toughness, +1 attack,
Taunt and level-10 Ranged rows at 1,000 games. It did not re-run the opening probe or any breadth
cell.

- **A single stat point decides the game.** +1 toughness, which 0030 gave at level 3: 66–74%.
  Level 10 bare: 82–95%. A Ranged kit: ~100%. Changing the death penalty never brought +1 toughness
  under the bound.
- **No opening fixes it.** Five alternative openings were tried (lanes apart, a random lane, entering
  at round 2, round 2 with lanes apart, a deploy tap). The opening only changes *which* stat is decisive. With the commanders
  facing each other, toughness wins the duel. With them apart, attack wins, because an unopposed
  commander hits the castle. No opening passes both.
- **Breadth passes.** With no level stats and gear limited to Haste or Taunt, the worst kit under the
  ruled opening is **56.5 (Ember) / 57.0 (Tide) under play-out** and 52.6 / 53.8 under pass-early.
  All four are under 60 including their intervals (the probe reports ±≤1.1 on every veteran cell, so
  the worst case is at most 58.1).
- **Breadth passes only with the ruled opening.** The commanders must be on the board and facing
  each other at genesis. The same breadth kits **fail** when the commander arrives late: 61.3/67.0
  entering at round 2, 64.7/65.4 at round 2 with lanes apart, 67.7/70.4 by a deploy tap. A late Haste
  commander gains a lot. **Any future change to the opening must re-run this bound before it lands.**

## The rule

- **Levels 1–10 (5 XP each, per 0030) unlock:** the third gear slot at level 7, which is a **look
  slot**, because one keyword per commander already fits in two; cosmetic tiers for
  the paperdoll (0032) at levels 3, 5 and 10; and a wider loot table as the commander rises.
  **Levels give no attack and no toughness.**
- **Gear effects** are only **Haste** or **Taunt**, one keyword per commander. Every other item is a
  **look**: an overlay on the paperdoll and a name in the voice band, with no rule effect. This keeps
  0031's rule that an item card and a loot item with the same design have the same effect.
- **Ranged and Shield 1 never go on a commander.** Ranged measured ~100% in every opening, because it
  attacks from the back cell and melee cannot answer it. Shield 1 measured 68–82%. The engine will refuse
  both at `ClaimSeat`, as it already refuses Rush. That code change is owed in PR #49.
- **`progression = flat` stays** as a house rule, but with no stat progression it only equalises
  slot counts. It is kept for cosmetic parity and costs nothing.

## Why not the other two

- **Loosening the bound** makes a veteran a near-certain win against a newcomer. That is worst at
  the table this game is built for, friends of mixed experience on one evening. The bound is what
  lets a new player sit down and have a game.
- **The middle road** (commanders apart, +1 toughness at level 5 only, gear from Haste, Taunt and
  Shield 1, no Ranged) was measured as a full kit the same day, and **it fails** (see below). Its
  opening also gives seat 0 the worst edge measured (66.0 on Ember). It buys one stat point by costing every player the first-seat fairness.

## What stays open

- **The commander gives seat 0 an edge.** The fresh mirror measures seat 0 at 57.5–62.9 (0026's
  second-player edge has become a first-player edge). The lever 0026 left at zero,
  `second_player_bonus`, may now work in the right direction. That is measured next, as its own
  ruling.
- **Every number here comes from two heuristic pickers** (verification.md). The first table test
  can overturn any of them.

## What this reverses, said plainly

JP's ruling in 0030 was **real progression that affects play**. This record reverses that headline.
Under 0034 no level and no item changes the rules except by choosing a keyword (Haste or Taunt),
worth 0.3–2.4 points in the measurement. JP delegated the call ("as you suggest"), and the reversal
is recorded here and in 0030's banner rather than left implied. JP can reopen it. The way back is
to loosen the bound (option B), not to reinstate the old table against it.

## Follow-ons owed

- PR #49: the engine refuses Ranged and Shield 1 at `ClaimSeat`, and the sim tables drop level stats.
- PR #50: the station fixtures show 2/4 at every level, and level-ups announce unlocks, not stat gains.

## Measured 2026-09-23 — the middle road fails

The line above was first written as an inference, and it has since been measured
(`morpheus-opening.md`, "middle road"; probe branch `ec67caf`, never merged). Every level-10 kit
was enumerated at 4,000 seeds per seat, seat-balanced, and judged on the Wilson upper end:

| worst kit | Ember play-out | Ember pass-early | Tide play-out | Tide pass-early |
|---|---|---|---|---|
| Shield 1 | 63.5 over | 58.1 [57.0–59.2] | 75.0 over | 60.5 [59.4–61.6] over |
| bare 2/5 (the one +1 toughness) | — | — | 60.2 [59.1–61.2] over | — |
| Haste | 59.3 [58.2–60.3] over | — | — | — |

Two things follow. **The single +1 toughness is over the bound on its own**, so no stat-granting
level table survives in any opening measured. And **Shield 1 is the new Ranged**: it is the worst kit
in every cell (90.5 on Tide play-out under the ruled opening), which confirms excluding it here.

The seat trade is starker than the headline. Under lanes-apart on Ember play-out, the same veteran
wins **79.7% from seat 0 and 37.7% from seat 1**: the seat outweighs the whole level table. That is
the open seat-0 question in its sharpest form.
