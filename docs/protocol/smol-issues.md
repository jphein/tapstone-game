# smol issues for Tapstone phase 2 — ready to paste

Source: `tapstone-protocol-draft.md` §8 (nine items) plus the vendoring issue from the phase 1 plan.
Each body below is one GitHub issue for `~/Projects/smol`; open them in the order listed — 10 first,
then 1 and 3, the rest as the app needs them. Labels: `tapstone`, `mesh` or `app` as fits. Where the
draft and smol's code disagree, smol wins and the draft gets fixed.

---

## 1. Register the `SMOLv1 MATCH ` frame family

**Context.** Tapstone (decision 0004) runs the same deterministic rules engine on two shrines and
carries proposals, commits and hashes over ESP-NOW. It needs one new frame prefix. Byte 7 = `'M'` is
unused by every existing tag (`H A B T G C S D R U F E O L`), so `classify()` gains a `starts_with`
branch and can never mis-parse an old frame. Draft: tapstone `docs/protocol/tapstone-protocol-draft.md` §2.

**What to build.** In `rust/clock/src/net/wire.rs` and `docs/protocol.md`: the 20-byte common
header (`tag` 13 · `ver` 1 · `kind` 1 · `match` u32 LE · `src` u8), a `Frame::Match { ver, kind,
match_id, src, body }` arm in `classify()`, and an `on_app_frame` hook that hands the body to the
registered app instead of `mode.rs`. Parsers ignore trailing bytes they do not know (SNK's
length-tolerance rule).

**Acceptance.**
- [ ] `classify()` returns `Frame::Match` for a `b"SMOLv1 MATCH "` frame with `ver = 1` and any `kind`, and every existing frame test still passes unchanged.
- [ ] A `MATCH` frame with a longer body than the parser knows is accepted; a frame shorter than 20 B is rejected.
- [ ] `on_app_frame` is called with `(match_id, src, kind, body, rssi)` and `mode.rs` never sees a `MATCH` frame.
- [ ] `docs/protocol.md` lists the family with its payload budget (250 − 20 − 9 = 221 B).

## 2. Enforce the group-MAC on `MATCH` frames

**Context.** A forged commit is a forged match result. Every `MATCH` frame carries the #190 trailer,
but the fleet is in *observe* mode, so today this is measured, not enforced. ELECT already has the
sealed-send treatment.

**What to build.** A `SealedMatch` type whose only exit is `send_to`, covered by
`tools/check_elect_send_path.py` or a sibling, and receive-side rejection of a `MATCH` frame with a
bad or missing trailer regardless of fleet mode.

**Acceptance.**
- [ ] The send-path checker fails the build if a `MATCH` frame can reach the radio without the trailer.
- [ ] A received `MATCH` frame with a wrong trailer is dropped and counted; a unit test proves it while the fleet is in observe mode.
- [ ] The tapstone arbiter loop (issue 10) compiles only against `SealedMatch`.

## 3. A Tapstone app slot

**Context.** Decision 0010: the shrine renders as a smol `kind: Framebuffer` app, not a Slint scene;
sprites and card faces are runtime data in a flash partition. The s3-cyd GUI flavor has the scry
station's app registry (smol#540); the fleet flavor drives c3-oled lane counters.

**What to build.** `AppKind::Tapstone` in both flavors, selectable via CFG `S` as `Tapstone:0`,
receiving `on_app_frame` (issue 1), reader and touch events (issue 8), and a framebuffer to draw
three vertical lanes with 48 px sprites.

**Acceptance.**
- [ ] `S=Tapstone:0` over keyed CFG switches an s3-cyd to the Tapstone idle face (decision 0020) and back; the switch survives reboot.
- [ ] The app slot renders a static three-lane battlefield at ≥ 15 fps on the ES3C28P with one animated band.
- [ ] The c3-oled fleet flavor shows a lane counter for a `MATCH` commit stream it only observes.

## 4. CFG key `M` — house rules

**Context.** Decision 0011: every pacing number (deck size, hand size, second-player bonus, castle
life, pressure round, pressure, stop round) is a house rule applied in the lobby only. The rules
crate carries them as seven bytes (`HouseRules::bytes()`), and their hash is the `rules` field in
LOBBY so mismatched tables cannot pair.

**What to build.** CFG key `M`, cached and re-armed like the other keyed CFG values, value
`deck:hand:bonus:life:from:pressure:stop:v` ≤ 64 B, parsed into `HouseRules`, applied via
`Game::with_rules` only while the game is in the Lobby.

**Acceptance.**
- [ ] `M=25:5:1:20:8:2:12:1` parses to `HouseRules::default()`; a malformed value is refused with a reason and the old value stays.
- [ ] A change while a match is Playing is stored but not applied until the next lobby (`Refusal::LobbyClosed` is never surfaced as an error to the user).
- [ ] Two shrines with different `M` values show each other greyed in the lobby with "house rules differ".

## 5. App-level unicast by node id and per-frame RSSI

**Context.** Pairing orders candidates by RSSI EWMA and TAP/ACK/NAK are unicast to the arbiter. The
roster already maps id → MAC (`add_peer` on first HELLO) and tracks RSSI; the app cannot reach
either.

**What to build.** `send_to_id(id, frame)` for app frames and the RSSI of the frame just received
passed into `on_app_frame`.

**Acceptance.**
- [ ] `send_to_id` to a known id delivers; to an unknown id returns an error without panicking.
- [ ] `on_app_frame` receives the RSSI of that frame, and the lobby list is ordered by it.

## 6. Sub-second mesh clock (optional)

**Context.** `TIME` carries seconds. The 24-byte record has a `time_ms` field for display and
replay pacing only — ordering never uses it — so this is not on the critical path.

**What to build.** A `ms` field in `TIME` (37 → 41 B, length-tolerant parse) and a
`mesh_now_ms()` accessor.

**Acceptance.**
- [ ] Old firmware parses the new `TIME` frame; new firmware parses the old one and reports `ms = 0`.
- [ ] Two shrines' `mesh_now_ms()` agree within 50 ms after one sync.

## 7. A bulk uplink for non-crown boards

**Context.** Decision 0016: the transcript leaves by HTTP from the arbiter. `RELAY_MAX_MSG = 256 B`
cannot carry a 2–3 KB transcript, so a room where only the crown has WiFi cannot post a match today.

**What to build.** Either lift the s3-cyd HTTP client from spike-scry into a shared `net::http`
(the 63-line stub exists) or add a chunked `UP2` payload above 256 B through the crown.

**Acceptance.**
- [ ] A 3.3 KB binary transcript posted from a non-crown s3-cyd reaches scry-glass intact (SHA-256 matches) within 10 s of `RESULT`.
- [ ] A lost chunk is retransmitted, not silently dropped; the sender reports success only after the full body is acknowledged.

## 8. Reader presence duration and touch events to the app

**Context.** The scry reader loop debounces one UID per presence. Tapstone needs tap vs hold
(≥ 600 ms) and the FT6336U touch point routed to the app for lane and target picking.

**What to build.** From the MFRC522 loop: `CardEvent { uid, present_ms }` on card removal or at the
600 ms threshold; from the touch driver: `TouchEvent { x, y, kind }` delivered to the app slot.

**Acceptance.**
- [ ] A 200 ms tap and a 1 s hold of the same card produce two distinguishable events with the same UID.
- [ ] A touch on each of the three lane columns yields a lane index 0–2; a touch outside yields none.
- [ ] No event is delivered twice for one presence (the existing debounce holds).

## 9. Card-set pinning via the image hash

**Context.** "Same firmware" must mean "same rules": LOBBY carries `ruleset`, the first 4 B of the
running image's SHA-256. The OTA manifest already knows that hash.

**What to build.** Expose the running image's SHA-256 to the app at boot (from the manifest or by
hashing the active partition once).

**Acceptance.**
- [ ] `image_sha256()` matches the manifest that installed the image; two shrines on the same OTA build report identical `ruleset`.
- [ ] A shrine on a different build is greyed in the lobby with "different rules image".

## 10. Vendor `tapstone-rules` and add the Framebuffer app slot (decision 0010)

**Context.** The rules engine is `no_std`, no `alloc`, `rust-version 1.95`, one dependency (`sha2
0.11` without default features, which `clock` already ships). It is vendored, not fetched, exactly
like `rust/sigil-names`: copy `tapstone/rust/tapstone-rules` to `smol/rust/tapstone-rules`, path
dependency with `default-features = false`, `VENDOR.sha256` beside it. `src/` stays byte-identical
to the tapstone tag `rules-v0.1.0`; fixes go to tapstone first.

**What to build.** The vendored crate, the path dependency from `clock`, and the `AppKind::Tapstone`
slot (issue 3) that owns a `Game`, an arbiter loop over `Record`s and a `Chain`.

**Acceptance.**
- [ ] `cargo +esp build --locked --target xtensa-esp32s3-none-elf` builds with the vendored crate; `--locked` proves no new dependency entered the lock.
- [ ] `diff -r tapstone/rust/tapstone-rules/src smol/rust/tapstone-rules/src` at tag `rules-v0.1.0` is empty and `VENDOR.sha256` verifies.
- [ ] Smoke test: replaying `tapstone/rust/tapstone-sim/golden/seed-1.json` (decks, house rules and records all read from the file) through the vendored crate — on-device or in the host test of the vendored copy — reproduces **the `final_hash` that file carries**. Do not hardcode the hash here: goldens legitimately move whenever the sim's scripted seats change, and this criterion already went stale once (it named `a01ea2b141f12056`, which the 2026-09-22 picker fix replaced with `598a49c5…` without touching the engine). What is being tested is that the vendored engine agrees with the host engine on the same input, so the file is the oracle, not a number written here.
- [ ] `Game` stays ≤ 350 B — it is **exactly** 350 B today, so this is a ceiling with zero headroom and one more `u8` breaches it. Assert it where the target toolchain must evaluate it, not on the host, and prove the assert bites on-target rather than being const-folded away.
- [ ] Flash: the crate adds **~9.7 KB** — measured on real images, same tier with and without the feature: C3 `+8,770 B .text / +960 B .rodata` at `opt="s"`, S3 `+9,536 / +912`. **The earlier ≤ 8 KB figure was wrong**: it subtracted shared `sha2` from a linked scratch harness, which used the crate's *standalone* `.text` before inlining (~2.6× smaller than monomorphised into a fat-LTO image) and counted none of the ~950 B `.rodata` card table. 9.7 KB is 1.1% of the C3's 875,968 B headroom, so this is not a real constraint — correct the budget, do not shrink the engine. **Measure, do not re-derive:** nothing calls `commit()` until issue 1, so LTO strips the engine to a single surviving symbol and a naive delta reads 5× low; a `black_box` probe is needed, and check your `nm` against a positive control first.
