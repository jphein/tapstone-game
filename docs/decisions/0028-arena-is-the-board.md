# 0028 — The arena is the board; the shrine is the player's station
Date: 2026-09-23 · JP's ruling · Supersedes 0008's first half and 0027 on the shrine · Amends 0006, 0010, 0020

The battlefield (three lanes, both seats' tracks, the units, combat) is drawn **only on the arena**.
The shrine screen stops being the board. It becomes the player's own station, showing the
commander paperdoll, RPG stats and inventory (0029–0031), talking to the player, and playing small
animations (0032).

## What changes

- **0008:** "the screen is the board" is withdrawn as far as the shrine goes. The board is *a*
  screen, and that screen is the arena's. The physical convention stays as it was: tapped cards go
  to piles beside the shrine, face-up for cast and face-down for charge, and no mat is needed.
- **0006:** the arena turns from additive into **required for a match**. The arbiter is still an
  elected role, and the arena claims it whenever it is present, which is now always. Shrine
  arbitration and handover stay in the protocol as the recovery path, not as a way of playing. If
  the arena leaves mid-match, a shrine takes the arbiter role from the last agreed hash and
  snapshot, both shrines show "the arena is dark — the match waits", and play resumes when an arena
  rejoins and catches up. Nothing is lost, but nothing moves either, because no one can see the
  board.
- **0027** no longer describes a shrine screen. Its ownership lesson, *mine are objects, theirs are
  entries*, is the starting brief for the arena's battlefield view. The `v6-asym` geometry itself is
  320×240-specific and is not carried over. `rust/shrine-preview`'s battlefield renderer stays in
  the tree as the prototype that produced 0025's costing and 0027's findings. It is not a spec.
- **0010:** the "personal panel" mode it anticipated for an arena-present table is now the shrine's
  only in-match mode. Its requirement for a locally rasterising colour surface on the full panel
  stands unchanged.
- **0020:** the idle face shows the commander instead of the castle silhouette (0032).

## Why

JP's call. What it buys, and what it costs, both recorded here so they stay visible:

- **It buys a screen that belongs to one person.** A mirrored board on a 2.8" panel was a shared
  object shrunk to fit. A paperdoll is a private object at its natural size, and the arena canvas
  has none of the flash or frame-budget walls 0025 hit, so the board gets the full animation it was
  always going to get there.
- **It costs "Duel anywhere".** Two shrines on a kitchen table no longer make a game. Every match
  needs the arena service, a gateway node and one browser screen. The mitigation is that the arena
  is software on anything with a browser: for playtest one, a laptop running the arena service with
  a smol gateway node on USB serial counts as the arena. The RealmOS box and LTSP screens are the
  crafted version.
- **It moves the arena onto the critical path.** Phase 4's canvas is now needed before playtest one.

## Phasing consequence

Phase 2 (shrine firmware) and the arena's battlefield canvas become one phase, and playtest one
needs both. Skirmish, Siege and LTSP screen modules stay in phase 4.
