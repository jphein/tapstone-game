# Tapstone

A collectible card game with NFC cards and a **shrine**: a smol-powered station that animates the
game when you tap a card on it. Each player's shrine is their commander's station (paperdoll, gear,
voice); the arena draws the shared battlefield; all of them share one ESP-NOW mesh, with no phone and
no cloud (0028). Working title chosen 2026-09-19; trademark search still owed.

## Read first
- `docs/superpowers/specs/2026-09-20-tapstone-design.md` — the approved design spec (2026-09-20); the 2026-09-19 brief is its superseded starting point.
- `docs/superpowers/plans/2026-09-20-tapstone-phase1-rules-crate.md` — the phase 1 plan (rules crate + harness), TDD tasks; executed 2026-09-20, see its "Execution notes".
- `docs/superpowers/specs/2026-09-23-arena-service-design.md` and `docs/superpowers/plans/2026-09-23-arena-service-phase2.md` — the arena service (0028): spec and plan, with execution notes per task.
- `rust/README.md` — how to build, gate and vendor the rules crate; the sim's goldens.
- `docs/superpowers/specs/2026-09-25-tapstone-vr-design.md` (VR, contest Nov 18) and `2026-09-26-roblox-remote-seat-design.md` (Roblox remote seat, 0038).
- `docs/decisions/` — one file per decision, dated, with the reason (0001–0039 as of 2026-09-26; 0028–0036 are the commander-station pivot; 0037 cross-play; 0038 the remote seat; 0039 the Nexus Teahouse).
- `docs/runbooks/` — `radio-match.md` (a whole match over the real radio, verified and stall-controlled) and `contest-freeze.md` (the immutable contest bundle; deploying is JP's step).
- `docs/superpowers/specs/2026-09-27-ember-tide-imbalance-report.md` — why Ember beats Tide ~72% today (sim-backed; no rules changed), feeding #147.
- `docs/research/prior-art.md` — what exists (Cards and Castles lineage, NFC CCGs, the scry platform).

## The platform this game runs on (already built, other repos)
| Piece | Where | Status |
|---|---|---|
| Shrine hardware | `~/Projects/smol` target `targets/s3-cyd/spike-scry` (ESP32-S3 CYD, 320×240, MFRC522 on SPI); printed case MakerWorld 2524848 | verified on JP's unit 2026-09-01 |
| Card read/write, imbue + inscribe rites, UID map, HMAC capability tokens | `~/Projects/scry.realm.watch` | live |
| Cards: CR80 PVC + NTAG215, label kit, direct PVC printing (Canon MX922 card tray) | `~/Projects/labels/label-kit`, `~/Projects/gutenprint-cardtray`, `~/Projects/printing/realm-cards` | live |
| Mesh (ESP-NOW time sync, sigil names) | smol | shipped 2026-07-07 |
| USB gateway (`tapstone-gw`, `@TS1` lines) | smol#549, ROSTER fix smol#551 | hardware-verified on two S3 boards 2026-09-27 (bench PASS) |
| Deterministic names | `~/Projects/realm-sigil` | live |

Rules engine + sim: `rust/` (phase 1 done 2026-09-20; `rules-v0.1.0` tag on main after the PR merges).

Tapstone adds: a rules engine, a shared-battlefield protocol over the mesh, card data, art, a
shrine app (the commander station, 0032) and the arena service that draws the board (0028). It does not re-solve reading tags or printing cards.

## Rules of the road
- Design before code: the brief must be approved and turned into a plan (`superpowers:brainstorming` →
  `superpowers:writing-plans`) before any engine code lands.
- Firmware changes belong in smol (as a target/app), not here; this repo holds the game, the protocol
  spec, card data and tooling. Link, don't fork.
- Card identity: small run = UID registry (scry's `uid-map` pattern); anything sold = NTAG 424 DNA with
  SUN authentication. Decide before the first commercial print, never after.
- Keep the game small: ≤30-card decks, one tap per action, matches under ten minutes, sudden death.
- Web presence, when it exists, uses realm-sigil and registers in status.realm.watch (`tapstone.realm.watch`).

## Verification

**`docs/verification.md` is this repo's conscience** — the rules that earned themselves here, each
with the incident that produced it. Read it before claiming something is checked. Its first line is
the one that matters most: a green check is a claim, not evidence, and in three of four cases here
the check *was* the defect.
