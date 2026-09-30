# Promo video v1 and its place on the promo page (2026-09-28)

JP, 2026-09-28 22:4x: "can you assign agents to finish the promo video pls and put it on the promo site and host it
locally on ubox0?" Quill owns the video and the site change; the lead deploys to ubox0.

## Goals
- A 60–90 s promo, separate from the contest cut (under 3:00, `scratch/contest-video/`): energetic, and every gameplay
  frame a real capture of the headset build in IWER (`tools/xr_capture`, B60, renderer guard on). No AI-generated video,
  so it can double as contest material; the game's painted card art may appear, since it is the game's art.
- Shots: a title card in the site's type and colours → the hook, "tap the card to the stone" → hands placing cards →
  the doors stirring → the full-VR Tea House interior → a match ending → a closing card, "Tapstone · a card game for your
  table and your headset" and tapstone.realm.watch.
- Captions for every spoken line; the game's own sound; no music in v1 (nothing to credit).
- The promo page shows it near the top, degrades to the poster and a caption when `site/media/` is absent, stays
  accessible (captions track, a short description) and keeps both themes, the favicon and zero external requests.

## Approach
- **Footage:** the quiet-I/O B60 takes (`round5-takes/d-quiet*.mp4`) for the interior, the doors and the ending, and
  draft 4's mixed-reality segments (`b-match`, `c-teahouse`) for hands at a table. Windows are chosen from each
  sidecar's stall list (`pacing.stalls`); every source is sha256-checked against katana.
- **Cards:** rendered by ffmpeg `drawtext` on the site's night colour (`--bg #1d1733`, ink `#f4e9cf`, gold `#eab54f`)
  in its display face (URW P052, in the page's `--display` stack) with a lantern glow: text on a plain colour, no
  generated imagery.
- **Captions:** each spoken line's time is measured from the capture's own audio (speech spans), matched in order to the
  clips the page reports it played, and the text comes from the voice manifest: WebVTT for the page, burned into the MP4
  as plain lower-third text so the file stands alone.
- **Build:** one script, kept beside the footage (`scratch/contest-video/promo/promo-cut.sh`, not in git: it is media
  tooling over scratch files), writes `promo.mp4` (1920x1080, H.264 High, AAC, faststart, < 25 MB), `promo-720.mp4` and
  `promo-poster.jpg`, plus `promo.vtt`, and a SHA256SUMS file.

## Budget
- `promo.mp4` ≤ ~25 MB at 1080p (~2.5 Mb/s for 75 s), `promo-720.mp4` ≤ ~10 MB, poster ≤ 300 KB. `preload="none"` on the
  page, so nothing heavy loads until someone presses play; the poster is the only eager fetch.

## Files
- `site/promo/index.html`: the video block near the top (`<video>` with poster, controls, playsinline, two sources,
  captions track, a description and a no-media fallback).
- `site/promo/style.css`: its frame, in the page's variables for both themes.
- `site/promo/promo.js`: the fallback when the media is absent (a missing poster or sources shows the caption panel,
  as a missing picture already does).
- `site/promo/promo.vtt`: the captions (committed: text, small).
- `site/media/promo.mp4`, `promo-720.mp4`, `promo-poster.jpg`: gitignored, delivered by rsync (site/README.md).
- `site/README.md`: where the promo media come from.
- `scratch/contest-video/PROMO-NOTES.md` (katana): the shot list with source files and timestamps.

v1 predates tonight's art and summon lanes (luna, morpheus): a re-cut follows when they land.
