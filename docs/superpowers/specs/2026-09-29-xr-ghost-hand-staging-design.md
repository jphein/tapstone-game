# The ghost hand, staged where the move happens: design (2026-09-29)

Branch `fix/xr-ghost-hand-scale`. Part of #129. Follows #198 (guide v2).

## The problem
The lead's review of `scratch/issues/aster-guide2/guide-hands-02-demo-flip.png`: in hands mode the
ghost hand fills the lower-left quarter of the view and would cover the fan and the stone. Two causes
in `src/guide/ghost.js` and `demo.js`:
- **The forearm points at the player.** It runs 12 cm from the pinch back toward the head.
- **The demo pinches at the fan and reaches from above it.** The fan is the thing closest to the eyes
  (about 0.31 m), so the arm ends 10–15 cm from them.

## Goals
- **Where the move happens.** The demo hand works at the card's or the stone's distance, at life size
  (palm about 8 × 9 cm, the length of an adult hand), and comes from the side of the reaching hand
  (the right, or the left in the left-handed layout). It is never between the eyes and what it points
  at.
- **It never covers what it teaches.** The card it demonstrates (until the pinch, after which the card
  is in its fingers), the target pad and the caption banner each stay clear of the hand, from any head
  a player uses: standing, seated, leaning in, or off to the side.
- **It fades** in as it reaches and out as it rises, so it never pops.
- **High contrast and luna's lighting** still read (the materials keep #200's roles).

## Approach
- `src/guide/demo.js` (pure):
  - `stage(head, from, to, side)` gives the lateral direction the hand works from: horizontal, square
    to the line of sight, toward the reaching side, and a little away from the head.
  - `poseAt` takes it. The reach and the rise come in and go out along that side, not from above; the
    carry arcs out to that side, not up toward the eyes. It answers the palm's centre and an `alpha`
    (the fade) as well as the pinch point.
- `src/guide/ghost.js`:
  - the forearm becomes a short wrist that fades;
  - the hand is turned (yaw) so its palm lies along the lateral direction, and the wrist roll turns it
    over about that axis;
  - the opacity follows `alpha`.
- **The head** comes from `play.js` in board-local metres, already passed to `ghost.update` (#198),
  now also to `show`.

## The rule, as a test (`test/guide-staging.test.js`)
- **Heads:** standing (`defaultHead`), seated (lower), leaning in (xr_capture's framing), and 12 cm to
  either side, right- and left-handed.
- **Checks,** at every 20 ms of every demo (draw, charge, cast, claim, pass):
  - every point of the hand is at least `MIN_EYE` from the eyes;
  - the hand's angular size is under `MAX_DEG`;
  - the hand's bounding sphere crosses none of the lines of sight to the target pad, to the caption
    and (before the pinch) to the card it demonstrates.
- **Controls:** the old staging (the pose from above, the forearm toward the head) must fail it.

## Budget
Geometry only: the forearm shrinks to a wrist stub, so triangles fall slightly. No new draws or
textures, nothing downloaded.

## Proof
- Before and after stills from `guide-hands-02-demo-flip.png`'s view, plus standing, seated,
  left-handed and high contrast, on the B60.
- The projected footprint of the hand, measured in the page before and after.
- Node and vite green; a perturbation.

## As built (2026-09-29)
- **`stage()` turns away if the preferred side would cover something.** It tries the reaching side
  first, then the nearest turns (±30°, ±60°, …), and picks the first staging with no breach of the rule
  (`breaches()`, the same function the test uses). Every staging in the test stays on the reaching side
  (x > 0.6 right-handed, < −0.7 left-handed) and turned away from the head.
- **The eye rule is relative to what is shown.** No part of the hand is nearer the eyes than the card
  or pad it demonstrates, less 3 cm (it is at the card, never in front of it), and never nearer than
  `MIN_EYE` = 12 cm. The hand's nearest point is taken from the pinch, the palm and the wrist, less 4 cm
  of thickness. `MAX_DEG` = 45°. What covers is the palm and wrist (the fingertips touch the card and
  the stone by design).
- **Seated mode re-places the board from the head,** so a seated head is the standing one (the page
  measured them equal). The test adds a slumped head nearer than placement allows, as a stress case.
- **The ghost card is centred on the pinch,** so at the pinch it lies over the card it shows.
  Hung off the fingertips, it stuck out toward the viewer once the hand came from the side.
- **Measured on the B60** (`tools/iwer-ghost-views.mjs`, the hand's projected share of the left eye's
  view, and its nearest point to the eyes):

  | view | nearest before → after | share before → after |
  |---|---|---|
  | leaning, the lead's view | 0.12 → 0.20 m | 32% → 6.2% at most |
  | standing and seated | 0.21 → 0.29 m | 17% → 3.7% |
  | close (stress) | 0.11 → 0.16 m | 26% → 11.8% |
  | left-handed | 0.12 → 0.21 m | 32% → 5.8% |
  | high contrast | as leaning | as leaning |

- **Budget:** unchanged, +16 draws and +3,484 triangles while a demo shows (the wrist has the old
  forearm's tessellation); nothing downloaded.
