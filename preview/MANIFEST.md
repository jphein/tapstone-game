# Preview manifest

Every PNG here is a real engine state, not a mockup. Regenerate with the commands below; identical
input gives identical output, so a stale image is detectable by re-running and diffing.

| field | value |
|---|---|
| Engine baseline | `b05ecb4` — *feat(sim): fairness sweep*, i.e. **after** `fix/picker-plays-out-turn` merged |
| Game state | `play_seeded(seed = 21, max_taps = 400)`, replayed to **round 5** |
| Board at that state | 6 units (two of them the commanders, 0029), both seats occupied, back cells in play |
| Panel | 320×240, RGB565, landscape — exported at scale 1, so one pixel here is one pixel on the glass |

The seed and round are recorded here rather than burned into the frames: the PNGs are meant to be
exact device frames, and a caption baked into one would be 320×240 of something the panel will
never show.

## Files

| file | what it is |
|---|---|
| `screens/NN-<name>.png` | the ten screens, drawn against the ruled layout `v6-asym` |
| `all-screens.png` | all ten side by side at 2×, labelled |
| `layouts/<name>-seat0.png` | the battlefield as seat 0 sees it, one per candidate layout |
| `layouts/<name>-seat1.png` | the same `Game` as seat 1 sees it — the mirror |
| `comparison-lane-depth.png` | all five candidates side by side at 2×, for the lane-depth ruling |
| `mirroring.png` | `v6-asym` seat 0 beside seat 1, unscaled |

## The ten screens

`v6-asym` is the ruled layout, so every screen is drawn against it.

| screen | source of its state |
|---|---|
| `01-idle` | none — drawn locally rather than streamed from scry (feasibility red flag 2) |
| `02-pairing` | none — RSSI and ruleset hash are the screen's own |
| `03-setup` | real `Game`: castle names, who is first, hand size, castle life, sudden-death round |
| `04-battlefield` | real `Game` at seed 21 round 5 |
| `05-targeting` | same `Game`, `Opts { targeting }` |
| `06-combat` | same `Game`, `Opts { resolving: lane 2 }` |
| `07-sudden-death` | real `Game` replayed to the rules' own `pressure_from` round |
| `08-result` | real finished `Game`: winner, surviving life and round read from the engine |
| `09-spectator` | same `Game`, unmirrored arbiter view |
| `10-disconnected` | same `Game`, `Opts { overlay }` |

Six of the ten are the battlefield in a different state rather than separate drawing code, exactly
as the UX doc requires — *"No screen change — this is the battlefield with a locked prompt line"*.
That is why they are `Opts` on one renderer: a layout change cannot move them out of step.

The prompt is the shortened `"YOUR TURN - tap a card, touch to aim"` (296 px of 320). The doc's
original 43-character wording needed 338 px and clipped; the ruling was to shorten the sentence
rather than drop a type tier, since life and mana are glanceable state read at speed while the
prompt is read once. `bottom_band_width` holds that line in a test.

## Candidates

| name | my cell | their cell | sprite | whole board | lane→apron | 32 px base | 44 px touch |
|---|---|---|---|---|---|---|---|
| `v6-asym` | 36×106 | 20×106 chip | 34 | yes | matches | yes | no (36) |
| `h6-full` | 49×64 | 49×64 | 48 | yes | **rotated** | yes | yes |
| `v6-full` | 28×106 | 28×106 | 26 | yes | matches | **no** | no |
| `v4-front2` | 42×106 | 42×106 | 40 | **no** | matches | yes | no |
| `doc-3row` | 56×106 | — | 48 | **no** | matches | yes | yes |

`doc-3row` is the UX doc's layout as written. It is included only to show what the document
specified; it cannot display the engine's board, because a lane holds six cells and it draws three.

## The HUD's dark well

The UX doc tints the active player's HUD band with their faction colour and puts the castle life,
name and mana on it. Drawn at real pixels, **every foreground the HUD uses is illegible on every
tinted band** — measured with WCAG relative luminance, against a 3:1 floor:

| | Ember `#ff8a3d` | Tide `#35c8e0` | Warm `#ffd166` | Panel `#101728` |
|---|---|---|---|---|
| `HEALTH_OK` | 1.22 | 1.05 | 1.33 | 9.33 |
| `HEALTH_MID` | 1.44 | 1.23 | **1.13** | 10.95 |
| `HEALTH_LOW` | 1.33 | 1.56 | 2.16 | 5.74 |
| `TEXT` | 2.00 | 1.71 | 1.23 | 15.22 |

The worst case is the one that matters most: `HEALTH_MID` on the sudden-death gold is **1.13:1**,
so the castle life disappears exactly when a player is checking it every turn. And it applies to
the *active* player's own band — the one you look at on your turn.

The fix keeps both signals by separating them: the band stays tinted, because that is a
band-level cue meant to be read across the table, and the readouts sit in a `PANEL` well inside
it. Tint and foreground cannot both carry meaning in the same pixels. Locked by two tests in
`palette.rs` so re-tinting a band or adding a faction hue cannot quietly reintroduce it.

## Cell marks

Enemy chips and my own cells both carry a mark in the 44 px gap that was already free:

| mark | meaning | derivable from |
|---|---|---|
| `NEW` (gold) | summoned this round or last | **one** state — `Unit::entered_round` |
| `FRONT` (red) | reached the front cell since the previous frame | **two** states — a diff |

Per decision 0027, "just reached the front" is a *view* concern and does not enter the hashed
image. The shrine applies every committed record, so it keeps the previous `Game` — 350 bytes and
`Copy` — and diffs. No golden moves and the protocol is untouched.

A shrine joining mid-game has no previous frame and therefore shows no `FRONT` marks until the
next turn. That is the correct degradation: inventing one would claim a unit just arrived when it
may have stood there for three rounds.

`04-battlefield` shows three arrivals at seed 21 round 5, which `tests/arrivals.rs` independently
confirms is the busiest arrival state in the first 24 seeds.

## Prompts

Every prompt is built from `battlefield::Prompt` and fitted to a budget computed from what else
shares its 24 px line, rather than hand-tuned. A prompt too long for its band is truncated with a
visible `..` so a clipped prompt reads as clipped, instead of ending at the panel edge as if it
had finished — which is how a 50-character targeting prompt went unnoticed.

The enumeration lives with the construction, not in the test: `Prompt::index` is an exhaustive
match, so a new variant will not compile until handled, and `worst_covers_every_variant` fails
until `Prompt::WORST` names it too. Each worst case uses the longest real name in the card table,
so a prompt cannot pass with "Flare" and clip with "Pearl Shieldbearer".

## The card-to-castle flourish

`flourish.gif` plays at the real 15 fps cadence; `flourish-frames.png` is the same twelve frames
laid out for anyone who cannot view a GIF; `flourish/frame-NN.png` are the frames themselves at
1:1. Seed 21, round 5, lane 2, Flare.

Twelve frames, 800 ms: seven of rise (the token travels its lane from my wall to theirs), three of
impact (hit flash then a ±2 px shake), two of tick (the struck castle's life drops, 15 → 13).

### What it assumes

**That the shrine rasterises locally into a 320×240 RGB565 buffer and blits it over SPI.** Every
number here is a property of that path and of this panel, not of a firmware seam.

That matters because the seam is unsettled. Decision 0010 named the fleet flavor, whose
`app::Oled` on the S3 is a logical **72×40 one-bit** surface (smol `rust/clock/src/s3_oled.rs`) —
no colour, and shorter than a single 48 px sprite. The colour path on the same board is
`targets/s3-cyd/spike-scry`, driving the real panel through mipidsi. 0010's ruling that the shrine
is a framebuffer app stands; the framebuffer it assumed does not.

`spike-scry` today **streams server-rendered frames over WiFi**. If the shrine ends up there
rather than rasterising locally, **none of this transfers** — the model would need redoing with
network latency and frame transfer in it, and the bottleneck would not even be the same component.

### What it costs

| frame | phase | dirty px | one window | same area per-cell | full repaint |
|---|---|---|---|---|---|
| 0 | Rise | 3,180 | **1.4 ms** | 6.3 ms | 32.3 ms |
| 1–6 | Rise | 5,618 | **2.4 ms** | 6.3 ms | 32.3 ms |
| 7–11 | Impact / Tick | 12,160 | **5.2 ms** | 9.5 ms | 32.3 ms |

Worst frame **9.8 ms** even at the pessimistic end of the per-window range, against a **33.3 ms**
draw budget — 29 % spent, 71 % left for the engine, the mesh and the touch poll.

**The flourish JP described fits, comfortably.** That was not the expected answer: the motion
crosses the whole panel vertically, which sounds expensive. It is not, because cost is driven by
*window count* first and pixel count second, and a lane is only 106 px wide — so a full-height
traversal inside one lane dirties 16 % of the panel at most.

Two things make that true, and both are design rules rather than happy accidents:

1. **One contiguous dirty rectangle per frame.** During the rise it is the union of the token's
   old and new positions; during impact and tick it is the enemy HUD and wall, which are adjacent
   and so merge into one band instead of costing two windows.
2. **Never redraw per cell.** The same area split across three cell-sized windows costs 5.6 ms
   instead of 2.1 ms. The naive optimisation — "only redraw what moved" — is the expensive choice
   here, which is exactly what the device table warns about.

### Is a lane the right window?

The whole lane column between the HUD bands, costed three ways:

| shape | pixels | cost |
|---|---|---|
| **one lane-column window** | 20,352 | **8.6 – 13.2 ms** — 40 % of the budget |
| same column, six per-row windows | 20,352 | 8.9 – 36.7 ms — **110 %** of the budget |
| full repaint | 76,800 | 32.3 ms |

The column wins at both ends of the range. **So the natural unit of animation on this panel is a
lane — which is also the natural unit of the game.**

Per-row splitting now **exceeds** the budget at 36.7 ms against 33.3 ms. It did not under the old
wire constant, where it landed at 32.4 ms and fitted by 3 %. That change is instructive rather
than incidental — see *A correction to the wire constant* below.

A full repaint is itself now **97 %** of the draw budget. At 15 fps it leaves nothing for the
engine, the mesh or the touch poll, which turns banding from an optimisation into a requirement
on timing grounds as well as memory grounds.

### A correction to the wire constant

Every version of this model until 2026-09-22 used **27 ms** for a full-frame wire transfer, taken
from `DISPLAY-PACKAGE.md:224`. **That figure is below the physical floor.** One bit per clock at
40 MHz puts a frame's 1,228,800 bits on the wire in **30.72 ms** before any command overhead, so
27 ms implies 45.5 MHz.

The document says where it came from — line 394: *"Full-frame timing for Path A: extrapolated from
explore-ember's 320×240 numbers, not measured."* It was never a full-frame measurement. The two
figures in the same paragraph that **were** measured both sit at line rate and confirm the clock
is right: 107 KiB in ≈21 ms is 41.7 Mbit/s, 26 KiB in ≈5 ms is 42.6 Mbit/s.

`WIRE_FULL_MS` is now derived from `SPI_HZ` and the frame size rather than quoted, so changing the
clock moves the model instead of leaving a typed number to disagree with it.

**What the correction moved, and what it did not:**

| | old (27 ms) | corrected (30.72 ms) |
|---|---|---|
| column : per-row cost ratio | 0.3613 | **0.3613** — exactly invariant |
| flourish worst frame | 26 % of budget | 29 % |
| lane column | 35 % | 40 % |
| six per-row windows | 97 % — fits | **110 % — exceeds** |
| full repaint | 86 % | 97 % |

**Ratios between two paths on the same wire are invariant**, because the wire speed cancels. That
is the firmware-shaping part — a lane is still the right window, by exactly the same margin.

**Verdicts against the budget are not invariant**, because the budget comes from the frame rate
rather than from the wire, so it does not scale with the correction. Everything moves up against a
fixed line, and per-row splitting crosses it.

This is the case for costing across a range rather than at a single value: the conclusions that
were stated as ratios survived a 14 % error in the underlying constant untouched, and the one
conclusion that was stated as a position against a fixed budget did not.

### What this costing cannot tell you

The per-window overhead is **one measured point extrapolated** — nine windows costing 2× a full
repaint — and one point cannot fix the shape of a curve. The derived value (≈4.15 ms per window)
is also implausibly large for the SPI transaction alone, since a `set_addr_window` is about 11
bytes, roughly 2 µs on a 40 MHz bus; it must be driver, DMA-setup or CS-toggle overhead, which
need not scale linearly.

The wire figure is now a **floor**: real transfers carry command and window-setup overhead on top,
so the model underestimates cost. That is the optimistic direction for a "does it fit" verdict, so
a frame with little headroom needs a device measurement before it is believed. The flourish, at
29 % of budget, has margin enough to survive substantial overhead; per-row splitting at 110 % is
already over without any.

So every frame is costed across the whole plausible range (0.05–4.68 ms per window) and the
verdict only reads "fits" when it fits at **both** ends. Here it does, by a wide margin, so the
conclusion survives being wrong about the constant. A design that fitted at one end only would be
reported as needing a device measurement rather than as an answer.

## Regenerate

```sh
cd rust
cargo run -p shrine-preview -- layouts --seed 21 --turn 5 --out ../preview/layouts --scale 1
cargo run -p shrine-preview -- all --seed 21 --turn 5 --out ../preview/screens --scale 1
cargo run -p shrine-preview -- flourish --seed 21 --turn 5 --lane 1 --out ../preview/flourish
cargo run -p shrine-preview -- flourish-cost # ms per frame, both strategies, both ends of the range
cargo run -p shrine-preview -- audit          # the geometry table, with the ruling criteria
cargo run -p shrine-preview -- scan           # find the busiest board across seeds/rounds
cargo run -p shrine-preview -- battlefield --seed 21 --turn 5 --layout v6-asym --view seat1
```
