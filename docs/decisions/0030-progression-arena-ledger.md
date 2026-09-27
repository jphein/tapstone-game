# 0030 — Commanders level up for real, capped, and the arena keeps the ledger
Date: 2026-09-23 · JP's ruling (real progression; arena ledger) · Supersedes 0017's "levels wait"

> **Headline reversed by 0034 (2026-09-23, delegated by JP):** progression no longer affects play. Levels give breadth and looks, not stats, because the measured bound could not be met any other way. The bound, the XP and the ledger stand.

A commander's level, XP and earned inventory **persist between matches and affect play**. The
record lives in a **ledger held by the arena**, keyed by the castle figurine's identity (0019). It
does not live on a tag.

## The ledger

- **Owner and sole writer:** the arena service. After the arbiter signs a result (0016), the arena
  applies it to the ledger: XP awarded, level recomputed, loot rolled (0031). Shrines read the
  ledger over the mesh to draw the paperdoll. They never write it.
- **Key:** the figurine's tag UID for playtest stock (registry-trusted, cloneable, and honest about
  it), and the SUN-verified 424 DNA identity from the first real print (0003).
- **Home:** the arena, locally. See the correction below.
- **The tag is not the ledger.** 0017's signed card *history* still goes on 424 DNA cards and
  stays history only. A figurine may later carry a signed snapshot so a commander can travel to
  another table, but that is deferred until two arenas exist.

## The cap, and what it guarantees

- **Level 1–10.** XP per match is flat: win 3, loss 1, and nothing for a match abandoned before
  round 3. This rewards playing, not farming.
- **Level bonuses, v0:** +1 toughness at levels 3, 6 and 9, +1 attack at level 5, and the third gear
  slot unlocks at level 7 (0031). A level-10 commander has at most **+1/+3 from levels**, before
  gear.
- **Balance bound, stated as a test:** a max-level, best-geared commander against a fresh level-1
  commander, on a mirror, must win **no more than 60%** under *both* scripted pickers (play-out and
  pass-early). Per `docs/verification.md`, a single-picker number is evidence about the picker.
  If the bound fails, the level table shrinks, not the bound.
- **House rule `progression`:** `on` (default), or `flat`, where both commanders play at the lower
  of the two levels with gear stripped to the lower slot count. That lets a veteran and a newcomer
  play an even game without either one giving anything up.

## Why the arena and not the tag

0028 makes the arena present at every match, so the objection that stopped server-held state
("nothing ever depends on a server") now applies only *off* the table. The ledger works with
NTAG215 playtest stock, needs no write at match end, and puts no inventory into 504 bytes of tag
memory. The cost is portability: your commander lives on one arena. That cost is real, deferred and
named, not hidden.

## What 0017 keeps

The research lesson 0017 honoured, *never store game state on the card*, is kept, and more
strictly than before. Nothing that changes play is written to any tag. The change is that levels
are no longer "v2 or never": they exist, they are bounded, and the bound is checkable.

## Rulings 2026-09-23, after review

- **XP per level is flat: 5 XP a level.** Level 10 is 45 XP, about fifteen wins or forty-five
  losses. That is enough to feel, and short enough that the cap arrives inside a season of evenings.
- **An abandoned match:** before round 3 nobody gets XP. From round 3, the seat still present is
  awarded the win's XP and the leaver gets nothing.
- **`flat` mode is automatic:** both commanders play at the lower level. If that level has only two
  slots, the higher commander's trinket is dropped. The player cannot choose, because a choice would
  cost a lobby prompt.
- **The balance test, made well-defined:** every figure averages **both seat assignments**, since
  0026 measured the seat effect alone at 42.7/52.6 on a mirror. It is run over **every legal
  max-level loadout** (0031's closed table enumerates them) against an **ungeared level-1**
  commander, not over a hand-picked "best". The bound applies to **the loadout with the highest win
  rate** under each picker. Any other reading lets the test pass vacuously.
- **Where the ledger lives — corrected the same day.** Putting the store in realmwatch's
  `realm-engine` was wrong. That plugin owns `~/.realmwatch/game.db` inside realmwatch's server on
  familiar, which is off the table and sleepable, so every lobby would have depended on a machine
  that is not there. **The ledger is a local store in the arena service** (one SQLite file). The
  arena is its only writer, and a lobby needs nothing beyond the table. realm-engine keeps building
  its player records from posted transcripts (0016) when familiar is reachable. That is a derived
  read-side mirror and never an input to a lobby. Phase 6's "persistence" is the Realm's territory
  layer, not the ledger.
