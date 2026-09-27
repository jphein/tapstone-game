# Tapstone Rust workspace

Seven crates, one workspace (`rust/Cargo.toml`, edition 2024, `rust-version = "1.95"` — smol's floor):

- **`tapstone-rules`** — `#![no_std]`, no `alloc`, `#![forbid(unsafe_code)]`. Ordered tap events
  (`Record`, 24 bytes) → deterministic game state (`Game`, 348 B, `Copy`) → a chained hash
  (`Chain`, SHA-256 truncated to 8 B over a 144-byte canonical image). Each seat fields a
  commander on the board (0029); `ClaimSeat` carries its final stats in `target` (attack), `aux`
  (toughness) and `lane` (keyword code, -1 for none). One crate, two hosts: the
  shrine firmware (smol, Xtensa) and the arena service. Modules: `cards` (generated `SET1`), `event`,
  `state`, `rules`, `hash`.
- **`tapstone-sim`** — `std` library + CLI. Seeded scripted seats, an arbiter that commits taps and
  keeps the chain, JSON transcripts, golden games, an independent `replay`, and the property tests.
- **`tapstone-proto`** — `no_std`, no `alloc`. The `SMOLv1 MATCH ` frame codec, the TSX1 transcript and the
  reference `Follower` a shrine runs (8,624 B of an 8,704 B budget since #67, const-asserted per target).
- **`tapstone-progression`** — `no_std`, no `alloc`. Commander XP, levels, slots, items and the `ClaimSeat`
  stat derivation (0030, 0031, 0034).
- **`tapstone-arena`** — `std`, the arena service (0028): a sans-IO core that arbitrates, the SQLite
  ledger and journal, the battlefield page over SSE, the `@TS1` gateway link, desk mode and the poster.
- **`shrine-render`** / **`shrine-preview`** — the shrine's 320×240 screens (`no_std`, vendored like the rules
  crate) and their host-only preview from real engine states.

All commands run from this directory (`rust/`). Cargo lives at `~/.cargo/bin`.

## Build and test

```sh
cargo build --workspace
cargo test --workspace
```

## Gates — run all of these before a merge

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo build -p tapstone-rules --target thumbv7em-none-eabi     # everyday no_std proxy
cargo build -p tapstone-proto --target thumbv7em-none-eabi     # the follower is no_std too
cargo build -p tapstone-progression --target thumbv7em-none-eabi
../tools/compile_cards.py --check                               # cards.rs matches game/cards/set1/*.toml
../tools/compile_items.py --check                               # items.rs matches game/items/set1/*.toml
cargo test --workspace
cargo build -p tapstone-arena --lib --no-default-features --target wasm32-unknown-unknown  # the core is sans-IO
cargo build -p tapstone-web --profile wasm --target wasm32-unknown-unknown
node tapstone-web/gate.mjs target/wasm32-unknown-unknown/wasm/tapstone_web.wasm tapstone-arena/web/fixtures/desk-seed11.jsonl
```

`../tools/regate-gate.sh <pr> <branch> <head-sha>` runs these seven steps (not the wasm ones) on familiar
in a fresh clone under `/var/tmp/fwork/morpheus-<pr>`, judged by exit status, with the `test result:` lines
summed; it exits 2 before any step if the clone's head does not match the sha (control: pass `deadbeef`).

The wasm gate proves the headset build runs the arena's own core: nobody seated reproduces the desk fixture byte for byte (`rustup target add wasm32-unknown-unknown` once).

The thumbv7em build proves the rules crate is honestly `no_std` (a bare-metal target with no `std`
at all; `rustup target add thumbv7em-none-eabi` once). The gate the shrine actually needs is the
Xtensa build as smol runs it — it requires espup and the `esp` toolchain (rustc 1.95.0 fork):

```sh
. ~/export-esp.sh && CARGO_UNSTABLE_BUILD_STD=core cargo +esp build -p tapstone-rules --locked --target xtensa-esp32s3-none-elf
```

Green on 2026-09-20. Use thumbv7em day to day and the Xtensa line before a vendoring handoff.

## The arena

```sh
cargo run -p tapstone-arena -- --desk        # two scripted shrines in process, no radio; board at http://127.0.0.1:7790/
cargo run -p tapstone-arena                  # the gateway on USB serial, config from ~/.config/tapstone-arena/arena.toml
cargo run -p tapstone-arena -- --desk --record views.jsonl --once   # one real match as view JSON lines, then exit
cargo test -p tapstone-arena --test fixture -- --ignored regenerate_the_fixture   # the canvas fixture, deterministic
```

`--record` runs on the real clock, so its output differs run to run. The committed canvas fixture
(`web/fixtures/desk-seed11.jsonl`) comes from the deterministic recorder (a simulated clock and a fixed epoch), and
`tests/fixture.rs` fails if it falls behind the engine.

The config names the gateway by MAC (`gateway_mac`), never by ttyACM number, and holds no key: RESULT is
unsigned in playtest one (spec §17). Sink tokens live in files populated from the vault (`token_files`).
The ledger is `$XDG_DATA_HOME/tapstone/ledger.sqlite` (else `~/.local/share/tapstone/`), with a backup after every
result under `backups/`. A ledger path under `/tmp` or `/var/tmp` is refused, and so is a backup of an in-memory ledger.
Design: `docs/superpowers/specs/2026-09-23-arena-service-design.md`; plan and execution notes:
`docs/superpowers/plans/2026-09-23-arena-service-phase2.md`. `tools/check_plan_code.py` re-builds the plan's
Tasks 1–7 code (`--rev` to pick the tree).

## Vendoring into smol

The firmware does not depend on this repo at build time. Copy `rust/tapstone-rules` to
`smol/rust/tapstone-rules` and add it as a path dependency with `default-features = false` — the
same pattern as smol's vendored `rust/sigil-names` (a `VENDOR.sha256` beside it records what was
copied). `src/` must stay byte-identical to the tagged tapstone release (`rules-v0.1.0`); fixes go
here first, then re-vendor. smol's `clock` already ships `sha2 0.11` with default features off at
edition 2024 / rust-version 1.95, so the crate adds no duplicate dependency. `tapstone-proto` (the
follower and the frame codec) and `tapstone-progression` vendor the same way, next to `tapstone-rules`.

Sizes (2026-09-23, 0029): `Game` **348 B** of a 350 B budget (2 B headroom) — measured by a
failing const probe on host, thumbv7em and xtensa-esp32s3, all three agreeing — and enforced by
`const _: () = assert!(size_of::<Game>() <= GAME_BUDGET)` in `state.rs`, so every target's compiler
evaluates it (control: bound 347 fails on all three). Canonical image 144 B. The 2026-09-20 figures
below predate the commander (then `Game` 350 B, image 134 B) and were not re-measured.

Sizes (2026-09-20): `Game` 350 B, canonical image 134 B, `CardDesign` 16 B on 32-bit targets, so
`SET1` is 14 × 16 = 224 B of rodata plus an 8 B slice header. The unlinked thumbv7em release rlib
carries 8.7 KB of `.text` before dead-code elimination. Linked with LTO and `--gc-sections` on
thumbv7em (opt-level s, panic abort), everything the shrine calls is 12.9 KB of `.text`, of which
7.2 KB is `sha2::compress256` and 1.9 KB `compiler_builtins`; the crate's own code is ≈ 3.7 KB and
`SET1` 224 B of rodata. On a smol image that already links `sha2` (the `wifi`/OTA feature) the
incremental cost is ≈ 5.7 KB. Measured 2026-09-20 with a scratch `#![no_std] #![no_main]` bin
exporting one entry that calls `Record::decode` → `Game::apply` → `Chain::step`, linker script
keeping only `.text`/`.rodata`, `RUSTFLAGS="-C link-arg=-Tlink.x -C link-arg=--gc-sections" cargo
build --release --target thumbv7em-none-eabi`, then `arm-none-eabi-size -A` and
`arm-none-eabi-nm -S --size-sort`.

## The simulator

```sh
cargo run -p tapstone-sim -- play --seed 1                # one-line summary
cargo run -p tapstone-sim -- play --seed 1 --taps 500 --json
cargo run -p tapstone-sim -- golden check                 # exit 1 on any mismatch
cargo run -p tapstone-sim -- golden update                # rewrite golden/seed-{1,2,3}.json
cargo run -p tapstone-sim -- replay tapstone-sim/golden/seed-1.json
cargo run --release -p tapstone-sim -- commander --games 4000                      # 0030/0034 bound, Ember mirror; exit 1 if over
cargo run --release -p tapstone-sim -- commander --games 4000 --decks mirror-tide  # the same on Tide — the gate is both runs
# exit 0 clear · 1 a real breach (interval wholly over) · 2 unresolved (interval straddles: rerun with more games, never read as a regression)
cargo run --release -p tapstone-sim -- balance --games 4000                        # every built-in variant; recs0/g recs1/g = records per seat
cargo run --release -p tapstone-sim -- balance --games 4000 --decks mirror-ember --picker play-out --picker1 pass-early --life 16 --from 8 --stop 12
# ^ one ad-hoc variant (any of --bonus/--life/--from/--stop), a person-vs-bot picker pair, a mirror
cargo run --release -p tapstone-sim -- fairness --life 10 --from 4 --stop 6 --bonus 1 --tolerance 100  # a single point: without 100 an unfair row is hidden
```

**Draws are taps (0036).** The engine holds each deck as a list, and every draw is a committed
`Draw` record. The sim models the table: `tapstone-sim/src/physical.rs` gives each seat a paper deck
in the shuffle the sim always used, taps draws from the top for both seats before a seat acts, and
shuffles a mulligan's returned hand back in on its own seeded stream. Games are therefore unchanged
from the pre-0036 engine until a mulligan. Measured on both mirrors against `main` before the change, seat 0 win %
and the commander gate moved ≤ 1.0 point, inside ±1.5 (the table is in 0036, "Measured").

Goldens pin three things besides the rules: the locked `rand` version (the seats, the deck shuffle and
the paper deck's mulligan reshuffle draw from `StdRng`, whose stream may change on a rand major bump),
the scripted seats' heuristics in `tapstone-sim/src/seat.rs`, and the paper deck in
`tapstone-sim/src/physical.rs`. When either changes, run `golden update`, read the diff, and commit
the goldens with the change. `replay` re-derives every hash through a fresh engine without the
arbiter; a transcript whose hashes it cannot reproduce is not a valid transcript.

Property tests (`tapstone-sim/tests/props.rs`) run 2000/300/300 cases by default;
`TAPSTONE_PROPTEST_MULT=10 cargo test -p tapstone-sim --test props` multiplies every count.

## Cards

Designs live in `game/cards/set1/stN-NNN.toml`. Edit the TOML, run `../tools/compile_cards.py`
(Python ≥ 3.11), and commit both the TOML and the regenerated `tapstone-rules/src/cards.rs`; the
generator rewrites only the `BEGIN/END GENERATED SET1` region and `--check` tells CI when the two
drift.

## The headset build (`tapstone-web/www/xr`)

The contest build (VR spec 2026-09-25) is a Vite + IWSDK page over the `tapstone-web` wasm.

```sh
cargo build -p tapstone-web --profile wasm --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/wasm/tapstone_web.wasm tapstone-web/www/xr/public/   # not committed
cd tapstone-web/www/xr && npm ci
node --test test/*.test.js src/*.test.js    # beats, voice, card art, layout, guard (a bare directory errors on Node 24)
npx vite build                              # needs Node >= 20.19 (familiar's default node is 18: use /var/tmp/ftarget/node20)
```

- **IWER** (the emulated headset): `XR_PORT=<free port> npx @iwsdk/cli dev up --headless --allow-browser-automation`,
  then `xr enter`, `xr set-input-mode --input-json '{"mode":"hand"}'`, and `browser run tools/iwer-match.mjs` (a whole
  match) or `tools/iwer-first-five.mjs` (the §3.4 beats, with each voice line). A script's lease is at most 110 s.
  Without the wasm in `public/`, the page fails with a MIME-type error and never sets `__tapstone`. Stop your dev
  server when you're done (`dev down`), then check the port is free.
- **Voice lines:** `game/voice/headset.toml` → `python3 ../../../../tools/voice_lines.py` (Azure Speech; renders only
  changed lines; `--check`, `--dry-run`). Any sentence the headset says must be listed there, character for
  character: `test/voice.test.js` scans the files in `SPOKEN_FROM`, so add a new speaking file to that list.
- **Card art:** `tools/card_art.py` → `public/cards/st1-NNN.webp` (≤ 80 KB each).
- **The contest bundle:** `tools/freeze_contest.py` (see `docs/runbooks/contest-freeze.md`); set
  `TAPSTONE_FREEZE_FULL=1` to run its two real reproducibility builds.

## The remote seat (0038)

One seat played from elsewhere (first, Roblox): a virtual shrine inside the arena, on its own
listener, which carries `/remote/*` only (API in `docs/superpowers/plans/2026-09-26-roblox-remote-seat.md`).

```sh
cargo run -p tapstone-arena -- --desk --remote ember-neutral     # against the desk bot, no hardware
cargo run -p tapstone-arena -- --remote ember-neutral            # against the real shrine on the gateway
cargo run -p tapstone-arena -- --desk --remote ember-neutral --remote tide-neutral   # two remote slots, no bot
cloudflared tunnel --url http://127.0.0.1:7791                   # expose the remote listener only, never :7790
```

**Tunnel trap (the lead, 2026-09-26, cloudflared 2026.9.3 on katana via mise):** don't resolve or curl the
`*.trycloudflare.com` URL until cloudflared's log says `Registered tunnel connection`. An earlier lookup is
cached as not-found by the homelab resolver, so a working tunnel looks dead (`http 000`). To probe from the
homelab, use `curl --doh-url https://1.1.1.1/dns-query <url>/remote/choices` (expect `401`). Roblox's live servers use their own DNS and escape it, but **Studio's playtest server runs on katana, so the trap applies to Studio too** (luna-vr): let Studio touch the URL only after `Registered tunnel connection`.

The join code is printed (`remote join code: …`) and shown in the board's status line; a new one
follows every match. `GET /remote/choices` carries `"seat"`, the arena seat the remote shrine holds (null until its claim
lands; join's `seat` is the same value). `--bind` moves the board listener off 7790, so a second arena (the smoke uses
17790/17791) can run beside a playtest. With `--remote` given twice there are two *slots* (slot k is the k-th deck), a
code each (`remote join code (slot K): …`), and no bot: each slot claims once its code is redeemed, and the first to
claim is seat 0, so each slot learns its seat from its choices. The end-to-end gate and its stall control (`--two`
drives both slots; its `--no-propose` leaves slot 1 alone):

```sh
python3 tapstone-arena/tools/remote_smoke.py target/debug/tapstone-arena               # exit 0
python3 tapstone-arena/tools/remote_smoke.py target/debug/tapstone-arena --no-propose  # exit 1
python3 tapstone-arena/tools/remote_smoke.py target/debug/tapstone-arena --two               # exit 0
python3 tapstone-arena/tools/remote_smoke.py target/debug/tapstone-arena --two --no-propose  # exit 1
```
