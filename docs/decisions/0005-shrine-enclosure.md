# 0005 — The shrine is the ember stand grown into an apron; the reader lives in the apron
Date: 2026-09-20 · Status: proposed (JP's lean; confirm in the brainstorm)

The screen docks in the existing ember front bezel + back shell at the stand's viewing angle. The
stand base extends forward into a flat **apron**: the card pad, one CR80 wide with a locating lip,
with the MFRC522 coil under a 1.5–2 mm RF-transparent skin, a channel around it for a later LED
ring, and the ribbon routed up the stand column. USB power via the plug-cradle position; a battery
apron is a later variant. The mobile (handheld) case stays as it is for other roles.

Why not the mobile case: you tap a card down onto a table, not up against something in your hand.
Why not a new case from scratch: the ember parts are generated from Python, so `enclosure/shrine.py`
can import the stand and base and add only the apron; bezel and shell stay byte-identical.

## Amendment 2026-09-21 — two premises corrected before modelling

Recorded while building `enclosure/shrine.py` in ember.realm.watch (branch
`feat/tapstone-shrine-apron`). Neither changes the intent; both change the part.

**There is no "stand base" to extend.** This ruling said the apron grows from the stand base and
that `shrine.py` imports "the stand and base". `ember-stand-base.stl` is not a ground plate: it is
the lid of the sealed speaker chamber, 53.40 × 14.70 × 3.60 mm, which drops into the chamber shaft
*inside* the stand and is derived from the chamber bounds. The part that meets the desk is
`desk_stand()`. The apron therefore grows from the stand's **plinth**, keying into the flat 44.0 mm
span on its front face between the R10 corners. "and base" was a misreading of a filename.

**The apron lands in the cable bend volume, and that space was bought deliberately.** The stand's
front face at desk level is the USB egress: a 14.0 mm × 10.0 mm arch, R4. smol-side issues #29/#30
chose the 56 mm stand height precisely so the rigid cable run ends 3.28 mm above the desk still
travelling forward, letting the cable bend in open air in front of the stand; routing it rearward
is geometrically impossible, and a stand where the bend completes inside the base is a ~75 mm part.
An apron at desk level occupies that air. It is workable because the cable is nearly flat crossing
the plinth, but it forces a routing choice, and the obvious one is wrong: **carrying the cable
straight forward puts a braided shield directly under the coil**, which `docs/design/materials.md`
rules out. The channel turns within roughly the first 20 mm and exits the **side**, keeping copper
outside the pad footprint entirely. Which side is parameterised, pending the reader's ribbon exit.

**Consequences settled with it:** the apron is a **separate part**, not fused to the stand, so the
validated stand is never reprinted to revise a pocket and `ember-stand.stl` stays untouched; it is
**non-bearing**, a shelf keyed to the plinth with its own desk contact, so the stand's geometry
ledger is unaffected and the check that matters is tipping under a card press; the pad is
**landscape**, 86.60 × 55.00 mm for an 85.6 × 54.0 card (0.50 mm per side, lip 0.60 mm, finger
scallop on the front edge).

**Correction 2026-09-22.** The amendment above first said the lip was ~0.9 mm and that this left
the card "just proud". That is backwards: a CR80 is 0.76 mm thick, so a 0.9 mm lip leaves the card
0.14 mm **recessed** and unpickable even with the scallop. The lip is **0.60 mm**, engaging 79% of
the card's thickness — ample to locate a card nobody is aiming — and leaving 0.16 mm proud.
`shrine.py` asserts `LIP_H < CR80_T` so it cannot drift back.

**Tension with 0018 to settle before two-point-oh:** three landscape pads is ~258 mm across, which
exceeds an Ender 3 bed and is unreasonable on a table; three portrait pads is ~165 mm and fits
both. So 0018's "the apron grows to three cards wide" implies the three-pad apron is a *different
part* with portrait or overlapping pads, not this one widened. Choosing landscape here is right for
playtest one and is not a commitment for the product shrine.

