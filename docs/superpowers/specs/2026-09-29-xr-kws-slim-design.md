# A smaller voice model, built reproducibly (design note)

Date: 2026-09-29 · Lane: Selene · Branch `feat/xr-kws-slim` · Follows #202 (the LibriSpeech-trained
spotter, 59.1 MB of voice download) and the lead's decision: requantize, keeping the
no-request-after-load rule. Also the Oracle's #202 findings on `fetch_kws.mjs`.

## Goals

1. Cut the 42.8 MB encoder as far as accuracy allows, with a quantizer pinned so the output's sha256 is
   the same on every run, proved by running it twice. The derived files are **our** build: how
   they're made is written down, the Apache-2.0 notice is kept, and they're marked modified (§4(b)).
2. Hold the accuracy floor on the same TTS corpus: at least 128/150, and 115/125 on the unaccented
   voices (#202's numbers). The largest cut that holds ships, or the note says none does.
3. Fix the Oracle's findings for `fetch_kws.mjs`:
   - (a) an offline `--from <dir>` that checks the same pins against a local copy, usable by
     `freeze_contest.py`, with the runbook updated;
   - (b) a timeout on every fetch, failing closed;
   - (c) an atomic install: build a complete new `public/kws` beside the old one and rename it into
     place, so a full disk or a crash never leaves a mix.
4. A test and a red perturbation for each of 3(a–c). Report download size, "loaded" on localhost,
   worker start and RSS, before and after.

## What makes the encoder big (measured)

In the published int8 encoder, 122 of 162 MatMuls are int8 (15.3 MB). **27 MB stays float32:** the
Conv weights (16.6 MB, nearly all in the 1×1 pointwise convolutions) and one 10.24 MB
relative-position table (1 × 9999 × 256, a constant that only `Slice` reads).

## Recipes tried

Same corpus, same settings; onnx 1.19.1, onnxruntime 1.23.2 `quantize_dynamic`, numpy 2.3.3,
CPython 3.12, Linux x86_64. The floor is 128/150 and 115/125.

| Recipe | Encoder | Right | Unaccented | Wrong | Non-commands acted on | |
|---|---|---|---|---|---|---|
| upstream int8 (#202) | 42.8 MB | 128 | 115 | 1 | 1/24 | |
| `matmul`: our rebuild of upstream's recipe | 43.1 MB | 128 | 115 | 1 | 1/24 | holds, no cut |
| **`matmul-table`**: + the position table as int8 behind one `DequantizeLinear` | **35.4 MB** | **128** | **115** | 2 | 1/24 | **holds: chosen** |
| `matmul-pw-table`: + the 1×1 convs as uint8 (`ConvInteger`) | 23.7 MB | 127 | 114 | 2 | 2/24 | below |
| the same, with per-channel conv scales | 23.7 MB | 127 | 114 | 2 | 2/24 | below |
| the same, with per-channel MatMul scales too | 23.9 MB | 126 | – | 2 | 2/24 | below |
| `matmul-conv`: every conv, uint8 weights throughout | 30.8 MB | 126 | – | 2 | 1/24 | below |
| `full` / `full-pc` | 23.1 / 23.3 MB | 126 | – | 2 | 2/24, 1/24 | below |

- **Choice:** `matmul-table`, the largest cut that holds. The encoder drops from 42.8 MB to 35.4 MB,
  and the voice download from 59.1 MB to about 51.7 MB. The next cut (the pointwise convs, 23.7 MB) costs one
  command on the corpus, and the floor is 128.
- **Cost:** one more wrong command (2 of 150 against 1), still far inside the pass line's 1 in 5.
- **Still over budget:** 51.7 MB is over the lane's ~25 MB. It is what accuracy allows.

## Where the derived bytes live: built in `fetch_kws.mjs`, not hosted

- **How it builds.** `fetch_kws.mjs` fetches the pinned upstream **fp32** encoder (88.8 MB,
  build-time only). It installs the quantizer from `tools/kws-quantize-requirements.txt` into a
  throwaway venv; that file pins exact versions and wheel sha256s, used with `--require-hashes`. It
  runs `tools/kws_quantize.py --recipe matmul-table`, then checks the result against a pinned sha256.
  A different quantizer, interpreter or platform yields other bytes, so it **fails closed**.
- **Why build rather than host.**
  1. Provenance stays whole: every shipped byte traces to upstream bytes pinned by sha256 plus a
     committed script, with no copy of our own to trust, secure or keep online.
  2. Nothing new is published under JP's name.
  3. The output pin means a build that differs can't ship quietly.
- **Costs.** A freeze needs CPython 3.12 on Linux x86_64 (familiar and katana both qualify) and
  downloads about 58 MB of wheels plus the fp32 encoder. `--save`/`--from` make that an offline rebuild.
- **Offline rebuild.** `--save <dir>` keeps every source archive and every wheel, laid out by name. A
  later `--from <dir>` rebuilds from that copy with no network: every source pin is checked, pip runs
  with `--no-index --find-links`, and the output pin is checked. `freeze_contest.py --kws-from <dir>`
  passes it through.

## Licence

The derived encoder is a modified Apache-2.0 work. `public/licenses/NOTICE-kws-model.txt` states the
original (the two model repos, their revisions, and "license: apache-2.0"), and that Tapstone modified
it: requantized by `tools/kws_quantize.py` (recipe `matmul-table`), 2026-09-29. `CREDITS.md` says
"modified" on the encoder row. The decoder, joiner and tokens are upstream's, unmodified.

## `fetch_kws.mjs` changes

- **Timeouts (b).** Every request carries `AbortSignal.timeout(KWS_FETCH_TIMEOUT_MS)`, default 120 s,
  and the whole body read is inside it. A timeout throws and nothing is written.
- **Atomic install (c).** Everything is assembled into `public/kws.new-<pid>`, a sibling on the same
  filesystem:
  1. the committed files are copied in (worker, shim, keywords, tokens, `.gitignore`), then every
     fetched or built file;
  2. every pin is checked there;
  3. the old directory is renamed aside, the new one renamed in, and the old one removed.
  - Any failure before step 3 deletes the new directory and leaves the old one as it was.
  - Between the two renames, `public/kws` is briefly absent; it is never mixed. Node has no
    `renameat2(RENAME_EXCHANGE)`.
  - `tools/.kws/` (the BPE model) gets the same treatment.

## Budget

| | Before (#202) | After |
|---|---|---|
| Voice download (`public/kws`) | 59.1 MB | ~51.7 MB (measured in the PR) |
| Scene draw calls, triangles, textures | – | unchanged (no scene code) |

"Loaded" on localhost, worker start and worker RSS are measured in IWER in the PR.

## Files

- New: `tools/kws_quantize.py`, `tools/kws-quantize-requirements.txt`,
  `public/licenses/NOTICE-kws-model.txt`.
- Changed: `tools/fetch_kws.mjs` (the build, `--from`/`--save`, timeouts, atomic install),
  `test/fetch-kws.test.js`, `tools/freeze_contest.py` (`--kws-from`), `docs/runbooks/contest-freeze.md`,
  `public/CREDITS.md`, `docs/contest/accessibility.md`.

## Execution notes (2026-09-29, measured)

- **Shipped: `matmul-table`.**
  - Encoder 35,384,292 bytes, sha256 `590ed62c…7557`.
  - The same bytes three times: an exploratory venv from PyPI; `fetch_kws.mjs --save` through the
    hash-pinned venv; and `fetch_kws.mjs --from` the saved copy inside `sudo unshare -n`, where `curl`
    fails, so there was no network at all.
  - On the shipped files: **128/150 right, 115/125 on the unaccented voices**, 20 missed, 2 wrong (both
    "lane three" heard as lane one or the left lane), and 1/24 non-commands acted on. That holds the
    floor; upstream's int8 had 1 wrong.
- **Download:** 59.1 MB to **51.6 MB** (−7.5 MB).
- **IWER on the B60** (one session: slim, upstream swapped in, slim again):
  - "loaded" on localhost was 2.33, 2.33 and 3.09 s. That is noise-bound, since loopback hides the size.
  - Worker start: 0.98–1.03 s against upstream's 0.81 s.
  - Browser memory at voice start: +294/333 MB against +285 MB. The int8 table becomes float again at
    session init, so memory isn't saved; the eval's RSS delta is 227 MB against 255–269.
  - Every run: problems `[]`; the fake mic heard its phrases; the match finished; net afterLoad 0.
- **Fail-closed seams, each with a test and a red perturbation** (logged in `scratch/issues/selene.md`):
  - (a) `--from` skipping the pins turns the `--from` test red; the freeze's `--kws-from` refusal
    removed turns `test_a_missing_kws_from_dir_refuses` red.
  - (b) No timer turns both timeout tests red. An unref'd `AbortSignal.timeout` does too: its timer
    doesn't hold the event loop open, so a hang ended as a silent exit. The ref'd timer fixed that.
  - (c) Installing in place instead of in a sibling directory turns the full-disk test and the
    keep-committed-files test red.
- **Build caps on familiar:** `vite build` peaks at about 1.46 GB. Under a 1.7 GB cap V8 runs out of
  heap (node sizes its heap from the cgroup limit), so the build runs capped at 3 GB. The quantizer
  peaks at 466 MB.
