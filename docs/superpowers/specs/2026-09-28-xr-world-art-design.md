# The headset's world art: stone, board, cards, type and the Tea House (design)
Date: 2026-09-28 · Lane: Luna · Branch `feat/xr-world-art` · Canon: 0039 (the Tea House), 0014 (painted faces), materials.md

JP, on the Quest 2 tonight: "the deck and stone and board and teahouse need to be way beautiful!" and
"we need beautiful labels and scenery and gameboards and decks and all that". This note is the art
direction for the headset build's world: everything except the summon creatures (lane morpheus) and
the guide UI (lane aster).

## Goals

1. **The stone** (altar) reads as an object, not a grey box: carved stone, a brass lip, three inset
   lane pads with a crystal each, and a faceted crystal eye (materials.md's shrine two-point-oh).
2. **The Dueling Grounds board** is one painted mat: a pocket-dimension ground in night slate with
   gilt lane lines, the six rows, lane numerals and each side's half, in one draw call (today: 19).
3. **Cards** are framed prints of 0014's paintings (public/cards/*.webp, kept as they are) with a
   faction frame, a cost gem, a name banner and stat shields, and a **holographic** layer (0039:
   "3D and holographic … the art moves"): the painting sits behind the glass with view parallax,
   and a foil sheen sweeps as the card turns. A card has a real back, so face down reads as face down.
   The deck is a stack of backs; the castle card shows its castle.
4. **Type**: every in-scene label (life, mana, lane numerals, unit stats, prompts, the voice line,
   door names, the lintel) has one treatment: engraved plates with a gilt rule, serif display type
   for names, a heavy sans for numbers, a dark outline so text holds over any passthrough.
   **A guard keeps it legible at arm's length** (below).
5. **The Tea House**:
   - Mixed reality (the player's room is the Tea House, 0039): the doors are torii-and-stepped-stone
     portals, each a window into its plane (the Deep Tides' water and caustics, the Forge Peaks' basalt
     and ember light, the Hearthlands' warm forest at dusk), grounded by a soft contact shadow.
     Passthrough stays: nothing else is drawn in the room.
   - Full VR: the lantern-lit interior (0039: "lantern light, magical tea, comfortable seating and a
     Shinto/Mayan design influence"): cedar posts and beams, shoji walls glowing with lantern light,
     a stepped-fret stone frieze, a plank floor, zabuton cushions, a low table, hanging paper lanterns,
     and a slow drift of tea-steam motes.
6. **Light and materials**: baked. Lantern light is computed into vertex colours at build time; the
   interior's two real-time lights go (they also forced a second shader program set, see prewarm).

## Art direction (per 0039)

Warm, lantern-lit, hand-crafted; it frames 0014's painted faces and never competes with them.
Shinto: vermilion lacquer, torii lintels with upturned ends, shoji paper and cedar. Mayan: stepped
frets and corbelled stone, jade-grey limestone. **PROPOSAL** (the bible is silent on the exact
look): how the two influences combine (torii posts on a stepped stone threshold; the frieze), the
Dueling Grounds' look as a night-slate plain, and each portal's view. Door frames keep lore.js's
ruled and proposed looks (the Deep Tides' blue wood is canon, bible Book 1 Ch 35).

### Palette (src/art/palette.js)

| Place / faction | Base | Mid | Light | Accent |
|---|---|---|---|---|
| The Tea House | cedar `#3a2418` | lacquer vermilion `#b8322a` | shoji paper `#f3dfb8` | lantern amber `#ffb45a`, gold leaf `#d8b25a` |
| The Dueling Grounds (PROPOSAL) | night slate `#161a28` | indigo `#262c46` | mist `#8a93b8` | gilt `#c9a55a` |
| The Deep Tides (tide) | abyss `#0a2540` | sea `#1f6fa8` | foam `#9fe3ff` | pearl `#e8f4f2` |
| The Forge Peaks (ember) | basalt `#231c1a` | ember `#e0663a` | magma `#ffb347` | ash `#6b5f58` |
| The Hearthlands (neutral) | oak `#6e4526` | hearth `#b0703a` | cream `#f4ead2` | moss `#6b8f4e` |

`FACTION` (board.js) keeps its three colours, which the effects already use.

## Assets, sources and licences

All procedural: geometry built in code, textures painted on canvases at load, shaders in src/art.
**No third-party asset is added**, so nothing new goes into public/CREDITS.md and the added download
is code only (well under the 25 MB lane budget). Type uses the platform's serif and sans stacks
(the Quest browser ships Noto/Roboto); **PROPOSAL** for the lead: an OFL display face (for example
Cinzel) would need a licence call, since the lane rules list CC0 only.

## The legibility guard (src/art/type.js, pure)

A label's world size and its canvas are checked together:
- angular cap height at its viewing distance (from layout.js) at least 0.45° (about 9 px on the
  Quest 2's ~20 px/°), and
- at least 20 canvas px per cap height (so the texture isn't the limit when a hand brings it close).
`fitText` shrinks a line to fit its plate but never below the floor; below it the line wraps.
test/art-type.test.js checks every label in the spec table; the perturbation shrinks one plate.

## Budget (Quest 2, hold ≥ 72 fps; measured in IWER on the B60, before → target)

| | MR before | VR before | Target |
|---|---|---|---|
| Draw calls (seat view) | 130 | 148 | ≤ baseline (board 19 → 1, interior merged) |
| Triangles | 19.9 k | 20.1 k | ≤ +25 k |
| Texture memory (CPU-side estimate) | 7.8 MB | 7.8 MB | ≤ +8 MB |
| Added download | | | code only (~50 KB) |

No real-time shadows; the interior's PointLight and AmbientLight are replaced by baked vertex light.
Shaders are compiled in the existing prewarm pass.

## Files

- New: `src/art/palette.js`, `src/art/type.js` (pure: the guard, fitText), `src/art/plates.js`
  (the canvas plate painter behind `label()`), `src/art/card-face.js` (the face painter),
  `src/art/card-mesh.js` (the card geometry and holo shader), `src/art/stone.js` (the altar),
  `src/art/board-mat.js`, `src/art/doors.js`, `src/art/interior.js`, `src/art/geo.js` (merge and
  bake helpers), `test/art-type.test.js`, `test/art-geo.test.js`, `tools/iwer-art.mjs` (stills and budget).
- Touched minimally: `src/altar.js`, `src/teahouse.js`, `src/board.js` (mat, plaque, keep and life;
  the unit figures stay for morpheus), `src/hand.js` (one import and the card mesh; aster moves the fan).
