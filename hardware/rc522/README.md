# RC522 reader case — the dimensional source of record

These two STLs are the printed case JP uses for the MFRC522 reader on the scry station
(`~/Projects/smol` target `targets/s3-cyd/spike-scry`), printed and verified on his unit on
2026-09-01. **The shrine apron's reader pocket is dimensioned from them**
(`enclosure/shrine.py` in `~/Projects/ember.realm.watch`), so they are not decoration — they are
the evidence behind a part that gets printed.

They are here because they were about to be lost. Until 2026-09-22 the only copies lived untracked
in `~/Projects/labels/` — `RFID+Bottom.stl` and `RFID+Lid.stl` in the repo root, plus a merged
`tmp/rc522-both.stl` inside a gitignored directory. Nothing recorded where they came from and
nothing would have noticed their deletion.

- `RFID+Bottom.stl` — the tray. 1196 triangles, 44.50 × 64.50 × 9.00 mm.
- `RFID+Lid.stl` — the cover. 240 triangles, 45.10 × 65.10 × 3.95 mm.

A third file, `tmp/rc522-both.stl` in the labels repo, is these two merged for slicing, not a
separate design. Its bodies are geometrically identical to these, so it corroborates rather than
competes. Sliced 2026-09-02 with PrusaSlicer 2.9.6.

## What was measured from them

**Measured directly:** pocket interior 40.50 × 60.50 mm; internal height 7.00 mm; four support
posts 2.30 mm square topping at z = 6.00 at (±17.15, −14.65) and (±12.40, +22.95) — asymmetric, so
this is the board's own hole pattern; a centre boss 16.00 × 6.00 topping at z = 3.50; a ~25 mm wire
notch in one **short** wall, open from z ≈ 7 to the rim.

**The RF number, and the reason this case matters:** the floor under the board is **2.00 mm**, and
this case demonstrably reads. `docs/design/materials.md` allows 1.5–2.0 mm for the pad skin, so the
apron takes 2.00 from a proven part rather than splitting the band, and it is the stiffest option
the constraint permits over a 60 × 40 opening.

**Inferred, and labelled as such wherever it is used:** the board outline is the pocket minus fit
clearance, so ≤ 60.50 × 40.50 mm, and the connector leaves by the short edge holding the notch.
A pocket is the board *plus* slack; it is not the board.

**Not recoverable from a case:** where the coil sits on the board. A pocket locates the board and
says nothing about the antenna. The apron does not need it — it carries a uniform skin over the
whole board footprint and an RF keepout covering the whole footprint, so a rule that holds
everywhere on the board holds wherever the coil actually is. That is what this case does with one
flat 2 mm floor.

## Provenance gap, stated plainly

The upstream source is not established. `CLAUDE.md` records MakerWorld 2524848 as the station's
printed case, but nothing ties these two files to that listing, and there is no source model,
licence or download record. If these are third-party prints, the licence matters before anything
derived from them is published. Treat the dimensions as verified and the origin as unknown.
