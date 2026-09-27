# Arena Service (phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `tapstone-arena`, the laptop arena that arbitrates a Duel over a smol gateway, draws the battlefield in a browser, keeps the commander ledger, recovers from arena-dark, and posts transcripts, as specified in `docs/superpowers/specs/2026-09-23-arena-service-design.md`.

**Architecture:** A sans-IO arbiter core (`ArenaCore::handle(Input, now_ms) -> Vec<Output>`) over the existing `tapstone-rules` engine, with thin adapters for USB serial, HTTP/SSE, SQLite and outbound posting. Two new `no_std` crates carry the shared objects: `tapstone-proto` (the one MATCH codec, the TSX1 transcript, and a reference follower that stands in for shrine firmware in tests), and `tapstone-progression` (0034's tables and ClaimSeat derivation, shared by the arena and the sim's bound run).

**Tech Stack:** Rust 2024 (rust-version 1.95), `sha2 0.11` (already in the tree), tokio, axum 0.8 (SSE), rusqlite 0.32 (`bundled`), serialport 4, serde/serde_json, toml, clap; Python ≥ 3.11 for the item generator; plain HTML + Canvas 2D + an ES module for the page (no build step).

**A ruling this plan depends on, read first:** 0036 (every draw is a tap; the engine holds each
deck as a list) is implemented on main since #63, with `Kind::Draw`, owed draws, `DrawOwed` /
`NoDrawOwed` / `NotInDeck`, and genesis hashing each seat's sorted list. A mulligan owes the hand
size returned (#61). The plan assumes that engine throughout. The harness's shrines and the
follower test tap their owed draws first, from the top of each list, and Task 11b adds the one draw
rule the engine cannot see, a physical copy drawn at most once per shuffle-in (#60).

**Conventions for every task:** commands run from `rust/` unless a path says otherwise; cargo is at `~/.cargo/bin`. "The gates" means, in this order:

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo build -p tapstone-rules --target thumbv7em-none-eabi
cargo build -p tapstone-proto --target thumbv7em-none-eabi
cargo build -p tapstone-progression --target thumbv7em-none-eabi
../tools/compile_cards.py --check
../tools/compile_items.py --check
cargo test --workspace
cargo run -q --release -p tapstone-sim -- golden check
cargo run -q --release -p tapstone-sim -- commander --games 4000 --decks mirror-ember
cargo run -q --release -p tapstone-sim -- commander --games 4000 --decks mirror-tide
```

The code in this plan is complete but not rustfmt-shaped: run `cargo fmt` after pasting, before the
gates. **Tasks 1–7 are checked from this text by `tools/check_plan_code.py`**, which extracts every
`path`-labelled code block for them into a fresh `git archive` of the repo, then builds, tests,
lints and measures it. Read the script's docstring for what "checked" means and what it does not
cover; the result it prints is the evidence, not this sentence. The fixes that run
found are already folded in. Tasks 8 onward have not been compiled from the text: expect the
ordinary friction of a long plan there (a missing import, a borrow to reorder), and fix it inside
the task rather than redesigning.

Commit messages are conventional and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage files by name, never `git add -A`. Per `docs/verification.md`, **every new check is perturbed once**: break the thing on purpose, watch the check go red, restore. Each task names its perturbation.

---

## File map

```
game/items/set1/it1-000.toml … it1-005.toml     item designs (D12)
tools/compile_items.py                          item generator (mirrors compile_cards.py)
rust/Cargo.toml                                 workspace members += 3 crates
rust/tapstone-progression/
  Cargo.toml
  src/lib.rs          tables, XP/level, Item/Slot/ItemDesign, derive_commander, flat mode
  src/items.rs        GENERATED ITEMS1 region
  tests/progression.rs
rust/tapstone-sim/src/progression.rs            tables replaced by re-exports; measurement stays
rust/tapstone-proto/
  Cargo.toml
  src/lib.rs          re-exports
  src/wire.rs         Cursor/Writer helpers
  src/frame.rs        Header + Frame enum + every kind's codec
  src/transcript.rs   TSX1 header + transcript_sha
  src/follower.rs     reference follower (no_std, fixed capacity)
  tests/frame.rs  tests/transcript.rs  tests/follower.rs
rust/tapstone-arena/
  Cargo.toml
  build.rs            git facts for /api/version
  src/lib.rs
  src/config.rs       arena.toml
  src/registry.rs     copies.jsonl → uid→design; Trusting mode for desk/tests
  src/decks.rs        decks/*.toml → sigil→list
  src/core/mod.rs     ArenaCore, Input, Output, StatsSource, Signer
  src/core/lobby.rs   claims, seating, D/E handling
  src/core/play.rs    taps, commits, retransmit, pause, result
  src/core/dark.rs    journal replay, hand-back, verification
  src/ledger/mod.rs   SQLite schema + queries
  src/ledger/apply.rs apply-once result: XP, streak, loot, melt
  src/view.rs         ViewModel JSON
  src/link/mod.rs     Link trait
  src/link/lines.rs   @TS1 line codec
  src/link/serial.rs  port discovery + reader/writer threads
  src/link/desk.rs    in-process followers driven by ScriptedSeat
  src/http.rs         axum: /, /events (SSE), /api/version, /dev/*
  src/poster.rs       outbox drain
  src/main.rs         wiring
  web/index.html  web/app.js  web/style.css  web/favicon.svg
  tests/harness.rs (shared test harness module)  tests/core_match.rs  tests/core_loss.rs
  tests/dark.rs  tests/ledger.rs  tests/lines.rs  tests/view.rs  tests/poster.rs  tests/serial_pty.rs
decks/                                          (existing rust/tapstone-sim/decks is the source)
docs/protocol/tapstone-protocol-draft.md        new frame rows, TSX1 36 B, §4.2 amendment, §6 JSON
docs/protocol/arena-issues.md                   ready-to-paste issues: smol gateway, scry-glass, realmwatch
rust/README.md                                  new crates, gates, the arena
```

---

## Task 1: `tapstone-progression` — XP, levels, slots, the item vocabulary

**Files:**
- Modify: `rust/Cargo.toml`
- Create: `rust/tapstone-progression/Cargo.toml`, `rust/tapstone-progression/src/lib.rs`, `rust/tapstone-progression/src/items.rs`, `rust/tapstone-progression/tests/progression.rs`

- [ ] **Step 1: Add the crate to the workspace and write its manifest**

`rust/Cargo.toml` members line becomes:

```toml
members = ["tapstone-rules", "tapstone-proto", "tapstone-progression", "tapstone-sim", "tapstone-arena", "shrine-render", "shrine-preview"]
```

(`tapstone-proto` and `tapstone-arena` are created in Tasks 4 and 9. Until then, add only `"tapstone-progression"` and add the other two in their own tasks, so every commit builds.)

`rust/tapstone-progression/Cargo.toml`:

```toml
[package]
name = "tapstone-progression"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true
description = "Tapstone commander progression (0030/0031/0034): XP, levels, slots, items and ClaimSeat stat derivation. no_std, no alloc."

[dependencies]
tapstone-rules = { path = "../tapstone-rules" }
```

- [ ] **Step 2: Write the failing tests**

`rust/tapstone-progression/tests/progression.rs`:

```rust
use tapstone_progression::{
    ATTACK_AT, LEVEL_MAX, THIRD_SLOT_AT, TOUGHNESS_AT, XP_PER_LEVEL, level_bonus, level_for_xp,
    slots, xp_next,
};

#[test]
fn level_is_one_plus_xp_over_five_capped_at_ten() {
    // 0030 ruling: "XP per level is flat: 5 XP a level. Level 10 is 45 XP".
    assert_eq!(XP_PER_LEVEL, 5);
    assert_eq!(level_for_xp(0), 1);
    assert_eq!(level_for_xp(4), 1);
    assert_eq!(level_for_xp(5), 2);
    assert_eq!(level_for_xp(44), 9);
    assert_eq!(level_for_xp(45), LEVEL_MAX);
    assert_eq!(level_for_xp(u32::MAX), LEVEL_MAX);
}

#[test]
fn xp_needed_for_the_next_level() {
    assert_eq!(xp_next(1), Some(5));
    assert_eq!(xp_next(9), Some(45));
    assert_eq!(xp_next(LEVEL_MAX), None);
}

#[test]
fn levels_give_no_stats_and_the_third_slot_opens_at_seven() {
    // 0034: "Levels give no attack and no toughness"; 0030/0031: third slot at 7.
    assert!(ATTACK_AT.is_empty() && TOUGHNESS_AT.is_empty());
    for level in 1..=LEVEL_MAX {
        assert_eq!(level_bonus(level), (0, 0), "level {level}");
    }
    assert_eq!(THIRD_SLOT_AT, 7);
    assert_eq!((slots(1), slots(6), slots(7), slots(10)), (2, 2, 3, 3));
}
```

- [ ] **Step 3: Run it to watch it fail**

Run: `cargo test -p tapstone-progression`
Expected: FAIL to compile, `unresolved import tapstone_progression::…` (the crate has no items yet).

- [ ] **Step 4: Implement**

`rust/tapstone-progression/src/lib.rs`:

```rust
#![no_std]
#![forbid(unsafe_code)]
//! Commander progression, arena-side (0029: the engine never sees a level, XP or an item).
//! The arena derives `ClaimSeat` stats from these tables, and `tapstone-sim`'s bound run measures
//! the same tables, so the ≤60% bound (0030) is a claim about what the arena actually does.

pub mod items;

use tapstone_rules::state::COMMANDER_KEYWORDS;
use tapstone_rules::{Commander, Faction, Keyword};

pub use items::ITEMS;

pub const LEVEL_MAX: u8 = 10;
/// 0030 ruling: flat 5 XP a level.
pub const XP_PER_LEVEL: u32 = 5;
/// 0030: win 3, loss 1. 0031: a melted duplicate is 1.
pub const XP_WIN: u32 = 3;
pub const XP_LOSS: u32 = 1;
pub const XP_MELT: u32 = 1;
/// 0031 ruling: a drop on every third consecutive loss.
pub const DROP_EVERY_LOSSES: u32 = 3;
/// 0030: nothing for a match abandoned before round 3.
pub const ABANDON_BEFORE_ROUND: u8 = 3;
/// 0032: the loot grid is 3×4.
pub const GRID: usize = 12;
/// 0034 supersedes 0030's level bonuses: levels give no attack and no toughness.
pub const ATTACK_AT: &[u8] = &[];
pub const TOUGHNESS_AT: &[u8] = &[];
/// 0030/0031: two slots from level 1, the third (a look slot under 0034) at level 7.
pub const THIRD_SLOT_AT: u8 = 7;
/// 0034: the only item effects are the engine's commander keywords.
pub const ITEM_KEYWORDS: [Keyword; 2] = COMMANDER_KEYWORDS;

/// Level for an XP total: 1 + xp/5, capped at 10. Derived, never stored (spec §8.1).
pub fn level_for_xp(xp: u32) -> u8 {
    (1 + xp / XP_PER_LEVEL).min(LEVEL_MAX as u32) as u8
}

/// Total XP at which `level + 1` begins, or `None` at the cap.
pub fn xp_next(level: u8) -> Option<u32> {
    (level < LEVEL_MAX).then(|| u32::from(level) * XP_PER_LEVEL)
}

/// (attack, toughness) a level adds over level 1: zero at every level under 0034.
pub fn level_bonus(level: u8) -> (u8, u8) {
    let n = |at: &[u8]| at.iter().filter(|&&l| level >= l).count() as u8;
    (n(ATTACK_AT), n(TOUGHNESS_AT))
}

pub fn slots(level: u8) -> usize {
    if level >= THIRD_SLOT_AT { 3 } else { 2 }
}

/// One item's effect (0031 as amended by 0034): a commander keyword, or a look with no rule effect.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Item {
    Keyword(Keyword),
    Look,
}

/// 0031's three slots.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Slot {
    Weapon = 0,
    Armour = 1,
    Trinket = 2,
}

/// An item design record (`game/items/<set>/itN-NNN.toml`, spec §8.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ItemDesign {
    pub id: u16,
    pub name: &'static str,
    pub faction: Faction,
    pub slot: Slot,
    pub effect: Item,
    /// The level at which this item joins the loot table (0034: "a wider loot table").
    pub min_level: u8,
    /// Whether it can drop as loot; `false` = item-card only.
    pub loot: bool,
}

pub fn item(id: u16) -> Option<&'static ItemDesign> {
    ITEMS.get(id as usize).filter(|d| d.id == id)
}

/// Final stats for `level` wearing `gear`, or `None` if the kit is illegal: more items than
/// slots, a keyword outside `ITEM_KEYWORDS`, or a second keyword (refused at equip time, 0031).
pub fn try_commander_at(level: u8, gear: &[Item]) -> Option<Commander> {
    if gear.len() > slots(level) {
        return None;
    }
    let (la, lt) = level_bonus(level);
    let base = Commander::LEVEL_1;
    let mut k = base.keyword;
    for item in gear {
        if let Item::Keyword(kw) = *item {
            if k.is_some() || !ITEM_KEYWORDS.contains(&kw) {
                return None;
            }
            k = Some(kw);
        }
    }
    Some(Commander::stats(base.attack + la, base.toughness + lt, k))
}

/// As `try_commander_at`, panicking on an illegal kit.
pub fn commander_at(level: u8, gear: &[Item]) -> Commander {
    try_commander_at(level, gear).expect("illegal loadout")
}
```

`rust/tapstone-progression/src/items.rs` (the region is filled by Task 2's generator; it starts empty so the crate builds):

```rust
//! Item designs. The region below is generated from game/items/set1/*.toml by
//! tools/compile_items.py; edit the TOML, not this block.
#![allow(unused_imports)]
use tapstone_rules::{Faction, Keyword};

use crate::{Item, ItemDesign, Slot};

// Unused only while the generated table is empty (Task 1, before compile_items.py first runs).
#[allow(dead_code)]
const fn item(
    id: u16,
    name: &'static str,
    faction: Faction,
    slot: Slot,
    effect: Item,
    min_level: u8,
    loot: bool,
) -> ItemDesign {
    ItemDesign {
        id,
        name,
        faction,
        slot,
        effect,
        min_level,
        loot,
    }
}

// BEGIN GENERATED ITEMS1
// Generated by tools/compile_items.py from game/items/set1/*.toml — do not edit by hand.
#[rustfmt::skip]
pub static ITEMS: &[ItemDesign] = &[
];
// END GENERATED ITEMS1
```

- [ ] **Step 5: Run the tests and the no_std build**

Run: `cargo test -p tapstone-progression && cargo build -p tapstone-progression --target thumbv7em-none-eabi`
Expected: 3 passed; the thumbv7em build finishes (proves `no_std`).

- [ ] **Step 6: Perturb, then commit**

Perturbation: set `XP_PER_LEVEL = 4` and confirm `level_is_one_plus_xp_over_five_capped_at_ten` goes red; restore.

```bash
git add rust/Cargo.toml rust/tapstone-progression/Cargo.toml rust/tapstone-progression/src/lib.rs rust/tapstone-progression/src/items.rs rust/tapstone-progression/tests/progression.rs
git commit -m "feat(progression): new no_std crate for 0030/0034 XP, levels and slots"
```

---

## Task 2: Item designs and `tools/compile_items.py`

**Files:**
- Create: `game/items/set1/it1-000.toml` … `it1-005.toml`, `tools/compile_items.py`
- Modify: `rust/tapstone-progression/src/items.rs` (generated region), `rust/tapstone-progression/tests/progression.rs`

- [ ] **Step 1: Write the six item records**

`game/items/set1/it1-000.toml`:
```toml
id = "it1-000"
name = "Ember Sabre"
faction = "ember"
slot = "weapon"
effect = "haste"
min_level = 1
loot = true
version = 1
```
`game/items/set1/it1-001.toml`:
```toml
id = "it1-001"
name = "Tide Trident"
faction = "tide"
slot = "weapon"
effect = "look"
min_level = 1
loot = true
version = 1
```
`game/items/set1/it1-002.toml`:
```toml
id = "it1-002"
name = "Hearthguard Plate"
faction = "neutral"
slot = "armour"
effect = "taunt"
min_level = 3
loot = true
version = 1
```
`game/items/set1/it1-003.toml`:
```toml
id = "it1-003"
name = "Driftcloak"
faction = "tide"
slot = "armour"
effect = "look"
min_level = 1
loot = true
version = 1
```
`game/items/set1/it1-004.toml`:
```toml
id = "it1-004"
name = "Ash Locket"
faction = "ember"
slot = "trinket"
effect = "look"
min_level = 7
loot = true
version = 1
```
`game/items/set1/it1-005.toml`:
```toml
id = "it1-005"
name = "Pearl Charm"
faction = "tide"
slot = "trinket"
effect = "look"
min_level = 7
loot = true
version = 1
```

- [ ] **Step 2: Write the failing test**

Append to `rust/tapstone-progression/tests/progression.rs`:

```rust
use tapstone_progression::{ITEM_KEYWORDS, ITEMS, Item, Slot, item};

#[test]
fn the_item_table_is_contiguous_and_carries_both_keywords() {
    assert!(!ITEMS.is_empty(), "compile_items.py has not been run");
    for (i, d) in ITEMS.iter().enumerate() {
        assert_eq!(d.id as usize, i, "{} is out of place", d.name);
        assert_eq!(item(d.id), Some(d));
        if let Item::Keyword(k) = d.effect {
            assert!(ITEM_KEYWORDS.contains(&k), "{} grants {k:?}, outside 0034", d.name);
        }
        if d.slot == Slot::Trinket {
            assert!(d.min_level >= 7, "{} drops before its slot opens", d.name);
        }
    }
    for k in ITEM_KEYWORDS {
        assert!(
            ITEMS.iter().any(|d| d.effect == Item::Keyword(k)),
            "no {k:?} item: a loadout could never carry it"
        );
    }
    assert_eq!(item(ITEMS.len() as u16), None);
}
```

- [ ] **Step 3: Run it to watch it fail**

Run: `cargo test -p tapstone-progression the_item_table`
Expected: FAIL with `compile_items.py has not been run`.

- [ ] **Step 4: Write the generator**

`tools/compile_items.py` (make it executable: `chmod +x tools/compile_items.py`):

```python
#!/usr/bin/env python3
"""Compile game/items/<set>/*.toml into the generated region of tapstone-progression's items.rs.

Python >= 3.11 (tomllib). Mirrors tools/compile_cards.py: validates the closed vocabularies
(spec 2026-09-23-arena-service-design.md §8.3, decisions 0031 and 0034) and rewrites the text
between `// BEGIN GENERATED ITEMS<N>` and `// END GENERATED ITEMS<N>`. Byte-exact idempotent.
Exit 0 ok · 1 plumbing error · 2 validation error · 3 (--check) the committed file is stale.
"""
import sys

if sys.version_info < (3, 11):
    sys.exit("compile_items.py needs Python 3.11+ (tomllib)")

import argparse
import re
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

FACTIONS = {"ember": "Faction::Ember", "tide": "Faction::Tide", "neutral": "Faction::Neutral"}
SLOTS = {"weapon": "Slot::Weapon", "armour": "Slot::Armour", "trinket": "Slot::Trinket"}
# 0034: gear grants Haste or Taunt, or is a look. Ranged, Shield 1 and Rush never go on a commander.
EFFECTS = {
    "haste": "Item::Keyword(Keyword::Haste)",
    "taunt": "Item::Keyword(Keyword::Taunt)",
    "look": "Item::Look",
}
THIRD_SLOT_AT = 7
KNOWN_KEYS = {"id", "name", "faction", "slot", "effect", "min_level", "loot", "version", "sprite", "flavor"}
ID_RE = re.compile(r"^([a-z]+[0-9]+)-([0-9]{3})$")
SET_RE = re.compile(r"^set([0-9]+)$")


class Invalid(Exception):
    pass


def parse_item(path, id_prefix):
    d = tomllib.loads(path.read_text(encoding="utf-8"))
    unknown = set(d) - KNOWN_KEYS
    if unknown:
        raise Invalid(f"unknown keys: {', '.join(sorted(unknown))}")
    iid = d.get("id")
    m = ID_RE.match(iid) if isinstance(iid, str) else None
    if not m or m[1] != id_prefix:
        raise Invalid(f"`id` must look like {id_prefix}-NNN, got {iid!r}")
    if path.stem != iid:
        raise Invalid(f"file name {path.name!r} does not match id {iid!r}")
    name = d.get("name")
    if not isinstance(name, str) or not name.strip() or '"' in name or "\\" in name:
        raise Invalid("`name` must be a non-empty string without quotes or backslashes")
    if d.get("faction") not in FACTIONS:
        raise Invalid(f"`faction` must be one of {sorted(FACTIONS)}, got {d.get('faction')!r}")
    if d.get("slot") not in SLOTS:
        raise Invalid(f"`slot` must be one of {sorted(SLOTS)}, got {d.get('slot')!r}")
    if d.get("effect") not in EFFECTS:
        raise Invalid(
            f"`effect` must be one of {sorted(EFFECTS)} (0034), got {d.get('effect')!r}"
        )
    lvl = d.get("min_level")
    if isinstance(lvl, bool) or not isinstance(lvl, int) or not 1 <= lvl <= 10:
        raise Invalid(f"`min_level` must be an integer 1..=10, got {lvl!r}")
    if d["slot"] == "trinket" and lvl < THIRD_SLOT_AT:
        raise Invalid(f"a trinket cannot drop before level {THIRD_SLOT_AT}, when its slot opens")
    loot = d.get("loot")
    if not isinstance(loot, bool):
        raise Invalid(f"`loot` must be true or false, got {loot!r}")
    version = d.get("version")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise Invalid(f"`version` must be an integer >= 1, got {version!r}")
    index = int(m[2])
    row = (
        f'item({index}, "{name}", {FACTIONS[d["faction"]]}, {SLOTS[d["slot"]]}, '
        f'{EFFECTS[d["effect"]]}, {lvl}, {"true" if loot else "false"})'
    )
    return index, row


def compile_items(set_name, out_path, check=False):
    sm = SET_RE.match(set_name)
    if not sm:
        raise Invalid(f"set name must look like setN, got {set_name!r}")
    id_prefix = f"it{sm[1]}"
    region = f"ITEMS{sm[1]}"
    src_dir = REPO / "game" / "items" / set_name
    files = sorted(src_dir.glob("*.toml"))
    if not files:
        raise Invalid(f"no .toml files under {src_dir.relative_to(REPO)}")
    rows, errors = {}, []
    for f in files:
        try:
            index, row = parse_item(f, id_prefix)
            if index in rows:
                raise Invalid(f"duplicate index {index}")
            rows[index] = row
        except Invalid as e:
            errors.append(f"{f.relative_to(REPO)}: {e}")
    if errors:
        raise Invalid("\n".join(errors))
    expected = list(range(len(rows)))
    if sorted(rows) != expected:
        raise Invalid(f"{src_dir.relative_to(REPO)}: indices must be contiguous from 0")
    rel_src = src_dir.relative_to(REPO).as_posix()
    lines = [
        f"// Generated by tools/compile_items.py from {rel_src}/*.toml — do not edit by hand.",
        "#[rustfmt::skip]",
        "pub static ITEMS: &[ItemDesign] = &[",
    ]
    lines += [f"    {rows[i]}," for i in expected]
    lines.append("];")
    generated = "\n".join(lines) + "\n"
    begin, end = f"// BEGIN GENERATED {region}\n", f"// END GENERATED {region}\n"
    text = out_path.read_text(encoding="utf-8")
    b, e = text.find(begin), text.find(end)
    if b < 0 or e < 0 or e < b:
        raise SystemExit(f"{out_path.relative_to(REPO)}: markers for {region} not found")
    new_text = text[: b + len(begin)] + generated + text[e:]
    if new_text != text and not check:
        out_path.write_text(new_text, encoding="utf-8")
    return len(rows), new_text != text


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--set", default="set1")
    ap.add_argument("--out", default="rust/tapstone-progression/src/items.rs")
    ap.add_argument("--check", action="store_true",
                    help="exit 3 if the committed file differs, write nothing")
    args = ap.parse_args()
    out_path = (REPO / args.out).resolve()
    try:
        n, changed = compile_items(args.set, out_path, check=args.check)
    except Invalid as e:
        print(e, file=sys.stderr)
        return 2
    rel = out_path.relative_to(REPO)
    if args.check:
        if changed:
            print(f"{rel} is stale: run tools/compile_items.py")
            return 3
        print(f"{args.set}: {n} items, {rel} is up to date")
        return 0
    print(f"{args.set}: {n} items -> {rel} ({'updated' if changed else 'unchanged'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Generate and run**

Run (from the repo root): `tools/compile_items.py && tools/compile_items.py --check; echo $?`
Expected: `set1: 6 items -> rust/tapstone-progression/src/items.rs (updated)`, then `… is up to date`, exit `0`.
Run: `cd rust && cargo test -p tapstone-progression`
Expected: 4 passed.

- [ ] **Step 6: Perturb the generator and the check, then commit**

Perturbations, each restored: (1) change `it1-002.toml`'s effect to `"shield1"` → the generator exits 2 naming 0034; (2) hand-edit one generated row in `items.rs` → `compile_items.py --check` exits 3; (3) set `it1-004`'s `min_level = 3` → exits 2 ("cannot drop before level 7").

```bash
git add game/items/set1/*.toml tools/compile_items.py rust/tapstone-progression/src/items.rs rust/tapstone-progression/tests/progression.rs
git commit -m "feat(items): six set-1 items and compile_items.py (0031, 0034)"
```

---

## Task 3: `derive_commander`, flat mode, and the sim on the shared tables

**Files:**
- Modify: `rust/tapstone-progression/src/lib.rs`, `rust/tapstone-progression/tests/progression.rs`
- Modify: `rust/tapstone-sim/Cargo.toml`, `rust/tapstone-sim/src/progression.rs`

- [ ] **Step 1: Write the failing tests**

Append to `rust/tapstone-progression/tests/progression.rs`:

```rust
use tapstone_progression::{Loadout, LoadoutError, derive_commander, flat_loadout};
use tapstone_rules::{Commander, Game, HouseRules, Keyword};

const SABRE: u16 = 0; // weapon, haste
const TRIDENT: u16 = 1; // weapon, look
const PLATE: u16 = 2; // armour, taunt
const CLOAK: u16 = 3; // armour, look
const LOCKET: u16 = 4; // trinket, look

#[test]
fn derivation_is_two_four_plus_at_most_one_keyword() {
    let bare: Loadout = [None; 3];
    assert_eq!(derive_commander(1, &bare), Ok(Commander::LEVEL_1));
    assert_eq!(
        derive_commander(1, &[Some(SABRE), Some(CLOAK), None]),
        Ok(Commander::stats(2, 4, Some(Keyword::Haste)))
    );
    assert_eq!(
        derive_commander(10, &[Some(TRIDENT), Some(PLATE), Some(LOCKET)]),
        Ok(Commander::stats(2, 4, Some(Keyword::Taunt)))
    );
}

#[test]
fn derivation_refuses_what_0031_refuses_at_equip() {
    assert_eq!(
        derive_commander(6, &[None, None, Some(LOCKET)]),
        Err(LoadoutError::SlotLocked(2)),
        "the trinket slot is closed below level 7"
    );
    assert_eq!(
        derive_commander(10, &[Some(PLATE), None, None]),
        Err(LoadoutError::WrongSlot { slot: 0, design: PLATE })
    );
    assert_eq!(
        derive_commander(10, &[Some(99), None, None]),
        Err(LoadoutError::UnknownItem(99))
    );
    assert_eq!(
        derive_commander(10, &[Some(SABRE), Some(PLATE), None]),
        Err(LoadoutError::SecondKeyword)
    );
}

#[test]
fn every_derivable_commander_is_one_the_engine_accepts() {
    // One object (verification.md): the arena derives, the engine refuses anything else (PR #49).
    let weapons = [None, Some(SABRE), Some(TRIDENT)];
    let armours = [None, Some(PLATE), Some(CLOAK)];
    let trinkets = [None, Some(LOCKET)];
    let mut n = 0;
    for w in weapons {
        for a in armours {
            for t in trinkets {
                let Ok(c) = derive_commander(10, &[w, a, t]) else { continue };
                let mut g = Game::new(HouseRules::default(), [0, 1], [&[2u16; 25], &[2u16; 25]]);
                assert_eq!(g.set_commander(0, c), Ok(()), "{w:?}/{a:?}/{t:?}");
                n += 1;
            }
        }
    }
    assert!(n >= 12, "only {n} legal kits enumerated");
}

#[test]
fn flat_mode_drops_the_trinket_when_the_lower_level_has_two_slots() {
    let kit: Loadout = [Some(TRIDENT), Some(PLATE), Some(LOCKET)];
    assert_eq!(flat_loadout(6, &kit), [Some(TRIDENT), Some(PLATE), None]);
    assert_eq!(flat_loadout(7, &kit), kit);
}
```

- [ ] **Step 2: Run to watch them fail**

Run: `cargo test -p tapstone-progression`
Expected: FAIL to compile: `Loadout`, `LoadoutError`, `derive_commander`, `flat_loadout` not found.

- [ ] **Step 3: Implement**

Append to `rust/tapstone-progression/src/lib.rs`:

```rust
/// A commander's worn gear: item design ids by slot (weapon, armour, trinket).
pub type Loadout = [Option<u16>; 3];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoadoutError {
    /// An item sits in a slot this level has not opened.
    SlotLocked(u8),
    /// The item's design belongs to another slot.
    WrongSlot { slot: u8, design: u16 },
    UnknownItem(u16),
    /// 0031: one keyword per commander; a second keyword item is refused.
    SecondKeyword,
}

/// The final `ClaimSeat` stats for a commander of `level` wearing `loadout` (0029, 0034).
pub fn derive_commander(level: u8, loadout: &Loadout) -> Result<Commander, LoadoutError> {
    let open = slots(level);
    let mut gear = [Item::Look; 3];
    let mut n = 0;
    for (slot, worn) in loadout.iter().enumerate() {
        let Some(design) = *worn else { continue };
        if slot >= open {
            return Err(LoadoutError::SlotLocked(slot as u8));
        }
        let d = item(design).ok_or(LoadoutError::UnknownItem(design))?;
        if d.slot as usize != slot {
            return Err(LoadoutError::WrongSlot { slot: slot as u8, design });
        }
        gear[n] = d.effect;
        n += 1;
    }
    try_commander_at(level, &gear[..n]).ok_or(LoadoutError::SecondKeyword)
}

/// `flat` mode (0030 ruling): both commanders play at the lower level's slot count; slots that
/// level has not opened are emptied.
pub fn flat_loadout(level: u8, loadout: &Loadout) -> Loadout {
    let mut out = *loadout;
    for slot in out.iter_mut().skip(slots(level)) {
        *slot = None;
    }
    out
}
```

- [ ] **Step 4: Point the sim at the shared tables**

`rust/tapstone-sim/Cargo.toml` `[dependencies]` gains:

```toml
tapstone-progression = { path = "../tapstone-progression" }
```

In `rust/tapstone-sim/src/progression.rs`, delete the constants `LEVEL_MAX`, `ATTACK_AT`, `TOUGHNESS_AT`, `THIRD_SLOT_AT`, `ITEM_KEYWORDS`, the `Item` enum and the functions `level_bonus`, `slots`, `try_commander_at`, `commander_at`, and put this at the top of the file, below the module doc comment:

```rust
// The tables live in tapstone-progression so the arena derives ClaimSeat stats from the same
// object this bound run measures (arena spec D5). Re-exported so callers keep their paths.
pub use tapstone_progression::{
    ATTACK_AT, ITEM_KEYWORDS, Item, LEVEL_MAX, THIRD_SLOT_AT, TOUGHNESS_AT, commander_at,
    level_bonus, slots, try_commander_at,
};
```

Keep `max_loadouts`, `VeteranRun`, `wilson95`, `over_bound` and `veteran_vs_fresh*` unchanged. Fix the `use` line so it no longer imports `Keyword` if unused (clippy will say).

- [ ] **Step 4b: One derivation, one set (spec §13)**

`derive_commander` (what the arena seats) is built on `try_commander_at` (what the bound run
measures): it maps a loadout's items to effects and calls it. So there is one derivation, and this
test pins that the two views of it agree. The kits the bound measures must be exactly the
commanders the arena can derive from real item designs, and the engine must accept each one.
Append to `rust/tapstone-sim/tests/commander.rs`:

```rust
#[test]
fn the_arenas_derivation_and_the_bound_runs_kits_are_one_set() {
    use std::collections::BTreeSet;
    use tapstone_progression::{ITEMS, LEVEL_MAX, derive_commander};
    let per_slot = |slot: usize| -> Vec<Option<u16>> {
        std::iter::once(None).chain(ITEMS.iter().filter(|d| d.slot as usize == slot).map(|d| Some(d.id))).collect()
    };
    let mut derived = BTreeSet::new();
    for w in per_slot(0) {
        for a in per_slot(1) {
            for t in per_slot(2) {
                let Ok(c) = derive_commander(LEVEL_MAX, &[w, a, t]) else { continue };
                let mut g = tapstone_rules::Game::new(Default::default(), [0, 1], [&[2u16; 25], &[2u16; 25]]);
                assert_eq!(g.set_commander(0, c), Ok(()), "the engine refuses a derivable kit {c:?}");
                derived.insert(format!("{c:?}"));
            }
        }
    }
    let measured: BTreeSet<String> = max_loadouts().iter().map(|(_, c)| format!("{c:?}")).collect();
    assert_eq!(derived, measured, "the bound measures a different set from what the arena can seat");
}
```

Perturbation: temporarily change `it1-000.toml`'s `effect` from `haste` to `look` and regenerate the
items. The derived set loses Haste while the measured set keeps it, so the test goes red. Restore
and regenerate.

- [ ] **Step 5: Run everything that touches the tables**

Run: `cargo test -p tapstone-progression && cargo test -p tapstone-sim --test commander && cargo run -q --release -p tapstone-sim -- commander --games 4000 --decks mirror-ember; echo exit=$?`
Expected: progression 8 passed; sim commander tests pass; the bound table is byte-for-byte the one `main` prints before this task (after 0035's bonus 1: worst kit Haste, Ember 56.8 [55.66–57.83] play-out), and `exit=0`. Capture that "before" table first with the same command on a clean checkout, so "byte-for-byte" is a diff and not a memory.

- [ ] **Step 6: Perturb, then commit**

Perturbation: in `derive_commander`, delete the `WrongSlot` check → `derivation_refuses_what_0031_refuses_at_equip` goes red; restore. Second: set `THIRD_SLOT_AT = 8` in the progression crate → **both** the progression tests and `tapstone-sim`'s commander tests go red, which proves the sim now reads the shared table; restore.

```bash
git add rust/tapstone-progression/src/lib.rs rust/tapstone-progression/tests/progression.rs rust/tapstone-sim/Cargo.toml rust/tapstone-sim/src/progression.rs
git commit -m "feat(progression): derive_commander and flat mode; the sim reads the shared tables (D5)"
```

---

## Task 4: `tapstone-proto` — the MATCH header, byte helpers, and the frame vocabulary

Every layout here is normative in code from this task on. The draft (§2) gave sizes; where it gave
only a size, this task fixes the field order, and Task 25 writes the rows back into the draft.
Two deliberate differences from the draft, recorded here and in Task 25:
- `C` is **36 B**, not 34, because it carries the proposal's `lseq`. §4.3 says a follower
  retransmits `T` "until a `C` carrying its `(seat, lseq)` arrives", but the 34 B layout has no
  room for `lseq`.
- `R` also has **`sig_kind = 0` (unsigned, 45 B)** for playtest one (spec §17 question 3).

**Files:**
- Modify: `rust/Cargo.toml` (members += `"tapstone-proto"`)
- Create: `rust/tapstone-proto/Cargo.toml`, `src/lib.rs`, `src/wire.rs`, `src/frame.rs`, `tests/frame.rs`

- [ ] **Step 1: Manifest**

`rust/tapstone-proto/Cargo.toml`:

```toml
[package]
name = "tapstone-proto"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true
description = "Tapstone SMOLv1 MATCH frames, the TSX1 transcript, and a reference follower. no_std, no alloc."

[dependencies]
tapstone-rules = { path = "../tapstone-rules" }
sha2 = { version = "0.11", default-features = false }

[dev-dependencies]
proptest = "1"
tapstone-sim = { path = "../tapstone-sim" }
```

- [ ] **Step 2: Write the failing tests**

`rust/tapstone-proto/tests/frame.rs`:

```rust
use proptest::prelude::*;
use tapstone_proto::frame::*;
use tapstone_rules::{Kind, Record};

fn rec() -> Record {
    Record {
        seq: 7,
        seat: 1,
        kind: Kind::CastUnit,
        card: 3,
        lane: 2,
        target: 0,
        aux: 0,
        time_ms: 1234,
        uid: [4, 1, 3, 0, 0, 0, 9],
        auth: 0,
    }
}

fn all_frames() -> Vec<Frame> {
    let mut data = [0u8; SNAP_DATA_MAX];
    data[..5].copy_from_slice(b"hello");
    vec![
        Frame::Lobby(Lobby { seat_pref: 2, deck_sigil: 0xA1, ruleset: 0xB2, registry: 0xC3, rules: 0xD4, flags: lobby_flags::ARENA }),
        Frame::Tap(Tap::Propose { lseq: 9, record: rec() }),
        Frame::Tap(Tap::Reject { lseq: 9, reason: 3 }),
        Frame::Commit(Commit { mseq: 7, lseq: 9, record: rec(), hash: [1; 8] }),
        Frame::Ack(Ack { mseq: 7, hash: [2; 8] }),
        Frame::Nak(Nak { from: 3, to: 0xFFFF }),
        Frame::Join(Join { role: join_role::ARENA, have_mseq: 12 }),
        Frame::Snap(Snap { at_mseq: 5, idx: 0, count: 1, total_len: 5, len: 5, data }),
        Frame::SnapNak(SnapNak { at_mseq: 5, bitmap: 0b101 }),
        Frame::Halt(Halt { at_mseq: 8, reason: halt_reason::HASH, mine: [3; 8], theirs: [4; 8] }),
        Frame::Result(MatchResult::unsigned(40, 1, result_reason::LETHAL, [5; 8], [6; 32])),
        Frame::Doll(Doll { seat: 0, level: 3, xp: 12, xp_next: 15, slots: 2, loadout: [0, NONE16, NONE16], inv_len: 1, inv: [0; GRID_MAX], keyword: NONE8, name_seed: 0xDEAD }),
        Frame::Equip(Equip { slot: 1, op: equip_op::LOOT, design: 2, uid: [0; 7] }),
        // Only the first `n` records travel; the fixture must be a frame the wire can carry.
        Frame::Handback(Handback { from_mseq: 10, idx: 0, count: 2, n: 1, records: { let mut r = [[0; 32]; HANDBACK_RECORDS]; r[0] = [7; 32]; r } }),
        Frame::HandbackNak(HandbackNak { from_mseq: 10, bitmap: 0b10 }),
    ]
}

#[test]
fn every_frame_round_trips() {
    let h = Header { match_id: 0xA300_1F2C, src: 163 };
    for f in all_frames() {
        let mut buf = [0u8; FRAME_MAX];
        let n = f.encode(&h, &mut buf);
        let (h2, f2) = Frame::decode(&buf[..n]).unwrap_or_else(|| panic!("{f:?} did not decode"));
        assert_eq!((h2, f2), (h, f.clone()));
    }
}

#[test]
fn payload_sizes_are_the_documented_ones_and_fit_the_budget() {
    // The draft's table (§2) plus Task 4's two changes. A size is a wire commitment.
    let want: &[(u8, usize)] = &[
        (b'L', 18), (b'T', 27), (b'C', 36), (b'A', 10), (b'N', 4), (b'J', 3), (b'Q', 10),
        (b'X', 19), (b'R', 45), (b'D', 43), (b'E', 11), (b'K', 10),
    ];
    let h = Header { match_id: 1, src: 2 };
    for f in all_frames() {
        let mut buf = [0u8; FRAME_MAX];
        let n = f.encode(&h, &mut buf);
        assert!(fits_payload(n - HEADER_LEN), "{} is over the 221 B budget", f.kind() as char);
        let checked = want.iter().find(|(k, _)| *k == f.kind()).filter(|_| !matches!(f, Frame::Tap(Tap::Reject { .. })));
        if let Some(&(_, size)) = checked {
            assert_eq!(n - HEADER_LEN, size, "kind {}", f.kind() as char);
        }
    }
    assert_eq!(PAYLOAD_MAX, 250 - 20 - 9, "derived from the MTU, header and MAC trailer");
    // The control: a payload one byte past the budget must be refused by the same predicate, or the
    // check above could not fail at all (verification.md: prove the check can see its subject).
    assert!(fits_payload(PAYLOAD_MAX) && !fits_payload(PAYLOAD_MAX + 1));
}

#[test]
fn foreign_and_truncated_frames_do_not_decode() {
    assert!(Frame::decode(b"SMOLv1 HELLO 007").is_none());
    let h = Header { match_id: 1, src: 2 };
    let mut buf = [0u8; FRAME_MAX];
    let n = Frame::Ack(Ack { mseq: 1, hash: [0; 8] }).encode(&h, &mut buf);
    for cut in 0..n {
        assert!(Frame::decode(&buf[..cut]).is_none(), "decoded a {cut}-byte prefix");
    }
    buf[14] = b'Z';
    assert!(Frame::decode(&buf[..n]).is_none(), "unknown kind");
}

proptest! {
    #[test]
    fn decode_never_panics(bytes in proptest::collection::vec(any::<u8>(), 0..300)) {
        let _ = Frame::decode(&bytes);
        let mut tagged = TAG.to_vec();
        tagged.extend_from_slice(&bytes);
        let _ = Frame::decode(&tagged);
    }
}
```

- [ ] **Step 3: Run to watch it fail**

Run: `cargo test -p tapstone-proto`
Expected: FAIL to compile (`tapstone_proto::frame` not found).

- [ ] **Step 4: Implement the byte helpers**

`rust/tapstone-proto/src/lib.rs`:

```rust
#![no_std]
#![forbid(unsafe_code)]
//! Tapstone's SMOLv1 `MATCH ` frames (protocol draft §2–§6 and arena spec §6). One codec, two
//! hosts: vendored into smol beside `tapstone-rules`, and linked natively by the arena.

pub mod follower;
pub mod frame;
pub mod ids;
pub mod transcript;
mod wire;
```

(`transcript`, `follower` and `ids` are created in Tasks 5, 6 and 7; until then, comment those three
lines out so this task builds, and uncomment each in its task.)

`rust/tapstone-proto/src/wire.rs`:

```rust
//! Little-endian cursor helpers. Every read is bounds-checked and returns `None` past the end.

pub(crate) struct Reader<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Reader<'a> {
    pub fn new(b: &'a [u8]) -> Self {
        Reader { b, i: 0 }
    }
    pub fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let s = self.b.get(self.i..self.i.checked_add(n)?)?;
        self.i += n;
        Some(s)
    }
    pub fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }
    pub fn u16(&mut self) -> Option<u16> {
        let s = self.take(2)?;
        Some(u16::from_le_bytes([s[0], s[1]]))
    }
    pub fn u32(&mut self) -> Option<u32> {
        let s = self.take(4)?;
        Some(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
    }
    pub fn u64(&mut self) -> Option<u64> {
        let mut a = [0u8; 8];
        a.copy_from_slice(self.take(8)?);
        Some(u64::from_le_bytes(a))
    }
    pub fn array<const N: usize>(&mut self) -> Option<[u8; N]> {
        let mut a = [0u8; N];
        a.copy_from_slice(self.take(N)?);
        Some(a)
    }
}

pub(crate) struct Writer<'a> {
    b: &'a mut [u8],
    i: usize,
}

impl<'a> Writer<'a> {
    pub fn new(b: &'a mut [u8]) -> Self {
        Writer { b, i: 0 }
    }
    pub fn len(&self) -> usize {
        self.i
    }
    /// Panics if the buffer is too small: callers pass `[u8; FRAME_MAX]`, which every frame fits
    /// by construction (asserted in tests), so running out is a codec bug, not an input.
    pub fn bytes(&mut self, s: &[u8]) {
        self.b[self.i..self.i + s.len()].copy_from_slice(s);
        self.i += s.len();
    }
    pub fn u8(&mut self, v: u8) {
        self.bytes(&[v]);
    }
    pub fn u16(&mut self, v: u16) {
        self.bytes(&v.to_le_bytes());
    }
    pub fn u32(&mut self, v: u32) {
        self.bytes(&v.to_le_bytes());
    }
    pub fn u64(&mut self, v: u64) {
        self.bytes(&v.to_le_bytes());
    }
}
```

- [ ] **Step 5: Implement the frames**

`rust/tapstone-proto/src/frame.rs`:

```rust
//! The `SMOLv1 MATCH ` family. Header 20 B: tag 13 · ver 1 · kind 1 · match 4 (LE) · src 1.
use tapstone_rules::{Record, Refusal};

use crate::wire::{Reader, Writer};

pub const TAG: &[u8; 13] = b"SMOLv1 MATCH ";
pub const VER: u8 = 1;
pub const HEADER_LEN: usize = 20;
/// smol `net/wire.rs`: `ESP_NOW_MTU = 250`; `send_to` appends a 9 B group-MAC trailer.
pub const ESP_NOW_MTU: usize = 250;
pub const MAC_TRAILER: usize = 9;
pub const PAYLOAD_MAX: usize = ESP_NOW_MTU - HEADER_LEN - MAC_TRAILER;
pub const FRAME_MAX: usize = HEADER_LEN + PAYLOAD_MAX;

/// The one budget predicate every size check uses, so its control (222 must fail) covers them all.
pub const fn fits_payload(n: usize) -> bool {
    n <= PAYLOAD_MAX
}
pub const BROADCAST: u8 = 255;
pub const SNAP_DATA_MAX: usize = 200;
pub const HANDBACK_RECORDS: usize = 6;
pub const GRID_MAX: usize = 12;
pub const NONE16: u16 = 0xFFFF;
pub const NONE8: u8 = 0xFF;

pub mod lobby_flags {
    pub const WANTS_MATCH: u8 = 1 << 0;
    pub const SPECTATORS: u8 = 1 << 1;
    pub const WIFI: u8 = 1 << 2;
    /// Arena spec §6.1: set only by the arena.
    pub const ARENA: u8 = 1 << 3;
}
pub mod join_role {
    pub const SEAT: u8 = 0;
    pub const SPECTATOR: u8 = 1;
    pub const ARENA: u8 = 2;
}
pub mod halt_reason {
    pub const HASH: u8 = 0;
    /// The follower's engine refused a record the arbiter committed.
    pub const REFUSED: u8 = 1;
    pub const HANDBACK: u8 = 2;
}
pub mod result_reason {
    pub const LETHAL: u8 = 0;
    pub const STOP: u8 = 1;
    pub const TIMEOUT: u8 = 2;
    pub const DESYNC: u8 = 3;
}
pub mod equip_op {
    pub const LOOT: u8 = 0;
    pub const CARD: u8 = 1;
    pub const CLEAR: u8 = 2;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Header {
    pub match_id: u32,
    pub src: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Lobby {
    pub seat_pref: u8,
    pub deck_sigil: u32,
    pub ruleset: u32,
    pub registry: u32,
    pub rules: u32,
    pub flags: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tap {
    Propose { lseq: u16, record: Record },
    Reject { lseq: u16, reason: u8 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Commit {
    pub mseq: u16,
    pub lseq: u16,
    pub record: Record,
    /// Chain head after this record; all zero for lobby records (the chain starts at `Started`).
    pub hash: [u8; 8],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ack {
    pub mseq: u16,
    pub hash: [u8; 8],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Nak {
    pub from: u16,
    /// `0xFFFF` = to head.
    pub to: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Join {
    pub role: u8,
    pub have_mseq: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Snap {
    pub at_mseq: u16,
    pub idx: u8,
    pub count: u8,
    pub total_len: u16,
    pub len: u8,
    pub data: [u8; SNAP_DATA_MAX],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SnapNak {
    pub at_mseq: u16,
    pub bitmap: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Halt {
    pub at_mseq: u16,
    pub reason: u8,
    pub mine: [u8; 8],
    pub theirs: [u8; 8],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MatchResult {
    pub final_mseq: u16,
    pub winner: u8,
    pub reason: u8,
    pub chain: [u8; 8],
    pub transcript_sha: [u8; 32],
    /// 0 unsigned · 1 HMAC-SHA256 group key (32 B) · 2 Ed25519 (64 B), protocol §7.
    pub sig_kind: u8,
    pub sig: [u8; 64],
}

impl MatchResult {
    pub fn unsigned(final_mseq: u16, winner: u8, reason: u8, chain: [u8; 8], sha: [u8; 32]) -> Self {
        MatchResult { final_mseq, winner, reason, chain, transcript_sha: sha, sig_kind: 0, sig: [0; 64] }
    }
    pub fn sig_len(kind: u8) -> Option<usize> {
        match kind {
            0 => Some(0),
            1 => Some(32),
            2 => Some(64),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Doll {
    pub seat: u8,
    pub level: u8,
    pub xp: u16,
    pub xp_next: u16,
    pub slots: u8,
    pub loadout: [u16; 3],
    pub inv_len: u8,
    pub inv: [u16; GRID_MAX],
    pub keyword: u8,
    pub name_seed: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Equip {
    pub slot: u8,
    pub op: u8,
    pub design: u16,
    pub uid: [u8; 7],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Handback {
    pub from_mseq: u16,
    pub idx: u8,
    pub count: u8,
    pub n: u8,
    pub records: [[u8; 32]; HANDBACK_RECORDS],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HandbackNak {
    pub from_mseq: u16,
    pub bitmap: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Frame {
    Lobby(Lobby),
    Tap(Tap),
    Commit(Commit),
    Ack(Ack),
    Nak(Nak),
    Join(Join),
    Snap(Snap),
    SnapNak(SnapNak),
    Halt(Halt),
    Result(MatchResult),
    Doll(Doll),
    Equip(Equip),
    Handback(Handback),
    HandbackNak(HandbackNak),
}

impl Frame {
    pub fn kind(&self) -> u8 {
        match self {
            Frame::Lobby(_) => b'L',
            Frame::Tap(_) => b'T',
            Frame::Commit(_) => b'C',
            Frame::Ack(_) => b'A',
            Frame::Nak(_) => b'N',
            Frame::Join(_) => b'J',
            Frame::Snap(_) => b'S',
            Frame::SnapNak(_) => b'Q',
            Frame::Halt(_) => b'X',
            Frame::Result(_) => b'R',
            Frame::Doll(_) => b'D',
            Frame::Equip(_) => b'E',
            Frame::Handback(_) => b'H',
            Frame::HandbackNak(_) => b'K',
        }
    }

    /// Encode header + body into `out`; returns the frame length (≤ `FRAME_MAX`).
    pub fn encode(&self, h: &Header, out: &mut [u8; FRAME_MAX]) -> usize {
        let mut w = Writer::new(out);
        w.bytes(TAG);
        w.u8(VER);
        w.u8(self.kind());
        w.u32(h.match_id);
        w.u8(h.src);
        match self {
            Frame::Lobby(l) => {
                w.u8(l.seat_pref);
                w.u32(l.deck_sigil);
                w.u32(l.ruleset);
                w.u32(l.registry);
                w.u32(l.rules);
                w.u8(l.flags);
            }
            Frame::Tap(Tap::Propose { lseq, record }) => {
                w.u8(0);
                w.u16(*lseq);
                w.bytes(&record.encode());
            }
            Frame::Tap(Tap::Reject { lseq, reason }) => {
                w.u8(1);
                w.u16(*lseq);
                w.u8(*reason);
            }
            Frame::Commit(c) => {
                w.u16(c.mseq);
                w.u16(c.lseq);
                w.bytes(&c.record.encode());
                w.bytes(&c.hash);
            }
            Frame::Ack(a) => {
                w.u16(a.mseq);
                w.bytes(&a.hash);
            }
            Frame::Nak(n) => {
                w.u16(n.from);
                w.u16(n.to);
            }
            Frame::Join(j) => {
                w.u8(j.role);
                w.u16(j.have_mseq);
            }
            Frame::Snap(s) => {
                w.u16(s.at_mseq);
                w.u8(s.idx);
                w.u8(s.count);
                w.u16(s.total_len);
                w.bytes(&s.data[..s.len as usize]);
            }
            Frame::SnapNak(q) => {
                w.u16(q.at_mseq);
                w.u64(q.bitmap);
            }
            Frame::Halt(x) => {
                w.u16(x.at_mseq);
                w.u8(x.reason);
                w.bytes(&x.mine);
                w.bytes(&x.theirs);
            }
            Frame::Result(r) => {
                w.u16(r.final_mseq);
                w.u8(r.winner);
                w.u8(r.reason);
                w.bytes(&r.chain);
                w.bytes(&r.transcript_sha);
                w.u8(r.sig_kind);
                let n = MatchResult::sig_len(r.sig_kind).unwrap_or(0);
                w.bytes(&r.sig[..n]);
            }
            Frame::Doll(d) => {
                w.u8(d.seat);
                w.u8(d.level);
                w.u16(d.xp);
                w.u16(d.xp_next);
                w.u8(d.slots);
                for s in d.loadout {
                    w.u16(s);
                }
                w.u8(d.inv_len);
                for i in d.inv {
                    w.u16(i);
                }
                w.u8(d.keyword);
                w.u32(d.name_seed);
            }
            Frame::Equip(e) => {
                w.u8(e.slot);
                w.u8(e.op);
                w.u16(e.design);
                w.bytes(&e.uid);
            }
            Frame::Handback(hb) => {
                w.u16(hb.from_mseq);
                w.u8(hb.idx);
                w.u8(hb.count);
                w.u8(hb.n);
                for r in &hb.records[..hb.n as usize] {
                    w.bytes(r);
                }
            }
            Frame::HandbackNak(k) => {
                w.u16(k.from_mseq);
                w.u64(k.bitmap);
            }
        }
        w.len()
    }

    /// Decode one frame. `None` for a foreign prefix, a wrong version, an unknown kind, or a body
    /// shorter than its kind requires. Trailing bytes are ignored (SNK's length-tolerance rule).
    pub fn decode(b: &[u8]) -> Option<(Header, Frame)> {
        let mut r = Reader::new(b);
        if r.take(TAG.len())? != TAG || r.u8()? != VER {
            return None;
        }
        let kind = r.u8()?;
        let h = Header { match_id: r.u32()?, src: r.u8()? };
        let f = match kind {
            b'L' => Frame::Lobby(Lobby {
                seat_pref: r.u8()?,
                deck_sigil: r.u32()?,
                ruleset: r.u32()?,
                registry: r.u32()?,
                rules: r.u32()?,
                flags: r.u8()?,
            }),
            b'T' => match r.u8()? {
                0 => Frame::Tap(Tap::Propose { lseq: r.u16()?, record: Record::decode(r.take(Record::LEN)?)? }),
                1 => Frame::Tap(Tap::Reject { lseq: r.u16()?, reason: r.u8()? }),
                _ => return None,
            },
            b'C' => Frame::Commit(Commit {
                mseq: r.u16()?,
                lseq: r.u16()?,
                record: Record::decode(r.take(Record::LEN)?)?,
                hash: r.array()?,
            }),
            b'A' => Frame::Ack(Ack { mseq: r.u16()?, hash: r.array()? }),
            b'N' => Frame::Nak(Nak { from: r.u16()?, to: r.u16()? }),
            b'J' => Frame::Join(Join { role: r.u8()?, have_mseq: r.u16()? }),
            b'S' => {
                let (at_mseq, idx, count, total_len) = (r.u16()?, r.u8()?, r.u8()?, r.u16()?);
                let rest = r.take(b.len().saturating_sub(HEADER_LEN + 6).min(SNAP_DATA_MAX))?;
                let mut data = [0u8; SNAP_DATA_MAX];
                data[..rest.len()].copy_from_slice(rest);
                Frame::Snap(Snap { at_mseq, idx, count, total_len, len: rest.len() as u8, data })
            }
            b'Q' => Frame::SnapNak(SnapNak { at_mseq: r.u16()?, bitmap: r.u64()? }),
            b'X' => Frame::Halt(Halt { at_mseq: r.u16()?, reason: r.u8()?, mine: r.array()?, theirs: r.array()? }),
            b'R' => {
                let (final_mseq, winner, reason) = (r.u16()?, r.u8()?, r.u8()?);
                let (chain, transcript_sha) = (r.array()?, r.array()?);
                let sig_kind = r.u8()?;
                let n = MatchResult::sig_len(sig_kind)?;
                let mut sig = [0u8; 64];
                sig[..n].copy_from_slice(r.take(n)?);
                Frame::Result(MatchResult { final_mseq, winner, reason, chain, transcript_sha, sig_kind, sig })
            }
            b'D' => {
                let (seat, level, xp, xp_next, slots) = (r.u8()?, r.u8()?, r.u16()?, r.u16()?, r.u8()?);
                let loadout = [r.u16()?, r.u16()?, r.u16()?];
                let inv_len = r.u8()?;
                if inv_len as usize > GRID_MAX {
                    return None;
                }
                let mut inv = [0u16; GRID_MAX];
                for slot in &mut inv {
                    *slot = r.u16()?;
                }
                Frame::Doll(Doll { seat, level, xp, xp_next, slots, loadout, inv_len, inv, keyword: r.u8()?, name_seed: r.u32()? })
            }
            b'E' => Frame::Equip(Equip { slot: r.u8()?, op: r.u8()?, design: r.u16()?, uid: r.array()? }),
            b'H' => {
                let (from_mseq, idx, count, n) = (r.u16()?, r.u8()?, r.u8()?, r.u8()?);
                if n as usize > HANDBACK_RECORDS {
                    return None;
                }
                let mut records = [[0u8; 32]; HANDBACK_RECORDS];
                for rec in records.iter_mut().take(n as usize) {
                    *rec = r.array()?;
                }
                Frame::Handback(Handback { from_mseq, idx, count, n, records })
            }
            b'K' => Frame::HandbackNak(HandbackNak { from_mseq: r.u16()?, bitmap: r.u64()? }),
            _ => return None,
        };
        Some((h, f))
    }
}

/// Wire code for an engine refusal in `T sub=1` (1..=17), in `Refusal`'s declaration order.
/// Arena-level refusals use 100 and up (`arena_refusal`).
pub fn refusal_code(r: &Refusal) -> u8 {
    match r {
        Refusal::NotYourTurn => 1,
        Refusal::NotInHand => 2,
        Refusal::NoMana { .. } => 3,
        Refusal::CellOccupied => 4,
        Refusal::AlreadyChargedThisRound => 5,
        Refusal::AlreadyAdvancedLane => 6,
        Refusal::BadTarget => 7,
        Refusal::UnknownCard => 8,
        Refusal::GameOver => 9,
        Refusal::LaneOutOfRange => 10,
        Refusal::NotPlaying => 11,
        Refusal::SeatTaken => 12,
        Refusal::MulliganClosed => 13,
        Refusal::LobbyClosed => 14,
        // 0036
        Refusal::DrawOwed => 15,
        Refusal::NoDrawOwed => 16,
        Refusal::NotInDeck => 17,
    }
}

pub mod arena_refusal {
    pub const UNKNOWN_UID: u8 = 100;
    pub const NOT_SEATED: u8 = 101;
    pub const UNKNOWN_DECK: u8 = 102;
    pub const TABLE_FULL: u8 = 103;
    pub const BAD_LOADOUT: u8 = 104;
    pub const NOT_IN_LOBBY: u8 = 105;
}
```

Note on `S` decode: the data length is "whatever follows the 6-byte `S` header, up to 200"; the
frame carries no explicit length because ESP-NOW delivers exact frame lengths.

- [ ] **Step 6: Run the tests**

Run: `cargo test -p tapstone-proto --test frame && cargo build -p tapstone-proto --target thumbv7em-none-eabi`
Expected: 4 passed (the proptest counts as one); the no_std build finishes.

- [ ] **Step 7: Perturb, then commit**

Perturbations, each restored: (1) swap `w.u16(c.mseq); w.u16(c.lseq);` in encode only → `every_frame_round_trips` red; (2) add a stray `w.u8(0)` to `Lobby` → `payload_sizes…` red on `L`; (3) in `decode`, remove the `inv_len > GRID_MAX` guard and feed `inv_len = 200` in a test-local buffer → nothing panics, because the fixed `inv` array bounds the read. This confirms the guard is about semantics, not safety; keep it.

```bash
git add rust/Cargo.toml rust/tapstone-proto/Cargo.toml rust/tapstone-proto/src/lib.rs rust/tapstone-proto/src/wire.rs rust/tapstone-proto/src/frame.rs rust/tapstone-proto/tests/frame.rs
git commit -m "feat(proto): the one MATCH codec, no_std (arena spec D2)"
```

---

## Task 5: The TSX1 transcript and `transcript_sha`

The draft (§6) labels the header "32 B" but its fields sum to **36 B**
(`magic 4 + match 4 + ruleset 4 + registry 4 + rules 4 + nodes 1+1 + decks 4+4 + start_ts 4 + pad 2`).
The code takes 36 and derives it; Task 25 corrects the draft.

**Files:**
- Create: `rust/tapstone-proto/src/transcript.rs`, `rust/tapstone-proto/tests/transcript.rs`
- Modify: `rust/tapstone-proto/src/lib.rs` (uncomment `pub mod transcript;`)

- [ ] **Step 1: Write the failing tests**

`rust/tapstone-proto/tests/transcript.rs`:

```rust
use tapstone_proto::transcript::{HEADER_LEN, RECORD_LEN, TranscriptHeader, record_bytes, transcript_sha};
use tapstone_rules::{Kind, Record};

fn header() -> TranscriptHeader {
    TranscriptHeader {
        match_id: 0xA300_1F2C,
        ruleset: 1,
        registry: 2,
        rules: 3,
        seat_nodes: [163, 164],
        deck_sigils: [0xC04B_7A11, 0xE9F2_B3D5],
        start_ts: 1_789_980_000,
    }
}

#[test]
fn the_header_is_thirty_six_bytes_derived_from_its_fields() {
    // magic, match, ruleset, registry, rules, two nodes, two deck sigils, start_ts, pad.
    let fields = [4, 4, 4, 4, 4, 1, 1, 4, 4, 4, 2];
    assert_eq!(HEADER_LEN, fields.iter().sum::<usize>());
    assert_eq!(RECORD_LEN, Record::LEN + 8);
    let b = header().encode();
    assert_eq!(&b[..4], b"TSX1");
    assert_eq!(TranscriptHeader::decode(&b), Some(header()));
    assert_eq!(TranscriptHeader::decode(&b[..35]), None);
}

#[test]
fn the_sha_commits_to_every_byte() {
    let r = Record { seq: 2, seat: 0, kind: Kind::Pass, card: 0, lane: -1, target: 0, aux: 0, time_ms: 9, uid: [0; 7], auth: 0 };
    let recs = [record_bytes(&r, Some([1; 8])), record_bytes(&r, None)];
    let h = header().encode();
    let base = transcript_sha(&h, &recs);
    for i in 0..HEADER_LEN {
        let mut h2 = h;
        h2[i] ^= 1;
        assert_ne!(transcript_sha(&h2, &recs), base, "header byte {i} not covered");
    }
    for i in 0..RECORD_LEN {
        let mut r2 = recs;
        r2[1][i] ^= 1;
        assert_ne!(transcript_sha(&h, &r2), base, "record byte {i} not covered");
    }
    assert_eq!(&recs[1][24..], &[0; 8], "a lobby record carries no hash");
}
```

- [ ] **Step 2: Run to watch it fail**

Run: `cargo test -p tapstone-proto --test transcript`
Expected: FAIL to compile (`transcript` module missing).

- [ ] **Step 3: Implement**

`rust/tapstone-proto/src/transcript.rs`:

```rust
//! TSX1: protocol §6's binary transcript. Header, then `mseq`-ordered 32 B records (24 B event
//! record + 8 B chain head, zero for lobby records). `transcript_sha` = SHA-256(header ‖ records),
//! the value `R` carries (§4.8).
use sha2::{Digest, Sha256};
use tapstone_rules::Record;

use crate::wire::{Reader, Writer};

pub const MAGIC: &[u8; 4] = b"TSX1";
pub const HEADER_LEN: usize = 36;
pub const RECORD_LEN: usize = Record::LEN + 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TranscriptHeader {
    pub match_id: u32,
    pub ruleset: u32,
    pub registry: u32,
    pub rules: u32,
    pub seat_nodes: [u8; 2],
    pub deck_sigils: [u32; 2],
    pub start_ts: u32,
}

impl TranscriptHeader {
    pub fn encode(&self) -> [u8; HEADER_LEN] {
        let mut out = [0u8; HEADER_LEN];
        let mut w = Writer::new(&mut out);
        w.bytes(MAGIC);
        w.u32(self.match_id);
        w.u32(self.ruleset);
        w.u32(self.registry);
        w.u32(self.rules);
        w.u8(self.seat_nodes[0]);
        w.u8(self.seat_nodes[1]);
        w.u32(self.deck_sigils[0]);
        w.u32(self.deck_sigils[1]);
        w.u32(self.start_ts);
        w.u16(0);
        debug_assert_eq!(w.len(), HEADER_LEN);
        out
    }

    pub fn decode(b: &[u8]) -> Option<Self> {
        let mut r = Reader::new(b);
        if r.take(4)? != MAGIC {
            return None;
        }
        let h = TranscriptHeader {
            match_id: r.u32()?,
            ruleset: r.u32()?,
            registry: r.u32()?,
            rules: r.u32()?,
            seat_nodes: [r.u8()?, r.u8()?],
            deck_sigils: [r.u32()?, r.u32()?],
            start_ts: r.u32()?,
        };
        r.u16()?;
        Some(h)
    }
}

pub fn record_bytes(r: &Record, hash: Option<[u8; 8]>) -> [u8; RECORD_LEN] {
    let mut out = [0u8; RECORD_LEN];
    out[..Record::LEN].copy_from_slice(&r.encode());
    out[Record::LEN..].copy_from_slice(&hash.unwrap_or([0; 8]));
    out
}

pub fn transcript_sha(header: &[u8; HEADER_LEN], records: &[[u8; RECORD_LEN]]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(header);
    for r in records {
        h.update(r);
    }
    h.finalize().into()
}
```

- [ ] **Step 4: Run**

Run: `cargo test -p tapstone-proto --test transcript`
Expected: 2 passed.

- [ ] **Step 5: Perturb, then commit**

Perturbation: skip `h.update(header)` → `the_sha_commits_to_every_byte` red at header byte 0; restore.

```bash
git add rust/tapstone-proto/src/lib.rs rust/tapstone-proto/src/transcript.rs rust/tapstone-proto/tests/transcript.rs
git commit -m "feat(proto): TSX1 transcript and transcript_sha (36 B header, derived)"
```

---

## Task 6: The reference follower

The shrine side of §4.3–4.5 in `no_std`: apply commits in order, ACK, NAK a gap, ignore
duplicates, halt on a hash split or a refused commit, keep every record for the hand-back, and,
when the arena is dark, arbitrate. Fixed capacity: `LOG_CAP = 256` records (8 KB).

**Files:**
- Create: `rust/tapstone-proto/src/follower.rs`, `rust/tapstone-proto/tests/follower.rs`
- Modify: `rust/tapstone-proto/src/lib.rs` (uncomment `pub mod follower;`)

- [ ] **Step 1: Write the failing tests**

`rust/tapstone-proto/tests/follower.rs`:

```rust
use tapstone_proto::follower::{Follower, LOG_CAP, OnCommit};
use tapstone_proto::frame::{Commit, halt_reason};
use tapstone_rules::{Commander, Game, HouseRules, Kind, Record};
use tapstone_sim::{CASTLES, ScriptedSeat, build_deck, claim};

fn lobby(seed: u64) -> Game {
    let d = [build_deck(seed, 0), build_deck(seed, 1)];
    Game::new(HouseRules::default(), CASTLES, [&d[0], &d[1]])
}

/// An interim arbiter (a follower in `arbitrate` mode) plays a whole scripted game; a second
/// follower applies its commits. Returns both.
fn play(seed: u64) -> (Follower, Follower, Vec<Commit>) {
    let mut arb = Follower::new(lobby(seed));
    let mut fol = Follower::new(lobby(seed));
    let mut commits = Vec::new();
    for c in [claim(0, CASTLES[0], Commander::LEVEL_1), claim(1, CASTLES[1], Commander::LEVEL_1)] {
        commits.push(arb.arbitrate(c, 0).unwrap());
    }
    let mut seats = [ScriptedSeat::new(seed, 0), ScriptedSeat::new(seed, 1)];
    let mut refused = 0;
    for _ in 0..500 {
        if arb.game.phase != tapstone_rules::Phase::Playing {
            break;
        }
        // 0036: every owed draw is a tap. Pay both seats first, from the top of each list.
        for s in 0..2u8 {
            while arb.game.phase == tapstone_rules::Phase::Playing && arb.game.seats[s as usize].owed_draws() > 0 {
                let c = arb.game.top_of_list(s).unwrap();
                commits.push(arb.arbitrate(tapstone_sim::tap(s, Kind::Draw, c, -1, 0, 0), 0).unwrap());
            }
        }
        if arb.game.phase != tapstone_rules::Phase::Playing {
            break;
        }
        let a = arb.game.active;
        let tap = seats[a as usize].next_tap(&arb.game);
        match arb.arbitrate(tap, 0) {
            Ok(c) => {
                commits.push(c);
                refused = 0;
            }
            Err(_) => {
                refused += 1;
                if refused >= 3 {
                    let pass = tapstone_sim::tap(a, Kind::Pass, 0, -1, 0, 0);
                    commits.push(arb.arbitrate(pass, 0).unwrap());
                    refused = 0;
                }
            }
        }
    }
    for c in &commits {
        assert!(matches!(fol.on_commit(c), OnCommit::Applied { .. }), "commit {} not applied", c.mseq);
    }
    (arb, fol, commits)
}

#[test]
fn a_follower_tracks_the_arbiter_to_the_last_hash() {
    for seed in [1u64, 2, 3] {
        let (arb, fol, commits) = play(seed);
        assert_eq!(fol.head_hash(), arb.head_hash(), "seed {seed}");
        assert_eq!(fol.records(), arb.records());
        assert_eq!(fol.records().len(), commits.len());
        assert!(fol.records().len() < LOG_CAP, "a whole game fits the log");
    }
}

#[test]
fn a_gap_is_nakked_and_a_duplicate_is_acked_and_dropped() {
    let (_, _, commits) = play(1);
    let mut f = Follower::new(lobby(1));
    assert!(matches!(f.on_commit(&commits[0]), OnCommit::Applied { .. }));
    match f.on_commit(&commits[3]) {
        OnCommit::Gap { nak } => assert_eq!((nak.from, nak.to), (1, 2)),
        other => panic!("{other:?}"),
    }
    assert!(matches!(f.on_commit(&commits[0]), OnCommit::Duplicate { .. }));
    assert_eq!(f.records().len(), 1, "neither the gap nor the duplicate was applied");
}

#[test]
fn a_hash_split_halts_and_stays_halted() {
    let (_, _, mut commits) = play(2);
    let mut f = Follower::new(lobby(2));
    let bad = 5;
    commits[bad].hash[0] ^= 0xFF;
    for c in &commits[..bad] {
        f.on_commit(c);
    }
    match f.on_commit(&commits[bad]) {
        OnCommit::Halt(x) => assert_eq!((x.at_mseq, x.reason), (bad as u16, halt_reason::HASH)),
        other => panic!("{other:?}"),
    }
    assert!(matches!(f.on_commit(&commits[bad + 1]), OnCommit::Halt(_)));
}

#[test]
fn a_committed_record_the_engine_refuses_halts() {
    let (_, _, mut commits) = play(3);
    let mut f = Follower::new(lobby(3));
    for c in &commits[..4] {
        f.on_commit(c);
    }
    commits[4].record.kind = Kind::ClaimSeat; // illegal while Playing
    match f.on_commit(&commits[4]) {
        OnCommit::Halt(x) => assert_eq!(x.reason, halt_reason::REFUSED),
        other => panic!("{other:?}"),
    }
}

#[test]
fn hand_back_chunks_reassemble_to_the_records() {
    let (arb, _, _) = play(1);
    let from = 10u16;
    let first = arb.handback(from, 0).unwrap();
    let mut got: Vec<[u8; 32]> = Vec::new();
    for idx in 0..first.count {
        let hb = arb.handback(from, idx).unwrap();
        assert_eq!((hb.from_mseq, hb.count), (from, first.count));
        got.extend_from_slice(&hb.records[..hb.n as usize]);
    }
    assert_eq!(got, arb.records()[from as usize..]);
    assert!(arb.handback(from, first.count).is_none());
}

#[test]
fn records_carry_the_arbiters_seq() {
    let (arb, _, _) = play(1);
    for (i, r) in arb.records().iter().enumerate() {
        assert_eq!(Record::decode(r).unwrap().seq as usize, i);
    }
}
```

- [ ] **Step 2: Run to watch it fail**

Run: `cargo test -p tapstone-proto --test follower`
Expected: FAIL to compile (`follower` module missing).

- [ ] **Step 3: Implement**

`rust/tapstone-proto/src/follower.rs`:

```rust
//! A reference follower (arena spec D3): what a shrine does with `C` frames, and how it arbitrates
//! while the arena is dark. `no_std`, no alloc, fixed capacity.
use tapstone_rules::{Applied, Chain, Game, Record, Refusal};

use crate::frame::{Ack, Commit, HANDBACK_RECORDS, Halt, Handback, Nak, halt_reason};
use crate::transcript::{RECORD_LEN, record_bytes};

/// 256 records × 32 B = 8 KB: a stop-round Duel with margin (goldens run 48–80 records).
pub const LOG_CAP: usize = 256;

/// The follower's RAM budget on the shrine: 8.5 KiB. Measured 8,584 B on xtensa-esp32s3 and
/// thumbv7em (8,592 on x86_64) on 2026-09-23. Asserted here, so every target's compiler evaluates it
/// (verification.md's size rule, the same shape as `Game`'s 350 B).
pub const FOLLOWER_BUDGET: usize = 8704;
const _: () = assert!(
    core::mem::size_of::<Follower>() <= FOLLOWER_BUDGET,
    "size_of::<Follower>() exceeds the shrine's 8.5 KiB follower budget on this target"
);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OnCommit {
    Applied { ack: Ack },
    Duplicate { ack: Ack },
    Gap { nak: Nak },
    Halt(Halt),
    /// The log is full; the follower cannot keep the transcript it owes the arena.
    Full,
}

pub struct Follower {
    pub game: Game,
    chain: Option<Chain>,
    log: [[u8; RECORD_LEN]; LOG_CAP],
    log_len: usize,
    halted: Option<Halt>,
}

impl Follower {
    pub fn new(game: Game) -> Follower {
        Follower { game, chain: None, log: [[0; RECORD_LEN]; LOG_CAP], log_len: 0, halted: None }
    }

    /// The next `mseq` this follower will apply: the engine's own `seq`.
    pub fn next_mseq(&self) -> u16 {
        self.game.seq
    }

    /// Chain head, zero before genesis (lobby records carry no hash).
    pub fn head_hash(&self) -> [u8; 8] {
        self.chain.map_or([0; 8], |c| c.head())
    }

    pub fn records(&self) -> &[[u8; RECORD_LEN]] {
        &self.log[..self.log_len]
    }

    pub fn halted(&self) -> Option<Halt> {
        self.halted
    }

    fn hash_at(&self, mseq: u16) -> [u8; 8] {
        let mut h = [0u8; 8];
        if let Some(r) = self.log.get(mseq as usize).filter(|_| (mseq as usize) < self.log_len) {
            h.copy_from_slice(&r[Record::LEN..]);
        }
        h
    }

    /// Apply `r` to the engine and chain; returns the hash to record (zero for lobby records).
    fn step(&mut self, r: &Record) -> Result<[u8; 8], Refusal> {
        let applied = self.game.apply(r)?;
        Ok(if applied == Applied::Started {
            self.chain = Some(Chain::genesis(&self.game));
            [0; 8]
        } else if let Some(c) = self.chain.as_mut() {
            c.step(r, &self.game);
            c.head()
        } else {
            [0; 8]
        })
    }

    fn push(&mut self, r: &Record, hash: [u8; 8]) {
        let lobby = hash == [0; 8];
        self.log[self.log_len] = record_bytes(r, (!lobby).then_some(hash));
        self.log_len += 1;
    }

    pub fn on_commit(&mut self, c: &Commit) -> OnCommit {
        if let Some(x) = self.halted {
            return OnCommit::Halt(x);
        }
        let next = self.next_mseq();
        if c.mseq < next {
            return OnCommit::Duplicate { ack: Ack { mseq: c.mseq, hash: self.hash_at(c.mseq) } };
        }
        if c.mseq > next {
            return OnCommit::Gap { nak: Nak { from: next, to: c.mseq - 1 } };
        }
        if self.log_len == LOG_CAP {
            return OnCommit::Full;
        }
        let mine = self.head_hash();
        match self.step(&c.record) {
            Err(_) => self.halt(c.mseq, halt_reason::REFUSED, mine, c.hash),
            Ok(h) if h != c.hash => self.halt(c.mseq, halt_reason::HASH, h, c.hash),
            Ok(h) => {
                self.push(&c.record, h);
                OnCommit::Applied { ack: Ack { mseq: c.mseq, hash: h } }
            }
        }
    }

    fn halt(&mut self, at_mseq: u16, reason: u8, mine: [u8; 8], theirs: [u8; 8]) -> OnCommit {
        let x = Halt { at_mseq, reason, mine, theirs };
        self.halted = Some(x);
        OnCommit::Halt(x)
    }

    /// Interim arbiter (arena dark, 0028/0029): stamp `seq` and `time_ms`, apply, and commit.
    pub fn arbitrate(&mut self, mut r: Record, time_ms: u32) -> Result<Commit, Refusal> {
        if self.log_len == LOG_CAP {
            return Err(Refusal::GameOver);
        }
        r.seq = self.game.seq;
        r.time_ms = time_ms;
        let h = self.step(&r)?;
        self.push(&r, h);
        Ok(Commit { mseq: r.seq, lseq: 0, record: r, hash: h })
    }

    /// Chunk `idx` of the records from `from_mseq` to the head, six per chunk (spec §6.3).
    pub fn handback(&self, from_mseq: u16, idx: u8) -> Option<Handback> {
        let tail = self.records().get(from_mseq as usize..)?;
        let count = tail.len().div_ceil(HANDBACK_RECORDS).max(1);
        if idx as usize >= count {
            return None;
        }
        let chunk = tail.chunks(HANDBACK_RECORDS).nth(idx as usize).unwrap_or(&[]);
        let mut records = [[0u8; 32]; HANDBACK_RECORDS];
        records[..chunk.len()].copy_from_slice(chunk);
        Some(Handback { from_mseq, idx, count: count as u8, n: chunk.len() as u8, records })
    }
}
```

`push` decides "lobby" from a zero hash. A genuine chain head of eight zero bytes would be mis-filed
as a lobby record, with probability 2⁻⁶⁴ per record; accepted, and noted here so nobody
"fixes" it by adding state.

- [ ] **Step 4: Run**

Run: `cargo test -p tapstone-proto --test follower && cargo build -p tapstone-proto --target thumbv7em-none-eabi`
Expected: 6 passed; the no_std build finishes (`FOLLOWER_BUDGET`'s const assert is evaluated by
both compilers). **Control for the budget:** set `FOLLOWER_BUDGET = 8583` and confirm E0080 on
thumbv7em and, with `. ~/export-esp.sh`, on `xtensa-esp32s3-none-elf`, then restore 8704. A const
assert nobody has seen fail looks identical to one that always holds.

- [ ] **Step 5: Perturb, then commit**

Perturbations, each restored: (1) in `on_commit`, drop the `h != c.hash` arm → `a_hash_split_halts…` red; (2) make `handback` use `chunks(5)` → `hand_back_chunks_reassemble…` red.

```bash
git add rust/tapstone-proto/src/lib.rs rust/tapstone-proto/src/follower.rs rust/tapstone-proto/tests/follower.rs
git commit -m "feat(proto): reference follower with hand-back and interim arbitration (D3)"
```

---

## Task 7: Identity hashes both hosts must agree on — `deck_sigil`, `rules_id`

`L` (§4.1) carries `deck_sigil` ("deck-list hash") and `rules` (house-rules hash), but nothing
computes either today (`decks/*.toml` has `sigil = ""`, "filled by tooling that does not exist
yet"). Both are defined here, once, for the shrine and the arena.

**Files:**
- Create: `rust/tapstone-proto/src/ids.rs`, `rust/tapstone-proto/tests/ids.rs`
- Modify: `rust/tapstone-proto/src/lib.rs` (`pub mod ids;`)

- [ ] **Step 1: Write the failing test**

`rust/tapstone-proto/tests/ids.rs`:

```rust
use tapstone_proto::ids::{deck_sigil, rules_id};
use tapstone_rules::HouseRules;

#[test]
fn a_deck_sigil_names_the_list_not_the_order() {
    let a = [2u16, 3, 4, 2, 11];
    let b = [11u16, 2, 4, 3, 2];
    assert_eq!(deck_sigil(&a), deck_sigil(&b), "shuffling must not change the deck's name");
    assert_ne!(deck_sigil(&a), deck_sigil(&[2, 3, 4, 2, 12]));
    assert_ne!(deck_sigil(&a), deck_sigil(&[2, 3, 4, 11]), "copy counts are part of the list");
}

#[test]
fn rules_id_moves_with_every_rule_byte() {
    let d = HouseRules::default();
    let base = rules_id(&d);
    for i in 0..d.bytes().len() {
        let mut b = d.bytes();
        b[i] = b[i].wrapping_add(1);
        assert_ne!(tapstone_proto::ids::rules_id_bytes(&b), base, "rule byte {i}");
    }
}
```

- [ ] **Step 2: Run to watch it fail**

Run: `cargo test -p tapstone-proto --test ids`
Expected: FAIL to compile (`ids` missing).

- [ ] **Step 3: Implement**

`rust/tapstone-proto/src/ids.rs`:

```rust
//! Four-byte identities carried in `L` (§4.1): the first 4 bytes of a SHA-256, little-endian.
use sha2::{Digest, Sha256};
use tapstone_rules::HouseRules;

fn first4(d: &[u8]) -> u32 {
    u32::from_le_bytes([d[0], d[1], d[2], d[3]])
}

/// The deck's name on the wire: a hash of the sorted design list, so the physical shuffle never
/// changes it and copy counts do.
pub fn deck_sigil(cards: &[u16]) -> u32 {
    let mut sorted = [0u16; 32];
    let n = cards.len().min(sorted.len());
    sorted[..n].copy_from_slice(&cards[..n]);
    sorted[..n].sort_unstable();
    let mut h = Sha256::new();
    h.update(b"tapstone:deck");
    for c in &sorted[..n] {
        h.update(c.to_le_bytes());
    }
    first4(&h.finalize())
}

pub fn rules_id_bytes(b: &[u8; 9]) -> u32 {
    let mut h = Sha256::new();
    h.update(b"tapstone:rules");
    h.update(b);
    first4(&h.finalize())
}

pub fn rules_id(r: &HouseRules) -> u32 {
    rules_id_bytes(&r.bytes())
}
```

`sorted` holds 32 entries because decks are ≤ 30 cards (`DECK_MAX`). A longer slice is truncated.
The engine clamps decks to 30 anyway, so a longer deck is already a different deck to it.

- [ ] **Step 4: Run and commit**

Run: `cargo test -p tapstone-proto --test ids` → 2 passed.
Perturbation: drop `sort_unstable()` → the first test goes red; restore.

```bash
git add rust/tapstone-proto/src/lib.rs rust/tapstone-proto/src/ids.rs rust/tapstone-proto/tests/ids.rs
git commit -m "feat(proto): deck_sigil and rules_id, the identities L carries"
```

---

## Task 8: `tapstone-arena` skeleton — manifest, registry, deck book

**Files:**
- Modify: `rust/Cargo.toml` (members += `"tapstone-arena"`)
- Create: `rust/tapstone-arena/Cargo.toml`, `src/lib.rs`, `src/registry.rs`, `src/decks.rs`, `tests/registry.rs`

- [ ] **Step 1: Manifest**

`rust/tapstone-arena/Cargo.toml`:

```toml
[package]
name = "tapstone-arena"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true
description = "The Tapstone arena: arbiter, battlefield canvas, commander ledger and transcript poster (0028)."

[dependencies]
tapstone-rules = { path = "../tapstone-rules" }
tapstone-proto = { path = "../tapstone-proto" }
tapstone-progression = { path = "../tapstone-progression" }
tapstone-sim = { path = "../tapstone-sim" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
toml = "0.8"
sha2 = "0.11"
rusqlite = { version = "0.32", features = ["bundled"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time", "net", "signal"] }
tokio-stream = { version = "0.1", features = ["sync"] }
axum = "0.8"
serialport = "4"
ureq = { version = "2", features = ["json"] }
clap = { version = "4", features = ["derive"] }
realm-sigil = { git = "https://github.com/jphein/sigil.realm.watch", rev = "9c19c3f" }

[dev-dependencies]
tempfile = "3"
nix = { version = "0.29", features = ["term", "fs"] }
```

`hmac` is deliberately absent: RESULT is unsigned in playtest one (spec §11).

- [ ] **Step 2: Write the failing test**

`rust/tapstone-arena/tests/registry.rs`:

```rust
use tapstone_arena::decks::DeckBook;
use tapstone_arena::registry::Registry;
use tapstone_proto::ids::deck_sigil;

#[test]
fn the_registry_maps_colon_uids_to_design_indices_and_skips_foreign_rows() {
    let jsonl = concat!(
        r#"{"uid":"04:89:4F:72:D5:2A:81","design":"st1-003","batch":"b","tag":"NTAG215"}"#, "\n",
        r#"{"uid":"04:77:C8:BD:CC:2A:81","design":"demo-hullbreaker-horror","batch":"b","tag":"NTAG215"}"#, "\n",
    );
    // A numbered id from another game: only the `st` prefix check can refuse it, since its number
    // parses (the demo row above is refused by the number alone, so it cannot see the prefix check).
    let jsonl = format!("{jsonl}{}\n", r#"{"uid":"04:11:22:33:44:55:66","design":"mt1-004","batch":"b","tag":"NTAG215"}"#);
    let r = Registry::from_jsonl(&jsonl).unwrap();
    assert_eq!(r.resolve([0x04, 0x89, 0x4F, 0x72, 0xD5, 0x2A, 0x81]), Some(3));
    assert_eq!(r.resolve([0x04, 0x77, 0xC8, 0xBD, 0xCC, 0x2A, 0x81]), None, "not a Tapstone design");
    assert_eq!(r.resolve([0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]), None, "another game's numbered id");
    assert_eq!(r.len(), 1);
}

#[test]
fn a_trusting_registry_believes_the_card_field() {
    let r = Registry::Trusting;
    assert_eq!(r.resolve_or([9; 7], 5), Some(5));
    let strict = Registry::from_jsonl("").unwrap();
    assert_eq!(strict.resolve_or([9; 7], 5), None);
}

#[test]
fn the_repo_decks_load_and_are_found_by_sigil() {
    let book = DeckBook::load_repo().unwrap();
    assert!(book.len() >= 2);
    for d in book.iter() {
        assert_eq!(book.by_sigil(deck_sigil(&d.cards)).map(|x| &x.name), Some(&d.name));
    }
}
```

- [ ] **Step 3: Run to watch it fail**

Run: `cargo test -p tapstone-arena --test registry`
Expected: FAIL to compile.

- [ ] **Step 4: Implement**

`rust/tapstone-arena/src/lib.rs`:

```rust
//! The Tapstone arena (0028): arbiter, board, ledger, record. See
//! docs/superpowers/specs/2026-09-23-arena-service-design.md.
pub mod decks;
pub mod registry;
```

(Later tasks add `pub mod core; pub mod ledger; pub mod view; pub mod link; pub mod http;
pub mod poster; pub mod config;` as they create them.)

`rust/tapstone-arena/src/registry.rs`:

```rust
//! The copy registry (`registry/copies.jsonl`, card-data-format.md): tag UID → design index.
//! The arena resolves every tapped UID here (protocol §3: "resolved by the arbiter from the UID
//! registry"). `Trusting` believes the record's `card` field, for desk mode and tests only.
use std::collections::HashMap;

use serde::Deserialize;

#[derive(Deserialize)]
struct Row {
    uid: String,
    design: String,
}

pub enum Registry {
    Strict(HashMap<[u8; 7], u16>),
    Trusting,
}

fn parse_uid(s: &str) -> Option<[u8; 7]> {
    let hex: String = s.chars().filter(|c| *c != ':').collect();
    if hex.len() != 14 {
        return None;
    }
    let mut out = [0u8; 7];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
}

/// `st1-003` → 3. Anything else (a demo row, another game's slug) is not a Tapstone design.
fn parse_design(s: &str) -> Option<u16> {
    let (set, n) = s.split_once('-')?;
    if !set.starts_with("st") || n.len() != 3 {
        return None;
    }
    n.parse().ok()
}

impl Registry {
    pub fn from_jsonl(text: &str) -> Result<Registry, String> {
        let mut map = HashMap::new();
        for (i, line) in text.lines().enumerate().filter(|(_, l)| !l.trim().is_empty()) {
            let row: Row = serde_json::from_str(line).map_err(|e| format!("line {}: {e}", i + 1))?;
            let uid = parse_uid(&row.uid).ok_or_else(|| format!("line {}: bad uid {:?}", i + 1, row.uid))?;
            if let Some(d) = parse_design(&row.design) {
                map.insert(uid, d);
            }
        }
        Ok(Registry::Strict(map))
    }

    pub fn load(path: &std::path::Path) -> Result<Registry, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        Self::from_jsonl(&text)
    }

    pub fn resolve(&self, uid: [u8; 7]) -> Option<u16> {
        match self {
            Registry::Strict(m) => m.get(&uid).copied(),
            Registry::Trusting => None,
        }
    }

    /// The design for a tap: the registry's in strict mode, the proposal's `card` when trusting.
    pub fn resolve_or(&self, uid: [u8; 7], proposed: u16) -> Option<u16> {
        match self {
            Registry::Strict(_) => self.resolve(uid),
            Registry::Trusting => Some(proposed),
        }
    }

    pub fn len(&self) -> usize {
        match self {
            Registry::Strict(m) => m.len(),
            Registry::Trusting => 0,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}
```

`rust/tapstone-arena/src/decks.rs`:

```rust
//! Deck records (`decks/*.toml`) found by the sigil a shrine beacons in `L`.
use tapstone_proto::ids::deck_sigil;
use tapstone_rules::HouseRules;
use tapstone_sim::deck::{Deck, load_all};

pub struct DeckBook {
    decks: Vec<Deck>,
}

impl DeckBook {
    pub fn new(decks: Vec<Deck>) -> DeckBook {
        DeckBook { decks }
    }

    /// Every deck under the repo's `decks/` (tapstone-sim's loader and validation).
    pub fn load_repo() -> Result<DeckBook, String> {
        let (decks, errors) = load_all(&HouseRules::default());
        if let Some(e) = errors.first() {
            return Err(e.to_string());
        }
        Ok(DeckBook { decks })
    }

    pub fn by_sigil(&self, sigil: u32) -> Option<&Deck> {
        self.decks.iter().find(|d| deck_sigil(&d.cards) == sigil)
    }

    pub fn iter(&self) -> impl Iterator<Item = &Deck> {
        self.decks.iter()
    }

    pub fn len(&self) -> usize {
        self.decks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.decks.is_empty()
    }
}
```

- [ ] **Step 5: Run and commit**

Run: `cargo test -p tapstone-arena --test registry` → 3 passed.
Perturbation: make `parse_design` accept any prefix → the first test goes red on the demo row; restore.

```bash
git add rust/Cargo.toml rust/tapstone-arena/Cargo.toml rust/tapstone-arena/src/lib.rs rust/tapstone-arena/src/registry.rs rust/tapstone-arena/src/decks.rs rust/tapstone-arena/tests/registry.rs
git commit -m "feat(arena): crate skeleton, copy registry and deck book"
```

---

## Task 9: The core's types and the test harness

**Files:**
- Create: `rust/tapstone-arena/src/core/mod.rs`, `rust/tapstone-arena/tests/harness.rs`, `rust/tapstone-arena/tests/core_lobby.rs`
- Modify: `rust/tapstone-arena/src/lib.rs` (`pub mod core;`)

- [ ] **Step 1: Write the core's public types (no behaviour yet)**

`rust/tapstone-arena/src/core/mod.rs`:

```rust
//! The sans-IO arbiter (arena spec D1): `handle(Input, now_ms) -> Vec<Output>`. No sockets, no
//! clock, no database. Adapters run the outputs **in order**: a `Journal` output always precedes the
//! `Send` of the same commit, and the adapter must persist it before sending (spec D10).
mod lobby;
mod play;

use tapstone_proto::frame::{Doll, Equip, FRAME_MAX, Frame, Header, MatchResult};
use tapstone_progression::Loadout;
use tapstone_rules::{Applied, Chain, Game, HouseRules, Record};

use crate::decks::DeckBook;
use crate::registry::Registry;

pub use lobby::Claim;

pub struct CoreConfig {
    /// The arena's own node id (the gateway's, as seen on the mesh).
    pub node: u8,
    pub rules: HouseRules,
    /// First 4 B of the running build's hash, the `ruleset` in `L`.
    pub ruleset: u32,
    pub registry_id: u32,
    /// 0030 `progression = flat`.
    pub flat: bool,
    /// Unix seconds at `now_ms == 0`, for `match` ids and the transcript's `start_ts`.
    pub epoch_unix: u32,
}

#[derive(Debug, Clone)]
pub enum Input {
    Frame { src: u8, rssi: i8, mac_ok: bool, bytes: Vec<u8> },
    Tick,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Output {
    Send { dst: u8, frame: Vec<u8> },
    Journal(JournalOp),
    View(crate::view::ViewModel),
    MatchOver(Box<MatchOver>),
    Log(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum JournalOp {
    Begin { match_id: u32, rules: [u8; 9], nodes: [u8; 2], figurines: [[u8; 7]; 2], decks: [Vec<u16>; 2], start_unix: u32 },
    Record { match_id: u32, record: [u8; 24], hash: Option<[u8; 8]> },
    End { match_id: u32, result: MatchResult },
}

/// Everything the ledger and the poster need once a match ends.
#[derive(Debug, Clone, PartialEq)]
pub struct MatchOver {
    pub match_id: u32,
    pub result: MatchResult,
    /// Seat 0 / 1's mesh nodes, so the binary can send each station its post-match `D`.
    pub nodes: [u8; 2],
    pub figurines: [[u8; 7]; 2],
    /// Seat 0 / 1 winner, `None` for a desync.
    pub winner: Option<u8>,
    /// The round the match ended in (0030's "abandoned before round 3" rule).
    pub round: u8,
    pub tsx1: Vec<u8>,
    pub json: tapstone_sim::Transcript,
}

/// The ledger, as the core sees it: read a commander at claim time, serve and change loadouts.
/// Implemented by `ledger::Ledger` in production and by `FixedStats` in tests.
pub trait StatsSource {
    /// `(level, loadout, castle faction ok)` for this figurine, creating the commander on first
    /// sight. `Err` carries an `arena_refusal` code.
    fn commander(&mut self, figurine: [u8; 7], castle: u16) -> Result<(u8, Loadout), u8>;
    fn doll(&mut self, figurine: [u8; 7], seat: u8) -> Option<Doll>;
    fn equip(&mut self, figurine: [u8; 7], e: &Equip, registry: &Registry) -> Result<Doll, u8>;
}

pub trait Signer {
    /// `(sig_kind, sig)` over `transcript_sha ‖ match ‖ winner ‖ reason` (protocol §7).
    fn sign(&self, r: &MatchResult, match_id: u32) -> (u8, [u8; 64]);
}

pub struct Unsigned;
impl Signer for Unsigned {
    fn sign(&self, _: &MatchResult, _: u32) -> (u8, [u8; 64]) {
        (0, [0; 64])
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Committed {
    pub record: Record,
    pub hash: Option<[u8; 8]>,
    pub applied: Applied,
    pub lseq: u16,
}

pub(crate) struct Match {
    pub id: u32,
    pub game: Game,
    pub chain: Option<Chain>,
    pub log: Vec<Committed>,
    pub nodes: [u8; 2],
    pub figurines: [[u8; 7]; 2],
    pub decks: [Vec<u16>; 2],
    pub sigils: [u32; 2],
    pub started_ms: u64,
    pub start_unix: u32,
    pub acked: [Option<u16>; 2],
    pub last_heard: [u64; 2],
    pub last_tx: [u64; 2],
    pub tries: [u8; 2],
    pub last_lseq: [Option<u16>; 2],
    pub last_broadcast: u64,
    pub paused: bool,
}

pub(crate) enum Table {
    Lobby(lobby::Lobby),
    Match(Box<Match>),
}

pub struct ArenaCore {
    pub(crate) cfg: CoreConfig,
    pub(crate) stats: Box<dyn StatsSource + Send>,
    pub(crate) decks: DeckBook,
    pub(crate) registry: Registry,
    pub(crate) signer: Box<dyn Signer + Send>,
    pub(crate) table: Table,
    pub(crate) last_beacon: Option<u64>,
}

impl ArenaCore {
    pub fn new(
        cfg: CoreConfig,
        stats: Box<dyn StatsSource + Send>,
        decks: DeckBook,
        registry: Registry,
        signer: Box<dyn Signer + Send>,
    ) -> ArenaCore {
        ArenaCore { cfg, stats, decks, registry, signer, table: Table::Lobby(lobby::Lobby::default()), last_beacon: None }
    }

    pub fn handle(&mut self, input: Input, now: u64) -> Vec<Output> {
        let mut out = Vec::new();
        match input {
            Input::Tick => self.tick(now, &mut out),
            Input::Frame { src, bytes, .. } => {
                if let Some((h, f)) = Frame::decode(&bytes) {
                    self.frame(src, h, f, now, &mut out);
                }
            }
        }
        out
    }

    pub(crate) fn send(&self, out: &mut Vec<Output>, dst: u8, match_id: u32, f: &Frame) {
        let mut buf = [0u8; FRAME_MAX];
        let n = f.encode(&Header { match_id, src: self.cfg.node }, &mut buf);
        out.push(Output::Send { dst, frame: buf[..n].to_vec() });
    }

    fn frame(&mut self, src: u8, h: Header, f: Frame, now: u64, out: &mut Vec<Output>) {
        if matches!(self.table, Table::Lobby(_)) {
            self.lobby_frame(src, f, now, out);
        } else {
            self.play_frame(src, h, f, now, out);
        }
    }

    fn tick(&mut self, now: u64, out: &mut Vec<Output>) {
        if matches!(self.table, Table::Lobby(_)) {
            self.lobby_tick(now, out);
        } else {
            self.play_tick(now, out);
        }
    }

    /// The board, for the canvas: the current game if a match is running.
    pub fn view(&self) -> crate::view::ViewModel {
        match &self.table {
            Table::Match(m) => crate::view::ViewModel::of_match(m, None),
            Table::Lobby(l) => crate::view::ViewModel::of_lobby(l),
        }
    }
}
```

Note the forward references: `crate::view::ViewModel` (Task 16) is needed by `Output::View`. To
keep this task compiling, create `rust/tapstone-arena/src/view.rs` now with a placeholder that
Task 16 replaces:

```rust
//! The canvas's view model. Filled in by Task 18; the core only needs the type and two
//! constructors now.
use serde::Serialize;

use crate::core::{Match, lobby_view::LobbyView};

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct ViewModel {
    pub phase: String,
}

impl ViewModel {
    pub(crate) fn of_match(_m: &Match, _last: Option<usize>) -> ViewModel {
        ViewModel { phase: "match".into() }
    }
    pub(crate) fn of_lobby(_l: &LobbyView) -> ViewModel {
        ViewModel { phase: "lobby".into() }
    }
}
```

and in `core/mod.rs` add `pub(crate) mod lobby_view { pub use super::lobby::Lobby as LobbyView; }`.
Add `pub mod view;` to `lib.rs`.

- [ ] **Step 2: Write the test harness**

`rust/tapstone-arena/tests/harness.rs` (included by every core test with `mod harness;`):

```rust
//! Two simulated shrines on an in-memory mesh around one ArenaCore. Each shrine is the reference
//! follower (tapstone-proto) plus a ScriptedSeat choosing its taps, i.e. the shrine firmware's logic
//! without the radio. Loss and duplication are injected on the mesh, seeded, so a failure replays.
#![allow(dead_code)]
use std::collections::VecDeque;

use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use tapstone_arena::core::{ArenaCore, CoreConfig, Input, MatchOver, Output, StatsSource, Unsigned};
use tapstone_arena::decks::DeckBook;
use tapstone_arena::registry::Registry;
use tapstone_proto::follower::{Follower, OnCommit};
use tapstone_proto::frame::*;
use tapstone_proto::ids::deck_sigil;
use tapstone_progression::Loadout;
use tapstone_rules::{Game, HouseRules, Kind, Phase, Record};
use tapstone_sim::deck::Deck;
use tapstone_sim::{CASTLES, ScriptedSeat, build_deck};

pub const ARENA: u8 = 200;
pub const NODES: [u8; 2] = [163, 164];

pub struct FixedStats(pub [(u8, Loadout); 2]);
impl StatsSource for FixedStats {
    fn commander(&mut self, figurine: [u8; 7], _castle: u16) -> Result<(u8, Loadout), u8> {
        Ok(self.0[figurine[6] as usize])
    }
    fn doll(&mut self, _: [u8; 7], seat: u8) -> Option<Doll> {
        Some(Doll { seat, level: 1, xp: 0, xp_next: 5, slots: 2, loadout: [NONE16; 3], inv_len: 0, inv: [0; GRID_MAX], keyword: NONE8, name_seed: 0 })
    }
    fn equip(&mut self, _: [u8; 7], _: &Equip, _: &Registry) -> Result<Doll, u8> {
        Err(arena_refusal::BAD_LOADOUT)
    }
}

pub struct Shrine {
    pub node: u8,
    pub seat_ai: ScriptedSeat,
    pub follower: Follower,
    pub deck: Vec<u16>,
    pub lseq: u16,
    pub pending: Option<(u16, u64)>,
    pub refused: u8,
    /// Index into the decks: which physical deck this shrine's player holds.
    pub deck_idx: u8,
}

pub struct Net {
    pub core: ArenaCore,
    pub shrines: [Shrine; 2],
    pub now: u64,
    pub wire: VecDeque<(u8, u8, Vec<u8>)>, // (from, to, bytes); to = 255 broadcast
    pub rng: StdRng,
    pub loss: f64,
    pub dup: f64,
    pub over: Vec<MatchOver>,
    pub journal: Vec<tapstone_arena::core::JournalOp>,
    pub arena_up: bool,
}

pub fn lobby_game(decks: &[Vec<u16>; 2]) -> Game {
    Game::new(HouseRules::default(), CASTLES, [&decks[0], &decks[1]])
}

impl Net {
    /// Seed `seed`'s shuffle for both decks (the shared digital shuffle; spec §17 question 0).
    /// Shrine 0 claims first, so it is seat 0.
    pub fn new(seed: u64, loss: f64, dup: f64) -> Net {
        let decks = [build_deck(seed, 0), build_deck(seed, 1)];
        let book = DeckBook::new(
            (0..2)
                .map(|i| Deck { name: format!("d{i}"), owner: "t".into(), castle: CASTLES[i], cards: decks[i].clone(), sigil: String::new() })
                .collect(),
        );
        let cfg = CoreConfig { node: ARENA, rules: HouseRules::default(), ruleset: 1, registry_id: 2, flat: false, epoch_unix: 1_789_980_000 };
        let core = ArenaCore::new(cfg, Box::new(FixedStats([(1, [None; 3]); 2])), book, Registry::Trusting, Box::new(Unsigned));
        let shrine = |i: usize| Shrine {
            node: NODES[i],
            seat_ai: ScriptedSeat::new(seed, i as u8),
            follower: Follower::new(lobby_game(&decks)),
            deck: decks[i].clone(),
            lseq: 0,
            pending: None,
            refused: 0,
            deck_idx: i as u8,
        };
        Net { core, shrines: [shrine(0), shrine(1)], now: 0, wire: VecDeque::new(), rng: StdRng::seed_from_u64(seed ^ 0x5EED), loss, dup, over: vec![], journal: vec![], arena_up: true }
    }

    fn encode(src: u8, match_id: u32, f: &Frame) -> Vec<u8> {
        let mut buf = [0u8; FRAME_MAX];
        let n = f.encode(&Header { match_id, src }, &mut buf);
        buf[..n].to_vec()
    }

    pub fn put(&mut self, from: u8, to: u8, bytes: Vec<u8>) {
        if self.rng.random_bool(self.loss) {
            return;
        }
        if self.rng.random_bool(self.dup) {
            self.wire.push_back((from, to, bytes.clone()));
        }
        self.wire.push_back((from, to, bytes));
    }

    fn run_core(&mut self, input: Input) {
        if !self.arena_up {
            return;
        }
        let now = self.now;
        for o in self.core.handle(input, now) {
            match o {
                Output::Send { dst, frame } => self.put(ARENA, dst, frame),
                Output::Journal(j) => self.journal.push(j),
                Output::MatchOver(m) => self.over.push(*m),
                Output::View(_) | Output::Log(_) => {}
            }
        }
    }

    /// One scheduler step: every shrine beacons or taps, the core ticks, and the wire drains.
    pub fn step(&mut self) {
        self.now += 10;
        for i in 0..2 {
            self.shrine_act(i);
        }
        self.run_core(Input::Tick);
        while let Some((from, to, bytes)) = self.wire.pop_front() {
            if to == ARENA || (to == BROADCAST && from != ARENA) {
                self.run_core(Input::Frame { src: from, rssi: -40, mac_ok: true, bytes: bytes.clone() });
            }
            for i in 0..2 {
                if self.shrines[i].node != from && (to == BROADCAST || to == self.shrines[i].node) {
                    self.shrine_rx(i, &bytes);
                }
            }
        }
    }

    fn shrine_act(&mut self, i: usize) {
        // Shrine 1 claims only once the arena holds shrine 0's claim, so claim order is fixed
        // even under loss: the followers' lobby game assumes shrine 0 is seat 0. (Waiting for
        // shrine 0 merely to *send* its claim let a lost claim seat shrine 1 first; the arena
        // then correctly halted the mismatched followers.) The harness looks at the core here,
        // which a shrine cannot: how a real shrine learns the seat map is its own question.
        let may_claim = i == 0 || self.core.seated().first() == Some(&self.shrines[0].node);
        let now = self.now;
        let s = &mut self.shrines[i];
        let node = s.node;
        if s.follower.game.phase == Phase::Lobby {
            // Beacon the deck; tap the castle figurine (uid ends in the shrine index) and re-send
            // that claim every 100 ms, same lseq, until the match starts: a lost claim must not
            // strand the lobby, and the arena ignores a claim it already holds.
            let lobby = Frame::Lobby(Lobby { seat_pref: i as u8, deck_sigil: deck_sigil(&s.deck), ruleset: 1, registry: 2, rules: tapstone_proto::ids::rules_id(&HouseRules::default()), flags: lobby_flags::WANTS_MATCH });
            let claim = Record { seq: 0, seat: i as u8, kind: Kind::ClaimSeat, card: CASTLES[s.deck_idx as usize], lane: -1, target: 0, aux: 0, time_ms: 0, uid: [4, 0, 0, 0, 0, 0, i as u8], auth: 0 };
            let due = s.pending.is_none_or(|(_, sent)| now - sent >= 100);
            let beacon = Self::encode(node, 0, &lobby);
            let tap = Self::encode(node, 0, &Frame::Tap(Tap::Propose { lseq: 1, record: claim }));
            if may_claim && due {
                s.lseq = 1;
                s.pending = Some((1, now));
            }
            let send_claim = may_claim && due;
            self.put(node, BROADCAST, beacon);
            if send_claim {
                self.put(node, ARENA, tap);
            }
            return;
        }
        if s.pending.is_some_and(|(l, _)| l == 1) && s.lseq == 1 {
            s.pending = None; // the claim was answered by the match starting
        }
        let g = &s.follower.game;
        // 0036: a seat that owes draws taps them first, from the top of its list. An opening hand
        // is owed off-turn too, so this comes before the turn check.
        let owes_draw = g.phase == Phase::Playing && g.seats[i].owed_draws() > 0;
        if !owes_draw && (g.phase != Phase::Playing || g.active != (i as u8)) {
            return;
        }
        if let Some((_, sent)) = s.pending
            && self.now - sent < 100
        {
            return; // retransmit at 100 ms (protocol §4.3)
        }
        let tap = if owes_draw {
            let c = g.top_of_list(i as u8).expect("a seat that owes has an undrawn copy");
            tapstone_sim::tap(i as u8, Kind::Draw, c, -1, 0, 0)
        } else if s.refused >= 3 {
            s.refused = 0;
            tapstone_sim::tap(i as u8, Kind::Pass, 0, -1, 0, 0)
        } else {
            s.seat_ai.next_tap(g)
        };
        s.lseq += 1;
        s.pending = Some((s.lseq, self.now));
        let f = Frame::Tap(Tap::Propose { lseq: s.lseq, record: tap });
        let bytes = Self::encode(node, 0, &f);
        self.put(node, ARENA, bytes);
    }

    fn shrine_rx(&mut self, i: usize, bytes: &[u8]) {
        let Some((h, f)) = Frame::decode(bytes) else { return };
        let node = self.shrines[i].node;
        match f {
            Frame::Commit(c) => {
                let s = &mut self.shrines[i];
                if s.pending.is_some_and(|(l, _)| l == c.lseq) && c.record.seat == i as u8 {
                    s.pending = None;
                    s.refused = 0;
                }
                let reply = match s.follower.on_commit(&c) {
                    OnCommit::Applied { ack } | OnCommit::Duplicate { ack } => Frame::Ack(ack),
                    OnCommit::Gap { nak } => Frame::Nak(nak),
                    OnCommit::Halt(x) => Frame::Halt(x),
                    OnCommit::Full => return,
                };
                let b = Self::encode(node, h.match_id, &reply);
                self.put(node, ARENA, b);
            }
            Frame::Tap(Tap::Reject { lseq, .. }) => {
                let s = &mut self.shrines[i];
                if s.pending.is_some_and(|(l, _)| l == lseq) {
                    s.pending = None;
                    s.refused += 1;
                }
            }
            _ => {}
        }
    }

    /// Run until the match ends or `max_steps` pass.
    pub fn run(&mut self, max_steps: usize) -> bool {
        for _ in 0..max_steps {
            self.step();
            if !self.over.is_empty() {
                // Drain the trailing acks/commits so every follower reaches the head.
                for _ in 0..20 {
                    self.step();
                }
                return true;
            }
        }
        false
    }
}
```

The harness uses `rand`; add `rand = { version = "0.9", features = ["std_rng"] }` to
`[dev-dependencies]` in `rust/tapstone-arena/Cargo.toml`.

- [ ] **Step 3: Write the failing lobby test**

`rust/tapstone-arena/tests/core_lobby.rs`:

```rust
mod harness;
use harness::*;
use tapstone_arena::core::JournalOp;
use tapstone_rules::{Kind, Phase, Record};

#[test]
fn two_castle_taps_start_a_match_in_claim_order_with_arena_stats() {
    let mut net = Net::new(1, 0.0, 0.0);
    for _ in 0..10 {
        net.step();
    }
    let begin = net.journal.iter().find_map(|j| match j {
        JournalOp::Begin { nodes, .. } => Some(*nodes),
        _ => None,
    });
    assert_eq!(begin, Some(NODES), "shrine 0 claimed first, so it is seat 0");
    let claims: Vec<Record> = net.journal.iter().filter_map(|j| match j {
        JournalOp::Record { record, .. } => Record::decode(record).filter(|r| r.kind == Kind::ClaimSeat),
        _ => None,
    }).collect();
    assert_eq!(claims.len(), 2);
    for (seat, c) in claims.iter().enumerate() {
        assert_eq!(c.seat as usize, seat);
        assert_eq!((c.target, c.aux, c.lane), (2, 4, -1), "the arena's stats, not the proposal's 0/0");
    }
    for s in &net.shrines {
        assert_eq!(s.follower.game.phase, Phase::Playing, "node {} did not start", s.node);
    }
}

#[test]
fn an_unknown_deck_is_refused_and_seats_nobody() {
    let mut net = Net::new(2, 0.0, 0.0);
    net.shrines[1].deck = vec![13; 25]; // beacons a sigil the arena does not know
    for _ in 0..10 {
        net.step();
    }
    assert!(!net.journal.iter().any(|j| matches!(j, JournalOp::Begin { .. })));
}
```

- [ ] **Step 4: Run to watch it fail**

Run: `cargo test -p tapstone-arena --test core_lobby`
Expected: FAIL to compile (`lobby_frame`, `play_frame`, `lobby_tick`, `play_tick` not defined; `core::lobby` missing).

Task 10 makes it pass. Do not commit yet; Tasks 9 and 10 commit together.

---

## Task 10: Lobby — beacons, seating in claim order, arena-derived stats, `D` and `E`

**Files:**
- Create: `rust/tapstone-arena/src/core/lobby.rs`, and a stub `rust/tapstone-arena/src/core/play.rs`

- [ ] **Step 1: Implement the lobby**

`rust/tapstone-arena/src/core/lobby.rs`:

```rust
//! Lobby (arena spec §5.1): the arena beacons `L` with the ARENA bit, shrines claim with a
//! castle-figurine tap, seats go in claim order, and the arena writes the commander's stats.
use std::collections::HashMap;

use tapstone_proto::frame::{Frame, Lobby as LobbyFrame, Tap, arena_refusal, lobby_flags, refusal_code};
use tapstone_proto::ids::rules_id;
use tapstone_progression::{Loadout, derive_commander, flat_loadout};
use tapstone_rules::{Commander, Game, Kind, Record};

use super::{ArenaCore, JournalOp, Match, Output, Table};

pub const BEACON_MS: u64 = 2000;

#[derive(Debug, Clone)]
pub struct Claim {
    pub node: u8,
    pub lseq: u16,
    pub figurine: [u8; 7],
    pub castle: u16,
    pub level: u8,
    pub loadout: Loadout,
    pub deck: Vec<u16>,
    pub sigil: u32,
}

#[derive(Default)]
pub struct Lobby {
    pub claims: Vec<Claim>,
    /// The last `L` each node sent: its deck sigil and hashes.
    pub seen: HashMap<u8, LobbyFrame>,
}

impl ArenaCore {
    pub(crate) fn lobby_tick(&mut self, now: u64, out: &mut Vec<Output>) {
        if self.last_beacon.is_some_and(|t| now - t < BEACON_MS) {
            return;
        }
        self.last_beacon = Some(now);
        let l = LobbyFrame {
            seat_pref: 0xFF,
            deck_sigil: 0,
            ruleset: self.cfg.ruleset,
            registry: self.cfg.registry_id,
            rules: rules_id(&self.cfg.rules),
            flags: lobby_flags::ARENA,
        };
        self.send(out, tapstone_proto::frame::BROADCAST, 0, &Frame::Lobby(l));
    }

    fn reject(&self, out: &mut Vec<Output>, node: u8, lseq: u16, reason: u8) {
        self.send(out, node, 0, &Frame::Tap(Tap::Reject { lseq, reason }));
    }

    pub(crate) fn lobby_frame(&mut self, src: u8, f: Frame, now: u64, out: &mut Vec<Output>) {
        let Table::Lobby(lobby) = &mut self.table else { return };
        match f {
            Frame::Lobby(l) => {
                lobby.seen.insert(src, l);
            }
            Frame::Tap(Tap::Propose { lseq, record }) if record.kind == Kind::ClaimSeat => {
                self.claim(src, lseq, record, now, out);
            }
            Frame::Tap(Tap::Propose { lseq, .. }) => self.reject(out, src, lseq, arena_refusal::NOT_SEATED),
            Frame::Equip(e) => {
                let Table::Lobby(lobby) = &self.table else { return };
                let Some(c) = lobby.claims.iter().find(|c| c.node == src).cloned() else { return };
                let seat = lobby.claims.iter().position(|x| x.node == src).unwrap_or(0) as u8;
                match self.stats.equip(c.figurine, &e, &self.registry) {
                    Ok(mut doll) => {
                        doll.seat = seat; // the ledger does not know seats; the lobby does
                        self.send(out, src, 0, &Frame::Doll(doll));
                    }
                    Err(code) => self.reject(out, src, 0, code),
                }
            }
            _ => {}
        }
    }

    fn claim(&mut self, src: u8, lseq: u16, r: Record, now: u64, out: &mut Vec<Output>) {
        let Table::Lobby(lobby) = &self.table else { return };
        if lobby.claims.iter().any(|c| c.node == src) {
            return; // a retransmit of a claim already taken
        }
        if lobby.claims.len() == 2 {
            return self.reject(out, src, lseq, arena_refusal::TABLE_FULL);
        }
        let Some(sigil) = lobby.seen.get(&src).map(|l| l.deck_sigil) else {
            return self.reject(out, src, lseq, arena_refusal::UNKNOWN_DECK);
        };
        let Some(deck) = self.decks.by_sigil(sigil).map(|d| d.cards.clone()) else {
            return self.reject(out, src, lseq, arena_refusal::UNKNOWN_DECK);
        };
        let Some(castle) = self.registry.resolve_or(r.uid, r.card) else {
            return self.reject(out, src, lseq, arena_refusal::UNKNOWN_UID);
        };
        let (level, loadout) = match self.stats.commander(r.uid, castle) {
            Ok(x) => x,
            Err(code) => return self.reject(out, src, lseq, code),
        };
        let seat = lobby.claims.len() as u8;
        let claim = Claim { node: src, lseq, figurine: r.uid, castle, level, loadout, deck, sigil };
        if let Some(doll) = self.stats.doll(r.uid, seat) {
            self.send(out, src, 0, &Frame::Doll(doll));
        }
        let Table::Lobby(lobby) = &mut self.table else { return };
        lobby.claims.push(claim);
        if lobby.claims.len() == 2 {
            self.start(now, out);
        }
    }

    /// Both seats claimed: build the game, derive both commanders (flat mode applied), and commit
    /// the two ClaimSeat records. The second one starts the chain (0022 genesis).
    fn start(&mut self, now: u64, out: &mut Vec<Output>) {
        let Table::Lobby(lobby) = take_lobby(&mut self.table) else { return };
        let c = &lobby.claims;
        let level = if self.cfg.flat { c[0].level.min(c[1].level) } else { 0 };
        let mut commanders = [Commander::LEVEL_1; 2];
        for s in 0..2 {
            let (lv, kit) = if self.cfg.flat { (level, flat_loadout(level, &c[s].loadout)) } else { (c[s].level, c[s].loadout) };
            commanders[s] = match derive_commander(lv, &kit) {
                Ok(k) => k,
                Err(_) => {
                    self.reject(out, c[s].node, c[s].lseq, arena_refusal::BAD_LOADOUT);
                    return; // table back to an empty lobby; both shrines re-claim
                }
            };
        }
        let start_unix = self.cfg.epoch_unix + (now / 1000) as u32;
        let match_id = (u32::from(self.cfg.node) << 24) ^ start_unix;
        let decks = [c[0].deck.clone(), c[1].deck.clone()];
        let game = Game::new(self.cfg.rules, [c[0].castle, c[1].castle], [&decks[0], &decks[1]]);
        out.push(Output::Journal(JournalOp::Begin {
            match_id,
            rules: self.cfg.rules.bytes(),
            nodes: [c[0].node, c[1].node],
            figurines: [c[0].figurine, c[1].figurine],
            decks: decks.clone(),
            start_unix,
        }));
        let m = Match {
            id: match_id,
            game,
            chain: None,
            log: Vec::new(),
            nodes: [c[0].node, c[1].node],
            figurines: [c[0].figurine, c[1].figurine],
            decks,
            sigils: [c[0].sigil, c[1].sigil],
            started_ms: now,
            start_unix,
            acked: [None; 2],
            last_heard: [now; 2],
            last_tx: [now; 2],
            tries: [0; 2],
            last_lseq: [None; 2],
            last_broadcast: now,
            paused: false,
        };
        let claims: Vec<(u8, u16, [u8; 7], u16)> = c.iter().map(|x| (x.node, x.lseq, x.figurine, x.castle)).collect();
        self.table = Table::Match(Box::new(m));
        for (seat, (node, lseq, fig, castle)) in claims.into_iter().enumerate() {
            let k = commanders[seat];
            let rec = Record {
                seq: 0,
                seat: seat as u8,
                kind: Kind::ClaimSeat,
                card: castle,
                lane: k.keyword.map_or(-1, |kw| kw.code() as i8),
                target: k.attack,
                aux: k.toughness,
                time_ms: 0,
                uid: fig,
                auth: 0,
            };
            if let Err(e) = self.commit(rec, lseq, now, out) {
                self.reject(out, node, lseq, refusal_code(&e));
            }
        }
    }
}

/// Swap the lobby out of the table, leaving an empty one behind.
fn take_lobby(t: &mut Table) -> Table {
    std::mem::replace(t, Table::Lobby(Lobby::default()))
}
```

Stub `rust/tapstone-arena/src/core/play.rs` so the crate builds (Task 11 fills it):

```rust
use tapstone_proto::frame::{Frame, Header};
use tapstone_rules::{Record, Refusal};

use super::{ArenaCore, Output};

impl ArenaCore {
    pub(crate) fn play_frame(&mut self, _src: u8, _h: Header, _f: Frame, _now: u64, _out: &mut Vec<Output>) {}
    pub(crate) fn play_tick(&mut self, _now: u64, _out: &mut Vec<Output>) {}
    pub(crate) fn commit(&mut self, _r: Record, _lseq: u16, _now: u64, _out: &mut Vec<Output>) -> Result<(), Refusal> {
        Ok(())
    }
}
```

- [ ] **Step 2: Run the lobby tests**

Run: `cargo test -p tapstone-arena --test core_lobby`
Expected: `an_unknown_deck_is_refused_and_seats_nobody` passes; `two_castle_taps_start…` still
fails (the stub `commit` journals nothing). Task 11 turns it green.

---

## Task 11: Play — taps, commits, ACK/NAK, retransmit, pause, result

**Files:**
- Replace: `rust/tapstone-arena/src/core/play.rs`
- Create: `rust/tapstone-arena/src/transcript.rs`
- Modify: `rust/tapstone-arena/src/lib.rs` (`pub mod transcript;`)

- [ ] **Step 1: Implement the JSON transcript**

`rust/tapstone-arena/src/transcript.rs`:

```rust
//! The JSON rendering of a match: tapstone-sim's `Transcript`, the goldens' shape, so
//! `tapstone_sim::replay` can re-derive every hash through a fresh engine (spec §13).
use tapstone_rules::{HouseRules, Phase};
use tapstone_sim::transcript::{HouseRulesJson, RecordJson, Transcript, hex, winner_str};

use crate::core::Match;

pub(crate) fn to_json(m: &Match, rules: &HouseRules) -> Transcript {
    let records = m
        .log
        .iter()
        .map(|c| {
            let r = &c.record;
            RecordJson {
                seq: r.seq,
                seat: r.seat,
                kind: format!("{:?}", r.kind),
                card: r.card,
                lane: r.lane,
                target: r.target,
                aux: r.aux,
                time_ms: r.time_ms,
                uid: hex(&r.uid),
                auth: r.auth,
                hash: c.hash.as_ref().map(|h| hex(h)),
                applied: format!("{:?}", c.applied),
            }
        })
        .collect();
    Transcript {
        seed: u64::from(m.id),
        house_rules: HouseRulesJson::from(rules),
        decks: m.decks.clone(),
        records,
        refusals: 0,
        final_hash: m.chain.map(|c| hex(&c.head())).unwrap_or_default(),
        winner: winner_str(m.game.winner),
        rounds: m.game.round,
        game_over: m.game.phase == Phase::Over,
    }
}
```

`seed` carries the match id: `Transcript.seed` is informational for an arena game (there is no
seed), and `replay` never reads it.

- [ ] **Step 2: Implement play**

`rust/tapstone-arena/src/core/play.rs`:

```rust
//! A running match (arena spec §5.2–§5.4; protocol §4.3–§4.5 with the arena as arbiter).
use tapstone_proto::frame::{
    Ack, BROADCAST, Commit, Frame, Halt, Header, MatchResult, Nak, Tap, arena_refusal, halt_reason,
    refusal_code, result_reason,
};
use tapstone_proto::ids::rules_id;
use tapstone_proto::transcript::{TranscriptHeader, record_bytes, transcript_sha};
use tapstone_rules::{Applied, Chain, Kind, Record, Refusal, Winner};

use super::{ArenaCore, Committed, JournalOp, Match, MatchOver, Output, Table};

/// Protocol / state-machine.md timers.
pub const RETRANSMIT_MS: u64 = 200;
pub const RETRIES: u8 = 5;
pub const HEAD_MS: u64 = 1000;
pub const STALE_MS: u64 = 3000;
/// A lost *seat* times the match out (0028 keeps this only for seats, never for the arena).
pub const LOST_MS: u64 = 120_000;

fn needs_card(k: Kind) -> bool {
    matches!(k, Kind::Charge | Kind::CastUnit | Kind::CastSpell)
}

fn commit_of(c: &Committed) -> Commit {
    Commit { mseq: c.record.seq, lseq: c.lseq, record: c.record, hash: c.hash.unwrap_or([0; 8]) }
}

impl ArenaCore {
    pub(crate) fn running(&mut self) -> Option<&mut Match> {
        match &mut self.table {
            Table::Match(m) => Some(m),
            Table::Lobby(_) => None,
        }
    }

    /// Stamp, apply, chain, journal, broadcast. The journal output precedes the send (D10).
    pub(crate) fn commit(&mut self, mut r: Record, lseq: u16, now: u64, out: &mut Vec<Output>) -> Result<(), Refusal> {
        let Some(m) = self.running() else { return Err(Refusal::NotPlaying) };
        r.seq = m.game.seq;
        r.time_ms = now.saturating_sub(m.started_ms) as u32;
        r.auth = 0;
        let applied = m.game.apply(&r)?;
        let hash = if applied == Applied::Started {
            m.chain = Some(Chain::genesis(&m.game));
            None
        } else if let Some(c) = m.chain.as_mut() {
            c.step(&r, &m.game);
            Some(c.head())
        } else {
            None
        };
        let committed = Committed { record: r, hash, applied, lseq };
        m.log.push(committed);
        if r.kind != Kind::ClaimSeat {
            m.last_lseq[r.seat as usize] = Some(lseq);
        }
        m.last_broadcast = now;
        m.last_tx = [now; 2]; // the broadcast just now counts as a transmission to both seats
        let id = m.id;
        out.push(Output::Journal(JournalOp::Record { match_id: id, record: r.encode(), hash }));
        self.send(out, BROADCAST, id, &Frame::Commit(commit_of(&committed)));
        out.push(Output::View(self.view()));
        if let Applied::GameEnded(Winner::Seat(w)) = applied {
            let lethal = self.running().is_some_and(|m| m.game.seats.iter().any(|s| s.castle.life == 0));
            let reason = if lethal { result_reason::LETHAL } else { result_reason::STOP };
            self.finish(reason, Some(w), out);
        }
        Ok(())
    }

    pub(crate) fn play_frame(&mut self, src: u8, _h: Header, f: Frame, now: u64, out: &mut Vec<Output>) {
        let Some(m) = self.running() else { return };
        let Some(seat) = m.nodes.iter().position(|&n| n == src) else { return };
        m.last_heard[seat] = now;
        m.tries[seat] = 0;
        let was_paused = std::mem::replace(&mut m.paused, false);
        if was_paused {
            out.push(Output::View(self.view()));
        }
        match f {
            Frame::Tap(Tap::Propose { lseq, record }) => self.tap(seat, src, lseq, record, now, out),
            Frame::Ack(a) => self.ack(seat, a, out),
            Frame::Nak(n) => self.replay_range(n, out),
            Frame::Halt(x) => self.halt(x, out),
            other => self.dark_frame(src, seat, other, now, out),
        }
    }

    fn tap(&mut self, seat: usize, src: u8, lseq: u16, mut r: Record, now: u64, out: &mut Vec<Output>) {
        let Some(m) = self.running() else { return };
        let id = m.id;
        if r.kind == Kind::ClaimSeat {
            return; // a late retransmit of a lobby claim
        }
        if m.last_lseq[seat].is_some_and(|l| lseq <= l) {
            // Already committed: re-send its commit so the shrine stops retransmitting.
            if let Some(c) = m.log.iter().rev().find(|c| c.record.seat as usize == seat && c.lseq == lseq) {
                let c = commit_of(c);
                self.send(out, BROADCAST, id, &Frame::Commit(c));
            }
            return;
        }
        r.seat = seat as u8; // the node's seat, whatever the byte claims
        if needs_card(r.kind) {
            match self.registry.resolve_or(r.uid, r.card) {
                Some(card) => r.card = card,
                None => {
                    self.send(out, src, id, &Frame::Tap(Tap::Reject { lseq, reason: arena_refusal::UNKNOWN_UID }));
                    return;
                }
            }
        }
        if let Err(e) = self.commit(r, lseq, now, out) {
            self.send(out, src, id, &Frame::Tap(Tap::Reject { lseq, reason: refusal_code(&e) }));
        }
    }

    fn ack(&mut self, seat: usize, a: Ack, out: &mut Vec<Output>) {
        let Some(m) = self.running() else { return };
        let Some(want) = m.log.get(a.mseq as usize).map(|c| c.hash.unwrap_or([0; 8])) else { return };
        if want != a.hash {
            let x = Halt { at_mseq: a.mseq, reason: halt_reason::HASH, mine: want, theirs: a.hash };
            return self.halt(x, out);
        }
        let acked = &mut m.acked[seat];
        *acked = Some(acked.map_or(a.mseq, |x| x.max(a.mseq)));
    }

    /// NAK: re-send `from..=to` (`to = 0xFFFF` = head). The arena keeps the whole log, so any gap
    /// is replayable; the 64-commit ring of §4.4 is a shrine-side limit.
    fn replay_range(&mut self, n: Nak, out: &mut Vec<Output>) {
        let Some(m) = self.running() else { return };
        let id = m.id;
        let end = (n.to as usize).min(m.log.len().saturating_sub(1));
        let commits: Vec<Commit> = m.log.get(n.from as usize..=end).unwrap_or(&[]).iter().map(commit_of).collect();
        for c in commits {
            self.send(out, BROADCAST, id, &Frame::Commit(c));
        }
    }

    /// Divergence (§5): broadcast X, void the match, post it with both hashes. Never pick a winner.
    pub(crate) fn halt(&mut self, x: Halt, out: &mut Vec<Output>) {
        let Some(m) = self.running() else { return };
        let id = m.id;
        self.send(out, BROADCAST, id, &Frame::Halt(x));
        out.push(Output::Log(format!("desync at {} ({:02x?} vs {:02x?})", x.at_mseq, x.mine, x.theirs)));
        self.finish(result_reason::DESYNC, None, out);
    }

    pub(crate) fn play_tick(&mut self, now: u64, out: &mut Vec<Output>) {
        let Some(m) = self.running() else { return };
        let id = m.id;
        let head = m.log.len().saturating_sub(1) as u16;
        let mut resend: Vec<Commit> = Vec::new();
        let mut pause = false;
        for seat in 0..2 {
            let behind = m.acked[seat].is_none_or(|a| a < head);
            if behind && now.saturating_sub(m.last_tx[seat]) >= RETRANSMIT_MS {
                if m.tries[seat] >= RETRIES {
                    pause = true;
                } else {
                    let next = m.acked[seat].map_or(0, |a| a + 1) as usize;
                    if let Some(c) = m.log.get(next) {
                        resend.push(commit_of(c));
                    }
                    m.last_tx[seat] = now;
                    m.tries[seat] += 1;
                }
            }
            if now.saturating_sub(m.last_heard[seat]) > STALE_MS {
                pause = true;
            }
        }
        if now.saturating_sub(m.last_broadcast) >= HEAD_MS {
            if let Some(c) = m.log.last() {
                resend.push(commit_of(c));
            }
            m.last_broadcast = now;
        }
        let lost = (0..2).find(|&s| now.saturating_sub(m.last_heard[s]) > LOST_MS);
        let newly_paused = pause && !m.paused;
        m.paused |= pause;
        for c in resend {
            self.send(out, BROADCAST, id, &Frame::Commit(c));
        }
        if newly_paused {
            out.push(Output::View(self.view()));
        }
        if let Some(lost) = lost {
            self.finish(result_reason::TIMEOUT, Some(1 - lost as u8), out);
        }
    }

    /// Close the match: RESULT, journal End, and the MatchOver the ledger and poster consume.
    pub(crate) fn finish(&mut self, reason: u8, winner: Option<u8>, out: &mut Vec<Output>) {
        let Table::Match(m) = std::mem::replace(&mut self.table, Table::Lobby(Default::default())) else { return };
        let records: Vec<[u8; 32]> = m.log.iter().map(|c| record_bytes(&c.record, c.hash)).collect();
        let header = TranscriptHeader {
            match_id: m.id,
            ruleset: self.cfg.ruleset,
            registry: self.cfg.registry_id,
            rules: rules_id(&self.cfg.rules),
            seat_nodes: m.nodes,
            deck_sigils: m.sigils,
            start_ts: m.start_unix,
        }
        .encode();
        let sha = transcript_sha(&header, &records);
        let head = m.chain.map_or([0; 8], |c| c.head());
        let final_mseq = m.log.last().map_or(0, |c| c.record.seq);
        let mut result = MatchResult::unsigned(final_mseq, winner.unwrap_or(0xFF), reason, head, sha);
        let (kind, sig) = self.signer.sign(&result, m.id);
        result.sig_kind = kind;
        result.sig = sig;
        self.send(out, BROADCAST, m.id, &Frame::Result(result));
        out.push(Output::Journal(JournalOp::End { match_id: m.id, result }));
        let mut tsx1 = header.to_vec();
        for r in &records {
            tsx1.extend_from_slice(r);
        }
        let json = crate::transcript::to_json(&m, &self.cfg.rules);
        out.push(Output::MatchOver(Box::new(MatchOver {
            match_id: m.id,
            result,
            nodes: m.nodes,
            figurines: m.figurines,
            winner,
            round: m.game.round,
            tsx1,
            json,
        })));
        out.push(Output::View(self.view()));
        self.last_beacon = None;
    }
}
```

`dark_frame` is Task 14's. Until then, add this to `play.rs` so the crate builds:

```rust
impl ArenaCore {
    pub(crate) fn dark_frame(&mut self, _src: u8, _seat: usize, _f: Frame, _now: u64, _out: &mut Vec<Output>) {}
}
```

- [ ] **Step 3: Run the lobby tests**

Run: `cargo test -p tapstone-arena --test core_lobby`
Expected: both pass.

- [ ] **Step 4: Perturb, then commit Tasks 9–11 together**

Perturbation: in `lobby.rs` `start`, commit `c[0]`'s record with `target: 0, aux: 0` (the
proposal's stats) → `two_castle_taps_start…` goes red on the `(2, 4, -1)` assert; restore.

```bash
git add rust/tapstone-arena/src/lib.rs rust/tapstone-arena/src/core/mod.rs rust/tapstone-arena/src/core/lobby.rs rust/tapstone-arena/src/core/play.rs rust/tapstone-arena/src/view.rs rust/tapstone-arena/src/transcript.rs rust/tapstone-arena/Cargo.toml rust/tapstone-arena/tests/harness.rs rust/tapstone-arena/tests/core_lobby.rs
git commit -m "feat(arena): sans-IO core: lobby in claim order, arena-derived stats, commits (D1)"
```

---

## Task 11b: A copy is drawn once per shuffle-in (0036 as corrected in #60)

`tapstone-rules` has had `Kind::Draw`, `Seat::owed_draws()` and the three draw refusals since #63.
Everything this task needs from the engine is the new kind. The owed-draws accounting and the list
membership are the engine's, and it refuses a bad draw itself. This task adds only the rule the
engine cannot enforce: it never sees a UID.

**Files:**
- Modify: `rust/tapstone-arena/src/core/mod.rs` (`Match.drawn`, `Match.in_hand`), `rust/tapstone-arena/src/core/play.rs` (`tap`), `rust/tapstone-proto/src/frame.rs` (`arena_refusal::COPY_DRAWN = 106`)
- Create: `rust/tapstone-arena/tests/core_draw.rs`

- [ ] **Step 1: Write the failing test**

`rust/tapstone-arena/tests/core_draw.rs`:

```rust
//! 0036 as corrected in #60: a physical copy (a UID) is drawn at most once per shuffle-in. The
//! engine never sees a UID, so this is the arena's rule (spec §5.2, `arena_refusal::COPY_DRAWN`).
mod harness;
use harness::*;
use tapstone_proto::frame::{Frame, Tap, arena_refusal};
use tapstone_rules::{Kind, Phase, Record};

fn record(seat: usize, kind: Kind, card: u16, uid: [u8; 7]) -> Record {
    Record {
        seq: 0,
        seat: seat as u8,
        kind,
        card,
        lane: -1,
        target: 0,
        aux: 0,
        time_ms: 0,
        uid,
        auth: 0,
    }
}

/// Propose a draw of `card` with `uid` as seat `seat`'s shrine; return the core's answer, then
/// deliver what it sent so the followers stay at the head.
fn propose_draw(net: &mut Net, seat: usize, card: u16, uid: [u8; 7], lseq: u16) -> Option<Frame> {
    let r = record(seat, Kind::Draw, card, uid);
    let reply = net.inject(NODES[seat], Frame::Tap(Tap::Propose { lseq, record: r }));
    net.drain();
    reply
}

/// The design seat `seat` would draw next: the top of its list, as its follower sees it.
fn top(net: &Net, seat: usize) -> u16 {
    net.shrines[seat]
        .follower
        .game
        .top_of_list(seat as u8)
        .expect("an undrawn copy")
}

fn is_commit(f: &Option<Frame>) -> bool {
    matches!(f, Some(Frame::Commit(_)))
}

fn refusal(f: &Option<Frame>) -> Option<u8> {
    match f {
        Some(Frame::Tap(Tap::Reject { reason, .. })) => Some(*reason),
        _ => None,
    }
}

#[test]
fn the_same_physical_copy_cannot_be_drawn_twice_in_a_match() {
    let mut net = Net::new(1, 0.0, 0.0);
    net.step_until_seat_owes_draws(0);
    let uid = [4, 9, 9, 9, 9, 9, 1];
    let card = top(&net, 0);
    let first = propose_draw(&mut net, 0, card, uid, 900);
    assert!(is_commit(&first), "first draw of this copy: {first:?}");
    net.step_until_seat_owes_draws(0);
    let card = top(&net, 0);
    let again = propose_draw(&mut net, 0, card, uid, 901);
    assert_eq!(
        refusal(&again),
        Some(arena_refusal::COPY_DRAWN),
        "a copy drawn twice was not refused: {again:?}"
    );
}

/// The control the lead required after Oracle's review of #58. The test above cannot tell "once per
/// shuffle-in" from "once per match": both refuse its second draw. Here a mulligan shuffles the
/// hand back in, so a returned copy must be drawable again.
#[test]
fn a_mulligan_returns_the_copies_so_they_may_be_drawn_again() {
    let mut net = Net::new(1, 0.0, 0.0);
    net.manual[0] = true; // seat 0 taps only what this test injects
    let mut steps = 0;
    while net.shrines[0].follower.game.phase != Phase::Playing {
        net.step();
        steps += 1;
        assert!(steps < 1_000, "the match never started");
    }
    // Pay every draw seat 0 owes (the whole opening hand, and its turn draw if seat 1 went
    // first) with known UIDs: the engine refuses Mulligan with DrawOwed until they are paid.
    let mut hand: Vec<(u16, [u8; 7])> = Vec::new();
    let mut lseq = 900;
    loop {
        let g = &net.shrines[0].follower.game;
        if g.seats[0].owed_draws() > 0 {
            let card = top(&net, 0);
            let uid = [4, 7, 7, 7, 7, 0, hand.len() as u8];
            let r = propose_draw(&mut net, 0, card, uid, lseq);
            assert!(is_commit(&r), "opening draw {}: {r:?}", hand.len());
            hand.push((card, uid));
            lseq += 1;
        } else if g.active == 0 {
            break;
        } else {
            net.step(); // seat 1 plays its turn
            steps += 1;
            assert!(steps < 5_000, "seat 0 never got a turn");
        }
    }
    assert!(hand.len() >= 2, "seat 0 drew {} cards", hand.len());
    let m = record(0, Kind::Mulligan, 0, [0; 7]);
    let r = net.inject(NODES[0], Frame::Tap(Tap::Propose { lseq, record: m }));
    net.drain();
    assert!(is_commit(&r), "the mulligan: {r:?}");
    lseq += 1;
    let owed = net.shrines[0].follower.game.seats[0].owed_draws();
    assert_eq!(
        owed as usize,
        hand.len(),
        "a mulligan owes the hand size returned (#61)"
    );
    // Redraw a returned copy by its own UID: it was shuffled back in, so this commits.
    let (card, uid) = hand[0];
    let redraw = propose_draw(&mut net, 0, card, uid, lseq);
    assert!(
        is_commit(&redraw),
        "a copy returned by a mulligan was refused: {redraw:?}"
    );
}

/// A revived arena rebuilds the drawn set from its journal: a copy drawn before the arena went
/// dark stays drawn after it comes back.
#[test]
fn a_revived_arena_remembers_which_copies_were_drawn() {
    let mut net = Net::new(1, 0.0, 0.0);
    net.step_until_seat_owes_draws(0);
    let uid = [4, 9, 9, 9, 9, 9, 2];
    let card = top(&net, 0);
    let first = propose_draw(&mut net, 0, card, uid, 900);
    assert!(is_commit(&first), "first draw of this copy: {first:?}");
    net.go_dark();
    for _ in 0..10 {
        net.step();
    }
    net.revive();
    let mut steps = 0;
    while net.dark {
        net.step();
        steps += 1;
        assert!(steps < 1_000, "the arena never took the hand-back");
    }
    net.step_until_seat_owes_draws(0);
    let card = top(&net, 0);
    let again = propose_draw(&mut net, 0, card, uid, 901);
    assert_eq!(
        refusal(&again),
        Some(arena_refusal::COPY_DRAWN),
        "the revived arena forgot a drawn copy: {again:?}"
    );
}

/// A copy drawn while the arena was dark (committed by the interim arbiter, seen by the arena only
/// in the hand-back) stays drawn too: the hand-back path replays the same rule.
#[test]
fn a_copy_drawn_while_the_arena_was_dark_stays_drawn() {
    let mut net = Net::new(1, 0.0, 0.0);
    net.step_until_seat_owes_draws(0);
    let before = net.shrines[0].follower.records().len();
    net.go_dark(); // seat 0 owes a draw on its own turn: its shrine draws while the arena is dark
    for _ in 0..10 {
        net.step();
    }
    let uid = tapstone_rules::Record::decode(
        net.shrines[0].follower.records()[before..]
            .iter()
            .map(|b| b[..24].try_into().unwrap())
            .find(|b: &[u8; 24]| {
                tapstone_rules::Record::decode(b)
                    .is_some_and(|r| r.kind == Kind::Draw && r.seat == 0)
            })
            .as_ref()
            .expect("seat 0 drew while the arena was dark"),
    )
    .unwrap()
    .uid;
    net.revive();
    let mut steps = 0;
    while net.dark {
        net.step();
        steps += 1;
        assert!(steps < 1_000, "the arena never took the hand-back");
    }
    net.step_until_seat_owes_draws(0);
    let card = top(&net, 0);
    let again = propose_draw(&mut net, 0, card, uid, 950);
    assert_eq!(
        refusal(&again),
        Some(arena_refusal::COPY_DRAWN),
        "a copy drawn while dark was forgotten: {again:?}"
    );
}
```

Add to the harness `impl Net`:

```rust
    /// Hand one frame to the core as if `from` sent it. Its outputs go where `run_core` sends them
    /// (the wire, the journal); the first frame addressed to `from` or broadcast is returned too.
    pub fn inject(&mut self, from: u8, f: Frame) -> Option<Frame> {
        let bytes = Self::encode(from, 0, &f);
        let now = self.now;
        let mut first = None;
        for o in self.core.handle(
            Input::Frame {
                src: from,
                rssi: -40,
                mac_ok: true,
                bytes,
            },
            now,
        ) {
            match o {
                Output::Send { dst, frame } => {
                    if first.is_none() && (dst == from || dst == BROADCAST) {
                        first = Frame::decode(&frame).map(|(_, f)| f);
                    }
                    self.put(ARENA, dst, frame);
                }
                Output::Journal(j) => self.journal.push(j),
                Output::MatchOver(m) => self.over.push(*m),
                Output::View(_) | Output::Log(_) => {}
            }
        }
        first
    }

    /// Step until seat `seat` owes at least one draw on its own turn (0036), or panic after 5,000
    /// steps.
    pub fn step_until_seat_owes_draws(&mut self, seat: usize) {
        for _ in 0..5_000 {
            let g = &self.shrines[seat].follower.game;
            if g.phase == Phase::Playing && g.seats[seat].owed_draws() > 0 && g.active == seat as u8
            {
                return;
            }
            self.step();
        }
        panic!("seat {seat} never owed a draw");
    }
```

`owed_draws()` is the engine's accessor (#63), and the only engine name this task depends on.

**Control (required, added by the lead after Oracle's review of #58):** the test above proves a copy
cannot be drawn twice; it does not prove the rule is *once per shuffle-in* (#60) rather than once per
match, because both readings refuse the second draw it makes. Add
`a_mulligan_returns_the_copies_so_they_may_be_drawn_again`: draw seat 0's **whole** opening hand
with known UIDs (the engine refuses `Mulligan` with `DrawOwed` until every owed draw is paid, so a
test that mulligans after one draw fails for the wrong reason), commit a `Mulligan`, then propose a
`Draw` of one of the returned UIDs and assert it **commits**. Perturb `track_uids` so a mulligan
leaves `drawn` untouched and confirm this test goes red while the test above stays green. That pair
is the evidence for #60.

- [ ] **Step 2: Run to watch it fail**

Run: `cargo test -p tapstone-arena --test core_draw`
Expected: FAIL: the second draw of the same UID is committed (if the list still holds a copy of
that design) or refused by the engine with a different reason. Either way the assert names it.

- [ ] **Step 3: Implement**

In `core/mod.rs`, add to `Match` (and initialise both to empty sets in `lobby.rs`'s `start` and in
`dark.rs`'s `recover`):

```rust
    /// 0036: UIDs drawn this match, per seat, and the ones still in hand.
    pub drawn: [std::collections::HashSet<[u8; 7]>; 2],
    pub in_hand: [std::collections::HashSet<[u8; 7]>; 2],
```

`recover` must rebuild both sets from the journaled records it replays (a Draw adds to both, a
cast or charge removes from `in_hand`, a mulligan moves `in_hand` back out of `drawn`), or a
revived arena would forget which copies were drawn. Put that replay in one function,
`fn track_uids(m: &mut Match, r: &Record)`, called by both `commit` and `recover`, so the rule has
one implementation.

In `play.rs` `tap`, before `self.commit(…)`:

```rust
        if r.kind == Kind::Draw && m.drawn[seat].contains(&r.uid) {
            self.send(out, src, id, &Frame::Tap(Tap::Reject { lseq, reason: arena_refusal::COPY_DRAWN }));
            return;
        }
```

and in `commit`, after the record is applied, `track_uids(m, &r)`:

```rust
pub(crate) fn track_uids(m: &mut Match, r: &Record) {
    let s = r.seat as usize & 1;
    match r.kind {
        Kind::Draw => {
            m.drawn[s].insert(r.uid);
            m.in_hand[s].insert(r.uid);
        }
        Kind::Charge | Kind::CastUnit | Kind::CastSpell => {
            m.in_hand[s].remove(&r.uid);
        }
        Kind::Mulligan => {
            let back: Vec<_> = m.in_hand[s].drain().collect();
            for uid in back {
                m.drawn[s].remove(&uid);
            }
        }
        _ => {}
    }
}
```

`frame.rs`: `pub const COPY_DRAWN: u8 = 106;` in `arena_refusal`.

The canvas shows owed draws (spec §5.3, "drawing 3 of 6"). Add `pub owed_draws: u8` to `SeatView`
in `view.rs`, filled from the engine's accessor (`seat.owed_draws()`), and in `web/app.js` append
`   drawing ${seat.owed_draws}` to the castle band text when it is non-zero. `view.rs`'s engine
comparison test gains `assert_eq!(vs.owed_draws, seat.owed_draws())`.

> **Execution note (2026-09-23).** As executed, beyond the first draft:
> - **The harness sends a synthetic UID per physical copy** (`copy_uid(shrine, k)`, spec §5.2: "the check runs
>   on whatever UIDs the desk shrines send"). Before, every harness draw carried `uid [0;7]`, so this rule would
>   have refused the second draw of every match. Each shrine draws the first copy of the design it has not seen
>   committed as drawn, and forgets its drawn set on its own committed Mulligan (no seat mulligans after acting:
>   `acted` never resets). Task 21's desk shrines need the same.
> - `inject` puts the core's outputs on the wire (and `drain()` delivers them), so the followers stay at the head
>   between injected taps. `Net.manual[seat]` stops a seat's own play taps, for the mulligan control.
> - `track_uids` runs on three paths: `commit`, `recover` (over the replayed log) and the hand-back's `absorb`
>   (records committed while the arena was dark). The fourth test covers the last one.
> - Perturbations (`scratch/commander-station/perturb-task11b.py`), each checked against the exact set of red
>   tests: (1) no `contains` check → twice, revived, while-dark red; (2) `recover` skips `track_uids` → revived
>   red; (3) a mulligan leaves `drawn` untouched → the mulligan control red while `twice` stays green (the lead's
>   pair). revived, while-dark and core_match stall too, because the harness's own mulligans become permanent
>   refusals; (4) the hand-back skips `track_uids` → while-dark red.
> - **Deferred to Task 18:** the `SeatView.owed_draws` / `app.js` "drawing n" paragraph below needs `view.rs`,
>   which is a placeholder until Task 18 (the view model). It is carried there explicitly.

- [ ] **Step 4: Run, perturb, commit**

Run: `cargo test -p tapstone-arena` → all pass, `core_draw` included.
Perturbations, each restored: (1) delete the `contains` check → `core_draw` goes red; (2) make
`recover` skip `track_uids` → add a dark-mode variant of the test (draw, go dark, revive, draw the
same UID) and watch it go red; keep that variant as a second test.

```bash
git add rust/tapstone-proto/src/frame.rs rust/tapstone-arena/src/core/mod.rs rust/tapstone-arena/src/core/play.rs rust/tapstone-arena/src/core/lobby.rs rust/tapstone-arena/src/core/dark.rs rust/tapstone-arena/tests/core_draw.rs rust/tapstone-arena/tests/harness.rs
git commit -m "feat(arena): a physical copy is drawn once per shuffle-in (0036, the rule the engine cannot see)"
```

---

## Task 12: A whole match, cross-checked against an independent replay

**Files:**
- Create: `rust/tapstone-arena/tests/core_match.rs`

- [ ] **Step 1: Write the test**

```rust
mod harness;
use harness::*;
use tapstone_proto::frame::result_reason;
use tapstone_sim::replay;

fn check_three_way(net: &Net) {
    let over = net.over.last().expect("the match ended");
    // 1. The arena's own transcript replays through a fresh engine without the arbiter.
    let r = replay(&over.json).expect("replays");
    assert!(r.matches(&over.json), "an independent replay disagrees with the arena's hashes");
    // 2. Both followers sit at the arena's head, record for record.
    let arena_head: [u8; 8] = over.result.chain;
    for s in &net.shrines {
        assert_eq!(s.follower.head_hash(), arena_head, "node {} head", s.node);
        assert_eq!(s.follower.records().len(), over.json.records.len(), "node {} records", s.node);
    }
    // 3. The TSX1 bytes carry exactly those records after the 36-byte header.
    assert_eq!(over.tsx1.len(), 36 + 32 * over.json.records.len());
    assert_eq!(&over.tsx1[..4], b"TSX1");
}

#[test]
fn scripted_duels_end_with_arena_followers_and_replay_agreeing() {
    for seed in 1..=20u64 {
        let mut net = Net::new(seed, 0.0, 0.0);
        assert!(net.run(20_000), "seed {seed}: no result");
        let over = net.over.last().unwrap();
        assert!(
            [result_reason::LETHAL, result_reason::STOP].contains(&over.result.reason),
            "seed {seed}: ended by {}",
            over.result.reason
        );
        check_three_way(&net);
    }
}
```

- [ ] **Step 2: Run**

Run: `cargo test -p tapstone-arena --test core_match`
Expected: PASS. If a seed hits the step limit, raise the limit before changing any logic: a
game is at most about 80 committed records, and each costs at most a few 10 ms steps.

- [ ] **Step 3: Perturb, then commit**

Perturbations, each restored: (1) in `commit`, stamp `r.time_ms = 0` after the chain step but
before journaling (so the journal/wire record differs from the hashed one) → the replay check
goes red; (2) in the harness, make shrine 1's follower skip applying every tenth commit → its
head check goes red. (2) proves the cross-check can see a follower that drifted, not just an
arena that did.

```bash
git add rust/tapstone-arena/tests/core_match.rs
git commit -m "test(arena): whole duels agree three ways: arena, followers, independent replay"
```

---

## Task 13: Loss, duplication, pause and the lost-seat timeout

**Files:**
- Create: `rust/tapstone-arena/tests/core_loss.rs`

- [ ] **Step 1: Write the tests**

```rust
mod harness;
use harness::*;
use tapstone_proto::frame::result_reason;
use tapstone_sim::replay;

#[test]
fn ten_percent_loss_and_five_percent_duplication_still_converge() {
    // 200 seeds, not 10: at 10% loss about 30% of duels end with a follower short of the result
    // unless the arena lingers (state-machine.md RESULT), and seeds 1-10 alone passed by luck once
    // the harness's frame traffic changed.
    for seed in 1..=200u64 {
        let mut net = Net::new(seed, 0.10, 0.05);
        assert!(net.run(60_000), "seed {seed}: no result under loss");
        let over = net.over.last().unwrap();
        assert!(replay(&over.json).unwrap().matches(&over.json), "seed {seed}");
        for s in &net.shrines {
            assert_eq!(s.follower.head_hash(), over.result.chain, "seed {seed} node {}", s.node);
        }
    }
}

#[test]
fn a_silent_seat_pauses_the_match_and_then_times_it_out() {
    let mut net = Net::new(3, 0.0, 0.0);
    // Well into the match: past the opening hands and a few turns. (A fixed 200 steps was not:
    // scripted seats tap at once, and seed 3's whole duel is over inside 2 s.)
    let mut warm = 0;
    while net.shrines[0].follower.records().len() < 20 && warm < 5_000 {
        net.step();
        warm += 1;
    }
    assert!(net.over.is_empty(), "the duel ended before shrine 1 fell silent");
    assert_eq!(net.shrines[0].follower.records().len(), 20);
    // Shrine 1 goes silent: drop everything it sends from now on.
    let silent = net.shrines[1].node;
    let mut steps = 0;
    while net.over.is_empty() && steps < 20_000 {
        net.step_dropping_from(silent);
        steps += 1;
    }
    let over = net.over.last().expect("the lost seat timed the match out");
    assert_eq!(over.result.reason, result_reason::TIMEOUT);
    assert_eq!(over.winner, Some(0), "the seat still present wins (protocol §4.5)");
    assert!(steps as u64 * 10 >= 120_000, "timed out after {} ms, before the 120 s pause timeout", steps * 10);
}
```

Add to the harness `impl Net`:

```rust
    /// As `step`, but frames sent by `node` vanish (a shrine that lost power).
    pub fn step_dropping_from(&mut self, node: u8) {
        self.now += 10;
        for i in 0..2 {
            if self.shrines[i].node != node {
                self.shrine_act(i);
            }
        }
        self.run_core(Input::Tick);
        let wire: Vec<_> = self.wire.drain(..).filter(|(from, _, _)| *from != node).collect();
        for (from, to, bytes) in wire {
            if to == ARENA || (to == BROADCAST && from != ARENA) {
                self.run_core(Input::Frame { src: from, rssi: -40, mac_ok: true, bytes: bytes.clone() });
            }
            for i in 0..2 {
                if self.shrines[i].node != from && self.shrines[i].node != node && (to == BROADCAST || to == self.shrines[i].node) {
                    self.shrine_rx(i, &bytes);
                }
            }
        }
    }
```

- [ ] **Step 2: Run**

Run: `cargo test -p tapstone-arena --test core_loss`
Expected: PASS.

- [ ] **Step 2b: The RESULT linger (ruled "linger A", 2026-09-23; spec §5.5)**

Measured first: over 200 lossy seeds, 30% of duels ended with both followers 1–3 records short of the result.
`finish` went straight to the lobby, so the lethal commit went out once, and a follower that missed it had nobody
left to NAK. The loss test runs 200 seeds for that reason (10 seeds once passed by luck). The fix is
`rust/tapstone-arena/src/core/linger.rs`:

```rust
//! The RESULT linger (protocol state-machine.md, RESULT: "both R seen (or 5 s) → LOBBY"; ruled
//! "linger A" 2026-09-23). After a result the arena keeps the finished match for up to 5 s, or
//! until both seats have acked the final commit. Meanwhile it keeps retransmitting what a seat has
//! not acked, answers NAKs, and re-broadcasts the head commit and R every second. Without this, a
//! lost lethal commit was never re-sent: at 10% loss, 30% of duels ended with both followers
//! short of the result. Taps are swallowed (the match is over); the lobby runs as usual beside it.
use tapstone_proto::frame::{BROADCAST, Commit, Frame, MatchResult, Nak, Tap};

use super::play::{HEAD_MS, RETRANSMIT_MS};
use super::{ArenaCore, Committed, Match, Output, Table};

pub const LINGER_MS: u64 = 5_000;

pub(crate) struct Linger {
    m: Box<Match>,
    result: MatchResult,
    /// Set on the first tick after the result (`finish` has no clock).
    until: Option<u64>,
    last_tx: [u64; 2],
    last_r: u64,
}

impl Linger {
    pub(crate) fn new(m: Box<Match>, result: MatchResult) -> Linger {
        Linger {
            m,
            result,
            until: None,
            last_tx: [0; 2],
            last_r: 0,
        }
    }

    fn head(&self) -> u16 {
        self.m.log.len().saturating_sub(1) as u16
    }

    fn behind(&self, seat: usize) -> bool {
        self.m.acked[seat].is_none_or(|a| a < self.head())
    }
}

fn commit_of(c: &Committed) -> Commit {
    Commit {
        mseq: c.record.seq,
        lseq: c.lseq,
        record: c.record,
        hash: c.hash.unwrap_or([0; 8]),
    }
}

impl ArenaCore {
    /// Whether a finished match is still being delivered (tests and diagnostics).
    pub fn lingering(&self) -> bool {
        self.linger.is_some()
    }

    pub(crate) fn linger_tick(&mut self, now: u64, out: &mut Vec<Output>) {
        if matches!(self.table, Table::Match(_)) {
            self.linger = None; // a new match started: the old one is history
            return;
        }
        let Some(l) = self.linger.as_mut() else {
            return;
        };
        let until = *l.until.get_or_insert(now + LINGER_MS);
        if now >= until || !(l.behind(0) || l.behind(1)) {
            let id = l.m.id;
            self.linger = None;
            out.push(Output::Log(format!("result linger for {id:08x} closed")));
            return;
        }
        let id = l.m.id;
        let mut sends: Vec<Frame> = Vec::new();
        for seat in 0..2 {
            if l.behind(seat) && now.saturating_sub(l.last_tx[seat]) >= RETRANSMIT_MS {
                let next = l.m.acked[seat].map_or(0, |a| a as usize + 1);
                if let Some(c) = l.m.log.get(next) {
                    sends.push(Frame::Commit(commit_of(c)));
                }
                l.last_tx[seat] = now;
            }
        }
        if now.saturating_sub(l.last_r) >= HEAD_MS {
            if let Some(c) = l.m.log.last() {
                sends.push(Frame::Commit(commit_of(c)));
            }
            sends.push(Frame::Result(l.result));
            l.last_r = now;
        }
        for f in sends {
            self.send(out, BROADCAST, id, &f);
        }
    }

    /// A frame from one of the finished match's seats: ACKs and NAKs are the linger's; taps are
    /// swallowed. Returns false for anything the lobby should see (beacons, claims).
    pub(crate) fn linger_frame(&mut self, src: u8, f: &Frame, out: &mut Vec<Output>) -> bool {
        let Some(l) = self.linger.as_mut() else {
            return false;
        };
        let Some(seat) = l.m.nodes.iter().position(|&n| n == src) else {
            return false;
        };
        let id = l.m.id;
        match f {
            Frame::Ack(a) => {
                let want =
                    l.m.log
                        .get(a.mseq as usize)
                        .map(|c| c.hash.unwrap_or([0; 8]));
                if want == Some(a.hash) {
                    let acked = &mut l.m.acked[seat];
                    *acked = Some(acked.map_or(a.mseq, |x| x.max(a.mseq)));
                    if !(l.behind(0) || l.behind(1)) {
                        self.linger = None; // both seats hold the result: nothing left to deliver
                        out.push(Output::Log(format!("result linger for {id:08x} closed")));
                    }
                } else {
                    // The match is over and posted; a split now can only be logged.
                    out.push(Output::Log(format!(
                        "late ack mismatch from seat {seat} at {}",
                        a.mseq
                    )));
                }
                true
            }
            Frame::Nak(Nak { from, to }) => {
                let end = (*to as usize).min(l.m.log.len().saturating_sub(1));
                let commits: Vec<Commit> =
                    l.m.log
                        .get(*from as usize..=end)
                        .unwrap_or(&[])
                        .iter()
                        .map(commit_of)
                        .collect();
                for c in commits {
                    self.send(out, BROADCAST, id, &Frame::Commit(c));
                }
                true
            }
            Frame::Tap(Tap::Propose { record, .. }) => {
                record.kind != tapstone_rules::Kind::ClaimSeat // a late play tap: swallowed
            }
            _ => false,
        }
    }
}
```

Hooks: `ArenaCore.linger: Option<linger::Linger>` (on the core, not the lobby). `tick` calls `linger_tick` first. In
the lobby, `frame` offers each frame to `linger_frame` before `lobby_frame`. `finish` ends with
`self.linger = Some(Linger::new(m, result))`. In the harness, `run` drains while `core.lingering()` (at least 20
steps, at most 1,000), `step_dropping(&[nodes])` generalizes `step_dropping_from`, and `run_until_result` steps without
the drain. The test `the_result_linger_ends` checks both bounds: lossless, it closes within 1 s of the result (every ack
arrived); with both shrines silenced after a lossy result, it stays at least 5 s and then closes. Perturbations
(`scratch/commander-station/perturb-task13.py`, each with its exact red set): the linger delivers nothing → the loss
test goes red; no 5 s bound → the linger test goes red; never closing on acks → the linger test goes red (its first draft
asserted only "eventually closes" and stayed green); plus the plan's two below.

- [ ] **Step 3: Perturb, then commit**

Perturbations, each restored: (1) delete the NAK arm from `play_frame` and delete the
retransmit block from `play_tick` together → the loss test stalls and fails on "no result under
loss"; (2) set `LOST_MS = 10_000` → the timeout test fails its "before the 120 s" assert.

```bash
git add rust/tapstone-arena/tests/core_loss.rs rust/tapstone-arena/tests/harness.rs
git commit -m "test(arena): convergence under loss and duplication; lost-seat timeout at 120 s"
```

---

## Task 14: Arena-dark — recover from the journal, take the hand-back, verify every hash

Spec §7. A restarted arena rebuilds the match from its journal (`JournalOp` rows), asks the
interim arbiter (seat 0's shrine: the first to claim, 0006/0029) for the records it missed, and
re-applies each one through the engine before it trusts it. A fresh arena with no journal is
deferred (spec §7 step 6).

**Files:**
- Modify: `rust/tapstone-rules/src/state.rs` (add `HouseRules::from_bytes`), `rust/tapstone-rules/tests/state.rs`
- Create: `rust/tapstone-arena/src/core/dark.rs`, `rust/tapstone-arena/tests/dark.rs`
- Modify: `rust/tapstone-arena/src/core/mod.rs` (`mod dark;`, `Match.dark`), `rust/tapstone-arena/src/core/play.rs` (remove the `dark_frame` stub), `rust/tapstone-arena/tests/harness.rs`

- [ ] **Step 1: The engine needs to read its own rule bytes back (test first)**

The journal stores `HouseRules::bytes()`. Restoring them must use the same order, from one place,
so add the inverse next to `bytes()`. Append to `rust/tapstone-rules/tests/state.rs`:

```rust
#[test]
fn house_rules_round_trip_through_their_hashed_bytes() {
    let r = tapstone_rules::HouseRules { castle_life: 17, commander_return: 4, ..Default::default() };
    assert_eq!(tapstone_rules::HouseRules::from_bytes(r.bytes()), r);
    let mut b = r.bytes();
    b[3] = 99;
    assert_eq!(tapstone_rules::HouseRules::from_bytes(b).castle_life, 99, "byte 3 is castle_life");
}
```

Run: `cargo test -p tapstone-rules --test state` → FAIL (`from_bytes` missing). Then add to
`impl HouseRules` in `rust/tapstone-rules/src/state.rs`, directly below `bytes()`:

```rust
    /// The inverse of `bytes()`, in the same order (the order genesis hashes). A journal or a CFG
    /// `M` value restores through here, never through a second list of field positions.
    pub fn from_bytes(b: [u8; 9]) -> HouseRules {
        HouseRules {
            deck_size: b[0],
            hand: b[1],
            second_player_bonus: b[2],
            castle_life: b[3],
            pressure_from: b[4],
            pressure: b[5],
            stop_round: b[6],
            commander_fall: b[7],
            commander_return: b[8],
        }
    }
```

Run: `cargo test -p tapstone-rules --test state` → PASS. This moves no golden (nothing hashed
changes). Perturbation: swap `b[4]` and `b[5]` → the round-trip test goes red; restore.

- [ ] **Step 2: Write the failing dark tests**

`rust/tapstone-arena/tests/dark.rs`:

```rust
mod harness;
use harness::*;
use tapstone_proto::frame::result_reason;
use tapstone_sim::replay;

/// Play into the match until seat 0's shrine holds `into` records, kill the arena, let seat 0's
/// shrine arbitrate for `dark_steps`, revive the arena from its journal, and play to the end.
/// (Counted in records, not steps: scripted duels end in 48-95 steps, so a fixed 150 steps was
/// past the result.)
fn dark_run(seed: u64, into: usize, dark_steps: usize, corrupt: bool) -> Net {
    let mut net = Net::new(seed, 0.0, 0.0);
    while net.shrines[0].follower.records().len() < into && net.over.is_empty() {
        net.step();
    }
    assert!(net.over.is_empty(), "seed {seed}: the duel ended before the arena went dark");
    let before = net.shrines[0].follower.records().len();
    net.go_dark();
    for _ in 0..dark_steps {
        net.step();
    }
    let during = net.shrines[0].follower.records().len();
    assert!(during > before, "seed {seed}: nothing was committed while the arena was dark");
    net.corrupt_handback = corrupt;
    net.revive();
    assert!(net.run(40_000), "seed {seed}: no result after revival");
    net
}

#[test]
fn a_revived_arena_takes_the_hand_back_and_finishes_the_match() {
    for seed in [1u64, 4, 9] {
        let net = dark_run(seed, 20, 10, false);
        let over = net.over.last().unwrap();
        assert!([result_reason::LETHAL, result_reason::STOP].contains(&over.result.reason));
        assert!(replay(&over.json).unwrap().matches(&over.json), "seed {seed}");
        for s in &net.shrines {
            assert_eq!(s.follower.head_hash(), over.result.chain, "seed {seed} node {}", s.node);
        }
        assert_eq!(over.json.records.len(), net.shrines[0].follower.records().len(), "the arena holds every record");
    }
}

#[test]
fn a_corrupted_hand_back_halts_instead_of_being_believed() {
    let net = dark_run(4, 20, 10, true);
    assert_eq!(net.over.last().unwrap().result.reason, result_reason::DESYNC);
}
```

Harness additions (in `tests/harness.rs`). Add fields to `Net`: `pub dark: bool`,
`pub corrupt_handback: bool`, `pub stats: [(u8, tapstone_progression::Loadout); 2]`,
`pub interim_lseq: [u16; 2]`. Initialise them in `new` (`false`, `false`,
`[(1, [None; 3]); 2]`, `[0; 2]`) and add these methods:

```rust
    /// The arena process dies: nothing reaches it, and seat 0's shrine becomes the interim
    /// arbiter (0029: the shrine that tapped first).
    pub fn go_dark(&mut self) {
        self.arena_up = false;
        self.dark = true;
        self.wire.clear();
        for s in &mut self.shrines {
            s.pending = None;
        }
    }

    /// A new arena process, rebuilt from the journal the old one wrote.
    pub fn revive(&mut self) {
        let rec = tapstone_arena::core::RecoveredMatch::from_journal(&self.journal).expect("journal holds the match");
        let decks = rec.decks.clone();
        let book = DeckBook::new(
            (0..2)
                .map(|i| Deck { name: format!("d{i}"), owner: "t".into(), castle: CASTLES[i], cards: decks[i].clone(), sigil: String::new() })
                .collect(),
        );
        let cfg = CoreConfig { node: ARENA, rules: HouseRules::default(), ruleset: 1, registry_id: 2, flat: false, epoch_unix: 1_789_980_000 };
        let (core, out) = ArenaCore::recover(cfg, Box::new(FixedStats(self.stats)), book, Registry::Trusting, Box::new(Unsigned), rec, self.now);
        self.core = core;
        self.arena_up = true;
        for o in out {
            if let Output::Send { dst, frame } = o {
                self.put(ARENA, dst, frame);
            }
        }
    }
```

In `shrine_act`, when `self.dark` is set, route taps to the interim arbiter instead of the arena:

```rust
        // (inside shrine_act, replacing the final `self.put(node, ARENA, bytes)`)
        if self.dark {
            if i == 0 {
                self.interim_commit(tap_record_of(&f)); // seat 0 arbitrates its own tap
            } else {
                self.put(node, NODES[0], bytes);
            }
        } else {
            self.put(node, ARENA, bytes);
        }
```

with helpers:

```rust
fn tap_record_of(f: &Frame) -> (u16, Record) {
    match f {
        Frame::Tap(Tap::Propose { lseq, record }) => (*lseq, *record),
        _ => unreachable!(),
    }
}

impl Net {
    fn interim_commit(&mut self, (lseq, r): (u16, Record)) {
        let now = self.now as u32;
        let seat = r.seat;
        // An interim arbiter dedupes retransmits by (seat, lseq), exactly as the arena does.
        if self.interim_lseq[seat as usize] >= lseq {
            return;
        }
        match self.shrines[0].follower.arbitrate(r, now) {
            Ok(mut c) => {
                self.interim_lseq[seat as usize] = lseq;
                c.lseq = lseq;
                let b = Self::encode(NODES[0], 0, &Frame::Commit(c));
                self.put(NODES[0], BROADCAST, b);
                if seat == 0 {
                    self.shrines[0].pending = None;
                }
            }
            Err(e) => {
                let reject = Frame::Tap(Tap::Reject { lseq, reason: refusal_code(&e) });
                let b = Self::encode(NODES[0], 0, &reject);
                if seat == 0 {
                    self.shrines[0].pending = None;
                    self.shrines[0].refused = self.shrines[0].refused.saturating_add(1);
                } else {
                    self.put(NODES[0], NODES[1], b);
                }
            }
        }
    }
}
```

and in `shrine_rx`, three new arms for shrine 0:

```rust
            // Seat 1's tap reaches the interim arbiter while the arena is dark.
            Frame::Tap(Tap::Propose { lseq, record }) if i == 0 && self.dark => {
                self.interim_commit((lseq, record));
            }
            // The revived arena asks for the gap: answer with every hand-back chunk.
            Frame::Join(j) if i == 0 && j.role == join_role::ARENA => {
                self.send_handback(j.have_mseq, u64::MAX);
            }
            // It NAKs the chunks it is missing.
            Frame::HandbackNak(k) if i == 0 => {
                self.send_handback(k.from_mseq, k.bitmap);
            }
```

plus, in the existing `Frame::Commit(c)` arm, `if self.dark && from_arena { self.dark = false; }`
where `from_arena` is `h.src == ARENA`: the first commit from the revived arena is the handover.
Then add:

```rust
impl Net {
    fn send_handback(&mut self, from: u16, bitmap: u64) {
        let Some(first) = self.shrines[0].follower.handback(from, 0) else { return };
        for idx in 0..first.count {
            if bitmap & (1 << idx) == 0 {
                continue;
            }
            let mut hb = self.shrines[0].follower.handback(from, idx).unwrap();
            if self.corrupt_handback && idx == first.count - 1 {
                hb.records[0][30] ^= 0x01; // one byte of one carried hash
            }
            let b = Self::encode(NODES[0], 0, &Frame::Handback(hb));
            self.put(NODES[0], ARENA, b);
        }
    }
}
```

- [ ] **Step 3: Run to watch them fail**

Run: `cargo test -p tapstone-arena --test dark`
Expected: FAIL to compile (`RecoveredMatch`, `ArenaCore::recover` missing).

- [ ] **Step 4: Implement recovery and the hand-back**

In `rust/tapstone-arena/src/core/mod.rs`: add `mod dark;` and `pub use dark::RecoveredMatch;`,
and add a field to `Match`:

```rust
    /// Set while a revived arena is taking the hand-back (spec §7).
    pub dark: Option<dark::Dark>,
```

(initialise it `None` in `lobby.rs`'s `start`). Delete the `dark_frame` stub from `play.rs`.

`rust/tapstone-arena/src/core/dark.rs`:

```rust
//! Arena-dark recovery (spec §7): journal → rebuild → J → H chunks → verify → take over.
use std::collections::BTreeMap;
use tapstone_proto::frame::{
    BROADCAST, Commit, Frame, HANDBACK_RECORDS, Halt, HandbackNak, Join, halt_reason, join_role,
};

use tapstone_rules::{Applied, Chain, Game, HouseRules, Record};

use super::{
    ArenaCore, Committed, CoreConfig, JournalOp, Match, Output, Signer, StatsSource, Table,
};
use crate::decks::DeckBook;
use crate::registry::Registry;

pub const HANDBACK_NAK_MS: u64 = 200;

/// What the journal knows about the match in flight.
#[derive(Debug, Clone, PartialEq)]
pub struct RecoveredMatch {
    pub match_id: u32,
    pub rules: [u8; 9],
    pub nodes: [u8; 2],
    pub figurines: [[u8; 7]; 2],
    pub decks: [Vec<u16>; 2],
    pub start_unix: u32,
    pub records: Vec<([u8; 24], Option<[u8; 8]>)>,
}

impl RecoveredMatch {
    /// The last match with a `Begin` and no `End`, from an ordered journal.
    pub fn from_journal(ops: &[JournalOp]) -> Option<RecoveredMatch> {
        let begin = ops
            .iter()
            .rposition(|o| matches!(o, JournalOp::Begin { .. }))?;
        let JournalOp::Begin {
            match_id,
            rules,
            nodes,
            figurines,
            decks,
            start_unix,
        } = ops[begin].clone()
        else {
            return None;
        };
        let mut records = Vec::new();
        for o in &ops[begin + 1..] {
            match o {
                JournalOp::Record {
                    match_id: id,
                    record,
                    hash,
                } if *id == match_id => records.push((*record, *hash)),
                JournalOp::End { match_id: id, .. } if *id == match_id => return None,
                _ => {}
            }
        }
        Some(RecoveredMatch {
            match_id,
            rules,
            nodes,
            figurines,
            decks,
            start_unix,
            records,
        })
    }
}

pub(crate) struct Dark {
    pub from: u16,
    pub count: Option<u8>,
    pub chunks: Vec<Option<Vec<[u8; 32]>>>,
    pub last_nak: u64,
    /// Commits the interim arbiter broadcast that the arena overheard, by mseq. The interim keeps
    /// arbitrating until it sees the arena's handover commit, so it can commit past the hand-back
    /// it sent; spec §7 step 5 hands over only when the heads are equal, so these are adopted too,
    /// through the same verify path.
    pub overheard: BTreeMap<u16, Commit>,
    /// The hand-back is verified and the arena arbitrates again.
    pub resumed: bool,
}

impl ArenaCore {
    /// Rebuild the match by re-applying every journaled record, then ask seat 0's shrine for the
    /// gap. Returns the core and the frames to send.
    pub fn recover(
        cfg: CoreConfig,
        stats: Box<dyn StatsSource + Send>,
        decks: DeckBook,
        registry: Registry,
        signer: Box<dyn Signer + Send>,
        rec: RecoveredMatch,
        now: u64,
    ) -> (ArenaCore, Vec<Output>) {
        let mut core = ArenaCore::new(cfg, stats, decks, registry, signer);
        let rules = HouseRules::from_bytes(rec.rules);
        let mut game = Game::new(rules, [0, 1], [&rec.decks[0], &rec.decks[1]]);
        let mut chain = None;
        let mut log = Vec::new();
        let mut out = Vec::new();
        for (bytes, hash) in &rec.records {
            let Some(r) = Record::decode(bytes) else {
                break;
            };
            let Ok(applied) = game.apply(&r) else { break };
            let h = step(&mut chain, &game, &r, applied);
            if h != *hash {
                out.push(Output::Log(format!(
                    "journal disagrees with the engine at {}",
                    r.seq
                )));
                break;
            }
            log.push(Committed {
                record: r,
                hash: h,
                applied,
                lseq: 0,
            });
        }
        let from = log.len() as u16;
        core.table = Table::Match(Box::new(Match {
            id: rec.match_id,
            game,
            chain,
            log,
            nodes: rec.nodes,
            figurines: rec.figurines,
            sigils: [
                tapstone_proto::ids::deck_sigil(&rec.decks[0]),
                tapstone_proto::ids::deck_sigil(&rec.decks[1]),
            ],
            decks: rec.decks,
            started_ms: now,
            start_unix: rec.start_unix,
            acked: [None; 2],
            last_heard: [now; 2],
            last_tx: [now; 2],
            tries: [0; 2],
            last_lseq: [None; 2],
            last_broadcast: now,
            paused: true,
            dark: Some(Dark {
                from,
                count: None,
                chunks: Vec::new(),
                last_nak: now,
                overheard: BTreeMap::new(),
                resumed: false,
            }),
        }));
        let join = Frame::Join(Join {
            role: join_role::ARENA,
            have_mseq: from,
        });
        core.send(&mut out, rec.nodes[0], rec.match_id, &join);
        out.push(Output::View(core.view()));
        (core, out)
    }

    pub(crate) fn dark_frame(
        &mut self,
        _src: u8,
        seat: usize,
        f: Frame,
        now: u64,
        out: &mut Vec<Output>,
    ) {
        let Some(m) = self.running() else { return };
        let Some(d) = m.dark.as_mut() else { return };
        match f {
            Frame::Handback(hb) if !d.resumed => {
                if hb.from_mseq != d.from || hb.n as usize > HANDBACK_RECORDS {
                    return;
                }
                let count = *d.count.get_or_insert(hb.count);
                if d.chunks.len() < count as usize {
                    d.chunks.resize(count as usize, None);
                }
                if let Some(slot) = d.chunks.get_mut(hb.idx as usize) {
                    *slot = Some(hb.records[..hb.n as usize].to_vec());
                }
                if d.chunks.iter().all(Option::is_some) {
                    self.take_over(now, out);
                }
            }
            // The interim arbiter (seat 0's shrine) committing on its own: keep it for adoption.
            Frame::Commit(c) if seat == 0 => {
                d.overheard.insert(c.mseq, c);
                if d.resumed {
                    self.absorb(Vec::new(), now, out);
                }
            }
            _ => {}
        }
    }

    /// The hand-back is complete: verify it, then every consecutive overheard interim commit, and
    /// resume (spec §7 steps 4-5).
    fn take_over(&mut self, now: u64, out: &mut Vec<Output>) {
        let Some(m) = self.running() else { return };
        let Some(d) = m.dark.as_mut() else { return };
        let records: Vec<([u8; 32], Option<u16>)> = std::mem::take(&mut d.chunks)
            .into_iter()
            .flatten()
            .flatten()
            .map(|b| (b, None))
            .collect();
        if self.absorb(records, now, out) {
            let Some(m) = self.running() else { return };
            let id = m.id;
            if let Some(d) = m.dark.as_mut() {
                d.resumed = true;
            }
            m.paused = false;
            m.last_heard = [now; 2];
            out.push(Output::Log(format!(
                "arena resumed at mseq {}",
                m.log.len()
            )));
            if let Some(c) = m.log.last() {
                let commit = commit_at(c);
                self.send(out, BROADCAST, id, &Frame::Commit(commit));
            }
            out.push(Output::View(self.view()));
            self.finish_if_over(out);
        }
    }

    /// Re-apply `records` (handed back, no lseq), then every overheard interim commit that is next
    /// in line, each through the engine and compared with its carried hash. One mismatch halts the
    /// match (spec §7 step 4): the arena never trusts a hash it cannot recompute. Returns false if
    /// it halted.
    fn absorb(
        &mut self,
        records: Vec<([u8; 32], Option<u16>)>,
        now: u64,
        out: &mut Vec<Output>,
    ) -> bool {
        let Some(m) = self.running() else {
            return false;
        };
        let id = m.id;
        let resumed = m.dark.as_ref().is_some_and(|d| d.resumed);
        let mut queue = records.into_iter();
        let mut adopted_late = false;
        loop {
            if m.game.phase == tapstone_rules::Phase::Over {
                break;
            }
            let next = match queue.next() {
                Some(x) => x,
                None => {
                    let at = m.game.seq;
                    let Some(c) = m.dark.as_mut().and_then(|d| d.overheard.remove(&at)) else {
                        break;
                    };
                    let mut b = [0u8; 32];
                    b[..24].copy_from_slice(&c.record.encode());
                    b[24..].copy_from_slice(&c.hash);
                    adopted_late = true;
                    (b, Some(c.lseq))
                }
            };
            match verify_one(m, &next.0) {
                Ok(mut committed) => {
                    if let Some(lseq) = next.1 {
                        committed.lseq = lseq;
                        m.last_lseq[committed.record.seat as usize] = Some(lseq);
                    }
                    m.log.push(committed);
                    out.push(Output::Journal(JournalOp::Record {
                        match_id: id,
                        record: committed.record.encode(),
                        hash: committed.hash,
                    }));
                }
                Err(x) => {
                    self.halt(x, out);
                    return false;
                }
            }
        }
        if let Some(d) = m.dark.as_mut() {
            let head = m.game.seq;
            d.overheard.retain(|&k, _| k >= head); // older ones are already in the log
        }
        if resumed && adopted_late {
            m.last_heard = [now; 2];
            let id = m.id;
            if let Some(c) = m.log.last() {
                let commit = commit_at(c);
                self.send(out, BROADCAST, id, &Frame::Commit(commit));
            }
            out.push(Output::View(self.view()));
            self.finish_if_over(out);
        }
        true
    }

    fn finish_if_over(&mut self, out: &mut Vec<Output>) {
        let Some(m) = self.running() else { return };
        if m.game.phase != tapstone_rules::Phase::Over {
            return;
        }
        let winner = match m.game.winner {
            Some(tapstone_rules::Winner::Seat(s)) => Some(s),
            _ => None,
        };
        let lethal = m.game.seats.iter().any(|s| s.castle.life == 0);
        let reason = if lethal {
            tapstone_proto::frame::result_reason::LETHAL
        } else {
            tapstone_proto::frame::result_reason::STOP
        };
        self.finish(reason, winner, out);
    }

    /// While the hand-back is incomplete, NAK the missing chunks every 200 ms.
    pub(crate) fn dark_tick(&mut self, now: u64, out: &mut Vec<Output>) -> bool {
        let Some(m) = self.running() else {
            return false;
        };
        let (id, node) = (m.id, m.nodes[0]);
        let Some(d) = m.dark.as_mut().filter(|d| !d.resumed) else {
            return false;
        };
        if now.saturating_sub(d.last_nak) >= HANDBACK_NAK_MS {
            d.last_nak = now;
            let frame = match d.count {
                None => Frame::Join(Join {
                    role: join_role::ARENA,
                    have_mseq: d.from,
                }),
                Some(_) => {
                    let bitmap = d
                        .chunks
                        .iter()
                        .enumerate()
                        .filter(|(_, c)| c.is_none())
                        .fold(0u64, |b, (i, _)| b | (1 << i));
                    Frame::HandbackNak(HandbackNak {
                        from_mseq: d.from,
                        bitmap,
                    })
                }
            };
            self.send(out, node, id, &frame);
        }
        true
    }
}

fn commit_at(c: &Committed) -> Commit {
    Commit {
        mseq: c.record.seq,
        lseq: c.lseq,
        record: c.record,
        hash: c.hash.unwrap_or([0; 8]),
    }
}

/// One record through the engine and the chain, against the hash it carries.
fn verify_one(m: &mut Match, bytes: &[u8; 32]) -> Result<Committed, Halt> {
    let carried: [u8; 8] = bytes[24..].try_into().unwrap();
    let carried = (carried != [0; 8]).then_some(carried);
    let at = m.game.seq;
    let Some(r) = Record::decode(bytes).filter(|r| r.seq == at) else {
        return Err(handback_halt(at, [0; 8], carried));
    };
    let Ok(applied) = m.game.apply(&r) else {
        return Err(handback_halt(at, [0; 8], carried));
    };
    let h = step(&mut m.chain, &m.game, &r, applied);
    if h != carried {
        return Err(handback_halt(at, h.unwrap_or([0; 8]), carried));
    }
    Ok(Committed {
        record: r,
        hash: h,
        applied,
        lseq: 0,
    })
}

fn handback_halt(at_mseq: u16, mine: [u8; 8], theirs: Option<[u8; 8]>) -> Halt {
    Halt {
        at_mseq,
        reason: halt_reason::HANDBACK,
        mine,
        theirs: theirs.unwrap_or([0; 8]),
    }
}

fn step(chain: &mut Option<Chain>, game: &Game, r: &Record, applied: Applied) -> Option<[u8; 8]> {
    if applied == Applied::Started {
        *chain = Some(Chain::genesis(game));
        None
    } else if let Some(c) = chain.as_mut() {
        c.step(r, game);
        Some(c.head())
    } else {
        None
    }
}
```

In `play.rs`, make `play_tick` start with:

```rust
        if self.dark_tick(now, out) {
            return; // no retransmits, pauses or timeouts while the hand-back is in flight
        }
```

Each halt site in `dark.rs` builds the `Halt` with `handback_halt` from plain values, so `m`'s
borrow has ended before `self.halt(x, out)` runs.

The handed-back `mseq == game.seq` check matters. A shrine that handed back from the wrong offset
would otherwise have its records applied out of place, and they would fail later for a reason that
names the wrong event.

> **Execution note (2026-09-23).** Two defects in the first draft of this task, both fixed above:
> (a) `dark_run` counted steps, and a scripted duel is over in 48–95 steps, so "150 in, 300 dark" went
> dark after the result; it now goes dark at 20 records for 10 steps. (b) `take_over` resumed as soon as
> the hand-back was complete, but the interim arbiter keeps committing until it sees the arena's handover
> commit, so a record committed in that window was never adopted: the arena resumed one behind both
> followers and refused seat 1's draws forever (seed 1). Spec §7 step 5 hands over only when the heads are
> *equal*, so the arena now keeps the interim commits it overhears (by mseq) and adopts each consecutive one
> through the same verify path, before and after resuming. Perturbation (3): never adopt them → the revival
> test goes red ("seed 1: no result after revival"). The harness's `refused` counters saturate, so a refusal
> loop fails the test's own assert instead of overflowing.

> **Ruled 2026-09-23: lseq in H.** Neither the journal nor the handed-back records carry lseqs, so a revived arena
> treated every lseq as new, and a tap the interim committed (its `C` lost) and a seat then retransmitted would
> commit twice. A double Pass is legal. A per-record lseq in the follower's log would cost 256 × 2 = 512 B (9,096 B,
> over the 8,704 B budget), so `H` carries **each seat's highest committed lseq** instead, which is what the dedupe
> needs: `Handback.last_lseq: [u16; 2]` (+4 B, ≤201 B). The follower tracks it from applied commits and from
> `arbitrate(r, lseq, time_ms)` (a new parameter), for 8,588 B on thumbv7em and xtensa. `take_over` seeds
> `Match.last_lseq` from it. Test: `a_revived_arena_does_not_recommit_a_tap_the_interim_committed`. At the handover,
> with both shrines quiet from revive to handover so the arena overhears nothing, the interim's dark lseqs (from the
> harness's `interim_lseq`, never from the follower under test) re-proposed commit nothing and reach no engine. The
> control: a fresh lseq is answered. Perturbations (perturb-task14-lseq.py): the arena ignores H's `last_lseq`, the
> follower sends zeros, `arbitrate` forgets the lseq, and the arena dedupes only `lseq == last` (the test also re-proposes an
> *older* tap, `last − 1`: the rule is `lseq ≤ last`, sound because lseq is monotonic per seat). Each turns the test red.
> `a_full_handback_chunk_fits_the_payload` pins the largest `H` at 201 B. The first two drafts of the test were
> blind: one read the expected lseq from the perturbed follower, and one let the arena learn it from overheard
> commits.

- [ ] **Step 5: Run**

Run: `cargo test -p tapstone-arena --test dark && cargo test -p tapstone-arena`
Expected: PASS (both dark tests, and every earlier arena test).

- [ ] **Step 6: Perturb, then commit**

Perturbations, each restored: (1) in `take_over`, skip the `h != carried` comparison → the
corrupted-hand-back test goes red (the arena believed a record it could not recompute); (2) in
`recover`, drop the last journaled record before rebuilding → the revival test still passes,
because the hand-back covers one more record. This is correct: the journal and the hand-back
overlap safely. Record that outcome in the commit message instead of "fixing" it.

```bash
git add rust/tapstone-rules/src/state.rs rust/tapstone-rules/tests/state.rs rust/tapstone-arena/src/core/mod.rs rust/tapstone-arena/src/core/dark.rs rust/tapstone-arena/src/core/play.rs rust/tapstone-arena/src/core/lobby.rs rust/tapstone-arena/tests/dark.rs rust/tapstone-arena/tests/harness.rs
git commit -m "feat(arena): arena-dark recovery from the journal with a verified hand-back (spec §7)"
```

---

## Task 15: The ledger — schema, commanders, loadouts, and `StatsSource`

**Files:**
- Create: `rust/tapstone-arena/src/ledger/mod.rs`, `rust/tapstone-arena/tests/ledger.rs`
- Modify: `rust/tapstone-arena/src/lib.rs` (`pub mod ledger;`)

- [ ] **Step 1: Write the failing tests**

`rust/tapstone-arena/tests/ledger.rs`:

```rust
use tapstone_arena::core::StatsSource;
use tapstone_arena::ledger::Ledger;
use tapstone_arena::registry::Registry;
use tapstone_proto::frame::{Equip, NONE8, NONE16, equip_op};
use tapstone_rules::Keyword;

const FIG: [u8; 7] = [0x04, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0x01];

fn ledger() -> (tempfile::TempDir, Ledger) {
    let dir = tempfile::tempdir().unwrap();
    let l = Ledger::open(&dir.path().join("ledger.sqlite")).unwrap();
    (dir, l)
}

#[test]
fn a_new_figurine_becomes_a_level_one_commander_with_nothing_worn() {
    let (_d, mut l) = ledger();
    assert_eq!(l.commander(FIG, 0), Ok((1, [None; 3])));
    let doll = l.doll(FIG, 0).unwrap();
    assert_eq!((doll.level, doll.xp, doll.xp_next, doll.slots, doll.inv_len), (1, 0, 5, 2, 0));
    assert_eq!((doll.loadout, doll.keyword), ([NONE16; 3], NONE8));
}

#[test]
fn equipping_loot_needs_the_item_in_inventory_and_a_legal_kit() {
    let (_d, mut l) = ledger();
    l.commander(FIG, 0).unwrap();
    let equip = |slot, design| Equip { slot, op: equip_op::LOOT, design, uid: [0; 7] };
    assert!(l.equip(FIG, &equip(0, 0), &Registry::Trusting).is_err(), "not owned yet");
    l.grant_for_test(FIG, 0); // Ember Sabre, weapon, haste
    l.grant_for_test(FIG, 2); // Hearthguard Plate, armour, taunt (min level 3, owned anyway)
    // Ash Locket, trinket (a look). Owned, so its refusal below is the closed slot, not ownership.
    l.grant_for_test(FIG, 4);
    let doll = l.equip(FIG, &equip(0, 0), &Registry::Trusting).unwrap();
    assert_eq!((doll.loadout[0], doll.keyword), (0, Keyword::Haste.code()));
    assert!(l.equip(FIG, &equip(1, 2), &Registry::Trusting).is_err(), "a second keyword is refused (0031)");
    assert!(l.equip(FIG, &equip(2, 4), &Registry::Trusting).is_err(), "the trinket slot is closed at level 1");
    let cleared = l.equip(FIG, &Equip { slot: 0, op: equip_op::CLEAR, design: 0, uid: [0; 7] }, &Registry::Trusting).unwrap();
    assert_eq!((cleared.loadout[0], cleared.keyword), (NONE16, NONE8));
}

#[test]
fn the_ledger_survives_a_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("ledger.sqlite");
    {
        let mut l = Ledger::open(&p).unwrap();
        l.commander(FIG, 0).unwrap();
        l.grant_for_test(FIG, 0);
        l.equip(FIG, &Equip { slot: 0, op: equip_op::LOOT, design: 0, uid: [0; 7] }, &Registry::Trusting).unwrap();
    }
    let mut l = Ledger::open(&p).unwrap();
    assert_eq!(l.commander(FIG, 0).unwrap().1[0], Some(0));
}
```

- [ ] **Step 2: Run to watch it fail**

Run: `cargo test -p tapstone-arena --test ledger`
Expected: FAIL to compile (`ledger` missing).

- [ ] **Step 3: Implement**

`rust/tapstone-arena/src/ledger/mod.rs`:

```rust
//! The commander ledger (0030 correction, spec §8): one SQLite file, the arena its only writer.
mod apply;

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use tapstone_proto::frame::{Doll, Equip, GRID_MAX, NONE8, NONE16, arena_refusal, equip_op};
use tapstone_progression::{Loadout, derive_commander, item, level_for_xp, slots, xp_next};
use tapstone_rules::cards::design;

use crate::core::StatsSource;
use crate::registry::Registry;

pub use apply::{LedgerEvent, roll_seed};

const SCHEMA: &str = include_str!("schema.sql");

pub struct Ledger {
    pub(crate) db: Connection,
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

impl Ledger {
    pub fn open(path: &Path) -> rusqlite::Result<Ledger> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let db = Connection::open(path)?;
        // realmwatch's pragmas (db.py:484-498): WAL, foreign keys, a busy timeout.
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")?;
        db.execute_batch(SCHEMA)?;
        Ok(Ledger { db })
    }

    fn xp(&self, key: &str) -> rusqlite::Result<Option<u32>> {
        self.db.query_row("SELECT xp FROM commander WHERE key = ?1", [key], |r| r.get(0)).optional()
    }

    pub fn loadout(&self, key: &str) -> rusqlite::Result<Loadout> {
        let mut out: Loadout = [None; 3];
        let mut st = self.db.prepare("SELECT slot, design FROM loadout WHERE commander = ?1")?;
        for row in st.query_map([key], |r| Ok((r.get::<_, usize>(0)?, r.get::<_, u16>(1)?)))? {
            let (slot, d) = row?;
            if slot < 3 {
                out[slot] = Some(d);
            }
        }
        Ok(out)
    }

    pub fn inventory(&self, key: &str) -> rusqlite::Result<Vec<u16>> {
        let mut st = self.db.prepare("SELECT design FROM inventory WHERE commander = ?1 ORDER BY rowid")?;
        st.query_map([key], |r| r.get(0))?.collect()
    }

    /// Test and operator helper: give a commander a loot item outside a match.
    pub fn grant_for_test(&mut self, figurine: [u8; 7], design: u16) {
        self.db
            .execute(
                "INSERT OR IGNORE INTO inventory (commander, design, acquired_match) VALUES (?1, ?2, 'granted')",
                params![hex(&figurine), design],
            )
            .unwrap();
    }

    fn doll_of(&self, key: &str, seat: u8) -> rusqlite::Result<Option<Doll>> {
        let Some(xp) = self.xp(key)? else { return Ok(None) };
        let level = level_for_xp(xp);
        let kit = self.loadout(key)?;
        let inv = self.inventory(key)?;
        let mut grid = [0u16; GRID_MAX];
        for (g, d) in grid.iter_mut().zip(&inv) {
            *g = *d;
        }
        let keyword = derive_commander(level, &kit).ok().and_then(|c| c.keyword).map_or(NONE8, |k| k.code());
        let name_seed: u32 = u32::from_str_radix(&key[key.len().saturating_sub(8)..], 16).unwrap_or(0);
        Ok(Some(Doll {
            seat,
            level,
            xp: xp.min(u32::from(u16::MAX)) as u16,
            xp_next: xp_next(level).map_or(NONE16, |x| x as u16),
            slots: slots(level) as u8,
            loadout: kit.map(|s| s.unwrap_or(NONE16)),
            inv_len: inv.len().min(GRID_MAX) as u8,
            inv: grid,
            keyword,
            name_seed,
        }))
    }
}

impl StatsSource for Ledger {
    fn commander(&mut self, figurine: [u8; 7], castle: u16) -> Result<(u8, Loadout), u8> {
        let key = hex(&figurine);
        let faction = design(castle).map_or("neutral".to_string(), |d| format!("{:?}", d.faction).to_lowercase());
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
        self.db
            .execute(
                "INSERT OR IGNORE INTO commander (key, name_seed, faction, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![key, 0, faction, now],
            )
            .map_err(|_| arena_refusal::BAD_LOADOUT)?;
        let xp = self.xp(&key).map_err(|_| arena_refusal::BAD_LOADOUT)?.unwrap_or(0);
        let kit = self.loadout(&key).map_err(|_| arena_refusal::BAD_LOADOUT)?;
        Ok((level_for_xp(xp), kit))
    }

    fn doll(&mut self, figurine: [u8; 7], seat: u8) -> Option<Doll> {
        self.doll_of(&hex(&figurine), seat).ok().flatten()
    }

    /// One loadout change (spec §6.2 `E`): refused unless the result is a legal kit (0031/0034).
    fn equip(&mut self, figurine: [u8; 7], e: &Equip, registry: &Registry) -> Result<Doll, u8> {
        let key = hex(&figurine);
        let xp = self.xp(&key).ok().flatten().ok_or(arena_refusal::NOT_SEATED)?;
        let level = level_for_xp(xp);
        let slot = e.slot as usize;
        if slot >= 3 {
            return Err(arena_refusal::BAD_LOADOUT);
        }
        let mut kit = self.loadout(&key).map_err(|_| arena_refusal::BAD_LOADOUT)?;
        let (source, card_uid): (&str, Option<String>) = match e.op {
            equip_op::CLEAR => {
                kit[slot] = None;
                ("loot", None)
            }
            equip_op::LOOT => {
                let owned = self.inventory(&key).map_err(|_| arena_refusal::BAD_LOADOUT)?;
                if !owned.contains(&e.design) {
                    return Err(arena_refusal::BAD_LOADOUT);
                }
                kit[slot] = Some(e.design);
                ("loot", None)
            }
            equip_op::CARD => {
                // An item card is worn only if tapped in this lobby (0031); the registry maps its
                // copy to an item design in the item id space.
                let d = registry.resolve_or(e.uid, e.design).ok_or(arena_refusal::UNKNOWN_UID)?;
                kit[slot] = Some(d);
                ("card", Some(hex(&e.uid)))
            }
            _ => return Err(arena_refusal::BAD_LOADOUT),
        };
        if kit[slot].is_some_and(|d| item(d).is_none()) {
            return Err(arena_refusal::BAD_LOADOUT);
        }
        derive_commander(level, &kit).map_err(|_| arena_refusal::BAD_LOADOUT)?;
        let tx = self.db.transaction().map_err(|_| arena_refusal::BAD_LOADOUT)?;
        tx.execute("DELETE FROM loadout WHERE commander = ?1 AND slot = ?2", params![key, slot]).map_err(|_| arena_refusal::BAD_LOADOUT)?;
        if let Some(d) = kit[slot] {
            tx.execute(
                "INSERT INTO loadout (commander, slot, source, design, card_uid) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![key, slot, source, d, card_uid],
            )
            .map_err(|_| arena_refusal::BAD_LOADOUT)?;
        }
        tx.commit().map_err(|_| arena_refusal::BAD_LOADOUT)?;
        self.doll_of(&key, 0).ok().flatten().ok_or(arena_refusal::BAD_LOADOUT)
    }
}
```

`rust/tapstone-arena/src/ledger/schema.sql`: copy the `CREATE TABLE` statements from spec §8.1
verbatim, each as `CREATE TABLE IF NOT EXISTS`, and append:

```sql
CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL);
INSERT INTO schema_version (v) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
```

Migrations, when one is needed, check `schema_version` and run an `ALTER TABLE` guarded by it
(realmwatch's `PRAGMA table_info` pattern, `db.py:468`, is the fallback for columns added before
versioning).

`name_seed` is derived from the figurine key (its last four bytes) rather than stored. The schema's
`name_seed` column is written 0 and kept for when a player can rename a commander. The doll reads
the derived value, so the realm-sigil name is a pure function of the figurine.

Create a stub `rust/tapstone-arena/src/ledger/apply.rs` (Task 16 fills it):

```rust
pub struct LedgerEvent;
pub fn roll_seed(_sha: &[u8; 32], _seat: u8) -> u64 {
    0
}
```

- [ ] **Step 4: Run**

Run: `cargo test -p tapstone-arena --test ledger`
Expected: 3 passed.

> **Execution note (2026-09-23).** Two corrections: (a) the trinket assert equipped item 4 without granting it,
> so it was refused for *not owned* and never tested the closed slot (removing the `derive_commander` guard and
> the keyword assert left it green). Item 4 is now granted first, and the refusal is `SlotLocked(2)`. (b) Perturbation 2's
> premise is false for this build: libsqlite3-sys's bundled SQLite defaults foreign keys ON, so removing the
> pragma alone changes nothing. The control is an explicit `PRAGMA foreign_keys=OFF`, which lets the scratch insert
> through, while `ON` refuses it. The pragma stays for builds against a system SQLite, where the default is off.

- [ ] **Step 5: Perturb, then commit**

Perturbations, each restored: (1) delete the `derive_commander(level, &kit)?` guard in `equip` →
the second-keyword and trinket asserts go red; (2) remove `PRAGMA foreign_keys=ON` and insert an
inventory row for an unknown commander in a scratch test → it succeeds; confirm the pragma makes it
fail. Keep the pragma.

```bash
git add rust/tapstone-arena/src/lib.rs rust/tapstone-arena/src/ledger/mod.rs rust/tapstone-arena/src/ledger/schema.sql rust/tapstone-arena/src/ledger/apply.rs rust/tapstone-arena/tests/ledger.rs
git commit -m "feat(arena): SQLite ledger: commanders, inventory, loadouts, D/E (0030, 0031, 0034)"
```

---

## Task 16: Applying a result exactly once — XP, the loss streak, loot, melt

**Files:**
- Replace: `rust/tapstone-arena/src/ledger/apply.rs`
- Modify: `rust/tapstone-arena/tests/ledger.rs`

- [ ] **Step 1: Write the failing tests**

Append to `rust/tapstone-arena/tests/ledger.rs`:

```rust
use tapstone_arena::ledger::{LedgerEvent, roll_seed};
use tapstone_proto::frame::{MatchResult, result_reason};

const OTHER: [u8; 7] = [0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x02];

fn result(sha_byte: u8, winner: u8, reason: u8) -> (MatchResult, [[u8; 7]; 2]) {
    (MatchResult::unsigned(40, winner, reason, [0; 8], [sha_byte; 32]), [FIG, OTHER])
}

fn seated(l: &mut Ledger) {
    l.commander(FIG, 0).unwrap();
    l.commander(OTHER, 1).unwrap();
}

#[test]
fn a_win_is_three_xp_a_loss_one_and_a_second_application_changes_nothing() {
    let (_d, mut l) = ledger();
    seated(&mut l);
    let (r, figs) = result(1, 0, result_reason::LETHAL);
    let ev = l.apply_result(0xA1, &r, figs, Some(0), 6).unwrap();
    assert!(ev.contains(&LedgerEvent::Xp { seat: 0, amount: 3 }));
    assert!(ev.contains(&LedgerEvent::Xp { seat: 1, amount: 1 }));
    let again = l.apply_result(0xA1, &r, figs, Some(0), 6).unwrap();
    assert!(again.is_empty(), "a result applies once (spec §8.2)");
    assert_eq!(l.doll(OTHER, 1).unwrap().xp, 1);
}

#[test]
fn a_win_drops_loot_and_every_third_consecutive_loss_does() {
    let (_d, mut l) = ledger();
    seated(&mut l);
    for (i, sha) in [2u8, 3, 4].into_iter().enumerate() {
        let (r, figs) = result(sha, 0, result_reason::LETHAL);
        let ev = l.apply_result(0xB0 + i as u32, &r, figs, Some(0), 6).unwrap();
        let loser_drop = ev.iter().any(|e| matches!(e, LedgerEvent::Drop { seat: 1, .. } | LedgerEvent::Melt { seat: 1, .. }));
        assert_eq!(loser_drop, i == 2, "loss {} of 3", i + 1);
        assert!(ev.iter().any(|e| matches!(e, LedgerEvent::Drop { seat: 0, .. } | LedgerEvent::Melt { seat: 0, .. })), "the winner always gets a drop");
    }
}

#[test]
fn an_abandoned_match_before_round_three_pays_nothing() {
    let (_d, mut l) = ledger();
    seated(&mut l);
    let (r, figs) = result(5, 0, result_reason::TIMEOUT);
    assert!(l.apply_result(0xC1, &r, figs, Some(0), 2).unwrap().is_empty());
    let (r, figs) = result(6, 0, result_reason::TIMEOUT);
    let ev = l.apply_result(0xC2, &r, figs, Some(0), 3).unwrap();
    assert!(ev.contains(&LedgerEvent::Xp { seat: 0, amount: 3 }), "from round 3 the stayer gets a win");
    assert!(
        ev.iter().any(|e| matches!(e, LedgerEvent::Drop { seat: 0, .. } | LedgerEvent::Melt { seat: 0, .. })),
        "and the win's drop (0031 ruling, spec §8.2)"
    );
    assert!(!ev.iter().any(|e| matches!(e, LedgerEvent::Xp { seat: 1, .. })), "the leaver gets nothing");
}

#[test]
fn a_desync_pays_nothing_and_is_recorded_halted() {
    let (_d, mut l) = ledger();
    seated(&mut l);
    let (r, figs) = result(7, 0xFF, result_reason::DESYNC);
    assert!(l.apply_result(0xD1, &r, figs, None, 6).unwrap().is_empty());
    assert_eq!(l.match_state_of(0xD1).as_deref(), Some("halted"), "the schema's state for a desync");
    let (r, figs) = result(8, 0, result_reason::TIMEOUT);
    l.apply_result(0xD2, &r, figs, Some(0), 5).unwrap();
    assert_eq!(l.match_state_of(0xD2).as_deref(), Some("abandoned"));
}

#[test]
fn a_duplicate_drop_melts_into_one_xp_and_so_does_a_full_grid() {
    let (_d, mut l) = ledger();
    seated(&mut l);
    // Find a sha whose winner roll is item 0 or 1 (level-1 eligible), give that item first.
    let sha = (0u8..=255).find(|b| tapstone_arena::ledger::roll_for(&l, FIG, &[*b; 32], 0).is_some()).unwrap();
    let pick = tapstone_arena::ledger::roll_for(&l, FIG, &[sha; 32], 0).unwrap();
    l.grant_for_test(FIG, pick);
    let (r, figs) = result(sha, 0, result_reason::LETHAL);
    let ev = l.apply_result(0xE1, &r, figs, Some(0), 6).unwrap();
    assert!(ev.contains(&LedgerEvent::Melt { seat: 0, design: pick, why: "duplicate" }));
    assert!(ev.contains(&LedgerEvent::Xp { seat: 0, amount: 1 }), "the melt's 1 XP (0031)");
    assert_eq!(l.doll(FIG, 0).unwrap().xp, 4, "stored: the win's 3 XP plus the melt's 1, not just an event");
}

#[test]
fn the_roll_is_a_function_of_the_transcript() {
    assert_eq!(roll_seed(&[9; 32], 0), roll_seed(&[9; 32], 0));
    assert_ne!(roll_seed(&[9; 32], 0), roll_seed(&[9; 32], 1));
    assert_ne!(roll_seed(&[9; 32], 0), roll_seed(&[8; 32], 0));
}
```

The full-grid melt needs 13 distinct loot items and set 1 has six, so it is tested at the
function level instead. Add to the same file:

```rust
#[test]
fn a_full_grid_melts_a_new_item() {
    assert_eq!(tapstone_arena::ledger::melt_reason(&[0; 12], 5), Some("grid full"));
    assert_eq!(tapstone_arena::ledger::melt_reason(&[0, 1], 1), Some("duplicate"));
    assert_eq!(tapstone_arena::ledger::melt_reason(&[0, 1], 2), None);
}
```

- [ ] **Step 2: Run to watch them fail**

Run: `cargo test -p tapstone-arena --test ledger`
Expected: FAIL to compile (`apply_result`, `LedgerEvent` variants, `roll_for`, `melt_reason`).

- [ ] **Step 3: Implement**

`rust/tapstone-arena/src/ledger/apply.rs`:

```rust
//! Spec §8.2: one transaction, applied once, deterministic loot.
use rusqlite::{OptionalExtension, params};
use sha2::{Digest, Sha256};
use tapstone_proto::frame::{MatchResult, result_reason};
use tapstone_progression::{
    ABANDON_BEFORE_ROUND, DROP_EVERY_LOSSES, GRID, ITEMS, XP_LOSS, XP_MELT, XP_WIN, level_for_xp,
};
use tapstone_rules::Faction;

use super::{Ledger, hex};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LedgerEvent {
    Xp { seat: u8, amount: u32 },
    Level { seat: u8, level: u8 },
    Drop { seat: u8, design: u16 },
    Melt { seat: u8, design: u16, why: &'static str },
}

/// Spec §8.2: `over` for a result the engine reached, `abandoned` for a lost-seat timeout, `halted`
/// for a desync; the schema's four states, one function, used by the journal's End and here.
pub fn match_state(reason: u8) -> &'static str {
    match reason {
        result_reason::DESYNC => "halted",
        result_reason::TIMEOUT => "abandoned",
        _ => "over",
    }
}

/// D11: `SHA-256(transcript_sha ‖ seat)`, first 8 bytes LE.
pub fn roll_seed(sha: &[u8; 32], seat: u8) -> u64 {
    let mut h = Sha256::new();
    h.update(sha);
    h.update([seat]);
    let d = h.finalize();
    u64::from_le_bytes(d[..8].try_into().unwrap())
}

/// Why a drop melts, if it does: a duplicate, or a 13th item for a 12-cell grid (0031, 0032).
pub fn melt_reason(owned: &[u16], design: u16) -> Option<&'static str> {
    if owned.contains(&design) {
        Some("duplicate")
    } else if owned.len() >= GRID {
        Some("grid full")
    } else {
        None
    }
}

fn faction_of(s: &str) -> Faction {
    match s {
        "ember" => Faction::Ember,
        "tide" => Faction::Tide,
        _ => Faction::Neutral,
    }
}

/// The item a seat's roll picks, from the loot items its level makes eligible, weighted 2 for
/// the commander's own faction and 1 otherwise (spec §8.2). `None` if nothing is eligible.
pub fn roll_for(l: &Ledger, figurine: [u8; 7], sha: &[u8; 32], seat: u8) -> Option<u16> {
    let key = hex(&figurine);
    let (xp, faction): (u32, String) = l
        .db
        .query_row("SELECT xp, faction FROM commander WHERE key = ?1", [&key], |r| Ok((r.get(0)?, r.get(1)?)))
        .ok()?;
    pick(level_for_xp(xp), faction_of(&faction), roll_seed(sha, seat))
}

fn pick(level: u8, faction: Faction, seed: u64) -> Option<u16> {
    let weighted: Vec<(u16, u64)> = ITEMS
        .iter()
        .filter(|d| d.loot && d.min_level <= level)
        .map(|d| (d.id, if d.faction == faction { 2 } else { 1 }))
        .collect();
    let total: u64 = weighted.iter().map(|(_, w)| w).sum();
    if total == 0 {
        return None;
    }
    let mut r = seed % total;
    for (id, w) in weighted {
        if r < w {
            return Some(id);
        }
        r -= w;
    }
    None
}

impl Ledger {
    /// Apply one match's result. Returns what happened, or nothing if it was already applied, if
    /// the match was a desync, or if it was abandoned before round 3 (0030).
    pub fn apply_result(
        &mut self,
        match_id: u32,
        r: &MatchResult,
        figurines: [[u8; 7]; 2],
        winner: Option<u8>,
        round: u8,
    ) -> rusqlite::Result<Vec<LedgerEvent>> {
        let id = format!("{match_id:08x}");
        let tx = self.db.transaction()?;
        let applied: Option<Option<i64>> =
            tx.query_row("SELECT applied_at FROM match WHERE id = ?1", [&id], |row| row.get(0)).optional()?;
        if matches!(applied, Some(Some(_))) {
            return Ok(Vec::new());
        }
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
        let state = match_state(r.reason);
        tx.execute(
            "INSERT INTO match (id, started_at, rules, seat0, seat1, state, final_hash, transcript_sha, winner, reason, applied_at)
             VALUES (?1, ?2, x'', ?3, ?4, ?10, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET state=?10, final_hash=?5, transcript_sha=?6, winner=?7, reason=?8, applied_at=?9",
            params![id, now, hex(&figurines[0]), hex(&figurines[1]), &r.chain[..], &r.transcript_sha[..], winner, r.reason, now, state],
        )?;
        let mut events = Vec::new();
        let abandoned_early = r.reason == result_reason::TIMEOUT && round < ABANDON_BEFORE_ROUND;
        let Some(w) = winner.filter(|_| r.reason != result_reason::DESYNC && !abandoned_early) else {
            tx.commit()?;
            return Ok(events);
        };
        for seat in 0..2u8 {
            let key = hex(&figurines[seat as usize]);
            let won = seat == w;
            // 0030: from round 3 a timeout pays the stayer a win and the leaver nothing, and the
            // leaver's streak is unchanged (0031 ruling).
            let leaver = r.reason == result_reason::TIMEOUT && !won;
            let (xp0, streak0): (u32, u32) =
                tx.query_row("SELECT xp, loss_streak FROM commander WHERE key = ?1", [&key], |row| Ok((row.get(0)?, row.get(1)?)))?;
            let gain = if won { XP_WIN } else if leaver { 0 } else { XP_LOSS };
            let streak = if won { 0 } else if leaver { streak0 } else { streak0 + 1 };
            let drops = won || (!leaver && streak % DROP_EVERY_LOSSES == 0);
            let mut xp = xp0 + gain;
            if gain > 0 {
                events.push(LedgerEvent::Xp { seat, amount: gain });
            }
            if drops {
                let faction: String = tx.query_row("SELECT faction FROM commander WHERE key = ?1", [&key], |row| row.get(0))?;
                if let Some(design) = pick(level_for_xp(xp), faction_of(&faction), roll_seed(&r.transcript_sha, seat)) {
                    let owned: Vec<u16> = {
                        let mut st = tx.prepare("SELECT design FROM inventory WHERE commander = ?1")?;
                        st.query_map([&key], |row| row.get(0))?.collect::<rusqlite::Result<_>>()?
                    };
                    match melt_reason(&owned, design) {
                        Some(why) => {
                            xp += XP_MELT;
                            events.push(LedgerEvent::Melt { seat, design, why });
                            events.push(LedgerEvent::Xp { seat, amount: XP_MELT });
                        }
                        None => {
                            tx.execute(
                                "INSERT INTO inventory (commander, design, acquired_match) VALUES (?1, ?2, ?3)",
                                params![key, design, id],
                            )?;
                            events.push(LedgerEvent::Drop { seat, design });
                        }
                    }
                }
            }
            if level_for_xp(xp) > level_for_xp(xp0) {
                events.push(LedgerEvent::Level { seat, level: level_for_xp(xp) });
            }
            tx.execute("UPDATE commander SET xp = ?2, loss_streak = ?3 WHERE key = ?1", params![key, xp, streak])?;
        }
        for e in &events {
            let (seat, kind, value, detail) = match e {
                LedgerEvent::Xp { seat, amount } => (*seat, "xp", i64::from(*amount), String::new()),
                LedgerEvent::Level { seat, level } => (*seat, "level", i64::from(*level), String::new()),
                LedgerEvent::Drop { seat, design } => (*seat, "drop", i64::from(*design), String::new()),
                LedgerEvent::Melt { seat, design, why } => (*seat, "melt", i64::from(*design), (*why).to_string()),
            };
            tx.execute(
                "INSERT INTO ledger_event (match, commander, kind, value, detail) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, hex(&figurines[seat as usize]), kind, value, detail],
            )?;
        }
        tx.commit()?;
        Ok(events)
    }
}
```

Export from `ledger/mod.rs`: `pub use apply::{LedgerEvent, match_state, melt_reason, roll_for, roll_seed};`
(replacing the Task 15 stub line), and add to `impl Ledger` in `ledger/mod.rs`:

```rust
    /// The `match.state` column for a match id (tests and diagnostics).
    pub fn match_state_of(&self, match_id: u32) -> Option<String> {
        self.db.query_row("SELECT state FROM match WHERE id = ?1", [format!("{match_id:08x}")], |r| r.get(0)).ok()
    }
```

- [ ] **Step 4: Run**

Run: `cargo test -p tapstone-arena --test ledger`
Expected: all ledger tests pass.

> **Execution note (2026-09-23).** A fifth perturbation, not in the first draft (a melt that pays no XP), left
> every test green: the melt test checked only the event list. It now also checks the stored XP (win 3 + melt 1 = 4).
> A fourth (no abandoned-early rule) turns the abandoned test red, as it should.

- [ ] **Step 5: Perturb, then commit**

Perturbations, each restored: (1) remove the `applied_at` early return → the apply-once test goes
red (XP doubles); (2) make the streak count every loss (`streak % 1`) → the third-loss test goes
red on losses 1 and 2; (3) remove `h.update([seat])` from `roll_seed` → the roll test goes red.

```bash
git add rust/tapstone-arena/src/ledger/mod.rs rust/tapstone-arena/src/ledger/apply.rs rust/tapstone-arena/tests/ledger.rs
git commit -m "feat(arena): apply results once: XP, streak drops, deterministic loot, melt (0030, 0031)"
```

---

## Task 17: The journal and the outbox in SQLite

The core emits `JournalOp`s; the ledger file keeps them, so a restarted arena finds its match
(spec D10). The outbox rows for the poster (Task 22) live in the same file and transaction.

**Files:**
- Create: `rust/tapstone-arena/src/ledger/journal.rs`
- Modify: `rust/tapstone-arena/src/ledger/mod.rs` (`mod journal;`), `rust/tapstone-arena/tests/ledger.rs`

- [ ] **Step 1: Write the failing test**

Append to `rust/tapstone-arena/tests/ledger.rs`:

```rust
use tapstone_arena::core::{JournalOp, RecoveredMatch};

#[test]
fn the_journal_round_trips_an_in_flight_match_and_forgets_a_finished_one() {
    let (_d, mut l) = ledger();
    let begin = JournalOp::Begin { match_id: 7, rules: tapstone_rules::HouseRules::default().bytes(), nodes: [163, 164], figurines: [FIG, OTHER], decks: [vec![2; 25], vec![6; 25]], start_unix: 99 };
    let rec = JournalOp::Record { match_id: 7, record: [1; 24], hash: Some([2; 8]) };
    l.journal(&begin).unwrap();
    l.journal(&rec).unwrap();
    let back = l.in_flight().unwrap().expect("one match in flight");
    assert_eq!(back, RecoveredMatch::from_journal(&[begin.clone(), rec.clone()]).unwrap());
    l.journal(&JournalOp::End { match_id: 7, result: MatchResult::unsigned(1, 0, 0, [0; 8], [0; 32]) }).unwrap();
    assert!(l.in_flight().unwrap().is_none());
}

#[test]
fn an_outbox_row_is_due_until_it_is_done() {
    let (_d, mut l) = ledger();
    l.enqueue("scry", 7, b"TSX1...", "application/vnd.tapstone.tsx1", 100).unwrap();
    let due = l.due(100).unwrap();
    assert_eq!(due.len(), 1);
    l.retry(due[0].id, 100).unwrap(); // first failure: next attempt 1 s later
    assert!(l.due(100).unwrap().is_empty());
    assert_eq!(l.due(101).unwrap().len(), 1);
    l.done(due[0].id, 101).unwrap();
    assert!(l.due(10_000).unwrap().is_empty());
}
```

- [ ] **Step 2: Run to watch it fail**

Run: `cargo test -p tapstone-arena --test ledger the_journal an_outbox`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

`rust/tapstone-arena/src/ledger/journal.rs`:

```rust
//! The match journal (spec D10) and the outbox (spec D14), in the ledger file.
use rusqlite::{OptionalExtension, params};

use super::{Ledger, hex};
use crate::core::{JournalOp, RecoveredMatch};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboxRow {
    pub id: i64,
    pub sink: String,
    pub match_id: String,
    pub body: Vec<u8>,
    pub content_type: String,
    pub attempts: u32,
}

/// Exponential backoff: 1 s, 2 s, 4 s … capped at 10 min (spec D14).
pub fn backoff_secs(attempts: u32) -> i64 {
    (1i64 << attempts.min(10)).min(600)
}

impl Ledger {
    pub fn journal(&mut self, op: &JournalOp) -> rusqlite::Result<()> {
        match op {
            JournalOp::Begin { match_id, rules, nodes, figurines, decks, start_unix } => {
                let meta = serde_json::json!({ "nodes": nodes, "decks": decks, "start_unix": start_unix, "figurines": [hex(&figurines[0]), hex(&figurines[1])] });
                self.db.execute(
                    "INSERT OR REPLACE INTO match (id, started_at, rules, seat0, seat1, state, meta) VALUES (?1, ?2, ?3, ?4, ?5, 'playing', ?6)",
                    params![format!("{match_id:08x}"), start_unix, &rules[..], hex(&figurines[0]), hex(&figurines[1]), meta.to_string().into_bytes()],
                )?;
            }
            JournalOp::Record { match_id, record, hash } => {
                let id = format!("{match_id:08x}");
                let mseq = u16::from_le_bytes([record[0], record[1]]);
                self.db.execute(
                    "INSERT OR REPLACE INTO match_records (match, mseq, record, hash) VALUES (?1, ?2, ?3, ?4)",
                    params![id, mseq, &record[..], hash.map(|h| h.to_vec())],
                )?;
            }
            JournalOp::End { match_id, result } => {
                self.db.execute(
                    "UPDATE match SET state = ?2 WHERE id = ?1 AND state = 'playing'",
                    params![format!("{match_id:08x}"), super::apply::match_state(result.reason)],
                )?;
            }
        }
        Ok(())
    }

    /// The match still `playing`, rebuilt as the core's `RecoveredMatch`.
    pub fn in_flight(&self) -> rusqlite::Result<Option<RecoveredMatch>> {
        let row: Option<(String, Vec<u8>, Vec<u8>)> = self
            .db
            .query_row(
                "SELECT id, rules, meta FROM match WHERE state = 'playing' ORDER BY started_at DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let Some((id, rules, meta)) = row else { return Ok(None) };
        let meta: serde_json::Value = serde_json::from_slice(&meta).unwrap_or_default();
        let unhex = |s: &str| -> [u8; 7] {
            let mut out = [0u8; 7];
            for (i, b) in out.iter_mut().enumerate() {
                *b = u8::from_str_radix(s.get(2 * i..2 * i + 2).unwrap_or("00"), 16).unwrap_or(0);
            }
            out
        };
        let figs = meta["figurines"].as_array().cloned().unwrap_or_default();
        let deck = |i: usize| -> Vec<u16> { serde_json::from_value(meta["decks"][i].clone()).unwrap_or_default() };
        let mut st = self.db.prepare("SELECT record, hash FROM match_records WHERE match = ?1 ORDER BY mseq")?;
        let records = st
            .query_map([&id], |r| {
                let rec: Vec<u8> = r.get(0)?;
                let hash: Option<Vec<u8>> = r.get(1)?;
                Ok((rec.try_into().unwrap_or([0; 24]), hash.and_then(|h| h.try_into().ok())))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(Some(RecoveredMatch {
            match_id: u32::from_str_radix(&id, 16).unwrap_or(0),
            rules: rules.try_into().unwrap_or_default(),
            nodes: serde_json::from_value(meta["nodes"].clone()).unwrap_or([0, 0]),
            figurines: [unhex(figs.first().and_then(|v| v.as_str()).unwrap_or("")), unhex(figs.get(1).and_then(|v| v.as_str()).unwrap_or(""))],
            decks: [deck(0), deck(1)],
            start_unix: meta["start_unix"].as_u64().unwrap_or(0) as u32,
            records,
        }))
    }

    pub fn enqueue(&mut self, sink: &str, match_id: u32, body: &[u8], content_type: &str, now: i64) -> rusqlite::Result<()> {
        self.db.execute(
            "INSERT INTO outbox (sink, match, body, content_type, next_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![sink, format!("{match_id:08x}"), body, content_type, now],
        )?;
        Ok(())
    }

    pub fn due(&self, now: i64) -> rusqlite::Result<Vec<OutboxRow>> {
        let mut st = self.db.prepare(
            "SELECT id, sink, match, body, content_type, attempts FROM outbox WHERE done_at IS NULL AND next_at <= ?1 ORDER BY id",
        )?;
        st.query_map([now], |r| {
            Ok(OutboxRow { id: r.get(0)?, sink: r.get(1)?, match_id: r.get(2)?, body: r.get(3)?, content_type: r.get(4)?, attempts: r.get(5)? })
        })?
        .collect()
    }

    pub fn retry(&mut self, id: i64, now: i64) -> rusqlite::Result<()> {
        let attempts: u32 = self.db.query_row("SELECT attempts FROM outbox WHERE id = ?1", [id], |r| r.get(0))?;
        self.db.execute(
            "UPDATE outbox SET attempts = ?2, next_at = ?3 WHERE id = ?1",
            params![id, attempts + 1, now + backoff_secs(attempts)],
        )?;
        Ok(())
    }

    pub fn done(&mut self, id: i64, now: i64) -> rusqlite::Result<()> {
        self.db.execute("UPDATE outbox SET done_at = ?2 WHERE id = ?1", params![id, now])?;
        Ok(())
    }
}
```

`meta` carries the match metadata as JSON (nodes, decks, figurines, start time). The committed
stats are not stored separately: they are in the ClaimSeat records themselves (`target`/`aux`/`lane`
in `match_records`), and a second copy could disagree with them.

In `ledger/mod.rs`: `mod journal; pub use journal::{OutboxRow, backoff_secs};`. Note
`apply_result`'s `INSERT … ON CONFLICT` runs after `Begin` has created the row: it updates it.

- [ ] **Step 3b: A backup after every result (spec §8, §17 default 1)**

Append to `rust/tapstone-arena/tests/ledger.rs`:

```rust
#[test]
fn a_backup_is_a_real_readable_ledger_and_only_the_newest_twenty_are_kept() {
    let (d, mut l) = ledger();
    l.commander(FIG, 0).unwrap();
    for m in 0..25u32 {
        l.backup(m, 20).unwrap();
    }
    let dir = d.path().join("backups");
    let mut names: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
    names.sort();
    assert_eq!(names.len(), 20, "{names:?}");
    assert!(!names.contains(&"ledger-00000000.sqlite".to_string()), "the oldest were pruned");
    let mut copy = Ledger::open(&dir.join("ledger-00000018.sqlite")).unwrap();
    assert_eq!(copy.commander(FIG, 0), Ok((1, [None; 3])), "the backup holds the commander");
}
```

and to `impl Ledger` in `journal.rs`:

```rust
    /// `VACUUM INTO` a consistent copy beside the ledger (`backups/ledger-<match>.sqlite`), then keep
    /// only the newest `keep`. Named by the 8-hex match id, so a re-applied result overwrites its
    /// own backup and never adds one.
    pub fn backup(&self, match_id: u32, keep: usize) -> rusqlite::Result<()> {
        let path: String = self.db.query_row("PRAGMA database_list", [], |r| r.get(2))?;
        let dir = std::path::Path::new(&path).parent().unwrap_or(std::path::Path::new(".")).join("backups");
        let _ = std::fs::create_dir_all(&dir);
        let dest = dir.join(format!("ledger-{match_id:08x}.sqlite"));
        let _ = std::fs::remove_file(&dest);
        self.db.execute("VACUUM INTO ?1", [dest.to_string_lossy()])?;
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .map(|rd| rd.filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with("ledger-")).collect())
            .unwrap_or_default();
        // Oldest first by mtime; the name breaks ties, so a burst inside one timestamp tick still
        // prunes deterministically.
        files.sort_by_key(|e| (e.metadata().and_then(|m| m.modified()).ok(), e.file_name()));
        let excess = files.len().saturating_sub(keep);
        for f in files.into_iter().take(excess) {
            let _ = std::fs::remove_file(f.path());
        }
        Ok(())
    }
```

Pruning is by modification time, because match ids are not chronological (they XOR the node id
into the start time). If the 25 backups in the test land within one filesystem timestamp tick, sort
by name instead as a tiebreak. The test asserts only the count and that the first is gone. Add the
tiebreak (`sort_by_key(|e| (mtime, name))`) if the test flakes.
Perturbation: skip the pruning loop → the count assert goes red.

- [ ] **Step 4: Run and commit**

Run: `cargo test -p tapstone-arena --test ledger` → all pass.
Perturbation: make `in_flight` ignore `state` → the "forgets a finished one" assert goes red; restore.

```bash
git add rust/tapstone-arena/src/ledger/mod.rs rust/tapstone-arena/src/ledger/journal.rs rust/tapstone-arena/src/ledger/schema.sql rust/tapstone-arena/tests/ledger.rs
git commit -m "feat(arena): journal and outbox in the ledger file (spec D10, D14)"
```

---

## Task 18: The view model

> **Carried from Task 11b (2026-09-23), done here:** `SeatView.owed_draws` from `seat.owed_draws()`, checked by
> the engine-comparison test. The page half (`app.js`, "drawing n") is carried on to Task 20, which builds the page.

The page renders only what the arena sends: a JSON view of the engine's state, one per committed
record (spec §9, D13). The page never re-implements a rule (0006 point 4).

**Files:**
- Replace: `rust/tapstone-arena/src/view.rs`
- Modify: `rust/tapstone-arena/src/core/lobby.rs` (`Lobby.last_over`), `rust/tapstone-arena/src/core/play.rs` (`finish` keeps the final board)
- Create: `rust/tapstone-arena/tests/view.rs`

- [ ] **Step 1: Write the failing test**

`rust/tapstone-arena/tests/view.rs`:

```rust
mod harness;
use harness::*;
use tapstone_rules::state::{CELLS, COMMANDER_DESIGN, LANES};

/// Every cell the view draws must be the cell the engine holds, checked against a follower's
/// engine: a separate object from the core's, so the view cannot agree with itself.
fn view_matches_engine(net: &Net) {
    let v = net.core.view();
    let g = &net.shrines[0].follower.game;
    assert_eq!((v.round, v.active), (g.round, g.active));
    for (s, seat) in g.seats.iter().enumerate() {
        let vs = &v.seats[s];
        assert_eq!(
            (vs.life, vs.charged, vs.spent, vs.hand),
            (seat.castle.life, seat.charged, seat.spent, seat.hand_len)
        );
        assert_eq!(
            vs.owed_draws,
            seat.owed_draws(),
            "seat {s} owed draws (0036, carried from 11b)"
        );
        for l in 0..LANES {
            for c in 0..CELLS {
                match (&seat.cells[l][c], &vs.cells[l][c]) {
                    (None, None) => {}
                    (Some(u), Some(vu)) => {
                        assert_eq!(
                            (vu.attack, vu.toughness, vu.damage),
                            (u.attack, u.toughness, u.damage),
                            "seat {s} {l}/{c}"
                        );
                        assert_eq!(vu.commander, u.design == COMMANDER_DESIGN);
                    }
                    (e, w) => panic!("seat {s} lane {l} cell {c}: engine {e:?}, view {w:?}"),
                }
            }
        }
    }
}

#[test]
fn the_view_is_the_engine_at_every_point_of_a_match() {
    let mut net = Net::new(5, 0.0, 0.0);
    let mut checked = 0;
    for _ in 0..3000 {
        net.step();
        if net.core.view().phase == "playing"
            && net.wire.is_empty()
            && net.shrines[0].follower.records().len() == net.core_log_len()
        {
            view_matches_engine(&net);
            checked += 1;
        }
        if !net.over.is_empty() {
            break;
        }
    }
    assert!(checked > 20, "only {checked} points were comparable");
}

#[test]
fn the_final_board_stays_up_after_the_result() {
    let mut net = Net::new(6, 0.0, 0.0);
    assert!(net.run(20_000));
    let v = net.core.view();
    assert_eq!(v.phase, "lobby");
    let last = v
        .last_over
        .as_ref()
        .expect("the finished board is kept for the canvas");
    assert_eq!(last.phase, "over");
    assert!(last.winner.is_some());
}

#[test]
fn the_view_serialises_with_stable_keys() {
    let net = Net::new(7, 0.0, 0.0);
    let json = serde_json::to_value(net.core.view()).unwrap();
    for k in [
        "phase",
        "match_id",
        "round",
        "active",
        "seq",
        "seats",
        "lobby",
        "last",
        "winner",
        "head",
        "last_over",
    ] {
        assert!(json.get(k).is_some(), "missing key {k}");
    }
}

/// A timeout is the arena's call, which the engine never saw: the kept board must still name the
/// seat that stayed as the winner.
#[test]
fn a_timed_out_board_names_the_seat_that_stayed() {
    let mut net = Net::new(3, 0.0, 0.0);
    while net.shrines[0].follower.records().len() < 20 {
        net.step();
    }
    let silent = net.shrines[1].node;
    let mut steps = 0;
    while net.over.is_empty() && steps < 20_000 {
        net.step_dropping_from(silent);
        steps += 1;
    }
    assert_eq!(
        net.over.last().expect("timed out").result.reason,
        tapstone_proto::frame::result_reason::TIMEOUT
    );
    let v = net.core.view();
    let last = v.last_over.as_ref().expect("the board is kept");
    assert_eq!((last.phase.as_str(), last.winner), ("over", Some(0)));
}
```

Add to the harness `impl Net`: `pub fn core_log_len(&self) -> usize { self.core.log_len() }`, and
to `ArenaCore` (in `core/mod.rs`):

```rust
    /// Committed records in the running match (0 in the lobby). Test and diagnostics helper.
    pub fn log_len(&self) -> usize {
        match &self.table {
            Table::Match(m) => m.log.len(),
            Table::Lobby(_) => 0,
        }
    }
```

Add `serde_json = "1"` is already a dependency; nothing to add.

- [ ] **Step 2: Run to watch it fail**

Run: `cargo test -p tapstone-arena --test view`
Expected: FAIL to compile (no `seats`, `round`, `last_over` on the placeholder `ViewModel`).

- [ ] **Step 3: Implement**

`rust/tapstone-arena/src/view.rs`:

```rust
//! The canvas's view model (spec §9). Built from the arena's own `Game`; serialised as JSON and
//! pushed over SSE. State that only the view needs (arrival flashes, "returns in N") is computed
//! in the page by diffing consecutive models (0027 amendment), never added here.
use serde::Serialize;
use tapstone_rules::cards::design;
use tapstone_rules::state::{CELLS, COMMANDER_DESIGN, LANES};
use tapstone_rules::{Game, Phase, Winner};

use crate::core::Match;
use crate::core::lobby::Lobby;

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct ViewModel {
    /// "lobby" | "playing" | "paused" | "resuming" | "over"
    pub phase: String,
    pub match_id: Option<String>,
    pub round: u8,
    pub active: u8,
    pub seq: u16,
    pub seats: Vec<SeatView>,
    pub lobby: Vec<LobbySeat>,
    pub last: Option<LastEvent>,
    pub winner: Option<u8>,
    pub head: Option<String>,
    pub last_over: Option<Box<ViewModel>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SeatView {
    pub castle: String,
    pub faction: String,
    pub life: u8,
    pub charged: u8,
    pub spent: u8,
    pub hand: u8,
    pub deck_left: u8,
    /// 0036: draws this seat owes before anything else ("drawing 3 of 6", spec §5.3).
    pub owed_draws: u8,
    /// `cells[lane][cell]`, cell 0 = back (next to this seat's castle), 2 = front.
    pub cells: Vec<Vec<Option<UnitView>>>,
    /// 0 = on the board, else the round it returns in (0029).
    pub commander_returns: u8,
    pub commander_lane: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UnitView {
    pub name: String,
    pub faction: String,
    pub attack: u8,
    pub toughness: u8,
    pub damage: u8,
    pub keyword: Option<String>,
    pub entered_round: u8,
    pub commander: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LobbySeat {
    pub node: u8,
    pub level: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LastEvent {
    pub seq: u16,
    pub seat: u8,
    pub kind: String,
    pub card: Option<String>,
    pub applied: String,
}

fn faction_name(f: tapstone_rules::Faction) -> String {
    format!("{f:?}").to_lowercase()
}

fn seat_view(g: &Game, s: usize) -> SeatView {
    let seat = &g.seats[s];
    let castle = design(seat.castle_design);
    SeatView {
        castle: castle.map_or("?".into(), |d| d.name.to_string()),
        faction: castle.map_or("neutral".into(), |d| faction_name(d.faction)),
        life: seat.castle.life,
        charged: seat.charged,
        spent: seat.spent,
        hand: seat.hand_len,
        deck_left: seat.deck_len, // 0036: the list holds only undrawn copies
        owed_draws: seat.owed_draws(),
        cells: (0..LANES)
            .map(|l| {
                (0..CELLS)
                    .map(|c| {
                        seat.cells[l][c].map(|u| {
                            let commander = u.design == COMMANDER_DESIGN;
                            let d = design(u.design);
                            UnitView {
                                name: if commander {
                                    "Commander".into()
                                } else {
                                    d.map_or("?".into(), |d| d.name.to_string())
                                },
                                faction: if commander {
                                    faction_name(
                                        castle.map_or(tapstone_rules::Faction::Neutral, |c| {
                                            c.faction
                                        }),
                                    )
                                } else {
                                    d.map_or("neutral".into(), |d| faction_name(d.faction))
                                },
                                attack: u.attack,
                                toughness: u.toughness,
                                damage: u.damage,
                                keyword: u.keyword.map(|k| format!("{k:?}")),
                                entered_round: u.entered_round,
                                commander,
                            }
                        })
                    })
                    .collect()
            })
            .collect(),
        commander_returns: seat.commander.returns,
        commander_lane: seat.commander.lane,
    }
}

impl ViewModel {
    pub(crate) fn of_match(m: &Match, _last: Option<usize>) -> ViewModel {
        let g = &m.game;
        let phase = if m.dark.is_some() {
            "resuming"
        } else if g.phase == Phase::Over {
            "over"
        } else if m.paused {
            "paused"
        } else {
            "playing"
        };
        ViewModel {
            phase: phase.into(),
            match_id: Some(format!("{:08x}", m.id)),
            round: g.round,
            active: g.active,
            seq: g.seq,
            seats: (0..2).map(|s| seat_view(g, s)).collect(),
            lobby: Vec::new(),
            last: m.log.last().map(|c| LastEvent {
                seq: c.record.seq,
                seat: c.record.seat,
                kind: format!("{:?}", c.record.kind),
                card: design(c.record.card)
                    .filter(|_| c.record.card != 0 || c.record.kind != tapstone_rules::Kind::Pass)
                    .map(|d| d.name.to_string()),
                applied: format!("{:?}", c.applied),
            }),
            winner: match g.winner {
                Some(Winner::Seat(s)) => Some(s),
                _ => None,
            },
            head: m
                .chain
                .map(|c| c.head().iter().map(|b| format!("{b:02x}")).collect()),
            last_over: None,
        }
    }

    pub(crate) fn of_lobby(l: &Lobby) -> ViewModel {
        ViewModel {
            phase: "lobby".into(),
            lobby: l
                .claims
                .iter()
                .map(|c| LobbySeat {
                    node: c.node,
                    level: c.level,
                })
                .collect(),
            last_over: l.last_over.clone(),
            ..ViewModel::default()
        }
    }
}
```

In `core/mod.rs`, make the module visible to `view.rs`: `pub(crate) mod lobby;` (instead of
`mod lobby;`), and delete the `lobby_view` re-export Task 9 added. In `lobby.rs` add a field to
`Lobby`:

```rust
    /// The finished board, kept up until the next match starts (the canvas shows the result).
    pub last_over: Option<Box<crate::view::ViewModel>>, // boxed: clippy large_enum_variant on Table
```

In `play.rs`'s `finish`, compute the final view **before** swapping the table out, and store it in
the new lobby:

```rust
        // (first lines of finish, replacing the existing mem::replace line)
        let final_view = match &self.table {
            Table::Match(m) => ViewModel::of_match(m, None),
            Table::Lobby(_) => return,
        };
        let mut next = super::lobby::Lobby {
            last_over: Some(Box::new(ViewModel {
                phase: "over".into(),
                ..final_view
            })),
            ..Default::default()
        };
        // A timeout's winner is the arena's call, which the engine never saw.
        if let Some(v) = next.last_over.as_mut() {
            v.winner = winner;
        }
        let Table::Match(m) = std::mem::replace(&mut self.table, Table::Lobby(next)) else {
            return;
        };
```

(with `use crate::view::ViewModel;` at the top of `play.rs`). The `winner` inside the stored view
comes from `m.game.winner`, which the engine set when the game ended. For a timeout, which the
engine never saw, set it explicitly: `next.last_over.as_mut().unwrap().winner = winner;`.

> **Execution note (2026-09-23).** `finish` builds the next `Lobby` with a struct literal (clippy's
> `field_reassign_with_default`), and sets the kept board's `winner` from the arena's result for every reason:
> the arena's call is authoritative, and for a timeout the engine never saw one. A fourth test,
> `a_timed_out_board_names_the_seat_that_stayed`, covers that line. Perturbations (perturb-task18.py): the plan's two,
> plus `owed_draws` forced to 0 (the carried check, red) and no winner override (the timeout test, red).

- [ ] **Step 4: Run**

Run: `cargo test -p tapstone-arena --test view && cargo test -p tapstone-arena`
Expected: PASS.

- [ ] **Step 5: Perturb, then commit**

Perturbations, each restored: (1) in `seat_view`, iterate cells in reverse (`(0..CELLS).rev()`) →
`the_view_is_the_engine…` goes red on the first unit that is not in the middle cell, which proves
the comparison sees cell order; (2) drop `last_over` from `finish` → the final-board test goes red.

```bash
git add rust/tapstone-arena/src/view.rs rust/tapstone-arena/src/core/mod.rs rust/tapstone-arena/src/core/lobby.rs rust/tapstone-arena/src/core/play.rs rust/tapstone-arena/tests/view.rs rust/tapstone-arena/tests/harness.rs
git commit -m "feat(arena): the view model, checked cell by cell against a separate engine"
```

---

## Task 19: HTTP — the page, SSE, `/api/version`, and loopback-only dev routes

**Files:**
- Create: `rust/tapstone-arena/build.rs`, `rust/tapstone-arena/src/http.rs`, `rust/tapstone-arena/src/version.rs`, `rust/tapstone-arena/tests/http.rs`
- Create (placeholders, Task 20 fills them): `rust/tapstone-arena/web/index.html`, `web/app.js`, `web/style.css`, `web/favicon.svg`
- Modify: `rust/tapstone-arena/src/lib.rs` (`pub mod http; pub mod version;`)

- [ ] **Step 1: Write the failing test**

`rust/tapstone-arena/tests/http.rs`:

```rust
use std::net::SocketAddr;

use tapstone_arena::http::{AppState, DevCmd, router};
use tokio::sync::{mpsc, watch};

async fn serve() -> (SocketAddr, watch::Sender<String>, mpsc::Receiver<DevCmd>) {
    let (view_tx, view_rx) = watch::channel(r#"{"phase":"lobby"}"#.to_string());
    let (dev_tx, dev_rx) = mpsc::channel(8);
    let app = router(AppState {
        views: view_rx,
        dev: dev_tx,
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    (addr, view_tx, dev_rx)
}

fn get(addr: SocketAddr, path: &str) -> (u16, String) {
    let r = ureq::get(&format!("http://{addr}{path}")).call();
    match r {
        Ok(resp) => (resp.status(), resp.into_string().unwrap()),
        Err(ureq::Error::Status(code, resp)) => (code, resp.into_string().unwrap_or_default()),
        Err(e) => panic!("{e}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_page_has_a_favicon_and_both_themes() {
    let (addr, _v, _d) = serve().await;
    let (code, html) = tokio::task::spawn_blocking(move || get(addr, "/"))
        .await
        .unwrap();
    assert_eq!(code, 200);
    assert!(
        html.contains(r#"rel="icon""#) && html.contains("favicon.svg"),
        "JP's web rule: an SVG favicon"
    );
    let (_, css) = tokio::task::spawn_blocking(move || get(addr, "/style.css"))
        .await
        .unwrap();
    assert!(
        css.contains("prefers-color-scheme: light"),
        "JP's web rule: dark and light"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn api_version_carries_realm_sigils_sixteen_fields() {
    let (addr, _v, _d) = serve().await;
    let (code, body) = tokio::task::spawn_blocking(move || get(addr, "/api/version"))
        .await
        .unwrap();
    assert_eq!(code, 200);
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    for k in [
        "name",
        "description",
        "version",
        "hash",
        "branch",
        "dirty",
        "built",
        "started",
        "uptime",
        "realm",
        "runtime",
        "os",
        "host",
        "pid",
        "repo",
        "commit_url",
    ] {
        assert!(
            v.get(k).is_some(),
            "missing {k} (realm-sigil go/sigil.go:31-46)"
        );
    }
    assert!(
        v["version"].as_str().unwrap().contains(" · "),
        "\"<Name> · <hash>\""
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_event_stream_starts_with_the_current_view() {
    let (addr, views, _d) = serve().await;
    views.send(r#"{"phase":"playing"}"#.into()).unwrap();
    let first = tokio::task::spawn_blocking(move || {
        let resp = ureq::get(&format!("http://{addr}/events")).call().unwrap();
        let mut line = String::new();
        let mut reader = std::io::BufReader::new(resp.into_reader());
        loop {
            line.clear();
            std::io::BufRead::read_line(&mut reader, &mut line).unwrap();
            if line.starts_with("data:") {
                return line;
            }
        }
    })
    .await
    .unwrap();
    assert!(first.contains(r#""phase":"playing""#), "{first}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_dev_tap_from_loopback_reaches_the_core() {
    let (addr, _v, mut dev) = serve().await;
    let code = tokio::task::spawn_blocking(move || {
        ureq::post(&format!("http://{addr}/dev/tap"))
            .send_json(serde_json::json!({"seat": 0, "kind": "Pass", "card": 0, "lane": -1, "target": 0, "aux": 0}))
            .unwrap()
            .status()
    })
    .await
    .unwrap();
    assert_eq!(code, 202);
    assert!(matches!(
        dev.recv().await,
        Some(DevCmd::Tap { seat: 0, .. })
    ));
}

/// The other direction of the loopback gate: a peer on the LAN is refused, and nothing reaches
/// the core. (The perturbation above only proves loopback is allowed.)
#[tokio::test(flavor = "multi_thread")]
async fn a_dev_tap_from_the_lan_is_refused() {
    use axum::extract::connect_info::MockConnectInfo;
    let (_view_tx, view_rx) = watch::channel(String::new());
    let (dev_tx, mut dev_rx) = mpsc::channel(8);
    let lan: SocketAddr = ([192, 168, 1, 9], 40_000).into();
    let app = router(AppState {
        views: view_rx,
        dev: dev_tx,
    })
    .layer(MockConnectInfo(lan));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let code = tokio::task::spawn_blocking(move || {
        match ureq::post(&format!("http://{addr}/dev/tap"))
            .send_json(serde_json::json!({"seat": 0, "kind": "Pass", "card": 0, "lane": -1, "target": 0, "aux": 0}))
        {
            Ok(r) => r.status(),
            Err(ureq::Error::Status(c, _)) => c,
            Err(e) => panic!("{e}"),
        }
    })
    .await
    .unwrap();
    assert_eq!(code, 403, "a LAN peer must not reach /dev");
    assert!(dev_rx.try_recv().is_err(), "nothing reached the core");
}
```

Add to `[dev-dependencies]`: nothing new (`ureq` and `tokio` are regular dependencies).

- [ ] **Step 2: Run to watch it fail**

Run: `cargo test -p tapstone-arena --test http`
Expected: FAIL to compile.

- [ ] **Step 3: Implement the version endpoint**

`rust/tapstone-arena/build.rs`:

```rust
use std::process::Command;

fn git(args: &[&str]) -> String {
    Command::new("git")
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn main() {
    let hash = git(&["rev-parse", "--short=7", "HEAD"]);
    let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"]);
    let dirty = !git(&["status", "--porcelain"]).is_empty();
    println!(
        "cargo:rustc-env=ARENA_GIT_HASH={}",
        if hash.is_empty() { "dev" } else { &hash }
    );
    println!("cargo:rustc-env=ARENA_GIT_BRANCH={branch}");
    println!("cargo:rustc-env=ARENA_GIT_DIRTY={dirty}");
    let built = Command::new("date")
        .args(["-u", "+%Y-%m-%dT%H:%M:%SZ"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    println!("cargo:rustc-env=ARENA_BUILT={built}");
    let rustc = Command::new(std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into()))
        .arg("--version")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    println!("cargo:rustc-env=ARENA_RUSTC={rustc}");
    // Watch git's own paths, which `--git-path` resolves correctly in a worktree too (there `.git`
    // is a file). HEAD moves on checkout; logs/HEAD grows on every commit, which HEAD alone (a
    // `ref:` line) does not show. `dirty` is refreshed only when one of these moves.
    for p in ["HEAD", "logs/HEAD"] {
        let path = git(&["rev-parse", "--git-path", p]);
        if !path.is_empty() {
            println!("cargo:rerun-if-changed={path}");
        }
    }
}
```

`rust/tapstone-arena/src/version.rs`:

```rust
//! realm-sigil's `/api/version` contract (`realm-sigil/go/sigil.go:31-46`). The Rust crate is
//! names-only, so the fields are filled here; the name comes from `realm_sigil::name_for_hex`.
use std::sync::OnceLock;
use std::time::{Instant, SystemTime};

static STARTED: OnceLock<(Instant, SystemTime)> = OnceLock::new();

pub const REPO: &str = "https://github.com/jphein/tapstone-game";

pub fn mark_started() {
    STARTED.get_or_init(|| (Instant::now(), SystemTime::now()));
}

pub fn version_json() -> serde_json::Value {
    mark_started();
    let (t0, wall) = STARTED.get().copied().unwrap();
    let hash = env!("ARENA_GIT_HASH");
    let started = humantime_rfc3339(wall);
    let host = std::fs::read_to_string("/etc/hostname")
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    serde_json::json!({
        "name": "Tapstone Arena",
        "description": "Arbiter, battlefield and ledger for a Tapstone table (0028)",
        "version": version_label(hash),
        "hash": hash,
        "branch": env!("ARENA_GIT_BRANCH"),
        "dirty": env!("ARENA_GIT_DIRTY") == "true",
        "built": env!("ARENA_BUILT"),
        "started": started,
        "uptime": t0.elapsed().as_secs(),
        "realm": "fantasy",
        "runtime": env!("ARENA_RUSTC"),
        "os": format!("{}/{}", std::env::consts::OS, std::env::consts::ARCH),
        "host": host,
        "pid": std::process::id(),
        "repo": REPO,
        "commit_url": if hash == "dev" { String::new() } else { format!("{REPO}/commit/{hash}") },
    })
}

/// RFC 3339 UTC without a date crate: seconds since the epoch, converted by civil-from-days.
fn humantime_rfc3339(t: SystemTime) -> String {
    let secs = t
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs()) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// `"<Adjective> <Noun> · <hash>"` for a stamped build. An unstamped build (`dev`, no git at build
/// time) publishes no sigil at all, per realm-sigil's own rule (`name_for_hex` docs, realm-sigil #9):
/// the tolerant parse would name `dev` differently from the Python binding.
pub fn version_label(hash: &str) -> String {
    if hash == "dev" || hash.is_empty() {
        return "Tapstone Arena · dev".into();
    }
    let (adj, noun) = realm_sigil::name_for_hex(hash, &realm_sigil::FANTASY);
    format!("{adj} {noun} · {hash}")
}

#[cfg(test)]
mod tests {
    use super::version_label;

    #[test]
    fn a_stamped_build_is_named_and_an_unstamped_one_is_not() {
        let (adj, noun) = realm_sigil::name_for_hex("a6c3e30", &realm_sigil::FANTASY);
        assert_eq!(version_label("a6c3e30"), format!("{adj} {noun} · a6c3e30"));
        assert_eq!(
            version_label("dev"),
            "Tapstone Arena · dev",
            "no sigil for an unstamped build"
        );
    }
}
```

`uptime` is computed at call time, so the router calls `version_json()` per request instead of
caching a value in the state.

- [ ] **Step 4: Implement the router**

`rust/tapstone-arena/src/http.rs`:

```rust
//! The arena's HTTP face (spec §9, §11): the page, `/events` (SSE of view-model JSON),
//! `/api/version`, and `/dev/*`, which answers loopback peers only.
use std::convert::Infallible;
use std::net::SocketAddr;

use axum::extract::{ConnectInfo, State};
use axum::http::{StatusCode, header};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use tokio::sync::{mpsc, watch};
use tokio_stream::StreamExt;
use tokio_stream::wrappers::WatchStream;

#[derive(Clone)]
pub struct AppState {
    pub views: watch::Receiver<String>,
    pub dev: mpsc::Sender<DevCmd>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "cmd")]
pub enum DevCmd {
    Tap { seat: u8, kind: String, card: u16, lane: i8, target: u8, aux: u8 },
    Desk,
}

#[derive(Deserialize)]
struct TapBody {
    seat: u8,
    kind: String,
    card: u16,
    lane: i8,
    target: u8,
    aux: u8,
}

const INDEX: &str = include_str!("../web/index.html");
const APP_JS: &str = include_str!("../web/app.js");
const STYLE: &str = include_str!("../web/style.css");
const FAVICON: &str = include_str!("../web/favicon.svg");

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(|| async { ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], INDEX) }))
        .route("/app.js", get(|| async { ([(header::CONTENT_TYPE, "text/javascript")], APP_JS) }))
        .route("/style.css", get(|| async { ([(header::CONTENT_TYPE, "text/css")], STYLE) }))
        .route("/favicon.svg", get(|| async { ([(header::CONTENT_TYPE, "image/svg+xml")], FAVICON) }))
        .route("/api/version", get(|| async { Json(crate::version::version_json()) }))
        .route("/events", get(events))
        .route("/dev/tap", post(dev_tap))
        .route("/dev/desk", post(dev_desk))
        .with_state(state)
}

async fn events(State(s): State<AppState>) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    // WatchStream yields the current value first, so a page that connects mid-match draws at once.
    let stream = WatchStream::new(s.views).map(|json| Ok(Event::default().data(json)));
    Sse::new(stream).keep_alive(KeepAlive::default())
}

fn loopback(peer: &SocketAddr) -> bool {
    peer.ip().is_loopback()
}

async fn dev_tap(State(s): State<AppState>, ConnectInfo(peer): ConnectInfo<SocketAddr>, Json(b): Json<TapBody>) -> impl IntoResponse {
    if !loopback(&peer) {
        return StatusCode::FORBIDDEN;
    }
    let cmd = DevCmd::Tap { seat: b.seat, kind: b.kind, card: b.card, lane: b.lane, target: b.target, aux: b.aux };
    match s.dev.send(cmd).await {
        Ok(()) => StatusCode::ACCEPTED,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}

async fn dev_desk(State(s): State<AppState>, ConnectInfo(peer): ConnectInfo<SocketAddr>) -> impl IntoResponse {
    if !loopback(&peer) {
        return StatusCode::FORBIDDEN;
    }
    match s.dev.send(DevCmd::Desk).await {
        Ok(()) => StatusCode::ACCEPTED,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}
```

Write placeholder web files so `include_str!` compiles. `web/index.html` (Task 20 replaces it):

```html
<!doctype html><meta charset="utf-8"><title>Tapstone Arena</title>
<link rel="icon" type="image/svg+xml" href="favicon.svg"><link rel="stylesheet" href="style.css">
<canvas id="board"></canvas><script type="module" src="app.js"></script>
```

`web/style.css`: `:root{--bg:#10141a}@media (prefers-color-scheme: light){:root{--bg:#f3ead3}}`
`web/app.js`: `// Task 20`
`web/favicon.svg`: the Task 20 favicon (write it now, it does not change):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="10" fill="#1d2430"/><path d="M32 12 50 32 32 52 14 32Z" fill="#e0a526"/><circle cx="32" cy="32" r="7" fill="#5bc0de"/></svg>
```

> **Execution note (2026-09-23).** Four corrections, all in the blocks above:
> - **realm-sigil gates `FANTASY`** behind the `divergent-themed-realms` feature (default builds reach only the
>   identity realms FLEET and CREATURE). `tapstone-arena`'s `Cargo.toml` opts in, with a comment naming the hazard.
>   realm-sigil reports the divergent set empty since its 2026-07-29 sync, so no name changes. `name_for_hex` takes
>   `&FANTASY` (a `static`).
> - **An unstamped build publishes no sigil** (realm-sigil's own rule, `name_for_hex` docs, realm-sigil #9):
>   `version_label("dev")` is `Tapstone Arena · dev`. It has a unit test.
> - **`build.rs` watches `git rev-parse --git-path HEAD` and `logs/HEAD`**, not `../../.git/HEAD`. In a worktree
>   `.git` is a file, and HEAD alone (a `ref:` line) does not change on a commit, so the stamped hash went stale.
> - **A fifth test, `a_dev_tap_from_the_lan_is_refused`**, uses axum's `MockConnectInfo` to prove the other
>   direction of the gate. Perturbation (3), `loopback()` always true, turns it red. Caveat: the gate trusts the socket
>   peer, so behind a reverse proxy on the same host every request is loopback. Bind `/dev` to 127.0.0.1 without a
>   proxy in front (spec §9).

- [ ] **Step 5: Run**

Run: `cargo test -p tapstone-arena --test http`
Expected: 5 passed, plus the `version` unit test (`cargo test -p tapstone-arena --lib`).

- [ ] **Step 6: Perturb, then commit**

Perturbations, each restored: (1) make `loopback` return `false` → the dev-tap test goes red
with 403, which proves the gate is live; (2) drop `"uptime"` from `version_json` → the version
test names the missing field.

```bash
git add rust/tapstone-arena/build.rs rust/tapstone-arena/src/lib.rs rust/tapstone-arena/src/http.rs rust/tapstone-arena/src/version.rs rust/tapstone-arena/web/index.html rust/tapstone-arena/web/app.js rust/tapstone-arena/web/style.css rust/tapstone-arena/web/favicon.svg rust/tapstone-arena/tests/http.rs
git commit -m "feat(arena): HTTP: page, SSE view stream, /api/version (realm-sigil), loopback dev routes"
```

---

## Task 20: The battlefield page (wireframe grade)

> **Carried from Task 11b via 18 (2026-09-23):** in `web/app.js`, append `   drawing ${seat.owed_draws}` to the
> castle band text when it is non-zero (spec §5.3, "drawing 3 of 6"). `SeatView.owed_draws` exists since Task 18.

Spec §9's brief: each seat's track owned by three cues (side, faction rim, a commander crest);
lanes left to right, lane 1 on the left for both; `/?seat=N` draws that seat's units as objects
and the other's as chips (0027), `/` draws both as objects; arrival and strike flashes come from
diffing consecutive models in the page. Rectangles and numbers only.

**Files:**
- Replace: `rust/tapstone-arena/web/index.html`, `web/app.js`, `web/style.css`

- [ ] **Step 1: The page**

`web/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#10141a" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f3ead3" media="(prefers-color-scheme: light)">
<title>Tapstone Arena</title>
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header><h1>Tapstone Arena</h1><span id="status">connecting…</span></header>
<main><canvas id="board" aria-label="battlefield"></canvas></main>
<footer id="banner" hidden></footer>
<script type="module" src="app.js"></script>
</body>
</html>
```

`web/style.css`:

```css
:root {
  --bg: #10141a; --panel: #1b222c; --ink: #e8e4d8; --muted: #8c96a3; --grid: #2c3642;
  --ember: #e0663a; --tide: #3a9be0; --neutral: #7d8793; --gold: #e0a526; --danger: #d9534f;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f3ead3; --panel: #fbf6e8; --ink: #2a241a; --muted: #6d6452; --grid: #d8cdb2;
    --ember: #b8431d; --tide: #1d6fae; --neutral: #6b7380; --gold: #9a6d05; --danger: #b52b27;
    color-scheme: light;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.3 system-ui, sans-serif; }
header { display: flex; justify-content: space-between; align-items: baseline; padding: .5rem 1rem; }
h1 { font-size: 1.1rem; margin: 0; letter-spacing: .08em; }
#status { color: var(--muted); font-variant-numeric: tabular-nums; }
main { display: grid; place-items: center; }
canvas { width: min(96vw, 1100px); aspect-ratio: 16 / 10; background: var(--panel); border-radius: 12px; }
footer { position: fixed; inset: auto 0 0 0; padding: 1rem; text-align: center; font-weight: 700;
  background: var(--danger); color: #fff; }
```

`web/app.js`:

```js
// The battlefield (arena spec §9). Draws the view model the arena pushes over SSE; no rules here.
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const banner = document.getElementById("banner");
const perspective = new URLSearchParams(location.search).get("seat"); // null | "0" | "1"
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

let view = null;
let prev = null;
const flashes = new Map(); // "seat:lane:cell" -> expiry ms

function fit() {
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * devicePixelRatio);
  canvas.height = Math.round(r.height * devicePixelRatio);
}

// State only the view needs is computed by diffing consecutive models (0027 amendment).
function diff(a, b) {
  if (!a || !b || !a.seats.length || !b.seats.length) return;
  const now = performance.now();
  b.seats.forEach((seat, s) => seat.cells.forEach((lane, l) => lane.forEach((u, c) => {
    const was = a.seats[s].cells[l][c];
    const changed = (u && !was) || (u && was && (u.damage !== was.damage || u.name !== was.name));
    if (changed) flashes.set(`${s}:${l}:${c}`, now + 150);
  })));
}

function unitRect(x, y, w, h, u, owner, asChip) {
  ctx.strokeStyle = css(`--${u.faction}`) || css("--neutral");
  ctx.lineWidth = u.commander ? 4 : 2;
  ctx.fillStyle = css("--bg");
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = css("--ink");
  const hp = u.toughness - u.damage;
  if (asChip) {
    ctx.font = `${Math.round(h * 0.45)}px system-ui`;
    ctx.fillText(`${u.attack}/${hp}${u.keyword ? " " + u.keyword[0] : ""}`, x + 6, y + h * 0.65);
    return;
  }
  ctx.font = `${Math.round(h * 0.18)}px system-ui`;
  ctx.fillText((u.commander ? "♛ " : "") + u.name, x + 6, y + h * 0.25, w - 12);
  ctx.font = `${Math.round(h * 0.3)}px system-ui`;
  ctx.fillText(`${u.attack} / ${hp}`, x + 6, y + h * 0.62);
  if (u.keyword) { ctx.font = `${Math.round(h * 0.16)}px system-ui`; ctx.fillText(u.keyword, x + 6, y + h * 0.88); }
  // damage bar
  ctx.fillStyle = css("--danger");
  ctx.fillRect(x, y + h - 4, w * (u.damage / Math.max(1, u.toughness)), 4);
}

function draw() {
  fit();
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!view || !view.seats.length) {
    const seated = view ? view.lobby.length : 0;
    // The finished board stays up until someone claims for the next match; then the lobby wins.
    const shown = view && seated === 0 && view.last_over;
    if (shown) { const v = view; view = shown; draw(); view = v; return; }
    ctx.fillStyle = css("--muted");
    ctx.font = `${Math.round(H * 0.05)}px system-ui`;
    ctx.fillText(`Lobby: ${seated} of 2 castles set on their stones`, W * 0.1, H * 0.5);
    return;
  }
  const pad = W * 0.02, band = H * 0.1, laneW = (W - pad * 4) / 3;
  const cellH = (H - band * 2 - pad * 2) / 6;
  const now = performance.now();
  // Seat 1's castle band at the top, seat 0's at the bottom: the side of the board is one of the
  // three ownership cues (spec §9).
  [1, 0].forEach((s, i) => {
    const seat = view.seats[s];
    const y = i === 0 ? pad : H - pad - band;
    ctx.fillStyle = view.active === s ? css("--gold") : css("--grid");
    ctx.fillRect(pad, y, W - pad * 2, band);
    ctx.fillStyle = css("--bg");
    ctx.font = `${Math.round(band * 0.4)}px system-ui`;
    const cmd = seat.commander_returns ? `  ♛ returns r${seat.commander_returns}` : "";
    const owed = seat.owed_draws ? `   drawing ${seat.owed_draws}` : ""; // 0036, spec §5.3
    ctx.fillText(`${seat.castle}  ♥ ${seat.life}   mana ${seat.charged - seat.spent}/${seat.charged}   hand ${seat.hand}   deck ${seat.deck_left}${owed}${cmd}`, pad * 2, y + band * 0.65);
  });
  for (let l = 0; l < 3; l++) {
    const x = pad * 2 + l * (laneW + pad * 0);
    ctx.fillStyle = css("--muted");
    ctx.font = `${Math.round(cellH * 0.2)}px system-ui`;
    ctx.fillText(`lane ${l + 1}`, x + 4, H / 2 + 4);
    // Seat 0's track runs up from the bottom (back cell nearest its castle), seat 1's down from the top.
    for (let s = 0; s < 2; s++) {
      for (let c = 0; c < 3; c++) {
        const row = s === 0 ? 5 - c : c;
        const y = pad + band + row * cellH;
        const u = view.seats[s].cells[l][c];
        ctx.strokeStyle = css("--grid");
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y + 2, laneW - pad, cellH - 4);
        if (u) {
          const asChip = perspective !== null && Number(perspective) !== s; // 0027: theirs are entries
          const w = asChip ? (laneW - pad) * 0.5 : laneW - pad;
          unitRect(x, y + 2, w, cellH - 4, u, s, asChip);
          if ((flashes.get(`${s}:${l}:${c}`) || 0) > now) {
            ctx.fillStyle = "rgba(255,255,255,0.35)";
            ctx.fillRect(x, y + 2, w, cellH - 4);
          }
        }
      }
    }
  }
  statusEl.textContent = `match ${view.match_id} · round ${view.round} · seat ${view.active} to act · #${view.seq}` + (view.head ? ` · ${view.head}` : "");
}

function show(v) {
  prev = view;
  view = v;
  diff(prev, view);
  // After a result the arena is back in the lobby with the finished board kept (last_over): the
  // banner follows the board on screen, so "Seat N wins" shows until the next match forms.
  const board = v.phase === "lobby" && !v.lobby.length && v.last_over ? v.last_over : v;
  const bannerText = { paused: "Link lost: the match is paused", resuming: "The arena is back: catching up…", over: board.winner !== null && board.winner !== undefined ? `Seat ${board.winner} wins` : "Desync: the match is void" }[board.phase];
  banner.hidden = !bannerText;
  banner.textContent = bannerText || "";
  draw();
  setTimeout(draw, 160); // clear the flash
}

function connect() {
  const es = new EventSource("events");
  es.onmessage = (e) => show(JSON.parse(e.data));
  es.onerror = () => { statusEl.textContent = "arena unreachable: retrying"; es.close(); setTimeout(connect, 1000); };
}

addEventListener("resize", draw);
connect();
```

> **Execution note (2026-09-23).** Two page bugs in the first draft, fixed above: (a) the result banner could
> never show, because `finish` returns the table to a *lobby* view that carries `last_over`, so the top-level phase is
> never `over`. The banner now follows the board on screen. (b) The kept result board hid a forming lobby forever.
> Once anyone claims, the lobby line wins. The carried `drawing n` (0036) is in the castle band. `node --check
> web/app.js` is the syntax gate, and a planted error proves it fails.

- [ ] **Step 2: Check it the way 0027 says to: from real engine output, by eye**

Run `cargo run -p tapstone-arena -- --desk` (Task 21), open `http://127.0.0.1:7790/` and
`http://127.0.0.1:7790/?seat=0` with `xdg-open`, and watch a desk match. Confirm against the
wireframe brief, not against taste:
- seat 0's castle band is at the bottom and seat 1's at the top, in both themes (switch the OS
  theme);
- the commander tiles carry ♛ and a thicker faction rim;
- in `?seat=0`, seat 1's units are half-width chips and seat 0's are full tiles;
- a struck unit flashes once;
- killing the arena process (Ctrl-C) turns the status line to "arena unreachable: retrying".

A wireframe decides nothing (0027), and this page decides nothing about art. Its only claim is
legibility, and that claim is checked by looking.

- [ ] **Step 3: Commit**

```bash
git add rust/tapstone-arena/web/index.html rust/tapstone-arena/web/app.js rust/tapstone-arena/web/style.css
git commit -m "feat(arena): the wireframe battlefield page (spec §9, 0027's ownership brief)"
```

---

## Task 21: Desk mode — the whole stack with two scripted shrines and no radio

**Files:**
- Create: `rust/tapstone-arena/src/link/mod.rs`, `rust/tapstone-arena/src/link/desk.rs`, `rust/tapstone-arena/tests/desk.rs`
- Modify: `rust/tapstone-arena/src/lib.rs` (`pub mod link;`)

- [ ] **Step 1: The link abstraction**

`rust/tapstone-arena/src/link/mod.rs`:

```rust
//! How MATCH frames reach the mesh: the USB-serial gateway (Task 22) or desk mode (in process).
pub mod desk;
pub mod lines;
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
}
```

(Create empty `lines.rs` and `serial.rs` files now; Task 22 fills them.)

- [ ] **Step 2: Write the failing test**

`rust/tapstone-arena/tests/desk.rs`:

```rust
use tapstone_arena::core::{ArenaCore, CoreConfig, Input, Output, Unsigned};
use tapstone_arena::link::Link;
use tapstone_arena::link::desk::DeskLink;
use tapstone_arena::registry::Registry;

#[test]
fn a_desk_match_runs_the_real_core_to_a_result() {
    let (mut link, book, stats) = DeskLink::new(11);
    let cfg = CoreConfig { node: tapstone_arena::link::desk::ARENA_NODE, rules: Default::default(), ruleset: 1, registry_id: 2, flat: false, epoch_unix: 0 };
    let mut core = ArenaCore::new(cfg, Box::new(stats), book, Registry::Trusting, Box::new(Unsigned));
    let mut result = None;
    for step in 0..20_000u64 {
        let now = step * 10;
        let mut inputs: Vec<Input> = link.poll(now).into_iter().map(|r| Input::Frame { src: r.src, rssi: r.rssi, mac_ok: r.mac_ok, bytes: r.bytes }).collect();
        inputs.push(Input::Tick);
        for i in inputs {
            for o in core.handle(i, now) {
                match o {
                    Output::Send { dst, frame } => link.send(dst, &frame),
                    Output::MatchOver(m) => result = Some(m),
                    _ => {}
                }
            }
        }
        if result.is_some() {
            break;
        }
    }
    let m = result.expect("the desk match ended");
    assert!(tapstone_sim::replay(&m.json).unwrap().matches(&m.json));
}
```

- [ ] **Step 3: Run to watch it fail**

Run: `cargo test -p tapstone-arena --test desk`
Expected: FAIL to compile.

- [ ] **Step 4: Implement desk mode**

`rust/tapstone-arena/src/link/desk.rs`: move the shrine logic of `tests/harness.rs` into the
crate, so that the harness and desk mode run **the same code**:
- `pub struct DeskShrine`, identical to the harness's `Shrine`, with its `act` and `rx` methods;
- `pub struct DeskLink { shrines: [DeskShrine; 2], out: VecDeque<Rx>, now: u64 }` implementing
  `Link`. Its `send` delivers a frame to each shrine it is addressed to, queueing their replies;
  its `poll(now)` runs each shrine's `act` and returns the queued replies;
- `pub const ARENA_NODE: u8 = 200;`
- `impl DeskLink { pub fn new(seed: u64) -> (DeskLink, DeckBook, FixedStats) }`, with `FixedStats`
  moved from the harness into this module as `pub struct FixedStats`.

Then rewrite `tests/harness.rs` so that `Shrine` and `FixedStats` are re-exports of
`tapstone_arena::link::desk::{DeskShrine as Shrine, FixedStats}`. Keep the harness-only machinery
(loss injection, dark mode, `step_dropping_from`) in the harness. The shrine behaviour must exist
once: a desk mode whose shrines differ from the tested ones would demo something the tests never
checked. That is verification.md's "one object" again.

The code is the harness code from Tasks 9, 13 and 14 with `Net`'s mesh replaced by the two
queues. Move it, do not re-type it: `git mv` is not available across that split, so cut and paste
the method bodies and let the compiler list what moved.

> **Execution note (2026-09-23).** As executed: `DeskShrine { index, node, seat_ai, follower, deck, lseq, pending,
> refused, deck_idx, drawn }`, with `act(now, may_claim, manual) -> Vec<(dst, bytes)>` and `rx(&Header, &Frame) ->
> Vec<(dst, bytes)>`. **The caller owns claim order:** the harness keeps its god's-eye `core.seated()` wait (loss), and
> `DeskLink` lets shrine 1 claim once shrine 0 has sent its claim (the desk mesh is lossless and in order). Dark
> routing and the interim arbiter stay in the harness. `desk_decks(seed)`, `copy_uid`, `lobby_game`, `encode`,
> `ARENA_NODE`, `DESK_NODES` and `FixedStats` live in `link/desk.rs`. **Behaviour identity was measured, not assumed:**
> a 30-seed lossy fingerprint (every record, chain heads, follower lengths) is byte-identical before and after the move.
> Its positive control, the claim retransmit moved 100 → 110 ms, changes 9 of 30 seeds.
> **The Step 6 perturbation's premise is false:** "never pass after three refusals" leaves both tests green,
> because the scripted seats never hit three refusals in a row. The perturbation used instead is "the shrine never
> pays its owed draws" (`owes_draw = false`): `desk.rs` fails "the desk match ended" and `core_match.rs` fails
> "seed 1: no result". One edit, both red. The page's by-eye check (Task 20 step 2) needs the `--desk` binary, which
> is Task 24, so it is recorded there.

- [ ] **Step 5: Run everything**

Run: `cargo test -p tapstone-arena`
Expected: every arena test passes, including `desk.rs`. The harness tests prove the moved shrine
code still behaves identically.

- [ ] **Step 6: Commit**

Perturbation: make `DeskShrine::act` never pay its owed draws (`owes_draw = false`) → both `desk.rs` and
`core_match.rs` stall. One edit reddening both proves they run the same shrine code. Restore. (The first draft's
"never pass after three refusals" reddens neither: see the note above.)

```bash
git add rust/tapstone-arena/src/lib.rs rust/tapstone-arena/src/link/mod.rs rust/tapstone-arena/src/link/desk.rs rust/tapstone-arena/src/link/lines.rs rust/tapstone-arena/src/link/serial.rs rust/tapstone-arena/tests/desk.rs rust/tapstone-arena/tests/harness.rs
git commit -m "feat(arena): desk mode runs the tested shrine code in process (spec §9)"
```

---

## Task 22: The gateway link — `@TS1` lines, port discovery by MAC, a PTY test

Spec §4, D6–D8. The gateway firmware does not exist yet (Task 25 drafts its smol issue), so this
task builds and tests the host side against a pseudo-terminal standing in for the board.

**Files:**
- Replace: `rust/tapstone-arena/src/link/lines.rs`, `rust/tapstone-arena/src/link/serial.rs`
- Create: `rust/tapstone-arena/tests/lines.rs`, `rust/tapstone-arena/tests/serial_pty.rs`

- [ ] **Step 1: Write the failing codec test**

`rust/tapstone-arena/tests/lines.rs`:

```rust
use tapstone_arena::link::lines::{GwLine, parse, ping_line, tx_line};

#[test]
fn every_gateway_line_parses() {
    assert_eq!(
        parse("@TS1 HELLO ac:a7:04:b9:77:14 200 1a2b3c4d 7"),
        GwLine::Hello { mac: "ac:a7:04:b9:77:14".into(), node: 200, fw: "1a2b3c4d".into(), epoch: 7 }
    );
    assert_eq!(
        parse("@TS1 RX 163 -48 1 534d4f4c7631204d41544348200141"),
        GwLine::Rx { src: 163, rssi: -48, mac_ok: true, bytes: b"SMOLv1 MATCH \x01A".to_vec() }
    );
    assert_eq!(parse("@TS1 TXOK 42"), GwLine::TxOk(42));
    assert_eq!(parse("@TS1 TXERR 42 no-peer"), GwLine::TxErr(42, "no-peer".into()));
    assert_eq!(
        parse("@TS1 ROSTER 163:ac:a7:04:00:00:01:-40,164:ac:a7:04:00:00:02:-55"),
        GwLine::Roster(vec![(163, "ac:a7:04:00:00:01".into(), -40), (164, "ac:a7:04:00:00:02".into(), -55)])
    );
}

#[test]
fn anything_else_is_a_log_line_including_near_misses() {
    for l in ["I (123) smol: I am Eldritch Jewel (id 8)", "@TS2 RX 1 2 3 00", "@TS1 RX 163 -48 1 zz", "@TS1 RX 163", ""] {
        assert!(matches!(parse(l), GwLine::Log(_)), "{l:?} should be a log line");
    }
}

#[test]
fn arena_lines_are_one_line_each() {
    assert_eq!(tx_line(7, 255, b"\x00\xff"), "@TS1 TX 7 255 00ff\n");
    assert_eq!(ping_line(), "@TS1 PING\n");
}
```

- [ ] **Step 2: Run to watch it fail**

Run: `cargo test -p tapstone-arena --test lines` → FAIL to compile.

- [ ] **Step 3: Implement the codec**

`rust/tapstone-arena/src/link/lines.rs`:

```rust
//! The arena ⇄ gateway line protocol (spec D6): `@TS1 `-prefixed text lines, frames in hex. A
//! line without the prefix, or that fails to parse, is a log line. Nothing is fatal: the gateway's
//! own `println!` logs share the wire (c6-watch debug_console.rs explains why the two coexist).
pub const PREFIX: &str = "@TS1 ";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GwLine {
    Hello { mac: String, node: u8, fw: String, epoch: u8 },
    Rx { src: u8, rssi: i8, mac_ok: bool, bytes: Vec<u8> },
    TxOk(u32),
    TxErr(u32, String),
    Roster(Vec<(u8, String, i8)>),
    Log(String),
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn parse_known(body: &str) -> Option<GwLine> {
    let mut w = body.split(' ');
    Some(match w.next()? {
        "HELLO" => GwLine::Hello { mac: w.next()?.into(), node: w.next()?.parse().ok()?, fw: w.next()?.into(), epoch: w.next()?.parse().ok()? },
        "RX" => GwLine::Rx {
            src: w.next()?.parse().ok()?,
            rssi: w.next()?.parse().ok()?,
            mac_ok: w.next()? == "1",
            bytes: unhex(w.next()?)?,
        },
        "TXOK" => GwLine::TxOk(w.next()?.parse().ok()?),
        "TXERR" => GwLine::TxErr(w.next()?.parse().ok()?, w.collect::<Vec<_>>().join(" ")),
        "ROSTER" => GwLine::Roster(
            w.next()?
                .split(',')
                .map(|e| {
                    // id:aa:bb:cc:dd:ee:ff:rssi — the MAC itself contains colons.
                    let (id, rest) = e.split_once(':')?;
                    let (mac, rssi) = rest.rsplit_once(':')?;
                    Some((id.parse().ok()?, mac.to_string(), rssi.parse().ok()?))
                })
                .collect::<Option<Vec<_>>>()?,
        ),
        _ => return None,
    })
}

pub fn parse(line: &str) -> GwLine {
    let line = line.trim_end_matches(['\r', '\n']);
    line.strip_prefix(PREFIX).and_then(parse_known).unwrap_or_else(|| GwLine::Log(line.to_string()))
}

pub fn tx_line(tx_id: u32, dst: u8, frame: &[u8]) -> String {
    format!("{PREFIX}TX {tx_id} {dst} {}\n", hex(frame))
}

pub fn ping_line() -> String {
    format!("{PREFIX}PING\n")
}
```

Run: `cargo test -p tapstone-arena --test lines` → 3 passed. Perturbation: drop the
`len() % 2` check and feed `"@TS1 RX 1 2 1 abc"` in a scratch assert → it must still be a log
line, via the `get(i..i+2)` bound; restore and keep the explicit check.

- [ ] **Step 4: Write the failing PTY test**

`rust/tapstone-arena/tests/serial_pty.rs`:

```rust
//! A pseudo-terminal stands in for the gateway board: the arena opens the slave side by path; the
//! test plays the firmware on the master side.
use std::io::{BufRead, BufReader, Write};
use std::os::fd::{AsRawFd, FromRawFd};

use nix::pty::openpty;
use tapstone_arena::link::Link;
use tapstone_arena::link::serial::SerialLink;

#[test]
fn frames_cross_a_pty_in_both_directions_and_logs_are_skipped() {
    let pty = openpty(None, None).unwrap();
    let slave_path = nix::unistd::ttyname(&pty.slave).unwrap();
    let master = unsafe { std::fs::File::from_raw_fd(pty.master.as_raw_fd()) };
    std::mem::forget(pty.master);
    let mut fw_out = master.try_clone().unwrap();
    let mut fw_in = BufReader::new(master);

    let mut link = SerialLink::open_path(slave_path.to_str().unwrap()).unwrap();
    // Firmware → arena: a log line, then a frame.
    fw_out
        .write_all(b"I (12) boot: hello\n@TS1 RX 163 -40 1 534d4f4c\n")
        .unwrap();
    let mut got = Vec::new();
    for _ in 0..100 {
        got.extend(link.poll(0));
        if !got.is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(got.len(), 1, "the log line is not a frame");
    assert_eq!((got[0].src, got[0].bytes.as_slice()), (163, &b"SMOL"[..]));
    // A frame whose group MAC did not verify is still delivered, flagged: the MAC is in observe
    // mode fleet-wide (protocol §7), so dropping unverified frames would drop every frame today.
    fw_out.write_all(b"@TS1 RX 164 -50 0 4d41\n").unwrap();
    let mut more = Vec::new();
    for _ in 0..100 {
        more.extend(link.poll(0));
        if !more.is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(more.len(), 1, "an unverified frame is not dropped");
    assert_eq!(
        (more[0].src, more[0].mac_ok),
        (164, false),
        "and it is flagged"
    );
    // Arena → firmware.
    link.send(255, b"\x01\x02");
    let mut line = String::new();
    fw_in.read_line(&mut line).unwrap();
    assert!(
        line.starts_with("@TS1 TX ") && line.trim_end().ends_with(" 255 0102"),
        "{line:?}"
    );
}
```

The test uses `unsafe` for the fd hand-off. That is allowed in a test file: `forbid(unsafe_code)`
is on the `no_std` crates, not on the arena's tests.

- [ ] **Step 5: Implement the serial link**

`rust/tapstone-arena/src/link/serial.rs`:

```rust
//! The USB-serial gateway (spec §4). A reader thread splits lines; `poll` drains them. Port
//! discovery follows smol's BUILDING.md: Espressif vendor `303a:`, then the MAC in `HELLO`,
//! never the ttyACM number.
use std::io::{BufRead, BufReader, Write};
use std::sync::mpsc;
use std::time::Duration;

use super::lines::{GwLine, parse, ping_line, tx_line};
use super::{Link, Rx};

pub const ESPRESSIF_VID: u16 = 0x303a;

pub struct SerialLink {
    tx: Box<dyn Write + Send>,
    rx: mpsc::Receiver<GwLine>,
    next_id: u32,
    pub logs: Vec<String>,
    pub hello: Option<GwLine>,
}

impl SerialLink {
    /// Open a known path (a PTY in tests, or a port `discover` chose).
    pub fn open_path(path: &str) -> std::io::Result<SerialLink> {
        let port = serialport::new(path, 115_200).timeout(Duration::from_millis(50)).open().map_err(std::io::Error::other)?;
        let reader = port.try_clone().map_err(std::io::Error::other)?;
        let (send, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut r = BufReader::new(reader);
            let mut line = String::new();
            loop {
                line.clear();
                match r.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        if send.send(parse(&line)).is_err() {
                            break;
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
                    Err(_) => break,
                }
            }
        });
        Ok(SerialLink { tx: Box::new(port), rx, next_id: 0, logs: Vec::new(), hello: None })
    }

    /// Find the gateway whose `HELLO` carries `mac` among Espressif USB ports.
    pub fn discover(mac: &str) -> Result<(String, SerialLink), String> {
        let ports = serialport::available_ports().map_err(|e| e.to_string())?;
        for p in ports {
            let serialport::SerialPortType::UsbPort(info) = &p.port_type else { continue };
            if info.vid != ESPRESSIF_VID {
                continue; // e.g. katana's ttyACM1 is a keyboard (1209:2201)
            }
            let Ok(mut link) = SerialLink::open_path(&p.port_name) else { continue };
            let _ = link.tx.write_all(ping_line().as_bytes());
            let deadline = std::time::Instant::now() + Duration::from_secs(2);
            while std::time::Instant::now() < deadline {
                if let Ok(GwLine::Hello { mac: m, .. }) = link.rx.recv_timeout(Duration::from_millis(100)) {
                    if m.eq_ignore_ascii_case(mac) {
                        return Ok((p.port_name.clone(), link));
                    }
                    break;
                }
            }
        }
        Err(format!("no Espressif USB port answered with MAC {mac}"))
    }
}

impl Link for SerialLink {
    fn send(&mut self, dst: u8, frame: &[u8]) {
        self.next_id = self.next_id.wrapping_add(1);
        let _ = self.tx.write_all(tx_line(self.next_id, dst, frame).as_bytes());
    }

    fn poll(&mut self, _now: u64) -> Vec<Rx> {
        let mut out = Vec::new();
        while let Ok(l) = self.rx.try_recv() {
            match l {
                GwLine::Rx { src, rssi, mac_ok, bytes } => out.push(Rx { src, rssi, mac_ok, bytes }),
                GwLine::Log(s) => self.logs.push(s),
                h @ GwLine::Hello { .. } => self.hello = Some(h),
                GwLine::TxErr(id, why) => self.logs.push(format!("tx {id} failed: {why}")),
                GwLine::TxOk(_) | GwLine::Roster(_) => {}
            }
        }
        out
    }
}
```

A frame with `mac_ok = 0` is still delivered, flagged. The group-MAC is in observe mode fleet-wide
(protocol §7), so dropping unverified frames would drop every frame today. The core logs a count of
them; enforcing is a config switch for the day smol enforces.

> **Execution note (2026-09-23).** The PTY test also checks that a frame with `mac_ok = 0` is delivered and
> flagged (the paragraph below claims it, and no test did). Perturbations (perturb-task22-lines.py and -serial.py):
> the plan's odd-hex case stays a log line with the length check removed (expected green); ROSTER split at the
> first colon turns the codec test red; bad RX hex decoded as empty bytes turns the near-miss test red; every line
> sent as a Log turns the PTY test red (0 frames); `poll` dropping unverified frames turns it red. The count of
> unverified frames the paragraph below promises is kept by Task 24's binary (`unverified`, logged at powers of two).

- [ ] **Step 6: Run and commit**

Run: `cargo test -p tapstone-arena --test lines --test serial_pty` → PASS.
Perturbation: in the reader thread, `send` every line as `GwLine::Log` → the PTY test goes red
(0 frames); restore.

```bash
git add rust/tapstone-arena/src/link/lines.rs rust/tapstone-arena/src/link/serial.rs rust/tapstone-arena/tests/lines.rs rust/tapstone-arena/tests/serial_pty.rs
git commit -m "feat(arena): @TS1 gateway line protocol and serial link, found by vendor and MAC (D6-D8)"
```

---

## Task 23: The poster — drain the outbox, never on the lobby path

**Files:**
- Create: `rust/tapstone-arena/src/poster.rs`, `rust/tapstone-arena/tests/poster.rs`
- Modify: `rust/tapstone-arena/src/lib.rs` (`pub mod poster;`)

- [ ] **Step 1: Write the failing test**

`rust/tapstone-arena/tests/poster.rs`:

```rust
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use axum::Router;
use axum::http::StatusCode;
use axum::routing::post;
use tapstone_arena::ledger::Ledger;
use tapstone_arena::poster::{Sink, drain_once};

async fn flaky_server(fail_first: u32) -> (SocketAddr, Arc<AtomicU32>) {
    let hits = Arc::new(AtomicU32::new(0));
    let h = hits.clone();
    let app = Router::new().route(
        "/tapstone/match/{id}",
        post(move || {
            let h = h.clone();
            async move {
                let n = h.fetch_add(1, Ordering::SeqCst);
                if n < fail_first { StatusCode::SERVICE_UNAVAILABLE } else { StatusCode::OK }
            }
        }),
    );
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    (addr, hits)
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failed_post_backs_off_and_a_later_one_completes() {
    let (addr, hits) = flaky_server(1).await;
    let dir = tempfile::tempdir().unwrap();
    let mut l = Ledger::open(&dir.path().join("l.sqlite")).unwrap();
    l.enqueue("scry", 0xA1, b"TSX1", "application/vnd.tapstone.tsx1", 100).unwrap();
    let sinks = vec![Sink { name: "scry".into(), url: format!("http://{addr}/tapstone/match/{{id}}?k=tok"), enabled: true }];
    let l = tokio::task::spawn_blocking(move || {
        assert_eq!(drain_once(&mut l, &sinks, 100), (0, 1), "first attempt fails");
        assert_eq!(drain_once(&mut l, &sinks, 100), (0, 0), "backing off: not due yet");
        assert_eq!(drain_once(&mut l, &sinks, 101), (1, 0), "second attempt lands");
        l
    })
    .await
    .unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    assert!(l.due(1_000_000).unwrap().is_empty());
}

#[test]
fn an_unreachable_or_disabled_sink_leaves_its_rows_queued() {
    let dir = tempfile::tempdir().unwrap();
    let mut l = Ledger::open(&dir.path().join("l.sqlite")).unwrap();
    l.enqueue("realm", 1, b"{}", "application/json", 0).unwrap();
    let sinks = vec![Sink { name: "realm".into(), url: "http://127.0.0.1:9/x".into(), enabled: false }];
    assert_eq!(drain_once(&mut l, &sinks, 0), (0, 0), "disabled: not even tried");
    let sinks = vec![Sink { name: "realm".into(), url: "http://127.0.0.1:9/x".into(), enabled: true }];
    assert_eq!(drain_once(&mut l, &sinks, 0), (0, 1), "port 9 refuses: failure, row kept");
    assert_eq!(l.due(10_000).unwrap().len(), 1);
}
```

- [ ] **Step 2: Run to watch it fail**

Run: `cargo test -p tapstone-arena --test poster` → FAIL to compile.

- [ ] **Step 3: Implement**

`rust/tapstone-arena/src/poster.rs`:

```rust
//! Transcript posting (spec §10, D14). Synchronous and called from a blocking task, never from the
//! core or the lobby. A sink that is down, asleep or not yet implemented keeps its rows.
use std::time::Duration;

use serde::Deserialize;

use crate::ledger::Ledger;

#[derive(Debug, Clone, Deserialize)]
pub struct Sink {
    pub name: String,
    /// `{id}` is replaced with the 8-hex match id.
    pub url: String,
    #[serde(default)]
    pub enabled: bool,
}

/// Try every due row once. Returns `(delivered, failed)`.
pub fn drain_once(l: &mut Ledger, sinks: &[Sink], now: i64) -> (u32, u32) {
    let Ok(rows) = l.due(now) else { return (0, 0) };
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(5)).build();
    let (mut ok, mut bad) = (0, 0);
    for row in rows {
        let Some(sink) = sinks.iter().find(|s| s.name == row.sink && s.enabled) else { continue };
        let url = sink.url.replace("{id}", &row.match_id);
        match agent.post(&url).set("Content-Type", &row.content_type).send_bytes(&row.body) {
            Ok(r) if (200..300).contains(&r.status()) => {
                let _ = l.done(row.id, now);
                ok += 1;
            }
            _ => {
                let _ = l.retry(row.id, now);
                bad += 1;
            }
        }
    }
    (ok, bad)
}

/// What a finished match puts in the outbox, one row per sink kind (spec §10).
pub fn enqueue_match(l: &mut Ledger, match_id: u32, tsx1: &[u8], json: &tapstone_sim::Transcript, now: i64) -> rusqlite::Result<()> {
    l.enqueue("scry", match_id, tsx1, "application/vnd.tapstone.tsx1", now)?;
    let body = serde_json::to_vec(json).unwrap_or_default();
    l.enqueue("realm", match_id, &body, "application/json", now)
}
```

> **Execution note (2026-09-23).** A third test, `a_finished_match_queues_one_row_per_sink`, covers
> `enqueue_match`, which nothing tested. Perturbations (perturb-task23.py), each red: a 503 counts as done (the plan's);
> a disabled sink is tried; scry's row gets the JSON content type. **For Task 24:** a sink URL carries its token in
> the query (`?k=…`), so the config loads it from the vault (`bw`), and nothing may log a sink URL.

- [ ] **Step 4: Run and commit**

Run: `cargo test -p tapstone-arena --test poster` → 3 passed.
Perturbation: mark a row done on any response, including 503 → the first test goes red (1 hit,
not 2); restore.

```bash
git add rust/tapstone-arena/src/lib.rs rust/tapstone-arena/src/poster.rs rust/tapstone-arena/tests/poster.rs
git commit -m "feat(arena): outbox poster with backoff, off the lobby path (spec §10, D14)"
```

---

## Task 24: Config, wiring and the binary

**Files:**
- Create: `rust/tapstone-arena/src/config.rs`, `rust/tapstone-arena/src/main.rs`, `rust/tapstone-arena/tests/config.rs`
- Modify: `rust/tapstone-arena/src/lib.rs` (`pub mod config;`)

- [ ] **Step 1: Write the failing config test**

`rust/tapstone-arena/tests/config.rs`:

```rust
use tapstone_arena::config::Config;

#[test]
fn defaults_bind_loopback_on_7790_and_no_key_can_be_configured() {
    let c: Config = toml::from_str(r#"gateway_mac = "ac:a7:04:b9:77:14""#).unwrap();
    assert_eq!(c.http_bind, "127.0.0.1:7790");
    assert!(c.sinks.is_empty());
    // Spec §17 default 3: no fleet group key on the arena in playtest one. Neither a key value nor a
    // key file parses, so a key cannot be configured by accident.
    assert!(toml::from_str::<Config>("gateway_mac = \"x\"\ngroup_key = \"secret\"").is_err());
    assert!(toml::from_str::<Config>("gateway_mac = \"x\"\ngroup_key_file = \"/k\"").is_err());
}

#[test]
fn the_default_ledger_follows_xdg_and_never_tmp() {
    let p = tapstone_arena::config::default_ledger();
    assert!(p.ends_with("tapstone/ledger.sqlite"), "{}", p.display());
    assert!(!p.starts_with("/tmp") && !p.starts_with("/var/tmp"), "{}", p.display());
}
```

- [ ] **Step 2: Run to watch it fail, then implement**

`rust/tapstone-arena/src/config.rs`:

```rust
//! `~/.config/tapstone-arena/arena.toml` (spec §11). Secrets are FILES (0600, populated from
//! Vaultwarden with `bw`); a secret value written into the TOML is a parse error.
use std::path::PathBuf;

use serde::Deserialize;

use crate::poster::Sink;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub gateway_mac: String,
    #[serde(default = "default_bind")]
    pub http_bind: String,
    #[serde(default)]
    pub ledger_path: Option<PathBuf>,
    #[serde(default)]
    pub registry_path: Option<PathBuf>,
    #[serde(default)]
    pub decks_dir: Option<PathBuf>,
    #[serde(default)]
    pub flat: bool,
    #[serde(default)]
    pub sinks: Vec<Sink>,
    /// Token files per sink name, e.g. `scry = "~/.config/tapstone-arena/scry.token"`.
    #[serde(default)]
    pub token_files: std::collections::BTreeMap<String, PathBuf>,
}

fn default_bind() -> String {
    "127.0.0.1:7790".into()
}

pub fn default_path() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join(".config/tapstone-arena/arena.toml")
}

/// `$XDG_DATA_HOME/tapstone/ledger.sqlite`, else `~/.local/share/tapstone/ledger.sqlite`: never the
/// repo, never /tmp (spec §8, §17 default 1).
pub fn default_ledger() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let base = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(|| home.join(".local/share"));
    base.join("tapstone/ledger.sqlite")
}
```

(`deny_unknown_fields` is what refuses both key fields.)

There is **no signer module in playtest one** (spec §11, §17 default 3). The core's `Signer` trait
and its `Unsigned` implementation (Task 9) are all that exists, and RESULT goes out with
`sig_kind = 0`. For the record, here is the signer that will replace `Unsigned` once JP rules on
keys together with the 424 DNA work. **Do not add it now**, and do not add `hmac` to the manifest.

```rust
// FUTURE, not part of this plan: rust/tapstone-arena/src/signer.rs
//! RESULT signatures (protocol §7, `sig_kind = 1`): HMAC-SHA256 with the fleet group key over
//! `transcript_sha ‖ match ‖ winner ‖ reason`. Without a key file the arena signs nothing
//! (`sig_kind = 0`, spec §17 question 3).
use hmac::{Hmac, Mac};
use sha2::Sha256;
use tapstone_proto::frame::MatchResult;

use crate::core::Signer;

pub struct GroupHmac(pub Vec<u8>);

impl Signer for GroupHmac {
    fn sign(&self, r: &MatchResult, match_id: u32) -> (u8, [u8; 64]) {
        let mut m = <Hmac<Sha256> as Mac>::new_from_slice(&self.0).expect("any key length");
        m.update(&r.transcript_sha);
        m.update(&match_id.to_le_bytes());
        m.update(&[r.winner, r.reason]);
        let tag = m.finalize().into_bytes();
        let mut sig = [0u8; 64];
        sig[..32].copy_from_slice(&tag);
        (1, sig)
    }
}
```

Run: `cargo test -p tapstone-arena --test config` → PASS. Perturbation: add
`#[serde(default)] pub group_key_file: Option<PathBuf>,` back to `Config` → the no-key test goes
red; restore.

- [ ] **Step 3: Two core helpers the binary needs (test first)**

Append to `rust/tapstone-arena/tests/core_lobby.rs`:

```rust
#[test]
fn the_core_names_each_seats_node_once_seated() {
    let mut net = Net::new(1, 0.0, 0.0);
    assert_eq!(net.core.seat_node(0), None, "lobby: nobody is seated yet");
    net.step(); // shrine 0 claims; the match has not started
    assert_eq!(net.core.seated(), vec![NODES[0]], "one claim held");
    assert_eq!(net.core.seat_node(0), None, "a claim in the lobby is not a seat in a match");
    for _ in 0..10 {
        net.step();
    }
    assert_eq!((net.core.seat_node(0), net.core.seat_node(1), net.core.seat_node(2)), (Some(NODES[0]), Some(NODES[1]), None));
}
```

Run it red, then add to `impl ArenaCore` in `core/mod.rs`:

```rust
    /// The arena's own node id (the gateway's).
    pub fn node(&self) -> u8 {
        self.cfg.node
    }

    /// The mesh node sitting in `seat`, while a match runs. A dev-route tap is fed to the core as
    /// if that node had sent it, so the dev path and the real path are one path.
    pub fn seat_node(&self, seat: u8) -> Option<u8> {
        match &self.table {
            Table::Match(m) => m.nodes.get(seat as usize).copied(),
            Table::Lobby(_) => None,
        }
    }
```

Run it green.

- [ ] **Step 4: The binary**

`rust/tapstone-arena/src/main.rs`:

```rust
//! `tapstone-arena` — run the arena for one table.
//!   tapstone-arena                 # gateway on USB serial, config from ~/.config/tapstone-arena
//!   tapstone-arena --desk          # two scripted shrines in process, no radio (spec §9)
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use clap::Parser;
use tapstone_arena::config::{Config, default_ledger, default_path};
use tapstone_arena::core::{ArenaCore, CoreConfig, Input, Output, Signer, StatsSource, Unsigned};
use tapstone_arena::decks::DeckBook;
use tapstone_arena::http::{AppState, DevCmd, router};
use tapstone_arena::ledger::Ledger;
use tapstone_arena::link::Link;
use tapstone_arena::link::desk::{ARENA_NODE, DeskLink};
use tapstone_arena::link::lines::GwLine;
use tapstone_arena::link::serial::SerialLink;
use tapstone_arena::poster::{Sink, drain_once, enqueue_match};
use tapstone_arena::registry::Registry;
use tapstone_proto::frame::{FRAME_MAX, Frame, Header, Tap};
use tapstone_rules::{Kind, Record};
use tokio::sync::{mpsc, watch};

#[derive(Parser)]
struct Cli {
    #[arg(long)]
    config: Option<PathBuf>,
    /// Two scripted shrines in process; no gateway, no ledger file.
    #[arg(long)]
    desk: bool,
    #[arg(long, default_value_t = 11)]
    desk_seed: u64,
    /// Append every view the board is sent to this file, one JSON line each (a canvas fixture).
    #[arg(long)]
    record: Option<PathBuf>,
    /// Exit after the first match ends and its RESULT linger closes.
    #[arg(long)]
    once: bool,
}

/// Everything one table needs, built for desk or gateway mode.
struct Parts {
    link: Box<dyn Link>,
    core: ArenaCore,
    /// The ledger and its path (the poster opens its own connection to the same file).
    ledger: Option<(Ledger, PathBuf)>,
    bind: String,
    sinks: Vec<Sink>,
    /// Frames the core produced before the loop started (recovery's `J`).
    pending: Vec<(u8, Vec<u8>)>,
}

fn unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn desk_parts(seed: u64) -> Parts {
    let (link, book, stats) = DeskLink::new(seed);
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
        link: Box::new(link),
        core,
        ledger: None,
        bind: "127.0.0.1:7790".into(),
        sinks: vec![],
        pending: vec![],
    }
}

fn gateway_parts(path: PathBuf) -> Result<Parts, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let cfg: Config = toml::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    let (port, link) = SerialLink::discover(&cfg.gateway_mac)?;
    let Some(GwLine::Hello { node, .. }) = link.hello.clone() else {
        return Err("the gateway sent no HELLO".into());
    };
    println!("gateway {} on {port}, node {node}", cfg.gateway_mac);
    let registry_path = cfg
        .registry_path
        .clone()
        .unwrap_or_else(|| PathBuf::from("registry/copies.jsonl"));
    let registry = Registry::load(&registry_path)?;
    let book = DeckBook::load_repo()?;
    // Spec §11: RESULT is unsigned in playtest one (sig_kind 0), a recorded known gap.
    let signer: Box<dyn Signer + Send> = Box::new(Unsigned);
    let ledger_path = cfg.ledger_path.clone().unwrap_or_else(default_ledger);
    let sinks: Vec<Sink> = cfg
        .sinks
        .iter()
        .cloned()
        .map(|mut s| {
            if let Some(t) = cfg
                .token_files
                .get(&s.name)
                .and_then(|p| std::fs::read_to_string(p).ok())
            {
                s.url = s.url.replace("{token}", t.trim());
            }
            s
        })
        .collect();
    // Two connections to one WAL file: the core's StatsSource reads and equips; the loop journals
    // and applies results. busy_timeout=5000 covers their overlap.
    let stats: Box<dyn StatsSource + Send> =
        Box::new(Ledger::open(&ledger_path).map_err(|e| e.to_string())?);
    let ledger = Ledger::open(&ledger_path).map_err(|e| e.to_string())?;
    let hash = env!("ARENA_GIT_HASH");
    let core_cfg = CoreConfig {
        node,
        rules: Default::default(),
        ruleset: u32::from_str_radix(hash, 16).unwrap_or(0),
        registry_id: 0,
        flat: cfg.flat,
        epoch_unix: unix() as u32,
    };
    let mut pending = Vec::new();
    let core = match ledger.in_flight().map_err(|e| e.to_string())? {
        Some(rec) => {
            println!("resuming match {:08x} from the journal", rec.match_id);
            let (core, out) = ArenaCore::recover(core_cfg, stats, book, registry, signer, rec, 0);
            for o in out {
                if let Output::Send { dst, frame } = o {
                    pending.push((dst, frame));
                }
            }
            core
        }
        None => ArenaCore::new(core_cfg, stats, book, registry, signer),
    };
    Ok(Parts {
        link: Box::new(link),
        core,
        ledger: Some((ledger, ledger_path)),
        bind: cfg.http_bind.clone(),
        sinks,
        pending,
    })
}

/// A dev-route tap, as a `T` frame from the seat's own node (one path for dev and real taps).
fn dev_tap_frame(core: &ArenaCore, cmd: &DevCmd, lseq: u16) -> Option<(u8, Vec<u8>)> {
    let DevCmd::Tap {
        seat,
        kind,
        card,
        lane,
        target,
        aux,
    } = cmd
    else {
        return None;
    };
    let node = core.seat_node(*seat)?;
    let kind = match kind.as_str() {
        "Mulligan" => Kind::Mulligan,
        "Charge" => Kind::Charge,
        "CastUnit" => Kind::CastUnit,
        "CastSpell" => Kind::CastSpell,
        "Advance" => Kind::Advance,
        "Pass" => Kind::Pass,
        _ => return None,
    };
    let record = Record {
        seq: 0,
        seat: *seat,
        kind,
        card: *card,
        lane: *lane,
        target: *target,
        aux: *aux,
        time_ms: 0,
        uid: [0; 7],
        auth: 0,
    };
    let mut buf = [0u8; FRAME_MAX];
    let n = Frame::Tap(Tap::Propose { lseq, record }).encode(
        &Header {
            match_id: 0,
            src: node,
        },
        &mut buf,
    );
    Some((node, buf[..n].to_vec()))
}

#[tokio::main]
async fn main() -> Result<(), String> {
    let cli = Cli::parse();
    tapstone_arena::version::mark_started();
    let mut parts = if cli.desk {
        desk_parts(cli.desk_seed)
    } else {
        gateway_parts(cli.config.unwrap_or_else(default_path))?
    };
    for (dst, frame) in parts.pending.drain(..) {
        parts.link.send(dst, &frame);
    }

    let (view_tx, view_rx) =
        watch::channel(serde_json::to_string(&parts.core.view()).unwrap_or_default());
    let (dev_tx, mut dev_rx) = mpsc::channel::<DevCmd>(16);
    let app = router(AppState {
        views: view_rx,
        dev: dev_tx,
    });
    let listener = tokio::net::TcpListener::bind(&parts.bind)
        .await
        .map_err(|e| format!("{}: {e}", parts.bind))?;
    println!("board at http://{}/", parts.bind);
    tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await;
    });

    let t0 = Instant::now();
    let mut tick = tokio::time::interval(Duration::from_millis(10));
    let mut last_drain = 0u64;
    let mut dev_lseq = 10_000u16; // dev taps use their own lseq range
    let mut unverified = 0u64;
    let mut desk_seed = cli.desk_seed;
    let mut record = match &cli.record {
        Some(p) => Some(std::fs::File::create(p).map_err(|e| format!("{}: {e}", p.display()))?),
        None => None,
    };
    let mut over_seen = false;
    loop {
        tick.tick().await;
        let now = t0.elapsed().as_millis() as u64;
        let mut inputs: Vec<Input> = parts
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
        while let Ok(cmd) = dev_rx.try_recv() {
            match &cmd {
                DevCmd::Desk if cli.desk => {
                    desk_seed += 1;
                    parts = desk_parts(desk_seed);
                    println!("[dev] new desk match, seed {desk_seed}");
                }
                DevCmd::Desk => println!("[dev] a desk match needs --desk"),
                DevCmd::Tap { .. } => {
                    dev_lseq = dev_lseq.wrapping_add(1);
                    match dev_tap_frame(&parts.core, &cmd, dev_lseq) {
                        Some((src, bytes)) => inputs.push(Input::Frame {
                            src,
                            rssi: 0,
                            mac_ok: true,
                            bytes,
                        }),
                        None => println!("[dev] {cmd:?}: no seated node or unknown kind"),
                    }
                }
            }
        }
        inputs.push(Input::Tick);
        for input in inputs {
            // Tap-to-board, arena side (plan-1's 300 ms; spec §13): from handing a T to the core to
            // publishing the view it caused. The radio leg is added at the table.
            let is_tap =
                matches!(&input, Input::Frame { bytes, .. } if bytes.get(14) == Some(&b'T'));
            if let Input::Frame { mac_ok: false, .. } = &input {
                unverified += 1;
                if unverified.is_power_of_two() {
                    println!(
                        "{unverified} frames without a verified group-MAC (observe mode, protocol §7)"
                    );
                }
            }
            let t_in = Instant::now();
            for o in parts.core.handle(input, now) {
                if is_tap && matches!(o, Output::View(_)) {
                    println!("tap→view {} µs", t_in.elapsed().as_micros());
                }
                match o {
                    // D10: outputs run in order, so a commit is journaled before it is sent.
                    Output::Journal(j) => {
                        if let Some((l, _)) = parts.ledger.as_mut() {
                            l.journal(&j).map_err(|e| format!("journal: {e}"))?;
                        }
                    }
                    Output::Send { dst, frame } => parts.link.send(dst, &frame),
                    Output::View(v) => {
                        let json = serde_json::to_string(&v).unwrap_or_default();
                        if let Some(f) = record.as_mut() {
                            use std::io::Write;
                            writeln!(f, "{json}").map_err(|e| format!("record: {e}"))?;
                        }
                        let _ = view_tx.send(json);
                    }
                    Output::MatchOver(m) => {
                        println!("match {:08x} over, winner {:?}", m.match_id, m.winner);
                        over_seen = true;
                        if let Some((l, _)) = parts.ledger.as_mut() {
                            let ev = l
                                .apply_result(m.match_id, &m.result, m.figurines, m.winner, m.round)
                                .map_err(|e| e.to_string())?;
                            println!("ledger: {ev:?}");
                            enqueue_match(l, m.match_id, &m.tsx1, &m.json, unix() as i64)
                                .map_err(|e| e.to_string())?;
                            // Spec §8: a backup after every result; this file is JP's commanders.
                            if let Err(e) = l.backup(m.match_id, 20) {
                                println!("ledger backup failed: {e}");
                            }
                            // The stations' result screens (0032) read the new XP, level and
                            // inventory from a fresh D, one per seat.
                            for seat in 0..2u8 {
                                if let Some(doll) =
                                    StatsSource::doll(l, m.figurines[seat as usize], seat)
                                {
                                    let mut buf = [0u8; FRAME_MAX];
                                    let n = Frame::Doll(doll).encode(
                                        &Header {
                                            match_id: m.match_id,
                                            src: parts.core.node(),
                                        },
                                        &mut buf,
                                    );
                                    parts.link.send(m.nodes[seat as usize], &buf[..n]);
                                }
                            }
                        }
                    }
                    Output::Log(s) => println!("{s}"),
                }
            }
        }
        if cli.once && over_seen && !parts.core.lingering() {
            println!("--once: the match is over and delivered");
            return Ok(());
        }
        // Drain the outbox on a blocking thread every 5 s, so a slow or asleep sink can never
        // stall the arbiter (spec D14).
        if let Some((_, path)) = parts.ledger.as_ref()
            && !parts.sinks.is_empty()
            && now - last_drain >= 5_000
        {
            last_drain = now;
            let (path, sinks) = (path.clone(), parts.sinks.clone());
            tokio::task::spawn_blocking(move || {
                if let Ok(mut l) = Ledger::open(&path) {
                    drain_once(&mut l, &sinks, unix() as i64);
                }
            });
        }
    }
}
```

Sink URLs carry the scry token inline (`?k=…`) in v1, read from the token file at start-up. To do
that, `gateway_parts` rewrites each sink's `url`, replacing `{token}` with the trimmed contents of
`cfg.token_files[&sink.name]` when one is configured. Add these three lines right after
`let ledger_path = …`:

```rust
    let sinks: Vec<Sink> = cfg.sinks.iter().cloned().map(|mut s| {
        if let Some(t) = cfg.token_files.get(&s.name).and_then(|p| std::fs::read_to_string(p).ok()) { s.url = s.url.replace("{token}", t.trim()); }
        s
    }).collect();
```

and pass `sinks` (not `cfg.sinks.clone()`) into `Parts`. An example config for the README:

```toml
gateway_mac = "ac:a7:04:b9:77:14"
[[sinks]]
name = "scry"
url = "http://ubox0:7787/tapstone/match/{id}?k={token}"
enabled = true
[token_files]
scry = "/home/user/.config/tapstone-arena/scry.token"
```

> **Execution note (2026-09-23).** The binary above is as shipped. It includes the token rewrite, plus `--record <file>`
> (every view as a JSON line) and `--once` (exit once the first match is over and its linger closed), which produce
> the canvas fixture `web/fixtures/desk-seed11.jsonl` from a real desk match: `cargo run -p tapstone-arena -- --desk
> --desk-seed 11 --record tapstone-arena/web/fixtures/desk-seed11.jsonl --once`. That gave 79 views: 77 playing, rounds
> 0–6, owed draws 0–6, 112 commander cells, ending in the lobby with `last_over`. `seat_node` is built on `seated()`,
> and its test also pins "a claim in the lobby is not a seat" (a lobby-answering perturbation left the first draft
> green). Measured: arena-side tap→view is 72–530 µs, against the 300 ms budget. **Task 20's by-eye check, done here**
> with headless Chrome screenshots of `/` and `/?seat=0` in both themes (lane scratch `canvas-check/`): the seat bands
> are on the right sides, the commander carries ♛ with a thick rim, `?seat=0` shows chips for seat 1, and "Seat 0 wins"
> shows after the result. Findings for the canvas owner: the inactive band's text is low-contrast in both themes, and
> the lane labels overlap the cell borders. The strike flash and the unreachable status line cannot be checked from a
> still.

> **Follow-up (2026-09-23, the lead after #78, item F).** `default_ledger()` became `ledger_path(explicit)` over a
> pure `resolve_ledger(explicit, xdg, home)`: `$XDG_DATA_HOME/tapstone/ledger.sqlite`, else `~/.local/share/…`, with a
> relative XDG ignored, and **refused under `/tmp` or `/var/tmp`** by path component, whether from XDG or from an
> explicit `ledger_path` (JP's rule). The binary exits with the reason. Test
> `the_ledger_path_resolves_from_xdg_and_refuses_tmp`, with perturbations: no guard, a string-prefix guard (the
> `/tmpfoo` case) and a relative XDG honoured each turn it red. The code blocks above keep the first draft's
> `default_ledger` for the record.

- [ ] **Step 5: Run it**

Run: `cargo run -p tapstone-arena -- --desk`
Expected: `board at http://127.0.0.1:7790/`; `xdg-open http://127.0.0.1:7790/` shows a desk match
playing; the terminal prints `match … over`. Run: `cargo run -p tapstone-arena` with no config:
it exits with `…/arena.toml: No such file or directory`, a non-zero status and no panic.

- [ ] **Step 6: Commit**

```bash
git add rust/tapstone-arena/src/lib.rs rust/tapstone-arena/src/config.rs rust/tapstone-arena/src/main.rs rust/tapstone-arena/src/core/mod.rs rust/tapstone-arena/tests/config.rs rust/tapstone-arena/tests/core_lobby.rs
git commit -m "feat(arena): config and the binary (desk and gateway mode); RESULT unsigned in playtest one"
```

---

## Task 25: Documents — the protocol draft, the README, and the cross-repo issues

**Files:**
- Modify: `docs/protocol/tapstone-protocol-draft.md`, `rust/README.md`, `CLAUDE.md`
- Create: `docs/protocol/arena-issues.md`

- [ ] **Step 1: Protocol draft**

Make these edits, each citing the arena spec:
- §2 frame table: add rows `D` DOLL (arena → shrine, 43), `E` EQUIP (shrine → arena, 11), `H`
  HANDBACK (shrine → arena, ≤197), `K` HANDBACK-NAK (arena → shrine, 10); change `C` to 36 with the
  field order `mseq 2 · lseq 2 · record 24 · hash 8`; give `R` the `sig_kind 0` (45 B) option.
- §4.1: `flags` bit3 = arena (set only by the arena).
- §4.2: a boxed amendment: under 0028, pairing goes through the arena. Seats are assigned in claim
  order (castle-figurine tap), the arena assigns `match`, and the first-claimed shrine is the
  recovery arbiter (0006, 0029). Link arena spec §5.1.
- §4.5: the hand-back is `H`/`K` (arena spec §6.3, §7).
- §6: the header is **36 B** (the listed fields sum to 36; the "32 B" label was an arithmetic slip).
  Replace the JSON example with a pointer to `tapstone-sim`'s `Transcript` (the goldens' shape) and
  note that the old example's `lseq`/`g`/`intent` fields were superseded on 2026-09-20.
- §8 item 4: nothing (already `fall:return`).

Add a test that reads the draft and asserts the four new kinds, `C`'s 36, and TSX1's 36 appear,
next to the existing document test in `tapstone-rules/tests/commander.rs`, but in
`tapstone-proto/tests/frame.rs`, with the numbers taken from the codec constants (the
document-quoting rule). Perturb it by writing "34" back into the `C` row; it must go red.

> **Execution note (2026-09-23).** `H` is ≤201 B, not the ≤197 above: Task 14's per-seat `last_lseq` adds 4 B. The
> document test `the_protocol_draft_quotes_the_codecs_sizes` measures every size by encoding a frame (a full six-record
> `H`, an unsigned `R`), never from a typed number, and checks `C`, `D`, `E`, `H`, `K`, `R` and TSX1's 36 B.
> Perturbations: "34" back in the `C` row goes red, naming the cell; "Header 32 B" back in §6 goes red. The README
> lists all seven workspace crates, including the shrine lane's two, from their own `Cargo.toml` descriptions.
> **Hardened after Oracle's review of #84:** the test reads each cell's TOTAL per variant (after the last `=`, else the
> leading number), so an incidental number can no longer match. It checks every §2 kind the codec implements
> (only `P`, the arena-less fallback with no codec, is excluded, by name) and the frame and on-air columns. It
> found two stale rows: `T` (15–36, where the codec encodes 27 and 4) and `S` (whose `= ≤206` total is now explicit).

- [ ] **Step 2: `docs/protocol/arena-issues.md`** (ready-to-paste, the smol-issues.md format)

```markdown
# Issues the arena needs in other repos — ready to paste

## smol: a Tapstone gateway app (USB serial ⇄ MATCH frames)
**Why:** the Tapstone arena (tapstone docs/superpowers/specs/2026-09-23-arena-service-design.md
§4) arbitrates every match from a laptop and reaches the mesh through one smol node on USB. smol
has no USB-serial gateway today (the "gateway" is the WiFi crown).
**What:** an app for any USB-capable target (C3 or S3) that
- joins the mesh as a normal node with WiFi off (it must never be the crown: a crown's WiFi burst
  deafens it for up to ~15 s, protocol draft §1);
- forwards every received `SMOLv1 MATCH ` frame to USB-Serial-JTAG as
  `@TS1 RX <src> <rssi> <mac_ok 0|1> <hex>` (trailer stripped; `mac_ok` from the #190 check);
- sends `@TS1 TX <id> <dst|255> <hex>` via `send_to` / `send_to_id` (issues #1, #5), answering
  `@TS1 TXOK <id>` or `@TS1 TXERR <id> <reason>`;
- prints `@TS1 HELLO <mac> <node_id> <fw_hash8> <group_epoch>` at boot and on `@TS1 PING`, and
  `@TS1 ROSTER <id>:<mac>:<rssi>,…` every 2 s;
- keeps printing its normal logs: the arena ignores any line without `@TS1 `.
RX follows c6-watch's debug console (RX-only HAL, TX via `println!`).
**Acceptance:** with the arena's PTY test as the model, a bench run where a second node's MATCH
frames appear as `RX` lines within 20 ms and a `TX` line reaches that node, verified by its log.

## scry.realm.watch: accept Tapstone transcripts
**Why:** 0016 posts every transcript to scry-glass. The route exists only in the protocol draft.
**What:** `POST /tapstone/match/<id>?k=<HMAC(secret,"tapstone-arena")[:12]>`, body = binary TSX1
(`application/vnd.tapstone.tsx1`, header 36 B + 32 B records). Verify the token as `/tap/` does,
store the body, and publish `tapstone/match/<id>` retained on Mosquitto with the JSON rendering.
**Acceptance:** a posted transcript from `tapstone-arena --desk` appears on MQTT; a wrong `k` is 403.

## realmwatch: accept Tapstone transcripts into realm-engine
**Why:** 0030 keeps realm-engine's player records as a derived mirror of posted transcripts.
**What:** `POST /realm-engine/transcript`, body = the JSON rendering (tapstone-sim `Transcript`).
Ingest through `ingest_event(... event_type="tapstone.match" ...)`, deduped by match id. It is
never read by a lobby.
**Acceptance:** re-posting the same transcript does not duplicate the event.
```

- [ ] **Step 3: README and CLAUDE.md**

`rust/README.md`: add the three crates to the opening list, the two new gate lines
(`cargo build -p tapstone-proto --target thumbv7em-none-eabi`, `… tapstone-progression …`,
`../tools/compile_items.py --check`), a "The arena" section with the `--desk` command and the config
file path, and a "Vendoring" note that `tapstone-proto` vendors next to `tapstone-rules`. In
`CLAUDE.md` "Read first", add the arena spec and plan.

- [ ] **Step 4: Run the gates and commit**

Run the full gates list from the top of this plan. Expected: all green.

```bash
git add docs/protocol/tapstone-protocol-draft.md docs/protocol/arena-issues.md rust/README.md CLAUDE.md rust/tapstone-proto/tests/frame.rs
git commit -m "docs: protocol rows for D/E/H/K, the §4.2 arena amendment, TSX1 at 36 B, arena issues"
```

---

## Task 26: The table checklist (manual, needs hardware, Task 11b and the gateway app)

Not code. It is the acceptance run of spec §1 at the table, **after** Task 11b has landed (0036's
engine change is on main since #63) and the smol gateway app exists. Record results in `docs/playtest/plan-1.md`'s measures.

- [ ] `tapstone-arena` finds the gateway by MAC on katana with the Dygma keyboard plugged in
  (`ttyACM1 = 1209:2201` must be skipped).
- [ ] Two shrines claim with castle figurines; the canvas shows both commanders in lane 2's back
  cells (the middle lane, displayed as "lane 2").
- [ ] Opening hands are drawn by tapping (0036): each shrine prompts "draw N — tap it on the stone",
  the canvas's hand counts rise tap by tap, and re-tapping an already drawn card is refused with the
  copy-drawn reason.
- [ ] A full Duel ends with the arena, both shrines and `tapstone-sim replay` on the posted
  transcript agreeing on the final hash.
- [ ] Tap-to-board latency: the binary logs `tap→view N µs` per committed tap (arena side, Task
  24), plus up to 10 ms of tick; add the radio leg by timestamping the shrine's `T` send against
  the canvas change on a phone-camera video of both. Report median and maximum against plan-1's
  300 ms, and name the instrument with the number (verification.md).
- [ ] Unplug a shrine mid-turn: the canvas shows "Link lost: the match is paused"; replug: it resumes.
- [ ] Kill the arena mid-turn: both shrines show "the arena is dark"; play two taps on the interim
  arbiter; restart the arena: it resumes from the journal, takes the hand-back, and the canvas
  catches up with no lost record.
- [ ] After the match both stations show XP and, for the winner, a drop or a melt.
