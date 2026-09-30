# Tapstone: accessibility write-up (DRAFT, for "Best Accessibility Forward Experience")

**Status:** DRAFT, 2026-09-28 (accessibility lane, PR feat/xr-accessibility). Nothing here is submitted;
submitting is JP's. Every number below says where it was measured. The Quest 2 numbers are the lead's to
take on JP's headset; until then they are marked **estimate**. Re-check every claim against the frozen
`vr-competition-v1` build before submission.

The award asks for "voice alternatives for hand interactions, eyes-only navigation for limited mobility,
high-contrast modes, or experiences inclusive by default". Tapstone does all four, and each one plays the
**whole game**, not a demo corner of it.

---

## The short version (for the submission form)

Tapstone is a card game you play by touching cards to a stone. On Quest it can also be played **without
hands at all**: by looking, or by speaking. Every move the game offers (draw, charge, summon, cast a spell
at a target, advance a lane, pass, mulligan, claim) can be made three ways, with hands, with head gaze and
dwell, or with voice, and all three go through the same door into the rules engine, so none of them is a
lesser version. The first thing the game asks, before the tutorial, is how you want to play. Captions
are always on and can't be turned off, because the caption band is the game's voice. A high-contrast
theme, large captions, a seated mode, a left-handed layout and reduced motion round it out. Voice
recognition runs entirely on the headset: nothing you say leaves the device.

---

## What each mode does

### 1. Play by looking (head gaze and dwell) — eyes-only navigation for limited mobility

- **What it is.** A small reticle sits where your head points. Rest it on a card, the deck, a lane pad,
  your castle or a target, and a ring fills around it; when the ring closes (1 s by default: 0.8, 1, 1.5
  or 2 s), that thing is selected. It is **head gaze**, said plainly: the Quest 2 and Quest 3S have no eye
  tracking, so the reticle follows the head, not the eyes.
- **How a move is made.** Exactly as the eyes-and-hands path works, with a dwell where a pinch would be:
  look at a card (it lifts), look at a pad (it is played in that lane). Look at the lifted card again to
  turn it face down (charge it for mana). Look at the deck, then a pad, to draw. Look at your castle to
  pass. A spell with several targets opens the target prompt; look at the target's tile, or at the unit
  itself on the board.
- **No accidental moves (the "Midas touch" problem).** A target fires once and must be looked away from
  before it can fire again; a glance away shorter than a quarter second keeps the progress, so head
  tremor doesn't reset it; and the one move that can cost you on a bare look, advancing a lane with nothing
  lifted, takes two full dwells. The prompt's default and the mulligan window wait longer when gaze or
  voice is on (8 s and 6 s instead of 3 s).
- **Reaching it with no hands.** The settings tile beside the stone, and the first-run offer, can always
  be dwelt on, even with gaze off (they take one and a half dwells then, so looking round the room opens
  nothing). A person who can't use their hands can turn gaze on by looking.
- **Proven, not claimed.** A test plays a whole match on the real rules engine by dwell alone, and at every
  step checks that **every** move the engine offers is reachable by dwell (`test/gaze.test.js`: 31 moves
  played, 211 menu items reached). In the emulator (IWER, on familiar's Intel Arc B60) the emulated headset
  turned to each target and the page's own dwell selected it: the first-run offer was answered by gaze,
  and 13 of 14 moves were played by real head movement (draw, charge, summon, advance, pass; the 14th was
  the castle's mulligan prompt, which resolves when its window runs out). Dwells measured 1.00–1.07 s at
  the 1 s setting; an advance, 2.0–2.06 s.

### 2. Play by voice — voice alternatives for every hand interaction

- **What you say.** "draw" · "summon Cinder Whelp in lane two" · "cast Flare at the castle" / "…at lane
  one" / "…at Trench Leviathan" · "charge Tidal Lash" (or "charge card two") · "advance lane three" (or
  "the left lane") · "end turn" · "mulligan" · "claim" · "target two" · "cancel" · "what can I say".
  Settings too: "high contrast on", "gaze on", "large captions on", "open settings", "stop listening".
  Lanes are counted from the left, as a person counts: lane one is the left lane.
- **Why "end turn", not "pass".** Measured on a recorded corpus: a bare "pass" fired inside "cast …" and on
  "can you pass me the tea". A false pass ends your turn, so passing is two words.
- **The mic only after you ask.** The microphone opens only on an explicit opt-in (the first-run offer,
  the Voice tile by hand or gaze, or the page's checkbox), and closes on "stop listening" or the tile.
  While it is open a red dot under the caption band swells with your voice, and the chip beside it shows
  what was heard ("Listening · heard 'summon cinder whelp in lane two'"). A command that can't be played
  is refused on the caption band with the reason, exactly as a hand move is.
- **On the device, and nowhere else.** The Quest Browser has no speech recognition (measured on JP's
  Quest 2: `SpeechRecognition` and `speechSynthesis` are undefined), so Tapstone brings its own: an
  open-source streaming speech model (sherpa-onnx, Apache-2.0) running as WebAssembly in a background
  thread, as a keyword spotter. It listens only for Tapstone's own 1,645 phrases, so it can't misread
  chatter as an unrelated move. Nothing is sent anywhere; the page makes no network request at all after
  it loads.
- **Where the model comes from (checked 2026-09-29).** The weights are trained only on audio with open
  terms. The first spotter (#200) was trained on GigaSpeech, whose Terms of Access limit it to
  "non-commercial research and educational purposes", so it was replaced before launch.
  - Model: `sherpa-onnx-streaming-zipformer-en-20M-2023-02-17`, a streaming zipformer transducer,
    int8. It lives at https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17,
    revision `d42f2d9f7ca24806fb667456a18a9f1b60f70d16`. Its card says "license: apache-2.0" and "This
    model is exported from https://huggingface.co/desh2608/icefall-asr-librispeech-pruned-transducer-stateless7-streaming-small".
  - Checkpoint: desh2608's repo, revision `be162ecc09bade73063a671fad9d18220149d25b`. Its card says
    "license: apache-2.0", headed "LibriSpeech pruned_transducer_stateless7_streaming".
  - Training data, from that checkpoint's training log: `'full_libri': True`, "the shuffled
    train-clean-100, train-clean-360 and train-other-500 cuts" (LibriSpeech's 960 h), and "Enable
    MUSAN" (noise augmentation). LibriSpeech (openslr.org/12): "License: CC BY 4.0". MUSAN
    (openslr.org/17): "License: Attribution 4.0 International (CC BY 4.0)". Both are credited in
    `public/CREDITS.md`, with the licence texts in `public/licenses/`.
  - Files, fetched, built and pinned by `tools/fetch_kws.mjs`. Nothing is installed unless every byte
    matches, and the install is atomic.
    - **encoder, our modified build (Apache-2.0 §4(b), `public/licenses/NOTICE-kws-model.txt`), 35.4 MB:**
      - requantized by `tools/kws_quantize.py` (recipe `matmul-table`: MatMul weights int8 through
        onnxruntime 1.23.2 `quantize_dynamic`, plus the relative-position table stored as int8) from
        upstream's fp32 export (sha256 `f77a22f4ff94604e1afb2aeb13504d7699363528c047c97d3436087c95c9b659`);
      - under a quantizer pinned by wheel hashes;
      - sha256 `590ed62cda38c174dc58ac7f67d654e458bd50e47e34883746dc88e946327557`, identical on every run
        (built three times, once offline);
      - upstream's own int8 encoder was 42.8 MB;
    - decoder int8: `21e2a2acd961b3ac72f55be2f10f1a285e1b0b0ba010d7c0b6eab141411b163c`;
    - joiner int8: `e085d73b593cf9b0707f370dbd656d58327d3fe36d80d849202ef81df02cb01e`;
    - tokens: `49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb`;
    - BPE model (tools only): `c53433de083c4a6ad12d034550ef22de68cec62c4f58932a7b6b8b2f1e743fa5`.
- **Measured.**
  - **Against the device-session pass line (at least 18 of 20 right, at most 1 in 5 wrong acted on), the
    synthetic corpus is below it overall and above it without the accented voice.** Setup: familiar,
    the shipped model and settings, `tools/voice_eval.mjs`, 150 spoken commands in six synthetic voices
    (Piper TTS; synthetic speech, not people in a room).
    - All six voices: **128 right (85%)**, 2 heard as a different command (both "lane three" heard as
      lane one or the left lane), 20 missed (say it again). That is the shipped, requantized encoder;
      upstream's int8 had 1 wrong and 21 missed.
    - The five unaccented voices: 115 of 125 (92%). The heavily accented voice: 13 of 25.
    - Non-command sentences: 1 of 24 acted on (a "draw", which is harmless: a draw is only legal when one
      is owed, and then it is the only move).
    - The GigaSpeech spotter it replaces scored the same 128 of 150 and 115 of 125, with none wrong and
      5 of 24 non-commands acted on.
    - The misses cluster on short commands whose first sound the model drops ("pass turn", "cancel"),
      so the guide teaches "end turn". JP's own session on the Quest decides.
  - End to end in a browser (Chromium's fake microphone playing a recording through the page's real audio
    path): the spotter heard "what can I say" and "high contrast on" of five recorded commands, and the
    game acted on each.
  - Cost: the engine and model are a **51.6 MB** download (15.1 MB engine, 36 MB model).
    - It was 59.1 MB with upstream's int8 encoder, and 20.7 MB with the GigaSpeech spotter.
    - It is fetched during load and gates nothing. On localhost the table was ready at 2.3–2.9 s and
      everything loaded at 2.3–3.1 s. Loopback makes the size invisible; the saving is for Wi-Fi.
    - Starting voice compiles them in a worker: about 1.0 s on familiar.
    - While listening: 8–10% of one desktop core (real-time factor 0.08–0.10) and no main-thread time.
    - Memory: the browser grows by about 300 MB when voice starts, much the same as with upstream's
      encoder, because the int8 table is expanded back to float when the model loads.
  - **Estimate for the Quest 2** (not yet measured): 3–4 s to start, 15–30% of one big core while
    listening, about 300 MB, and 2–3 s more download over Wi-Fi.
  - **Smaller cuts were measured and don't hold the accuracy.**
    - Quantizing the 1×1 convolutions too gives a 23.7 MB encoder but hears 127 of 150.
    - Every conv quantized gives 23–31 MB and 126 of 150.
    - The recipes and their numbers are in `docs/superpowers/specs/2026-09-29-xr-kws-slim-design.md`.
- **Proven.** A test plays a whole match on the real rules engine by voice phrases alone, and checks that
  every move at every step can be said (`test/voice-commands.test.js`); no phrase is a prefix of another
  (a spotter reports the prefix first).

### 3. High contrast

- Near-black surfaces, white text, **yellow** for everything you can act on (the lane pads, the dwell
  ring), and faction colours re-picked for brightness against black. Text meets WCAG AAA (7:1) and every
  surface you must find meets 3:1 against what it sits on; a test holds every pair to it
  (`test/theme.test.js`).
- It repaints the stone, the pads, the deck, the castle card, the board and the units, and switches live
  (by the tile, by voice, or on the page). "Standard" is the art as painted: the theme only substitutes
  colours while it is on.

### 4. Inclusive by default

- **Captions always on.** Every spoken line is also written on the caption band, and there is no setting
  to hide it: the band is the game's voice, and the game is fully playable muted.
- **Asked first.** The first run offers "hands, head gaze or voice" before the tutorial begins, on the page
  before entering the headset and again in the world at the first frame, answerable by a pinch, a look or
  a word.
- **Remembered.** Every setting is kept on the device (and can be set in the page's URL, for a judge:
  `?gaze=1`, `?voice=1`, `?contrast=high`, `?text=large`, `?dwell=1500`, `?seated=1`, `?hand=left`,
  `?motion=reduce`).
- Large captions (half as large again), a seated mode (the table follows a seated head height), a
  left-handed layout (the deck on the left), and reduced motion (effects appear in place, no travel).
- A controller doesn't lock you out: the hands-only guard (the table asks for controllers to be set down)
  applies to hand gestures only, so a person playing by gaze or voice is never refused because a
  controller is awake.

---

## How a judge tries it in under a minute

1. Open the build. The page asks **"How would you like to play?"**. Choose **By looking (head gaze)**,
   then enter the headset. (Or add `?gaze=1` to the address.)
2. Keep your hands in your lap. Look at the top of your **deck** (right end of the stone) until the ring
   closes, then look at the **middle pad**: you drew a card. Do it again: the tutorial counts your draws.
3. Look at a card in your hand, then at a pad: it is summoned into that lane. Look at your **castle
   card** (left end of the stone): your turn ends.
4. Look at the **Accessibility** tile left of the stone: the settings open. Look at **High contrast**.
5. Look at the **Voice** tile in the same column (or choose **By voice** on the page at the start; the
   browser asks for the microphone once). A red dot appears under the caption band. Say "what can I
   say", then "draw", "summon Cinder Whelp in lane two" and "end turn". The chip beside the dot shows what
   it heard, and "stop listening" closes the mic.

---

## What is not done (honest list)

- The Quest 2 measurements of voice (start time, CPU, memory, and accuracy in a real room) are the lead's
  to take; the numbers above for the Quest are estimates.
- Recognition is English only, and was measured on synthetic voices. A real-room check with several
  speakers is owed before any accuracy claim goes in the submission.
- The spoken confirmations the accessibility layer adds ("Head gaze on…", "Cancelled.") are shown on the
  caption band but have no recorded voice clip yet.
- High contrast doesn't yet repaint the Tea House doors or the new world art; the art reads the same
  theme hook (`src/theme.js`) when it lands.
- The target prompt shows three tiles; a spell with more than three targets is reached by looking at the
  unit itself (gaze) or by "target four" (voice). Hands have only the three tiles and the 3 s default.
