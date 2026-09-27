> **This report changes no rules, cards or decks.** It measures why Ember beats Tide with today's lists. Every "change" below is a scratch experiment on an evidence branch, labelled as a finding, not a proposal.

# Why Ember beats Tide: a sim-backed decomposition

Date: 2026-09-27 · Author: Pollux (overnight lane, item 9) · Status: **report, for JP** · Part of #131 ·
Related: #147 (set 1 expansion proposal, not merged) · Evidence: branch `scratch/pollux-imbalance-sim` at `50799ac`
(never for merge), `scratch-sim/imb/`.

## Headline

With today's lists (`decks/ember-neutral.toml`, `decks/tide-neutral.toml`), **Ember wins 71.9% seat-averaged
under play-out and 69.7% under pass-early** (4,000 games per seat order, ±1.0 at 95%). The measured causes, largest first:

1. **Spells, and how cheaply they trade.** Stop Ember's picker casting spells and Ember falls to 47.8% (−24.1). Stop Tide's
   and Ember rises only to 76.5% (+4.7). With neither casting spells Ember still wins 55.1%, so about 17 of Ember's 22
   points sit in the spell asymmetry and about 5 in the bodies (play-out). Flare is the single most valuable Ember card
   (−10.5 when removed), because 2 damage for 1 mana kills Reef Archer and Pearl Shieldbearer, both 2-mana units. Tide's
   removal mostly trades down: a third of Riptide casts spend 3 mana to kill a 1-mana Cinder Whelp.
2. **Curve and tempo, not mana supply.** Both seats hold the same mana at the start of rounds 2–4 (1, 2, 3) and stay within
   0.25 of each other through round 8 (play-out), because both charge every round. What differs is what that mana buys: Ember's list averages 1.48 mana a card and
   holds 17 one-cost cards, Tide's averages 2.00 and holds no one-cost unit. Ember casts 4.85 units a game to Tide's 2.89.
   One extra permanent mana for Tide is worth 29.6 points, so the whole gap is about three quarters of a mana.
3. **The race is over before Tide's board arrives.** Tide's castle is at 11.6 life when round 4 starts, Ember's at 16.5.
   Ember wins 100% of games that end by round 4 and 94.1% of those ending in round 6; 71% of games end by round 7. Tide's board
   passes Ember's from round 6, and Tide wins 64.6% of games that reach round 8.
4. **Reef Archer carries Tide.** Remove it and Ember wins 96.6%; strip only its Ranged and Ember wins 98.0%. It is Tide's
   one card that deals damage without advancing. Pearl Shieldbearer and Undertow are the opposite: Tide's list is better
   without either (−6.7 and −3.7 for Ember).
5. **The seat and the house rules are small next to this.** In a mirror the seat is worth 4.5 points (play-out) and 6 to 10
   (pass-early); in the asymmetric pairing the seat moves Ember by ±2.0 (play-out). The second-player bonus moves Ember
   by about 3 points a card (play-out), and the commander-fall rule by at most 4.3.

**Smallest change that brings Tide within ±5 of 50 (finding, not a proposal).** No single card edit of the 22 tried and no
move of one or two copies does it. The smallest that lands under play-out is **a list change with no card edited: Tide plays
3 more Reef Archers instead of its 3 Pearl Shieldbearers** (Ember 49.3%, 49.8% at 16,000 games), but it leaves pass-early at
59.4%. The smallest that lands under **both** pickers is **two cost edits: Cinder Whelp and Flare each cost 2** (Ember 52.9%
play-out, 52.2% pass-early; 52.9 / 51.8 at 16,000 games; seat split 56 / 50). §8 has the ladder, and shows why the two-edit
pairs that make Reef Archer cost 1 also land but hide a seat swing of 11–15 points.

## 1. Method and instrument

- `tapstone-sim balance`, 4,000 games per cell, seeds 1..=4000, `--variant baseline` (today's house rules), `--picker` and
  `--picker1`. `tapstone-sim fairness` for the mirror grids.
- **Every cell is run in both seat orders and averaged**, so a deck number never carries the seat. "Ember %" below always means
  seat-averaged unless a column says "as seat 0" or "as seat 1". The half-width at 95% is ±1.0 for a seat-averaged cell
  (±0.5 at 16,000).
- **Every number carries its picker** (verification.md). PO = both seats play out their turn; PE = both pass early; MIX-E =
  Ember plays out and Tide passes early; MIX-T the reverse. The pickers' choices are fixed: damage spells hit the front-most
  enemy unit first and go to the castle only when the board is empty; charge takes the cheapest card in hand; Undertow shifts
  the first enemy unit that has a free neighbouring cell.
- Deck and card experiments use **scratch env knobs** in the sim (`TS_DECK<s>` for an exact 25-card list, `TS_MANA<s>`,
  `TS_LIFE<s>`, `TS_NOSPELL<s>`, `TS_CFALL`) and **scratch card TOMLs** `st1-014..040` (keyword ablations, cost ±1, one-point stat
  edits). They exist only on the evidence branch. `TS_MANA` and `TS_LIFE` are instruments, used to put an exchange rate on the gap;
  nobody is suggesting them as rules.

**Controls.**

| control | expected | measured |
|---|---|---|
| today's pairing through the drivers | #147's figures | PO 71.9 (73.9 / 69.8), PE 69.7 (76.8 / 62.7) |
| today's lists passed through `TS_DECK` | byte-identical table | identical (test `shipped_lists_through_the_knob_change_nothing`) |
| Tide list through `TS_DECK` on both seats | = built-in `mirror-tide` | identical (test `deck_knob_reproduces_the_builtin_mirror`) |
| Cinder Whelp → a twin card (same stats, new id), all 5 | +0.0 | +0.0 PO, +0.0 PE |
| Tidal Lash → a twin card, all 3 | +0.0 | +0.0 PO, +0.0 PE |
| `golden check` with 27 scratch cards compiled in | seeds 1–3 ok | exit 0 |
| pressure instrument's winners | = `balance` for the same config | asserted per run; a picker swap planted in the driver was caught (32.2 vs 95.75) |
| finalists at 16,000 games | within noise of 4,000 | all within 0.8 |
| `fairness` mirrors, shipped row | 0036's figures | mirror-ember 45.5 / 56.2, mirror-tide 45.5 / 59.8 |

Each knob was perturbed once (applied to the wrong seat, or ignored) and its test went red, then green after a fresh-write
restore and rebuild: five knob perturbations and the pressure-instrument one, all recorded in the lane log.

## 2. By the seat

| picker | mirror-ember, seat 0 | mirror-tide, seat 0 | Ember as seat 0 | Ember as seat 1 | Ember, seat-averaged |
|---|---|---|---|---|---|
| PO | 45.5 | 45.5 | 73.9 | 69.8 | 71.9 |
| PE | 56.2 | 59.8 | 76.8 | 62.7 | 69.7 |
| MIX-E | 88.2 | 90.0 | 95.8 | 93.2 | 94.5 |
| MIX-T | 11.7 | 14.3 | 32.2 | 25.5 | 28.9 |

The seat is worth ±2.0 around Ember's 71.9 under play-out and ±7.0 around 69.7 under pass-early. The deck gap is 22 and 20.
The second-player bonus (house rule, 0035), seat-averaged: bonus 0 → 68.4 PO / 69.0 PE, 1 (today) → 71.9 / 69.7, 2 → 74.6 / 70.4.
Each extra card moves seat-averaged Ember up by 2.7–3.5 under play-out (0.2–0.7 under pass-early): the card helps Ember in seat 1
more than it helps Tide in seat 1, which fits a list that turns cards into board faster.

## 3. By the picker

The picker moves the answer further than the decks do. When the seats play differently, the seat that plays out wins whichever deck it
holds: Ember playing out against a pass-early Tide wins 94.5%, and a play-out Tide beats a pass-early Ember 71.1% (Ember 28.9).
The deck gap only means anything with the pickers matched, and under matched pickers it is 71.9 (PO) and 69.7 (PE). The two
agree on the direction and size of the gap, but not on the causes: Deep Breath is worth 5.1 to Ember under play-out and −1.3 under
pass-early, and most card effects are about half as large under pass-early (§5–§6). Every finalist in §8 still leaves the mixed rows
at 74–90 (MIX-E) and 11–21 (MIX-T).

## 4. By the curve and the mana

| list | mean cost | units | 1-cost cards | 1-cost units |
|---|---|---|---|---|
| Ember | 1.48 | 13 / 25 | 17 | 5 (Cinder Whelp) |
| Tide | 2.00 | 10 / 25 | 6 (the neutrals) | 0 |

| picker | faction | units cast / game | faction spells cast / game | mana spent on faction cards / game |
|---|---|---|---|---|
| PO | Ember | 4.85 | 0.96 | 10.92 |
| PO | Tide | 2.89 | 1.58 | 10.70 |
| PE | Ember | 4.28 | 0.94 | 9.43 |
| PE | Tide | 2.41 | 1.12 | 8.36 |

(Per game, both seat orders pooled; Ember's wins are shorter games, so these understate Ember's rate per round.)

**Mana supply is equal; what it buys is not.** At the start of rounds 2–5 under play-out both factions hold 1.00, 2.00, 3.00
and 3.99 / 4.00 mana (§7's table). The exchange rates below put a size on the tempo gap:

| instrument (not a rule) | Ember PO | Ember PE |
|---|---|---|
| Tide starts with +1 permanent mana | 42.2 (−29.6) | 44.1 (−25.6) |
| Tide +2 mana | 27.7 (−44.2) | 28.0 (−41.8) |
| Ember +1 mana (the other direction) | 89.2 (+17.3) | 84.2 (+14.4) |
| Tide castle +4 life | 62.1 (−9.7) | 64.8 (−5.0) |
| Tide castle +8 life | 52.2 (−19.7) | 59.5 (−10.2) |
| Tide castle +10 life | 47.2 (−24.7) | 57.1 (−12.7) |

The gap is worth about 0.75 of a permanent mana, or about 9 castle life under play-out (more than 10 under pass-early).

**One cost step on one card** (seat-averaged Ember %, change from today):

| edit | PO | PE |
|---|---|---|
| Cinder Whelp cost 2 | 59.4 (−12.5) | 62.8 (−6.9) |
| Flare cost 2 | 66.9 (−5.0) | 65.2 (−4.6) |
| Reef Archer cost 1 | 60.6 (−11.3) | 58.1 (−11.6) |
| Undertow cost 1 | 66.3 (−5.6) | 66.9 (−2.8) |
| Tidal Lash cost 1 | 68.8 (−3.1) | 66.2 (−3.6) |
| Tidecaller cost 2 | 70.7 (−1.2) | 66.5 (−3.2) |
| Riptide cost 2 | 71.4 (−0.5) | 69.1 (−0.6) |

A 1-cost unit for Tide helps a lot if it is the Archer (60.6). Adding Cinder Whelp to Tide's list does not help under play-out
(73.5, +1.6) and barely under pass-early (68.1, −1.6), so the missing 1-drop is not the whole story. What Tide lacks is cheap damage that does not have to walk.

## 5. By the card

**Drop every copy, re-cycle the rest of the list to 25** (so each card is measured against the average of its own list):

| list without | PO | PE | reading |
|---|---|---|---|
| Ember − Flare | 61.4 (−10.5) | 60.1 (−9.6) | Ember's most valuable card |
| Ember − Deep Breath | 66.7 (−5.1) | 71.1 (+1.3) | picker-dependent |
| Ember − Cinder Whelp | 70.1 (−1.7) | 68.3 (−1.4) | |
| Ember − Mend | 71.2 (−0.7) | 68.4 (−1.3) | |
| Ember − Ashen Vanguard | 75.6 (+3.7) | 71.5 (+1.8) | below Ember's average |
| Ember − Hearth Warden | 79.1 (+7.2) | 74.1 (+4.3) | a liability for Ember |
| Tide − Reef Archer | 96.6 (+24.7) | 82.2 (+12.5) | Tide's load-bearing card |
| Tide − Tidal Lash | 78.5 (+6.6) | 75.7 (+5.9) | |
| Tide − Mend | 76.5 (+4.6) | 72.8 (+3.1) | |
| Tide − Deep Breath | 76.0 (+4.1) | 71.8 (+2.0) | |
| Tide − Riptide | 75.5 (+3.6) | 72.0 (+2.3) | |
| Tide − Tidecaller | 73.0 (+1.1) | 67.3 (−2.4) | about average |
| Tide − Undertow | 68.2 (−3.7) | 68.5 (−1.2) | Tide is better without it |
| Tide − Pearl Shieldbearer | 65.2 (−6.7) | 66.6 (−3.2) | Tide is better without it |

**Transplants** (add one design to the other list, re-cycled, so the newcomer is measured against the receiving list's average).
A Tide design in Ember's list helps Ember only if it is Reef Archer (74.5, +2.7) or Tidal Lash (73.2, +1.3); Undertow drops Ember
to 54.0 (−17.9), Tidecaller to 62.8 (−9.0), Riptide to 65.6 (−6.3). An Ember design in Tide's list makes Tide weaker every time under
play-out: Hearth Warden 81.6 (+9.7), Ashen Vanguard 75.0, Flare 74.6, Cinder Whelp 73.5. Under pass-early, Whelp and Flare help Tide
a little (68.1 and 68.2). So Ember's cards are not simply better cards. They work in Ember's list, against Tide's units.

**Interactions (2×2).** Reef Archer's value does not depend on Cinder Whelp: without both, Ember is at 91.1 (Archer alone +24.7,
Whelp alone −1.7). It is not mainly about surviving Flare either: Archer 1/3 (out of Flare's reach) moves Ember only to 67.0 (−4.9),
while Archer 2/2 moves it to 56.3 (−15.6). The Archer's *attack* is what Tide is short of.

## 6. By the mechanic

| ablation | PO | PE |
|---|---|---|
| Ember's picker casts no spells | 47.8 (−24.1) | 56.1 (−13.7) |
| Tide's picker casts no spells | 76.5 (+4.7) | 76.3 (+6.5) |
| neither casts spells | 55.1 (−16.8) | 62.5 (−7.2) |
| Cinder Whelp without Haste | 65.9 (−6.0) | 65.5 (−4.2) |
| Ashen Vanguard without Rush | 62.5 (−9.3) | 64.9 (−4.8) |
| Hearth Warden without Taunt | 70.3 (−1.6) | 67.8 (−2.0) |
| Flare hits units only (no castle) | 72.0 (+0.2) | 69.7 (−0.1) |
| Reef Archer without Ranged | 98.0 (+26.1) | 84.2 (+14.5) |
| Pearl Shieldbearer without Shield | 74.0 (+2.2) | 70.3 (+0.6) |
| commander fall 0 (today 3), both seats | 67.5 (−4.3) | 69.1 (−0.7) |
| commander fall 5 | 74.3 (+2.5) | 70.6 (+0.9) |

- **Spells** are where the gap lives (see the headline). Flare's castle reach is worth nothing (+0.2) because the picker aims it at
  units first; it went to the castle in 2% of casts under play-out, 9% under pass-early.
- **Haste and Rush** are worth 6 and 9 points to Ember under play-out: they are how Ember's pressure lands in rounds 2–4.
  **Taunt** is worth 1.6, and Hearth Warden as a whole is below Ember's average.
- **Ranged** is the whole of Tide's game plan against this picker.
- **Charge** was not ablated (without it nobody casts). It is measured instead through the mana exchange rate (§4) and the equal
  mana at every round start (§7), which is where charge's effect on the gap would show.
- **Commander fall** contributes at most about 4 points. Flare hits the commander often (next section), but taking the castle-life
  penalty away entirely moves Ember only to 67.5.

**What the spells actually hit** (play-out, 8,000 games, both seat orders; "gone" = the target left its cell):

| spell (cost) | target | share of casts | gone |
|---|---|---|---|
| Flare (1) | commander | 61% | 22% |
| Flare (1) | Reef Archer (2) | 18% | 100% |
| Flare (1) | Pearl Shieldbearer (2) | 12% | 100% |
| Flare (1) | Tidecaller (3) | 7% | 24% |
| Flare (1) | castle | 2% | — |
| Riptide (3) | Ashen Vanguard (3) | 66% | 100% |
| Riptide (3) | Cinder Whelp (1) | 34% | 100% |
| Tidal Lash (2) | commander | 42% | 44% |
| Tidal Lash (2) | Cinder Whelp (1) | 30% | 100% |
| Tidal Lash (2) | Hearth Warden (2) | 17% | 100% |
| Tidal Lash (2) | Ashen Vanguard (3) | 11% | 100% |
| Undertow (2) | commander / Warden / Vanguard / Whelp | 44% / 27% / 17% / 12% | shifted, nothing killed |

Flare kills a 2-mana unit for 1 mana in 30% of its casts. Tide's removal kills a 1-mana Whelp for 2 or 3 mana in 30–34% of its
casts, and Undertow's 3,830 casts move a unit one lane and kill nothing. The last is a picker artefact: its shift target has no
purpose. Undertow is the one Tide card whose worth depends on targeting this picker does not have, so Tide's real gap with a
thoughtful player may be smaller than the sim says.

## 7. By the lane pressure timing

Play-out, 8,000 games (both seat orders), at the start of each round:

| round | Ember castle | Tide castle | Ember units | Tide units | Ember mana | Tide mana |
|---|---|---|---|---|---|---|
| 2 | 20.0 | 20.0 | 1.52 | 1.00 | 1.00 | 1.00 |
| 3 | 18.6 | 16.5 | 1.93 | 1.33 | 2.00 | 2.00 |
| 4 | 16.5 | 11.6 | 2.09 | 1.54 | 3.00 | 3.00 |
| 5 | 15.3 | 9.0 | 2.54 | 2.41 | 3.99 | 4.00 |
| 6 | 13.0 | 8.0 | 2.81 | 3.20 | 4.91 | 4.98 |
| 7 | 9.9 | 7.6 | 2.21 | 3.38 | 5.72 | 5.84 |
| 8 | 5.7 | 5.8 | 1.59 | 3.15 | 6.42 | 6.65 |

(Units include the commander.) Both sides first hit the other's castle at about the same time, round 2.50 for Ember and 2.64 for Tide,
but Tide loses 8.4 life in rounds 2–3 to Ember's 3.5.

| game ended in round | games | Ember wins |
|---|---|---|
| ≤ 4 | 1,155 | 100.0% |
| 5 | 1,856 | 99.2% |
| 6 | 1,311 | 94.1% |
| 7 | 1,382 | 51.1% |
| ≥ 8 | 2,296 | 35.4% |

Pass-early tells the same story more slowly (Ember 99.3% by round 4, 44.2% at round 8 or later). The house rules that set the
race's length bear this out:

| house rule (both seats) | PO | PE |
|---|---|---|
| castle life 14 | 80.7 (+8.8) | 71.3 (+1.5) |
| castle life 24 | 66.3 (−5.6) | 68.5 (−1.2) |
| castle life 32 | 56.2 (−15.7) | 64.2 (−5.5) |
| pressure from round 5 | 79.5 (+7.6) | 71.5 (+1.8) |
| pressure from round 12 | 69.3 (−2.5) | 68.6 (−1.1) |

Longer games help Tide under play-out and barely under pass-early. Sudden death is not the problem: Ember has usually won before round 8.

## 8. The smallest change that brings Tide within ±5 of 50 (finding, not a proposal)

513 cells were searched: moving 1–4 copies of one design to another inside either list (same faction or neutral), 22
single-design edits (one stat point, one cost step or one keyword), a neutral edit and every pair of edits on different designs.
The target is seat-averaged Ember within 45–55.

| rung | smallest that lands under PO | PO | PE |
|---|---|---|---|
| 1–2 copies moved | none (closest: Tide 2× Shieldbearer → Archer) | 57.0 | 62.6 |
| 1 design edited | none (closest: Flare deals 1) | 56.2 | 60.3 |
| **3 copies moved** | **Tide 3× Pearl Shieldbearer → Reef Archer (no card edited)** | **49.3** | 59.4 |
| 2 designs edited | 37 pairs land under PO; 6 under both pickers | | |

The six that land under both pickers, re-run at 16,000 games (±0.5), with the seat split the averaging hides:

| two edits | PO | PE | Ember as seat 0 / seat 1 (PO) | MIX-E / MIX-T |
|---|---|---|---|---|
| **Cinder Whelp cost 2 + Flare cost 2** | **52.9** | **51.8** | 55.9 / 49.8 | 88.0 / 11.1 |
| Cinder Whelp without Haste + Flare deals 1 | 48.2 | 54.4 | 51.0 / 45.5 | 84.8 / 13.8 |
| Cinder Whelp cost 2 + Reef Archer cost 1 | 51.7 | 51.0 | 45.6 / 57.8 | 78.8 / 16.1 |
| Reef Archer cost 1 + Undertow cost 1 | 50.0 | 51.4 | 42.6 / 57.5 | 79.1 / 17.5 |
| Ashen Vanguard without Rush + Reef Archer cost 1 | 51.3 | 53.2 | 44.7 / 57.9 | 80.6 / 18.6 |
| Flare deals 1 + Reef Archer cost 1 | 46.7 | 46.9 | 41.2 / 52.3 | 74.4 / 16.0 |

The 3-copy list change at 16,000 games: 49.8 PO, 58.8 PE, seat split 53.6 / 46.0, MIX-E / MIX-T 87.2 / 16.8.

Reading, as a finding:
- **Nothing single does it.** Of one-edit changes, Flare dealing 1 (56.2) and Archer 2/2 (56.3) come closest under play-out.
- **The cheapest list-only fix is more Archers**, the card §5 found load-bearing, in place of the card Tide is better without.
  It fixes play-out, not pass-early (59.4).
- **The cheapest fix under both pickers slows Ember's two 1-cost engines**, Cinder Whelp and Flare: both pairs that touch only
  those two cards land with the seat split within 6 points (55.9 / 49.8 and 51.0 / 45.5). Every pair that makes the Archer cost 1
  lands on average by **swinging the seat** 11–15 points: a 1-cost ranged unit is much stronger on the seat that plays second.
- **None of them fixes the mixed rows.** Whichever picker plays out still wins 74–89%: the deck gap is smaller than the
  instrument's own skill gap.

## 9. What this cannot tell you

- Every number is conditional on two scripted pickers. The pickers aim damage at the front-most unit, never plan lethal, and
  play Undertow without purpose. Tide's reactive cards (Undertow, Riptide) are the ones such a picker undervalues, so the real
  gap with people may be smaller. A human-seat playtest (`tapstone-sim play --human`) is the instrument that can disagree.
- Seeds are always 1..=N, so the 16,000-game re-run overlaps the 4,000; it checks stability, not independence.
- The commander is at level 1 on both seats. Progression (0030–0034) may move all of this.
- #147's expansion lists already bring Ember to 48.3 (play-out). This report explains that result rather than competing with it:
  #147 gives Tide a 1-cost Ranged unit (Brine Skimmer) and raises Ember's curve with four cards costing 2–4, the two levers §4 and
  §8 identify. Its lists are 30 cards, so its figures are not directly comparable with these.

## 10. Reproduce

On the evidence branch (`scratch/pollux-imbalance-sim`, `50799ac`):

```
cd rust && CARGO_TARGET_DIR=/var/tmp/ftarget/pollux cargo build --release -p tapstone-sim --bins --examples
cargo test --release -p tapstone-sim --test scratch_knobs        # 7 knob tests
cd ../scratch-sim/imb && ./run_all.sh                              # regenerates out-*.md from results.jsonl
```

`results.jsonl` caches each run by its full configuration (decks, pickers, knobs, rules, games). Delete it to recompute from the
binary; the whole matrix takes about five minutes on familiar.
