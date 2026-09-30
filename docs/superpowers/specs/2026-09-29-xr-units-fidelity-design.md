# The units look like their cards: design note

Date: 2026-09-29 · Lane: Morpheus · Branch `feat/xr-units-fidelity`. Follows #210 (the drake). The lead,
on JP's "everything beautiful": the other units still read as chibi Quaternius figures next to the
drake.

## What the cards show (public/cards/*.webp)

Most of set 1's units are **people**, not monsters. #197's picks (a fish, a bird, a demon) matched
neither the cards' subjects nor the drake's realism.

| Card | Painted subject |
|---|---|
| Ashen Vanguard | a charging armoured knight with a sword |
| Hearth Warden | a heavy horned-helm knight, tower shield and sword |
| Pearl Shieldbearer | a helmed warrior with a round pearl shield and sword |
| Reef Archer | a hooded archer drawing a bow |
| Tidecaller | a hooded, robed caster with a staff, arms raised |
| Brine Skimmer | a hooded youth surfing a shell, harpoon in hand |
| Forge Runner | a young man running, an ember glowing in his hands |
| Bellows Raider | a wild-haired raider, bellows on his back, a jet of flame |
| Slag Brute | a hulking molten rock golem |
| Trench Leviathan | a vast spiked crab-like beast of the trench |

## The bar

The same bar as the drake:
- CC0 or CC BY 3.0/4.0 only, with no NC, ND or SA, nothing supporter-only and nothing needing a login;
- the license quoted from the model's own page, the files' sha256 recorded, marked "modified";
- animated wherever possible.

## Sources (downloaded 2026-09-29, no account)

Every file below states CC0 on its own page and in its own license file.

- **Quaternius, *Modular Character Outfits – Fantasy* [Standard]**: the free tier (the paid Source tier
  is not used). It holds the Ranger and Peasant outfits, male and female. From itch.io, "Name your own
  price" with a minimum of 0, taken through the page's own free download.
- **Quaternius, *Universal Base Characters* [Standard]**: the heads, hair and beard.
- **Quaternius, *Universal Animation Library* [Standard]**: the clips, on the same 65-bone rig: idle,
  sword attack, spell cast, punch, hit, death, jog and sprint.
- **Kay Lousberg, *KayKit Adventurers 2.0* [Free]**: props only: the knight's helm and visor,
  swords, shields, a staff and a bow. The KayKit characters themselves are chibi, so they were rejected.
- **Quaternius, poly.pizza**: "Giant" (BldaiPtyJa, CC0) for Slag Brute, and "Crab Enemy" (Gs3yfsV5lB,
  CC0) for Trench Leviathan.

Rejected:
- mastjie's "Warrior" ×3 and "Male Fighter" (CC0, realistic): not rigged, so no clips.
- KayKit's characters: chibi.
- The Quaternius knight outfits and the RPG Characters pack: the first is paid only; the second is on a
  Google Drive that answered "quota exceeded".

## Approach

- **Assemble** (`tools/assemble-units.py`, headless Blender 4.2, a build tool only). One recipe per card:
  1. The outfit, plus only the head and hands of the base body (what the clothes don't cover, so
     nothing clips through a holographic body).
  2. Hair, and props on the hand and head bones.
  3. The chosen clips.
  4. Everything joined on one armature and decimated to ~7k triangles.
- **Bake** (`tools/bake-creatures.mjs`): the textures go into vertex colour, so none ship. Each unit is
  one skinned primitive, with an LOD1 on the same skin. The recolour follows 0039: Forge Peaks ember
  and gold, Deep Tides blue and pearl.
- **Runtime:** #197 and #206's material, contrast and reduced-motion rules, unchanged. New:
  - Forge Runner's ember glows in his hand (a fire heart on the hand bone).
  - Bellows Raider's attack is a jet of flame (the whelp's fire, from his hand).
  - Brine Skimmer rides a shell (a prop under her feet).
- **Anything that can't clear the bar keeps its current model**, and the PR says so in a table.

## Budget

- Per unit: ≤ ~7.5k triangles at LOD0 and ~40% at LOD1. The other seat's units draw LOD1.
- One draw call each. No textures.
- The added download stays under ~10 MB.
- Before and after, like for like against origin/main: 3 a side plus both commanders, in MR and VR.

## Files

- New: `tools/assemble-units.py`, `public/creatures/<unit>.glb`, and `public/licenses/` (as needed).
- Touched: `src/summons/{creatures,system}.js`, `tools/bake-creatures.mjs`, `public/CREDITS.md` and
  the tests.

## What landed (2026-09-29)

- **Every unit is replaced; none kept its old model.**
  - The eight people are 7000 triangles at LOD0 and 2800 at LOD1 (Blender Decimate), 0.8–1.2 MB each.
  - The Slag Brute is 3.8k / 1.5k and the Trench Leviathan 3.6k / 1.4k.
- **Recolours** live in `tools/recolour.mjs` (pure, tested). The base body's skin, eyes and hair keep
  their colour.
- **Budget:** 3 a side plus both commanders comes to 122 calls and 106.2k triangles in MR (main: 122
  and 111.0k), and 128 and 129.3k in VR (main: 128 and 134.1k). The summons' CPU rose to 0.2–0.3
  ms/frame (main: ~0.13), because the rigs have 65 bones. Halving the far seat's clip rate made no
  measurable difference, so it was not kept.
- **Download:** +9.23 MB added, −2.87 MB of ten retired models, so +6.36 MB net (creatures total 13.4 MB).
- **Left:**
  - The two knight-like cards share one helm; a free realistic knight outfit doesn't exist (Quaternius's
    is paid).
  - Hair whose texture isn't in the free tier is baked dark brown.
