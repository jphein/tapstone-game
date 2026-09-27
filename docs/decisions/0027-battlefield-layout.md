# 0027 — The battlefield is asymmetric: my three cells at 36 px, theirs at 20
Date: 2026-09-22 · Delegated by JP · Ruled from rendered comparison, not from the wireframe

> **No longer a shrine screen (0028, 2026-09-23):** the battlefield moved to the arena. The ownership lesson carries over as the arena's brief; the 320×240 geometry does not.

The shrine's battlefield uses **`v6-asym`**: three lanes as columns, my three cells at 36 px each
with a 34 px sprite and stats beside it, the opponent's three at 20 px each as a stat chip.
`3×36 + 3×20 = 168`, which is the lane budget exactly. Supersedes the battlefield wireframe in
`docs/design/shrine-ux.md`, whose geometry remains in that file as recorded intent.

## The wireframe could not display the game

The UX doc drew three rows per lane and admitted its own premise: *"rules TBD — the grid is what the
screen commits to."* It committed while the rules were open, and the rules landed elsewhere. The
engine gives **each seat its own three-cell track** (`state.rs`: `cells` is a field of `Seat`), so a
lane holds **six** cells, not three. After two 24 px HUD bands and two 12 px walls, 168 px remain:

| layout | my cell | their cell | sprite | whole board | lane axis matches apron | 32 px sprite | 44 px touch |
|---|---|---|---|---|---|---|---|
| **v6-asym** | 36 | 20 chip | 34 | yes | yes | yes | no |
| h6-full | 49 | 49 | 48 | yes | **rotated** | yes | yes |
| v6-full | 28 | 28 | 26 | yes | yes | no | no |
| v4-front2 | 42 | 42 | 40 | **partial** | yes | yes | no |
| doc-3row | 56 | — | 48 | **partial** | yes | yes | yes |

So the ruling JP was originally asked for — three rows of 56 or four of 42 — was moot. Neither can
show the engine's board.

## Why asymmetric, and the reason that only appeared once it was drawn

The two halves are not symmetric in what the player *does* with them. I act on my units — summon,
advance, target — so they need a sprite, a touch target and room for stats. I only need to **read**
theirs, so a chip carrying faction rim, attack, current health and keyword says everything a glance
needs and nothing a finger needs.

The argument that decided it was visible only in the render: **the asymmetry doubles as an ownership
cue.** Mine are objects, theirs are entries, so no player can misread whose unit is whose at any
speed. None of the symmetric layouts has that property at any cell size.

## What was rejected, and why the reasons matter

**`v6-full` (honest 28 px both sides) is not illegible** — 26 px sprites read fine and the board is
comprehensible. It was expected to fail on legibility and did not. It loses **information**: at
28 px the value/pips/keyword stack does not fit, so keyword tags drop from both sides, while
`v6-asym` keeps them on both. Dominated, not too small.

**`h6-full` is the handsomest of the five** and satisfies every constraint the doc wrote down,
including the 44 px touch target. It is rejected because decision 0018's three-pad apron makes lane
a **physical left-to-right position**, and rows-as-lanes puts lane 1 at the top while its pad is at
the left — a 90° mental rotation paid on every glance, on the screen the player looks at most. It
also moves ownership from bottom/top to left/right, contradicting the doc's own "my row is the
bottom". It would win immediately if the shrine were ever the only board and the mat went away.

**Touch was weighted lowest deliberately.** Decision 0009 already makes touch the fallback rather
than the primary, and 0018 removes lane-choice touch entirely by letting a card be tapped into its
pad. Buying a comfortable touch target by spending the physical lane mapping is the wrong trade for
this screen.

## Settled alongside

- **Neutral's colour** is a desaturated slate deliberately off the faction axis — Neutral is the
  absence of a faction, not another one. The doc's Grove and Grave describe a set that does not
  exist; `cards::Faction` is Ember, Tide, Neutral.
- **The bottom band overflowed by 18 px** (338 px of 320, visible as clipped text in every render).
  Fixed by shortening the prompt rather than dropping a type tier: life and mana are glanceable
  state that must survive at speed, while the prompt is read once.
- **Only one `⚖ JP` ruling ever existed** in the UX doc. Line 5 claimed three; #2 and #3 were never
  written, not removed.

## How this was decided

From `preview/comparison-lane-depth.png`, rendered by `rust/shrine-preview` at exactly 320×240
RGB565 through `embedded-graphics` — the same library decision 0010 puts in the firmware — driven
by a real engine state (seed 21, round 5, chosen by a scan for a board with units on both sides and
back cells occupied). A wireframe in a monospace grid hid all three geometry failures above.

## Amendment 2026-09-22 — the HUD may not tint and inform in the same pixels

Rendering the ten screens found a defect in the UX doc's HUD, of the same class as its palette: the
doc tints the active player's band with their faction colour **and** puts castle life, name and mana
on it. Measured against a 3:1 contrast floor, **every HUD foreground is illegible on every tinted
band.** The worst case is `HEALTH_MID` on the sudden-death gold at **1.13:1** — castle life
disappearing exactly when a player checks it every turn, on the band they look at during their own
turn.

**Ruling: the band stays tinted and the readouts move into a dark well inside it.** The two signals
have different audiences — the tint is meant to be read across the table, the readout by its owner —
so making them share pixels was always going to sacrifice one. Two tests hold both halves: raw
readouts must fail on tints, and the well must be legible on every band, so re-tinting or adding a
faction hue cannot quietly reintroduce it.

Both this and the palette defect surfaced the same way: not by reading the doc, but because a render
came back with a value that could not be read. That is the argument for building the preview in
`embedded-graphics` rather than mocking it — the library refuses to let prose stay ambiguous.

## Amendment 2026-09-22 — marking enemy units, and where that state belongs

The 20 px enemy chip has **44 px of unused horizontal gap** (3 px rim, 18 px for attack/health, 4 px
health dot, 18 px right-aligned keyword), so a marker costs no space and no layout change. A gold
`NEW` is therefore free.

But it can only mean **newly summoned**, not newly **arrived in the front cell**, and those differ:
`entered_round` is set when a unit enters play and `advance` never touches it, while
`lanes_advanced` is cleared at its owner's turn start and so is already gone when the enemy board is
drawn. "What just became dangerous" — the state that actually changes what you do next, since combat
resolves against the front cell — is not derivable from a single canonical state.

**Ruling: do not add a per-unit arrival field.** This is a **view** concern, not a rules one, and it
does not belong in a hashed image. The shrine applies every committed record, so it keeps the
previous `Game` — `Copy`, 350 bytes, one frame back costs nothing — and derives arrivals by diffing
consecutive states. Nothing enters the canonical image, no golden moves, the protocol is untouched.
A shrine joining mid-game has no previous frame and shows no arrival markers until the next turn,
which is the correct degradation.

The general form is worth keeping: **state that only the view needs should be computed by the view,
not added to the thing that is hashed.** Every field in the canonical image is a permanent
commitment to the wire format.

## Amendment 2026-09-22 — why the preview crate is worth maintaining

`rust/shrine-preview` is a 320×240 renderer in a repo that ships no UI, so its keep needs
justifying. It earns it by being a **different kind of check from a test**, and the record of one
day says so concretely. Every real defect it found was invisible to both reading and testing:

- The battlefield wireframe could not display the engine's board. Six cells per lane against a
  three-row grid, hidden because a monospace wireframe has no pixel budget.
- The palette named two factions that cannot be drawn and **omitted one the renderer must colour on
  every frame**. Surfaced because the palette module must map every variant, so the compiler
  demanded a colour the doc never mentioned.
- Every HUD foreground was illegible on every tinted band, worst case 1.13:1. Surfaced because a
  render came back with a number that could not be read.
- The bottom band needed 338 px of 320, visible as clipped text in every screen.
- An arrival marker was drawn for enemy chips and silently dropped for the player's own units. The
  code compiled, the unit tests passed, and the picture looked plausible. It surfaced because a
  test counted three arrivals where the render showed none.

The pattern in the last one is the general case: **two of the three defects caught from inside came
from an instrument disagreeing with a picture, not from a test failing.** Synthetic unit tests build
the state they expect and therefore agree with themselves. A render driven by real engine output and
a measurement taken from the same output can disagree, and that disagreement is the signal.

This is also why the preview is built in `embedded-graphics` at the device's exact resolution rather
than mocked in HTML: it is a prototype of the firmware renderer under decision 0010, so it inherits
the real constraints instead of approximating them, and the two cannot drift apart into a handsome
picture of a screen the shrine will not show.
