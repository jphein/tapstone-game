# The arena service — design (sub-project 5, phase 2)

Date: 2026-09-23 · Author: Morpheus (dream-team architecture lane), delegated design calls under
JP's full-auto mode · Status: proposed · Plan: `docs/superpowers/plans/2026-09-23-arena-service-phase2.md`

Sources: 0006 (movable arbiter), 0016 (hash chain, transcripts by HTTP), 0019 (figurine), 0021,
0022, 0027 (ownership lesson), 0028 (the arena is the board), 0029 (commander), 0030 (ledger),
0031 (inventory), 0033 (voice), 0034 (breadth, not power), 0035 (second-player bonus 1), 0036 (draws
are taps; decks are lists), `docs/protocol/tapstone-protocol-draft.md`,
`docs/protocol/state-machine.md`, `docs/playtest/plan-1.md`, `docs/design/card-data-format.md`.
What was surveyed in smol, realmwatch, realm-sigil, status.realm.watch and scry-glass, with file:line
citations, is in `scratch/commander-station/morpheus-arena.md` and summarised where used.

## 1. What the arena is, for playtest one

Under 0028 the arena is **required for a match**. For playtest one it is **a laptop** running one
native Rust binary, `tapstone-arena`, with a **smol gateway node on USB serial** and **one browser
tab** showing the battlefield. It does four jobs:

1. **Arbiter.** It orders taps, applies them through `tapstone-rules`, extends the hash chain, and
   broadcasts commits (protocol §4.3). It is the only node that assigns `mseq` while it is present.
2. **The board.** It serves the battlefield canvas to a local browser. This is the only place the
   board is drawn (0028).
3. **The ledger.** It owns the only writer of commander XP, level, inventory and loadout (0030's
   correction: one local SQLite file). It derives each seat's `ClaimSeat` stats under 0034.
4. **The record.** It keeps the full transcript of every match, takes a transcript hand-back after
   an arena-dark recovery, and posts transcripts to scry-glass and realmwatch when they are
   reachable, never on the lobby's path (0016).

**Not in playtest one:** STT and TTS (0033 makes voice answers a phase-2 stretch goal, and the only
arena-side speech is the rare dynamic line; both wait on the transport measurement 0033 names), LTSP
screens, Skirmish and Siege (phase 4), spectator shrines (plan-1 out of scope), NTAG 424 DNA SUN
verification (phase 3; the `auth` byte stays 0), HA room effects, and a RealmOS box.

**Playtest-one acceptance** (from `plan-1.md`'s measures, restated as arena obligations):
- A full Duel between two shrines completes with both shrines and the arena agreeing on every hash.
- Tap to board: the arena canvas shows a committed tap within **300 ms** of the shrine's `T`
  (plan-1's target, measured end to end with the arena's own timestamps, §13).
- Unplugging a shrine mid-turn pauses the match. Unplugging the gateway (or killing the arena) makes
  the shrines show "the arena is dark". Restarting it resumes the match with no lost record.
- After the match, the winner and loser see XP and loot on their stations, read from the ledger.

## 2. Architecture

```
 shrine A ─┐                      laptop
 shrine B ─┼─ ESP-NOW ─ gateway ══ USB serial ══ tapstone-arena ── http://127.0.0.1:7790 ── browser
           │  (MATCH)   (smol)    (hex lines)    ├─ core (sans-IO arbiter, tapstone-rules)
                                                 ├─ ledger (SQLite, one file)
                                                 ├─ view  (JSON view model → SSE)
                                                 └─ poster (outbox → scry-glass, realmwatch)
```

**D1 — The core is sans-IO.** `ArenaCore` is a deterministic state machine: `handle(Input, now_ms)
-> Vec<Output>`. Inputs are received MATCH frames (with source node and RSSI), timer ticks, and
operator commands. Outputs are frames to send, view updates, ledger effects and log lines. It owns
no socket, no port, no clock and no database. *Reason:* the arena's correctness is the protocol's
correctness, and a sans-IO core can be driven by the same scripted seats that pinned the engine
(`tapstone-sim`), with injected loss, reordering and arena restarts, deterministically and in
milliseconds. The serial port, HTTP server and SQLite sit around it as thin adapters. This is the
same shape as the engine itself (records in, `Applied` out).

**D2 — One MATCH codec, in a new `no_std` crate `tapstone-proto`.** Frame encode/decode for every
`MATCH` kind lives in `rust/tapstone-proto` (`no_std`, no `alloc`, `forbid(unsafe_code)`), vendored
into smol exactly as `tapstone-rules` is (`rust/README.md` "Vendoring into smol"). *Reason:* the
shrine firmware and the arena must parse the same bytes, and two hand-written codecs would be two
descriptions of one format that drift, the class verification.md's third rule names ("build the
checked thing and the checking thing from one object"). smol-issues #1 then only needs to route the
`SMOLv1 MATCH ` prefix to the app; the body codec is ours.

**D3 — A reference follower in `tapstone-proto`.** A `no_std` follower state machine (the shrine
side of §4.3–4.6: apply commits in order, ACK, NAK a gap, hold the record list for hand-back, take
the arbiter role when the arena goes dark) lives next to the codec. The arena's tests drive two of
them, and smol may vendor it as the shrine's match logic. *Reason:* the arena cannot be tested
against firmware that does not exist yet (the survey found `on_match_frame` marked dead code on the
vendor branch), and a follower written only in a test file would not be the one the shrine runs.
Fixed capacity, no heap: 256 records (8 KB at 32 B each) covers a 12-round Duel with margin. At the
sim's mean of 48–80 records per game (goldens), a full stop-round game stays well inside it.
**Measured 2026-09-23:** `size_of::<Follower>()` is **8,584 B** on xtensa-esp32s3 and thumbv7em
(8,592 on x86_64); **8,588 B** on both after `H` gained the per-seat `last_lseq` (plan Task 14);
**8,616 B** on both (8,624 on x86_64) after #67's `B` state (match id, seat map, stated and own genesis, +28 B,
2026-09-25); **8,624 B** (8,632 on x86_64) with the stale-`B` guard's last-left match id (+8 B), by a failing const probe on each target's compiler, built from the plan text by
`tools/check_plan_code.py` (reproducible: see that script). The plan's Task 6 makes it a budget,
`FOLLOWER_BUDGET = 8,704 B` (8.5 KiB), as a const assert in `tapstone-proto`, with a control that a
bound of 8,583 fails. That is the RAM the shrine
pays for the hand-back, on top of `Game`'s 348 B.

**D4 — Rust, tokio, axum, rusqlite (bundled), serialport.** One binary, no Python, no Node, no
build step for the page. *Reason:* the arbiter must link `tapstone-rules` natively (0004/0006); the
surveyed realmwatch is Python, and reusing its code would add a second runtime to the table for the
sake of patterns we can copy (SSE, SQLite pragmas, favicon, theme tokens). rusqlite's `bundled`
feature avoids depending on the laptop's libsqlite3.

## 3. Crates and files

| crate | kind | owns |
|---|---|---|
| `tapstone-rules` | existing, `no_std` | the engine, unchanged by this work |
| `tapstone-proto` | **new**, `no_std` | MATCH header + every kind's body codec; the TSX1 transcript codec; the reference follower |
| `tapstone-progression` | **new**, `no_std` | the 0034 tables: levels, slots, item effects, and `derive_commander(level, loadout) -> Commander`; XP/level arithmetic |
| `tapstone-sim` | existing | now depends on `tapstone-progression` for its tables (the bound run and the arena derive from one object) |
| `tapstone-arena` | **new**, `std` | core, gateway link, ledger, view, HTTP, poster, the binary |

**D5 — Progression moves out of the sim into its own crate.** `tapstone-sim/src/progression.rs`
holds the 0034 tables today and the bound run measures them. The arena must derive `ClaimSeat`
stats from the same tables, or the bound (a claim about the tables) stops being a claim about the
arena. *Reason:* verification.md's "one object". The sim keeps only its measurement code
(`VeteranRun`, `veteran_vs_fresh*`, `wilson95`, `over_bound`), re-exporting the tables.

## 4. The gateway link

**What exists.** Nothing: smol has no USB-serial gateway and no host-side serial reader (survey,
§smol). The closest conventions, which this design follows, are:
- **c6-watch's debug console** (`targets/c6-watch/src/debug_console.rs:1-37`): newline-delimited
  text over USB-Serial-JTAG, RX via the HAL, TX via `println!`, with a fixed line prefix so the host
  parses its own lines out of a stream that also carries logs.
- **smol's USB rules** (`docs/BUILDING.md:87-90, 195-205`): the port is `/dev/ttyACM*` with no baud,
  and the board is identified by vendor `303a:` and MAC, never by the ttyACM number.

**D6 — The gateway speaks prefixed hex lines, not binary framing.**

| direction | line | meaning |
|---|---|---|
| gateway → arena | `@TS1 HELLO <mac> <node_id> <fw_hash8> <group_epoch>` | once at boot and on `PING` |
| gateway → arena | `@TS1 RX <src_id> <rssi> <mac_ok> <hex>` | one received `SMOLv1 MATCH ` frame, trailer stripped; `mac_ok` 1/0 = the #190 trailer verified |
| gateway → arena | `@TS1 TXOK <tx_id>` / `@TS1 TXERR <tx_id> <reason>` | result of a send |
| gateway → arena | `@TS1 ROSTER <id>:<mac>:<rssi>,…` | every 2 s, the mesh roster the gateway sees |
| arena → gateway | `@TS1 TX <tx_id> <dst_id\|255> <hex>` | send one MATCH frame (the gateway appends the trailer via `send_to`) |
| arena → gateway | `@TS1 PING` | liveness; answered with `HELLO` |

Any line not starting `@TS1 ` is a log line: the arena shows it in its log pane and ignores it.
*Reasons:* (1) the gateway's `println!` log output shares the same USB-Serial-JTAG TX FIFO (the
debug-console file explains why the two coexist), so a binary framing would be corrupted by log
bytes, while a prefixed line survives them; (2) the frame is ≤250 B, so hex costs ≤500 B per line
on a 12 Mbit/s USB link and buys `cat`-debuggability; (3) resync after garbage is one newline. COBS
or SLIP would buy nothing that matters at this size.

**D7 — The gateway is a thin smol app, and the trailer stays in smol.** The gateway forwards MATCH
frames only, and does not interpret them. It keeps smol's group-MAC in `send_to` and reports
verification as `mac_ok`, so the arena never holds the fleet key for frame MACs. *Reason:* the key
and the MAC path already live in smol's sealed `send_to` choke (smol-issues #2 extends it to MATCH),
and a second MAC implementation on the host would be a second key location. RESULT signing
(`sig_kind = 1`) would need that key on the laptop, so **playtest one sends results unsigned**
(§11, §17 default 3).

**D8 — Port discovery by vendor and MAC.** Config names the gateway by MAC (`gateway_mac =
"ac:a7:04:…"`). At start and on unplug the arena scans `serialport::available_ports()` for USB
ports with VID `0x303a`, opens each, sends `@TS1 PING`, and keeps the one whose `HELLO` carries that
MAC. *Reason:* BUILDING.md's rule, and on katana `ttyACM1` is a keyboard.

**smol side (an issue to open, text in the plan):** a `Tapstone gateway` app for any USB-capable
smol target (C3 or S3). It joins the mesh as a normal node, registers the `MATCH` prefix
(smol-issues #1), forwards every MATCH frame to USB as `@TS1 RX …`, sends `@TS1 TX …` lines with
`send_to`/`send_to_id` (smol-issues #5), and emits `ROSTER`. No rules, no engine. It must not be the
mesh crown (protocol §1: a crown's WiFi burst deafens it for up to ~15 s), so it runs with WiFi off.

## 5. The arena core as arbiter

The core runs one **table** at a time: one lobby, then one match, then back to the lobby.

**State.** `Lobby { seats: [Option<Seated>; 2], … }` → `Match { game: Game, chain: Chain,
records: Vec<Committed>, ring: last 64 commits, followers: [FollowerView; 2], … }` → `Result {…}` →
`Lobby`. `Committed` is `tapstone-sim::arbiter::Committed`'s shape (record, `Option<[u8; 8]>` hash,
`Applied`), moved into `tapstone-arena`, and the sim's `Arbiter` stays as the sim's simple version.

**Timers**, from the protocol (state-machine.md "Timers"): `C` retransmit 200 ms × 5, head
re-broadcast 1 s, stale peer 3 s → PAUSED, pause timeout 120 s → `R timeout` (for a lost *seat*
only, 0028). The turn clock and "sudden death cap" rows in state-machine.md describe pre-v0 rules.
The engine owns turns, pressure and the stop round, and the arena adds no turn clock in playtest
one (**D9**; *reason:* nothing in rules v0 or plan-1 defines a turn time limit, and a clock that
passes for a player is a rule).

### 5.1 Lobby and seating — an amendment to protocol §4.2

§4.2 pairs shrine with shrine and makes "seat 0 = the lower node id" the arbiter. Under 0028 the
arena arbitrates, so pairing goes **through the arena**:

1. The arena broadcasts `L` every 2 s like a shrine, with a new flag **bit3 = arena**, and its own
   `ruleset`/`registry`/`rules` hashes.
2. A shrine that sees an arena `L` with matching hashes stops offering to shrines and shows "arena
   ready". **A castle-figurine tap** on it is the seat claim (0019): the shrine sends `T` carrying a
   `ClaimSeat` record whose `uid` is the figurine's and whose `card` is the castle design.
3. **Seats go in claim order** (the first shrine to claim is seat 0), and the arena assigns `match =
   (arena_node << 24) ^ unix_now` when the second seat is claimed. *Reason:* 0006 names "the
   offering shrine, whoever tapped first" as the fallback arbiter, and 0029's arena-dark ruling
   reuses exactly that ("the shrine that tapped first in this match"). Claim order therefore gives
   both the seat map and the recovery arbiter from one fact.
4. **The arena overwrites the claim's stats.** Whatever `lane`/`target`/`aux` the shrine proposed,
   the committed `ClaimSeat` carries the stats the arena derived from the ledger (§8). *Reason:*
   0029/0031 put derivation in the arena; a shrine-supplied stat would make every shrine a writer
   of play-affecting state.
5. **The shrines learn the table from `B`** (#67, protocol §4.2b): at the second claim the arena
   broadcasts the rules, the seat map and both lists, with its genesis hash, ahead of the claim
   commits, and re-sends it to a seat that has acked nothing or sends `J`.
6. **Decks are resolved by sigil.** Each shrine's `L` carries `deck_sigil` (the deck-list hash, §4.1).
   The arena loads every deck record it knows (`decks/*.toml`, the format in card-data-format.md)
   and maps sigil → list. A seat whose sigil is unknown is refused with a reason on its station.
   Under **0036** (ruled 2026-09-23 from §17 question 0) the engine holds each deck as a *list*,
   and genesis hashes it, so the arena hands over the deck record's list and its order means
   nothing. `deck_sigil` is already order-independent (it hashes the sorted list), so the sigil a
   shrine beacons and the list genesis hashes name the same thing.
7. Between the claim and the second claim, each seat may **equip** (0031/0032): touch or an
   item-card tap on the shrine sends `E` (§6.2). The arena answers every change with `D` (§6.2), the
   ledger view the paperdoll draws. The 5-second default of 0009 is the shrine's; the arena only
   serves the last loadout.

### 5.2 Taps and commits

As protocol §4.3–4.4 with the arena as arbiter: validate each `T` against the engine; a legal tap
becomes `C mseq=n record hash=h_n`, broadcast; a refusal becomes `T sub=1` with the `Refusal` code.
The simultaneity rule (`SIMUL_MS = 50`, turn owner first) applies to proposals arriving together.

**A used lseq confirms only its own tap (2026-09-23).** A proposal whose lseq is at or below the seat's last
committed one is a retransmit or a stale counter. The arena re-sends the old commit only if the proposal is
the tap committed under that lseq: the same kind, UID, lane, target and aux. Otherwise, or if the arena knows
that lseq only from a hand-back, it answers `T sub=1` with `arena_refusal::STALE_LSEQ` (107). Oracle found the
silent loss this closes: a rebooted shrine took the old commit as confirmation of its new tap and stopped
retransmitting it. A seat's `J` is answered with a full replay of the log (§7, protocol §4.5).

**Draws are taps (0036).** A `Draw` record is validated by the engine like any other: it enforces
the draws owed and the undrawn copies in the list. One rule is the arena's alone, because the
engine never sees a UID: **a physical copy is drawn at most once per shuffle-in** (0036 as corrected
in #60). The arena refuses a `Draw` whose UID is already in that seat's hand or already played this
match (`arena_refusal::COPY_DRAWN`). It keeps, per seat, the UIDs drawn and the UIDs still in hand.
A cast or charge removes its UID from the hand set, and it stays drawn: played this match. A
mulligan returns that seat's in-hand UIDs to the drawable pool, matching the engine returning those
designs to the list, so a copy can be drawn again only after it was shuffled back in. In desk mode the registry is
trusting and UIDs are synthetic, so the check runs on whatever UIDs the desk shrines send.
The arena stamps `time_ms` from its own monotonic clock and the record's `uid` from the shrine's
proposal (the audit trail). **The arena resolves `uid → design`** from the registry
(`registry/copies.jsonl`, loaded at start), so a shrine's proposal `card` field is advisory and the
arena's registry decides (protocol §3: "resolved by the arbiter from the UID registry").

### 5.3 Draws (0036): the arena's side of "every draw is a tap"

The engine does the accounting: owed draws per seat, a list of undrawn copies, and a refusal for
anything else while a seat owes. The arena's job is to feed the engine the right inputs and show the
table what is owed.

- **Genesis gets lists.** Each seat's deck record (resolved by sigil, §5.1) goes to the engine as a
  list. The order in the file means nothing, and genesis hashes the list (0036).
- **The opening hand is drawn by tapping.** When the second `ClaimSeat` starts the game, seat 0
  owes `hand` draws (5) and seat 1 owes `hand + second_player_bonus` (6 under 0035). **Both seats
  draw at once.** A seat that owes *opening* draws may commit a `Draw` during the other seat's turn,
  so the table does not wait for one player to fill a hand before the other starts. This is an
  engine rule in the 0036 PR. The arena applies it like any other rule: it forwards the tap and the
  engine decides. Seat 0 cannot take its first action until its own opening draws are done.
- **Turn-start and spell draws** are owed by the seat whose turn starts, or by the caster ("draw
  two"). That seat's `Draw` taps are the only thing the engine accepts from it until they are paid.
  A deck with no undrawn copies owes nothing.
- **Mulligan** (0036, clarified in #61): the seat's hand goes back to its list, the engine owes it
  **as many draws as the hand it returned** (rules v0's mulligan, not a fresh opening hand), and the
  arena returns those copies' UIDs to that seat's drawable pool (§5.2's once-per-shuffle-in copy
  rule).
- **Prompts are the station's, counts are the board's.** The shrine's voice band says
  "draw N — tap it on the stone" (0032, 0036), from its own follower engine's owed count. It needs no
  arena frame, because both engines hold the same state. The canvas shows each seat's owed draws next
  to its hand count ("drawing 3 of 6"), from the view model's `owed_draws` field, which the engine
  exposes.

### 5.4 Divergence

As §5: a follower's `X` or an `A` whose hash differs halts the match; the arena broadcasts `X`,
posts the transcript with both hashes, and the canvas shows "Desync at event n" with both hashes and
the board at n−1. The arena never picks a winner.

### 5.5 The RESULT linger (ruled 2026-09-23, "linger A")

After a result the arena holds the finished match for **5 s, or until both seats have acked the final
mseq**, whichever comes first (protocol state-machine RESULT). Meanwhile it keeps retransmitting each
seat's next unacked commit every 200 ms, answers `N`, re-broadcasts the head `C` and `R` every
second, and swallows play taps. The lobby runs beside it. The ledger, transcript and poster are not
delayed: `MatchOver` is emitted at the result, as before. *Reason:* without it the lethal commit went out
once. At 10% loss, 30% of 200 seeded duels ended with both followers 1–3 records short of the result,
because a follower that missed the last commit had nobody left to NAK (plan Task 13, measured).

## 6. New and changed frames

All sizes pre-trailer, inside the 221 B payload budget. Codecs in `tapstone-proto`; the protocol
draft gets these rows in the plan's docs task.

### 6.1 `L` LOBBY flag
`flags` bit3 = **arena**. A shrine never sets it.

### 6.2 Ledger frames (lobby only)

| kind | name | cast | payload | meaning |
|---|---|---|---|---|
| `D` | DOLL | arena → shrine, unicast | `seat` 1 · `level` 1 · `xp` 2 · `xp_next` 2 · `slots` 1 · `loadout` 3×2 · `inv_len` 1 · `inv` ≤12×2 · `keyword` 1 · `name_seed` 4 | everything 0032's lobby screen draws: level, XP bar, three sockets, the 12-item grid, the derived keyword. ≤44 B |
| `E` | EQUIP | shrine → arena, unicast | `slot` 1 · `op` 1 (0 = equip loot design, 1 = equip tapped card, 2 = clear) · `design` 2 · `uid` 7 | one loadout change; answered by `D` (success) or `T sub=1`-style reject with a reason |

Item designs are `u16` ids in the set's item table (§8.3), separate from the engine's `SET1`.

### 6.3 Transcript hand-back (protocol §4.5's owed frame)

| kind | name | cast | payload |
|---|---|---|---|
| `H` | HANDBACK chunk | recovering shrine → arena | `from_mseq` 2 · `idx` 1 · `count` 1 · `n` 1 · `last_lseq` 2 × 2 (each seat's highest committed lseq at the interim, so the arena dedupes retransmits; ruled 2026-09-23) · up to 6 × 32 B records (24 B `Record` + 8 B `h_n`) = ≤201 B |
| `K` | HANDBACK-NAK | arena → shrine | `from_mseq` 2 · `bitmap` 8 (bit set = missing, all-zero = done), the `S`/`Q` shape |

## 7. Arena-dark recovery

**What survives what.** The arena journals every committed record to SQLite (`match_records`)
before broadcasting it (**D10**). *Reason:* the shrines keep full state in RAM, but the transcript
and the ledger are the arena's, and an arena process that restarts on the same laptop should
recover from its own disk. The hand-back is for the gap the arena never saw.

1. **The arena goes dark** (process killed, gateway unplugged, laptop asleep). The shrines, by
   §4.5 and 0028/0029, promote the first-claimed seat's shrine to arbiter and keep committing.
   Each shrine holds the full record list (D3's follower does this).
   **Detection (lead ruling 2026-09-27):** a shrine in a match goes dark after 3 s with no frame from the arena (three missed `HEAD_MS` head re-broadcasts, §4.5's `PEER_STALE` idiom); seat 0 becomes the interim, seat 1 re-addresses to seat 0's node from `B`'s seat map, and any arena commit ends it (step 5). `tapstone_proto::shrine::Dark` implements this and the interim role; `tests/dark_detect.rs` holds the 3 s edge.
   **A shrine with no `B` discovers the window by its own `J` (2026-09-27, smol#558).** A seat that rebooted mid-match and kept nothing has no match in play to hear silence in, and without a seat map it cannot tell the interim's commits from the arena's, so the 3 s rule never starts for it: its `J` went to the dead arena, and its seat stalled for the whole window. Its probe is the `J` itself, which a live arena always answers with `B` (§5.1). A `J` for a `B` still unanswered after 3 s (`DARK_MS`) puts the shrine in the dark window, where a seatless shrine broadcasts what it meant for the arena; the interim answers it with a rebuilt `B` and `H` (#76, below), and that `B` names both the shrine's seat and the interim's node. An arena that was only slow answers the broadcast the same way, and its first commit ends the window. No new frame. The rule reads its `J`'s time only while the shrine holds no `B` at all, and a `B` once taken is never dropped, so a rematch's `J` (a lost `B`, #67) cannot find a stale time from the rejoin and declare dark with the arena alive. `tests/dark_seatless.rs` holds it, with the control (discovery off) stalling 38 of 38 cases in play.
2. **The arena comes back.** It loads the in-flight match from its journal (rules, seats, records
   at mseqs `0..k`, i.e. `k` of them, and the head hash), rebuilds `Game` and `Chain` by replaying the records through the
   engine (the same path `tapstone-sim::replay` proves), and broadcasts `L` with bit3 and the match
   id.
3. **It asks for the gap.** It sends `J role=arena have_mseq=k` (its next mseq: `from = log.len()` in
   the code) to the interim arbiter, which answers with `H` chunks from mseq `k` to its head. The arena NAKs missing chunks with `K`.
4. **It verifies before it takes over.** Every handed-back record is re-applied through the engine
   and its hash compared with the carried `h_n`. **One mismatch and the match halts** (§5.4). The
   arena never trusts a handed-back hash it cannot recompute.
5. **Handover.** When the arena's head equals the interim arbiter's, it sends a commit at the head
   (idempotent by `mseq`) with bit3 set, and the shrine returns to follower. The canvas resumes.
   The arena first adopts, through the step 4 path, any interim commits it overheard past the hand-back,
   because the interim arbitrates until it sees the handover.

   **Until the hand-back is verified, the arena commits nothing (2026-09-25, #95).** A tap that reaches it
   between step 2 and step 5 is dropped, not refused: no new wire code, since a shrine retransmits until a `C`
   arrives. Before this it committed such taps on top of its journaled prefix, and the late hand-back then
   failed verification at the wrong `mseq`: a false DESYNC that voided a match both shrines agreed on. Its
   `J` and `N` answers need no guard: with taps dropped, its log is the journaled prefix until it resumes,
   and that prefix is final. **A would-be interim that never received `B` holds no game (#91):** it
   arbitrates nothing while the arena is dark, and the match waits (0028). Its `J` reaches the revived
   arena, which answers with `B` and the journaled prefix. That answer is what lets the shrine hand back
   from `k` at all: an empty tail, so the arena resumes at its own head. `B` alone would not do it, because
   a shrine's log after `B` is empty, and it could hand back nothing from `k`.

   **While resuming, the arena re-broadcasts the head of its journaled prefix every `HEAD_MS` (2026-09-25,
   #98(a); ruling relayed, pending JP's confirmation).** On a lossy mesh the replayed prefix can lose a commit,
   and an interim missing one cannot hand back from mseq `k`. The re-broadcast lets it (and any seat) see the
   gap and NAK it, and the answer comes from the final prefix. The wire has no handover flag yet (step 5's
   bit3), so a shrine cannot tell this re-broadcast from the handover commit: an interim that hears it stops
   arbitrating before the hand-back completes. That is safe, because a resuming arena commits nothing and the
   seats retransmit, but it is a consequence of this rule.

   **The journaled head is not agreed until a shrine ACKs it with the arena's hash (2026-09-27, #160,
   #167).** The arena can journal a commit and die before any shrine hears it; the interim then arbitrates
   that mseq itself. A shrine's ACK there with another hash means the record was never agreed: the arena
   drops it and everything after it and asks for the hand-back from that mseq (#160). Two more rules close
   the paths that rewind missed (#167: 7 of 2,000 seeds on the loss 0.2 mesh). **An empty round-one
   hand-back completes nothing** while the head is unagreed: an interim holding exactly as many records as
   the journal, its own at the head's mseq, hands back an empty tail, which verifies nothing. The arena
   sends that interim its head at once and asks again once the ACK agrees it (or rewinds it). **Until then
   the head re-broadcast goes to the interim alone:** broadcast, seat 1, which may have missed the
   interim's record, would take the arena's, and would stay forked once the rewind drops it.

   **The handover takes two rounds (2026-09-25, #98 b/c; for JP's decision).** The interim arbitrates until
   it hears an arena commit, and on a lossy mesh the arena may not overhear what it commits in that window.
   Resuming after one hand-back then either forks (the arena commits a different record at an mseq the
   interim already used) or stalls (overheard commits wait forever behind a missing one). So after the first
   hand-back verifies, the arena sends the handover commit and **commits nothing** until the interim **ACKs
   its head**. The interim ACKs only an arena commit it heard, so by then it has stepped down and its log is
   frozen. The arena then asks for a **second hand-back from its head** and resumes once that is absorbed.
   **If the interim never answers, the match waits** (0028) and the arena keeps asking. It never resumes on
   a log that may be incomplete, and never voids automatically. Past `HANDOVER_BOUND_MS` (3 s: the longest
   handover measured over 660 lossy runs was 1010 ms) it logs once that the handover is still open. A dead
   interim is a dead seat 0, and the operator voids the match by hand, as for step 6.

   **Retransmits across a recovery (ruled 2026-09-23).** The hand-back carries each seat's highest
   committed lseq (`H.last_lseq`, 2 × 2 B), and the arena seeds its dedupe from it, so a tap the interim
   committed, whose `C` a seat lost and then retransmits, is not committed twice. The dedupe path is the
   one it always was: `lseq ≤ last` for that seat. That is the rule, not an
   assumption: **a shrine never proposes an lseq it has used in the match.** A rebooted shrine loses its counter,
   so before it proposes it re-syncs, applying every `mseq` up to the highest it has heard in any `C` and
   staying caught up for one head re-broadcast period (`HEAD_MS`, 1 s), or until it hears `R` (the first commits
   heard may be an old retransmit, so the highest heard is not yet the head), and
   resumes at its seat's last committed lseq + 1, learned from the re-synced records (their `C` frames carry
   each tap's `(seat, lseq)`). Either path does it: NAKing its gap, or `J role=seat` (a seated shrine's `J`
   is answered with `B` (protocol §4.2b) and a full replay of the log, not a snapshot; a shrine that
   kept nothing across the reboot has no `B`, so it must take the `J` path, and the NAK path needs the
   `B` it kept). The arena enforces it: on a used lseq it
   re-sends the commit only if the proposal is the tap committed under it, and otherwise answers
   `T sub=1 STALE_LSEQ` (107), so a counter that went backwards re-syncs instead of taking an old commit
   as confirmation of a new tap. A shrine refused as stale moves its counter past the refused lseq.
   **While the arena is dark, the interim answers a seat's `J` and `N` (#76).** A rebooted seat kept nothing, so
   its `J` is answered with `B` rebuilt from the interim's own state, then `H` chunks (the hand-back's shape,
   unicast to the seat) from the `J`'s `have_mseq` to the head. A seat's `N` gets the same chunks from `from`.
   Each chunk carries the interim's per-seat `last_lseq`, because the records carry none. The seat re-sends `J`
   from its `next_mseq` once a second until it has caught up. The interim stores no `B`: it has no budget
   for 141 B. So each original list is rebuilt as the undrawn list, plus the hand, plus every card a
   committed `Charge`, `CastUnit` or `CastSpell` of that seat took out of a hand. These are the only rules
   that remove a card from a hand. The rebuilt `B` states the interim's genesis, so a list the arithmetic
   got wrong halts the seat at mseq 1. The interim dedupes a seat's taps from every lseq it has seen
   committed, not only the ones it committed itself. It must also record its own draws and mulligans,
   which it commits without hearing its own `C`: otherwise it re-draws a copy it already drew, and once
   the arena returns it refuses that copy forever (`COPY_DRAWN`) and the match stalls. The interim itself rebooting is still out of scope:
   no match survives a power cycle of the arbiter (§4.5 above).
   **Before its first commit in a dark window, the interim catches up from the other seat (#98).** The
   arena's last commits can reach seat 1 and not the interim before the arena dies. An interim that then
   arbitrated those mseqs itself forked the two shrines, and seat 1 halted on its next commit, which no
   revived arena can mend (20 of 200 runs at loss 0.2). So the interim first sends seat 1 an `N` from its
   own next mseq, every 100 ms, holding the taps that reach it (one per seat; a retransmit replaces its
   seat's). Seat 1 answers with `H` chunks of whatever it holds from there, or one empty chunk when it
   holds nothing past that. The interim applies them as any `H`, checked record by record, then
   arbitrates the held taps from the common head. A seat 1 that never answers (unreachable, or holding
   no game) is waited for 1 s, then the interim arbitrates as before. These are the `N` and `H` of #76 the
   other way round, so there is no new frame. It costs the dark window's first commit one round trip.
   The harness models it (`tests/harness.rs`, `interim_caught_up`); the shrine firmware (smol) owes the same.
   *Deviation from the ruling's wording*, which put lseq in each handed-back record: a per-record lseq would
   cost the follower 256 × 2 = 512 B, making it 8,584 + 512 = 9,096 B, over its 8,704 B budget. The per-seat
   maximum costs 4 B (8,588 B measured on thumbv7em and xtensa) and is all the dedupe reads. A full `H`
   chunk is 2 + 1 + 1 + 1 + 4 + 6 × 32 = 201 B of the 221 B payload.

6. **A fresh arena** (the journal lost, or a different laptop) is **deferred**. The records alone
   cannot rebuild the match: the figurines, the house rules and the deck lists genesis hashed (0036)
   live in the journal's `Begin` entry and on no wire. A fresh arena therefore cannot resume a match.
   The shrines keep waiting (0028), and the operator voids the match by hand. The hand-back frames already carry everything a fresh arena
   would need *after* it has the match metadata, so adding it later is a lobby-metadata frame, not
   a redesign. *(2026-09-25, #67:)* the shrines now get that metadata from the arena's `B` (protocol
   §4.2b: rules, seat map, both lists, genesis), and the figurines ride in the `ClaimSeat` records, so
   what a fresh arena lacks is a `B` sent the other way. Still deferred.

## 8. The ledger

One SQLite file, **`$XDG_DATA_HOME/tapstone/ledger.sqlite`** (falling back to
`~/.local/share/tapstone/ledger.sqlite`), never the repo and never `/tmp`, on katana for playtest one
(§17, ruled by default). After every applied result, the arena writes a backup copy with
`VACUUM INTO` to `$XDG_DATA_HOME/tapstone/backups/ledger-<match>.sqlite` and keeps the newest 20,
because this file is the only record of JP's commanders. It uses WAL, `foreign_keys=ON`,
`busy_timeout=5000` (the realmwatch pragmas). The arena is the only writer (0030).

### 8.1 Schema (v1)

```sql
CREATE TABLE commander (
  key          TEXT PRIMARY KEY,       -- figurine tag UID, 14 lowercase hex (0030 key)
  name_seed    INTEGER NOT NULL,       -- realm-sigil seed for the commander's name
  faction      TEXT NOT NULL,          -- from the castle design the figurine claims with
  xp           INTEGER NOT NULL DEFAULT 0,
  loss_streak  INTEGER NOT NULL DEFAULT 0,  -- consecutive losses, reset by a win (0031 ruling)
  created_at   INTEGER NOT NULL
);
CREATE TABLE inventory (               -- earned loot only; item cards are not inventory
  commander TEXT NOT NULL REFERENCES commander(key),
  design    INTEGER NOT NULL,          -- item design id (§8.3)
  acquired_match TEXT NOT NULL,        -- match id that dropped it
  PRIMARY KEY (commander, design)      -- a duplicate cannot be stored: it melts
);
CREATE TABLE loadout (
  commander TEXT NOT NULL REFERENCES commander(key),
  slot      INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 2),  -- weapon, armour, trinket
  source    TEXT NOT NULL CHECK (source IN ('loot','card')),
  design    INTEGER NOT NULL,
  card_uid  TEXT,                      -- set when source = 'card'
  PRIMARY KEY (commander, slot)
);
CREATE TABLE match (
  id            TEXT PRIMARY KEY,      -- 8 hex
  started_at    INTEGER NOT NULL,
  rules         BLOB NOT NULL,         -- HouseRules::bytes()
  seat0 TEXT, seat1 TEXT,              -- commander keys
  meta          BLOB,                  -- JSON: nodes, decks, figurines, start (for recovery);
                                       -- committed stats live in the ClaimSeat records, once
  state         TEXT NOT NULL,         -- 'playing' | 'over' | 'halted' | 'abandoned'
  final_hash    BLOB, transcript_sha BLOB, winner INTEGER, reason TEXT,
  applied_at    INTEGER                -- when the result was applied to the ledger; NULL = not yet
);
CREATE TABLE match_records (           -- the journal (D10)
  match TEXT NOT NULL REFERENCES match(id),
  mseq  INTEGER NOT NULL,
  record BLOB NOT NULL,                -- 24 B
  hash  BLOB,                          -- 8 B, NULL for lobby records
  PRIMARY KEY (match, mseq)
);
CREATE TABLE ledger_event (            -- what the result did, for the station's result screen
  match TEXT NOT NULL, commander TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- 'xp' | 'level' | 'drop' | 'melt'
  value INTEGER NOT NULL, detail TEXT
);
CREATE TABLE outbox (                  -- §10
  id INTEGER PRIMARY KEY, sink TEXT NOT NULL, match TEXT NOT NULL,
  body BLOB NOT NULL, content_type TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, done_at INTEGER
);
```

**Level is derived, never stored.** `level = min(10, 1 + xp / 5)` (0030's ruling, 5 XP a level) and
`xp_next = 5 * level` below 10. *Reason:* a stored level can disagree with XP; a derived one cannot.
The arithmetic lives in `tapstone-progression`.

### 8.2 Applying a result — exactly once

When a match reaches `R` (or `abandoned`), one SQLite transaction does all of: award XP, update the
loss streak, roll loot, melt, write `ledger_event` rows, set `match.applied_at`. The transaction
first checks `applied_at IS NULL`. *Reason:* a crash between steps must not award XP twice, and a
replayed result must be a no-op.

- **XP (0030):** a win is 3, a loss 1. Nothing if the match was abandoned before round 3. From round
  3, the seat still present gets the win's XP and the leaver nothing. "Abandoned" in v0 means the
  120 s lost-seat timeout (`R reason = timeout`), since the engine refuses `Leave`.
- **Drops (0031):** a drop on a win, and on a loss whose count makes `loss_streak` a multiple of 3
  (the third consecutive loss). A win resets the streak. **A match abandoned from round 3 counts as
  completed for the seat still present**, which gets the win's XP *and* the win's drop, with a reset
  streak. The leaver gets nothing, and its streak is unchanged (0031 ruling).
- **`match.state` records how it ended:** `over` for a result the engine reached (lethal or stop),
  `abandoned` for a lost-seat timeout, and `halted` for a desync. A halted match is posted, and it
  never touches XP, loot or streaks.
- **The roll is deterministic (D11).** `seed = SHA-256(transcript_sha ‖ seat)`, first 8 B as a u64,
  one draw from the eligible loot table weighted toward the commander's faction (×2 for own
  faction, ×1 for neutral, ×1 for the other faction), eligible = items with `min_level <=` the
  commander's level after XP. *Reason:* a loot roll anyone can recompute from the posted transcript
  is auditable, needs no RNG state in the ledger, and makes the ledger rebuildable from transcripts
  alone.
- **The stations hear about it by a fresh `D`.** After the transaction, the arena sends each seat
  a `D` (§6.2) with the new XP, level and inventory. The station's result screen (0032) shows the
  XP bar fill, and it reveals the drop by diffing the new inventory against the lobby's `D`. That is
  0027's rule again: state only the view needs is computed by the view, so no "drop" field enters
  the protocol.
- **Melt (0031, and the grid).** A drop melts into **1 XP** if it duplicates an owned design, **or**
  if the loot grid already holds 12 items (0032's 3×4 grid). *Reason:* 0031 melts duplicates so the
  12-cell screen stays clean. A 13th distinct item would have no cell, so it melts for the same
  reason. The event says which. Melt XP counts toward the level recomputed at the end of the
  transaction.

### 8.3 Item designs

0031 says items are design records with `slot` and `effect`, and names `game/cards/<set>/<id>.toml`.
**D12:** they live beside the cards, in **`game/items/<set>/itN-NNN.toml`**, with their own id
space. `effect` is `haste`, `taunt` or `look` (0034), plus two arena-only fields: `min_level` (0034's
"wider loot table as the commander rises") and `loot` (`true` if it can drop). A new
`tools/compile_items.py` (same conventions and exit codes as `compile_cards.py`) generates the
`ITEMS` table in `tapstone-progression`. *Reasons:* the engine must never see an item (0029), and
`compile_cards.py` requires `stN-NNN` ids to be contiguous engine design indices, so an item in
`game/cards/set1/` would either break `SET1` or have to be special-cased in the engine's generator.
The item table must also be the same object for the arena's derivation and the sim's bound run.

Playtest one needs a small item set: at least one Haste and one Taunt item, and a handful of looks
per slot. The plan adds six (two per slot) so a loadout screen has something to show.

### 8.4 Deriving `ClaimSeat` stats (0029, 0034)

`tapstone_progression::derive_commander(level, &loadout) -> Result<Commander, LoadoutError>`:
attack 2, toughness 4 at every level; keyword = the one `haste`/`taunt` item in the loadout, if any.
It refuses a loadout with two keyword items, more items than `slots(level)`, or an unknown design.
**`flat` mode (0030 ruling):** both commanders use the lower level's slot count, and the higher
commander's trinket (slot 2) is dropped, including its keyword if that is where it sits. Because
0034 removed level stats, flat can only ever remove a keyword that sits in slot 2. The arena
re-checks the result against `COMMANDER_KEYWORDS` before committing, and `Game::set_commander`
refuses anything else anyway (PR #49).

## 9. The battlefield canvas

**D13 — Server-Sent Events, a JSON view model, plain Canvas 2D, no build step.** The arena serves
`/` (one HTML page, one JS module, one CSS file, an SVG favicon, all embedded in the binary), and
`/events` as an SSE stream of **view models**, one per committed record: the canonical `Game` as
JSON (every cell, both castles, both commanders, hands as counts, round, active seat, phase), the
committed record, and the `Applied`. *Reasons:* the view is read-only, and SSE is one-way, survives
proxies and is the pattern realmwatch already uses (`/sse`, `EventSource` with reconnect). A JSON
view model keeps the page free of rules: it never re-implements the engine (0006 point 4). And no
bundler means the laptop needs nothing but the binary.

**0027's lesson, restated as the view brief.** "Mine are objects, theirs are entries" was about a
screen that belonged to one player. The arena's screen is shared, so the brief becomes:
- **Each seat's track is unmistakably its own**, by three redundant cues: side of the board (seat 0
  toward the bottom edge, seat 1 toward the top), faction rim on every unit, and a crest on the
  commander. Colour alone never carries ownership.
- **The view is parameterised by a perspective.** `/?seat=0` draws seat 0's units as objects (a
  tile with stats and keyword) and seat 1's as entries (a compact chip), exactly 0027's asymmetry.
  `/` draws both as objects. Playtest one uses `/` on the laptop. The seat views exist for the day
  each player has their own screen (LTSP, phase 4), and cost nothing now because the renderer takes
  the perspective as a parameter.
- **Lanes run left to right, lane 1 on the left for both players.** Playtest one has one pad per
  shrine (0018), so nothing physical fixes the order yet. This is the order a three-pad apron would
  impose (0018's two-point-oh experiment), and 0027 already rejected rotating the board 90° for that
  reason (its argument against `h6-full`), so the view commits to it now rather than moving later.
- **State that only the view needs is computed by the view** (0027 amendment). Arrival markers,
  "just struck" flashes and the commander's "returns in N" come from diffing consecutive view models
  in the page, never from new fields in the hashed image.
- **Wireframe grade for playtest one:** rectangles, numbers, the unit's name, faction rim, keyword
  tag, damage bar, castle life, mana (charged/spent), hand count, round, active-seat glow, the pause
  and dark banners, and the desync screen. No sprites and no animation beyond a 150 ms flash on
  change. Dark and light themes via `prefers-color-scheme` and CSS custom properties, and an SVG
  favicon (JP's web rule).

**Dev controls** (`/dev`, bound to 127.0.0.1 only): inject a tap as either seat, start a desk match
with two scripted seats (below), and show the gateway log. *Reason:* the canvas can then be built
and demoed before any shrine firmware exists.

**Desk mode.** `tapstone-arena --desk` replaces the gateway with two in-process reference followers
driven by `tapstone-sim`'s `ScriptedSeat` (play-out picker by default). It is the same core and the
same frames, with a lossless in-memory link. *Reason:* critical-path work (0028) should not wait on
smol, and a desk match is a live acceptance test of the whole stack minus radio.

## 10. Transcripts and posting

**The transcript** is protocol §6's binary `TSX1`: a **36 B** header (magic, `match`, `ruleset`,
`registry`, `rules`, seat nodes, deck sigils, `start_ts`, pad: the fields sum to 36; the draft's
"32 B" label is an arithmetic slip, corrected in plan Task 25) followed by 32 B records (24 B
`Record` + 8 B `h_n`).
`transcript_sha` = SHA-256 over header + records (§4.8). The codec is in `tapstone-proto`. The JSON
rendering follows `tapstone-sim`'s `Transcript` (the goldens' shape: `RecordJson` with `seq`, `seat`,
`kind`, `card`, `lane`, `target`, `aux`, `time_ms`, `uid`, `auth`, `hash`, `applied`). **§6's JSON
example is stale:** it still shows the superseded `lseq`/`g`/`intent` fields, and the plan's docs task
replaces it with a pointer to `Transcript`.

**D14 — An outbox, and nothing on the lobby path.** At `R`, the arena writes one outbox row per
configured sink in the same transaction that closes the match. A poster task drains the outbox with
exponential backoff (1 s, 2 s, … capped at 10 min) and records `done_at`. A sink that is down, asleep
(familiar) or not yet implemented simply accumulates rows. The lobby never waits on it. *Reason:*
0030's correction ("a lobby needs nothing beyond the table") and 0016's "keeps its transcript until
it next sees the network".

**Sinks, and what they need built** (neither exists today, survey):
- **scry-glass**: `POST /tapstone/match/<id>?k=<HMAC(secret,"tapstone-arena")[:12]>`, body the
  binary `TSX1`, `Content-Type: application/vnd.tapstone.tsx1`. scry-glass then publishes
  `tapstone/match/<id>` retained on Mosquitto with the JSON rendering (protocol §6). *Needs:* the
  route in `scry-glass.py` (an issue for that repo; text in the plan) and the arena's token in its
  config.
- **realmwatch realm-engine**: `POST /realm-engine/transcript` with the JSON rendering. realm-engine
  turns it into player records (0030: "a derived read-side mirror, never an input to a lobby").
  *Needs:* the route (an issue for realmwatch). Until then the sink is configured off.

A desynced match is posted with both hashes (§5). A match the arena halted before `R` is posted with
`reason = "desync"` and no ledger application.

## 11. Operations

- **Config:** `~/.config/tapstone-arena/arena.toml`: `gateway_mac`, `http_bind` (default
  `127.0.0.1:7790`), `ledger_path`, `registry_path`, `rules` (house rules, default
  `HouseRules::default()`), and `sinks` (url, token-file, enabled). Secrets are files with mode 0600
  populated from Vaultwarden (`bw`), never in the TOML, never committed. The only secret in
  playtest one is the scry-glass token. **There is no group key** (§17 default 3).
- **RESULT is unsigned in playtest one** (`sig_kind = 0`). This is a **known gap** against protocol
  §7: a result is then "a claim, not a proof". It is acceptable for a friends test and closed with the
  product-identity work (0003's 424 DNA). The `Signer` trait stays in the core, so signing is an
  implementation later, not a redesign.
- **Port 7790** sits beside scry-glass's 7787 in the same family. It is configurable.
- **realm-sigil:** `GET /api/version` returns realm-sigil's 16-field JSON (`go/sigil.go:31-46`).
  The Rust `realm-sigil` crate is names-only, so the arena fills the fields itself, with `version =
  "<Name> · <hash7>"` from `realm_sigil::name_for_hex(hash, &FANTASY)`, and git facts via a
  `build.rs`. *Reason:* the CLAUDE.md rule, and a laptop arena whose build is unknowable is a
  debugging trap.
- **status.realm.watch (D15): do not register the laptop arena.** `checks.json` already lists
  Tapstone's static site. The laptop arena is off most of the time, and status.realm.watch has no
  intermittent flag for `http`/`version` checks (`intermittent_nodes` covers tailscale pings only),
  so registering it would be a permanent red. The arena box of phase 4 (always on) registers its
  `/api/version` when it exists. *Reason:* a check that is red by design trains everyone to ignore
  red.
- **Logs:** stdout, one line per event, plus the gateway's log lines prefixed `[gw]`.

## 12. What the arena does NOT do

It does not render sprites or animate beyond a flash (playtest one is wireframe grade). It runs no
STT or TTS (0033). It has no accounts, no login and no remote access (it binds 127.0.0.1 by default;
exposing the view on the LAN is a config change, the dev routes never). It does not verify NTAG 424
DNA SUN (phase 3). It does not host more than one table.

## 13. Testing

- **Codec (`tapstone-proto`):** round-trip every frame kind; a decoder never panics on any bytes
  (a proptest over random buffers, as the engine's decode test does); size of each kind asserted
  against the 221 B budget through one predicate, `fits_payload(n)`, with a control that the
  predicate rejects 222 (plan Task 4), so the size check can fail at all.
- **Core, sans-IO:** full matches between two reference followers driven by `ScriptedSeat` over an
  in-memory link. After every match, three things must agree: the arena's head hash, each
  follower's head hash, and the hashes `tapstone-sim::replay` recomputes from the arena's own
  transcript, which is the independent path over a fresh engine (a golden cross-check without the
  arbiter). It is deliberately **not** "equal to `play_seeded`'s hash for the same seed": the chain
  hashes each record's `time_ms` and `uid`, and the sim's arbiter advances its clock on refused taps
  too, so that equality would test clock bookkeeping rather than the arena. Loss injection (drop
  and duplicate N% of frames) must still converge, with the three still agreeing.
- **Arena-dark:** kill the core at every record index of a match, run the interim shrine arbiter,
  restart the core from its journal, take the hand-back, and assert the final transcript equals the
  uninterrupted one byte for byte. The perturbation: corrupt one handed-back record, and the match
  must halt rather than accept it.
- **Ledger:** apply-once (applying a result twice changes nothing), XP and level arithmetic,
  streak drops, melt on duplicate and on a full grid, the deterministic roll (same transcript_sha,
  same drop), and flat mode.
- **Derivation:** `derive_commander` for every legal loadout is exactly the set `tapstone-sim`'s bound
  run measured (one object, D5), and each result is accepted by `Game::set_commander`.
- **Serial link:** the line codec round-trips; log lines are ignored; garbage then a newline resyncs;
  a PTY pair stands in for the gateway in an integration test.
- **Canvas:** view-model JSON goldens per golden game record, and a manual desk-mode check. The
  latency figure (300 ms) is measured with the arena's own timestamps (`T` received → SSE sent) in
  desk mode and at the table. At the table the shrine-to-gateway radio leg is added, and plan-1 owns
  that number.

## 14. Cross-repo work this depends on

| repo | what | status |
|---|---|---|
| smol | `MATCH` prefix + app hook (smol-issues #1), sealed send (#2), unicast by id + RSSI (#5), CFG `M` with 9 rule bytes (#4, order = `HouseRules::bytes()`) | issues drafted, not implemented |
| smol | **new:** the Tapstone gateway app (§4), text in the plan | to open |
| smol | vendor `tapstone-proto` next to `tapstone-rules` | after this lands |
| scry.realm.watch | **new:** `POST /tapstone/match/<id>` + MQTT publish (§10) | to open |
| realmwatch | **new:** `POST /realm-engine/transcript` (§10) | to open |
| status.realm.watch | nothing for the laptop arena (D15) | — |

## 15. Phasing inside this sub-project

1. `tapstone-progression` (move tables out of the sim; items; derivation; XP arithmetic).
2. `tapstone-proto` (codec, TSX1, reference follower).
3. `tapstone-arena` core (lobby, commits, ring, NAK, pause, result) against followers.
4. Arena-dark (journal, hand-back, verification).
5. Ledger (schema, apply-once, loot, melt, derivation wiring, D/E frames).
6. HTTP, SSE view, canvas page, dev controls, desk mode.
7. Gateway link (line codec, port discovery, PTY test) and the smol gateway issue.
8. Poster (outbox, sinks) and the scry-glass/realmwatch issues.
9. `/api/version`, docs (protocol draft rows, README), gates.

Each step ends green on the workspace gates (`rust/README.md`).

## 16. Design decisions, with reasons

| # | decision | reason, in one line |
|---|---|---|
| D1 | sans-IO core | test the protocol with scripted seats, loss and restarts, deterministically |
| D2 | `tapstone-proto` `no_std` codec, vendored by smol | one format, one codec (verification.md "one object") |
| D3 | reference follower in `tapstone-proto` | the arena needs a shrine to test against before firmware exists |
| D4 | Rust + tokio + axum + rusqlite(bundled) + serialport | links the engine natively; one binary, no second runtime |
| D5 | progression tables in their own crate | the bound run and the arena must derive from one table |
| D6 | `@TS1`-prefixed hex lines on USB serial | survives interleaved `println!` logs, `cat`-debuggable, trivial resync |
| D7 | gateway is thin; frame MAC stays in smol; no fleet key on the arena in playtest one (RESULT unsigned) | one MAC path, one key location; a key on a laptop is a product-security decision |
| D8 | find the gateway by `303a:` + MAC | BUILDING.md rule; ttyACM numbers move, and a keyboard squats one |
| D9 | no turn clock in playtest one | no rule defines one, and a clock that passes for you is a rule |
| D10 | journal every commit before broadcasting | a restarted arena recovers from its own disk; hand-back covers only the gap |
| D11 | loot seeded from `SHA-256(transcript_sha ‖ seat)` | auditable, stateless, ledger rebuildable from transcripts |
| D12 | items in `game/items/<set>/` with `effect ∈ {haste,taunt,look}`, `min_level`, `loot`, compiled by `compile_items.py`; engine never sees them | 0029/0031/0034; `SET1` indices stay contiguous; one item table for arena and sim |
| D13 | SSE + JSON view model + Canvas 2D, embedded, no build step | read-only view, realmwatch's proven pattern, no rules in the page |
| D14 | outbox, never on the lobby path | 0030 correction and 0016 |
| D15 | don't register the laptop arena in status.realm.watch | no intermittent flag for http checks; a red-by-design check teaches ignoring red |
| — | seats in claim order; first-claimed shrine is the recovery arbiter | one fact gives both (0006, 0029) |
| — | the arena overwrites ClaimSeat stats from the ledger | shrines never write play-affecting state (0029/0031) |
| — | melt on duplicate **or** full 12-item grid | 0031's reason (a clean 12-cell screen) applies to the 13th item too |
| — | level derived from XP, never stored | a stored level can disagree with XP |
| — | `/?seat=N` perspective views exist now, `/` is used at playtest one | 0027's asymmetry costs nothing as a parameter, and LTSP will want it |

## 17. Questions only JP can answer

0. ~~**BLOCKING playtest one: how does the engine learn what a player drew?**~~ **Ruled by 0036
   (2026-09-23): every draw is a tap, and the engine knows a deck's list, not its order.** The lead
   chose draw taps over the deck-list-only option I had leaned toward. The reason recorded is that
   the engine keeps enforcing hand size and the draw, the station's hand readout stays knowable, and
   0022's hashed hand keeps detecting disagreement. The arena side is in §5.1 (lists), §5.2 (a copy
   drawn once per shuffle-in, #60) and §5.3 (a mulligan owes the hand size returned, #61). The engine
   change landed in #63; the plan's Task 11b adds the arena's copy rule on top of it.
**Ruled by default, 2026-09-23** (the lead's calls under JP's delegation; reversible, and JP can
overrule any of them):

1. **The playtest-one arena is katana.** The ledger lives at `$XDG_DATA_HOME/tapstone/ledger.sqlite`
   (never the repo, never `/tmp`), with a backup after every result (§8), so JP's commanders persist
   and are his.
2. **Screen placement does not block code:** the board is "any browser window". The view's "seat 0
   toward the bottom edge" is a default, and where the window goes is a table question.
3. **No fleet group key on the arena for playtest one:** RESULT goes out with `sig_kind = 0`,
   recorded as a known gap (§11). Holding a fleet key on a laptop is a security decision for JP to
   make together with the product-identity work (0003's 424 DNA), not now.
