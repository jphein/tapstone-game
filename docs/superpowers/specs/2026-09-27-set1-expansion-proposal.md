# Set 1 expansion toward two 30-card decks — PROPOSAL, approved as 0040

Date: 2026-09-27 · Author: Pollux (overnight lane, umbrella #131) · Status: **APPROVED by JP
(2026-09-27) and implemented: decision 0040.** Names kept as proposed; the realms below are rulings now;
the bonus re-sweep (§3.2) and the art stay open · Would amend: 0011 (deck size), card-data-format (a copy limit) ·
Evidence: branch `scratch/pollux-expansion-sim` at `1088098` (never merged)

CLAUDE.md: *design before code*, and *keep the game small: ≤30-card decks, one tap per action,
matches under ten minutes*. This proposes the smallest card set that fields two full 30-card decks,
using only mechanics the engine already has, and reports what the simulator says it does to the
game. Every number below names the picker that produced it (verification.md), and none is evidence
about human play.

## 1. The ask, in three numbers

| | today | proposed |
|---|---|---|
| deck size (house rule `deck_size`, 0011) | 25 | **30** (already inside `DECK_MAX = 30`) |
| copies of one design in a deck | unlimited (the loader enforces none; today's Ember list runs four or five of each) | **at most 3** |
| playable designs | Ember 4, Tide 6, neutral 2 | **Ember 8 (+4), Tide 8 (+2), neutral 2 (+0)** |

A 30-card deck at three copies needs ten designs. Each proposed deck is its faction's eight plus the
two neutrals (Deep Breath, Mend), three of each. That is **six new designs**, taking set 1 from 14
to 20 (18 playable plus the two castles), a step toward 0013's planned 70.

Considered and not proposed: a two-copy limit (15 designs a deck: Ember +9, Tide +7, three times the
art, voice and printing for one step); padding to 30 with new neutrals (it dilutes the faction
identities 0013 set up as mirrored answers); keeping 25 (no change to argue with).

## 2. The six cards

Only existing vocabulary: a unit has at most one keyword from Ranged, Shield 1, Haste, Rush and
Taunt, and a spell takes one effect from the closed grammar in `tools/compile_cards.py`. **No
engine work and no new keyword.** Names are PROPOSAL: they follow 0039's realms (Ember from the Forge
Peaks, Tide from the Deep Tides) and carry no flavour text, because 0039 says names come from the
*Inner Authority* bible and anything it does not state goes to JP rather than landing as canon.

| id | name | faction | kind | cost | stats / effect | rarity | the slot it fills |
|---|---|---|---|---|---|---|---|
| st1-014 | Forge Runner | Ember | unit | 2 | 2/2 Haste | common | a sturdier Haste body than Cinder Whelp (1, 2/1) |
| st1-015 | Bellows Raider | Ember | unit | 2 | 2/1 Rush | common | a cheap Rush, below Ashen Vanguard (3, 3/2) |
| st1-016 | Slag Brute | Ember | unit | 4 | 4/3 | uncommon | Ember's first top end; no keyword, dies to Tidal Lash |
| st1-017 | Magma Burst | Ember | spell | 3 | `damage:3:castle` | uncommon | second burn, reaches the castle; kills a 3-toughness body |
| st1-018 | Brine Skimmer | Tide | unit | 1 | 1/1 Ranged | common | Tide had no 1-cost card |
| st1-019 | Trench Leviathan | Tide | unit | 4 | 3/4 Shield 1 | uncommon | Tide's top end; survives Magma Burst, falls to combat |

The proposed lists (ids as the deck files would hold them, three copies each, 30 cards):

- **Ember:** st1-002, 003, 004, 005, 014, 015, 016, 017, 011, 012 — six units (Haste ×2, Rush ×2,
  Taunt, one vanilla) and two burn spells, plus the neutrals.
- **Tide:** st1-006, 007, 008, 009, 010, 013, 018, 019, 011, 012 — five units (Ranged ×2, Shield 1
  ×2, one vanilla) and three spells (damage, shift, destroy), plus the neutrals.

Mirrored answers (0013) still hold: Riptide (destroy ≤ 2) answers Ember's cheap bodies but not Slag
Brute, which Tidal Lash (3) does; Magma Burst answers Tidecaller (2/3) but not Trench Leviathan (4
toughness; Shield 1 is per combat, so it does not blunt a spell).

## 3. What the simulator says

**How it was measured.** On the scratch branch the six TOMLs were added and compiled
(`compile_cards.py --check` exit 0, 20 designs), and the sim gained four `p-*` pairings (the
proposed lists at `deck_size` 30; today's pairings untouched, `golden check` exit 0). Every cell is
4,000 games (seeds 1..=4000) at the shipped house rules (bonus 1, life 20, pressure from 8, stop
12), built with `cargo build --release -p tapstone-sim` on familiar; the whole matrix is
`scratch-sim/run.sh` (2 min 37 s) and its raw output is `scratch-sim/out/`. The computed figures in
§3.1 and §3.2 are re-derived from that output by `scratch-sim/check_doc.py <this file>` (16 figures,
exit 0; changing any one of them in the doc makes it exit 1). Seat 0 win % carries a
±1.4–1.5 95% interval unless shown.

**Controls.** Today's rows reproduce 0036's published figures exactly (mirror Ember play-out 45.5;
commander gate worst kit Haste 56.7 Ember / 57.5 Tide), so the scratch build measures what `main`
does. The scratch tests (`tests/proposed.rs`) prove the proposed decks reach the engine as 30 cards,
three of each of ten designs, and that every new card is actually cast. Each check was perturbed once
and seen red (engine held at 25; Slag Brute at cost 99; Leviathan dropped from the Tide list).

### 3.1 The deck matchup — the headline

Ember's win rate against Tide, averaged over both seat orders (asymmetric and swapped), so the seat
effect cancels:

| picker (Ember / Tide) | today | proposed |
|---|---|---|
| play-out / play-out | **71.9** | **48.3** |
| pass-early / pass-early | 69.8 | 52.6 |
| play-out / pass-early | 94.5 | 82.8 |
| pass-early / play-out | 28.9 | 13.8 |

Raw seat 0 % behind those: today asymmetric 73.9 / 76.8 and swapped 30.1 / 37.3; proposed
asymmetric 50.7 / 57.5 and swapped 54.2 / 52.4 (play-out / pass-early). In the mixed rows the
stronger picker wins whichever deck it holds, so read the gap between the two mixed rows instead:
Ember's deck edge is +11.7 points today and −1.7 proposed.

**Today's decks are not close.** Ember beats Tide about 70–30 under both matched pickers. The
proposal brings that to within 2.6 points of even under both. It does so without a Tide redesign,
which rules v0 warned against doing on picker evidence. The additions are what fill the gaps: Tide
gets a 1-drop and a top end, and Ember's copies are diluted from four or five to three. Treat this as a
prediction for the table test, not a finding (0026's standing caveat).

### 3.2 The seat — 0026's warning, taken

0026: *whoever fixes the deck matchup must re-measure the seat asymmetry at the same time.* Mirrors,
seat 0 %, bonus 1:

| mirror | picker | today | proposed |
|---|---|---|---|
| Ember | play-out | 45.5 | 51.2 |
| Ember | pass-early | 56.2 | 55.5 |
| Tide | play-out | 45.5 | **57.0** |
| Tide | pass-early | 59.8 | 59.0 |
| worst distance from 50 | | 9.8 | 9.0 |

The worst case is about the same, but its shape moved. Under play-out, seat 0 now **wins** the Tide
mirror (57.0), where today it loses (45.5), so the pickers no longer disagree in sign on Tide. The
mixed-picker mirrors (seat 0 play-out against pass-early: 88.1 / 90.0 today, 91.1 / 90.3 proposed,
and the reverse 11.7 / 14.3 against 12.2 / 13.1) measure the picker, not the seat, and barely move.

**The second-player bonus (0035) wants re-sweeping if this lands.** Applying 0026's method (optimise
the worst case across both pickers and both mirrors) to the proposed decks gives a different answer
than it does today:

| bonus | today, worst distance | proposed Ember (po / pe) | proposed Tide (po / pe) | proposed, worst distance |
|---|---|---|---|---|
| 0 | 12.1 | 61.6 / 58.5 | 64.6 / 60.3 | 14.6 |
| **1** (shipped) | **9.8** | 51.2 / 55.5 | 57.0 / 59.0 | 9.0 |
| 2 | 15.4 | 43.8 / 52.8 | 50.4 / 56.7 | **6.7** |

On today's decks 1 is best. On the proposed decks 2 is, by 2.3 points. This is **not a ruling**. It
is one card's step against a residual 0026 showed is finer than a card, and 0026 also warns against
fitting the rules to the instrument. It means the bonus is coupled to the card set, and a set change
should re-run the sweep. The full 225-configuration fairness grid finds no configuration within two
points of 50 under both pickers on any mirror, today's or proposed (`fairness-*.txt`), as 0026 found.

### 3.3 Match length — the ten-minute budget

Mean rounds and committed records per seat (claims and draw taps included), shipped rules, 4,000
games each:

| pairing | picker | today: rounds (range) · recs0 / recs1 | proposed: rounds (range) · recs0 / recs1 |
|---|---|---|---|
| Ember v Tide | play-out | 5.85 (3–10) · 43.3 / 40.2 | 6.47 (3–10) · 43.1 / 45.9 |
| Ember v Tide | pass-early | 6.46 (3–12) · 41.1 / 36.3 | 6.97 (3–12) · 39.8 / 40.4 |
| Ember v Tide | play-out v pass-early | 4.82 (3–10) · 38.8 / 27.1 | 5.65 (3–10) · 39.7 / 32.9 |
| Ember v Tide | pass-early v play-out | 6.95 (3–10) · 42.2 / 48.7 | 6.67 (3–10) · 37.5 / 48.7 |
| Ember mirror | play-out | 6.41 (3–11) · 46.5 / 49.7 | 6.38 (3–10) · 43.9 / 45.7 |
| Ember mirror | pass-early | 6.37 (3–12) · 40.6 / 41.0 | 6.57 (3–11) · 38.5 / 39.0 |
| Tide mirror | play-out | 7.72 (5–12) · 48.4 / 51.4 | 7.19 (4–11) · 47.3 / 49.5 |
| Tide mirror | pass-early | 7.81 (4–12) · 43.5 / 43.3 | 7.51 (3–12) · 42.4 / 42.7 |

Every cell ends by lethal in 4,000 of 4,000 games, as today (0026's "dead endgame" finding is
unchanged). The asymmetric match gets about half a round longer because Tide now survives
Ember's opening. No seat taps more than about 50 records a game, the same as today, and the Tide
mirror gets slightly shorter. Wall-clock time was **not measured**; records per seat is the proxy,
and on it the proposal stays inside the envelope 0011's six-to-nine minutes was set against. A 30-card
deck is never exhausted in a 12-round game, so the extra five cards change what you draw, not how
long you play.

### 3.4 The commander bound (0030/0034) still passes

The gate on the proposed mirrors exits 0. The worst kit is still Haste, seat-balanced
play-out / pass-early: Ember 57.4 [56.33–58.49] / 53.2, Tide 54.5 [53.39–55.58] / 53.4, against
today's 56.7 / 52.8 and 57.5 / 54.2. Headroom under 60 on the Wilson upper end is 1.5 points (58.49), the
same as today (58.53). 0034's opening rule is untouched.

### 3.5 What gets cast (play-out, Ember v Tide, casts per game)

Proposed: Trench Leviathan 1.01, Tidecaller 0.96, Slag Brute 0.87, Ashen Vanguard 0.76, Pearl
Shieldbearer 0.71, Deep Breath 0.70, Reef Archer 0.69, Hearth Warden 0.58, Magma Burst 0.57, Bellows
Raider 0.56, Forge Runner 0.56, Brine Skimmer 0.52, Undertow 0.46, Tidal Lash 0.45, Cinder Whelp
0.45, Riptide 0.37, Flare 0.35, **Mend 0.12**. The two 4-drops lead partly because the picker always
casts the most expensive affordable unit, which is a property of the picker, not a sign the cards
are too strong. Mend is nearly dead in both today's decks (0.32) and the proposed ones, so it is the
neutral slot to reconsider first. Nothing here proposes changing it.

## 4. What landing it would cost (not done here)

No rules-crate code: `DECK_MAX` is already 30, `Game` stays 348 B (the deck array is fixed at 30),
and `SET1` grows from 224 to 320 B of rodata. The scratch branch found everything else that moves
by running the whole workspace suite, and each item below is something that failed:

- **Tests that pin the set size.** `tapstone-rules/tests/cards.rs` asserts `SET1.len() == 14` and
  `design(14).is_none()`. `tapstone-sim/tests/props.rs:171` draws random card ids from a typed
  `0u16..20`, so at 20 designs no id is unknown, `Refusal::UnknownCard` never fires, and the
  property test fails. It should derive the range from `SET1.len()` (verification.md: derive
  constants from their constraints).
- **Voice (0033).** `game/voice/clips.tsv` is generated from `SET1` and goes from 222 to 280 clips
  (the six names across cast-or-charge, lane, target and drew prompts, plus the new 4-mana refusals).
  The shrine-preview test catches it as stale, so the regeneration can't be forgotten, but the
  speech still has to be made.
- **Deck files and the house rule together.** `decks/*.toml` go to the 30-card lists, and
  `deck_size` goes to 30 in `HouseRules::default()` and every keyed-CFG default at the same time.
  The loader refuses a deck whose length differs from `deck_size`, so the two can't drift silently.
  The sim's `DECK_DESIGNS`/`DECK_SIZE` follow, and **goldens move** and are regenerated deliberately.
- **The copy limit** is tooling, not engine: the deck loader (`tapstone-sim/src/deck.rs`, which
  today reports a tally and says it is waiting for this decision) and card-data-format.md.
- **Art and print.** Six faces and sprite sets under 0014. Two playable decks become 60 printed
  cards instead of 50.
- **The bonus re-sweep** (§3.2) and the 0030/0034 gate on both mirrors, as their own measured step.

## 5. For JP to decide

1. **Deck size 30** (amending 0011's 25), inside CLAUDE.md's ≤30.
2. **A three-copy limit** per design.
3. **The six cards** as listed, or a direction to change (costs, keywords, the Ember/Tide split).
4. **The names**: keep these as placeholders, or take names from the *Inner Authority* bible (0039).
5. Whether the second-player bonus is re-swept as part of landing this (§3.2 suggests 2 may beat 1
   on these decks), or left at 1 until the first table test.
