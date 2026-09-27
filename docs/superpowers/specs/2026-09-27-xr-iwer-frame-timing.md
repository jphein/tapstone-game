# Headset build: frame timing in IWER (M3, without a Quest), 2026-09-27

Part of #129 (M3). VR spec 2026-09-25 §5 MVP 10 asks for **a measured 60 fps on a Quest 2 in a full
match**. This report is **not** that measurement. It is what can be measured without the headset: a
whole match in IWER (IWSDK's emulated headset in its managed Chromium on familiar), with the page's own
frame log, to find which of *our* per-frame work is heavy. The Quest number still has to be taken on
the Quest (the day-1 spike's table in the spec is the only real-headset number so far).

## How it was measured

- `src/logic/frames.js` (`FrameLog`): `PlaySystem.update` opens a frame on every call and measures
  its own script time (`work`); the code that does visible work tags the frame it ran in: `view` (a
  new view applied to the board), `hand` (hand faces repainted, a canvas texture each), `effect:<type>`
  (an effect started, with its sound), `say` (the voice band redrawn). A frame's time is the interval
  to the next `update`, so it includes the render of whatever the frame changed. `report()` gives
  percentiles, frames over 16.7 ms, the worst frames with their tags, and `byTag`: each tag's frame
  count and median against the untagged frames' median (the baseline).
- `tools/iwer-profile.mjs`: a whole match through `gestureStep()` exactly as `tools/iwer-match.mjs`
  plays it, resetting the log at the match's first run and returning the report. IWSDK's own
  `browser profile` (rendering mode, capped at 60 s) ran alongside the first run as a cross-check.
- Three fresh-page runs (27–28 moves, ~20 s each), `XR_PORT=8187`, hand input mode.

## The renderer is software

IWSDK's own profile reports the browser's GPU as **SwiftShader** (`ANGLE (Google, Vulkan 1.3.0
(SwiftShader Device (Subzero)))`): familiar's Chromium rasterises on the CPU (its GPU, a P102-100, has
no display path and Chromium does not use it). Every frame interval below is dominated by that, so the
absolute numbers say nothing about a GPU, let alone a Quest's.

## Results

| Run | frames | p50 | p90 | p95 | p99 | max | our work p50 / p99 |
|---|---|---|---|---|---|---|---|
| 1 | 224 | 56.3 ms | 84.2 | 96.0 | 133.2 | 296.3 | 0 / 2.5 ms |
| 2 | 181 | 54.4 ms | 159.0 | 255.0 | 318.8 | 388.1 | 0.1 / 1.2 ms |
| 3 | 193 | 72.3 ms | 95.7 | 104.8 | 188.9 | 251.1 | 0.1 / 2.3 ms |

IWSDK's profile over run 1 agrees: rAF interval p50 66.6 ms, p95 116.6 ms, max 299.9 ms, 5 long tasks
(619 ms total). Every frame is over the 16.7 ms budget (≈15–18 fps), tagged or not.

**Our own script work is small**: a median frame spends ≤ 0.1 ms in `PlaySystem.update`, the p99 is
1.2–2.5 ms, and the heaviest (7–8 ms) is the first view: the board's first view with one hand face
painted (each draw adds one face; the frame log's `hand` count is 1 on every hand frame).

`byTag`, median frame time against the untagged baseline (runs 2 and 3):

| tag | run 2 | run 3 |
|---|---|---|
| (untagged baseline) | 52.9 (133 frames) | 71.3 (140) |
| view | 63.5 (28) | 82.0 (27) |
| hand | 60.8 (9) | 94.4 (9) |
| effect:drawFlip | 63.1 (10) | 85.6 (10) |
| effect:summon | 247.1 (3) | 73.1 (3) |
| effect:chargeGem / keepChip / advance / damage / death | 47–56 | 55–75 |
| say | 110.7 (1) | 63.4 (1) |

## The worst frames and their causes

1. **Hand repaints (`view` + `hand` + `effect:drawFlip`).** The one cause that is consistent: in runs 1
   and 3 the worst frame of the match is the first view (296 ms and 251 ms, 7–8 ms of it our script),
   and the draw frames carry the worst tagged medians in both byTag runs (+10 to +23 ms over the
   baseline). `Hand.set` paints each changed card face into a new canvas texture, and each new texture
   is an upload the next render pays for. On a Quest this is the frame to watch; the fix, if it shows
   there, is reusing each slot's canvas and texture (repaint in place) instead of a new one per face.
   Reading `Hand.set` for this also found that the texture it replaces is never `dispose()`d, so every
   repaint leaves one face texture on the GPU for the rest of the session. That costs memory rather
   than frame time. Fixed on `fix/xr-hand-texture-leak`: see "After the fix" below.
2. **Untagged spikes (100–390 ms, no work of ours).** The worst frame of run 2 and the second-worst of
   run 3 carry no tag and ≈0 ms of our script: the renderer, garbage collection, or the harness itself
   (the script calls into the page every 300 ms). They are not ours to name from here.
3. **Not consistent, so not causes:** `effect:summon` (247 ms in run 2, 73 ms in run 3, three frames
   each) and `say` (one frame per run).

The effects and sounds (`effect:*`) themselves sit at the baseline: starting an effect and its WebAudio
recipe costs nothing measurable here.

## Two notes from the runs

- The voice-line counts differ between runs (18 lines in run 1, 3 in runs 2–3) for a reason that is
  working as designed: `gestureStep` never makes the claim gesture, so the claim beat waits and holds
  the other voice lines for its 20 s clock window (§3.4), and a fresh-page match is over in about 20 s.
  In run 1 the page had sat idle before the match, the window had passed, and the beat had handed the
  voice back (`tools/iwer-handback.mjs` shows the hand-back: `holding` true inside the window, then
  the held line, `Draw 5: …`, once it ends).
- A fair desktop number would need a Chromium with a real GPU. The Quest number needs the Quest.

## After the fix (`fix/xr-hand-texture-leak`, one run)

`logic/face-slots.js` gives each hand slot one canvas and one texture, made at load with the map set
on the material (so the prewarm compile builds the program a face uses), and a repaint draws into the
slot's canvas and sets `needsUpdate`. Nothing is made or left behind per repaint, and
`test/face-slots.test.js` counts it with a fake texture.

One profiled whole match afterwards (27 moves, fresh dev server, still SwiftShader): p50 62.5 ms, p99
409, max 694 ms. The largest frames are all untagged, with ≈0 ms of our work. The first view's frame was
191 ms with 4.2 ms of script, against 296 and 251 ms (7–8 ms of script) before. The `hand` frames'
median is still above the baseline (84.6 against 59.6 ms, 9 frames): a repaint still uploads that
slot's texture, which is the work it has to do. **One run on a software renderer cannot separate a
first-frame gain from noise.** What the fix proves is the leak, by the test. Whether the repaint
upload matters is a question for the Quest run.

## What's still owed for M3

- The Quest 2 run itself: a whole match on the headset, with the page's `__tapstone.frames()` report
  read over the Quest Browser's DevTools socket (`tools/cdp.mjs`, through adb).
