# 0031 — Inventory is earned loot and item cards; gear is locked at genesis
Date: 2026-09-23 · JP's ruling (both sources) · Lead's call on timing ("as you suggest")

> **Effects superseded by 0034 (2026-09-23):** gear grants Haste or Taunt, or is a look. No stat items, no Ranged or Shield 1.

The commander wears gear from two sources. **Earned loot** is data in the arena ledger (0030),
dropped after matches. **Item cards** are physical NFC cards, rarer, traded and collected like any
card. Both are equipped on the shrine between matches, and neither can change once a match starts.

## Slots and effects

- **Three slots:** weapon, armour, trinket. Two are open at level 1, and the trinket opens at level
  7 (0030).
- **Closed effects table**, like spells (rules v0): an item grants **+1 attack**, **+1 toughness**,
  or **one keyword** from Ranged, Shield 1, Haste or Taunt. Rush is excluded because a commander's
  entry cell is fixed (0029). One effect per item,
  one keyword on the commander at most; a second keyword item is refused at equip time. A fully
  geared commander therefore gains at most **three +1s, or two +1s and a keyword**, from gear.
- **Consumables** (potions, scrolls) and anything spent mid-match are **deferred**. They would add
  a card type to the engine and a touch surface to the match, and nothing in playtest one needs
  them.

## Timing

Gear is set in the **lobby**. At the second `ClaimSeat` the arena derives the commander's final
stats (0029) and genesis hashes them. After that the loadout is frozen until the result. Reasons:
the engine never needs to know items exist, "one tap per action" survives because no mid-match tap
means "equip", and the ten-minute cap is not spent in menus.

## Item cards

- A new card kind, `Item`, in the design records (`game/cards/<set>/<id>.toml`) with slot and
  effect. Copies bind through scry's imbue rite, exactly like any card (card-data-format.md).
- **You bring your gear.** A physical item is worn only if its card is **tapped on your shrine in
  that match's lobby**. The ledger remembers the loadout so one tap per slot restores it, but a lent
  or sold card leaves with its owner. Card-only path (0009): tapping an item card equips it to its
  slot with no touch needed. Tapping a second card for the same slot swaps them.
- A copy can be worn by one commander at a time per match. The arena refuses a copy already claimed
  in the same lobby.

## Earned loot

- The arena rolls loot after each **completed** match: a drop on a win, and on every third loss (so
  a losing streak still pays). The drop is one item from the set's loot table, weighted toward the
  commander's faction.
- Loot lives only in the ledger. The shrine's inventory screen shows it (0032) and equips it by
  touch. By card alone, the lobby's 5-second default (0009) re-applies the last loadout.
- **Duplicates melt into XP** (1 XP each) rather than cluttering a screen that shows twelve items at a time.

## Why both, and the one thing that must stay true

Physical items make gear something you can hold and trade, which is the point of an NFC card game.
Loot makes progression happen without buying anything. The invariant that keeps two sources from
becoming two economies: **an item card and a loot item with the same design have the same effect.**
One design record, two ways of owning it.

## Rulings 2026-09-23, after review

- **"Every third loss" means consecutive losses**, and a win resets the count. The point is that a
  losing streak pays.
- `card-data-format.md` gains `type = item` with `slot` and `effect`, following this record.
- **A match abandoned from round 3 counts as completed** for the seat still present, which gets the
  win's drop and a reset streak. The leaver gets nothing, and their streak is unchanged.
