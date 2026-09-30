# Summons, the "whoa" pass (headset): design note

Date: 2026-09-29 · Lane: Morpheus · Branch `feat/xr-summons-fidelity` · Follows
`2026-09-28-xr-summons-design.md` (#197). Canon: 0039 ("3D and holographic … when you play a card it
animates fully into the world").

The lead's review of #197 against JP's words ("the pieces need to animate into a 3d flying dragon when
you summon the whelp"): the sequence works, but the whelp reads small and chibi (a cute translucent
bat-winged figure), and the commanders read as blocky figures. JP wants a moment that makes someone say
"whoa".

## Goals

1. **The Cinder Whelp is a majestic small dragon**: a long neck and tail, horns, real membrane
   wings on finger bones, and a proper flap cycle. It stays holographic but has body: a fresnel rim,
   ember-lit emissive veins in the wings and along the spine, and an additive glowing core (its fire
   heart). It works under luna's lantern light (the baked key light of #197's `look.js`).
2. **Staging.** On the summon, the dragon flies big, with a ~30 cm wingspan. It rises toward the
   player's eye line, sweeps past the head (never closer than 25 cm to it), breathes a burst of fire
   (cheap particles) and then shrinks as it descends. It settles to board scale on its cell with a
   landing puff. Its idle stays alive: breathing, a sway of the tail, the neck's slow look about,
   and now and then a wing stretch.
3. **Weight.** The attack is a lunge toward the target with a snap of the head, and for the whelp a
   short breath of fire. The death is a holographic shatter: the body bursts into embers (or motes, for
   Tide) that fall and fade.
4. **Commanders**: off the blocky Giant, onto recognisable figures (PROPOSAL: the bible names no
   commander models):
   - Ember: Quaternius's crowned King, in armour.
   - Tide: Quaternius's Hooded Adventurer with a sword.
   Other units keep #197's models, with the new material. If time runs short, the whelp and both
   commanders come first, and the PR says what was left.
5. **Reduced motion and contrast keep working.** Reduced motion: no big flight and no sweep past the
   head; the dragon forms calmly on its cell in 400 ms. High contrast: an opaque, bright silhouette with
   a white rim (#197's rules, applied to the new material too).

## Approach

**The whelp is procedural, not a download.**
- The only CC0 animated dragons (poly.pizza, checked 2026-09-29) are Quaternius's three, all chibi.
  Every other CC0 "dragon" there is a static prop, a dragonfly or not CC0.
- A dragon built in code can be as slender and winged as a dragon should be, costs no download,
  scales freely for the big flight, and is holographic by design.
- `src/summons/wyrm.js` builds one BufferGeometry (body tube, head, horns, jaw, four legs and two wing
  membranes on finger bones) and deforms it on the CPU each frame from a pose. That is ~2k vertices,
  one draw call, plus one for its glowing core.
- `src/summons/wyrm-pose.js` is pure and tested. It holds:
  - the flap cycle: a fast downstroke, a slower upstroke, and folded wings for gliding;
  - breathing, the neck's look, the tail's sway and the wing stretch;
  - the attack snap.

**Staging is pure** (`look.js`'s `flight()` grows a `summonPath()`): the sweep path, with its
distance to the head, its scale over time and the fire-breath moment, tested against the head's
position (`logic/layout.js` `defaultHead()`) and the table.

**Commanders** are baked by `tools/bake-creatures.mjs` like the other models (one draw call, LOD1 on
the same skin). The King drops its gun meshes.

**Material:** `holo.js` gains a `veins` attribute (the wing bones and spine, pulsing in the faction's
light) and an additive glowing core. Its contrast and room rules are unchanged.

## Budget (Quest 2: at least 72 fps with 3 creatures a side plus the summon flight)

- The whelp: ~2.4k triangles, 2 draw calls (body and core), ~0.1 ms of CPU deformation each. There
  is at most one big flight at a time.
- The commanders: King ~11k and Hooded ~7k at LOD0, and the other seat's at LOD1 (~40%).
- Fire and shatter reuse the motes pool (one draw call), grown from 160 to 320.
- Before and after: draw calls, triangles and MB, from `tools/iwer-summons.mjs` in MR and VR.

## Files

- New:
  - `src/summons/wyrm.js` and `src/summons/wyrm-pose.js`;
  - `public/creatures/king.glb` and `public/creatures/hooded.glb`;
  - tests in `test/summons.test.js` and `test/wyrm.test.js`.
- Touched: `src/summons/{system,look,holo,creatures,spell-fx}.js`, `tools/bake-creatures.mjs` and
  `public/CREDITS.md`. No shared file beyond these.

## What landed (2026-09-29)

- **The whelp** (`wyrm.js`, `wyrm-pose.js`):
  - ~1.3k triangles, two draw calls (the body and its fire heart).
  - 14-sided body with belly plates, horns, spines and a spade; legs fold flat in flight.
  - Deep ember colours, veins on the wing bones, the spine ridge and the eyes.
- **The sweep** (`look.js` `soar`):
  - 28 cm span (2.3× board size), passing 0.33 m from the head within 37° of the gaze.
  - Fire over the far half of the board, a landing puff, then a perch that breathes, sways and
    stretches.
  - Reduced motion gets the calm form (`summonStyle`).
- **The shatter and the strike's fire.**
- **Commanders:** the King (Ember) and the Hooded Adventurer with her sword (Tide).
  - Their flat-shaded meshes are many small pieces that the simplifier cannot reduce, so both draw
    full detail. There are only two on the board.
- **Found on the way:**
  - three's AdditiveBlending also adds to alpha, which in passthrough turns sparks into dark blobs.
    `LIGHT_BLEND` keeps alpha instead.
  - The rim was washing every creature salmon; it is now a silhouette edge.
- **Left:** the other units keep #197's Quaternius models (Ultimate Monsters: stylised, not blocky),
  with the new rim and light. A bespoke look per unit is the next pass.
