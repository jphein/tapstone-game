# Roblox remote seat: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** one seat of a real Tapstone table is played from Roblox. It is a virtual shrine inside the arena, reached over HTTP through a tunnel that exposes only `/remote/*`.

**Architecture:**
- `RemoteLink` wraps the table's real link and adds one manual desk-style shrine on node 165. In gateway mode the real link is the gateway's `SerialLink`; for the Roblox side's test table it is a one-shrine `DeskLink`.
- The arena loop reaches it through `Link::remote()`, so there is **one main-loop code path** with or without hardware.
- A `Hub` owns the join code, the token, the numbered views and the numbered menu. A second axum listener (`:7791`, `/remote/*` only) serves it. The Roblox server is its only client.

**Tech Stack:**
- Rust 2024 (the workspace toolchain), axum 0.8, tokio.
- `rand` 0.9 (`StdRng`, seeded from the OS: ChaCha12, a CSPRNG).
- Python 3 stdlib for the end-to-end smoke. Part B uses Rojo, Luau and StudioMCP.

Spec: `docs/superpowers/specs/2026-09-26-roblox-remote-seat-design.md`. Decision: `docs/decisions/0038-remote-seat.md`. **Part A (the arena)** is written by nebula-xr. **Part B (the Roblox place)** is written by luna-vr in this same file. The contract between the two is spec §2's table, pinned down in Part A's "API contract" below.

## Standing rules for every task

- **Build on familiar, never katana.** Edit and commit on katana, sync or push, then build on familiar.
  - The clone is `familiar:/var/tmp/fwork/<lane>`, with `CARGO_TARGET_DIR=/var/tmp/ftarget/<lane>` and `export PATH=$HOME/.cargo/bin:$PATH`.
  - Delete only your own named subdirs there, never a parent.
- **No CI.** Judge each gate run on its exit status and its pass counts, which you get by summing the `test result` lines. Never judge on an empty grep (`docs/verification.md`).
- **Before Task A1**, run `cargo test --workspace` on main and record the passed/failed/ignored totals. Every task states the delta it expects on top of that.
- **Perturb every new check once, then restore it.** Break the thing the check guards and see it go red. Record the red result and the restore in your lane's scratch log.
- **Never regenerate `web/fixtures/desk-seed11.jsonl` to make a test pass.** `the_canvas_fixture_is_current` guards every refactor here: if it goes red, the refactor changed behaviour. Fix the refactor.
- **Branches, one PR per group:**
  - A1–A3: `feat/remote-link`
  - A4–A6: `feat/remote-api`
  - A7–A8: `feat/remote-cli`
  - Each group is stacked on the previous one. The lead merges only a reviewed sha, after a gate run on familiar.

---

# Part A: the arena

## Decisions (asked of Part A, answered with the code they rest on)

### 1. One code path: `RemoteLink` over a one-shrine desk link, not `DeskLink` with `manual[1]`

- **What gateway mode needs.** It must add a shrine *beside* `SerialLink`. The only way to do that without touching the serial code is a wrapper: `RemoteLink<L: Link>`. It sends to both the inner link and the remote shrine, and merges what both queued.
- **Why not `DeskLink` with `manual[1] = true` for desk mode.** That would put the desk-mode remote seat on a *different* object (`DeskLink.shrines[1]`) from the gateway-mode one. The Roblox side's test table would then exercise code that the real table never runs.
- **What the plan does instead.** Desk mode builds `RemoteLink<DeskLink>`, with `DeskLink.off[1] = true` so only the bot shrine is present. Gateway mode builds `RemoteLink<SerialLink>`. The remote shrine, its gate, its menu and its taps are then the same code in both modes. This is the "one object" rule of `docs/verification.md`.
- **How the loop reaches it.** `main.rs` keeps `link: Box<dyn Link>` (main.rs:42). It reaches the seat through a new default trait method, `Link::remote() -> Option<&mut dyn RemoteSeat>` (`None` for every link but `RemoteLink`). A blanket `impl Link for Box<T>` makes `RemoteLink<Box<dyn Link>>` possible if it is ever needed.
- **Numbering.** The remote shrine is `DeskShrine::with(seed, REMOTE_INDEX = 2, REMOTE_NODE = 165, deck.castle, &deck.cards)`.
  - Its index gives it figurine `[4,0,0,0,0,0,2]` (desk.rs:201 `figurine()`) and copies `copy_uid(2, k)` (desk.rs:60). Both are distinct from the desk shrines' indices 0 and 1.
  - `DeskShrine::new` indexes `DESK_NODES[i]` (desk.rs:170) and `CASTLES[self.deck_idx]` (desk.rs:331). Both would panic at index 2, which is why A1 adds `with(...)` and a `castle` field.
- **Claim order.** The remote shrine claims only once someone has joined *and* exactly one other shrine holds a claim (`RemoteSeat::gate`). Seats go in claim order (lobby.rs:92–135), so the remote seat is always **seat 1**, as spec §2's `"seat":1` says.
- **Rematch.** `rematch = true`, so the seat claims again after each result. Every match gets a fresh join code.

### 2. Gateway identity: a registry overlay, and a guest commander that is never written

- **UIDs.** A strict registry resolves every claim and every card through `self.registry.resolve_or(r.uid, r.card)`: lobby.rs:108 for the castle figurine, play.rs:225 for cards. `Registry::Strict` answers only UIDs from `registry/copies.jsonl` (registry.rs:64–77), so a virtual copy would be refused `UNKNOWN_UID`.
  - **Answer:** `Registry::add_virtual(uid, design)`. At startup it teaches the in-memory strict map the remote shrine's figurine and copies (`RemoteLink::virtual_uids()`).
  - It **refuses** a UID that already names a physical copy, so a virtual copy can never shadow a real card.
  - It is a no-op for `Trusting`, which desk mode uses. Nothing is written to `copies.jsonl`.
- **The commander.** `Ledger::commander` (ledger/mod.rs:239–258) `INSERT OR IGNORE`s a `commander` row on first sight. That would write the guest into JP's ledger.
  - Worse, `apply_result` (ledger/apply.rs:143–153) `query_row`s `SELECT xp, loss_streak FROM commander WHERE key = ?1` for **both** figurines. With a guest that was never written, it returns `QueryReturnedNoRows`, and `main.rs` propagates that with `?`, which would **stop the arena** at the first result.
  - **Answer, per spec §6 and 0030:** `GuestStats { inner, guest }`.
    - The guest is 0030's *fresh commander*: `level_for_xp(0)` = level 1 (progression lib.rs:54), with nothing worn. 0030 line 29 names "a fresh level-1 commander" as the newcomer baseline.
    - `doll` is `None`, since there is no station to show it on. `equip` is refused (`BAD_LOADOUT`). Every other figurine goes to the ledger.
  - `Ledger::apply_result_credit(…, credit: [bool; 2])` skips the guest's seat.
  - `apply_result` becomes `apply_result_credit(…, [true, true])`, so every existing ledger test is unchanged. The match row still records both figurines, which is history, not progression.

### 3. Shared state: `Arc<std::sync::Mutex<Hub>>` plus a `tokio::sync::Notify`, not watch channels

- **Why not a watch channel.** `watch` keeps only the *latest* value. Spec §2 requires that "a poller never misses one or gets one twice". That needs a history of numbered views, not the newest one.
- **Why one mutex.** The join check-and-count (wrong-code counter, lock, token) must be one atomic read-modify-write, and a stale-menu check must consume the menu atomically. One mutex over one `Hub` gives both. The `Hub` is a plain struct with no I/O, so it is unit-tested without HTTP (A4).
- **Rules for the lock.** It is held only for short, non-`await` sections: handlers copy out what they need and drop the guard before awaiting.
- **Wake-ups.** `Notify` wakes long-polls when the loop publishes a view. The handler registers interest (`notified().enable()`) *before* it checks the hub, so a view published between the check and the wait is never lost.
- **Proposals.** They cross to the loop on an `mpsc` channel (`RemoteCmd::Propose(Record)`), like `DevCmd` (http.rs:22–33), because only the loop owns the link.
- **The view long-poll.** It looks for the first kept view numbered above `after`. If there is none, it waits on `Notify` until a deadline (10 s, configurable for tests), then answers `204`.
  - 512 views are kept. A poller that has fallen further behind gets the oldest one kept, and its `n` shows the gap.

### 4. Join codes and tokens: `rand` 0.9 `StdRng::from_os_rng()`, no new crypto crate

- **No new crate.** `rand` is already in the tree: tapstone-sim's dependency and the arena's dev-dependency. `StdRng` is ChaCha12, a cryptographically secure generator, and `from_os_rng` seeds it from the OS.
  - The arena adds `rand` as an optional dependency of its `server` feature, with rand's default features. The wasm build (tapstone-web, `default-features = false`) never sees it.
  - A crypto crate would add nothing for a 128-bit bearer token.
- **The code.** 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0, O, 1 or I), fresh per match.
- **The token.** 16 random bytes as 32 lowercase hex characters. It is compared in constant time, since tunnel requests come from anywhere.
- **The lock.** The 10th wrong code still answers `403`. From then on every attempt answers `423`, even the right code, until the match ends and `Hub::new_match()` issues a fresh code, kills the token and lifts the lock.

### 5. A second listener with its own router

- `remote::remote_router(RemoteState)` mounts exactly four routes: `POST /remote/join`, `GET /remote/view`, `GET /remote/choices`, `POST /remote/propose`. It is served on `--remote-bind` (default `127.0.0.1:7791`) by its own `axum::serve`.
- **It must never share a port with the board.** 0038 says why: a tunnel's requests arrive from localhost, so the board's `/dev/*` loopback check (http.rs:92–95) would pass them. `main.rs` refuses a `--remote-bind` equal to the board bind.
- A5's tests assert `404` on the remote router for `POST /dev/tap`, `GET /events`, `GET /` and `GET /api/version`.

## API contract (spec §2, with what §2 left open, agreed with luna-vr for Part B)

| Route | Request | Answers |
|---|---|---|
| `POST /remote/join` | JSON `{"code":"K7Q2MX"}` (the code is compared exactly: uppercase it) | `200 {"token":"<32 hex>","seat":1}` · `403` wrong code · `423` locked · `409` already joined this match |
| `GET /remote/view?after=N` | `Authorization: Bearer <token>` (this match's, or the previous match's until the next join) | `200 {"n":M,"view":{…}}`: the **next** view above `N` (`M = N+1` unless views were dropped), not the latest · after 10 s, `204` (empty) · `401` bad or missing token |
| `GET /remote/choices` | bearer | `200 {"n":K,"menu":[{"key","label","kind","useful"}…]}`; empty when it isn't seat 1's move or a tap is pending · `401` |
| `POST /remote/propose` | bearer, JSON `{"n":K,"i":idx}` (`idx` indexes the **full** menu as returned) | `202` (empty) · `409` stale or spent `K` · `400` bad index · `401` |

How the numbers and codes behave:
- **`n` counts views** from 1 for the life of the arena process. It does not reset per match: start with `after=0` and keep the last `n`.
- **`K` changes whenever the menu changes.** A successful propose spends the menu, so a double click answers `409`.
- **A token from a finished match answers `401` on choices and propose at once.** It can still read `/remote/view` until the next join, so the client can show the final board (`phase:"over"`, then the lobby with `last_over`). Join again with the new code.
- **Views include lobby frames** (`phase:"lobby"`, `seats:[]`). Joining works in the lobby, but the remote shrine claims only after the table's other shrine, so the match starts when both have claimed.
- **Responses are `application/json`**, except `204` and `202`, which are empty. POSTs send `Content-Type: application/json`, because axum's `Json` extractor refuses anything else with `415`.
- **The view carries `remote_code`** (a top-level string) while joining is open. Once someone has joined, or on a table with no remote seat, the key is **absent**, not `null`.
- **The code is also printed on stdout** as `remote join code: XXXXXX`.
- **The CLI deck argument is an exact stem under `decks/`:** `--remote ember-neutral` or `--remote tide-neutral`. The spec's `--remote ember` is shorthand. `tapstone_sim::deck::load_named` (deck.rs:175) loads `decks/<stem>.toml`.

## File structure

| File | Responsibility |
|---|---|
| `rust/tapstone-arena/src/link/desk.rs` | `DeskShrine::{with, choices}` and a `castle` field; `DeskLink::off`; `arena_bound` (shared frame filter) |
| `rust/tapstone-arena/src/link/mod.rs` | `pub mod remote`; `Link::remote()`; `impl Link for Box<T>` |
| `rust/tapstone-arena/src/link/remote.rs` (new) | `RemoteLink`, `RemoteSeat`, `GuestStats`, `MenuItem`: sans-IO, builds for wasm32 |
| `rust/tapstone-arena/src/decks.rs` | `DeckBook::push` |
| `rust/tapstone-arena/src/registry.rs` | `Registry::add_virtual` |
| `rust/tapstone-arena/src/ledger/apply.rs` | `apply_result_credit`; `apply_result` delegates to it |
| `rust/tapstone-arena/src/remote.rs` (new, `server`) | `Hub`, `RemoteState`, `RemoteCmd`, `remote_router` |
| `rust/tapstone-arena/src/view.rs` | `ViewModel::remote_code` (omitted when `None`) |
| `rust/tapstone-arena/web/app.js` | Shows the join code in the status line |
| `rust/tapstone-arena/src/main.rs` | `--remote`, `--remote-bind`; desk and gateway parts; the loop |
| `rust/tapstone-arena/tools/remote_smoke.py` (new) | End-to-end: a whole remote match over `/remote/*`, plus its stall control |
| `rust/tapstone-arena/tests/{desk_off,remote_link,remote_identity,remote_hub,remote_http,remote_view}.rs` (new) | The tests below |
| `rust/tapstone-arena/Cargo.toml` | `rand` optional, under `server` |
| `rust/README.md` | The remote seat: run, tunnel, gates |

---

### Task A1: desk groundwork (an off shrine, a castle per shrine, a shared menu and frame filter)

A refactor plus one new capability (`off`). The committed fixture guards the refactor.

**Files:**
- Modify: `rust/tapstone-arena/src/link/desk.rs`
- Create: `rust/tapstone-arena/tests/desk_off.rs`

- [ ] **Step 1: Write the failing test.** `rust/tapstone-arena/tests/desk_off.rs`:

```rust
//! An off desk shrine is unplugged: it neither claims nor hears (the remote seat's desk table runs
//! one desk shrine, the bot, and turns the other off; plan 2026-09-26 A1).
use tapstone_arena::link::desk::{DESK_NODES, DeskTable};

#[test]
fn an_off_shrine_neither_claims_nor_hears() {
    let mut table = DeskTable::new(11);
    table.link.off[1] = true;
    for step in 0..2_000u64 {
        table.step(step * 10);
    }
    assert_eq!(table.core.seated(), vec![DESK_NODES[0]], "only the live shrine claimed");
    assert_eq!(table.link.shrines[1].lseq, 0, "the off shrine sent nothing");
    assert!(
        table.link.shrines[1].follower.begun().is_none(),
        "the off shrine heard a match begin"
    );
}

/// The control: with both shrines on, the same 20 s seat both (so the test above sees `off`,
/// not a table too slow to seat anyone).
#[test]
fn with_both_shrines_on_both_are_seated() {
    let mut table = DeskTable::new(11);
    for step in 0..2_000u64 {
        table.step(step * 10);
    }
    assert_eq!(table.core.seated(), DESK_NODES.to_vec());
}
```

- [ ] **Step 2: Run it and see it fail.** On familiar, from `rust/`:

```sh
cargo test -p tapstone-arena --test desk_off
```
Expected: compile error `no field 'off' on type 'DeskLink'`.

- [ ] **Step 3: Implement.** In `rust/tapstone-arena/src/link/desk.rs`:

(a) In `pub struct DeskShrine`, replace the `deck_idx` field and its comment:

```rust
    /// Index into the decks: which physical deck this shrine's player holds.
    pub deck_idx: u8,
```
with:
```rust
    /// The castle design this shrine's player claims a seat with: `CASTLES[index]` for a desk
    /// shrine, the deck's own castle for the remote seat (0038).
    pub castle: u16,
```

(b) Replace `DeskShrine::new` with `new` plus `with`. The field list is the existing one, with `index`, `node`, `seat_ai` and `castle` taken from the arguments:

```rust
    /// Shrine `i`, holding its own `deck` only.
    pub fn new(seed: u64, i: usize, deck: &[u16]) -> DeskShrine {
        DeskShrine::with(seed, i, DESK_NODES[i], CASTLES[i], deck)
    }

    /// A desk-style shrine on any node. `index` names its figurine (`figurine()`) and its copies'
    /// UIDs (`copy_uid(index, k)`); the remote seat (0038) is index 2 on node 165.
    pub fn with(seed: u64, index: usize, node: u8, castle: u16, deck: &[u16]) -> DeskShrine {
        DeskShrine {
            index,
            seed,
            node,
            seat_ai: ScriptedSeat::new(seed, index as u8),
            follower: Follower::awaiting(),
            deck: deck.to_vec(),
            lseq: 0,
            pending: None,
            refused: 0,
            castle,
            drawn: HashSet::new(),
            pending_record: None,
            stale_rejects: 0,
            false_confirms: 0,
            rejoining: false,
            join: false,
            seen_head: None,
            join_sent: None,
            resume_from_resync: true,
            proposed: Vec::new(),
            caught_up_since: None,
            heard_result: false,
            claim_retry_ms: 100,
            begin: None,
            heard_unbegun: false,
            ask_begin: true,
            begin_asks: 0,
            rematch: false,
            lobby_after: None,
        }
    }
```

(c) In `act`'s claim record, replace `card: CASTLES[self.deck_idx as usize],` with `card: self.castle,`.

(d) Add after `DeskShrine::propose`:

```rust
    /// This shrine's legal moves now (tapstone-sim's menu: every choice trial-applied to the
    /// engine), or none when it is not its seat's move or a tap is still pending.
    pub fn choices(&self) -> Vec<Choice> {
        let Some(seat) = self.seat() else {
            return Vec::new();
        };
        let g = &self.follower.game;
        let owes = g.phase == Phase::Playing && g.seats[seat].owed_draws() > 0;
        let turn = g.phase == Phase::Playing && g.active == seat as u8;
        if self.pending.is_some() || !(owes || turn) {
            return Vec::new();
        }
        legal_choices(g, seat as u8)
    }
```

(e) Replace `DeskTable::choices`'s body so it is the shrine's:

```rust
    /// Shrine `i`'s legal moves now (`DeskShrine::choices`).
    pub fn choices(&self, i: usize) -> Vec<Choice> {
        self.link.shrines[i].choices()
    }
```

(f) Add a free function above `pub struct DeskLink`:

```rust
/// The frames a desk-style shrine sent that reach the arena, as the arena receives them.
/// Shrine-to-shrine traffic (a beacon addressed to another shrine) means nothing here.
pub(crate) fn arena_bound(src: u8, frames: Vec<(u8, Vec<u8>)>) -> impl Iterator<Item = Rx> {
    frames
        .into_iter()
        .filter(|(dst, _)| *dst == ARENA_NODE || *dst == BROADCAST)
        .map(move |(_, bytes)| Rx {
            src,
            rssi: -40,
            mac_ok: true,
            bytes,
        })
}
```

(g) `DeskLink` gets the `off` field. Its struct becomes:

```rust
pub struct DeskLink {
    pub shrines: [DeskShrine; 2],
    /// A manual shrine makes no play taps of its own (it still claims its seat and answers the
    /// arena): its person's taps arrive through `DeskTable::propose`.
    pub manual: [bool; 2],
    /// An off shrine is unplugged: it neither acts nor hears. The remote seat's desk table
    /// (0038) runs the bot on shrine 0 and turns shrine 1 off.
    pub off: [bool; 2],
    out: VecDeque<Rx>,
}
```

In `DeskLink::new`, add `off: [false; 2],` after `manual: [false; 2],`. Replace `queue`'s body with:

```rust
    fn queue(&mut self, src: u8, frames: Vec<(u8, Vec<u8>)>) {
        self.out.extend(arena_bound(src, frames));
    }
```

In `impl Link for DeskLink`, make the first statement inside **both** `for i in 0..2` loops (in `send` and in `poll`):

```rust
            if self.off[i] {
                continue;
            }
```

- [ ] **Step 4: Run all the arena tests**

```sh
cargo test -p tapstone-arena --test desk_off
cargo test -p tapstone-arena
cargo build -p tapstone-arena --lib --no-default-features --target wasm32-unknown-unknown
```
Expected:
- 2 passed in `desk_off`.
- The arena total is the baseline + 2, with `the_canvas_fixture_is_current` and all 3 `desk_table` tests passing.
- The wasm32 build succeeds.

- [ ] **Step 5: Perturb.** Temporarily delete the `if self.off[i] { continue; }` in `poll` only. Expected: `an_off_shrine_neither_claims_nor_hears` FAILS on `seated()`. Restore it.

- [ ] **Step 6: Commit**

```sh
git add rust/tapstone-arena/src/link/desk.rs rust/tapstone-arena/tests/desk_off.rs
git commit -m "refactor(arena): DeskShrine::with and a castle per shrine; DeskLink::off; a shared menu"
```

### Task A2: `RemoteLink`, a remote seat beside any link

**Files:**
- Create: `rust/tapstone-arena/src/link/remote.rs`
- Modify: `rust/tapstone-arena/src/link/mod.rs`
- Modify: `rust/tapstone-arena/src/decks.rs`
- Create: `rust/tapstone-arena/tests/remote_link.rs`

- [ ] **Step 1: Write the failing tests.** `rust/tapstone-arena/tests/remote_link.rs`:

```rust
//! The remote seat (0038): a manual desk-style shrine beside the table's link, claiming only once
//! someone has joined and only second (so it is seat 1), played through the engine's own menu.
use tapstone_arena::core::{ArenaCore, CoreConfig, Input, Output, Unsigned};
use tapstone_arena::link::Link;
use tapstone_arena::link::desk::{ARENA_NODE, DESK_NODES, DeskLink};
use tapstone_arena::link::remote::{REMOTE_NODE, RemoteLink};
use tapstone_arena::registry::Registry;
use tapstone_rules::{HouseRules, Kind};
use tapstone_sim::deck::load_named;

struct Table {
    link: RemoteLink<DeskLink>,
    core: ArenaCore,
    over: u32,
}

/// The Roblox side's test table: the desk bot on shrine 0, shrine 1 off, the remote seat holding
/// the repo's Ember deck.
fn table(seed: u64) -> Table {
    let (mut desk, mut book, stats) = DeskLink::new(seed);
    desk.off[1] = true;
    desk.shrines[0].rematch = true;
    let deck = load_named("ember-neutral", &HouseRules::default()).unwrap();
    book.push(deck.clone());
    let link = RemoteLink::new(desk, seed, &deck);
    let cfg = CoreConfig {
        node: ARENA_NODE,
        rules: Default::default(),
        ruleset: 1,
        registry_id: 0,
        flat: false,
        epoch_unix: 1_789_980_000,
    };
    let core = ArenaCore::new(cfg, Box::new(stats), book, Registry::Trusting, Box::new(Unsigned));
    Table { link, core, over: 0 }
}

impl Table {
    /// One 10 ms step, as the arena loop runs it: gate the remote seat, poll, handle, send.
    fn step(&mut self, now: u64, joined: bool) {
        let seated = self.core.seated();
        self.link.remote().unwrap().gate(joined, &seated);
        let mut inputs: Vec<Input> = self
            .link
            .poll(now)
            .into_iter()
            .map(|r| Input::Frame {
                src: r.src,
                rssi: r.rssi,
                mac_ok: r.mac_ok,
                bytes: r.bytes,
            })
            .collect();
        inputs.push(Input::Tick);
        for input in inputs {
            for o in self.core.handle(input, now) {
                match o {
                    Output::Send { dst, frame } => self.link.send(dst, &frame),
                    Output::MatchOver(_) => self.over += 1,
                    _ => {}
                }
            }
        }
    }
}

/// Plays the remote seat with the first useful non-mulligan choice, as the web gate does, until
/// a match ends. Returns (matches finished, taps made, the table).
fn play(seed: u64, person: bool, joined: bool, steps: u64) -> (u32, u32, Table) {
    let mut t = table(seed);
    let mut taps = 0;
    for step in 0..steps {
        let now = step * 10;
        t.step(now, joined);
        if t.over > 0 {
            break;
        }
        if !person {
            continue;
        }
        let g = t.link.shrine.follower.game;
        let pick = t
            .link
            .remote()
            .unwrap()
            .choices()
            .into_iter()
            .find(|c| c.tap.kind != Kind::Mulligan && c.is_useful(&g));
        if let Some(c) = pick {
            assert!(t.link.remote().unwrap().propose(now, c.tap), "a menu choice was not sent");
            taps += 1;
        }
    }
    (t.over, taps, t)
}

#[test]
fn a_remote_seat_finishes_a_match_against_a_desk_shrine() {
    let (over, taps, _) = play(11, true, true, 40_000);
    assert_eq!(over, 1, "the match never finished");
    assert!(taps >= 5, "the remote seat made only {taps} taps");
}

/// The control: joined but nobody choosing, the match stalls (the one above finishes because of
/// the remote player's taps, not because the shrine plays itself).
#[test]
fn a_remote_seat_left_alone_stalls() {
    let (over, taps, _) = play(11, false, true, 40_000);
    assert_eq!((over, taps), (0, 0));
}

#[test]
fn with_nobody_joined_the_remote_shrine_never_claims() {
    let (_, _, t) = play(11, false, false, 3_000);
    assert_eq!(t.core.seated(), vec![DESK_NODES[0]]);
}

#[test]
fn the_remote_seat_is_seat_one() {
    let (_, _, t) = play(11, false, true, 3_000);
    assert_eq!(t.core.seated(), vec![DESK_NODES[0], REMOTE_NODE]);
    assert_eq!(t.link.shrine.seat(), Some(1));
}
```

- [ ] **Step 2: Run them and see them fail**

```sh
cargo test -p tapstone-arena --test remote_link
```
Expected: compile errors, with no module `remote` in `link` and no method `push` on `DeckBook`.

- [ ] **Step 3: Implement.**

(a) `rust/tapstone-arena/src/decks.rs`: add inside `impl DeckBook`:

```rust
    /// Add a deck: the remote seat's, in desk mode, beside the two desk decks (0038).
    pub fn push(&mut self, deck: Deck) {
        self.decks.push(deck);
    }
```

(b) `rust/tapstone-arena/src/link/mod.rs`: replace the whole file with:

```rust
//! How MATCH frames reach the mesh: the USB-serial gateway (Task 22), desk mode (in process), and
//! the remote seat riding beside either (0038).
pub mod desk;
pub mod lines;
pub mod remote;
#[cfg(feature = "server")]
pub mod serial;

/// A frame received from the mesh.
#[derive(Debug, Clone)]
pub struct Rx {
    pub src: u8,
    pub rssi: i8,
    pub mac_ok: bool,
    pub bytes: Vec<u8>,
}

pub trait Link: Send {
    /// Send one frame to `dst` (255 = broadcast).
    fn send(&mut self, dst: u8, frame: &[u8]);
    /// Everything received since the last call, advancing the link's own clock to `now` ms.
    fn poll(&mut self, now: u64) -> Vec<Rx>;
    /// The remote seat riding on this link (0038), if it carries one: the arena loop's one way in,
    /// so the loop is the same with a remote seat and without.
    fn remote(&mut self) -> Option<&mut dyn remote::RemoteSeat> {
        None
    }
}

impl<T: Link + ?Sized> Link for Box<T> {
    fn send(&mut self, dst: u8, frame: &[u8]) {
        (**self).send(dst, frame)
    }
    fn poll(&mut self, now: u64) -> Vec<Rx> {
        (**self).poll(now)
    }
    fn remote(&mut self) -> Option<&mut dyn remote::RemoteSeat> {
        (**self).remote()
    }
}
```

(c) Create `rust/tapstone-arena/src/link/remote.rs`:

```rust
//! The remote seat (0038): one manual desk-style shrine inside the arena process, riding beside
//! the table's real link (the gateway's, or a one-shrine desk link for the test table). Sans-IO
//! like the rest of `link`; its HTTP face is `crate::remote` (server feature).
use std::collections::VecDeque;

use tapstone_proto::frame::{BROADCAST, Frame};
use tapstone_rules::Record;
use tapstone_sim::deck::Deck;
use tapstone_sim::human::Choice;

use super::desk::{DeskShrine, arena_bound, copy_uid};
use super::{Link, Rx};

/// The remote shrine's mesh node. Its frames never touch the radio; the number only has to differ
/// from every real shrine's and from the desk shrines' 163 and 164.
pub const REMOTE_NODE: u8 = 165;
/// Its index: its figurine is `[4, 0, 0, 0, 0, 0, 2]` and its copies are `copy_uid(2, k)`.
pub const REMOTE_INDEX: usize = 2;

/// What the arena loop needs from a link that carries a remote seat.
pub trait RemoteSeat {
    /// Let the remote shrine claim: only once someone has joined, and only as the second claim,
    /// so the remote seat is always seat 1 (spec §2).
    fn gate(&mut self, joined: bool, seated: &[u8]);
    /// The remote seat's legal moves now; empty off-turn or while a tap is pending.
    fn choices(&self) -> Vec<Choice>;
    /// Send a tap the remote player chose. False when the shrine did not send it.
    fn propose(&mut self, now: u64, tap: Record) -> bool;
    /// The remote shrine's figurine: the guest commander (spec §6).
    fn figurine(&self) -> [u8; 7];
}

pub struct RemoteLink<L: Link> {
    pub inner: L,
    pub shrine: DeskShrine,
    may_claim: bool,
    out: VecDeque<Rx>,
}

impl<L: Link> RemoteLink<L> {
    /// `inner` carries the table's other seat; the remote shrine holds `deck`'s list as virtual
    /// copies (draws are taps, 0036) and claims with `deck`'s castle.
    pub fn new(inner: L, seed: u64, deck: &Deck) -> RemoteLink<L> {
        let mut shrine =
            DeskShrine::with(seed, REMOTE_INDEX, REMOTE_NODE, deck.castle, &deck.cards);
        shrine.rematch = true; // every match gets a fresh join code (spec §2)
        RemoteLink {
            inner,
            shrine,
            may_claim: false,
            out: VecDeque::new(),
        }
    }

    /// Every UID the remote shrine can tap, with its design: the figurine (its castle) and one
    /// copy per list entry. A strict registry learns these (`Registry::add_virtual`).
    pub fn virtual_uids(&self) -> Vec<([u8; 7], u16)> {
        let mut v = vec![(self.shrine.figurine(), self.shrine.castle)];
        v.extend(
            self.shrine
                .deck
                .iter()
                .enumerate()
                .map(|(k, &d)| (copy_uid(REMOTE_INDEX, k), d)),
        );
        v
    }
}

impl<L: Link> Link for RemoteLink<L> {
    fn send(&mut self, dst: u8, frame: &[u8]) {
        if (dst == BROADCAST || dst == REMOTE_NODE)
            && let Some((h, f)) = Frame::decode(frame)
        {
            let replies = self.shrine.rx(&h, &f);
            self.out.extend(arena_bound(REMOTE_NODE, replies));
        }
        if dst != REMOTE_NODE {
            self.inner.send(dst, frame);
        }
    }

    fn poll(&mut self, now: u64) -> Vec<Rx> {
        let mut rx = self.inner.poll(now);
        let frames = self.shrine.act(now, self.may_claim, true);
        self.out.extend(arena_bound(REMOTE_NODE, frames));
        rx.extend(self.out.drain(..));
        rx
    }

    fn remote(&mut self) -> Option<&mut dyn RemoteSeat> {
        Some(self)
    }
}

impl<L: Link> RemoteSeat for RemoteLink<L> {
    fn gate(&mut self, joined: bool, seated: &[u8]) {
        self.may_claim = joined && seated.len() == 1 && seated[0] != REMOTE_NODE;
    }

    fn choices(&self) -> Vec<Choice> {
        self.shrine.choices()
    }

    fn propose(&mut self, now: u64, tap: Record) -> bool {
        let frames = self.shrine.propose(now, tap);
        let sent = !frames.is_empty();
        self.out.extend(arena_bound(REMOTE_NODE, frames));
        sent
    }

    fn figurine(&self) -> [u8; 7] {
        self.shrine.figurine()
    }
}
```

- [ ] **Step 4: Run the tests**

```sh
cargo test -p tapstone-arena --test remote_link
cargo test -p tapstone-arena
cargo build -p tapstone-arena --lib --no-default-features --target wasm32-unknown-unknown
cargo clippy -p tapstone-arena --all-targets -- -D warnings
```
Expected:
- 4 passed in `remote_link`.
- The arena total is A1's + 4, with the fixture green.
- The wasm32 build succeeds: `link::remote` must stay sans-IO.
- Clippy is clean.

If `a_remote_seat_finishes_a_match_against_a_desk_shrine` stalls, report it and don't raise the step count: seed 11 finishes in under 40,000 steps for `DeskTable` with a manual seat (#108).

- [ ] **Step 5: Perturb.** In `gate`, temporarily remove `joined &&`. Expected: `with_nobody_joined_the_remote_shrine_never_claims` FAILS (`seated()` holds 165). Restore it.

- [ ] **Step 6: Commit**

```sh
git add rust/tapstone-arena/src/link/remote.rs rust/tapstone-arena/src/link/mod.rs rust/tapstone-arena/src/decks.rs rust/tapstone-arena/tests/remote_link.rs
git commit -m "feat(arena): RemoteLink, a manual remote seat beside any link (0038)"
```

### Task A3: gateway identity, meaning virtual copies in a strict registry and a guest commander

**Files:**
- Modify: `rust/tapstone-arena/src/registry.rs`
- Modify: `rust/tapstone-arena/src/link/remote.rs` (`GuestStats`)
- Modify: `rust/tapstone-arena/src/ledger/apply.rs` (`apply_result_credit`)
- Create: `rust/tapstone-arena/tests/remote_identity.rs`

- [ ] **Step 1: Write the failing tests.** `rust/tapstone-arena/tests/remote_identity.rs`:

```rust
//! The remote seat at a real table (0038, spec §6): its virtual copies resolve in a strict
//! registry without shadowing a real one, and its commander is a guest the ledger never writes.
use tapstone_arena::core::StatsSource;
use tapstone_arena::ledger::{Ledger, LedgerEvent};
use tapstone_arena::link::remote::GuestStats;
use tapstone_arena::registry::Registry;
use tapstone_proto::frame::{MatchResult, result_reason};

const REAL: [u8; 7] = [0x04, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0x01];
const GUEST: [u8; 7] = [4, 0, 0, 0, 0, 0, 2];

fn ledger() -> (tempfile::TempDir, Ledger) {
    let dir = tempfile::tempdir().unwrap();
    let l = Ledger::open(&dir.path().join("ledger.sqlite")).unwrap();
    (dir, l)
}

#[test]
fn a_strict_registry_learns_virtual_copies_but_never_over_a_real_one() {
    let mut r =
        Registry::from_jsonl(r#"{"uid":"04:AA:BB:CC:DD:EE:01","design":"st1-003"}"#).unwrap();
    assert_eq!(r.resolve(GUEST), None);
    r.add_virtual(GUEST, 0).unwrap();
    assert_eq!(r.resolve(GUEST), Some(0));
    assert!(r.add_virtual(REAL, 5).is_err(), "a virtual copy shadowed a real one");
    assert_eq!(r.resolve(REAL), Some(3));
}

#[test]
fn a_trusting_registry_has_nothing_to_learn() {
    let mut r = Registry::Trusting;
    r.add_virtual(GUEST, 0).unwrap();
    assert_eq!(r.resolve_or(GUEST, 7), Some(7));
}

#[test]
fn the_guest_is_a_fresh_level_one_commander_and_is_never_written() {
    let (_d, l) = ledger();
    let mut s = GuestStats {
        inner: l,
        guest: GUEST,
    };
    assert_eq!(s.commander(GUEST, 0), Ok((1, [None; 3])));
    assert!(s.doll(GUEST, 1).is_none());
    assert!(s.inner.doll(GUEST, 1).is_none(), "the guest was written to the ledger");
    assert_eq!(s.commander(REAL, 0), Ok((1, [None; 3])));
    assert!(s.inner.doll(REAL, 0).is_some(), "a real figurine must still reach the ledger");
}

#[test]
fn a_result_credits_the_shrine_player_and_skips_the_guest() {
    let (_d, mut l) = ledger();
    l.commander(REAL, 0).unwrap(); // only the shrine player has a row, as with a guest seated
    let r = MatchResult::unsigned(40, 0, result_reason::LETHAL, [0; 8], [1; 32]);
    let ev = l
        .apply_result_credit(0xB1, &r, [REAL, GUEST], Some(0), 6, [true, false])
        .unwrap();
    assert!(ev.contains(&LedgerEvent::Xp { seat: 0, amount: 3 }));
    assert!(!ev.iter().any(|e| matches!(e, LedgerEvent::Xp { seat: 1, .. })));
    assert_eq!(l.doll(REAL, 0).unwrap().xp, 3);
}

/// The control: why the credit mask exists. Crediting both seats with a guest that has no row
/// fails, and main.rs would stop the arena on that error.
#[test]
fn crediting_a_guest_that_was_never_written_fails() {
    let (_d, mut l) = ledger();
    l.commander(REAL, 0).unwrap();
    let r = MatchResult::unsigned(40, 0, result_reason::LETHAL, [0; 8], [1; 32]);
    assert!(l.apply_result(0xB2, &r, [REAL, GUEST], Some(0), 6).is_err());
}
```

- [ ] **Step 2: Run them and see them fail**

```sh
cargo test -p tapstone-arena --test remote_identity
```
Expected: compile errors, with no method `add_virtual`, no struct `GuestStats` and no method `apply_result_credit`.

- [ ] **Step 3: Implement.**

(a) `rust/tapstone-arena/src/registry.rs`: add inside `impl Registry`, after `resolve_or`:

```rust
    /// Teach a strict registry a virtual copy (the remote seat's figurine and copies, 0038). It is
    /// refused if the UID already names a registered copy, so a virtual copy can never shadow a
    /// real one. A trusting registry believes every proposal already, so it has nothing to learn.
    /// In memory only: `copies.jsonl` is never written.
    pub fn add_virtual(&mut self, uid: [u8; 7], design: u16) -> Result<(), String> {
        match self {
            Registry::Strict(m) => {
                if m.contains_key(&uid) {
                    let hex: Vec<String> = uid.iter().map(|b| format!("{b:02X}")).collect();
                    return Err(format!("virtual uid {} is a registered copy", hex.join(":")));
                }
                m.insert(uid, design);
                Ok(())
            }
            Registry::Trusting => Ok(()),
        }
    }
```

(b) `rust/tapstone-arena/src/link/remote.rs`: add these imports at the top, beside the others:

```rust
use tapstone_progression::{Loadout, level_for_xp};
use tapstone_proto::frame::{Doll, Equip, arena_refusal};

use crate::core::StatsSource;
use crate::registry::Registry;
```

and append:

```rust
/// The ledger as the core sees it, with one guest (spec §6): the remote seat's figurine plays as
/// 0030's fresh commander (level 1, nothing worn) and is never written. Every other figurine goes
/// to `inner`.
pub struct GuestStats<S> {
    pub inner: S,
    pub guest: [u8; 7],
}

impl<S: StatsSource> StatsSource for GuestStats<S> {
    fn commander(&mut self, figurine: [u8; 7], castle: u16) -> Result<(u8, Loadout), u8> {
        if figurine == self.guest {
            return Ok((level_for_xp(0), [None; 3]));
        }
        self.inner.commander(figurine, castle)
    }

    fn doll(&mut self, figurine: [u8; 7], seat: u8) -> Option<Doll> {
        if figurine == self.guest {
            return None; // no station to show it on
        }
        self.inner.doll(figurine, seat)
    }

    fn equip(&mut self, figurine: [u8; 7], e: &Equip, registry: &Registry) -> Result<Doll, u8> {
        if figurine == self.guest {
            return Err(arena_refusal::BAD_LOADOUT);
        }
        self.inner.equip(figurine, e, registry)
    }
}
```

(c) `rust/tapstone-arena/src/ledger/apply.rs`:
- Rename `pub fn apply_result(` to `pub fn apply_result_credit(`.
- Add a last parameter `credit: [bool; 2],` after `round: u8,`.
- Make the first statement inside `for seat in 0..2u8 {`:

```rust
            // 0038: a guest (the remote seat) has no commander row and earns nothing.
            if !credit[seat as usize] {
                continue;
            }
```

Then add, directly above it in the same `impl`:

```rust
    /// `apply_result_credit` crediting both seats: every table of real shrines.
    pub fn apply_result(
        &mut self,
        match_id: u32,
        r: &MatchResult,
        figurines: [[u8; 7]; 2],
        winner: Option<u8>,
        round: u8,
    ) -> rusqlite::Result<Vec<LedgerEvent>> {
        self.apply_result_credit(match_id, r, figurines, winner, round, [true, true])
    }
```

and extend the doc comment on `apply_result_credit` with: "`credit[seat]` false skips that seat: no XP, no streak and no drop (a guest, 0038)."

- [ ] **Step 4: Run the tests**

```sh
cargo test -p tapstone-arena --test remote_identity
cargo test -p tapstone-arena --test ledger
cargo test -p tapstone-arena
cargo build -p tapstone-arena --lib --no-default-features --target wasm32-unknown-unknown
```
Expected:
- 5 passed in `remote_identity`.
- Every ledger test passes unchanged.
- The arena total is A2's + 5.
- The wasm32 build succeeds (`GuestStats` is generic, and `Ledger` is not in it).

- [ ] **Step 5: Perturb.** In `GuestStats::commander`, temporarily delete the guest branch so the guest goes to `inner`. Expected: `the_guest_is_a_fresh_level_one_commander_and_is_never_written` FAILS on "the guest was written to the ledger". Restore it.

- [ ] **Step 6: Commit, then push the group.** Before pushing, send the lead "pushing #N <sha>".

```sh
git add rust/tapstone-arena/src/registry.rs rust/tapstone-arena/src/link/remote.rs rust/tapstone-arena/src/ledger/apply.rs rust/tapstone-arena/tests/remote_identity.rs
git commit -m "feat(arena): virtual copies in a strict registry; a guest commander the ledger never writes"
```

### Task A4: the `Hub`, holding join codes, tokens, numbered views and the numbered menu

**Files:**
- Modify: `rust/tapstone-arena/Cargo.toml`
- Create: `rust/tapstone-arena/src/remote.rs`
- Modify: `rust/tapstone-arena/src/lib.rs`
- Modify: `rust/tapstone-arena/src/link/remote.rs` (`MenuItem`, `RemoteSeat::menu`)
- Create: `rust/tapstone-arena/tests/remote_hub.rs`

- [ ] **Step 1: Write the failing tests.** `rust/tapstone-arena/tests/remote_hub.rs`:

```rust
//! The remote seat's state (spec §2): join codes, the lock, match-scoped tokens, numbered views
//! and the numbered menu. Pure: no HTTP.
use rand::SeedableRng;
use rand::rngs::StdRng;
use tapstone_arena::link::remote::MenuItem;
use tapstone_arena::remote::{CODE_ALPHABET, Hub, JoinError, ProposeError, VIEWS_KEPT};
use tapstone_rules::{Kind, Record};

fn hub() -> Hub {
    Hub::new(StdRng::seed_from_u64(7))
}

/// A code guaranteed not to be the hub's.
fn wrong(h: &Hub) -> &'static str {
    if h.code() == "AAAAAA" { "BBBBBB" } else { "AAAAAA" }
}

fn item(key: &str) -> MenuItem {
    MenuItem {
        key: key.into(),
        label: key.into(),
        kind: "Pass".into(),
        useful: true,
    }
}

fn pass() -> Record {
    tapstone_sim::tap(1, Kind::Pass, 0, -1, 0, 0)
}

#[test]
fn a_code_is_six_unambiguous_characters() {
    let h = hub();
    assert_eq!(h.code().len(), 6);
    assert!(h.code().bytes().all(|b| CODE_ALPHABET.contains(&b)));
    for b in *b"0O1I" {
        assert!(!CODE_ALPHABET.contains(&b), "{} is ambiguous", b as char);
    }
}

#[test]
fn the_right_code_gives_one_token_and_a_second_join_is_refused() {
    let mut h = hub();
    let code = h.code().to_string();
    let token = h.join(&code).unwrap();
    assert_eq!(token.len(), 32);
    assert!(token.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
    assert!(h.joined());
    assert!(h.authorized(&token));
    assert!(!h.authorized(&"0".repeat(32)));
    assert_eq!(h.join(&code), Err(JoinError::Taken));
}

#[test]
fn a_wrong_code_is_refused() {
    let mut h = hub();
    let w = wrong(&h);
    assert_eq!(h.join(w), Err(JoinError::Wrong));
    assert!(!h.joined());
}

#[test]
fn ten_wrong_codes_lock_joining_until_the_next_match() {
    let mut h = hub();
    let code = h.code().to_string();
    let w = wrong(&h);
    for _ in 0..10 {
        assert_eq!(h.join(w), Err(JoinError::Wrong));
    }
    assert_eq!(h.join(&code), Err(JoinError::Locked), "the right code after ten wrong ones");
    h.new_match();
    let code = h.code().to_string();
    assert!(h.join(&code).is_ok(), "the lock lasts one match");
}

/// The control: nine wrong codes are not a lock.
#[test]
fn nine_wrong_codes_do_not_lock() {
    let mut h = hub();
    let code = h.code().to_string();
    let w = wrong(&h);
    for _ in 0..9 {
        assert_eq!(h.join(w), Err(JoinError::Wrong));
    }
    assert!(h.join(&code).is_ok());
}

#[test]
fn a_token_dies_with_its_match() {
    let mut h = hub();
    let code = h.code().to_string();
    let token = h.join(&code).unwrap();
    h.new_match();
    assert!(!h.authorized(&token), "a token from the previous match");
    assert!(!h.joined());
    assert!(h.may_view(&token), "the old token can still read the final board");
    let code = h.code().to_string();
    h.join(&code).unwrap();
    assert!(!h.may_view(&token), "the next join retires the old token entirely");
}

#[test]
fn views_are_numbered_without_gaps_or_repeats() {
    let mut h = hub();
    for i in 0..5 {
        assert_eq!(h.publish_view(&format!(r#"{{"i":{i}}}"#)), i + 1);
    }
    let (mut after, mut seen) = (0, Vec::new());
    while let Some((n, v)) = h.view_after(after) {
        seen.push((n, v.to_string()));
        after = n;
    }
    assert_eq!(seen.iter().map(|s| s.0).collect::<Vec<_>>(), vec![1, 2, 3, 4, 5]);
    assert_eq!(seen[2].1, r#"{"i":2}"#);
    assert!(h.view_after(5).is_none());
}

#[test]
fn a_poller_far_behind_gets_the_oldest_view_kept() {
    let mut h = hub();
    for i in 0..(VIEWS_KEPT as u64 + 88) {
        h.publish_view(&format!("{i}"));
    }
    assert_eq!(h.view_after(0).unwrap().0, 89);
}

#[test]
fn an_unchanged_menu_keeps_its_number() {
    let mut h = hub();
    h.set_menu(vec![item("p")], vec![pass()]);
    let n = h.menu().0;
    h.set_menu(vec![item("p")], vec![pass()]);
    assert_eq!(h.menu().0, n);
    h.set_menu(vec![item("q")], vec![pass()]);
    assert_eq!(h.menu().0, n + 1);
}

#[test]
fn a_stale_menu_is_refused_and_a_spent_one_cannot_replay() {
    let mut h = hub();
    h.set_menu(vec![item("p")], vec![pass()]);
    let n = h.menu().0;
    assert_eq!(h.take(n + 1, 0), Err(ProposeError::Stale));
    assert_eq!(h.take(n, 1), Err(ProposeError::BadIndex));
    assert_eq!(h.take(n, 0), Ok(pass()));
    assert_eq!(h.take(n, 0), Err(ProposeError::Stale), "a spent menu was taken twice");
    assert!(h.menu().1.is_empty());
}
```

- [ ] **Step 2: Run them and see them fail**

```sh
cargo test -p tapstone-arena --test remote_hub
```
Expected: compile errors, with no module `remote` in `tapstone_arena` and no struct `MenuItem`.

- [ ] **Step 3: Implement.**

(a) `rust/tapstone-arena/Cargo.toml`:
- In `[dependencies]`, add after the `clap` line:

```toml
rand = { version = "0.9", optional = true }
```

- In the `server` feature list, add `"dep:rand"` after `"dep:clap"`.

(b) `rust/tapstone-arena/src/lib.rs`: add after `pub mod registry;`:

```rust
#[cfg(feature = "server")]
pub mod remote;
```

(c) `rust/tapstone-arena/src/link/remote.rs`: add `use serde::Serialize;` to the imports. Add `fn menu` as the last method of `trait RemoteSeat`:

```rust
    /// The remote API's menu (spec §2): what `choices` offers, labelled, with the tap behind each
    /// item at the same index.
    fn menu(&self) -> (Vec<MenuItem>, Vec<Record>);
```

its implementation, as the last method of `impl<L: Link> RemoteSeat for RemoteLink<L>`:

```rust
    fn menu(&self) -> (Vec<MenuItem>, Vec<Record>) {
        let g = &self.shrine.follower.game;
        let choices = self.shrine.choices();
        let items = choices
            .iter()
            .map(|c| MenuItem {
                key: c.key.clone(),
                label: c.label.clone(),
                kind: format!("{:?}", c.tap.kind),
                useful: c.is_useful(g),
            })
            .collect();
        (items, choices.iter().map(|c| c.tap).collect())
    }
```

and the type, appended:

```rust
/// One remote menu item, as `/remote/choices` shows it (tapstone-web's shape).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MenuItem {
    pub key: String,
    pub label: String,
    pub kind: String,
    pub useful: bool,
}
```

(d) Create `rust/tapstone-arena/src/remote.rs`:

```rust
//! The remote seat's HTTP face (0038, spec §2): the `Hub` it serves from, and (Task A5) its own
//! listener's router, which carries `/remote/*` and nothing else.
use std::collections::VecDeque;
use std::sync::Arc;

use rand::rngs::StdRng;
use rand::{Rng, RngCore};
use tapstone_rules::Record;

use crate::link::remote::MenuItem;

/// Join-code characters: no 0/O and no 1/I (spec §2).
pub const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
pub const CODE_LEN: usize = 6;
/// Wrong codes before joining locks, until the next match (0038).
pub const MAX_WRONG: u32 = 10;
/// Views kept for pollers; one further behind gets the oldest kept, and its `n` shows the gap.
pub const VIEWS_KEPT: usize = 512;

#[derive(Debug, PartialEq, Eq)]
pub enum JoinError {
    /// 403
    Wrong,
    /// 423
    Locked,
    /// 409
    Taken,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ProposeError {
    /// 409: not the current menu number (stale, or already spent)
    Stale,
    /// 400
    BadIndex,
}

/// Everything the remote API reads and changes. The arena loop publishes views and menus into
/// it; the handlers read it and take from it. Behind one `Mutex`, so a join's check-and-count and
/// a propose's check-and-spend are each atomic (plan decision 3).
pub struct Hub {
    rng: StdRng,
    code: String,
    token: Option<String>,
    /// The previous match's token: it may still read views (the final board) until the next join.
    last_token: Option<String>,
    wrong: u32,
    views: VecDeque<(u64, Arc<str>)>,
    next_view: u64,
    menu_n: u64,
    menu: Vec<MenuItem>,
    taps: Vec<Record>,
}

impl Hub {
    /// `rng` is `StdRng::from_os_rng()` in the arena and a seeded one in tests.
    pub fn new(rng: StdRng) -> Hub {
        let mut h = Hub {
            rng,
            code: String::new(),
            token: None,
            last_token: None,
            wrong: 0,
            views: VecDeque::new(),
            next_view: 1,
            menu_n: 0,
            menu: Vec::new(),
            taps: Vec::new(),
        };
        h.new_match();
        h
    }

    pub fn code(&self) -> &str {
        &self.code
    }

    pub fn joined(&self) -> bool {
        self.token.is_some()
    }

    /// A match ended, or the table was reset: a fresh code and the lock lifted. The old token can no
    /// longer choose or propose; it may still read views until the next join.
    pub fn new_match(&mut self) {
        let a = CODE_ALPHABET;
        self.code = (0..CODE_LEN)
            .map(|_| a[self.rng.random_range(0..a.len())] as char)
            .collect();
        if let Some(t) = self.token.take() {
            self.last_token = Some(t);
        }
        self.wrong = 0;
    }

    /// Redeem the join code for this match's token.
    pub fn join(&mut self, code: &str) -> Result<String, JoinError> {
        if self.wrong >= MAX_WRONG {
            return Err(JoinError::Locked);
        }
        if !eq_ct(code.as_bytes(), self.code.as_bytes()) {
            self.wrong += 1;
            return Err(JoinError::Wrong);
        }
        if self.token.is_some() {
            return Err(JoinError::Taken);
        }
        let mut b = [0u8; 16];
        self.rng.fill_bytes(&mut b);
        let token: String = b.iter().map(|x| format!("{x:02x}")).collect();
        self.token = Some(token.clone());
        self.last_token = None;
        Ok(token)
    }

    /// `bearer` is this match's token (compared in constant time).
    pub fn authorized(&self, bearer: &str) -> bool {
        self.token
            .as_deref()
            .is_some_and(|t| eq_ct(t.as_bytes(), bearer.as_bytes()))
    }

    /// `bearer` may read views: this match's token, or the previous match's until the next join.
    pub fn may_view(&self, bearer: &str) -> bool {
        self.authorized(bearer)
            || self
                .last_token
                .as_deref()
                .is_some_and(|t| eq_ct(t.as_bytes(), bearer.as_bytes()))
    }

    /// Number and keep one view the core published. Returns its number.
    pub fn publish_view(&mut self, json: &str) -> u64 {
        let n = self.next_view;
        self.next_view += 1;
        self.views.push_back((n, json.into()));
        while self.views.len() > VIEWS_KEPT {
            self.views.pop_front();
        }
        n
    }

    /// The first kept view numbered above `after`.
    pub fn view_after(&self, after: u64) -> Option<(u64, Arc<str>)> {
        self.views.iter().find(|(n, _)| *n > after).cloned()
    }

    /// The loop's menu for the remote seat. A new number only when it changed.
    pub fn set_menu(&mut self, menu: Vec<MenuItem>, taps: Vec<Record>) {
        if menu != self.menu {
            self.menu_n += 1;
            self.menu = menu;
            self.taps = taps;
        }
    }

    pub fn menu(&self) -> (u64, &[MenuItem]) {
        (self.menu_n, &self.menu)
    }

    /// Take item `i` of menu number `n` to propose. It spends the menu, so it can't be taken twice.
    pub fn take(&mut self, n: u64, i: usize) -> Result<Record, ProposeError> {
        if n != self.menu_n {
            return Err(ProposeError::Stale);
        }
        let Some(tap) = self.taps.get(i).copied() else {
            return Err(ProposeError::BadIndex);
        };
        self.menu_n += 1;
        self.menu.clear();
        self.taps.clear();
        Ok(tap)
    }
}

/// Constant-time equality, for codes and tokens that arrive from anywhere through the tunnel.
fn eq_ct(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
```

- [ ] **Step 4: Run the tests**

```sh
cargo test -p tapstone-arena --test remote_hub
cargo test -p tapstone-arena
cargo build -p tapstone-arena --lib --no-default-features --target wasm32-unknown-unknown
cargo clippy -p tapstone-arena --all-targets -- -D warnings
cargo clippy -p tapstone-arena --lib --no-default-features -- -D warnings
```
Expected:
- 10 passed in `remote_hub`.
- The arena total is A3's + 10.
- The wasm32 build succeeds (`remote.rs` and rand are server-only).
- Both clippy runs are clean.

- [ ] **Step 5: Perturb.** In `Hub::join`, temporarily delete `self.wrong += 1;`. Expected: `ten_wrong_codes_lock_joining_until_the_next_match` FAILS, and its control `nine_wrong_codes_do_not_lock` still passes. Restore it.

- [ ] **Step 6: Commit**

```sh
git add rust/tapstone-arena/Cargo.toml rust/Cargo.lock rust/tapstone-arena/src/lib.rs rust/tapstone-arena/src/remote.rs rust/tapstone-arena/src/link/remote.rs rust/tapstone-arena/tests/remote_hub.rs
git commit -m "feat(arena): the remote Hub: join codes and lock, match tokens, numbered views and menus"
```

### Task A5: the remote router (`/remote/*` only, with a long-poll)

**Files:**
- Modify: `rust/tapstone-arena/src/remote.rs`
- Create: `rust/tapstone-arena/tests/remote_http.rs`

- [ ] **Step 1: Write the failing tests.** `rust/tapstone-arena/tests/remote_http.rs`:

```rust
//! The remote listener (spec §2): the four routes, their answers, the long-poll, and nothing
//! else. `/dev/*`, `/events` and the board must be unreachable here (0038).
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rand::SeedableRng;
use rand::rngs::StdRng;
use tapstone_arena::link::remote::MenuItem;
use tapstone_arena::remote::{Hub, RemoteCmd, RemoteState, remote_router};
use tapstone_rules::Kind;
use tokio::sync::{Notify, mpsc};

struct Served {
    addr: SocketAddr,
    hub: Arc<Mutex<Hub>>,
    notify: Arc<Notify>,
    cmds: mpsc::Receiver<RemoteCmd>,
}

async fn serve(wait_ms: u64) -> Served {
    let hub = Arc::new(Mutex::new(Hub::new(StdRng::seed_from_u64(3))));
    let notify = Arc::new(Notify::new());
    let (tx, cmds) = mpsc::channel(8);
    let app = remote_router(RemoteState {
        hub: hub.clone(),
        views: notify.clone(),
        cmds: tx,
        wait: Duration::from_millis(wait_ms),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Served { addr, hub, notify, cmds }
}

/// One blocking request: (status, body).
fn call(addr: SocketAddr, method: &str, path: &str, token: Option<&str>, body: Option<&str>) -> (u16, String) {
    let mut req = ureq::request(method, &format!("http://{addr}{path}"));
    if let Some(t) = token {
        req = req.set("Authorization", &format!("Bearer {t}"));
    }
    let r = match body {
        Some(b) => req.set("Content-Type", "application/json").send_string(b),
        None => req.call(),
    };
    match r {
        Ok(resp) => (resp.status(), resp.into_string().unwrap_or_default()),
        Err(ureq::Error::Status(code, resp)) => (code, resp.into_string().unwrap_or_default()),
        Err(e) => panic!("{e}"),
    }
}

async fn blocking<F: FnOnce() -> (u16, String) + Send + 'static>(f: F) -> (u16, String) {
    tokio::task::spawn_blocking(f).await.unwrap()
}

async fn join(s: &Served) -> String {
    let (addr, code) = (s.addr, s.hub.lock().unwrap().code().to_string());
    let (st, body) = blocking(move || {
        call(addr, "POST", "/remote/join", None, Some(&format!(r#"{{"code":"{code}"}}"#)))
    })
    .await;
    assert_eq!(st, 200, "{body}");
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["seat"], 1);
    v["token"].as_str().unwrap().to_string()
}

#[tokio::test(flavor = "multi_thread")]
async fn join_then_view_then_choices_then_propose() {
    let mut s = serve(300).await;
    let token = join(&s).await;
    s.hub.lock().unwrap().publish_view(r#"{"phase":"lobby"}"#);
    let (addr, t) = (s.addr, token.clone());
    let (st, body) = blocking(move || call(addr, "GET", "/remote/view?after=0", Some(&t), None)).await;
    assert_eq!((st, body.as_str()), (200, r#"{"n":1,"view":{"phase":"lobby"}}"#));

    let pass = tapstone_sim::tap(1, Kind::Pass, 0, -1, 0, 0);
    let item = MenuItem { key: "p".into(), label: "Pass".into(), kind: "Pass".into(), useful: true };
    s.hub.lock().unwrap().set_menu(vec![item], vec![pass]);
    let t = token.clone();
    let (st, body) = blocking(move || call(addr, "GET", "/remote/choices", Some(&t), None)).await;
    assert_eq!(st, 200);
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    let n = v["n"].as_u64().unwrap();
    assert_eq!(v["menu"][0]["label"], "Pass");

    let t = token.clone();
    let (st, _) = blocking(move || call(addr, "POST", "/remote/propose", Some(&t), Some(&format!(r#"{{"n":{n},"i":0}}"#)))).await;
    assert_eq!(st, 202);
    match s.cmds.try_recv() {
        Ok(RemoteCmd::Propose(r)) => assert_eq!(r, pass),
        other => panic!("the loop got {other:?}"),
    }
    let t = token.clone();
    let (st, _) = blocking(move || call(addr, "POST", "/remote/propose", Some(&t), Some(&format!(r#"{{"n":{n},"i":0}}"#)))).await;
    assert_eq!(st, 409, "a spent menu was proposed twice");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_bad_index_is_400() {
    let s = serve(300).await;
    let token = join(&s).await;
    let pass = tapstone_sim::tap(1, Kind::Pass, 0, -1, 0, 0);
    let item = MenuItem { key: "p".into(), label: "Pass".into(), kind: "Pass".into(), useful: true };
    s.hub.lock().unwrap().set_menu(vec![item], vec![pass]);
    let n = s.hub.lock().unwrap().menu().0;
    let addr = s.addr;
    let (st, _) = blocking(move || call(addr, "POST", "/remote/propose", Some(&token), Some(&format!(r#"{{"n":{n},"i":5}}"#)))).await;
    assert_eq!(st, 400);
}

#[tokio::test(flavor = "multi_thread")]
async fn join_answers_403_then_423_and_409() {
    let s = serve(300).await;
    let addr = s.addr;
    let code = s.hub.lock().unwrap().code().to_string();
    let wrong = if code == "AAAAAA" { "BBBBBB" } else { "AAAAAA" };
    for _ in 0..10 {
        let (st, _) = blocking(move || call(addr, "POST", "/remote/join", None, Some(&format!(r#"{{"code":"{wrong}"}}"#)))).await;
        assert_eq!(st, 403);
    }
    let c = code.clone();
    let (st, _) = blocking(move || call(addr, "POST", "/remote/join", None, Some(&format!(r#"{{"code":"{c}"}}"#)))).await;
    assert_eq!(st, 423);
    s.hub.lock().unwrap().new_match();
    join(&s).await;
    let code = s.hub.lock().unwrap().code().to_string();
    let (st, _) = blocking(move || call(addr, "POST", "/remote/join", None, Some(&format!(r#"{{"code":"{code}"}}"#)))).await;
    assert_eq!(st, 409);
}

#[tokio::test(flavor = "multi_thread")]
async fn no_token_or_an_old_token_is_401() {
    let s = serve(300).await;
    let addr = s.addr;
    for (m, p) in [("GET", "/remote/view?after=0"), ("GET", "/remote/choices")] {
        let (st, _) = blocking(move || call(addr, m, p, None, None)).await;
        assert_eq!(st, 401, "{m} {p}");
    }
    let (st, _) = blocking(move || call(addr, "POST", "/remote/propose", None, Some(r#"{"n":1,"i":0}"#))).await;
    assert_eq!(st, 401);
    let token = join(&s).await;
    s.hub.lock().unwrap().publish_view(r#"{"phase":"over"}"#);
    s.hub.lock().unwrap().new_match();
    let t = token.clone();
    let (st, _) = blocking(move || call(addr, "GET", "/remote/choices", Some(&t), None)).await;
    assert_eq!(st, 401, "a token from the previous match");
    let (st, body) = blocking(move || call(addr, "GET", "/remote/view?after=0", Some(&token), None)).await;
    assert_eq!((st, body.as_str()), (200, r#"{"n":1,"view":{"phase":"over"}}"#), "the final board");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_view_long_poll_waits_then_204_and_wakes_on_a_view() {
    let s = serve(400).await;
    let token = join(&s).await;
    let (addr, t) = (s.addr, token.clone());
    let started = std::time::Instant::now();
    let (st, _) = blocking(move || call(addr, "GET", "/remote/view?after=0", Some(&t), None)).await;
    assert_eq!(st, 204);
    assert!(started.elapsed() >= Duration::from_millis(350), "it did not wait");

    let (hub, notify) = (s.hub.clone(), s.notify.clone());
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        hub.lock().unwrap().publish_view(r#"{"phase":"playing"}"#);
        notify.notify_waiters();
    });
    let (st, body) = blocking(move || call(addr, "GET", "/remote/view?after=0", Some(&token), None)).await;
    assert_eq!((st, body.as_str()), (200, r#"{"n":1,"view":{"phase":"playing"}}"#));
}

#[tokio::test(flavor = "multi_thread")]
async fn nothing_but_remote_routes_on_the_remote_listener() {
    let s = serve(300).await;
    let addr = s.addr;
    for (m, p) in [("POST", "/dev/tap"), ("POST", "/dev/desk"), ("GET", "/events"), ("GET", "/"), ("GET", "/api/version")] {
        let body = (m == "POST").then_some("{}");
        let (st, _) = blocking(move || call(addr, m, p, None, body)).await;
        assert_eq!(st, 404, "{m} {p} is reachable through the tunnel");
    }
}
```

- [ ] **Step 2: Run them and see them fail**

```sh
cargo test -p tapstone-arena --test remote_http
```
Expected: compile errors, with no `RemoteCmd`, `RemoteState` or `remote_router` in `tapstone_arena::remote`.

- [ ] **Step 3: Implement.** Append to `rust/tapstone-arena/src/remote.rs`, and extend its imports with:

```rust
use std::sync::Mutex;
use std::time::Duration;

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use tokio::sync::{Notify, mpsc};
```

```rust
/// A proposal on its way to the arena loop, which alone owns the link (plan decision 3).
#[derive(Debug, PartialEq)]
pub enum RemoteCmd {
    Propose(Record),
}

#[derive(Clone)]
pub struct RemoteState {
    pub hub: Arc<Mutex<Hub>>,
    /// Woken by the loop after each view it publishes (`notify_waiters`).
    pub views: Arc<Notify>,
    pub cmds: mpsc::Sender<RemoteCmd>,
    /// How long `/remote/view` waits for a view before `204` (10 s; tests shorten it).
    pub wait: Duration,
}

/// The remote listener's router: these four routes and no others (0038). It never shares a port
/// with `http::router`, whose `/dev/*` trusts loopback peers, and a tunnel's peers are loopback.
pub fn remote_router(s: RemoteState) -> Router {
    Router::new()
        .route("/remote/join", post(join))
        .route("/remote/view", get(view))
        .route("/remote/choices", get(choices))
        .route("/remote/propose", post(propose))
        .with_state(s)
}

#[derive(Deserialize)]
struct JoinBody {
    code: String,
}

async fn join(State(s): State<RemoteState>, Json(b): Json<JoinBody>) -> Response {
    let r = s.hub.lock().unwrap().join(&b.code);
    match r {
        Ok(token) => Json(serde_json::json!({ "token": token, "seat": 1 })).into_response(),
        Err(JoinError::Wrong) => StatusCode::FORBIDDEN.into_response(),
        Err(JoinError::Locked) => StatusCode::LOCKED.into_response(),
        Err(JoinError::Taken) => StatusCode::CONFLICT.into_response(),
    }
}

fn bearer(h: &HeaderMap) -> Option<&str> {
    h.get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

/// This match's token: choices and propose.
fn authed(s: &RemoteState, h: &HeaderMap) -> bool {
    bearer(h).is_some_and(|t| s.hub.lock().unwrap().authorized(t))
}

#[derive(Deserialize)]
struct After {
    #[serde(default)]
    after: u64,
}

async fn view(State(s): State<RemoteState>, headers: HeaderMap, Query(q): Query<After>) -> Response {
    // Views also accept the previous match's token until the next join, so the final board shows.
    if !bearer(&headers).is_some_and(|t| s.hub.lock().unwrap().may_view(t)) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let deadline = tokio::time::Instant::now() + s.wait;
    loop {
        // Register for the wake-up BEFORE looking, so a view published in between is not missed.
        let notified = s.views.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        let hit = s.hub.lock().unwrap().view_after(q.after);
        if let Some((n, v)) = hit {
            let body = format!(r#"{{"n":{n},"view":{v}}}"#);
            return ([(header::CONTENT_TYPE, "application/json")], body).into_response();
        }
        if tokio::time::timeout_at(deadline, notified).await.is_err() {
            return StatusCode::NO_CONTENT.into_response();
        }
    }
}

async fn choices(State(s): State<RemoteState>, headers: HeaderMap) -> Response {
    if !authed(&s, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let body = {
        let hub = s.hub.lock().unwrap();
        let (n, menu) = hub.menu();
        serde_json::json!({ "n": n, "menu": menu })
    };
    Json(body).into_response()
}

#[derive(Deserialize)]
struct ProposeBody {
    n: u64,
    i: usize,
}

async fn propose(State(s): State<RemoteState>, headers: HeaderMap, Json(b): Json<ProposeBody>) -> Response {
    if !authed(&s, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let taken = s.hub.lock().unwrap().take(b.n, b.i);
    match taken {
        Ok(tap) => match s.cmds.send(RemoteCmd::Propose(tap)).await {
            Ok(()) => StatusCode::ACCEPTED.into_response(),
            Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
        },
        Err(ProposeError::Stale) => StatusCode::CONFLICT.into_response(),
        Err(ProposeError::BadIndex) => StatusCode::BAD_REQUEST.into_response(),
    }
}
```

- [ ] **Step 4: Run the tests**

```sh
cargo test -p tapstone-arena --test remote_http
cargo test -p tapstone-arena
cargo clippy -p tapstone-arena --all-targets -- -D warnings
cargo fmt --check
```
Expected:
- 6 passed in `remote_http`.
- The arena total is A4's + 6.
- Clippy and fmt are clean. Run `cargo fmt` first if fmt reflows the tests; that is formatting only, so note it as a deviation in the PR.

- [ ] **Step 5: Perturb.** Temporarily add `.route("/", get(|| async { "board" }))` to `remote_router`. Expected: `nothing_but_remote_routes_on_the_remote_listener` FAILS with "GET / is reachable through the tunnel". Restore it.

- [ ] **Step 6: Commit**

```sh
git add rust/tapstone-arena/src/remote.rs rust/tapstone-arena/tests/remote_http.rs
git commit -m "feat(arena): the remote router, /remote/* only, with a view long-poll"
```

### Task A6: the join code in the view, and on the board

**Files:**
- Modify: `rust/tapstone-arena/src/view.rs`
- Modify: `rust/tapstone-arena/web/app.js`
- Create: `rust/tapstone-arena/tests/remote_view.rs`

- [ ] **Step 1: Write the failing test.** `rust/tapstone-arena/tests/remote_view.rs`:

```rust
//! The join code rides in the view while joining is open (spec §2), and is absent otherwise, so a
//! table without a remote seat serialises exactly as before (the desk fixture guards that).
use tapstone_arena::view::ViewModel;

#[test]
fn the_join_code_rides_in_the_view_only_when_there_is_one() {
    let mut v = ViewModel::default();
    assert!(!serde_json::to_string(&v).unwrap().contains("remote_code"));
    v.remote_code = Some("K7Q2MX".into());
    assert!(serde_json::to_string(&v).unwrap().contains(r#""remote_code":"K7Q2MX""#));
}
```

- [ ] **Step 2: Run it and see it fail**

```sh
cargo test -p tapstone-arena --test remote_view
```
Expected: compile error, no field `remote_code` on `ViewModel`.

- [ ] **Step 3: Implement.**

(a) `rust/tapstone-arena/src/view.rs`: add as the last field of `pub struct ViewModel`:

```rust
    /// The remote seat's join code while joining is open (0038). The arena binary fills it in;
    /// the core never does. Absent when `None`, so a table without a remote seat serialises as
    /// it always has (`the_canvas_fixture_is_current`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_code: Option<String>,
```

and add `remote_code: None,` after `last_over: None,` in `ViewModel::of_match`'s struct literal. `of_lobby` uses `..ViewModel::default()` and needs nothing.

(b) `rust/tapstone-arena/web/app.js`:
- Add after `const KEYWORD_CODE = …;`:

```js
// The remote seat's join code (0038), while joining is open: shown so the table can read it out.
const codeTag = (v) => (v && v.remote_code ? ` · remote join code ${v.remote_code}` : "");
```

- In `draw()`, change the lobby lines from:

```js
    if (shown) { const v = view; view = shown; draw(); view = v; return; }
```
```js
    statusEl.textContent = replayTag + "lobby";
```
to:
```js
    if (shown) { const v = view; view = shown; draw(); view = v; statusEl.textContent += codeTag(v); return; }
```
```js
    statusEl.textContent = replayTag + "lobby" + codeTag(view);
```

- Change the final status line from:

```js
    (view.head ? ` · ${view.head}` : "");
```
to:
```js
    (view.head ? ` · ${view.head}` : "") + codeTag(view);
```

- [ ] **Step 4: Run the tests**

```sh
cargo test -p tapstone-arena --test remote_view
cargo test -p tapstone-arena --test fixture
cargo test -p tapstone-arena
cargo build -p tapstone-arena --lib --no-default-features --target wasm32-unknown-unknown
```
Expected:
- 1 passed in `remote_view`.
- The fixture test is green **without regeneration**.
- The arena total is A5's + 1.
- The wasm32 build succeeds.

- [ ] **Step 5: Perturb.** Temporarily delete the `#[serde(skip_serializing_if = "Option::is_none")]` line. Expected: `the_canvas_fixture_is_current` FAILS, because every line would gain `"remote_code":null`. Restore it.

- [ ] **Step 6: Commit, then push the group.** Before pushing, send the lead "pushing #N <sha>".

```sh
git add rust/tapstone-arena/src/view.rs rust/tapstone-arena/web/app.js rust/tapstone-arena/tests/remote_view.rs
git commit -m "feat(arena): the remote join code in the view (absent without a remote seat) and on the board"
```

### Task A7: the CLI and the loop

**Files:**
- Modify: `rust/tapstone-arena/src/main.rs`
- Create: `rust/tapstone-arena/tools/remote_smoke.py`

- [ ] **Step 1: Write the end-to-end check first.** `rust/tapstone-arena/tools/remote_smoke.py`:

```python
#!/usr/bin/env python3
"""End-to-end check of the remote seat (plan 2026-09-26, Task A7).

Starts `tapstone-arena --desk --remote ember-neutral --once`, joins with the code it prints, and
plays the remote seat through /remote/* only. Each time, it proposes the first useful
non-mulligan item, as the web gate does. It passes when the arena exits 0 after the match (--once)
and the remote seat made at least 5 taps.

--no-propose is the control: the same run with no proposals must stall, and the script then
exits 1 at its deadline.

usage: remote_smoke.py <path/to/tapstone-arena> [--no-propose]
"""
import json
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

ARENA = sys.argv[1]
NO_PROPOSE = "--no-propose" in sys.argv
BIND = "127.0.0.1:17791"
BASE = f"http://{BIND}"
DEADLINE = time.time() + (30 if NO_PROPOSE else 180)

proc = subprocess.Popen(
    [ARENA, "--desk", "--remote", "ember-neutral", "--remote-bind", BIND, "--once"],
    stdout=subprocess.PIPE, text=True,
)
code, winner = None, None
got_code = threading.Event()


def drain():
    """Read the arena's stdout to the end, so it never blocks on a full pipe."""
    global code, winner
    for line in proc.stdout:
        if line.startswith("remote join code:") and code is None:
            code = line.split(":", 1)[1].strip()
            got_code.set()
        if " over, winner " in line:
            winner = line.strip()


threading.Thread(target=drain, daemon=True).start()
if not got_code.wait(30):
    proc.kill()
    sys.exit("no join code printed")


def call(method, path, token=None, body=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


status, body = call("POST", "/remote/join", body={"code": code})
if status != 200:
    proc.kill()
    sys.exit(f"join: {status} {body}")
token = json.loads(body)["token"]
after, taps = 0, 0
while proc.poll() is None and time.time() < DEADLINE:
    status, body = call("GET", f"/remote/view?after={after}", token)
    if status == 200:
        after = json.loads(body)["n"]
    elif status == 401:
        break  # a newer join retired this token
    if NO_PROPOSE:
        continue
    status, body = call("GET", "/remote/choices", token)
    if status != 200:
        continue
    menu = json.loads(body)
    pick = next((i for i, c in enumerate(menu["menu"]) if c["useful"] and c["kind"] != "Mulligan"), None)
    if pick is not None and call("POST", "/remote/propose", token, {"n": menu["n"], "i": pick})[0] == 202:
        taps += 1

try:
    rc = proc.wait(timeout=max(1, DEADLINE - time.time()))
except subprocess.TimeoutExpired:
    proc.kill()
    print(f"STALLED after {taps} remote taps (the arena never finished the match)")
    sys.exit(1)
print(f"arena exit {rc}, {taps} remote taps, {winner}")
sys.exit(0 if rc == 0 and taps >= 5 else 1)
```

- [ ] **Step 2: Run it and see it fail.** On familiar, from `rust/`:

```sh
cargo build -p tapstone-arena --bin tapstone-arena
python3 tapstone-arena/tools/remote_smoke.py "$CARGO_TARGET_DIR/debug/tapstone-arena"; echo "exit $?"
```
Expected: `error: unexpected argument '--remote'` from clap, then `no join code printed` and a non-zero exit.

- [ ] **Step 3: Implement.** In `rust/tapstone-arena/src/main.rs`:

(a) Add these imports after the existing `use` block:

```rust
use std::sync::{Arc, Mutex};

use rand::SeedableRng;
use rand::rngs::StdRng;
use tapstone_arena::link::remote::{GuestStats, RemoteLink};
use tapstone_arena::remote::{Hub, RemoteCmd, RemoteState, remote_router};
use tapstone_rules::HouseRules;
use tapstone_sim::deck::{Deck, load_named};
use tokio::sync::Notify;
```

(b) Add to `struct Cli`:

```rust
    /// A remote seat (0038) holding this deck: an exact stem under `decks/`, e.g. `ember-neutral`.
    #[arg(long)]
    remote: Option<String>,
    /// The remote seat's own listener, `/remote/*` only: the one port a tunnel may expose.
    #[arg(long, default_value = "127.0.0.1:7791")]
    remote_bind: String,
```

(c) Add to `struct Parts`:

```rust
    /// The remote seat's figurine, the guest the ledger never credits (spec §6).
    remote_figurine: Option<[u8; 7]>,
```

(d) Replace `fn desk_parts(seed: u64) -> Parts` with:

```rust
fn desk_parts(seed: u64, remote: Option<&Deck>) -> Parts {
    let (mut desk, mut book, stats) = DeskLink::new(seed);
    let mut link: Box<dyn Link> = match remote {
        Some(deck) => {
            // The Roblox side's test table: the desk bot on shrine 0, the remote seat in the
            // second chair, and a fresh match after each result for the next join.
            desk.off[1] = true;
            desk.shrines[0].rematch = true;
            book.push(deck.clone());
            Box::new(RemoteLink::new(desk, seed, deck))
        }
        None => Box::new(desk),
    };
    let remote_figurine = link.remote().map(|r| r.figurine());
    let cfg = CoreConfig {
        node: ARENA_NODE,
        rules: Default::default(),
        ruleset: 1,
        registry_id: 0,
        flat: false,
        epoch_unix: unix() as u32,
    };
    let core = ArenaCore::new(
        cfg,
        Box::new(stats),
        book,
        Registry::Trusting,
        Box::new(Unsigned),
    );
    Parts {
        link,
        core,
        ledger: None,
        bind: "127.0.0.1:7790".into(),
        sinks: vec![],
        pending: vec![],
        remote_figurine,
    }
}
```

(e) In `gateway_parts`:
- Change its signature to `fn gateway_parts(path: PathBuf, remote: Option<&Deck>) -> Result<Parts, String>`.
- Rename the local `link` from `SerialLink::discover` to `serial`, in the `discover` line and the `hello` line.
- Make the registry mutable: `let mut registry = Registry::load(&registry_path)?;`.
- Replace the block from `let stats: Box<dyn StatsSource + Send> =` through its `Ledger::open(...)` line with:

```rust
    let mut link: Box<dyn Link> = match remote {
        Some(deck) => {
            let r = RemoteLink::new(serial, 0, deck);
            // A strict registry resolves every claim and card (lobby.rs, play.rs): teach it the
            // remote seat's virtual copies, refusing any UID that names a real one.
            for (uid, design) in r.virtual_uids() {
                registry.add_virtual(uid, design)?;
            }
            Box::new(r)
        }
        None => Box::new(serial),
    };
    let remote_figurine = link.remote().map(|r| r.figurine());
    // Two connections to one WAL file: the core's StatsSource reads and equips; the loop journals
    // and applies results. busy_timeout=5000 covers their overlap. A remote seat's figurine is a
    // guest the ledger never writes (spec §6).
    let ledger_stats = Ledger::open(&ledger_path).map_err(|e| e.to_string())?;
    let stats: Box<dyn StatsSource + Send> = match remote_figurine {
        Some(guest) => Box::new(GuestStats {
            inner: ledger_stats,
            guest,
        }),
        None => Box::new(ledger_stats),
    };
```

- In its `Ok(Parts { … })`, replace `link: Box::new(link),` with `link,` and add `remote_figurine,`.

(f) In `main`, replace the `let mut parts = if cli.desk { … };` statement with:

```rust
    let remote_deck = match &cli.remote {
        Some(stem) => Some(load_named(stem, &HouseRules::default()).map_err(|e| e.to_string())?),
        None => None,
    };
    let mut parts = if cli.desk {
        desk_parts(cli.desk_seed, remote_deck.as_ref())
    } else {
        gateway_parts(cli.config.unwrap_or_else(default_path), remote_deck.as_ref())?
    };
```

Then, after the board listener's `tokio::spawn(…)` block:

```rust
    // The remote seat's listener (0038): its own port, /remote/* only, never the board's.
    let hub = Arc::new(Mutex::new(Hub::new(StdRng::from_os_rng())));
    let notify = Arc::new(Notify::new());
    let (remote_tx, mut remote_rx) = mpsc::channel::<RemoteCmd>(16);
    if remote_deck.is_some() {
        if cli.remote_bind == parts.bind {
            return Err(format!("--remote-bind {} is the board's own port (0038)", cli.remote_bind));
        }
        let app = remote_router(RemoteState {
            hub: hub.clone(),
            views: notify.clone(),
            cmds: remote_tx,
            wait: Duration::from_secs(10),
        });
        let listener = tokio::net::TcpListener::bind(&cli.remote_bind)
            .await
            .map_err(|e| format!("{}: {e}", cli.remote_bind))?;
        println!("remote seat at http://{}/remote/ (tunnel this port, never the board's)", cli.remote_bind);
        println!("remote join code: {}", hub.lock().unwrap().code());
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
    }
```

(g) In the loop, directly after `let now = t0.elapsed().as_millis() as u64;`:

```rust
        // The remote seat (0038): let it claim once joined, and send what its player chose.
        if let Some(r) = parts.link.remote() {
            let joined = hub.lock().unwrap().joined();
            r.gate(joined, &parts.core.seated());
            while let Ok(RemoteCmd::Propose(tap)) = remote_rx.try_recv() {
                if !r.propose(now, tap) {
                    println!("[remote] a proposal was not sent (not its move, or a tap pending)");
                }
            }
        }
```

(h) In `DevCmd::Desk if cli.desk =>`, replace `parts = desk_parts(desk_seed);` with:

```rust
                    parts = desk_parts(desk_seed, remote_deck.as_ref());
                    if remote_deck.is_some() {
                        let mut h = hub.lock().unwrap();
                        h.new_match();
                        println!("remote join code: {}", h.code());
                    }
```

(i) Replace the `Output::View(v) => {` arm's first line `let json = serde_json::to_string(&v).unwrap_or_default();` with:

```rust
                    Output::View(mut v) => {
                        if remote_deck.is_some() {
                            let h = hub.lock().unwrap();
                            if !h.joined() {
                                v.remote_code = Some(h.code().to_string());
                            }
                        }
                        let json = serde_json::to_string(&v).unwrap_or_default();
                        if remote_deck.is_some() {
                            hub.lock().unwrap().publish_view(&json);
                            notify.notify_waiters();
                        }
```

The arm's remaining lines (the `--record` write and `view_tx.send`) are unchanged.

(j) In the `Output::MatchOver(m) => {` arm:
- Replace `l.apply_result(m.match_id, &m.result, m.figurines, m.winner, m.round)` with:

```rust
                            l.apply_result_credit(
                                m.match_id,
                                &m.result,
                                m.figurines,
                                m.winner,
                                m.round,
                                m.figurines.map(|f| Some(f) != parts.remote_figurine),
                            )
```

- Add as the arm's last statement, after the `if let Some((l, _)) = parts.ledger.as_mut() { … }` block:

```rust
                        if remote_deck.is_some() {
                            let mut h = hub.lock().unwrap();
                            h.new_match();
                            println!("remote join code: {}", h.code());
                        }
```

(k) After the `for input in inputs { … }` loop and before the `--once` check, publish the remote seat's menu:

```rust
        if let Some(r) = parts.link.remote() {
            let (menu, taps) = r.menu();
            hub.lock().unwrap().set_menu(menu, taps);
        }
```

- [ ] **Step 4: Run it and the gates.** On familiar, from `rust/`:

```sh
cargo build -p tapstone-arena --bin tapstone-arena
python3 tapstone-arena/tools/remote_smoke.py "$CARGO_TARGET_DIR/debug/tapstone-arena"; echo "exit $?"
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
```
Expected:
- The smoke prints `arena exit 0, N remote taps, match … over, winner …` with N ≥ 5, then `exit 0`.
- fmt, clippy and the workspace tests all pass. The workspace total is the baseline + 28 (A1 2, A2 4, A3 5, A4 10, A5 6, A6 1).

- [ ] **Step 5: The control.**

```sh
python3 tapstone-arena/tools/remote_smoke.py "$CARGO_TARGET_DIR/debug/tapstone-arena" --no-propose; echo "exit $?"
```
Expected: `STALLED after 0 remote taps`, then `exit 1`. The run above finishes because of the remote player's taps.

- [ ] **Step 6: Perturb.** In the loop's step (g), temporarily replace `r.gate(joined, &parts.core.seated());` with `r.gate(false, &parts.core.seated());`. Rebuild and re-run the smoke. Expected: the remote shrine never claims, the match never starts, and the smoke ends `STALLED …` with exit 1. Restore it, rebuild, and re-run to exit 0.

- [ ] **Step 7: Commit**

```sh
git add rust/tapstone-arena/src/main.rs rust/tapstone-arena/tools/remote_smoke.py
git commit -m "feat(arena): --remote and --remote-bind; the remote seat in the loop; the end-to-end smoke"
```

### Task A8: document it, and gate the whole group

**Files:**
- Modify: `rust/README.md`

- [ ] **Step 1: Document.** Append this section to `rust/README.md`:

````markdown
## The remote seat (0038)

One seat played from elsewhere (first, Roblox): a virtual shrine inside the arena, on its own
listener, which carries `/remote/*` only (API in `docs/superpowers/plans/2026-09-26-roblox-remote-seat.md`).

```sh
cargo run -p tapstone-arena -- --desk --remote ember-neutral     # against the desk bot, no hardware
cargo run -p tapstone-arena -- --remote ember-neutral            # against the real shrine on the gateway
cloudflared tunnel --url http://127.0.0.1:7791                   # expose the remote listener only, never :7790
```

**Tunnel trap (the lead, 2026-09-26, cloudflared 2026.9.3 on katana via mise):** don't resolve or curl the
`*.trycloudflare.com` URL until cloudflared's log says `Registered tunnel connection`. An earlier lookup is
cached as not-found by the homelab resolver, so a working tunnel looks dead (`http 000`). To probe from the
homelab, use `curl --doh-url https://1.1.1.1/dns-query <url>/remote/choices` (expect `401`). Roblox's servers use their own DNS, so this trap is local only.

The join code is printed (`remote join code: …`) and shown in the board's status line; a new one
follows every match. The end-to-end gate and its stall control:

```sh
python3 tapstone-arena/tools/remote_smoke.py target/debug/tapstone-arena               # exit 0
python3 tapstone-arena/tools/remote_smoke.py target/debug/tapstone-arena --no-propose  # exit 1
```
````

- [ ] **Step 2: The full gate, on familiar, from `rust/`**

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo clippy -p tapstone-arena --lib --no-default-features -- -D warnings
cargo build -p tapstone-arena --lib --no-default-features --target wasm32-unknown-unknown
cargo build -p tapstone-web --profile wasm --target wasm32-unknown-unknown
node tapstone-web/gate.mjs "$CARGO_TARGET_DIR/wasm32-unknown-unknown/wasm/tapstone_web.wasm" tapstone-arena/web/fixtures/desk-seed11.jsonl
cargo test --workspace
cargo build -p tapstone-arena --bin tapstone-arena
python3 tapstone-arena/tools/remote_smoke.py "$CARGO_TARGET_DIR/debug/tapstone-arena"
python3 tapstone-arena/tools/remote_smoke.py "$CARGO_TARGET_DIR/debug/tapstone-arena" --no-propose; test $? -eq 1
```
Expected:
- Every line exits 0.
- The node gate prints 4 `ok`: the in-page arena still reproduces the fixture, so `DeskShrine::with` and `off` changed nothing it runs.
- The workspace total is the baseline + 28.
- The last line proves the control stalls.

- [ ] **Step 3: Commit, then push the group.** Before pushing, send the lead "pushing #N <sha>".

```sh
git add rust/README.md
git commit -m "docs(rust): the remote seat, its tunnel and its gates"
```

## Part A self-review (against spec §§1–7)

**Spec coverage:**
- §1 shape:
  - RemoteLink wraps any Link and adds a manual DeskShrine on node 165 (A2).
  - The arena's sends reach both; poll merges (A2 `send`/`poll`).
  - It claims like any shrine (A2, after join).
  - It holds a deck list as virtual copies, with draws as taps (A1 `with`, A2).
  - Its taps come only from `propose` over `legal_choices` (A2, A4 `menu`).
- §2 API: all four routes and answers (A5), numbered views (A4, A5), numbered menus (A4, A5), 404 elsewhere (A5), the code alphabet and per-match codes (A4), `remote_code` in the view and on stdout (A6, A7), tokens dying with the match (A4, A7).
- §3 CLI: `--desk`, `--remote`, `--remote-bind` (A7). The tunnel is the operator's process (A8 docs).
- §5 Rust tests:
  - finishes a match: A2 and the smoke;
  - left alone stalls: A2 and the smoke's control;
  - views without gaps: A4 and A5;
  - stale menu refused: A4 and A5;
  - 403, 423 and 409: A4 and A5;
  - old token refused: A4 and A5;
  - 404 on `/dev/tap`, `/events` and `/`: A5;
  - fixture and existing tests green: every task and A8.
- §6 guest, with no ledger for the remote player: A3 and A7 (the credit mask).
- §7 risks: its own listener (A5, A7's bind check), match tokens and the lock (A4), `/dev` unreachable (A5).

**Known limits:**
- A match resumed from the journal (`ArenaCore::recover`) with a remote seat starts its remote shrine fresh, and relies on the core re-sending `B` (#67, `ask_begin`). This is INFERRED and untested; the prototype doesn't journal-resume across a restart with a remote seat.
- Only the `seat_pref: 2` in the remote shrine's lobby beacon is new on the wire. The arena ignores `seat_pref` in claims (lobby.rs:92–135).
