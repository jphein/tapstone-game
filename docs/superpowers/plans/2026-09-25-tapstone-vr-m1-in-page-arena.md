# VR M1a: the in-page arena and the day-1 spike, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person in one seat can play a whole desk match against the bot inside a web page, with the arena's own code compiled to WebAssembly, gated byte for byte against the committed desk fixture. A Quest 2 spike proves the page renders it in WebXR.

**Architecture:**
- `tapstone-arena` gets a default `server` feature, so its sans-IO core builds for `wasm32-unknown-unknown`.
- `record_desk_match`'s loop becomes a reusable `DeskTable`, with a manual seat a person drives.
- A new `tapstone-web` crate exposes `DeskTable` through a plain C ABI, with JSON through one output buffer and no wasm-bindgen.
- A Node gate checks it against the fixture.

**Tech Stack:** Rust 2024 (the workspace toolchain), target `wasm32-unknown-unknown`, Node ≥18 for the gate, and Meta's Immersive Web SDK (IWSDK, three.js) for the spike.

Spec: `docs/superpowers/specs/2026-09-25-tapstone-vr-design.md` (§2 architecture, §8 M1). This plan covers M1's foundation. The renderer, the input and the first-five-minutes script (the rest of M1) get their own plan, written from what the spike finds.

## Standing rules for every task

- **Build on familiar, never katana.** Edit and commit on katana, push the branch, then build on familiar.
  - Clone: `familiar:/var/tmp/fwork/<lane>`, with `CARGO_TARGET_DIR=/var/tmp/ftarget/<lane>` and `export PATH=$HOME/.cargo/bin:$PATH`.
  - Delete only your own named subdirs there, never a parent.
- **No CI.** Judge each gate run on its exit status and its pass counts, never on an empty grep (`docs/verification.md`).
- **Perturb every new check once, then restore it.** Break the thing it guards and see it go red.
- **One branch and one PR per task group:**
  - Tasks 1–2: `build/wasm-arena-split`
  - Tasks 3–4: `feat/desk-table`
  - Tasks 5–6: `feat/tapstone-web`
  - Task 7: scratch only, no PR
  - Task 8: `spike/xr-day1`, never merged
- The lead merges only a reviewed sha, after a gate run.

## File structure

| File | Responsibility |
|---|---|
| `rust/tapstone-sim/Cargo.toml` | `rand` without default features, which stops it pulling in getrandom |
| `rust/tapstone-arena/Cargo.toml` | the `server` feature; server deps optional; the bin needs `server` |
| `rust/tapstone-arena/src/lib.rs`, `src/link/mod.rs` | `#[cfg(feature = "server")]` on the server modules |
| `rust/tapstone-arena/src/link/desk.rs` | `DeskTable` (step, done, choices, propose); `DeskShrine::propose`; `DeskLink::manual` |
| `rust/tapstone-arena/tests/desk_table.rs` | a person-in-a-seat test and its stall control |
| `rust/tapstone-web/{Cargo.toml,src/lib.rs,src/ffi.rs}` | `Web` (a table plus the human's menu) and the C ABI |
| `rust/tapstone-web/gate.mjs` | the Node gate: fixture equality, a perturbed negative, a person finishing, a stall control |
| `rust/Cargo.toml` | workspace member `tapstone-web`; a `wasm` profile |
| `rust/README.md` | the wasm gate commands |

---

### Task 1: `tapstone-sim` builds for wasm32

**Files:**
- Modify: `rust/tapstone-sim/Cargo.toml` (the `rand` line)

- [ ] **Step 1: See it fail.** On familiar:

```sh
cargo build -p tapstone-sim --lib --target wasm32-unknown-unknown
```
Expected: FAIL, with an error from `getrandom` (it has no wasm32-unknown-unknown backend).

- [ ] **Step 2: Change the dependency**

```toml
rand = { version = "0.9", default-features = false, features = ["std", "std_rng"] }
```

- [ ] **Step 3: See it pass, and see that nothing else moved**

```sh
cargo build -p tapstone-sim --lib --target wasm32-unknown-unknown
cargo test -p tapstone-sim
cargo run --release -p tapstone-sim -- golden check
```
Expected:
- The build succeeds.
- The tests report the same pass count as on main (record both counts).
- The goldens pass.

The sim seeds only `StdRng`, so its transcripts can't change. The goldens prove that.

- [ ] **Step 4: Commit**

```sh
git add rust/tapstone-sim/Cargo.toml rust/Cargo.lock
git commit -m "build(sim): rand without default features, so the sim builds for wasm32"
```

### Task 2: `tapstone-arena`'s `server` feature

**Files:**
- Modify: `rust/tapstone-arena/Cargo.toml`
- Modify: `rust/tapstone-arena/src/lib.rs`
- Modify: `rust/tapstone-arena/src/link/mod.rs`

- [ ] **Step 1: See it fail**

```sh
cargo build -p tapstone-arena --lib --no-default-features --target wasm32-unknown-unknown
```
Expected: FAIL (tokio `net`, rusqlite, serialport).

- [ ] **Step 2: Make the server dependencies optional.** In `rust/tapstone-arena/Cargo.toml`:
  - add `optional = true` to each of `toml`, `sha2`, `rusqlite`, `tokio`, `tokio-stream`, `axum`, `serialport`, `ureq`, `clap` and `realm-sigil`;
  - keep the realm-sigil comment where it is;
  - then add:

```toml
[features]
default = ["server"]
# Everything that touches a socket, a file, a serial port or a clock. Off, the crate is the sans-IO
# core (core, view, decks, registry, transcript, link::{desk, lines}), which builds for wasm32.
server = ["dep:toml", "dep:sha2", "dep:rusqlite", "dep:tokio", "dep:tokio-stream", "dep:axum",
          "dep:serialport", "dep:ureq", "dep:clap", "dep:realm-sigil"]

[[bin]]
name = "tapstone-arena"
path = "src/main.rs"
required-features = ["server"]
```

- [ ] **Step 3: Gate the modules.** `rust/tapstone-arena/src/lib.rs`:

```rust
//! The Tapstone arena (0028): arbiter, board, ledger, record. See
//! docs/superpowers/specs/2026-09-23-arena-service-design.md.
//!
//! Without the default `server` feature this is the sans-IO core alone, which builds for wasm32
//! (tapstone-web, the headset build).
#[cfg(feature = "server")]
pub mod config;
pub mod core;
pub mod decks;
#[cfg(feature = "server")]
pub mod http;
#[cfg(feature = "server")]
pub mod ledger;
pub mod link;
#[cfg(feature = "server")]
pub mod poster;
pub mod registry;
pub mod transcript;
#[cfg(feature = "server")]
pub mod version;
pub mod view;
```

In `rust/tapstone-arena/src/link/mod.rs`, replace `pub mod serial;` with:

```rust
#[cfg(feature = "server")]
pub mod serial;
```

- [ ] **Step 4: Build and test**

```sh
cargo build -p tapstone-arena --lib --no-default-features --target wasm32-unknown-unknown
cargo build -p tapstone-arena --lib --no-default-features
cargo test -p tapstone-arena
cargo clippy --workspace --all-targets -- -D warnings
cargo clippy -p tapstone-arena --lib --no-default-features -- -D warnings
```
Expected:
- Both builds succeed.
- The arena's tests report the same counts as on main, including `the_canvas_fixture_is_current`.
- Both clippy runs are clean.
- If the no-default-features clippy reports an unused import in a core module, it's a real dependency on a server module: stop and report it, don't `allow` it.

- [ ] **Step 5: Perturb.** Temporarily remove `#[cfg(feature = "server")]` from `pub mod ledger;` and re-run the wasm32 build. Expected: FAIL on rusqlite. Restore it.

- [ ] **Step 6: Commit**

```sh
git add rust/tapstone-arena/Cargo.toml rust/tapstone-arena/src/lib.rs rust/tapstone-arena/src/link/mod.rs rust/Cargo.lock
git commit -m "build(arena): a default server feature; without it the sans-IO core builds for wasm32"
```

### Task 3: `DeskTable`, the desk loop as a type

`record_desk_match`'s body moves into a type that a caller steps. The committed fixture is the guard: this is a pure refactor, and `the_canvas_fixture_is_current` must stay green without a regenerated fixture.

**Files:**
- Modify: `rust/tapstone-arena/src/link/desk.rs` (`record_desk_match`, at about line 590)

- [ ] **Step 1: Add `DeskTable` above `record_desk_match`, and rewrite `record_desk_match` on it**

```rust
/// One desk table on a caller's clock: the arena core and two desk shrines, stepped 10 ms at a
/// time. `record_desk_match` is this with nobody at the table; tapstone-web is this with a person
/// in one seat (`link.manual`).
pub struct DeskTable {
    pub link: DeskLink,
    pub core: ArenaCore,
    over: bool,
}

impl DeskTable {
    pub fn new(seed: u64) -> DeskTable {
        let (link, book, stats) = DeskLink::new(seed);
        let cfg = CoreConfig {
            node: ARENA_NODE,
            rules: Default::default(),
            ruleset: 1,
            registry_id: 0,
            flat: false,
            epoch_unix: 1_789_980_000,
        };
        let core = ArenaCore::new(
            cfg,
            Box::new(stats),
            book,
            Registry::Trusting,
            Box::new(Unsigned),
        );
        DeskTable {
            link,
            core,
            over: false,
        }
    }

    /// One step at `now` ms: every frame the shrines sent since the last step, then a tick.
    /// Returns every view the board is sent, one JSON line each.
    pub fn step(&mut self, now: u64) -> Vec<String> {
        let mut views = Vec::new();
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
                    Output::View(v) => views.push(serde_json::to_string(&v).unwrap_or_default()),
                    Output::MatchOver(_) => self.over = true,
                    _ => {}
                }
            }
        }
        views
    }

    /// The match is over and its RESULT linger has closed (the binary's `--once` rule).
    pub fn done(&self) -> bool {
        self.over && !self.core.lingering()
    }
}

/// A whole desk match on a simulated clock (10 ms steps) with a fixed epoch: every view the board is
/// sent, one JSON line each, until the match is over and its RESULT linger has closed (the binary's
/// `--once` rule). Deterministic, unlike `--record` on the real clock, so its output can be a
/// committed fixture that a test keeps current (tests/fixture.rs).
pub fn record_desk_match(seed: u64) -> Vec<String> {
    let mut table = DeskTable::new(seed);
    let mut views = Vec::new();
    for step in 0..20_000u64 {
        views.extend(table.step(step * 10));
        if table.done() {
            break;
        }
    }
    views
}
```

- [ ] **Step 2: The fixture guards the refactor**

```sh
cargo test -p tapstone-arena --test fixture
cargo test -p tapstone-arena --test desk
```
Expected: PASS, with **no** fixture regeneration. If `the_canvas_fixture_is_current` fails, the refactor changed behaviour: fix the refactor, never the fixture.

- [ ] **Step 3: Perturb.** Temporarily change `step * 10` to `step * 11` in `record_desk_match`, re-run `--test fixture`, and expect FAIL. Restore it.

- [ ] **Step 4: Commit**

```sh
git add rust/tapstone-arena/src/link/desk.rs
git commit -m "refactor(arena): DeskTable, the desk loop as a steppable type; record_desk_match on it"
```

### Task 4: a person in one seat

**Files:**
- Modify: `rust/tapstone-arena/src/link/desk.rs`:
  - add `DeskLink::manual`, and use it in `poll`;
  - add `DeskShrine::propose`;
  - add `DeskTable::{choices, propose}`.
- Create: `rust/tapstone-arena/tests/desk_table.rs`

- [ ] **Step 1: Write the failing tests.** `rust/tapstone-arena/tests/desk_table.rs`:

```rust
//! A person in one desk seat (the headset build, spec 2026-09-25 §2): the seat's shrine makes no
//! taps of its own, and every tap it sends is one the person chose from the engine's own menu.
use tapstone_arena::link::desk::DeskTable;
use tapstone_rules::Kind;

/// Plays seat `i`'s turns with the first useful non-mulligan choice (a mulligan owes the hand
/// back, so always taking it would loop). Returns (finished, taps the person made).
fn play(seed: u64, i: usize, person: bool) -> (bool, u32) {
    let mut table = DeskTable::new(seed);
    table.link.manual[i] = true;
    let mut taps = 0;
    for step in 0..40_000u64 {
        let now = step * 10;
        table.step(now);
        if table.done() {
            return (true, taps);
        }
        if !person {
            continue;
        }
        let g = table.link.shrines[i].follower.game;
        let pick = table
            .choices(i)
            .into_iter()
            .find(|c| c.tap.kind != Kind::Mulligan && c.is_useful(&g));
        if let Some(c) = pick {
            assert!(table.propose(i, now, c.tap), "a menu choice was not sent");
            taps += 1;
        }
    }
    (false, taps)
}

#[test]
fn a_person_in_one_seat_finishes_a_desk_match() {
    for i in 0..2 {
        let (done, taps) = play(11, i, true);
        assert!(done, "shrine {i}'s person never finished the match");
        assert!(taps >= 5, "shrine {i}'s person made only {taps} taps");
    }
}

/// The control: the same seat with nobody choosing stalls, so the test above finishes because
/// of the person's taps, not because the shrine still plays itself.
#[test]
fn a_manual_seat_left_alone_stalls() {
    let (done, taps) = play(11, 0, false);
    assert!(!done, "a manual seat finished a match with no person");
    assert_eq!(taps, 0);
}

/// Nothing is offered off-turn or while a tap is pending, so a double pinch can't send twice.
#[test]
fn no_choices_while_a_tap_is_pending() {
    let mut table = DeskTable::new(11);
    table.link.manual[0] = true;
    for step in 0..40_000u64 {
        let now = step * 10;
        table.step(now);
        let first = table.choices(0).into_iter().next();
        if let Some(c) = first {
            assert!(table.propose(0, now, c.tap));
            assert!(table.choices(0).is_empty(), "choices offered while a tap is pending");
            assert!(!table.propose(0, now, c.tap), "a second tap was sent while one is pending");
            return;
        }
    }
    panic!("the person was never offered a choice");
}
```

- [ ] **Step 2: Run them and see them fail**

```sh
cargo test -p tapstone-arena --test desk_table
```
Expected: compile errors: no field `manual` on `DeskLink`, no method `choices` or `propose` on `DeskTable`.

- [ ] **Step 3: Implement.** In `desk.rs`:

(a) Add these imports at the top:

```rust
use tapstone_sim::human::{Choice, legal_choices};
```

(b) Add the field to `DeskLink`:

```rust
pub struct DeskLink {
    pub shrines: [DeskShrine; 2],
    /// A manual shrine makes no play taps of its own (it still claims its seat and answers the
    /// arena): its person's taps arrive through `DeskTable::propose`.
    pub manual: [bool; 2],
    out: VecDeque<Rx>,
}
```

Initialise it as `manual: [false; 2],` in `DeskLink::new`. In `poll`, change
`self.shrines[i].act(now, may_claim, false)` to `self.shrines[i].act(now, may_claim, self.manual[i])`.

(c) Add a method in `impl DeskShrine`, after `act`:

```rust
    /// A tap its person chose (a manual seat), stamped and sent the way `act` sends its own. A draw
    /// gets the UID of the first copy of that design not yet drawn (0036), as in `act`. Sends
    /// nothing (an empty Vec) with no seat, with a tap still pending, or for a draw of a design
    /// this shrine holds no undrawn copy of.
    pub fn propose(&mut self, now: u64, mut tap: Record) -> Vec<(u8, Vec<u8>)> {
        if self.seat().is_none() || self.pending.is_some() {
            return Vec::new();
        }
        if tap.kind == Kind::Draw {
            let i = self.index;
            let Some(k) = (0..self.deck.len())
                .find(|&k| self.deck[k] == tap.card && !self.drawn.contains(&copy_uid(i, k)))
            else {
                return Vec::new();
            };
            tap.uid = copy_uid(i, k);
        }
        self.lseq += 1;
        self.pending = Some((self.lseq, now));
        self.pending_record = Some(tap);
        self.proposed.push(self.lseq);
        let f = Frame::Tap(Tap::Propose {
            lseq: self.lseq,
            record: tap,
        });
        let id = self.follower.begun().unwrap_or(0);
        vec![(ARENA_NODE, encode(self.node, id, &f))]
    }
```

(d) Add these methods in `impl DeskTable`:

```rust
    /// Shrine `i`'s legal moves now (tapstone-sim's menu: every choice trial-applied to the engine),
    /// or none when it is not that seat's move or a tap is still pending.
    pub fn choices(&self, i: usize) -> Vec<Choice> {
        let s = &self.link.shrines[i];
        let Some(seat) = s.seat() else {
            return Vec::new();
        };
        let g = &s.follower.game;
        let owes = g.phase == Phase::Playing && g.seats[seat].owed_draws() > 0;
        let turn = g.phase == Phase::Playing && g.active == seat as u8;
        if s.pending.is_some() || !(owes || turn) {
            return Vec::new();
        }
        legal_choices(g, seat as u8)
    }

    /// Send `tap` from shrine `i`, as its person chose it. False when the shrine did not send it.
    pub fn propose(&mut self, i: usize, now: u64, tap: Record) -> bool {
        let frames = self.link.shrines[i].propose(now, tap);
        let sent = !frames.is_empty();
        let node = self.link.shrines[i].node;
        self.link.queue(node, frames);
        sent
    }
```

- [ ] **Step 4: Run all the arena tests**

```sh
cargo test -p tapstone-arena --test desk_table
cargo test -p tapstone-arena
cargo build -p tapstone-arena --lib --no-default-features --target wasm32-unknown-unknown
```
Expected: all three new tests pass; everything else, including the fixture, reports the same counts as before; the wasm32 build still succeeds.

- [ ] **Step 5: Perturb.** Temporarily make `DeskShrine::propose` return `Vec::new()` at its top. Expected: `a_person_in_one_seat_finishes_a_desk_match` and `no_choices_while_a_tap_is_pending` FAIL. Restore it.

- [ ] **Step 6: Commit**

```sh
git add rust/tapstone-arena/src/link/desk.rs rust/tapstone-arena/tests/desk_table.rs
git commit -m "feat(arena): a manual desk seat a person drives (DeskTable::choices/propose)"
```

### Task 5: the `tapstone-web` crate

**Files:**
- Create: `rust/tapstone-web/Cargo.toml`
- Create: `rust/tapstone-web/src/lib.rs`
- Create: `rust/tapstone-web/src/ffi.rs`
- Modify: `rust/Cargo.toml`: the member list, and a `wasm` profile

- [ ] **Step 1: Write the crate with its failing test.** `rust/tapstone-web/Cargo.toml`:

```toml
[package]
name = "tapstone-web"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true
description = "The desk table in the browser (spec 2026-09-25): tapstone-arena's sans-IO core behind a C ABI for wasm32."

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
tapstone-arena = { path = "../tapstone-arena", default-features = false }
tapstone-rules = { path = "../tapstone-rules" }
tapstone-sim = { path = "../tapstone-sim" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

In `rust/Cargo.toml`, add `"tapstone-web"` to `members`, then append:

```toml
# The headset build: `cargo build -p tapstone-web --profile wasm --target wasm32-unknown-unknown`.
# Its own profile, so no other crate's release build changes.
[profile.wasm]
inherits = "release"
opt-level = "s"
lto = true
```

`rust/tapstone-web/src/lib.rs`:

```rust
//! The desk table in the browser (spec 2026-09-25 §2): a person in one seat, the bot in the other,
//! the arena's own core arbitrating. The page renders the view JSON the arena's SSE carries, so
//! app.js's code path is unchanged; the page proposes, the core decides (0037).
use serde::Serialize;
use tapstone_arena::link::desk::DeskTable;
use tapstone_rules::Record;

pub mod ffi;

/// `human` value for a table with nobody seated (both shrines scripted, as `record_desk_match`).
pub const NOBODY: u32 = 255;

pub struct Web {
    table: DeskTable,
    human: Option<usize>,
    /// The taps behind the menu last returned by `choices`, which `propose` indexes into.
    menu: Vec<Record>,
}

#[derive(Serialize)]
struct MenuItem<'a> {
    key: &'a str,
    label: &'a str,
    kind: String,
    useful: bool,
}

impl Web {
    /// `human` is the desk shrine (0 or 1) a person drives; `NOBODY` for none.
    pub fn new(seed: u64, human: u32) -> Web {
        let mut table = DeskTable::new(seed);
        let human = (human < 2).then_some(human as usize);
        if let Some(h) = human {
            table.link.manual[h] = true;
        }
        Web {
            table,
            human,
            menu: Vec::new(),
        }
    }

    /// One 10 ms step at `now`: the views, one JSON line each, joined by newlines ("" for none).
    pub fn step(&mut self, now: u64) -> String {
        self.table.step(now).join("\n")
    }

    pub fn done(&self) -> bool {
        self.table.done()
    }

    /// The person's legal moves now, as a JSON array of {key, label, kind, useful}: "[]" when it
    /// is not their move. `propose(i)` takes an index into the array last returned.
    pub fn choices(&mut self) -> String {
        self.menu.clear();
        let Some(h) = self.human else {
            return "[]".into();
        };
        let list = self.table.choices(h);
        let g = &self.table.link.shrines[h].follower.game;
        let items: Vec<MenuItem> = list
            .iter()
            .map(|c| MenuItem {
                key: &c.key,
                label: &c.label,
                kind: format!("{:?}", c.tap.kind),
                useful: c.is_useful(g),
            })
            .collect();
        let json = serde_json::to_string(&items).unwrap_or_else(|_| "[]".into());
        self.menu = list.iter().map(|c| c.tap).collect();
        json
    }

    /// Send menu item `i` from the last `choices`. False for a stale or out-of-range index. The
    /// menu is spent either way, so a second pinch can't resend it.
    pub fn propose(&mut self, i: u32, now: u64) -> bool {
        let tap = self.menu.get(i as usize).copied();
        self.menu.clear();
        match (self.human, tap) {
            (Some(h), Some(tap)) => self.table.propose(h, now, tap),
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tapstone_arena::link::desk::record_desk_match;

    #[test]
    fn nobody_seated_is_record_desk_match() {
        let mut web = Web::new(11, NOBODY);
        let mut lines = Vec::new();
        for step in 0..20_000u64 {
            let s = web.step(step * 10);
            if !s.is_empty() {
                lines.push(s);
            }
            if web.done() {
                break;
            }
        }
        assert_eq!(lines.join("\n"), record_desk_match(11).join("\n"));
    }

    #[test]
    fn a_stale_menu_index_sends_nothing() {
        let mut web = Web::new(11, 0);
        for step in 0..40_000u64 {
            let now = step * 10;
            web.step(now);
            let menu: Vec<serde_json::Value> = serde_json::from_str(&web.choices()).unwrap();
            if !menu.is_empty() {
                assert!(!web.propose(menu.len() as u32, now), "an out-of-range index was sent");
                web.choices();
                assert!(web.propose(0, now), "a fresh menu's first item was not sent");
                assert!(!web.propose(0, now), "a spent menu was sent twice");
                return;
            }
        }
        panic!("never offered a menu");
    }
}
```

`rust/tapstone-web/src/ffi.rs`:

```rust
//! The C ABI the page calls. One table per page and one output buffer: a call that returns text
//! returns its byte length, and `out_ptr()` points at the bytes until the next such call. u64
//! arguments are BigInt on the JS side.
use std::cell::RefCell;

use crate::Web;

thread_local! {
    static WEB: RefCell<Option<Web>> = const { RefCell::new(None) };
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn put(s: String) -> u32 {
    OUT.with(|o| {
        let mut o = o.borrow_mut();
        *o = s.into_bytes();
        o.len() as u32
    })
}

fn with<T>(f: impl FnOnce(&mut Web) -> T, none: T) -> T {
    WEB.with(|w| w.borrow_mut().as_mut().map(f).unwrap_or(none))
}

#[unsafe(no_mangle)]
pub extern "C" fn out_ptr() -> *const u8 {
    OUT.with(|o| o.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn table_new(seed: u64, human: u32) {
    WEB.with(|w| *w.borrow_mut() = Some(Web::new(seed, human)));
}

#[unsafe(no_mangle)]
pub extern "C" fn table_step(now: u64) -> u32 {
    put(with(|t| t.step(now), String::new()))
}

#[unsafe(no_mangle)]
pub extern "C" fn table_done() -> u32 {
    with(|t| t.done() as u32, 0)
}

#[unsafe(no_mangle)]
pub extern "C" fn table_choices() -> u32 {
    put(with(|t| t.choices(), "[]".into()))
}

#[unsafe(no_mangle)]
pub extern "C" fn table_propose(i: u32, now: u64) -> u32 {
    with(|t| t.propose(i, now) as u32, 0)
}
```

- [ ] **Step 2: Run the tests**

```sh
cargo test -p tapstone-web
cargo build -p tapstone-web --profile wasm --target wasm32-unknown-unknown
ls -l "$CARGO_TARGET_DIR/wasm32-unknown-unknown/wasm/tapstone_web.wasm"
```
Expected: 2 passed; the build succeeds; the file is roughly 250–300 KB (the probe was 263 KB). Record the size.

- [ ] **Step 3: Perturb.** Temporarily change `Web::new` to set `table.link.manual[0] = true` whatever `human` is. Expected: `nobody_seated_is_record_desk_match` FAILS. Restore it.

- [ ] **Step 4: The workspace gates**

```sh
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
```
Expected: exit 0; the workspace total is the previous count + 5 (3 from Task 4, 2 here).

- [ ] **Step 5: Commit**

```sh
git add rust/Cargo.toml rust/Cargo.lock rust/tapstone-web
git commit -m "feat(web): tapstone-web, the desk table behind a C ABI for wasm32"
```

### Task 6: the Node gate

**Files:**
- Create: `rust/tapstone-web/gate.mjs`
- Modify: `rust/README.md` (the Gates block)

- [ ] **Step 1: Write the gate.** `rust/tapstone-web/gate.mjs`:

```js
// The tapstone-web gate, run against the built .wasm (no CI here: judge it by its exit status).
//   node tapstone-web/gate.mjs <tapstone_web.wasm> tapstone-arena/web/fixtures/desk-seed11.jsonl
// 1. Nobody seated reproduces the committed desk fixture byte for byte (the arena's own core, in wasm).
// 2. A perturbed fixture is caught (the check can see).
// 3. A person in seat 0, choosing from the engine's menu, finishes the match.
// 4. The same seat with nobody choosing stalls (3 finishes because of the person's taps).
import fs from "node:fs";

const [wasmPath, fixturePath] = process.argv.slice(2);
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
const x = instance.exports;
const read = (n) => new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.out_ptr(), n));
let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failed++;
};

function record(seed) {
  x.table_new(BigInt(seed), 255);
  const lines = [];
  for (let s = 0n; s < 20000n; s++) {
    const n = x.table_step(s * 10n);
    if (n) lines.push(read(n));
    if (x.table_done()) break;
  }
  return lines.join("\n");
}

function play(person) {
  x.table_new(11n, 0);
  let taps = 0;
  for (let s = 0n; s < 40000n; s++) {
    x.table_step(s * 10n);
    if (x.table_done()) return { done: true, taps };
    if (!person) continue;
    const menu = JSON.parse(read(x.table_choices()));
    const i = menu.findIndex((c) => c.useful && c.kind !== "Mulligan");
    if (i >= 0) {
      if (!x.table_propose(i, s * 10n)) throw new Error(`menu item ${i} was not sent`);
      taps++;
    }
  }
  return { done: false, taps };
}

const fixture = fs.readFileSync(fixturePath, "utf8").trim();
const t0 = performance.now();
const fresh = record(11);
const ms = (performance.now() - t0).toFixed(1);
check(fresh === fixture, `nobody seated equals the fixture (${fresh.split("\n").length} lines, ${ms} ms)`);

const bent = fixture.split("\n");
bent[39] = bent[39].replace("1", "2");
check(bent.join("\n") !== fixture && fresh !== bent.join("\n"), "a perturbed fixture is caught");

const p = play(true);
check(p.done && p.taps >= 5, `a person in seat 0 finishes (${p.taps} taps)`);
const alone = play(false);
check(!alone.done && alone.taps === 0, "the same seat left alone stalls");

process.exitCode = failed ? 1 : 0;
```

- [ ] **Step 2: Run it.** From `rust/` on familiar:

```sh
node tapstone-web/gate.mjs "$CARGO_TARGET_DIR/wasm32-unknown-unknown/wasm/tapstone_web.wasm" tapstone-arena/web/fixtures/desk-seed11.jsonl; echo "exit $?"
```
Expected: 4 `ok` lines, `exit 0`.

- [ ] **Step 3: Perturb.** Pass a copy of the fixture with its last line deleted. Expected: `FAIL nobody seated equals the fixture`, `exit 1`.

- [ ] **Step 4: Document it.** Append to the Gates block in `rust/README.md`:

```sh
cargo build -p tapstone-arena --lib --no-default-features --target wasm32-unknown-unknown  # the core is sans-IO
cargo build -p tapstone-web --profile wasm --target wasm32-unknown-unknown
node tapstone-web/gate.mjs target/wasm32-unknown-unknown/wasm/tapstone_web.wasm tapstone-arena/web/fixtures/desk-seed11.jsonl
```

Add one sentence below the block: "The wasm gate proves the headset build runs the arena's own core: nobody seated reproduces the desk fixture byte for byte (`rustup target add wasm32-unknown-unknown` once)."

- [ ] **Step 5: Commit**

```sh
git add rust/tapstone-web/gate.mjs rust/README.md
git commit -m "test(web): the Node gate, fixture equality plus a person finishing, each with a control"
```

### Task 7: measure the "first match" ruleset (scratch only, no code)

The spec proposes castle_life 10, pressure_from 4, stop_round 6 for a new player's first match, and says **it must be measured before it's adopted**.

> **Executed 2026-09-25 (luna-vr, `scratch/vr/first-match.md`), and corrected here.** The first version of step 1 printed an empty table: `fairness` hides every row more than `--tolerance` (default 2) from 50/50 unless it is the shipped config, and 10/4/6 is 14–33 points off. `fairness` also prints no taps and only play-out rounds. Result: **10/4/6 is not adopted** (seat 0 wins 64.5–78.4% on play-out, and the round-6 stop never fires). The steps below are the corrected method, runnable since `feat/sim-balance-adhoc` gave `balance` the flags it lacked.

- [ ] **Step 1: The seat edge, from the fairness grid at a single point.** From `rust/` on familiar, with **`--tolerance 100`**, or the row is filtered out (fairness now says how many rows it hid):

```sh
cargo run --release -p tapstone-sim -- fairness --games 4000 --decks mirror-ember --bonus 1 --life 10 --from 4 --stop 6 --tolerance 100
cargo run --release -p tapstone-sim -- fairness --games 4000 --decks mirror-tide  --bonus 1 --life 10 --from 4 --stop 6 --tolerance 100
cargo run --release -p tapstone-sim -- fairness --games 4000 --decks mirror-ember --bonus 1 --life 20 --from 8 --stop 12
cargo run --release -p tapstone-sim -- fairness --games 4000 --decks mirror-tide  --bonus 1 --life 20 --from 8 --stop 12
```
The last two are the control: today's defaults (`HouseRules::default` in `rust/tapstone-rules/src/state.rs`: castle_life 20, pressure_from 8, stop_round 12, second_player_bonus 1).

- [ ] **Step 2: The length, from `balance` with the ad-hoc variant and records per seat.** A person in seat 0 on play-out against the bot in seat 1 on pass-early, on both mirrors and the shipped pairing:

```sh
for d in mirror-ember mirror-tide asymmetric; do
  cargo run --release -p tapstone-sim -- balance --games 4000 --decks $d --picker play-out --picker1 pass-early --life 20 --from 8 --stop 12
  cargo run --release -p tapstone-sim -- balance --games 4000 --decks $d --picker play-out --picker1 pass-early --life 10 --from 4 --stop 6
done
```
`recs0/g` and `recs1/g` are the records each seat commits per game (claims and draws included). Wall time = `recs0/g` × 4 s + `recs1/g` × 1.4 s. `--json` adds the round histogram, for a median.

- [ ] **Step 3: Write `scratch/vr/first-match.md`.** Record, for each run:
  - the win rates by seat;
  - the mean and median rounds;
  - records per seat;
  - the stall (non-lethal) count;
  - the wall time from step 2's formula.

  The target is a median match of 5–7 minutes.

- [ ] **Step 4: Report to the lead.** Give the numbers and a recommendation: adopt, adjust (name the values), or measure differently. Wiring the ruleset into the web table (the lobby's `rules_id` and `CoreConfig.rules`) is the next plan's task, not this one.

### Task 8: the day-1 spike on the Quest 2 (exploratory; branch `spike/xr-day1`, never merged)

Timeboxed to one working day. It isn't TDD: it answers questions the renderer plan needs. The questions and the pass line are fixed here; the code is the spike's to find.

**Files:**
- Create, on the spike branch only: `rust/tapstone-web/www/spike/` (an IWSDK project scaffolded by IWSDK's own starter)
- Create: `scratch/vr/spike-day1.md` (the findings)

- [ ] **Step 1: Scaffold.** Use IWSDK's official starter. Record the command, the IWSDK version and the Node version in the findings. Copy `tapstone_web.wasm` from Task 5 into its public folder.

- [ ] **Step 2: Load the table.** Use the glue below, and check it in the IWER emulator (desktop browser) before the headset.

```js
// table.js: the in-page arena. Each frame, advance the simulated clock in 10 ms steps up to now.
export async function openTable(url, seed, human) {
  const { instance } = await WebAssembly.instantiateStreaming(fetch(url), {});
  const x = instance.exports;
  const read = (n) => new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.out_ptr(), n));
  x.table_new(BigInt(seed), human);
  let clock = 0n;
  return {
    advance(ms, onView) {
      const until = clock + BigInt(Math.floor(ms));
      for (; clock < until; clock += 10n) {
        const n = x.table_step(clock);
        if (n) for (const line of read(n).split("\n")) onView(JSON.parse(line));
      }
    },
    choices: () => JSON.parse(read(x.table_choices())),
    propose: (i) => !!x.table_propose(i, clock),
    done: () => !!x.table_done(),
  };
}
```

- [ ] **Step 3: Render the minimum.** In `immersive-ar` on the Quest 2 (greyscale passthrough):
  - a 60 × 42 cm board placed on the table by a palm press;
  - 3 × 6 cells as flat tiles, units as coloured boxes read from the view JSON;
  - the person's menu as floating pinchable tiles, labelled with `label`, one per `useful` item.

  Hands only: request no controller features.

- [ ] **Step 4: Measure, and write it all to `scratch/vr/spike-day1.md`.** The pass line is **all five**:
  1. a whole match played to its result on the Quest 2 with hands only;
  2. **zero network requests after load** (browser devtools over `adb`, Network tab);
  3. the frame rate over the match, measured (the OVR Metrics Tool, or IWSDK's stats) and recorded as min, median and p1, against the 60 fps floor;
  4. placement survives looking away and back;
  5. IWER in the desktop browser plays the same page.

  Also record:
  - which IWSDK APIs gave gaze-plus-pinch and hand joints;
  - what was awkward;
  - the `fieldOfViewMask` at about 70°: does the board still fit?

- [ ] **Step 5: Report to the lead** with the findings file path, and the recommended changes to the spec (if any) before the renderer plan is written.

---

## After this plan

1. **The renderer and input plan (the rest of M1),** written from `spike-day1.md`:
   - the renderer on the view JSON (low-poly primitives plus 0014 art billboards);
   - hands-first input: the altar, the pads, the wrist flip, and gaze-plus-pinch;
   - the first-match ruleset wired in from Task 7;
   - the first-five-minutes beat script;
   - M1's exit test (a first-time player finishes a match unaided).
2. M2 and M3, per spec §8.
