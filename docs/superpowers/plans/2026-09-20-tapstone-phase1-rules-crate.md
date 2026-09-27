# Tapstone Phase 1 — rules crate and scripted-seat harness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `no_std` Rust crate `tapstone-rules` that turns an ordered list of tap events into a deterministic game state with a chained hash, plus a host-side harness `tapstone-sim` whose scripted seats play whole games and pin golden transcripts.

**Architecture:** Two crates in a `rust/` Cargo workspace. `tapstone-rules` has no allocation, fixed-size arrays, one dependency (`sha2` without default features, the crate smol already ships), edition 2024, `rust-version = "1.95"` to match smol's floor so smol can vendor it as an in-repo path dependency exactly like `rust/sigil-names`. `tapstone-sim` is `std`, depends on the rules crate plus `serde_json`, `rand`, `clap`, and owns scripted seats, the arbiter loop, transcript JSON and golden files.

**Tech Stack:** Rust stable 1.97 (`~/.cargo/bin`), cargo workspaces, `sha2 0.11`, `proptest` (sim only), `serde`/`serde_json`, `clap`, `rand` with `StdRng`.

**Spec:** `docs/superpowers/specs/2026-09-20-tapstone-design.md` §3, §4, §7, §8; decisions 0006–0013, 0015, 0016; `docs/protocol/tapstone-protocol-draft.md` (24-byte record); `docs/design/rules-v0.md`.

---

## Rules the code must implement (from the spec, fixed here so tasks agree)

- Board: 3 lanes × 3 cells per side (0 = back, 1 = mid, 2 = front) × 2 seats for Duel. Castles 20 life.
- Deck 25, opening hand 5 (seat 1: 6), draw 1 per round. Deck order is part of the seed (the physical deck is shuffled by hand; the sim shuffles with the seed).
- Mana: `charged` count per seat; once per round a `Charge` tap adds 1 permanent. Casting spends from `available = charged − spent_this_round`.
- Actions per round for the active seat (Duel = alternating turns for phase 1; a `Round` = one seat's turn): `Draw` (automatic at turn start), `Charge{card}`, `CastUnit{card, lane}` → back cell must be empty, `CastSpell{card, target}`, `Advance{lane}` (once per lane per turn: each of your units moves one cell forward if the next cell is empty, processed front-most first), `Pass` (ends the turn: combat, then pressure at the start of the next turn if round ≥ 8).
- Combat at end of turn, simultaneous: for each lane, your **front** unit fights the enemy unit in *their* front cell if any, else hits their castle; `Ranged` units in any cell hit the nearest enemy unit in the lane (front to back) else the castle. Damage applied together; units with toughness ≤ damage die. `Shield 1` ignores 1 damage per combat. `Taunt`: enemy attackers in that lane must target it if it is the nearest. `Haste`: may `Advance` the turn it enters. `Rush`: enters in the **mid** cell.
- Spells (closed table): `Damage(n, UnitTarget|Castle)`, `Heal(n, Unit)`, `Destroy(toughness ≤ n)`, `Shift(unit, ±1 lane)`, `Draw(2)`.
- Pressure: from round 8 each castle loses 2 at the start of its owner's turn. Round 12 ends the game after both seats have played: higher castle life wins; tie → more units; tie → seat 1.
- Refusals (never panics): `NotYourTurn`, `NotInHand`, `NoMana{need,have}`, `CellOccupied`, `AlreadyChargedThisRound`, `AlreadyAdvancedLane`, `BadTarget`, `UnknownCard`, `GameOver`, `LaneOutOfRange`.
- Hash chain: `h_n = SHA256(h_{n-1} ‖ record ‖ canonical_state)[..8]`, `h_0 = SHA256(b"tapstone:v0" ‖ house_rules_bytes)[..8]`.
- Event record, 24 bytes little-endian: `seq u16 · seat u8 · kind u8 · card u16 (design id index) · lane i8 · target u8 · aux u8 · pad u8 · time_ms u32 · uid[7] · auth u8` (see protocol draft; `uid` is carried but never read by the rules; `card` is a design index the arbiter resolved from the registry before committing).
- House rules (`HouseRules`): `deck_size 25, hand 5, second_player_bonus 1, castle_life 20, pressure_from 8, pressure 2, stop_round 12, lanes 3, cells 3`. Applied at lobby only.

## File structure

```
rust/
  Cargo.toml                 workspace: members = ["tapstone-rules", "tapstone-sim"]
  rust-toolchain.toml        channel = "stable"
  tapstone-rules/
    Cargo.toml               no_std lib, sha2 (no default features), rust-version 1.95, edition 2024
    src/lib.rs               pub mod cards, state, event, rules, hash; #![no_std]
    src/cards.rs             Faction, Keyword, Effect, CardKind, CardDesign, const SET1: &[CardDesign]
    src/event.rs             Kind, Record (24 bytes) encode/decode, Intent
    src/state.rs             HouseRules, Unit, Castle, Seat, Game (fixed arrays), Phase, Winner
    src/rules.rs             Game::new, Game::apply(&Record) -> Result<Applied, Refusal>, combat, pressure, end
    src/hash.rs              canonical(state) -> bytes into a fixed buffer, chain step
    tests/determinism.rs     same records → same hash; cross-check against sim later
  tapstone-sim/
    Cargo.toml               std bin+lib: tapstone-rules (path), serde, serde_json, rand, clap, proptest (dev)
    src/lib.rs               ScriptedSeat, Arbiter, Transcript (JSON), golden helpers
    src/seat.rs              random legal tap generator seeded by StdRng
    src/arbiter.rs           orders taps, applies, appends hash, refuses invalid
    src/transcript.rs        JSON rendering of records + hashes + final state
    src/main.rs              `tapstone-sim play --seed N [--json]`, `golden check|update`
    golden/seed-1.json …     committed transcripts
game/cards/set1/*.toml       12 test designs (source of truth for SET1; Task 6 compiles them)
tools/compile_cards.py       TOML → rust/tapstone-rules/src/set1.rs (generated, committed)
```

### Layout as built (2026-09-20)

The table above is the plan as written; the tree that shipped differs in these ways.

```
rust/
  README.md                  crates, gates, vendoring into smol, sim CLI, cards workflow
  tapstone-rules/
    src/cards.rs             … pub static SET1: &[CardDesign] — a generated slice, 14 designs
    src/event.rs             Kind, Record (24 B) encode/decode        (no `Intent`: the record's
                             kind + lane + target + aux carry it)
    src/state.rs             … Game::new / started / begin_play / with_rules live here, not in rules.rs
    src/rules.rs             Game::apply -> Result<Applied, Refusal>, combat, pressure, lobby, end
    tests/                   cards.rs · event.rs · state.rs · rules.rs · lobby.rs · determinism.rs
  tapstone-sim/
    src/replay.rs            independent replay of a transcript (never touches the Arbiter)
    src/main.rs              play · golden update|check · replay <file>
    tests/                   golden.rs · props.rs (never-panic and replay-equivalence properties)
game/cards/set1/*.toml       14 test designs, st1-000..013 (12 planned; Mend and Riptide added, 0023)
tools/compile_cards.py       TOML → the generated region of rust/tapstone-rules/src/cards.rs
                             (not a separate set1.rs), `--check` for CI
```

---

### Task 0: Workspace scaffold

**Files:** `rust/Cargo.toml`, `rust/rust-toolchain.toml`, `rust/tapstone-rules/Cargo.toml`, `rust/tapstone-rules/src/lib.rs`, `rust/tapstone-sim/Cargo.toml`, `rust/tapstone-sim/src/main.rs`, `.gitignore` (add `rust/target/`)

- [x] **Step 1: Create the workspace**

`rust/Cargo.toml`:
```toml
[workspace]
resolver = "3"
members = ["tapstone-rules", "tapstone-sim"]

[workspace.package]
edition = "2024"
rust-version = "1.95"   # smol's floor: the crate must build on espup's Xtensa fork too
license = "MIT"
```
`rust/rust-toolchain.toml`:
```toml
[toolchain]
channel = "stable"
```
`rust/tapstone-rules/Cargo.toml`:
```toml
[package]
name = "tapstone-rules"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true
description = "Tapstone rules: ordered tap events → deterministic game state with a chained hash. no_std, no alloc."

[lib]
crate-type = ["rlib"]

[dependencies]
sha2 = { version = "0.11", default-features = false }

[features]
default = []
std = []   # only enables Debug/Display helpers in tests; the crate stays no_std by default
```
`rust/tapstone-rules/src/lib.rs`:
```rust
#![no_std]
#![forbid(unsafe_code)]
//! Tapstone rules. One crate, two hosts: the shrine firmware and the arena service.
pub mod cards;
pub mod event;
pub mod hash;
pub mod rules;
pub mod state;

pub use cards::{CardDesign, CardKind, Effect, Faction, Keyword, SET1};
pub use event::{Kind, Record};
pub use rules::{Applied, Refusal};
pub use state::{Game, HouseRules, Phase, Winner};
```
Stub each module with an empty file for now so the crate compiles.

`rust/tapstone-sim/Cargo.toml`:
```toml
[package]
name = "tapstone-sim"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true

[dependencies]
tapstone-rules = { path = "../tapstone-rules" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rand = { version = "0.9", features = ["std_rng"] }
clap = { version = "4", features = ["derive"] }

[dev-dependencies]
proptest = "1"
```
`rust/tapstone-sim/src/main.rs`: `fn main() { println!("tapstone-sim"); }`

- [x] **Step 2: Build**

Run: `cd rust && PATH="$HOME/.cargo/bin:$PATH" cargo build`
Expected: both crates compile, warnings only about unused modules.

- [x] **Step 3: Prove no_std**

Run: `cd rust && PATH="$HOME/.cargo/bin:$PATH" cargo build -p tapstone-rules --target thumbv7em-none-eabi 2>&1 | tail -3` (install with `rustup target add thumbv7em-none-eabi` first). Expected: compiles — a bare-metal target with no `std` proves the crate is honestly `no_std`. Keep this command in `rust/README.md` as the no_std gate.

- [x] **Step 4: Commit**

```bash
git add rust/Cargo.toml rust/rust-toolchain.toml rust/tapstone-rules rust/tapstone-sim .gitignore
git commit -m "chore(rust): workspace with no_std tapstone-rules and std tapstone-sim"
```

---

### Task 1: Card designs and the test set

**Files:** `rust/tapstone-rules/src/cards.rs`, `rust/tapstone-rules/tests/cards.rs`

- [x] **Step 1: Failing test**

`rust/tapstone-rules/tests/cards.rs`:
```rust
use tapstone_rules::{CardKind, Effect, Faction, Keyword, SET1};

#[test]
fn set1_has_twelve_designs_with_unique_ids() {
    assert_eq!(SET1.len(), 12);
    for (i, c) in SET1.iter().enumerate() {
        assert_eq!(c.id as usize, i, "design index must equal its id");
        assert!(!c.name.is_empty());
    }
}

#[test]
fn ember_vanguard_is_a_rush_unit() {
    let c = SET1.iter().find(|c| c.name == "Ashen Vanguard").unwrap();
    assert_eq!(c.faction, Faction::Ember);
    assert_eq!(c.kind, CardKind::Unit { attack: 3, toughness: 2, keyword: Some(Keyword::Rush) });
    assert_eq!(c.cost, 3);
}

#[test]
fn tide_bolt_is_a_damage_spell() {
    let c = SET1.iter().find(|c| c.name == "Tidal Lash").unwrap();
    assert_eq!(c.kind, CardKind::Spell(Effect::Damage { amount: 3, castle_ok: false }));
}
```

- [x] **Step 2: Run to fail**

Run: `cd rust && cargo test -p tapstone-rules --test cards`  Expected: FAIL, unresolved imports.

- [x] **Step 3: Implement**

`rust/tapstone-rules/src/cards.rs`:
```rust
//! Card designs. The engine only ever sees a design index (`u16`); UIDs stay in the registry.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Faction { Ember, Tide, Neutral }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Keyword { Ranged, Shield1, Haste, Rush, Taunt }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Effect {
    Damage { amount: u8, castle_ok: bool },
    Heal { amount: u8 },
    Destroy { max_toughness: u8 },
    Shift,          // move target unit one lane (direction in the tap's aux byte)
    Draw { count: u8 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CardKind {
    Unit { attack: u8, toughness: u8, keyword: Option<Keyword> },
    Spell(Effect),
    Castle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CardDesign {
    pub id: u16,
    pub name: &'static str,
    pub faction: Faction,
    pub cost: u8,
    pub kind: CardKind,
}

const fn unit(id: u16, name: &'static str, faction: Faction, cost: u8, attack: u8, toughness: u8, keyword: Option<Keyword>) -> CardDesign {
    CardDesign { id, name, faction, cost, kind: CardKind::Unit { attack, toughness, keyword } }
}
const fn spell(id: u16, name: &'static str, faction: Faction, cost: u8, effect: Effect) -> CardDesign {
    CardDesign { id, name, faction, cost, kind: CardKind::Spell(effect) }
}

/// The twelve-design test set. Task 6 regenerates this file from game/cards/set1/*.toml.
pub static SET1: [CardDesign; 12] = [
    CardDesign { id: 0, name: "Ember Castle", faction: Faction::Ember, cost: 0, kind: CardKind::Castle },
    CardDesign { id: 1, name: "Tide Castle", faction: Faction::Tide, cost: 0, kind: CardKind::Castle },
    unit(2, "Cinder Whelp", Faction::Ember, 1, 2, 1, Some(Keyword::Haste)),
    unit(3, "Ashen Vanguard", Faction::Ember, 3, 3, 2, Some(Keyword::Rush)),
    unit(4, "Hearth Warden", Faction::Ember, 2, 1, 3, Some(Keyword::Taunt)),
    spell(5, "Flare", Faction::Ember, 1, Effect::Damage { amount: 2, castle_ok: true }),
    unit(6, "Reef Archer", Faction::Tide, 2, 1, 2, Some(Keyword::Ranged)),
    unit(7, "Tidecaller", Faction::Tide, 3, 2, 3, None),
    unit(8, "Pearl Shieldbearer", Faction::Tide, 2, 1, 2, Some(Keyword::Shield1)),
    spell(9, "Tidal Lash", Faction::Tide, 2, Effect::Damage { amount: 3, castle_ok: false }),
    spell(10, "Undertow", Faction::Tide, 2, Effect::Shift),
    spell(11, "Deep Breath", Faction::Neutral, 1, Effect::Draw { count: 2 }),
];

pub fn design(id: u16) -> Option<&'static CardDesign> { SET1.get(id as usize) }
```

- [x] **Step 4: Run to pass**  `cargo test -p tapstone-rules --test cards` → 3 passed.
- [x] **Step 5: Commit**  `git add rust/tapstone-rules/src/cards.rs rust/tapstone-rules/tests/cards.rs && git commit -m "feat(rules): card design model and the twelve-card test set"`

---

### Task 2: Event record (24 bytes)

**Files:** `rust/tapstone-rules/src/event.rs`, `rust/tapstone-rules/tests/event.rs`

- [x] **Step 1: Failing test**

```rust
use tapstone_rules::{Kind, Record};

#[test]
fn record_roundtrips_through_24_bytes() {
    let r = Record { seq: 7, seat: 1, kind: Kind::CastUnit, card: 3, lane: 2, target: 0, aux: 0, time_ms: 123456, uid: [1,2,3,4,5,6,7], auth: 0 };
    let b = r.encode();
    assert_eq!(b.len(), 24);
    assert_eq!(Record::decode(&b).unwrap(), r);
}

#[test]
fn unknown_kind_byte_is_an_error() {
    let mut b = Record { seq: 0, seat: 0, kind: Kind::Pass, card: 0, lane: -1, target: 0, aux: 0, time_ms: 0, uid: [0;7], auth: 0 }.encode();
    b[3] = 0xEE;
    assert!(Record::decode(&b).is_none());
}
```

- [x] **Step 2: Run to fail**, then **Step 3: Implement**

```rust
//! The 24-byte event record (protocol draft §4). Little-endian, fixed layout.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Kind { ClaimSeat = 1, Mulligan = 2, Charge = 3, CastUnit = 4, CastSpell = 5, Advance = 6, Pass = 7, Leave = 8 }

impl Kind {
    pub fn from_u8(b: u8) -> Option<Kind> {
        Some(match b { 1 => Kind::ClaimSeat, 2 => Kind::Mulligan, 3 => Kind::Charge, 4 => Kind::CastUnit,
                       5 => Kind::CastSpell, 6 => Kind::Advance, 7 => Kind::Pass, 8 => Kind::Leave, _ => return None })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Record {
    pub seq: u16, pub seat: u8, pub kind: Kind, pub card: u16, pub lane: i8, pub target: u8, pub aux: u8,
    pub time_ms: u32, pub uid: [u8; 7], pub auth: u8,
}

impl Record {
    pub const LEN: usize = 24;
    pub fn encode(&self) -> [u8; 24] {
        let mut b = [0u8; 24];
        b[0..2].copy_from_slice(&self.seq.to_le_bytes());
        b[2] = self.seat; b[3] = self.kind as u8;
        b[4..6].copy_from_slice(&self.card.to_le_bytes());
        b[6] = self.lane as u8; b[7] = self.target; b[8] = self.aux; b[9] = 0;
        b[10..14].copy_from_slice(&self.time_ms.to_le_bytes());
        b[14..21].copy_from_slice(&self.uid); b[21] = self.auth; // 22,23 reserved
        b
    }
    pub fn decode(b: &[u8]) -> Option<Record> {
        if b.len() < 24 { return None; }
        Some(Record {
            seq: u16::from_le_bytes([b[0], b[1]]), seat: b[2], kind: Kind::from_u8(b[3])?,
            card: u16::from_le_bytes([b[4], b[5]]), lane: b[6] as i8, target: b[7], aux: b[8],
            time_ms: u32::from_le_bytes([b[10], b[11], b[12], b[13]]),
            uid: [b[14], b[15], b[16], b[17], b[18], b[19], b[20]], auth: b[21],
        })
    }
}
```
- [x] **Step 4: Pass**, **Step 5: Commit** `feat(rules): 24-byte event record`

---

### Task 3: Game state and house rules

**Files:** `rust/tapstone-rules/src/state.rs`, `rust/tapstone-rules/tests/state.rs`

- [x] **Step 1: Failing test**

```rust
use tapstone_rules::{Game, HouseRules, Phase};

#[test]
fn new_game_deals_hands_from_seeded_decks() {
    let hr = HouseRules::default();
    let deck = [2u16, 3, 4, 5, 6, 7, 8, 9, 10, 11, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 2, 3, 4, 5, 6];
    let g = Game::new(hr, [0, 1], [deck, deck]);
    assert_eq!(g.phase, Phase::Lobby);
    let g = g.started();
    assert_eq!(g.seats[0].hand_len(), 5);
    assert_eq!(g.seats[1].hand_len(), 6, "second player bonus");
    assert_eq!(g.seats[0].castle.life, 20);
    assert_eq!(g.round, 1);
    assert_eq!(g.active, 0);
}

#[test]
fn house_rules_default_matches_decision_0011() {
    let hr = HouseRules::default();
    assert_eq!((hr.deck_size, hr.hand, hr.second_player_bonus, hr.castle_life, hr.pressure_from, hr.pressure, hr.stop_round), (25, 5, 1, 20, 8, 2, 12));
}
```

- [x] **Step 2: Fail**, **Step 3: Implement**

```rust
//! Fixed-size game state: no allocation, every collection is an array with a length.
use crate::cards::Keyword;

pub const LANES: usize = 3;
pub const CELLS: usize = 3;
pub const DECK_MAX: usize = 30;
pub const HAND_MAX: usize = 10;
pub const SEATS: usize = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HouseRules {
    pub deck_size: u8, pub hand: u8, pub second_player_bonus: u8, pub castle_life: u8,
    pub pressure_from: u8, pub pressure: u8, pub stop_round: u8,
}
impl Default for HouseRules {
    fn default() -> Self { HouseRules { deck_size: 25, hand: 5, second_player_bonus: 1, castle_life: 20, pressure_from: 8, pressure: 2, stop_round: 12 } }
}
impl HouseRules {
    pub fn bytes(&self) -> [u8; 7] { [self.deck_size, self.hand, self.second_player_bonus, self.castle_life, self.pressure_from, self.pressure, self.stop_round] }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Unit { pub design: u16, pub attack: u8, pub toughness: u8, pub damage: u8, pub keyword: Option<Keyword>, pub entered_round: u8, pub advanced_this_turn: bool }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Castle { pub life: u8 }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Seat {
    pub castle_design: u16,
    pub castle: Castle,
    pub deck: [u16; DECK_MAX], pub deck_len: u8, pub deck_pos: u8,
    pub hand: [u16; HAND_MAX], pub hand_len: u8,
    pub charged: u8, pub spent: u8, pub charged_this_round: bool,
    pub lanes_advanced: [bool; LANES],
    /// cells[lane][cell]: cell 0 = back (next to my castle), 2 = front
    pub cells: [[Option<Unit>; CELLS]; LANES],
    pub present: bool,
}
impl Seat {
    pub fn hand_len(&self) -> usize { self.hand_len as usize }
    pub fn available_mana(&self) -> u8 { self.charged - self.spent }
    pub fn units(&self) -> usize { self.cells.iter().flatten().filter(|c| c.is_some()).count() }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase { Lobby, Playing, Over }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Winner { Seat(u8), Draw }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Game {
    pub rules: HouseRules, pub phase: Phase, pub round: u8, pub active: u8,
    pub seats: [Seat; SEATS], pub winner: Option<Winner>, pub seq: u16,
}

impl Game {
    /// Lobby state with decks in play order (the arbiter shuffled; the physical deck is what the player shuffled).
    pub fn new(rules: HouseRules, castles: [u16; SEATS], decks: [[u16; 25]; SEATS]) -> Game {
        let mut seats = [Seat::empty(); SEATS];
        for s in 0..SEATS {
            seats[s].castle_design = castles[s];
            seats[s].castle.life = rules.castle_life;
            seats[s].deck[..25].copy_from_slice(&decks[s]);
            seats[s].deck_len = rules.deck_size.min(25);
            seats[s].present = true;
        }
        Game { rules, phase: Phase::Lobby, round: 0, active: 0, seats, winner: None, seq: 0 }
    }
    /// Deal opening hands and start round 1 with seat 0 active.
    pub fn started(mut self) -> Game {
        for s in 0..SEATS {
            let n = self.rules.hand + if s == 1 { self.rules.second_player_bonus } else { 0 };
            for _ in 0..n { self.seats[s].draw(); }
        }
        self.phase = Phase::Playing; self.round = 1; self.active = 0;
        self
    }
}
impl Seat {
    pub const fn empty() -> Seat {
        Seat { castle_design: 0, castle: Castle { life: 0 }, deck: [0; DECK_MAX], deck_len: 0, deck_pos: 0,
               hand: [0; HAND_MAX], hand_len: 0, charged: 0, spent: 0, charged_this_round: false,
               lanes_advanced: [false; LANES], cells: [[None; CELLS]; LANES], present: false }
    }
    /// Draw one; a drawn-out deck draws nothing (no penalty in v0).
    pub fn draw(&mut self) -> bool {
        if self.deck_pos >= self.deck_len || (self.hand_len as usize) >= HAND_MAX { return false; }
        self.hand[self.hand_len as usize] = self.deck[self.deck_pos as usize];
        self.hand_len += 1; self.deck_pos += 1; true
    }
    pub fn remove_from_hand(&mut self, design: u16) -> bool {
        if let Some(i) = self.hand[..self.hand_len as usize].iter().position(|&c| c == design) {
            for j in i..(self.hand_len as usize - 1) { self.hand[j] = self.hand[j + 1]; }
            self.hand_len -= 1; true
        } else { false }
    }
}
```
- [x] **Step 4: Pass**, **Step 5: Commit** `feat(rules): fixed-size game state and house rules`

---

### Task 4: Applying events — the rules

**Files:** `rust/tapstone-rules/src/rules.rs`, `rust/tapstone-rules/tests/rules.rs`

- [x] **Step 1: Failing tests** (each is one rule; write them all, they fail together)

```rust
use tapstone_rules::{Game, HouseRules, Kind, Record, Refusal, Phase, Winner};

fn deck() -> [u16; 25] { [2,3,4,5,6,7,8,9,10,11, 2,3,4,5,6,7,8,9,10,11, 2,3,4,5,6] }
fn game() -> Game { Game::new(HouseRules::default(), [0, 1], [deck(), deck()]).started() }
fn tap(seat: u8, kind: Kind, card: u16, lane: i8, target: u8) -> Record {
    Record { seq: 0, seat, kind, card, lane, target, aux: 0, time_ms: 0, uid: [0; 7], auth: 0 }
}

#[test]
fn charge_gives_permanent_mana_once_per_round() {
    let mut g = game();
    assert!(g.apply(&tap(0, Kind::Charge, 2, -1, 0)).is_ok());
    assert_eq!(g.seats[0].charged, 1);
    assert_eq!(g.seats[0].hand_len(), 4);
    assert_eq!(g.apply(&tap(0, Kind::Charge, 3, -1, 0)), Err(Refusal::AlreadyChargedThisRound));
}

#[test]
fn casting_needs_mana_and_the_card_in_hand() {
    let mut g = game();
    assert_eq!(g.apply(&tap(0, Kind::CastUnit, 2, 0, 0)), Err(Refusal::NoMana { need: 1, have: 0 }));
    g.apply(&tap(0, Kind::Charge, 11, -1, 0)).unwrap();
    assert_eq!(g.apply(&tap(0, Kind::CastUnit, 7, 0, 0)), Err(Refusal::NoMana { need: 3, have: 1 }));
    g.apply(&tap(0, Kind::CastUnit, 2, 0, 0)).unwrap();          // Cinder Whelp, cost 1, into lane 0 back cell
    assert!(g.seats[0].cells[0][0].is_some());
    assert_eq!(g.apply(&tap(0, Kind::CastUnit, 2, 0, 0)), Err(Refusal::NotInHand)); // only one Whelp was in the first 5 cards
}

#[test]
fn rush_enters_mid_and_occupied_cell_refuses() {
    let mut g = game();
    for _ in 0..3 { g.apply(&tap(0, Kind::Charge, g.seats[0].hand[0], -1, 0)).unwrap(); pass_round(&mut g); }
    // seat 0 has 3 mana at round 4; ensure Ashen Vanguard (3) is in hand by drawing (deck order puts a 3 early)
    let hand: Vec<u16> = g.seats[0].hand[..g.seats[0].hand_len()].to_vec();
    assert!(hand.contains(&3));
    g.apply(&tap(0, Kind::CastUnit, 3, 1, 0)).unwrap();
    assert!(g.seats[0].cells[1][1].is_some(), "Rush enters the mid cell");
}

#[test]
fn not_your_turn_and_pass_advances_turn_and_round() {
    let mut g = game();
    assert_eq!(g.apply(&tap(1, Kind::Charge, 2, -1, 0)), Err(Refusal::NotYourTurn));
    g.apply(&tap(0, Kind::Pass, 0, -1, 0)).unwrap();
    assert_eq!((g.active, g.round), (1, 1));
    g.apply(&tap(1, Kind::Pass, 0, -1, 0)).unwrap();
    assert_eq!((g.active, g.round), (0, 2));
    assert_eq!(g.seats[0].hand_len(), 6, "draw at the start of your turn");
}

#[test]
fn front_units_hit_the_castle_when_unopposed() {
    let mut g = game();
    g.apply(&tap(0, Kind::Charge, 11, -1, 0)).unwrap();
    g.apply(&tap(0, Kind::CastUnit, 2, 0, 0)).unwrap();     // Whelp 2/1 Haste in lane 0 back
    g.apply(&tap(0, Kind::Advance, 0, 0, 0)).unwrap();      // Haste: may advance the turn it enters → mid
    g.apply(&tap(0, Kind::Pass, 0, -1, 0)).unwrap();
    g.apply(&tap(1, Kind::Pass, 0, -1, 0)).unwrap();
    g.apply(&tap(0, Kind::Advance, 0, 0, 0)).unwrap();      // → front
    g.apply(&tap(0, Kind::Pass, 0, -1, 0)).unwrap();        // combat: front Whelp hits castle for 2
    assert_eq!(g.seats[1].castle.life, 18);
}

#[test]
fn pressure_from_round_8_and_stop_at_12() {
    let mut g = game();
    while g.round < 8 { pass_round(&mut g); }
    let before = g.seats[0].castle.life;
    pass_round(&mut g); // round 8 → 9: both castles took pressure at the start of their turns
    assert_eq!(g.seats[0].castle.life, before - 2);
    while g.phase == Phase::Playing { pass_round(&mut g); }
    assert_eq!(g.round, 12);
    assert_eq!(g.winner, Some(Winner::Seat(1)), "equal life, equal units → second player");
    assert_eq!(g.apply(&tap(0, Kind::Pass, 0, -1, 0)), Err(Refusal::GameOver));
}

fn pass_round(g: &mut Game) {
    g.apply(&tap(g.active, Kind::Pass, 0, -1, 0)).unwrap();
    g.apply(&tap(g.active, Kind::Pass, 0, -1, 0)).unwrap();
}
```

- [x] **Step 2: Run to fail**, **Step 3: Implement** `rules.rs`

```rust
use crate::cards::{design, CardKind, Effect, Keyword};
use crate::event::{Kind, Record};
use crate::state::{Game, Phase, Unit, Winner, CELLS, LANES, SEATS};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal { NotYourTurn, NotInHand, NoMana { need: u8, have: u8 }, CellOccupied, AlreadyChargedThisRound,
                   AlreadyAdvancedLane, BadTarget, UnknownCard, GameOver, LaneOutOfRange, NotPlaying }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Applied { Charged, Summoned { lane: u8, cell: u8 }, Spell, Advanced { lane: u8, moved: u8 }, TurnEnded { combat_damage: [u8; SEATS] }, GameEnded(Winner) }

impl Game {
    pub fn apply(&mut self, r: &Record) -> Result<Applied, Refusal> {
        if self.phase == Phase::Over { return Err(Refusal::GameOver); }
        if self.phase != Phase::Playing { return Err(Refusal::NotPlaying); }
        if r.seat as usize >= SEATS || r.seat != self.active { return Err(Refusal::NotYourTurn); }
        let out = match r.kind {
            Kind::Charge => self.charge(r),
            Kind::CastUnit => self.cast_unit(r),
            Kind::CastSpell => self.cast_spell(r),
            Kind::Advance => self.advance(r),
            Kind::Pass => Ok(self.end_turn()),
            Kind::ClaimSeat | Kind::Mulligan | Kind::Leave => Err(Refusal::NotPlaying), // lobby-only kinds; Task 7
        }?;
        self.seq = self.seq.wrapping_add(1);
        Ok(out)
    }

    fn me(&mut self) -> &mut crate::state::Seat { &mut self.seats[self.active as usize] }

    fn charge(&mut self, r: &Record) -> Result<Applied, Refusal> {
        let s = self.me();
        if s.charged_this_round { return Err(Refusal::AlreadyChargedThisRound); }
        if !s.remove_from_hand(r.card) { return Err(Refusal::NotInHand); }
        s.charged += 1; s.charged_this_round = true;
        Ok(Applied::Charged)
    }

    fn pay(&mut self, cost: u8) -> Result<(), Refusal> {
        let s = self.me();
        let have = s.available_mana();
        if have < cost { return Err(Refusal::NoMana { need: cost, have }); }
        s.spent += cost; Ok(())
    }

    fn cast_unit(&mut self, r: &Record) -> Result<Applied, Refusal> {
        let d = design(r.card).ok_or(Refusal::UnknownCard)?;
        let CardKind::Unit { attack, toughness, keyword } = d.kind else { return Err(Refusal::BadTarget) };
        if !(0..LANES as i8).contains(&r.lane) { return Err(Refusal::LaneOutOfRange); }
        let lane = r.lane as usize;
        let cell = if keyword == Some(Keyword::Rush) { 1 } else { 0 };
        if !self.me().hand[..self.me().hand_len()].contains(&r.card) { return Err(Refusal::NotInHand); }
        if self.me().cells[lane][cell].is_some() { return Err(Refusal::CellOccupied); }
        let need = d.cost; let have = self.me().available_mana();
        if have < need { return Err(Refusal::NoMana { need, have }); }
        self.me().spent += need;
        self.me().remove_from_hand(r.card);
        let round = self.round;
        self.me().cells[lane][cell] = Some(Unit { design: d.id, attack, toughness, damage: 0, keyword, entered_round: round, advanced_this_turn: false });
        Ok(Applied::Summoned { lane: lane as u8, cell: cell as u8 })
    }

    fn cast_spell(&mut self, r: &Record) -> Result<Applied, Refusal> {
        let d = design(r.card).ok_or(Refusal::UnknownCard)?;
        let CardKind::Spell(effect) = d.kind else { return Err(Refusal::BadTarget) };
        if !self.me().hand[..self.me().hand_len()].contains(&r.card) { return Err(Refusal::NotInHand); }
        // target byte: 0xFF = enemy castle; else (seat<<4 | lane<<2 | cell)
        let opp = 1 - self.active as usize;
        let resolved: Result<(), Refusal> = match effect {
            Effect::Damage { amount, castle_ok } => {
                if r.target == 0xFF { if !castle_ok { return Err(Refusal::BadTarget) }; self.seats[opp].castle.life = self.seats[opp].castle.life.saturating_sub(amount); Ok(()) }
                else { let (s, l, c) = unpack(r.target); let u = self.seats[s].cells[l][c].as_mut().ok_or(Refusal::BadTarget)?; u.damage = u.damage.saturating_add(amount); Ok(()) }
            }
            Effect::Heal { amount } => { let (s, l, c) = unpack(r.target); let u = self.seats[s].cells[l][c].as_mut().ok_or(Refusal::BadTarget)?; u.damage = u.damage.saturating_sub(amount); Ok(()) }
            Effect::Destroy { max_toughness } => { let (s, l, c) = unpack(r.target); let u = self.seats[s].cells[l][c].ok_or(Refusal::BadTarget)?; if u.toughness > max_toughness { return Err(Refusal::BadTarget) } self.seats[s].cells[l][c] = None; Ok(()) }
            Effect::Shift => { let (s, l, c) = unpack(r.target); let dir: i8 = if r.aux == 0 { -1 } else { 1 }; let nl = l as i8 + dir;
                if !(0..LANES as i8).contains(&nl) { return Err(Refusal::LaneOutOfRange) } if self.seats[s].cells[nl as usize][c].is_some() { return Err(Refusal::CellOccupied) }
                let u = self.seats[s].cells[l][c].take().ok_or(Refusal::BadTarget)?; self.seats[s].cells[nl as usize][c] = Some(u); Ok(()) }
            Effect::Draw { count } => { for _ in 0..count { self.me().draw(); } Ok(()) }
        };
        resolved?;
        self.pay(d.cost)?;               // pay after validation so a refused target costs nothing
        self.me().remove_from_hand(r.card);
        self.sweep_dead();
        Ok(Applied::Spell)
    }

    fn advance(&mut self, r: &Record) -> Result<Applied, Refusal> {
        if !(0..LANES as i8).contains(&r.lane) { return Err(Refusal::LaneOutOfRange); }
        let lane = r.lane as usize; let round = self.round;
        let s = self.me();
        if s.lanes_advanced[lane] { return Err(Refusal::AlreadyAdvancedLane); }
        let mut moved = 0;
        for cell in (0..CELLS - 1).rev() {            // front-most first so a column shuffles forward
            if let Some(u) = s.cells[lane][cell] {
                let may = u.entered_round < round || u.keyword == Some(Keyword::Haste);
                if may && s.cells[lane][cell + 1].is_none() { s.cells[lane][cell + 1] = Some(u); s.cells[lane][cell] = None; moved += 1; }
            }
        }
        s.lanes_advanced[lane] = true;
        Ok(Applied::Advanced { lane: lane as u8, moved })
    }

    fn end_turn(&mut self) -> Applied {
        let dmg = self.combat();
        self.sweep_dead();
        // next turn
        let next = 1 - self.active as usize;
        if next == 0 { self.round += 1; }
        self.active = next as u8;
        if self.round > self.rules.stop_round || (self.round == self.rules.stop_round && next == 0 && self.turns_played_at_stop()) {
            return self.finish();
        }
        let s = &mut self.seats[next];
        s.spent = 0; s.charged_this_round = false; s.lanes_advanced = [false; LANES];
        for l in 0..LANES { for c in 0..CELLS { if let Some(u) = s.cells[l][c].as_mut() { u.advanced_this_turn = false; } } }
        if self.round >= self.rules.pressure_from { s.castle.life = s.castle.life.saturating_sub(self.rules.pressure); }
        s.draw();
        if self.seats[0].castle.life == 0 || self.seats[1].castle.life == 0 { return self.finish(); }
        Applied::TurnEnded { combat_damage: dmg }
    }

    fn turns_played_at_stop(&self) -> bool { true } // both seats have played round stop_round when we wrap to seat 0 again

    fn finish(&mut self) -> Applied {
        self.phase = Phase::Over;
        let a = &self.seats[0]; let b = &self.seats[1];
        let w = if a.castle.life != b.castle.life { Winner::Seat(if a.castle.life > b.castle.life { 0 } else { 1 }) }
                else if a.units() != b.units() { Winner::Seat(if a.units() > b.units() { 0 } else { 1 }) }
                else { Winner::Seat(1) };
        self.winner = Some(w);
        Applied::GameEnded(w)
    }

    /// Simultaneous combat for the active seat's turn end: my units hit theirs, theirs hit mine.
    fn combat(&mut self) -> [u8; SEATS] {
        let mut castle_dmg = [0u8; SEATS];
        let mut hits: [[[u8; CELLS]; LANES]; SEATS] = [[[0; CELLS]; LANES]; SEATS];
        for me in 0..SEATS {
            let opp = 1 - me;
            for lane in 0..LANES {
                for cell in 0..CELLS {
                    let Some(u) = self.seats[me].cells[lane][cell] else { continue };
                    let is_front = cell == CELLS - 1;
                    let ranged = u.keyword == Some(Keyword::Ranged);
                    if !is_front && !ranged { continue; }
                    match target_in_lane(&self.seats[opp].cells[lane]) {
                        Some(tc) => hits[opp][lane][tc] = hits[opp][lane][tc].saturating_add(u.attack),
                        None => castle_dmg[opp] = castle_dmg[opp].saturating_add(u.attack),
                    }
                }
            }
        }
        for s in 0..SEATS {
            self.seats[s].castle.life = self.seats[s].castle.life.saturating_sub(castle_dmg[s]);
            for lane in 0..LANES { for cell in 0..CELLS {
                if let Some(u) = self.seats[s].cells[lane][cell].as_mut() {
                    let mut h = hits[s][lane][cell];
                    if u.keyword == Some(Keyword::Shield1) && h > 0 { h -= 1; }
                    u.damage = u.damage.saturating_add(h);
                }
            } }
        }
        castle_dmg
    }

    fn sweep_dead(&mut self) {
        for s in 0..SEATS { for l in 0..LANES { for c in 0..CELLS {
            if let Some(u) = self.seats[s].cells[l][c] { if u.damage >= u.toughness { self.seats[s].cells[l][c] = None; } }
        } } }
    }
}

/// Nearest enemy in the lane from the attacker's side: their front cell first, then mid, then back;
/// a Taunt unit anywhere is preferred if it is the nearest *Taunt*. Returns the cell index.
fn target_in_lane(enemy: &[Option<Unit>; CELLS]) -> Option<usize> {
    let order = [CELLS - 1, 1, 0];
    if let Some(&t) = order.iter().find(|&&c| matches!(enemy[c], Some(u) if u.keyword == Some(Keyword::Taunt))) { return Some(t); }
    order.iter().copied().find(|&c| enemy[c].is_some())
}

fn unpack(t: u8) -> (usize, usize, usize) { (((t >> 4) & 1) as usize, ((t >> 2) & 3) as usize, (t & 3) as usize) }
```
Fix the test's `pass_round` and stop logic against the implementation as you go: the rule is *the game ends when round `stop_round` has been completed by both seats*, so `end_turn` finishes when wrapping from seat 1 to seat 0 with `round == stop_round`. Adjust the condition to exactly that and delete `turns_played_at_stop`.

- [x] **Step 4: Run to pass** `cargo test -p tapstone-rules` → all rules tests green.
- [x] **Step 5: Commit** `feat(rules): apply taps — charge, cast, advance, combat, pressure, end`

---

### Task 5: Canonical state and the hash chain

**Files:** `rust/tapstone-rules/src/hash.rs`, `rust/tapstone-rules/tests/determinism.rs`

- [x] **Step 1: Failing test**

```rust
use tapstone_rules::{hash::{Chain, canonical_len}, Game, HouseRules, Kind, Record};

#[test]
fn same_records_same_chain_and_a_changed_record_changes_it() {
    let deck = [2u16,3,4,5,6,7,8,9,10,11, 2,3,4,5,6,7,8,9,10,11, 2,3,4,5,6];
    let recs = [
        Record { seq: 0, seat: 0, kind: Kind::Charge, card: 11, lane: -1, target: 0, aux: 0, time_ms: 1, uid: [0;7], auth: 0 },
        Record { seq: 1, seat: 0, kind: Kind::CastUnit, card: 2, lane: 0, target: 0, aux: 0, time_ms: 2, uid: [0;7], auth: 0 },
        Record { seq: 2, seat: 0, kind: Kind::Pass, card: 0, lane: -1, target: 0, aux: 0, time_ms: 3, uid: [0;7], auth: 0 },
    ];
    let run = |recs: &[Record]| {
        let mut g = Game::new(HouseRules::default(), [0, 1], [deck, deck]).started();
        let mut chain = Chain::genesis(&g.rules);
        for r in recs { g.apply(r).unwrap(); chain.step(r, &g); }
        chain.head()
    };
    assert_eq!(run(&recs), run(&recs));
    let mut other = recs; other[1].lane = 1;
    assert_ne!(run(&recs), run(&other));
    assert!(canonical_len() <= 512, "canonical state must fit a small fixed buffer on the shrine");
}
```

- [x] **Step 2: Fail**, **Step 3: Implement**

```rust
//! Canonical state bytes and the chained hash (spec §3, decision 0016).
use sha2::{Digest, Sha256};
use crate::event::Record;
use crate::state::{Game, HouseRules, CELLS, LANES, SEATS};

pub const CANON: usize = 2 + 2 + SEATS * (2 + 1 + 1 + 1 + 1 + LANES * CELLS * 4 + 1 + 10 * 2);
pub const fn canonical_len() -> usize { CANON }

/// Deterministic byte image of everything that affects play. Hand *contents* are included (the
/// arbiter knows them via the tap stream: cards leave hands only through committed events).
pub fn canonical(g: &Game, out: &mut [u8; CANON]) {
    let mut i = 0;
    let mut put = |b: &[u8], i: &mut usize| { out[*i..*i + b.len()].copy_from_slice(b); *i += b.len(); };
    put(&[g.round, g.active], &mut i);
    put(&g.seq.to_le_bytes(), &mut i);
    for s in &g.seats {
        put(&s.castle_design.to_le_bytes(), &mut i);
        put(&[s.castle.life, s.charged, s.spent, s.deck_pos], &mut i);
        for l in 0..LANES { for c in 0..CELLS {
            match s.cells[l][c] { Some(u) => put(&[(u.design & 0xFF) as u8, (u.design >> 8) as u8, u.damage, u.entered_round], &mut i),
                                  None => put(&[0xFF, 0xFF, 0, 0], &mut i) }
        } }
        put(&[s.hand_len], &mut i);
        for h in 0..10 { let v = if (h as u8) < s.hand_len { s.hand[h] } else { 0xFFFF }; put(&v.to_le_bytes(), &mut i); }
    }
    debug_assert_eq!(i, CANON);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Chain { head: [u8; 8], pub len: u32 }

impl Chain {
    pub fn genesis(rules: &HouseRules) -> Chain {
        let mut h = Sha256::new(); h.update(b"tapstone:v0"); h.update(rules.bytes());
        let d = h.finalize(); let mut head = [0u8; 8]; head.copy_from_slice(&d[..8]);
        Chain { head, len: 0 }
    }
    pub fn step(&mut self, r: &Record, g: &Game) {
        let mut canon = [0u8; CANON]; canonical(g, &mut canon);
        let mut h = Sha256::new(); h.update(self.head); h.update(r.encode()); h.update(canon);
        let d = h.finalize(); self.head.copy_from_slice(&d[..8]); self.len += 1;
    }
    pub fn head(&self) -> [u8; 8] { self.head }
}
```
- [x] **Step 4: Pass**; also re-run the `thumbv7em-none-eabi` build to confirm `sha2` stays no_std.
- [x] **Step 5: Commit** `feat(rules): canonical state and hash chain`

---

### Task 6: Card set from TOML (generator)

**Files:** `game/cards/set1/*.toml` (12 files), `tools/compile_cards.py`, regenerated `rust/tapstone-rules/src/cards.rs` (the `SET1` block only)

- [x] **Step 1: Write the twelve TOML designs** matching Task 1 exactly (see `docs/design/card-data-format.md`; `effect` strings: `damage:2:castle`, `damage:3:unit`, `heal:N:unit`, `destroy:N`, `shift`, `draw:2`).
- [x] **Step 2: Generator** `tools/compile_cards.py` (Python 3, stdlib `tomllib`): reads `game/cards/<set>/*.toml` sorted by `id`, validates unique contiguous ids, keywords in the closed list, exactly one effect for spells, and rewrites the region between `// BEGIN GENERATED SET1` and `// END GENERATED SET1` in `cards.rs`. Add those markers around the static in Task 1's file first.
- [x] **Step 3: Check idempotence**: run the generator, `cargo test -p tapstone-rules`, `git diff --stat` shows only whitespace or nothing.
- [x] **Step 4: Commit** `feat(cards): set 1 test designs as TOML with a generator into the rules crate`

---

### Task 7: Lobby events (claim seat, mulligan) and house-rule application

**Files:** `rules.rs` additions, `tests/lobby.rs`

- [x] **Step 1: Failing tests**: a `ClaimSeat` record in `Lobby` sets `castle_design` and marks present; two claims start the game (`Phase::Playing`); `Mulligan` in the first turn before any other action redraws the hand from the deck's remaining order (no penalty); `Game::with_rules(HouseRules)` in lobby changes `castle_life` etc. and is refused once playing.
- [x] **Step 2–4:** implement `lobby_apply` for `ClaimSeat`/`Mulligan`, route them in `apply` when `phase == Lobby` or on turn 1 before `seq` advances; test; commit `feat(rules): lobby — claim seats, mulligan, house rules`.

---

### Task 8: The harness — scripted seats, arbiter, transcripts, goldens

**Files:** `rust/tapstone-sim/src/{lib,seat,arbiter,transcript,main}.rs`, `rust/tapstone-sim/golden/seed-{1,2,3}.json`, `rust/tapstone-sim/tests/golden.rs`

- [x] **Step 1: Failing test**

```rust
use tapstone_sim::{play_seeded, Transcript};

#[test]
fn seeded_games_are_reproducible_and_end() {
    let a = play_seeded(1, 500);
    let b = play_seeded(1, 500);
    assert_eq!(a.final_hash, b.final_hash);
    assert!(a.game_over, "500 taps is plenty to reach round 12");
    assert!(a.records.len() < 500);
}

#[test]
fn goldens_match() {
    for seed in [1u64, 2, 3] {
        let t = play_seeded(seed, 500);
        let golden: Transcript = serde_json::from_str(&std::fs::read_to_string(format!("golden/seed-{seed}.json")).unwrap()).unwrap();
        assert_eq!(t.final_hash, golden.final_hash, "seed {seed} diverged from its golden transcript");
    }
}
```

- [x] **Step 2–3: Implement**
  - `seat.rs`: `ScriptedSeat { rng: StdRng }` with `next_tap(&Game) -> Record`: with weights, pick a legal-looking action — charge the cheapest card if not charged yet (40%), cast the most expensive affordable unit into the emptiest lane (30%), cast a spell at the nearest enemy unit or castle (10%), advance a lane with units (10%), pass (10%); always pass when nothing else is possible. Illegal picks are fine: the arbiter refuses and the seat tries again (count refusals in the transcript).
  - `arbiter.rs`: `Arbiter { game, chain, records }`; `commit(tap) -> Result<Applied, Refusal>` assigns `seq`, applies, steps the chain, appends.
  - `transcript.rs`: `#[derive(Serialize, Deserialize)] Transcript { seed, house_rules, records: Vec<RecordJson>, hashes: Vec<String>, refusals: u32, final_hash: String, winner, rounds }`.
  - `main.rs`: `play --seed N [--taps 500] [--json]` prints a summary or the transcript; `golden update` writes `golden/seed-{1,2,3}.json`; `golden check` is the test.
- [x] **Step 4:** `cargo run -p tapstone-sim -- golden update && cargo test -p tapstone-sim` → green.
- [x] **Step 5: Commit** `feat(sim): scripted seats, arbiter, transcripts and golden games`

---

### Task 9: Property test — the engine never panics and both hosts agree

**Files:** `rust/tapstone-sim/tests/props.rs`

- [x] **Step 1:** proptest over random `Record`s (any bytes decoded via `Record::decode`, ~2,000 cases): `apply` returns `Ok` or `Err` and never panics; the chain after N applications equals a second run over the recorded *accepted* records only (refused taps are not part of the transcript).
- [x] **Step 2:** fix any panic found (index bounds on `lane`/`target`, `hand_len` overflow at `HAND_MAX`).
- [x] **Step 3: Commit** `test(sim): never-panic and replay-equivalence properties`

---

### Task 10: Docs and the smol handoff note

**Files:** `rust/README.md`, `CLAUDE.md` (Read first + a `rust/` line), `docs/protocol/smol-issues.md`

- [x] **Step 1:** `rust/README.md`: how to build, test, the no_std gate command, how smol vendors the crate (copy `rust/tapstone-rules` to `smol/rust/tapstone-rules` as a path dep, `default-features = false`, byte-identical `src/`, the sigil-names pattern).
- [x] **Step 2:** `docs/protocol/smol-issues.md`: the nine issues from the protocol draft §8 as ready-to-paste GitHub issue bodies, each with acceptance tests, plus a tenth: "vendor `tapstone-rules` and add the Framebuffer app slot (0010)".
- [x] **Step 3a:** Commit `docs: rust README, smol issue drafts` (landed as `docs: rust README, protocol draft aligned with the crate, smol issue drafts, decisions 0021–0023`).
- [ ] **Step 3b:** tag `rules-v0.1.0` (on `main` after the PR merges).

---

## Self-review notes
- Spec §3 (one crate, hash chain, 24-byte record) → Tasks 2, 4, 5. §4 game rules → Tasks 3, 4, 7. §8 testing (property tests, scripted seats, goldens) → Tasks 8, 9. §9 phase 1 → all of the above; phase 2 (firmware) starts from Task 10's issue drafts.
- Names used consistently: `Record`, `Kind`, `Game`, `HouseRules`, `Refusal`, `Applied`, `Chain`, `SET1`, `design()`, `Transcript`, `play_seeded`.
- Known simplification for phase 1: Duel plays alternating turns (spec allows it for playtest one); the ring-and-rounds generalisation (Q19) is phase 4 and touches `state.rs` (`SEATS` becomes a house rule, `active` becomes a round bell).

---

## Execution notes (2026-09-20)

All tasks executed on `feat/phase1-rules-crate` by subagent-driven development, each with a
red→green test run and the gates (`fmt --check`, `clippy -D warnings`, thumbv7em, later Xtensa).
Deviations from the text above, all deliberate:

- **Plan tests corrected before use.** Several Task 4 tests named cards that were not in the seeded
  opening hand (`[2,3,4,5,6]`); the tests were re-traced against the deck order and the card ids
  fixed. One traced expectation (`combat_damage: [0, 0]`) was wrong by the rules and became `[2, 0]`.
- **Spell ordering.** Mana and hand are checked *before* the effect resolves; spend, discard and
  sweep happen after. The plan's code resolved first.
- **Target byte bounds.** `unpack` refuses lane/cell ≥ 3 with `BadTarget`; no index can panic.
- **Lethal spell** finishes the game in the same `apply` (`Applied::GameEnded`), see 0021.
- **Combat targeting ruling** (Taunt draws all; melee only from/into the front cell; Ranged nearest;
  Shield 1 absorbs one), see 0021 — the plan's `target_in_lane` was ambiguous.
- **Task 7 decisions.** `Game::new` takes deck slices clamped to `DECK_MAX` and `deck_size`; seats
  start absent and `ClaimSeat` seats them (the second claim deals and starts play); `Seat.acted` /
  `Seat.mulliganed` gate a one-shot first-turn mulligan; `Game::with_rules` is Lobby-only;
  `started()` is a Lobby-only test shortcut.
- **Canonical image** gained phase, winner and a flags byte (charged, lanes advanced, acted,
  mulliganed, present); `CANON = 134`, see 0022.
- **SET1 → 14 designs and a slice.** Mend and Riptide added (0023); `SET1: &[CardDesign]` is
  generated from TOML between markers by `tools/compile_cards.py` (`--check` for CI).
- **Transcript shape.** Each JSON record carries its own `hash` (null for lobby records) instead of
  a parallel `hashes` array; `replay` recomputes them independently of the arbiter.
- **Never-panic evidence.** 2000 arbitrary-record cases plus 300 random-tap arbiter runs (40 787
  refusals) found no panic and no divergence; no proptest regression file exists.
- **No tag on the branch.** `rules-v0.1.0` is applied on `main` after the PR merges (JP's
  branch + PR rule); Task 10 Step 3's "tag" is therefore deferred, not done.
