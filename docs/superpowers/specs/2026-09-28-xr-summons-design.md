# Summons that come alive (headset): design note

Date: 2026-09-28 · Lane: Morpheus · Branch `feat/xr-summons` · Canon: 0039 ("3D and holographic … the
art moves … when you play a card it animates fully into the world").

JP, on the Quest 2, 2026-09-28: "the pieces need to animate into a 3d flying dragon when you summon the
whelp you know?"

## Goals

1. Casting a unit turns the card into a 3D creature that lives on its cell. The card lifts off the pad,
   dissolves in its faction's light, and the creature forms out of that light, flies the arc to its cell
   and settles into an idle loop. Cinder Whelp becomes a flying dragon.
2. A creature attacks when its unit attacks, flinches when it is hit, and dies when the unit leaves the board.
   It also moves when the unit advances or is shifted.
3. Each of set 1's seven spells plays a short 3D effect at its target.
4. The board stays the truth. Creatures are spectacle drawn from the view and the effect queue (0027's
   amendment): if the queue drops an effect, the creatures are reconciled to the newest view, so motion
   can be lost but state never is.
5. Reduced motion (logic/access.js) makes the creature appear in place with a fade: no flight, no lunge
   and no swell. Deaths fade out.

## Approach (settled)

**CC0 animated glTF, one shared holographic material.** Quaternius's *Ultimate Monsters* and animal
models (CC0 1.0, from poly.pizza, each checked there) come rigged with idle, attack, hit and death
clips. A dragon made from procedural primitives would not read as a dragon at arm's length. The models
are baked offline (`tools/bake-creatures.mjs`, gltf-transform):

- Each part's base colour goes into vertex colour, and all the parts are joined into **one primitive:
  one draw call per creature**.
- Only the clips we play are kept (idle, attack, hit, death, and a flight/run for fliers and walkers).
- Mesh data is quantized (KHR_mesh_quantization, which three's GLTFLoader reads natively; no decoder).
- A **LOD1** is simplified with meshoptimizer and bound to the **same skin**, so it shares the skeleton
  and the clips. The other seat's creatures draw LOD1, and mine draw LOD0, which matches 0027: mine are
  objects, theirs are entries.

The **holographic material** is one MeshBasicMaterial with onBeforeCompile, so three's skinning chunks
stay. Its vertex colour is mixed toward the faction tint. It adds a fresnel rim, scanlines that climb
slowly, a faint flicker, and two uniforms:

- `uForm` 0→1: the creature forms from the feet up, with a bright band at the edge.
- `uFade` 0→1: noise dissolve for a death.

All creatures share one program; each instance has its own uniforms. Faction tints come from
board.js's `FACTION`.

**Procedural fallback:** a unit with no mapped model, or one whose model fails to load, gets a
holographic *wisp*: an icosahedron core and the same shader. It is generic but still alive, and the
report names every unit that uses it.

### Card → creature (PROPOSAL: the choreography is art direction; the bible gives only "animates fully into the world")

| t (ms) | What happens |
|---|---|
| 0–350 | A holographic copy of the card (its painted art, public/cards) rises off the pad toward the board and turns to face the player |
| 300–650 | The card dissolves in faction light, and a burst of motes is thrown off |
| 450–1400 | The creature forms at the card (`uForm`), then flies (or leaps) the arc to its cell, from 1.15× to 1× scale; a flier takes off in a banking turn over the board (look.js flight()); the idle loop starts on landing |

The other seat's summons start from the far keep. With reduced motion, the creature forms in its cell
over 300 ms, and there is no card flight.

### Which creature (PROPOSAL: the bible names no creatures for these cards)

Set out in `src/summons/creatures.js`, one model per unit where the pack allows. Cinder Whelp is the
dragon.

### Attacks, from the view (pure, `src/summons/combat.js`)

Combat happens at every Pass (rules.rs `end_turn` → `combat`). The strike list is computed from the
view **before** the Pass, using the rules' own targeting (`target_in_lane`):

- A melee unit attacks only from the front cell, and hits the enemy front cell or the castle.
- A ranged unit attacks from any cell, and hits the nearest enemy, front to back.
- A Taunt draws every attacker in its lane.

A test holds the castle damage it predicts equal to the record's `TurnEnded { combat_damage }` across
both real desk fixtures. One `strike` effect carries every attack: they play together, as the rules
resolve them.

### Spells (pure, `src/summons/spells.js`)

The target is found in the diff: the damaged, healed or removed unit, the castle whose life fell, or,
for Undertow, the unit that changed lanes. Deep Breath targets the caster's deck. Kinds:

- Flare and Magma Burst: an ember **bolt** that bursts.
- Tidal Lash: a tide **bolt**.
- Riptide: a **vortex** that pulls the unit down.
- Undertow: a **wave** across the lanes, which the creature rides.
- Mend: rising **motes** and a ring.
- Deep Breath: motes that swirl up at the deck.

## Hooks (shared files touched minimally)

- `src/effects-player.js`: `onView` pushes `enrich(prev, next, diffViews(…))`.
  - enrich adds `strike` and `spell`.
  - It turns Undertow's death-plus-summon pair into `shift`.
  - The new types are not added to `DURATION`, so they keep the queue's 300 ms default, and their
    visuals run on past the slot. The sfx and access tests' "every DURATION type" invariants are unchanged.
- `src/index.js`: registers `SummonsSystem` after EffectsSystem (one line). Its models load before
  "loaded", so net afterLoad stays 0.
- `src/play.js`: as little as possible (the system reads `play.board`, `play.near` and `play.root`).
- `src/board.js`: nothing. For a slot that shows a creature, the system hides the stand-in box and lifts
  the stat plate above the creature's head, after the board draws.

## Budget (Quest 2: hold 72 fps; 3 creatures per side is the brief, and 9 per side must not fall over)

Targets:

- Triangles: at most 7.5k per LOD0 creature. Six creatures, three mine and three theirs, come to about
  32k triangles.
- One draw call per creature, plus one each for the card ghost, the motes pool and the spell effect.
- Download: models under 4 MB in total. Textures: only the atlas-textured models' small atlases.
- GPU skinning (three's bone texture). One AnimationMixer per creature.

The measured before/after numbers (draw calls, triangles, texture MB and download MB) go in the PR
from `__tapstone.summons.stats()` and `renderer.info`.

## Files

- New:
  - `src/summons/`
    - Pure: `creatures.js` (card → creature), `direct.js` (effect → animation state; reconcile to a
      view), `combat.js`, `spells.js`, `enrich.js`.
    - Scene: `holo.js` (the material), `system.js` (SummonsSystem), `spell-fx.js`.
  - `public/creatures/*.glb` and `public/CREDITS.md` entries.
  - `tools/bake-creatures.mjs`.
  - `test/summons.test.js`.
- Touched: `src/effects-player.js` and `src/index.js`, a few lines each.

## Order

Cinder Whelp end to end, then every unit, then the spells. Anything left undone uses the wisp
fallback, and the PR names it.

## Under the world art (2026-09-29, after #199 and #200)

- **Light.** The creatures stay unlit by the scene; their light is baked into the shader (`look.js`
  `lookFor`). It is a hemisphere term plus a soft wrap from a key above and ahead: warm (0xffc98a) in
  luna's lantern-lit Tea House interior, neutral in mixed reality. The models' own part colours stay,
  with only a touch of the faction's colour, and the rim is the faction's.
- **The whelp.** A flier takes off in a banking turn over the board, swinging away from the person
  and trailing embers, then swoops to its cell and turns to face the other seat (`look.js`
  `flight()`). Idle, it hovers, and an Ember creature sheds a drifting ember now and then. A glow
  disc grounds every creature; all the discs are one instanced draw call. PROPOSAL, like all of this look.
- **High contrast** (selene's `theme.js`). The three faction tints are themed as `faction.<f>` holders,
  which creatures copy, so no per-creature material is registered. The body goes opaque and flat,
  pulled 62% toward the faction's contrast colour, with a white rim and no scanlines or flicker. A
  test holds even a black part at 3:1 against the board.
- **Reduced motion.** A calm 400 ms scan-in where the creature stands; no flight, hover, embers or
  motes.
