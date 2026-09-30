# xr_capture: contest footage from the real headset build, in IWER

Records the headset build as IWER (Meta's Immersive Web Emulation Runtime, which `@iwsdk/cli` runs)
shows it, for the contest video: footage "as viewed on a Meta Quest device or via XR Simulator or
another equivalent emulator" (Official Rules, video section). The Meta XR Simulator is a separate
desktop OpenXR runtime for Unity, Unreal and native apps; for a WebXR build, IWER is Meta's emulator.

```sh
cp <wasm> public/tapstone_web.wasm              # as for any IWER run (rust/README.md)
XR_PORT=8097 npx @iwsdk/cli dev up --headless --no-open        # serves the build and IWER; no managed browser
node tools/xr_capture/capture.mjs idle --seconds 8 --out /path/idle.mp4   # the test's short run
node tools/xr_capture/capture.mjs match --out /path/match.mp4             # first five + the match
node tools/xr_capture/capture.mjs teahouse --out /path/teahouse.mp4       # the doors stirring
npx @iwsdk/cli dev down
XR_CAPTURE_LIVE=1 node --test test/xr-capture.test.js                     # with the dev server up
```

`--vr` enters full VR through the page's "Full VR" button (the lantern-lit Tea House interior)
instead of `xr enter`, which accepts the browser's mixed-reality offer. `--input gesture` plays every move through `gestureStep()` (the iwer-*.mjs gates' path) with the
hands at rest; the default, `--input hands`, moves IWER's emulated hands. `--max N` stops after N s.
Each take gets a JSON beside its MP4, whatever happens: `outcome` is `ok`, `failed-check`, `refused` or `error`, with wall-clock `started`/`ended` and the recording's start and end. It holds the check's problems, both ffprobe readings, the page's renderer, the
game's counters, the hand moves and fallbacks, and marks (each move, the match's end) for cutting.
Working files go to `.iwsdk/xr-capture/` (gitignored).

## What is real, and what the tool does

- **The picture** is Chromium's own screencast (CDP `Page.startScreencast`) of the managed browser,
  over the DevTools socket IWSDK opens (`--remote-debugging-port=0`, port in `DevToolsActivePort`).
  Holding that socket ourselves keeps one recording across `browser run` leases (110 s each).
  IWER's own interface (the DevUI toolbar and hand panels, the gizmo canvas, the "Remote Control
  Active" pill, the workspace switcher) is **hidden**, since no headset shows it; IWER's emulated room,
  its stand-in for passthrough, stays. Nothing is painted over the page.
- **The sound** is what the page plays: an init script tees every WebAudio context's output and
  every `<audio>` element into an in-page MediaRecorder (the voice clips and the synthesized sounds),
  aligned to the frames by wall clock.
- **The input** goes through IWER's emulated hands (`IWER_DEVICE.remote`, what `iwsdk xr` drives):
  pinch a card, carry it to a pad, let go; pinch the castle to pass or claim; poke a pad to advance.
  IWSDK turns those into the page's grab, press and touch events. A move that lands nowhere goes
  through `gestureStep()` (the same `play()` door) and is counted as a fallback in the JSON.
- **The head** leans in over the altar, as a seated player does. For the tea house it turns to the
  door of each card's faction after a cast, and to the winner's door at the end.

## The check (video.mjs, test/xr-capture.test.js)

The delivery is 1920x1080 at a constant 30 fps (H.264 + AAC). The **source** (the screencast frames,
each held until the next) keeps the rate the page really drew, and must reach 25 fps: a 30 fps MP4
built from a slow source is duplicated frames. Played segments must also be audible.

## The GPU: the Intel Arc Pro B60, checked

The capture launches and owns its Chromium (`gpu.mjs`), because IWSDK's managed browser can't reach a
usable GPU headless, and has no supported hook to make it. `@iwsdk/vite-plugin-dev` resolves the ANGLE
backend to `gl` or `swiftshader` on Linux (`resolveGpuBackend`), and its launch arguments are fixed
(`openManagedChromium`). `browser run` only attaches over CDP to that same browser. Headless Chromium
drops `--use-angle=gl` to SwiftShader, while IWSDK logs "Using hardware GPU (gl)".

`--gpu b60` (the default) sets `VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/intel_icd.json` for Chromium,
with `--use-angle=vulkan --enable-features=Vulkan --ignore-gpu-blocklist --enable-gpu`. The P102-100 is
the inference GPU shared with the llama-servers (jp-ab, 2026-09-28): `--gpu p102` exists only for a
comparison, and `--gpu swiftshader` reproduces IWSDK's default.
The default is per host (`HOST_DEFAULT` in gpu.mjs): on katana it is `rtx2080`, the workstation's RTX 2080 Ti,
where desktop and GPU work are allowed (jp-ab, 2026-09-28). The renderer guard is the same everywhere; only the GPU it
expects changes.

**The renderer string is the instrument.** Before recording, the capture reads WebGL's
`UNMASKED_RENDERER_WEBGL`. If it isn't the chosen GPU, the capture refuses with exit 3; `--allow-renderer`
turns the refusal into a loud warning. The JSON records `gpu`, `renderer`, `rendererProblem`, Chromium's
CPU% (the process tree under the capture), and the frame pacing: interval p50/p95/max, plus every stall
over 100 ms with its time, so a cut can avoid it.

Measured on familiar, 2026-09-28, over 30 s of a match at 1920x1080:

| GPU | Source fps | Interval p50 / p95 / max (ms) | CPU |
|---|---|---|---|
| SwiftShader | 6.7 | 134 / 250 / 513 | 944% |
| P102-100 | 21.5 | 39 / 71 / 248 | 92% |
| B60 (3 runs) | 42.8–48.6 | 19.5–21.2 / 23.8–32.7 / 233–1891 | 249–252% |

The B60 is shared too (Ember's llama-server): its pacing varies, and one take froze twice for 26 s and
failed the floor. The stall list says when that happens.

Where the app draws nothing, the page shows through: Mesa on the B60 leaves those pixels transparent, and
the full-VR ceiling came out white. So the capture paints the page background black, which is what a
headset's opaque display shows.
