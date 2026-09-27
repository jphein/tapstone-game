# 0029 — Each player has a commander, and it fights on the board
Date: 2026-09-23 · JP's ruling (commander on the board; castle stays) · Lead's call on the v0 numbers

Every seat fields one **commander**: a unit that lives in a lane and fights like any other, and
that the shrine draws as a paperdoll (0032). The **castle stays** as the thing with life, and
reducing it to zero is still how you lose. Losing the commander hurts but does not end the game.

## The rules, v0

Every number below is tunable without rewriting a record. The fall penalty and return delay are engine
house rules, and the base stats are arena-side (see the rulings at the end).

- **Entry:** the commander starts in the back cell of the **middle lane** at genesis. It is not in
  the deck and costs no mana. It advances, fights, is targeted and takes damage exactly like a unit.
- **Stats:** base attack 2 and toughness 4, plus at most one keyword from gear (0031, 0034; levels
  add no stats since 0034), all fixed **at genesis**. Nothing changes them mid-match in v0.
- **Death:** when the commander dies, its castle loses **3** and the commander **returns** to the back
  cell of the same lane at full toughness at the start of its owner's turn **two rounds later**. If
  that cell is occupied, it waits until the cell is free. Without the return, one early trade would
  delete a player's paperdoll for the rest of the match, and the shrine screen would show a corpse.
- **Win condition:** unchanged. Castle life, then the round-12 stop and its tiebreaks. The commander
  counts as a unit for the "more units" tiebreak.

## What it does to the engine

- **The canonical image grows.** 0022 left attack, toughness and keyword out of the image because
  they were "fixed by its design in v0 — the image must grow the day any effect mutates them".
  A commander's stats come from its level and loadout, not from a design, so that day is now. Per
  seat, the image gains the commander's attack, toughness, keyword and return round. The commander's
  cell still uses the ordinary cell encoding, with a reserved design id.
- **Genesis hashes the stats, not the inventory.** `ClaimSeat` carries the commander's final
  attack/toughness/keyword, derived by the arena from the ledger (0030) and the loadout (0031).
  Genesis hashes those three values per seat. The engine never sees a level, an XP count or an item,
  so progression can change without moving a golden transcript, and the rules crate stays
  `no_std` and small.
- **Every existing golden moves once**, because genesis gains bytes. That is a deliberate break,
  taken now while nothing depends on the old goldens outside this repo.

## Why a unit and not an avatar

JP chose it over "the commander replaces the castle" and "the commander lives in the castle". A
unit on the board makes the paperdoll matter to play without adding a second life total, and it
reuses the combat, targeting and lethal rules 0021 already settled. The returning commander is the
lead's addition. The alternative, a commander that stays dead, turns the most personal object in
the game into the first thing a good opponent removes.

## Rulings 2026-09-23, after review — the holes an implementer could read two ways

An adversarial read of this record (scratch `oracle-pr48.md`) found that "same lane", "two rounds
later" and "waits" each had two readings, and each reading moves the hash. They are settled here.

- **Base stats are the arena's, not the engine's.** The 2/4 base, the level table (0030) and gear
  (0031) are arena-side derivation. `ClaimSeat` carries **final** attack, toughness and keyword, and
  the engine never sees a base. Only **fall penalty (3)** and **return delay (2)** are engine house
  rules. They join the house-rule bytes hashed at genesis (the array grows from 7 to 9) and the CFG
  string. `progression` (0030) is an arena key and is not hashed.
- **Each seat's own `ClaimSeat` carries its own stats** in the three fields a claim did not use:
  `target` = attack, `aux` = toughness, `lane` = keyword code (−1 none). The reserved bytes stay
  reserved. Claims are not hashed, so moving the fields later changes no chain hash (PR #49, and
  the protocol draft's record table). A
  claim with toughness 0, which is what every pre-commander claim decodes to, is refused, so old
  claims fail closed.
- **The return lane is the lane it died in**, because Shift spells move units and the middle lane
  would teleport it. The lane is state, so it is **in the canonical image**: per seat, the image
  gains attack, toughness, keyword, return round and return lane.
- **Return timing is by round number.** Dying in round *r*, on either seat's turn, sets return round
  *r + 2*. The check runs **only at the start of the owner's turn**. If the round has arrived and the
  back cell of the return lane is empty, the commander enters there at full toughness with
  `entered_round` set to that round, so it behaves like a fresh arrival. If the cell is occupied, the
  same check repeats at the owner's next turn start. The cell is never re-checked mid-turn.
- **The genesis commander has `entered_round` 0**, so it may advance in round 1.
- **The fall penalty is castle damage like any other.** In combat it is tallied with the combat's
  castle damage and applied simultaneously (0021), so a commander's death can be the lethal blow,
  and simultaneous zeros resolve exactly as rules v0 resolves them now. A spell that kills the
  commander applies the penalty in the same event, and if that brings the castle to 0 the game ends
  there (0021's lethal-spell rule).
- **A dead commander is not a unit** for the "more units" tiebreak until it has returned.
- **Blocking is intended.** The commander occupies the middle lane's back cell at genesis, so
  middle-lane summons wait until it advances, and your own unit in that cell delays your own
  commander's return. Both are costs the player chooses, and the sim measures how often they bite.
- **Rush does not apply to a commander.** Rules v0's Rush changes where a unit *enters*, and a
  commander always enters the back cell, at genesis and on return. 0031 therefore removes Rush
  from the item keywords rather than leaving a keyword that is silently inert.
- **The 350 B `Game` budget is held, not raised.** Five bytes per seat and two house-rule bytes
  would take `Game` to ~360 B against the firmware const assert (`verification.md`). The rules-crate
  PR packs each seat's seven flag bools into one byte, the layout the canonical image already uses,
  and measures the result on the chip's compiler. Raising the budget would need its own ruling.
- **Arena-dark recovery follows 0006's election:** the shrine that tapped first in this match takes
  the arbiter role.
