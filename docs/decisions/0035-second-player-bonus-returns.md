# 0035 — The second-player bonus goes back to 1, because the commander moved the edge
Date: 2026-09-23 · Lead's call under JP's delegation ("full auto") · Supersedes 0026's value · 0026's method stands

`second_player_bonus` returns to **1**. The reason is the one 0026 gave, pointed the other way: 0026
set the bonus to zero because it compounded an edge seat 1 already had. The commander (0029) moved
the edge to seat 0, and one card now corrects it better than zero does.

## Measured

Fresh commander mirror, seat 0 win %, 4,000 games (`tapstone-sim commander`, PR #49's harness;
Morpheus's sweep, reproduced by the lead on the merged engine for b1):

| bonus | Ember play-out | Ember pass-early | Tide play-out | Tide pass-early | worst distance from 50 |
|---|---|---|---|---|---|
| 0 *(was shipped)* | 57.5 | 59.6 | 57.8 | 62.9 | 12.9 |
| **1** | **45.1** | **55.8** | **45.0** | **60.8** | **10.8** |
| 2 | 34.2 | 54.0 | 37.6 | 60.2 | 15.8 |

Under 0026's rule, optimise the worst case when the pickers disagree this much, 1 wins on both
decks.

## What it does not fix, stated so nobody reads 1 as "fair"

- **The pickers disagree in sign again at 1**, which is 0026's shape exactly. Play-out puts seat 0
  at 45, and pass-early puts it at 56–61. One card is coarser than the residual, as 0026 found, so
  the fair point still sits inside a single step.
- **Tide under pass-early barely moves** across 0 → 2 (62.9 → 60.2). Whatever is favouring seat 0
  there is not the opening card. The turn-1 draw asymmetry 0026 named is still the structural
  candidate, and the first table test still outranks both pickers.

## Checked on the merged engine

- The 0030/0034 bound still passes at bonus 1 on **both** mirrors (exit 0). The worst kit is Haste:
  Ember 56.8 [55.66–57.83] play-out, and Tide 57.6 [56.51–58.68] play-out, which leaves 1.3 points
  of headroom (down from 1.97 at bonus 0). Output: `scratch/commander-station/0035-commander-gate*.txt`.
- Goldens regenerated deliberately. Every test that pinned seat 1's hand size moved by exactly the
  one bonus card and nothing else.
- The README's gate command ran only the Ember mirror by default. It now lists both.
