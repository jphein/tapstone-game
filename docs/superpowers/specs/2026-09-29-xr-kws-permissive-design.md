# Voice commands on permissively trained weights (design note)

Date: 2026-09-29 · Lane: Selene · Branch `feat/xr-kws-permissive` · Follows #200 (the accessibility
layer) and the lead's decision after the Oracle's supply-chain review.

## Why

The keyword spotter #200 shipped (`sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01`) was trained
on GigaSpeech, whose Terms of Access say: "Researcher shall use the Database only for non-commercial
research and educational purposes." Tapstone is a prize-contest entry with a planned public launch, so
there is no exemption claim (the lead, money-e8 agreed): the weights must come from audio with clean terms.

## Goals

1. A sherpa-onnx-compatible model trained **only** on permissively licensed audio, with the model
   card's licence and training data verified at the source and quoted.
2. The same TTS corpus through `tools/voice_eval.mjs`, the new weights against the old. The pass line
   for JP's device session is at least 18/20 commands right with at most 1 wrong command in 5 acted
   on (a wrong rate of 20% or less). If the new weights fall below it, that is said first, in the log
   and the PR.
3. `tools/fetch_kws.mjs` pinned to the new bytes (sha256 of every archive and file), CREDITS and
   `public/licenses/` updated, and `docs/contest/accessibility.md` recording the model's source,
   licence, training data and sha256.
4. node and vite green, the IWER voice run on the B60, and a red perturbation (a wrong pin fails closed).

## Candidates (checked 2026-09-29)

| Model | Training data | Weights licence | int8 size | Verdict |
|---|---|---|---|---|
| kws gigaspeech 3.3M (current) | GigaSpeech | Apache-2.0 | 5.2 MB | data is non-commercial: out |
| kws zh-en 3M 2025-12-20 | not stated anywhere (no card) | not stated | 5.3 MB | unverifiable: out |
| icefall librispeech streaming zipformer small 2024-03-18 (CTC) | LibriSpeech 960 h + MUSAN (its training log) | **none stated** on the repo | 26.2 MB | weights licence unstated: out |
| pkufool zipformer-small-streaming | "around 20,0000 hours of open-sourced Chinese and English datasets" | Apache-2.0 | 29 MB | data not enumerated: out |
| **sherpa-onnx-streaming-zipformer-en-20M-2023-02-17** (transducer), exported from desh2608's LibriSpeech `pruned_transducer_stateless7_streaming` small | LibriSpeech 960 h + MUSAN noise (desh2608's training log) | Apache-2.0 on both repos | 43.6 MB | **chosen** |

LibriSpeech (openslr.org/12): "License: CC BY 4.0". MUSAN (openslr.org/17): "License: Attribution
4.0 International (CC BY 4.0)". Both require attribution: CREDITS names them.

## Approach

The chosen model is a streaming transducer, which is what sherpa-onnx's keyword spotter decodes, so
the pipeline stays as it is (worker, shim, grammar, `KWS_CONFIG`). Only the weights, `tokens.txt` and the
BPE model that tokenises `keywords.txt` change. The search settings are re-tuned on the same corpus if
the old ones don't carry over, with the same rule as before: what is measured is what runs.

## Budget

The weights grow from 5.2 MB to 43.6 MB (int8 as published), so the voice download is ~59 MB
against ~20 MB before: **over the lane's ~25 MB**. This is the cost of the only candidate whose weights
and data are both clean on paper. Measured, not guessed, in the PR: download, worker start, RTF and
memory. Options for the lead, which aren't taken here without a measurement:
- quantizing the fp32 export with every op in int8 (the published int8 leaves much of the encoder in
  fp32) would need the quantizer pinned for a reproducible freeze;
- preloading voice only when it's opted in on the page (its first opt-in inside the headset would then
  need a request after load).

## Files

`tools/fetch_kws.mjs` (new source and pins), `public/kws/keywords.txt` (re-tokenised),
`src/logic/voice-commands.js` (`KWS_CONFIG`, if re-tuned), `tools/voice_keywords.py` and
`tools/voice_eval.mjs` (a model dir argument, so old and new can be compared), `public/CREDITS.md`,
`public/licenses/` (CC BY 4.0 text), `docs/contest/accessibility.md`, and tests.

## Execution notes (2026-09-29, measured)

- **Verdict against the pass line: below it on the full TTS corpus, above it without the accented
  voice.** Tuned, the new weights score 128/150 right (85.3%, under 90%), 1 wrong, 21 missed, with 1/24
  non-commands acted on. The five unaccented voices score 115/125 (92%). The GigaSpeech model scored the
  same 128/150 and 115/125, with 0 wrong and 5/24 non-commands acted on. P(at least 18 of 20) is 0.42 at
  85.3% and 0.79 at 92%. JP's voice on the device decides.
- **Tuning** (same corpus; `tools/voice_eval.mjs` gained `KWS_DIR` and `KWS_CONFIG_JSON`):
  - the old settings: 107;
  - score 3, 20 paths, threshold 0.02: 126;
  - 3 sampled segmentations per phrase: no gain (`--nseg` kept, default 1);
  - a per-keyword boost (`:3.0 #0.02`) on one- and two-word phrases: 128 with 1 false alarm (chosen;
    `tools/voice_keywords.py SHORT`).
- **Why the misses.** The model, run as plain ASR on the missed clips, drops their first sounds
  ("pass turn" → "'S TURN", "cancel" → "UL", "advance lane three" → "ANCE SLAIN THREE"), even with a
  2 s silent lead-in. "End turn" is heard, and the docs teach it.
- **In the browser** (IWER on the B60, the fake-mic WAV):
  - heard "what can I say" and "high contrast on" (the old weights heard 3 of the 5 recorded phrases,
    these 2);
  - worker start 0.79–0.92 s, RTF 0.08–0.10;
  - the rest of the match by voice to done; net afterLoad 0.
- **Size.** 59.1 MB is preloaded (was 20.7). On localhost the spotter is now the tail of "loaded"
  (2.92 s vs "ready" 2.79 s). The eval's RSS grows by 255 MB at init (was 172).
- **Fail closed.** `fetchAll` stages and checks every pin before writing anything:
  - a wrong encoder pin through the CLI fails and leaves `public/kws` byte-identical;
  - a build that writes before checking turns `test/fetch-kws.test.js` red.
