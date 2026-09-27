# 0010 — The shrine renders as a smol Framebuffer app
Date: 2026-09-20 · Brainstorm ruling (Q11)

> **Amended by 0028/0032/0033 (2026-09-23):** the personal panel is now the shrine's only in-match mode (0032's station). Geometry is 0032's, not 0027's. "No server at the table" now reads "no server off the table": the arena is at the table and streams the rare dynamic speech line (0033). Local rasterisation is still required.

Tapstone's shrine screen is a smol `kind: Framebuffer` app (embedded-graphics), not a Slint scene.
Measured on the ES3C28P: Slint page flip 74–79 ms (~13 fps); the framebuffer path runs smol's six
games at 30 fps. Sprites and card faces are **runtime data in a flash partition**, so a new card set
is a data update, never a firmware scene recompile. The battlefield the shrine draws in a
two-shrine Duel follows the UX study's budget (3 vertical lanes, 48 px sprites, ~15 fps, one
animated band at a time); with an arena on the table the shrine shows the personal panel and the
arena's browser canvas carries the animation.

This decides where the firmware work lands in smol: a Tapstone app slot in the fleet flavor for the
s3-cyd (and c3-oled lane counters later), plus the MATCH frame family (protocol draft §8).

## Amendment 2026-09-22 — the framebuffer this ruling assumed does not exist

Vendoring the rules crate into smol (issue 10, smol PR 543) established that **`app::Oled` on the
S3 is a 72×40 one-bit framebuffer**, 360 bytes, scaled 4× and letterboxed to 288×160 inside the
320×240 panel. This decision asks for three lanes of 48 px colour sprites. Forty-eight pixels is
taller than the entire 40 px logical surface, and there is no colour at all.

**The ruling stands; the sentence naming the flavor was wrong.** A framebuffer app drawing through
`embedded-graphics` is still right, and the Slint measurement that motivated it is unaffected. What
was wrong is "a Tapstone app slot in the fleet flavor for the s3-cyd" — the fleet flavor is the one
without a colour surface. The protocol draft's own issue 3 already said the opposite, placing the
slot in "the s3-cyd GUI flavor (the scry station's registry, smol#540)", so the two documents
contradicted each other and this one is the error.

**Stated as a requirement rather than a flavor**, since the seam is smol's to choose under its own
conventions:

- The shrine needs the **full 320×240 RGB565 panel**, which exists on this board and is already
  driven in colour (`targets/s3-cyd/spike-scry` via mipidsi).
- It must **rasterise locally**. The scry station's faces are server-rendered frames streamed from
  scry-glass, and the design brief is explicit that no server is at the table, so a streaming path
  cannot be the shrine's. Local rasterisation is also what makes sprites-as-flash-data (this
  decision's own premise) meaningful.
- Sprite and layout geometry is fixed by **0027** against that panel, so any seam meeting the two
  points above satisfies the screen work already done.

Until a seam is chosen, the app slot draws provisional one-bit status text — phase, seat, both
castle lives, chain head — which is honest about what the current surface can do.

## Amendment 2026-09-22 — the flash budget in issue 10 was wrong

Issue 10 required the crate to add ≤ 8 KB. Measured on real images, same tier with and without the
feature: **C3 +8,770 B `.text` / +960 B `.rodata`** at the intended `opt="s"`, **S3 +9,536 / +912**.
So **~9.7 KB, not ≤ 8 KB**, and the C3 measurement rules out the S3's `opt_level` workaround as the
cause.

The 8 KB came from subtracting shared `sha2` from a linked scratch harness, which was sound
arithmetic on the wrong quantity: the ~3.7 KB residue was the crate's **standalone** `.text` before
inlining, and monomorphised into a fat-LTO image it costs about 2.6× that, plus ~950 B of `.rodata`
for the card table that the subtraction never counted. `sha2` unification did work as predicted —
one shared `compress256`.

**Correct the issue, not the engine.** 9.7 KB is 1.1% of the C3's 875,968 B of headroom. A budget
derived from a scratch harness should not be allowed to drive a real design.

One measurement note worth keeping: the naive figure is wrong by 5× in the other direction, because
nothing calls `commit()` yet and LTO strips the engine down to a single surviving symbol. A real
number needed a `black_box` probe, and a blind `nm` (an ssh shell that had not sourced
`export-esp.sh`) reported zero hits for everything including `compress256` until a positive control
caught it.

## Correction 2026-09-22 — "the GUI flavor" does not name a rendering decision

The amendment above said the protocol draft's issue 3 "already said the opposite, placing the slot
in the s3-cyd GUI flavor". A seam survey (smol PR 545) shows that phrase cannot settle this, because
**it names two unrelated axes**:

- On the **radio** axis, `PARITY.md` files the scry station under GUI because a 5-second HTTP kiosk
  wants a held association. That is what "the GUI flavor" means where the scry station is concerned,
  and `grep -c slint` on `spike-scry`'s manifest returns **0**.
- On the **rendering** axis, the GUI flavor means the watch — which is Slint, which *this decision
  rejected on measurement* at 74–79 ms per page flip. Its CYD port is also scaffolded rather than
  done; `ui/cyd/` does not exist on disk.

So issue 3 and this decision were never in the clean contradiction the amendment claimed, and
pointing at "the GUI flavor" risked sending the work at the renderer 0010 had already excluded.

**The requirement stands and is what should be quoted**: a locally-rasterising colour surface on the
full 320×240 panel, with geometry fixed by 0027. Which codebase provides it is
`DISPLAY-PACKAGE.md` §5 Q3 — "does the S3 colour/touch UI belong to smol or to the watch codebase?",
open since 2026-08-24 — and Tapstone is the first thing that cannot proceed without an answer. That
is JP's call and larger than this game.

Two things the survey settles regardless of who owns it. Gating the surface on a **declared
capability** rather than a chip name follows smol's own stated rule, with `budget.rs` as precedent.
And the 150 KB PSRAM frame this decision's readers might assume **does not have to exist**:
`spike-scry` never buffers a frame by explicit design, the board's house rule is strip-rasterise
plus windowed `fill_contiguous`, and the animation costing in 0025 independently found one
contiguous lane column at 35% of the frame budget against 97% split per row. Band rendering keeps
the surface in internal SRAM.

## Note 2026-09-22 — two independent routes select the same rendering unit

Worth recording because the agreement is the evidence, not either result on its own.

**From cost**, with no knowledge of the board's conventions: the animation costing in 0025 priced a
lane-width column redrawn as one contiguous window at 35% of the frame budget, against 97% for the
same pixels split per row and 86% for a full repaint. Window count dominates pixel count, so the
cheap unit is a lane column.

**From the hardware's own house rule**, with no knowledge of the cost model: `BOARD.md` prescribes
strip-rasterise plus windowed `fill_contiguous`, and `spike-scry` never buffers a frame by explicit
design because it "would cost 150 KiB and add a copy for nothing".

Two routes, no shared assumption, same answer: **render a band, not a frame**. And the band that
falls out is a lane — which is also the game's own unit, the thing a card is tapped into and the
thing combat resolves within. A rendering strategy that matches the domain's natural partition is
usually a sign the partition is real rather than imposed.

The consequence for firmware is that band *count* is then a memory question rather than a speed one
— a band is `640 × rows` bytes against ~96,676 B of free internal memory — and whether the renderer
constrains that choice is being established separately by rendering in N bands and requiring the
composite to be byte-identical to a single pass.

