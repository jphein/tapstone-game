# The Cinder Whelp from a free animated dragon, with the wyrm as fallback: design note

Date: 2026-09-29 · Lane: Morpheus · Branch `feat/xr-whelp-ccby`. Follows #206
(`2026-09-29-xr-summons-fidelity-design.md`). The lead's decision under JP's standing rule: a free,
credited CC-BY dragon, with the procedural wyrm kept as the fallback. Commissioning an artist stays
JP's call, because it spends money.

## The search (2026-09-29, no login anywhere)

The bar: CC BY 3.0 / 4.0 (or more permissive), not NC, ND or SA, not "personal use", and downloadable
without an account. Each license was read on the model's own page at download time.

| Candidate | Source | License | Verdict |
|---|---|---|---|
| Dragon Rigged, na3ee1 | poly.pizza WIOTISRjeX | CC-BY 3.0 | **Rejected**: the page's data marks it `SupporterOnly: true`. Its static file URL answered without a login, but taking it that way would sidestep the site's gate. Deleted, not vendored. |
| Red Dragon, Tomek Zamojski | poly.pizza 5SgYrV6nhws | CC-BY 3.0 | Rejected: static (no rig, no clips), 43k triangles |
| Dragon, Poly by Google | poly.pizza aQ6YU1JK1wC | CC-BY 3.0 | Rejected: static |
| Dragon, jeremy | poly.pizza 3ZuMS3IRb0C | CC-BY 3.0 | Rejected: static and blocky |
| animated-3d-dragon-model, BlueMonkMN | OpenGameArt | CC-BY 3.0 | Rejected: a walk cycle only, its wings crumpled, texture not node-linked |
| Dragon thingy, nazzyc | OpenGameArt | CC-BY 3.0 | Rejected: 50k triangles, no animation, an odd pose |
| wyvern-low-poly, p0ss | OpenGameArt | CC-BY 3.0 | Rejected: static |
| dragon-3d (GuieA_7), simple-3d-dragon-model (MattBas), dragon-cartoon (eddyfosman) | OpenGameArt | CC-BY-SA | Rejected by the rule (SA) |
| jade-dragon | OpenGameArt | GPL 2.0 | Rejected by the rule |
| FantasyDragon, peaznchips | OpenGameArt | CC0 | Rejected: its body is curve- and mesh-deform-driven and does not survive glTF |
| Cethiel's dragon, Drummyfish | OpenGameArt | CC0 | Rejected: no flight (attack, die, idle and walk only), chunky |
| **Low Poly Ice Dragon, xTerryx** | **OpenGameArt low-poly-ice-dragon** | **CC0** | **Chosen**: a classic horned, spined dragon with membrane wings and a real flight cycle on a 79-bone rig, ~2.5k triangles |

No CC-BY dragon passed both the license and quality bars. The best animated dragon that did pass is
CC0, which is more permissive than CC BY: it needs no attribution and binds nothing. It is credited
anyway, marked "modified".

## Approach

- **Convert.** `tools/convert-drake.py` (Blender 4.2 LTS, headless) relinks the palette texture and
  exports glTF with the Flying action. Blender is a build tool on familiar and is never shipped.
- **Bake.** `tools/bake-creatures.mjs` `drake` does what it does for the other models:
  - the palette goes into vertex colour, so no texture ships;
  - one skinned primitive, one draw call;
  - an LOD1 on the same skin.
  The one clip is kept as `move`.
- **Wire** (`src/summons/`):
  - `Cinder Whelp → drake`, with `fallback: 'wyrm'`. `resolveModel()` (pure, tested) picks the
    drake if it loaded, else the wyrm, else the wisp.
  - The drake gets the wyrm's staging: the summon sweep past the head, the fire breath, the landing
    puff, the attack snap and fire, and the shatter.
  - Its only clip is the flight, so it hovers on its cell with slower wingbeats (idle), and beats
    fast for an attack and the sweep. The jaw opens for fire through its jaw bone.
  - A fire heart rides the chest bone.
  - Reduced motion and contrast follow #197 and #206's rules unchanged.
- **Keep the wyrm**: it is the fallback if the file fails to load, and it stays in the tests.

## Budget

At most ~15k triangles for the whelp, with a lower LOD at board scale. The drake is ~2.5k at LOD0
and ~1k at LOD1, one draw call plus the fire heart, and no texture MB. The measured before/after
numbers go in the PR.

## Files

- New:
  - `public/creatures/drake.glb`;
  - `public/licenses/CC0-1.0.txt` (the CC0 text, as a courtesy);
  - `tools/convert-drake.py`.
- Touched:
  - `src/summons/{creatures,system,look}.js`;
  - `tools/bake-creatures.mjs`;
  - `public/CREDITS.md`;
  - `test/summons.test.js` and `test/wyrm.test.js`.

## What landed (2026-09-29)

- **The drake:**
  - LOD0 2474 triangles, LOD1 1122 (Blender Decimate: meshoptimizer removes nothing on this
    flat-shaded, non-manifold mesh);
  - one draw call, plus the fire heart on the chest bone;
  - 0 texture MB and a 607 KB file.
- **Staging:** it flies #206's sweep, breathes fire (its jaw bone opens), lands, hovers on its cell
  (its flight at 0.55×), strikes (1.9×) and shatters.
- **Fallback:** `?summonsDrop=drake` proves it in IWER: the whelp is the wyrm and runs the whole
  sequence.
- **Budget:** 3 a side plus both commanders comes to 122 calls and 111.0k triangles in MR (main with
  the wyrm: 124 and 111.2k), and 128 and 134.1k in VR (main: 130 and 134.3k). The summons' CPU fell
  (0.14–0.17 vs 0.19–0.20 ms/frame), since the drake isn't CPU-deformed.
