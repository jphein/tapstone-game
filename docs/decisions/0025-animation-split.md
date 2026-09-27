# 0025 — Veo animates the arena and the phone; the shrine gets pixel sprites
Date: 2026-09-22 · JP's ruling

> **Amended by 0033 (2026-09-23):** the SD card lifts the storage reason; the verdict stands on the other three.

Generated video (Veo on Vertex, via `~/Projects/magic/tools/cardart.py`) animates **the arena and
the phone** — the card pages at `tapstone.realm.watch/c/<slug>/` and, when there is an arena screen
on the table, its browser canvas. The **shrine** gets small animated pixel sprites instead: a card
resolving to a castle, a unit lunging, a death. Decision 0014's hand-made pixel art stands for
anything the shrine draws.

## Why the split is forced, not aesthetic

**Veo cannot run at tap time.** It is a cloud call costing roughly $0.15–0.40 per second of video,
so every clip is pre-baked per card design at build time and shipped as data. That is compatible
with 0010 ("a new card set is a data update"), but it rules out anything generated from live board
state.

**The shrine has no room.** The s3-cyd is 16 MB of flash, and the OTA table spends 12 MB on two
6 MiB app slots, leaving 3–4 MB for card data. A full-screen 320×240 clip at 15 fps costs roughly
120 KB per second even as compressed frames, so the whole data partition holds a couple of seconds
per card across a dozen cards and essentially nothing across two hundred. The 8 MB of PSRAM helps
playback, not storage: it can hold about 54 decoded full-screen frames, so a short flourish plays
fine once it is on the board. **Storage is the wall, not playback.**

**Downscaling fights the art.** Veo output reduced to a 32–48 px sprite is mush. 0014 chose
hand-made pixel art at a 32 px base after small-screen research, and that decision is about
legibility at 5.62 px/mm, which generated video does not survive.

**The board cannot be generated at all.** Board states are combinatorial, so they cannot be
pre-baked, and they cannot be generated live at a cloud call per frame. An arena canvas has no such
limit, which is where "the whole board, animated" belongs — 0010 already anticipates the arena
carrying the animation when one is present, with the shrine showing the personal panel.

## What this settles

- **Shrine:** pixel sprites only, per 0014 — three idle poses, one attack pose, shared
  summon/lunge/flash/death effects, plus short card-to-castle flourishes. Runtime data in the flash
  partition (0010), so a new set is a data update. Budget stays the UX study's: one animated band at
  a time, ~15 fps, and note that per-cell partial SPI windows are **2× slower** than a full repaint.
- **Card pages and arena:** Veo, at whatever fidelity the medium allows. Already live for the
  Hullbreaker demo (7–11 MB clips served by Caddy).
- **`cardart.py` keeps its `shrine-WxH.mp4` output** as a reference render for art direction, not as
  something the shrine plays.

Supersedes nothing in 0014; it answers the question 0014 did not face, which is what happens when a
video generator is available and a 320×240 framebuffer is the target.

## Amendment 2026-09-22 — the flourish fits, and the condition is the result

The card-to-castle flourish JP asked for was prototyped and costed against the panel's measured
numbers (`rust/shrine-preview`, frames and GIF in `preview/`). **It costs about 26% of the frame
budget and needs no reduction** — worst frame 8.7 ms at the pessimistic end of the range against a
33.3 ms draw budget, leaving 74% for engine, mesh and touch.

**The condition is the whole result: one contiguous dirty rectangle per frame, and never a per-cell
redraw.** Cost on this panel is driven by *window count first and pixel count second*, which is
counter-intuitive and is what makes the naive optimisation the expensive one. A lane is only 106 px
wide, so a full-height traversal inside one lane dirties at most 16% of the panel in a single
window. The same motion drawn as per-cell windows costs roughly twice as much for the same pixels.

**A factor-of-two disagreement in our own documents had to be settled first.** The device table says
per-cell SPI windows are 2× a full repaint; the UX doc's motion budget prices a 56 px row at "23% of
the frame ≈ 7 ms" with no 2× applied. Both cannot describe the same operation. smol's
`targets/s3-cyd/BOARD.md:68-70` resolves it: the 2× sits in a sentence contrasting **contiguous**
windowed writes (`fill_contiguous`) against per-pixel `draw_iter`, so the penalty is **per window,
not per pixel**. One contiguous band is priced by its pixels and the 7 ms figure is correct. A test
pins that specific row, so anyone "fixing" the model to apply 2× per pixel breaks the build.

**What this costing cannot tell you, stated where it is used.** The per-window overhead is a single
measured point extrapolated, and the derived ~4.15 ms is implausibly large for an 11-byte
`set_addr_window` at 40 MHz, so it is probably driver or DMA overhead that need not scale linearly.
Every frame is therefore costed across the whole plausible range and reads "fits" only when it fits
at both ends. This one does by a wide margin, so the verdict survives the constant being wrong. A
design that fitted at one end only is reported as needing a device measurement rather than as an
answer.

Two defects the render caught that the tests had passed, both of which would have shipped as a
working animation: the impact painted the struck wall in the **attacker's** faction colour, so an
Ember spell turned the Tide castle orange and read as the wall changing hands rather than being hit;
and the tick flashed while castle life never changed, an animation depicting a hit with no
consequence, which teaches a player that the flourish means nothing.

## Caveat 2026-09-22, resolved below — the absolute timings above quoted an impossible constant

The full-repaint constant used throughout (~28.6 ms, from the UX doc's ~29 ms) is **below what the
wire can do**. A 320×240 RGB565 frame is 153,600 bytes — 1,228,800 bits — and the panel SPI is
configured at 40 MHz (`spike-scry/src/main.rs:102`, and `BOARD.md` agrees), so a frame cannot cross
in under **30.7 ms** before any command overhead. One of three things is therefore wrong: the
measurement, the 40 MHz figure, or the claim that what was measured was a full 320×240 frame. The
letterboxed 288×160 image would be 18.4 ms, which is not 27 either; at 80 MHz the floor is 15.4 ms
and 27 ms becomes unremarkable, so a different clock is the likeliest explanation.

**What is expected to survive, and why.** Every verdict here was costed across a range and reads
"fits" only at both ends, and the flourish had 74% headroom, so a ~7% scaling moves no conclusion.
More importantly the load-bearing results are **ratios between two paths on the same wire** — window
count dominating pixel count, the lane column at 35% against 97% split per row — and a wrong wire
speed largely cancels out of a ratio. The firmware-shaping conclusion is a ratio; the absolutes are
not.

**How it was found, because the method is the point.** Nobody measured anything. A bench design's
timing control was rebuilt after a finding elsewhere that a negative control can be neutralised by
the very transform it is meant to test — the original timed a delay using the same clock path as
every other measurement, so a misconfigured timebase would have scaled the control and the results
by the same factor and read perfect. Its replacement is a floor computed from first principles,
needing no reference to the chip's own sense of time, and it contradicted a four-week-old figure
three separate lanes had been quoting **before it was run once**.

## Resolution 2026-09-22 — the constant was never a measurement, and one verdict flipped

**The source names its own culprit.** `DISPLAY-PACKAGE.md:394`: *"Full-frame timing for Path A:
extrapolated from explore-ember's 320×240 numbers, not measured."* So nothing was mis-measured. The
two figures in that same paragraph that **were** measured both sit at line rate — 107 KiB in 21 ms
is 41.7 Mbit/s, 26 KiB in 5 ms is 42.6 Mbit/s — which means the measurements are sound and only the
extrapolation was wrong. That is a much better outcome than a bad measurement, because nothing else
derived from that source is suspect.

The wire time is now **derived** from the configured 40 MHz and the frame size rather than quoted:
30.72 ms. The rasterise time stays measured, because it is CPU time filling SRAM and does not scale
with the bus clock.

**The ratios held exactly, as predicted.** Column against per-row is **0.3613 before and after** —
not approximately, but exactly, because both are the same pixels on the same wire and the speed
cancels. Every firmware-shaping conclusion in this decision was stated as a ratio and is untouched.

**But verdicts against the budget are not ratios, which neither of us had said.** The draw budget
comes from the frame rate, not from the wire, so everything moves against a fixed line:

| | old | corrected |
|---|---|---|
| flourish, worst frame | 26% | **29%** |
| one lane column | 35% | **40%** |
| full repaint | 86% | **97%** |
| six per-row windows | 97% | **110%** — crosses |

**Two consequences.** A full repaint now costs 97% of the draw budget, leaving nothing for engine,
mesh and touch — so banding is a requirement on **timing** grounds as well as memory grounds, which
is an independent route to the same conclusion 0010 records from cost and from the board's house
rule. And the wire figure is now a floor, so the model **underestimates** cost; that is the
optimistic direction for a "fits" verdict, which the flourish at 29% absorbs and per-row at 110%
does not.

**The flourish verdict stands**, and its condition — one contiguous dirty rectangle per frame, never
a per-cell redraw — is now enforced by the budget rather than merely preferred.

**One methodological note.** A claim that per-row splitting blows the budget was made, tested,
found false, and corrected to "fits, leaving 3%". Under the corrected constant it does blow the
budget. That is **not** vindication of the original claim: on the evidence available at the time,
weakening it was right. What it demonstrates is the thing worth keeping — ratio-shaped conclusions
survived a 14% error in a fundamental constant untouched, and the one position-shaped conclusion did
not.

