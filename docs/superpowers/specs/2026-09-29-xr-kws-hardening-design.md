# Hardening the voice-spotter build (design note)

Date: 2026-09-29 · Lane: Selene · Branch `fix/xr-kws-hardening` · The Oracle's three low findings on
#205 (the reproducible encoder build and `fetch_kws.mjs`).

## Goals

1. **The quantizer runs in a sanitised environment.** The Oracle pointed `PYTHONPATH` at a fake
   `onnx` and the quantizer imported it. A `sitecustomize` could also run code while the output still
   matched its pin.
2. **`pip download` has an overall timeout** in line with `KWS_FETCH_TIMEOUT_MS`, failing closed.
3. **The install is as safe as renames allow, and says exactly what it guarantees.** The #205
   two-rename swap isn't crash-atomic. A SIGKILL between the renames can leave `public/kws` missing
   (and vite would then ship `public/kws.old-<pid>`), or a new `public/kws` beside an old `tools/.kws`.

## Approach

- **Environment.**
  - Every Python the build runs gets `-I`. That is the version probe, `-m venv`, pip (now run as
    `python -I -m pip`) and the quantizer. `-I` ignores every `PYTHON*` variable and the user site, and
    keeps the script's directory off `sys.path`.
  - The child environment itself is cleaned (`cleanEnv`), because `-I` doesn't cover pip's own
    variables. `PYTHONPATH`, `PYTHONHOME`, `PYTHONSTARTUP`, every other `PYTHON*` and every `PIP_*` are
    removed; `PIP_CONFIG_FILE=/dev/null` and `PYTHONNOUSERSITE=1` are set.
  - pip also gets `--only-binary :all:`, so no sdist can run a `setup.py`; `--require-hashes` already
    refuses one.
  - `freeze_contest.py` hands `fetch_kws.mjs` the same cleaned environment, through its own `kws_env()`.
- **Timeouts.** Every `execFileSync` in the build gets a `timeout`:
  - `pip download`: `KWS_FETCH_TIMEOUT_MS × 4`, default 8 min for about 58 MB of wheels;
  - local steps: the same budget.
  - At the timeout the child gets SIGKILL, the build throws, and nothing is installed.
- **Install.**
  - Staging moves **out of `public/`**, into `xr/.kws-staging/` (gitignored). The same filesystem is
    needed, so a rename is still a rename. Vite copies all of `public/`, so a leftover there would ship;
    here it can't.
  - Order: `tools/.kws` is swapped first, then `public/kws`. Each install writes an `.install` stamp
    (an install id and the pins) into both directories.
  - `check()` refuses:
    - a missing file, or a wrong byte;
    - stamps that disagree, meaning a mixed state;
    - leftovers in the staging directory, or legacy `public/kws.{old,new}-*` directories from #205's
      layout.
  - `vite build` refuses when `public/kws` has lost its committed files (an interrupted swap) or its
    stamps disagree. A clone that never fetched still builds: voice shows "not installed".
- **What is guaranteed** (written in the code):
  1. No failure before the first rename changes anything.
  2. Each directory is replaced by one rename, and is never a mix of old and new files.
  3. A crash between renames can leave one directory missing, or the two from different installs.
     Both are detected, by `--check` and by the vite build, not repaired.
  4. Re-running `fetch_kws.mjs` repairs them.

## Budget

No change to the shipped bytes, the scene or the download (51.6 MB).

## Files

`tools/fetch_kws.mjs`, `test/fetch-kws.test.js`, `vite.config.js` (a build guard), `.gitignore`
(`.kws-staging/`), `tools/freeze_contest.py` and `tools/test_freeze_contest.py` (`kws_env`),
`docs/runbooks/contest-freeze.md` (one line).
