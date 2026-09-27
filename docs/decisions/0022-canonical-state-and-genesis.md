# 0022 — The canonical image and when the chain starts
Date: 2026-09-20 · Phase 1 implementation ruling (0016 made concrete)

> **Amended by 0036 (2026-09-23):** the deck is a list, not an order, and every draw is a `Draw` tap. Genesis hashes each seat's deck list, and the hand stays hashed.

> **Amended by 0029 (2026-09-23):** the image grows per seat (commander attack, toughness, keyword, return round and return lane), house rules grow from 7 to 9 bytes, and genesis hashes the commander stats from each `ClaimSeat`. Byte counts: the amendment at the end (144 B image, 9 rule bytes).

The 134-byte canonical image (`rust/tapstone-rules/src/hash.rs`) holds everything that changes what
the engine accepts next: round, active seat, phase, winner, seq; per seat the castle design and
life, charged and spent mana, deck position, a flags byte (charged this round, lanes advanced,
acted, mulliganed, present), every cell as design/damage/entered_round in lane-major order, and the
hand — length and contents. **Hand contents are hashed deliberately**: state is fully replicated on
both shrines, there is no hidden information, and cards leave hands only through committed events.
**Deliberately derived or omitted**: a unit's attack, toughness and keyword (fixed by its design
in v0 — the image must grow the day any effect mutates them) and the never-read
`advanced_this_turn`. Deck contents are not hashed; the deck order is the seed and a divergence
shows in the hand bytes within one draw.

**Genesis** is taken when the game leaves the Lobby — on the second `ClaimSeat`, after house rules
are final — over `b"tapstone:v0"` and the seven house-rule bytes. Claim records are
transcript-only and carry no hash; rule changes are an API call (`Game::with_rules`) and leave no
record. Reason: the rules are hashed once, at the moment
they can no longer change, and every hashed record is one the engine applied under those rules.

**Amendment 2026-09-21.** `advanced_this_turn` was removed from `Unit` outright (commit 82781c5):
written and reset but never read, it was dead state rather than a deliberate omission. The
canonical image is unchanged — the field was never in it — and no golden moved.

**Amendment 2026-09-23 (0029, the commander).** The day the image had to grow has come: a
commander's stats come from its level and gear, not from a design. The image is now **144 bytes**
(`CANON` in `hash.rs`, derived from its parts): per seat it gains five bytes after the flags byte —
the commander's attack, toughness, keyword code (`0xFF` = none), return round (0 = on the board) and
the lane it returns to. 0029 named four; the lane is state as soon as a Shift can move the
commander, so it is hashed too. The commander's cell is an ordinary cell with the reserved design
`0xFFFE`. **Genesis** is now `b"tapstone:v0"` ‖ nine house-rule bytes (the seven plus
`commander_fall`, `commander_return`) ‖ each seat's commander attack, toughness and keyword code,
and `Chain::genesis` takes the `Game` rather than the rules, so no caller can leave the commanders
out. Every golden moved once for this, deliberately (0029). The flags byte is now stored in `Seat`
exactly as hashed, which is what keeps `Game` inside 350 B (348, measured on host, thumbv7em and
xtensa-esp32s3); the goldens were byte-identical across that repack, which is the proof the two
layouts agreed.

**Amendment 2026-09-23 (0036, every draw is a tap).** "Deck contents are not hashed; the deck order
is the seed" is withdrawn: the deck is shuffled paper and the engine never learns its order. The
engine holds each seat's deck as a **list** (the undrawn copies), and **genesis hashes each list,
sorted**, after the commanders: per seat, the list length, then its designs, so a reshuffle never
moves `h_0` and a different list always does. In the image, the byte that held `deck_pos` now holds
the seat's **owed draws**. That count changes what the engine accepts next (while it is non-zero,
only a `Draw` is legal), so it belongs in the image. The image stays 144 B and `Game` stays 348 B,
measured on host, thumbv7em and xtensa-esp32s3 with a 347 control. The hand is still hashed exactly
as above: it is now filled by committed `Draw` records rather than by the engine's own shuffle. Every
golden moved once, deliberately.
