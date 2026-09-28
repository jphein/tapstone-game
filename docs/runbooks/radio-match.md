# Runbook — a whole match over the real radio

Part of tapstone#132 (item 1). Two `tapstone-gw` boards (smol#549) on one host's USB: every frame
between the arena and seat B crosses both gateways and the ESP-NOW air.

- **Seat A** is the arena's remote seat (0038) in **gateway mode**, played over `/remote/*` exactly
  the way `tools/remote_smoke.py` (and Roblox) plays it. The arena's `SerialLink` holds board 61.
- **Seat B** is `radio_shrine play`: a desk-style shrine (the reference `Follower` plus a
  `ScriptedSeat`) whose `SerialLink` holds board 62. It stands in for shrine firmware.

| board | node | MAC | role |
|---|---|---|---|
| 61 | 61 | `14:C1:9F:D1:C6:38` | arena gateway (seat A's link) |
| 62 | 62 | `14:C1:9F:D1:C0:88` | shrine gateway (seat B) |

Both must answer `@TS1 PING` with `HELLO <mac> <node> <fw> <epoch>` (fw `1f400a7` tonight).

## 1. Build (on a build host, not the board host)

```sh
cd rust
cargo build --release -p tapstone-arena --features server --bin tapstone-arena --bin radio_shrine
cargo build --release -p tapstone-sim
```

## 2. Deploy

Copy `tapstone-arena`, `radio_shrine`, `tapstone-sim`, `tools/radio_match.py` and
`tools/radio_verify.py` into one bin dir on the host with the boards
(`rsync -rlpi --checksum`, so you can see what actually changed). The arena finds its deck book at
the baked repo path; copy `decks/` there too if the host has no checkout.

## 3. Configs, the scratch ledger and the registry

`radio_match.py` writes all of them into a fresh `--run-dir` (it refuses one that exists), and
never touches `~/.config/tapstone-arena` or a real ledger:

- `arena.toml` — `gateway_mac` (board 61), `http_bind` (loopback), `ledger_path`, `registry_path`,
  all inside the run dir.
- `registry.jsonl` — `radio_shrine registry --deck tide-neutral --index 0`: seat B's figurine plus
  one row per physical copy (26 rows for tide-neutral). Gateway mode's registry is **strict**: it
  resolves every claim, cast and charge by UID. The remote seat's copies are *virtual* and are
  added at startup by `RemoteLink::at_gateway`, which refuses any virtual UID that names a real row.
- `ledger.sqlite` — a scratch ledger. `config.rs` refuses a ledger under `/tmp` or `/var/tmp`, so
  the run dir lives under `$HOME` (tonight: `~/tapstone-radio-orion/<run>/`).

## 4. Run

```sh
B=<bin dir>; R=~/tapstone-radio-orion
python3 $B/radio_match.py --bin-dir $B --run-dir $R/run-c21 \
  --arena-mac 14:C1:9F:D1:C6:38 --shrine-mac 14:C1:9F:D1:C0:88 --seed 21
```

It starts the arena (`--remote ember-neutral --once`, with `TAPSTONE_SERIAL_TRACE`), reads the join
code, starts `radio_shrine play` on board 62 (tide-neutral, `--trace`, `--summary shrine.json`),
joins over `POST /remote/join`, and plays seat A through `/remote/view`, `/remote/choices` and
`/remote/propose`. Exit 0 means the arena finished the match and the shrine heard `RESULT`; the
summary is in `radio_match.txt`. Wall time is about 10 s.

## 5. Verify

```sh
python3 $B/radio_verify.py $R/run-c21 $B/tapstone-sim        # exit 0: VERIFIED
$B/radio_shrine report --arena $R/run-c21/arena.trace --shrine $R/run-c21/shrine.trace > $R/run-c21/report.txt
```

`radio_verify.py` reads only what the arena wrote (`ledger.sqlite`, with Python's `sqlite3`) and what
the shrine computed on the far side of the air (`shrine.json`). It checks that `tapstone-sim replay`
re-derives every hash of the transcript, that the journal equals the transcript, that the TSX1 bytes
and their SHA-256 match `transcript_sha`, and that the ledger, the transcript and the shrine agree on
the final chain head. Perturbing a journal hash, a transcript record, a TSX1 byte or the shrine head
each gives exit 1.

`report` joins both boards' TX/RX trace lines into per-leg delivered, lost and latency counts. Lost
frames are split into air, `txerr` (the gateway refused to send), unanswered (sent by a process that
was already exiting), and `after_close` (arrived after the other side's trace ended). None of those
three is air loss. `src_mismatch` counts RX whose link-layer src differs from the frame header (see
Known faults).

## 6. The stall control

```sh
python3 $B/radio_match.py ... --run-dir $R/control-c2 --seed 24 --no-propose
```

Seat B proposes nothing, so the match must **not** finish. Exit 0 means `CONTROL OK: no result in
90 s`; exit 1 means a match finished with a silent seat. Expect about 8 `match_records` (claims plus
the remote's draws), with the remote seat stuck waiting after ~6 taps.

## Known faults (bench, 2026-09-26/27)

- **Gateway roster poisoning (firmware, smol).** A gateway's `ROSTER` sometimes puts its *own* id
  on the peer's MAC (board 62: `62:14:c1:9f:d1:c6:38`; board 61: `61:14:c1:9f:d1:c0:88`),
  apparently learned from the peer relaying its own frames. The receiver then labels the peer's
  frames with the wrong src, and `TX dst=<own id>` gets refused (`txerr`). The arena drops frames
  named as its own node (`core/mod.rs`). Without that guard, run-s14 seated node 61 (itself) and
  stalled in the lobby. The shrine retransmits, so the correctly named copy is the one that counts.
- **Stale FIFO prefix.** The S3's USB-Serial-JTAG keeps a partial line while no host reads, so the
  first line after open is `@TS1 @TS1 HELLO …`. `SerialLink::await_hello` pings until it gets a
  clean HELLO.
- **Port lock.** `serialport` opens with `TIOCEXCL`. A port still held by an exiting process fails
  to open, and `radio_shrine` retries for 5 s.

## Evidence (katana, fw 1f400a7)

a->s = arena→shrine, s->a = shrine→arena; delivered/tx, then the air-lost count.

| run | build | match | records | wall | winner | verify | a->s | s->a | src_mismatch |
|---|---|---|---|---|---|---|---|---|---|
| run2 | pre-guard | 57b8ae50 | 70 | 9.3 s | 1 | VERIFIED | 79/80, air 0 | 107/110, air 0 | – |
| run-s12 | pre-guard | 57b8af8c | 61 | 9.0 s | – | VERIFIED | air 0 | air 0 | 0/0 |
| run-s13 | pre-guard | 57b8af98 | 65 | 9.0 s | – | VERIFIED | – | air 2 of 98 | – |
| run-s14 | pre-guard | 57b8b212 | – | – | – | **STALL**: seated itself (nodes [61,165]) | – | – | – |
| run-g14 | guard | 57b8b2c2 | – | 9.3 s | 1 | VERIFIED | 71/72, air 1 | 95/98, air 0 | 0/0 |
| run-g15 | guard | 57b8b2ce | – | 12.5 s | 1 | VERIFIED | 97/101, air 1, txerr 3 | 132/157, air 0, txerr 22 | 10/33 |
| run-g16 | guard | 57b8b2df | – | 12.4 s | 0 | VERIFIED | – | – | – |
| run-c21 | 6dca192 | 57b8d220 | 62 | 9.1 s | 1 | VERIFIED | 72/73, air 0 | 95/98, air 0 | 0/0 |
| run-c22 | 6dca192 | 57b8d229 | 62 | 10.1 s | 1 | VERIFIED | 76/78, air 1 | 97/118, air 0, txerr 17 | 4/5 |
| run-c23 | 6dca192 | 57b8d233 | 68 | 9.1 s | 1 | VERIFIED | 80/82, air 2 | 104/107, air 2 | 0/0 |
| control1 | pre-guard | 57b8aece | 8 | 98.8 s | — | CONTROL OK (stalled) | – | – | – |
| control-c2 | 6dca192 | – | 8 | 97.0 s | — | CONTROL OK (stalled) | 102/103, air 1 | 91/106, air 0, txerr 14 | 14/15 |

Every `txerr` burst coincides with a poisoned roster line, and the air itself lost at most 2 frames
per leg per match. The protocol's 100 ms retransmit absorbed all of them.

## Real shrines: smol's station firmware (tapstone#132 item c, 2026-09-27)

The steps above have a desk-style process stand in for the shrine. Here both seats, or seat B
alone, are **smol's shrine station firmware** (`--features tapstone-station`). Its seat is
`tapstone_proto::shrine::Shrine`, the state machine the arena's tests run as `DeskShrine`, and it
chooses its taps with `shrine::Autoplay` until a reader is wired. One image carries the
`tapstone-gw` bridge too.

- **Build** in smol `rust/clock`. Use the S3 recipe with `esp32s3,hw,tapstone-station,espnow,cast`
  and **no `io`**, since P3 belongs to a reader. Bake the seat in at build time:
  - `SMOL_NODE_ID`
  - `TAPSTONE_DECK` (`ember-neutral` | `tide-neutral`)
  - `TAPSTONE_INDEX` (the registry index)
  - `TAPSTONE_STATION_NODE`, on the board whose USB holds the arena. The arena drops every frame
    from its own gateway's node as an echo, so seat A there needs its own id (161).
  - `TAPSTONE_NO_PROPOSE=1` for the stall control.
- **Keys:** build the stations with the same `secrets.rs` as the gateway they talk through. A
  station with another group key sees the arena's frames as `BadTag` and refuses them.
- **Decks:** the arena binaries find `decks/` relative to the path they were built at. Build them
  from a source tree at a path that exists on the board host too (tonight
  `~/tapstone-radio-selene/src/tapstone`), and copy `decks/` there.

```sh
# (i) two real shrines: board 61 = the arena's radio + seat A (ember, index 0, station node 161),
#     board 62 = seat B across the air (tide, index 1)
python3 $B/radio_table.py --bin-dir $B --run-dir $R/run-t6 \
  --arena-mac 14:C1:9F:D1:C6:38 --shrine-mac 14:C1:9F:D1:C0:88
python3 $B/radio_verify.py $R/run-t6 $B/tapstone-sim       # shrine.json is board 62's head
# (ii) a real shrine against the remote seat: board 61 runs plain tapstone-gw, board 62 the station
python3 $B/radio_match.py --bin-dir $B --run-dir $R/run-r2 --arena-mac 14:C1:9F:D1:C6:38 \
  --shrine-mac 14:C1:9F:D1:C0:88 --firmware-shrine --shrine-index 1 --shrine-deck tide-neutral
```

The station's head comes from its console. Every 2 s it prints a `[station] status …` line, then
`[station] FINAL match <id> … head <h>` once its game is over and `[station] RESULT match <id>` when
it hears `R`. `radio_table.py` writes each seat's `shrine-{a,b}.json` from those lines. Board A's
lines arrive in the arena's serial trace.

| run | seats | key | match | records | wall | verify | control |
|---|---|---|---|---|---|---|---|
| run-t4 | two stations | CI throwaway (both) | 57b95826 | 105 | 17.7 s | VERIFIED, both heads | run-t5: stuck at mseq 13, CONTROL OK |
| run-t6 | two stations | fleet | 57b95b7d | 95 | 14.7 s | VERIFIED | — |
| run-r2 | station vs /remote/* | fleet | 57b95acd | 83 | 6.3 s | VERIFIED | run-r3: remote 6 taps, CONTROL OK |

Found while getting there (smol firmware): the arena heads its frames with its gateway's node, not
200, so the station recognises the arena by what it sends. After a match the station holds the
result for 10 s before claiming again; before that hold, its rematch claim put a second match in
the scratch ledger.

## The arena dies mid-match (arena spec §7, tapstone#132 c, 2026-09-27)

`tools/radio_dark.py` runs two station boards as `radio_table.py` does, SIGKILLs the arena once
its ledger holds `--kill-at` records, leaves it dead for `--dark-s` seconds and restarts it on the
same ledger (it resumes from its journal). The stations detect dark themselves (3 s with no arena
frame, `tapstone_proto::shrine::DARK_MS`); seat A on the arena's board arbitrates as the interim.
While the arena is dead the script holds board A's port, so the interim's console is kept
(`shrine-a-dark.trace`). `--control` expects no progress while dark, with both boards built
`TAPSTONE_NO_INTERIM=1`.

```sh
python3 $B/radio_dark.py --bin-dir $B --run-dir $R/run-dark4 \
  --arena-mac 14:C1:9F:D1:C6:38 --shrine-mac 14:C1:9F:D1:C0:88
python3 $B/radio_verify.py $R/run-dark4 $B/tapstone-sim
```

| run | stations | while the arena was dead | after the restart |
|---|---|---|---|
| run-dark4 | interim (smol#558) | both dark, A interim, 17 → 110 records (the match finished) | VERIFIED 57b9dc22, 110 records |
| run-dark5-control | `TAPSTONE_NO_INTERIM=1` | no dark, stuck at 16 | CONTROL OK, VERIFIED 57b9dc71 |

## Real card taps via scry (tapstone#132, 2026-09-27)

`rust/tapstone-arena/tools/scry_bridge.py` turns real NFC taps at the **scry station** into seat B's
taps in a desk arena match. The station POSTs every tap to scry-glass on ubox0, and scry-glass's
journald records each request. The bridge reads that journal over ssh
(`journalctl -u scry-glass -f`) and scry's `uid-map.json`, both **read-only**. It never POSTs to
scry and never writes scry's files. The station token (`k=`) is stripped on ubox0 before a line
leaves it, and again when the line is parsed. No file the bridge writes carries the token, and the
tests check every one of them.

It starts `tapstone-arena --desk --remote tide-neutral --once --ledger <run>/ledger.sqlite`.
Seat A is the desk bot and seat B is the remote seat (0038), which the bridge plays over
`/remote/*` from the taps. `--ledger` is desk mode's scratch ledger. It refuses an existing file,
and a desk ledger credits nobody, so `radio_verify.py` can check the match afterwards.

### Tags to keep off the pad

Tags already bound in scry's uid-map are refused (a bound tag triggers the station's own action),
and the bridge logs them by UID only. Use unbound tags only.

The bridge re-reads the map during the match, so a tag bound mid-match is refused too. Two more
scry traps:

- **Don't arm an imbue** (`realm scry imbue`) while playing. During an imbue window, scry binds the
  next unbound tap to a host.
- **Don't name a sticker from the QR** scry shows after an unbound tap. Naming it binds it, and the
  bridge then refuses it.

### What JP does

1. **Build** the binaries on familiar:
   `cargo build -p tapstone-arena --bin tapstone-arena -p tapstone-sim`.
2. **Start the bridge** in a tmux session on familiar. The run dir must be new, and it must not be
   under /tmp or /var/tmp (the ledger guard). `--registry` keeps the card bindings for the next match.
   ```sh
   python3 rust/tapstone-arena/tools/scry_bridge.py play --arena $T/debug/tapstone-arena \
     --run-dir ~/tapstone-scry/run1 --registry ~/tapstone-scry/registry.jsonl
   ```
   The board is at `http://127.0.0.1:17890/` on familiar (`--port`; the remote seat is on the next
   port up).
3. **Register tags as you go.** Nothing needs doing first:
   - The **first fresh tag** you tap becomes your **castle**.
   - At each **DRAW** prompt, tap a fresh tag. It becomes the next card of the Tide list, and the
     console names it (`registered … as Reef Archer (copy 0)`). Write the name on the tag.
   - A tag you have already registered can be drawn too, if it hasn't been drawn this match.
4. **Play as the console prompts** (0009's card-only grammar):
   - **Cast:** tap a card in hand once, and it is cast after 3 s with the default choice. A unit
     goes into the legal lane with the fewest of your units. A spell goes to the menu's first
     useful target.
   - **Charge:** tap the same card twice within 3 s.
   - **Pass:** tap the castle.
   - A tap that can't act is refused on the console with the reason, such as "not your move" or
     "a draw is owed".
5. **Verify** when it ends. The bridge exits 0 once the arena delivers the result.
   ```sh
   python3 rust/tapstone-arena/tools/radio_verify.py ~/tapstone-scry/run1 $T/debug/tapstone-sim   # VERIFIED
   ```
   `shrine.json` in the run dir is the remote seat's own view of the final head. It comes from the
   arena's process, so unlike a radio shrine's head it isn't independent of the arena.

**Tap count:** about 40 per match. The replay below makes 36 game taps: 1 castle registration,
12 draws (7 opening draws plus turn-start draws), 5 charges (10 taps), 7 casts and 6 passes. It
uses 13 fresh tags (the castle plus 12 cards).

**Known gaps:** there's no card-only tap for *advance*, so seat B's units never advance a lane. No
mulligan is offered (the castle always passes). Spell targeting reads "nearest legal target" as
the menu's first useful target.

### Tests and evidence (familiar, 2026-09-27)

Build the binaries first. The run dirs must not be under /tmp:

```sh
cd rust && SCRY_TEST_DIR=~/.cache/tapstone-scry-test python3 -m unittest tapstone-arena/tools/test_scry_bridge.py
```

The suite is 14 tests: parsing, the token strip, the scratch registry's guard, the tap grammar, and
two replays. The fixture `tools/fixtures/scry-replay.journal` is synthetic but in scry-glass's
exact journald format, with fake UIDs and a fake `k=`. It was written once by
`tools/scry_fixture.py`, and it must not be regenerated to make a test pass. It holds a 404, a 403
tap, and two taps of a tag in the fake uid-map: one before the castle, one mid-match.

- **Replay:** the whole journal makes a VERIFIED match (72 records). Four replays in a row made
  the same 30 proposals as the recording, with the same refusals.
- **Stall control:** the same journal cut at half its taps gives `STALLED` (exit 3), no finished
  match in the ledger, and radio_verify NOT VERIFIED.

Perturbations, each seen red and then green again after a fresh restore:

| perturbation | tests that failed |
|---|---|
| the bound-UID refusal off | 3 (two grammar tests and the replay) |
| the parser keeps `?k=…` in the UID | 2 |
| the charge window at 0.5 s | 2 |
| desk `--ledger` opened but not used | 2 (the replay, and the control's record floor) |
| the older line shape unparsed | 1 |

Two replay races were found and fixed on the way:

- **Off-turn draws raced the bot.** Seat B owes its opening draws during the bot's turn, which runs
  in real time. A replay therefore taps only on its own turn, once the menu has settled.
- **The HTTP view lagged the menu.** The lane choice read `/remote/view`, which can arrive after the
  menu it belongs to. It now reads the arena's `--record` file, which is written before the menus
  refresh. Before these fixes, replays of one journal diverged.

Checked against ubox0's real journal, read-only with the token stripped there: all 50 recorded tap
lines parse. 39 of them are an older scry-glass line shape (`<ip> - "POST …"`, no date) that the
first parser missed. Of the 47 taps with status 200, 43 are scry-bound tags. A live run with no
taps opens the stream, and leaves no `journalctl` behind on ubox0.
