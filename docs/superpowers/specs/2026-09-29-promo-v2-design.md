# Promo v2 and contest draft 5, re-recorded from main f283f15 (2026-09-29)

The lead, after #197–#208: promo v1 lacked everything that has since merged (luna's world art, the dusk
atmosphere, the Cinder Whelp's dragon, the commanders, the guide v2 with its ghost hand, accessibility).

## Goals
- **Promo v2, 60–90 s**, replacing v1 in `site/media/` (v1 kept in `scratch/contest-video/promo/v1/`). It leads
  with the "whoa": the full-VR dusk Tea House at rest → the Whelp's summon sweep with fire → hands placing and
  charging (the ghost hand once) → the doors breathing → a match beat → the end card.
- **No emulator-grey-room shots.** In IWER, mixed reality shows the emulator's grey room behind the table, so
  every shot is full VR.
- **Contest draft 5 (≤ 3:00)** from the same takes; draft 4 is kept in `draft-4/`.
- Captions, the game's own sound, no AI video; every gameplay frame is a real capture on the B60 (the
  renderer guard on), taken in a quiet I/O window (PSI io avg10 < 15 for 30 s before each take).

## What the capture tool needs (`tools/xr_capture`)
- **`--returning`:** the page now shows a first-run offer ("hands, head gaze or voice", assist.js), and the
  guide says nothing until it is answered. A capture as a returning player stores `offered: true` with the
  settings it already writes (`accessFor`), so the guide speaks from the first frame. A first run stays the default.
- **`--pan DEG`** (idle takes): one real head turn of DEG degrees to the right across the take, animated by
  IWER, for the at-rest shot of the room (`--frame room`).
- Both are pure functions with tests and red perturbations. Nothing in the game changes.

## The page
`site/promo/promo.vtt` becomes v2's captions (11 lines, onsets measured by cross-correlating each voice clip
against the capture audio). The video's description and fallback text say what v2 shows. The markup and
behaviour are otherwise unchanged, and `tools/promo_page_check.mjs` checks it with v2's media.

## Budget
`promo.mp4` ≤ ~25 MB (v2: 21.0 MB at 65.2 s, the dusk scene being far busier than v1's), `promo-720.mp4` ~10 MB,
poster ≤ 300 KB. The page stays `preload="none"`.

## Files
`tools/xr_capture/{capture,install,drive,page}.mjs|js`, `test/xr-capture-options.test.js`, `site/promo/index.html`,
`site/promo/promo.vtt`. The media and cut scripts live in katana `scratch/contest-video/` (not git).
