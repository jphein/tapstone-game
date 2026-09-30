# XR accessibility: voice, head gaze, high contrast (design note)

Date: 2026-09-28 · Lane: Selene · Branch `feat/xr-accessibility` · Aimed at the contest's "Best
Accessibility Forward Experience" ("voice alternatives for hand interactions, eyes-only navigation for
limited mobility, high-contrast modes, or experiences inclusive by default").

Already on main (#129, `logic/access.js`): captions on every voice line (always on, not a setting),
seated mode, left-handed sides, reduced motion. This note keeps all four and adds three input and
display paths, a settings panel reachable by each of them, and a first-run offer.

> **2026-09-29:** the spotter's model changed to a LibriSpeech-trained one (GigaSpeech's terms are
> non-commercial): `2026-09-29-xr-kws-permissive-design.md`. The engine and pipeline below are unchanged.

## Goals

1. **Voice can play every move the menu offers.** "draw", "charge <card>", "summon <card> in lane <n>",
   "cast <spell> at <target>", "advance lane <n>", "pass", "mulligan", "claim", plus "target <n>" for a
   spell's prompt and "cancel". The mic opens only after an explicit opt-in (a hand, gaze or page
   button); a listening indicator is visible whenever it is open; what was heard, and what it did, is
   shown on the caption band.
2. **Head gaze can play every move.** The Quest 2 and 3S have no eye tracking, so this is *head* gaze:
   a reticle at the centre of view, and a dwell ring that fills over ~1 s (configurable) on a card, pad,
   castle, prompt tile, target unit or settings tile, then selects it. `logic/menu.js gestureForItem`
   ("hands can play every move") gets a twin, `gazeForItem`, and a test that runs it for every menu item
   in the fixtures.
3. **A high-contrast theme** for cards, pads, labels, the board and the doors: a colour table
   (`logic/theme.js`) that the scene, and the luna lane's new art, read by role.
4. **An accessibility panel in the world**, reachable by hand (poke or ray), gaze (dwell) or voice
   ("open settings"), remembered in localStorage; and a **first-run offer** ("play with hands, head gaze
   or voice") on the page before entry and in the world at the first frame, before the guide speaks.
5. `docs/contest/accessibility.md`: the submission write-up (what each mode does, how a judge tries it
   in under a minute).

## Approach

### Voice (on-device only)

Measured by the lead on JP's Quest 2 (Quest Browser 152): no `SpeechRecognition`, no `speechSynthesis`,
but `getUserMedia` works. So recognition runs in the page, in WASM, in a Worker:

- **Engine:** sherpa-onnx's WebAssembly build (Apache-2.0; the npm package's prebuilt
  `sherpa-onnx-wasm-nodejs.wasm`, whose glue also runs in a browser worker) with its **keyword
  spotter** and the 3.3M-parameter `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01` model
  (Apache-2.0, int8, ~5 MB). A keyword spotter only reports phrases from a fixed list, which is what a
  game grammar wants: no open dictation, nothing to mishear into an unrelated move.
- **Grammar:** `logic/voice-commands.js` (pure) lists every phrase (verbs × set 1 names × lanes, with
  "in", "into", "the left lane" variants) and parses a heard phrase into an intent; the same parser
  reads typed text, so tests and the IWER driver use `__tapstone.hear('summon cinder whelp in lane
  two')` through the same path. `tools/voice_keywords.py` tokenises the phrase list with the model's
  BPE into `public/kws/keywords.txt` (committed; a test checks it against the grammar and set 1).
- **Resolution:** an intent becomes the SAME gesture object a hand makes (`{source:'hand', card, face,
  pad}` …) and goes through `play.play()`, so the engine's menu stays the one source of moves; a
  refused voice move is refused exactly as a refused hand move is.
- **Audio path:** mic → AudioContext → AudioWorklet (downsampled to 16 kHz) → Worker (the KWS). The
  main thread only receives `{keyword}` messages, so the render loop pays nothing per audio frame.
- **No network after load:** the wasm, its glue JS and the model are fetched DURING load as bytes (like
  the voice clips), never gating "ready"; the Worker is built from those bytes on opt-in.
- **Measured here, and to measure on the device:** MB on disk, load (compile + model init) time and
  real-time factor under Node and in IWER's Chromium; recall and false alarms on a TTS corpus
  (several Piper voices on familiar). The Quest 2 numbers are the lead's to take; this lane's are
  estimates and say so.

### Head gaze

- `logic/gaze.js` (pure): `Dwell` (the timer: a target held for `dwellMs` fires once; a glance away
  shorter than a grace period keeps the progress; the same target must be left before it can fire
  again) and `GazeSelect`, the eyes-only state machine that mirrors play.js's eyes-and-hands path:
  dwell a card (lift it), dwell it again (turn it face down), dwell a pad (play there). A bare pad
  (advance) takes two dwell laps, so resting the eyes on the altar never advances a lane by accident
  (the "Midas touch" problem of dwell input).
- `src/gaze.js` (scene): one raycast per frame from the head along its forward axis against the
  registered targets (pads, hand cards, deck, castle, prompt tiles, target units, panel tiles), a
  small reticle and one dwell-ring mesh (a shader arc: one draw call). Gaze plays through `play.play()`
  like voice. The hands-only controller guard (guard.js) applies to hand gestures only: a person
  playing by gaze or voice isn't refused because a controller is awake.

### High contrast

`logic/theme.js`: `THEMES.standard` (today's colours, unchanged) and `THEMES.contrast` (near-black
surfaces, white text, a yellow focus colour, and faction colours re-picked for luminance contrast,
each with a letter cue so colour is never the only signal). Roles, not meshes: `altar.stone`,
`pad`, `pad.focus`, `label.bg`, `label.fg`, `board.base`, `board.near`, `board.far`, `card.edge`,
`door.ember`, `door.tide`, `door.neutral`, … `src/theme.js` keeps a registry: `themed(material,
role)` sets the colour now and again on every switch. **The hook for luna's art** (feat/xr-world-art):
call `themed(material, role)` on a material, or read `palette()` and `onTheme(fn)`; a test holds every
text pair at ≥ 7:1 (WCAG AAA) in the contrast theme.

### Panel and first run

- `src/access-panel.js`: a column of tiles beside the altar (outside the ±32° play budget), each a
  canvas label with PokeInteractable + RayInteractable + a gaze target, plus a gear tile that folds it
  away. Tiles: voice, head gaze, dwell time (0.8 / 1.0 / 1.5 / 2.0 s), high contrast, large captions,
  seated, left-handed, reduced motion. Voice: "open settings", "high contrast on", "gaze off" …
- The page's `#access` fieldset gains the same switches, and a first-run offer (hands / head gaze /
  voice) shown on the page before entry (the mic permission is asked there, outside the session). In
  the world, on a first run, the offer tiles face the person at the first frame, before the guide's
  first beat; the guide itself is aster's (feat/xr-guide-v2) and isn't changed.

## Budget

| | Before | Target |
|---|---|---|
| Draw calls (MR seat) | 130 (luna's baseline, 2026-09-28) | ≤ +12 with the panel open, +3 with it folded (gear, reticle, ring) |
| Triangles | 19.9k | ≤ +1k |
| Texture MB | 7.84 | ≤ +1.5 (panel canvases) |
| Download | — | ≤ 21 MB (wasm 15.1, model ~5.3, glue ~0.2), fetched during load, never gating "ready" |
| Main-thread CPU | 3–4 ms app | gaze raycast ≤ 0.2 ms; voice: 0 per frame (Worker) |

## Files

New: `src/logic/voice-commands.js`, `src/logic/gaze.js`, `src/logic/theme.js`, `src/voice-input.js`,
`public/kws/*` (worker, glue, wasm, model), `src/gaze.js`, `src/theme.js`, `src/access-panel.js`,
`tools/voice_keywords.py`, tests for each pure module, `docs/contest/accessibility.md`.

Changed (minimal, listed in the PR): `src/logic/access.js` and `src/access.js` (new settings),
`src/play.js` (a `via` on `play()` so the guard applies to hands only; the new systems attached),
`src/index.js` (register the systems), `index.html` (the panel's switches and the first-run offer),
`src/altar.js` and `src/board.js` (materials registered with `themed()`), `public/CREDITS.md`.

## Execution notes (2026-09-28, measured)

- **Voice engine.** No prebuilt sherpa-onnx wasm has the keyword spotter except the npm package's
  Node build, whose glue requires `path` unconditionally and whose file system (NODERAWFS) refuses to
  start outside Node. `public/kws/kws-node-shim.js` gives it a `process`, a `require`, a POSIX `path` and
  an in-memory `fs` of the model's files, and it runs in the worker (`test/kws-shim.test.js`: a bare vm
  context fails without the shim, builds with it). The model's `-mobile` export throws in decode under
  this wasm; the plain export works. The binaries are fetched sha256-pinned (`tools/fetch_kws.mjs`), not
  committed; the contest freeze fetches them.
- **Grammar.** 1,645 phrases; no phrase a prefix of another. Bare "pass" was dropped for "end turn" /
  "pass turn" (it fired inside "cast …" and on "can you pass me the tea").
- **Accuracy** (`tools/voice_eval.mjs`, the shipped files and settings, TTS corpus of 6 Piper voices):
  128/150 right, 0 wrong, 22 missed; 115/125 without the accented voice; 5/24 false alarms, all "draw".
  The search settings came from the same corpus (4 → 12 active paths: 57% → 87%).
- **Audio path.** Point-sampling 48 → 16 kHz, and a carry that read `ch[-1]`, gave NaN audio: 0 phrases.
  A box-filter decimator fixed both. Through Chromium's fake mic: the browser's voice processing on heard
  3 of 5 phrases, off 4 of 5; it stays on (the altar's clips play beside the mic).
- **Gaze.** The first ray hit is wrong: the hand's fan grazes the ray to the deck (IWER: 4 of 6 gaze
  draws lifted a card instead). The pick is the target nearest the line of sight among ray hits and a
  2.5° cone. IWER (B60): 11–13 of 12–14 moves by real head movement per run, dwell 1.00–1.07 s, advance
  2.0–2.06 s; the remaining move each run is the castle's mulligan prompt resolving by timeout.
- **Theme.** Wrapping materials in board.js/altar.js would conflict with the world-art lane's rewrite, so
  `src/theme.js` keeps a material's own colour as its standard and assist.js themes the scene's known
  parts from outside; the art uses the same hook.
- **Budget, measured in IWER (same frame, assist hidden vs shown; MR seat, head on the board):**
  folded +2 draw calls / +160 triangles; settings open +14 / +184 (tiles front-side only: double-sided
  transparent quads cost two passes, +26 before); listening chip +2. Canvas textures ~1.3 MB (≈1.8 MB with
  mipmaps). Download +20.7 MB (`kws/`), during load, gating nothing: on localhost "ready" 1.83 s,
  "loaded" 1.86 s. Worker start 0.9–1.7 s, RTF 0.04–0.07 on familiar (Ryzen 9 3900X). Quest 2: estimates
  in `docs/contest/accessibility.md`, to be measured by the lead.
