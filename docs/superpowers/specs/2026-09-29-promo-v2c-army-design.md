# Promo v2c and draft 5c: the new army (2026-09-29)

#216 (32e0301) replaced every unit with figures that match their cards: CC0 and credited. Promo v2b and draft
5b show the old units.

- **Re-takes:** only the takes with units on the board, all from main 32e0301, full VR, on the B60 with the
  renderer guard on, as a returning player, in a quiet window (PSI io avg10 < 15% for 30 s):
  - **B:** the match, altar framing. The hands, the guide, charging, and the drake Whelp's sweep.
  - **C:** the Tea House. The doors breathing and the winner's doors.
  - **E (new):** the same match, with the head leaning in over the board, for the army shot. The Tide line holds
    the far row while two Hearth Wardens are summoned onto the near one, then the clash.
  - A2, the room at rest, has no units in it and is kept.
- **Tool:** `--frame board` in `tools/xr_capture/start.mjs`, a table of board-local framings (`FRAMES`). From over the
  altar (0.54 m off), the 0.5 m board filled only a third of IWER's wide view, so the board framing leans in past
  the altar, over the board's near edge (0.38 m). The test asserts that; the first framing turns it red.
- **Page:** the markup is unchanged. `site/promo/promo.vtt` follows the new cut: 16 cues, measured by
  cross-correlation, with the negative control finding nothing.
- **Kept:** v2b in katana `promo/v2b/` and draft 5b in `draft-5b/`, both sha256-verified.
