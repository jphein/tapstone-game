# VR M1b: the table (card mechanics, animations, the Tea House and its Dueling Grounds), implementation plan

Part of #129.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the headset plays Tapstone with virtual cards on a virtual altar. You touch a card to the stone with a fingertip, or pinch from afar; the engine's own menu stays the only source of moves, and every move animates. The table gathers in the canon **Tea House**, and the duel is played on its **Dueling Grounds**, through the red door (0039, amended to JP's *Inner Authority* canon).

**Architecture:**
- **Rust (lane R):** the page's own shrine now knows its hand, by design. `tapstone-web` exports it, together with the person's seat, and adds the tap fields to the menu.
- **Pure JavaScript (lane L), tested under Node:**
  - a gesture becomes a menu index, a request for a target, or a local refusal;
  - small state machines for the wrist flip, the castle double-tap and the 3 s target default;
  - consecutive views become animation effects;
  - the table layout, checked against a field-of-view budget.
- **The IWSDK scene (lane S):** the scene draws and listens. It holds no rules.
- **The Tea House (lane T):** the canon's two places.
  - The Tea House is a safe-zone hub: the lobby, the result beat, six realm doors at the edge of view, and the red door ahead.
  - The Dueling Grounds are the pocket dimension the red door opens onto when the match begins.
  - Canon names and short phrases come from the bible (`scratch/lore/`). What the bible doesn't describe stays a `LORE:` slot.

**Tech stack:** IWSDK 1.0.0-rc.2 (three `super-three@0.181.0`, Vite 7), Node 20+ (`node --test`), Rust (the arena and web crates, built on familiar), tapstone_web.wasm.

**Sources:**
- spec `docs/superpowers/specs/2026-09-25-tapstone-vr-design.md` §3;
- decision **0039** (the Tea House and its Dueling Grounds, amended to the canon; the bible in `scratch/lore/`);
- the day-1 spike, nebula-xr's `scratch/vr/spike-day1.md`, branch `spike/xr-day1` at e49a3f9;
- `scratch/vr/experience.md` §3.2 (the effects table);
- rules-v0 (Advance);
- plan M1a (`2026-09-25-tapstone-vr-m1-in-page-arena.md`).

**Everything here was run while writing, except what needs a headset.**
- **Rust (lane R):** the tapstone-web tests pass (4, including the hand followed through a whole match). The workspace passes (467/0), with clippy, fmt, the wasm build and the Node gate, on familiar at main a537806. One perturbation was caught.
- **Pure logic (lane L):** **27 Node tests pass**, including a **whole match played only by gestures on the real wasm**. Eight perturbations were caught.
- **Scene and teahouse (lanes S and T):** they **build with Vite** against IWSDK rc.2 with 0 missing-export warnings. Planting a wrong IWSDK name exited 0 until Task S1's `onwarn` made it fatal.
- **Not run:** the scene in IWER or on the Quest 2. Those runs are Tasks S5, T2 and V1.

## What building this plan found (each changed the plan)

1. **The spec's 60 × 42 cm board can't meet 0039's "board within the lower-central 50°" and keep the targets within reach.**
   - At a seated reach its near corners sit at ±31.5°.
   - This plan uses a **0.50 × 0.35 m** board (±25.5°), with its centre 0.70 m ahead of and 0.42 m below the head.
   - The altar moves toward the player: 0.30 m wide, with 8 × 7 cm pads at ±0.10. That keeps the pads **0.51 m from the head**, where the spike's touches worked (spec §3.2 after #128: "within seated reach", at least 6 cm).
   - The spec's "about 30–40 cm" can't be literal on a table 0.42 m below the eyes.
   - Node tests hold the FoV budget, the reach and the 6 cm rule. The spec's 0.60 m board and the first draft's 0.60 m altar each fail.
   - It's all constants in `logic/layout.js`, so the lead or JP can overrule.
2. **The spec's gesture table has no Advance,** though the engine offers `a/<lane>` every turn. rules-v0 says "**Advance: touch a lane**", so here **a bare fingertip (no card) on a lane's pad advances that lane**.
3. **The menu key drops a spell target's seat:** `s/<card>/<lane><cell>` is the same for my unit and theirs in the same cell. Task R2 adds the tap's raw `card`, `lane`, `target` (`seat<<4 | lane<<2 | cell`) and `aux` to `table_choices()`, so a gaze-picked unit maps to exactly one item.
4. **The engine keeps only a hand count, and only a draw's record carries the copy's UID.**
   - So `DeskShrine` tracks its hand **by design**: a draw adds, a cast or charge removes one copy, a mulligan clears.
   - A test checks it against the engine's count at every view of a whole match, and a perturbation (a charged card left in the hand) fails at step 6.
5. **Two IWSDK and Vite facts that only a build shows:**
   - The components module needs a **default export** (`defineComponents([...])`).
   - Rollup treats a **missing export as a warning, and `vite build` still exits 0**, so Task S1's `onwarn` makes it fatal.
6. **The canon changed the room** (0039, amended after the bible was read).
   - The table **gathers in the Tea House** and **duels on the Dueling Grounds**, through the red door. That's two places, not one teahouse room.
   - The six realm doors carry canon names: the Hearthlands, the Deep Tides (the blue door, canon look), the Forge Peaks, the Wandering Courts, the Star Fields and the Dreaming.
   - The Tea House's voice "offers, never forces", so the voice lines are phrased as offers, even an owed draw.
   - A draw is an arrival by teleportation, and cards are holographic.
   - Tide ↔ Deep Tides and Ember ↔ Forge Peaks are **a proposal to JP**, marked so in the code.
   - Only short names and phrases go into the repo; the manuscript stays in `scratch/lore/`.
7. **The spec's "first match" ruleset was measured and dropped** (Task 7 of M1a, PR #110: the defaults already come in under 5–7 min, and the bot's picker is the difficulty lever). This plan wires no ruleset.
8. **Board placement mirrors the spike's proven path:** ahead along −z from the first head pose, then turned to face the head. `getWorldDirection` on a non-camera `Object3D` returns +z, so it isn't used.

## Prerequisites

- **nebula-xr pushes `spike/xr-day1`** (e49a3f9, never merged). It exists only in its worktree today, and Task S1 copies files from it by commit.
- **Lanes run in parallel on the contract below.** Lane S's page needs lane R's wasm only to *run*; its build and lane L's tests don't wait. `test/match.test.js` takes the wasm from `TAPSTONE_WASM`, or from `test/fixtures/` (Task L5).

## The contract between the lanes

| From | Call | Gives |
|---|---|---|
| wasm (R2) | `table_choices()` | `[{key, label, kind, useful, card, lane, target, aux}]`: the engine's menu for the person's seat |
| wasm (R2) | `table_hand()` | `[{card, name, faction, cost, kind: "unit"\|"spell"\|"castle", attack?, toughness?, keyword?, effect?}]`, in draw order |
| wasm (R2) | `table_seat()` | 0 or 1, or 255 until the claim lands |
| logic (L1) | `matchGesture(menu, gesture)` | `{index}` \| `{need: 'target', options}` \| `{refused: text}` |
| logic (L3) | `diffViews(prev, next, mySeat)` | effects `[{type, …}]` for the scene to play |

## Lanes and file ownership (one lane per file group, run in parallel)

| Lane | Tasks | Files (all under `rust/`) |
|---|---|---|
| **R** Rust | R1, R2 | `tapstone-arena/src/link/desk.rs`, `tapstone-web/src/lib.rs`, `tapstone-web/src/ffi.rs` |
| **L** logic | L1–L5 | `tapstone-web/www/xr/src/logic/*.js`, `tapstone-web/www/xr/test/*.js`, `…/test/fixtures/` |
| **S** scene | S1–S5 | `tapstone-web/www/xr/` except `src/logic/`, `test/`, `src/teahouse.js` |
| **T** Tea House | T1–T2 | `tapstone-web/www/xr/src/teahouse.js` |

**Standing rules:**
- Cargo builds and tests run **on familiar only**, in `/var/tmp/fwork/<lane>` with `CARGO_TARGET_DIR=/var/tmp/ftarget/<lane>`, deleting only your own subdirs.
- The Node and Vite commands run on katana (Node 24).
- Sync to familiar with `rsync -rlp --checksum` (never `-a`), and `cargo clean -p <crate>` before a final gate (`docs/verification.md`).
- Perturb every new check once and record the red. Stage files by name. Send the lead "pushing #N <sha>" before each push.
- Branches: `feat/m1b-hand-export` (R), `feat/m1b-logic` (L), `feat/m1b-scene` (S), `feat/m1b-teahouse` (T). S and T stack on L.

---

## Lane R: the hand, the seat and the tap fields, from the wasm

### Task R1: `DeskShrine` keeps its hand, by design

**Files:** Modify `rust/tapstone-arena/src/link/desk.rs`.

- [ ] **Step 1: The change** (the test that holds it is R2's whole-match test, since the hand is read through `tapstone-web`):

```diff
--- a/rust/tapstone-arena/src/link/desk.rs
+++ b/rust/tapstone-arena/src/link/desk.rs
@@ -107,6 +107,11 @@
     /// Synthetic UIDs of this shrine's copies it has seen committed as drawn and not yet
     /// mulliganed back (0036: a copy is drawn once per shuffle-in, and the arena checks it).
     pub drawn: HashSet<[u8; 7]>,
+    /// The designs in this seat's hand, in draw order, from its own committed records: a draw
+    /// adds its card, a cast or a charge removes one copy of its card, a mulligan empties it. The
+    /// engine keeps only a count (`Seat::hand_len`); a table that shows the cards needs these.
+    /// By design, not by UID: only a draw's record carries the copy's UID.
+    pub hand: Vec<u16>,
     /// The record of the pending proposal, to tell a true confirmation from a false one.
     pub pending_record: Option<Record>,
     /// STALE_LSEQ refusals received: a counter that went backwards, caught by the arena.
@@ -183,6 +188,7 @@
             refused: 0,
             castle,
             drawn: HashSet::new(),
+            hand: Vec::new(),
             pending_record: None,
             stale_rejects: 0,
             false_confirms: 0,
@@ -233,9 +239,18 @@
         match r.kind {
             Kind::Draw => {
                 self.drawn.insert(r.uid);
+                self.hand.push(r.card);
             }
             // No seat mulligans after acting, so its hand is everything drawn.
-            Kind::Mulligan => self.drawn.clear(),
+            Kind::Mulligan => {
+                self.drawn.clear();
+                self.hand.clear();
+            }
+            Kind::CastUnit | Kind::CastSpell | Kind::Charge => {
+                if let Some(k) = self.hand.iter().position(|&c| c == r.card) {
+                    self.hand.remove(k);
+                }
+            }
             _ => {}
         }
     }
@@ -249,6 +264,7 @@
         self.pending_record = None;
         self.refused = 0;
         self.drawn.clear();
+        self.hand.clear();
         self.seen_head = None;
         self.heard_result = false;
         self.heard_unbegun = false;
```

- [ ] **Step 2: Build and run the arena's tests on familiar.**

```sh
cargo test -q -p tapstone-arena 2>&1 | grep "test result"
```
Expected: every line reads `ok … 0 failed`. The field changes no frame and no view, so `the_canvas_fixture_is_current` stays green.

- [ ] **Step 3: Commit** `feat(arena): a desk shrine keeps its own hand, by design`.

### Task R2: `tapstone-web` exports the hand and the seat, and the menu gains the tap fields

**Files:** Modify `rust/tapstone-web/src/lib.rs` and `rust/tapstone-web/src/ffi.rs`.

- [ ] **Step 1: Add the tests first** (they're in the diff below: `the_hand_follows_the_engine_through_a_whole_match`, and `menu_items_carry_the_tap_fields`). Run `cargo test -q -p tapstone-web`. Expected: a compile error, because `hand` and `seat` aren't defined yet.
- [ ] **Step 2: The change:**

```diff
--- a/rust/tapstone-web/src/lib.rs
+++ b/rust/tapstone-web/src/lib.rs
@@ -4,6 +4,7 @@
 use serde::Serialize;
 use tapstone_arena::link::desk::DeskTable;
 use tapstone_rules::Record;
+use tapstone_rules::cards::{CardKind, design};
 
 pub mod ffi;
 
@@ -17,12 +18,34 @@
     menu: Vec<Record>,
 }
 
+/// One menu item. `card`, `lane`, `target` and `aux` are the tap's own fields, so the headset can
+/// match a gesture to exactly one item: the key names a spell's target by lane and cell only
+/// (`s/<card>/<lane><cell>`), which is the same for my unit and theirs in the same cell.
 #[derive(Serialize)]
 struct MenuItem<'a> {
     key: &'a str,
     label: &'a str,
     kind: String,
     useful: bool,
+    card: u16,
+    lane: i8,
+    target: u8,
+    aux: u8,
+}
+
+/// One card in the person's hand, with everything a card face shows.
+#[derive(Serialize)]
+struct HandCard {
+    card: u16,
+    name: &'static str,
+    faction: String,
+    cost: u8,
+    /// "unit" | "spell" | "castle"
+    kind: &'static str,
+    attack: Option<u8>,
+    toughness: Option<u8>,
+    keyword: Option<String>,
+    effect: Option<String>,
 }
 
 impl Web {
@@ -65,6 +88,10 @@
                 label: &c.label,
                 kind: format!("{:?}", c.tap.kind),
                 useful: c.is_useful(g),
+                card: c.tap.card,
+                lane: c.tap.lane,
+                target: c.tap.target,
+                aux: c.tap.aux,
             })
             .collect();
         let json = serde_json::to_string(&items).unwrap_or_else(|_| "[]".into());
@@ -72,6 +99,53 @@
         json
     }
 
+    /// The person's hand, as a JSON array of cards (draw order): "[]" with nobody seated. Private
+    /// to this page, which holds the person's own shrine; the view model carries only a count.
+    pub fn hand(&self) -> String {
+        let Some(h) = self.human else {
+            return "[]".into();
+        };
+        let cards: Vec<HandCard> = self.table.link.shrines[h]
+            .hand
+            .iter()
+            .filter_map(|&id| design(id))
+            .map(|d| {
+                let (kind, attack, toughness, keyword, effect) = match d.kind {
+                    CardKind::Unit {
+                        attack,
+                        toughness,
+                        keyword,
+                    } => (
+                        "unit",
+                        Some(attack),
+                        Some(toughness),
+                        keyword.map(|k| format!("{k:?}")),
+                        None,
+                    ),
+                    CardKind::Spell(e) => ("spell", None, None, None, Some(format!("{e:?}"))),
+                    CardKind::Castle => ("castle", None, None, None, None),
+                };
+                HandCard {
+                    card: d.id,
+                    name: d.name,
+                    faction: format!("{:?}", d.faction).to_lowercase(),
+                    cost: d.cost,
+                    kind,
+                    attack,
+                    toughness,
+                    keyword,
+                    effect,
+                }
+            })
+            .collect();
+        serde_json::to_string(&cards).unwrap_or_else(|_| "[]".into())
+    }
+
+    /// The seat the person's shrine holds, once its claim has landed.
+    pub fn seat(&self) -> Option<usize> {
+        self.human.and_then(|h| self.table.link.shrines[h].seat())
+    }
+
     /// Send menu item `i` from the last `choices`. False for a stale or out-of-range index. The
     /// menu is spent either way, so a second pinch can't resend it.
     pub fn propose(&mut self, i: u32, now: u64) -> bool {
@@ -105,6 +179,78 @@
         assert_eq!(lines.join("\n"), record_desk_match(11).join("\n"));
     }
 
+    /// The hand the page shows must be the engine's hand: at every step of a whole match (a person
+    /// in seat 0 choosing as the web gate does), its length equals the view's own hand count, and
+    /// every menu item names a card the hand holds, or none (draws, passes, advances, mulligans).
+    #[test]
+    fn the_hand_follows_the_engine_through_a_whole_match() {
+        let mut web = Web::new(11, 0);
+        let (mut checked, mut done) = (0, false);
+        for step in 0..60_000u64 {
+            let now = step * 10;
+            let lines = web.step(now);
+            if let (Some(line), Some(seat)) = (lines.lines().last(), web.seat()) {
+                let v: serde_json::Value = serde_json::from_str(line).unwrap();
+                if let Some(count) = v["seats"][seat]["hand"].as_u64() {
+                    let hand: Vec<serde_json::Value> = serde_json::from_str(&web.hand()).unwrap();
+                    assert_eq!(
+                        hand.len() as u64,
+                        count,
+                        "step {step}: the page's hand vs the engine's count"
+                    );
+                    checked += 1;
+                }
+            }
+            if web.done() {
+                done = true;
+                break;
+            }
+            let menu: Vec<serde_json::Value> = serde_json::from_str(&web.choices()).unwrap();
+            let hand: Vec<serde_json::Value> = serde_json::from_str(&web.hand()).unwrap();
+            let held: Vec<u64> = hand.iter().map(|c| c["card"].as_u64().unwrap()).collect();
+            for m in &menu {
+                let kind = m["kind"].as_str().unwrap();
+                if matches!(kind, "CastUnit" | "CastSpell" | "Charge") {
+                    assert!(
+                        held.contains(&m["card"].as_u64().unwrap()),
+                        "step {step}: {kind} of a card not in the hand: {m}"
+                    );
+                }
+            }
+            if let Some(i) = menu
+                .iter()
+                .position(|m| m["useful"] == true && m["kind"] != "Mulligan")
+            {
+                web.propose(i as u32, now);
+            }
+        }
+        assert!(done, "the match finished");
+        // Seed 11 with a person in seat 0 gives 46 views once the seat is known (measured).
+        assert!(
+            checked > 30,
+            "the hand was checked on real views ({checked})"
+        );
+    }
+
+    #[test]
+    fn menu_items_carry_the_tap_fields() {
+        let mut web = Web::new(11, 0);
+        for step in 0..40_000u64 {
+            web.step(step * 10);
+            let menu: Vec<serde_json::Value> = serde_json::from_str(&web.choices()).unwrap();
+            if let Some(m) = menu.first() {
+                for f in ["card", "lane", "target", "aux"] {
+                    assert!(
+                        m.get(f).is_some_and(|x| x.is_number()),
+                        "{f} missing from {m}"
+                    );
+                }
+                return;
+            }
+        }
+        panic!("never offered a menu");
+    }
+
     #[test]
     fn a_stale_menu_index_sends_nothing() {
         let mut web = Web::new(11, 0);
```

```diff
--- a/rust/tapstone-web/src/ffi.rs
+++ b/rust/tapstone-web/src/ffi.rs
@@ -51,3 +51,15 @@
 pub extern "C" fn table_propose(i: u32, now: u64) -> u32 {
     with(|t| t.propose(i, now) as u32, 0)
 }
+
+/// The person's hand as JSON (`Web::hand`), for the card faces in the headset.
+#[unsafe(no_mangle)]
+pub extern "C" fn table_hand() -> u32 {
+    put(with(|t| t.hand(), "[]".into()))
+}
+
+/// The seat the person's shrine holds (0 or 1), or 255 until its claim lands or with nobody seated.
+#[unsafe(no_mangle)]
+pub extern "C" fn table_seat() -> u32 {
+    with(|t| t.seat().map_or(255, |s| s as u32), 255)
+}
```

- [ ] **Step 3: Run, perturb, gate.**

```sh
cargo test -q -p tapstone-web 2>&1 | grep "test result"
```
- Expected: `4 passed; 0 failed`.
- Perturb: in `note_own`, drop `Kind::Charge` from the removing arm. Expected: `the page's hand vs the engine's count` fails at step 6. Restore it and run `cargo clean -p tapstone-arena -p tapstone-web`, and see 4 passed again.
- Then the full gate: `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`, and `cargo test --workspace` (467 passed, 0 failed at a537806, plus these). Then `cargo build -p tapstone-web --profile wasm --target wasm32-unknown-unknown` and `node tapstone-web/gate.mjs …` (4 `ok`).

- [ ] **Step 4: Commit** `feat(web): table_hand and table_seat; the menu carries the tap's fields`, then push `feat/m1b-hand-export`.

---

## Lane L: the pure logic, tested under Node

All of it lives in `rust/tapstone-web/www/xr/src/logic/` and has no IWSDK or DOM, so `node --test` runs it. Run from `rust/tapstone-web/www/xr/`. Until Task S1 lands, add a `package.json` holding `{"type": "module"}`. Every test was written before its module, and the module files below are the ones that pass.

### Task L1: `menu.js`: a gesture becomes a menu index

- [ ] **Step 1: The tests:** `test/logic.test.js`, given whole in Task L3's step 1 (its menu section).
- [ ] **Step 2:** Run `node --test test/logic.test.js`. Expected: `Cannot find module '../src/logic/menu.js'`.
- [ ] **Step 3: The module:** `src/logic/menu.js`

```js
// menu.js: a hand gesture becomes a menu index. Pure (no IWSDK, no DOM), tested under Node.
//
// The menu is tapstone-web's `table_choices()`: the engine's own legal moves for the person's seat
// (tapstone_sim::human::legal_choices), each item {key, label, kind, useful, card, lane, target,
// aux}. A gesture never invents a move: it picks one of these or is refused locally, so there is
// still one source of truth (0037). A refused gesture costs nothing: the card goes back to the hand.
//
// Gestures (spec 2026-09-25 §3.2):
//   { source: 'deck' }                                      draw: the deck's top card on any pad
//   { source: 'castle', action: 'pass' | 'mulligan' }       the castle card on a pad (gestures.js decides which)
//   { source: 'lane', pad: 0|1|2 }                          advance: a bare fingertip on a lane's pad (rules-v0:
//                                                           "Advance: touch a lane"; the spec's gesture table omits it)
//   { source: 'hand', card, face: 'down' }                  charge: a card turned face down, on any pad
//   { source: 'hand', card, face: 'up', pad: 0|1|2 }        cast: a unit goes to the pad's lane
//   { source: 'hand', card, face: 'up', target?, aux? }     a spell; `target` is the raw target byte
//                                                           (seat << 4 | lane << 2 | cell, or 0xFF = castle)
// Answers: { index } | { need: 'target', options: [{ index, target, aux, label }] } | { refused: text }

export const CASTLE_TARGET = 0xff;

// The raw target byte for a unit at (seat, lane, cell), as the rules pack it.
export function targetOf(seat, lane, cell) {
  return (seat << 4) | (lane << 2) | cell;
}

export function matchGesture(menu, g) {
  if (!menu.length) return { refused: "It isn't your move." };
  const draws = menu.filter((m) => m.kind === 'Draw');
  // 0036: while draws are owed the engine offers nothing else.
  if (draws.length === menu.length && g.source !== 'deck') {
    return { refused: 'Draw first: touch the top card of your deck to the stone.' };
  }
  const at = (pred) => menu.findIndex(pred);
  let i = -1;
  if (g.source === 'deck') {
    i = at((m) => m.kind === 'Draw');
    return i >= 0 ? { index: i } : { refused: 'No draw is owed.' };
  }
  if (g.source === 'lane') {
    i = at((m) => m.kind === 'Advance' && m.lane === g.pad);
    return i >= 0 ? { index: i } : { refused: "That lane can't advance now." };
  }
  if (g.source === 'castle') {
    const kind = g.action === 'mulligan' ? 'Mulligan' : 'Pass';
    i = at((m) => m.kind === kind);
    return i >= 0 ? { index: i } : { refused: kind === 'Mulligan' ? 'The mulligan window is closed.' : "You can't pass now." };
  }
  if (g.face === 'down') {
    i = at((m) => m.kind === 'Charge' && m.card === g.card);
    return i >= 0 ? { index: i } : { refused: "That card can't be charged now." };
  }
  const unit = at((m) => m.kind === 'CastUnit' && m.card === g.card);
  if (unit >= 0) {
    if (g.pad === undefined || g.pad === null) return { refused: 'Touch the pad under the lane you want.' };
    i = at((m) => m.kind === 'CastUnit' && m.card === g.card && m.lane === g.pad);
    return i >= 0 ? { index: i } : { refused: "That lane's entry cell is taken." };
  }
  const spells = menu.map((m, index) => ({ m, index })).filter(({ m }) => m.kind === 'CastSpell' && m.card === g.card);
  if (spells.length) {
    const fits = spells.filter(({ m }) => (g.target === undefined || m.target === g.target) && (g.aux === undefined || m.aux === g.aux));
    if (fits.length === 1) return { index: fits[0].index };
    if (fits.length === 0) return { refused: "That spell can't reach there." };
    return { need: 'target', options: fits.map(({ m, index }) => ({ index, target: m.target, aux: m.aux, label: m.label })) };
  }
  return { refused: "You can't play that card now." };
}

// The inverse, for tests and the IWER driver: the gesture that picks menu item `m`. Every kind the
// engine offers has one, which is what "hands can play every move" means.
export function gestureForItem(m) {
  switch (m.kind) {
    case 'Draw':
      return { source: 'deck' };
    case 'Charge':
      return { source: 'hand', card: m.card, face: 'down', pad: 0 };
    case 'CastUnit':
      return { source: 'hand', card: m.card, face: 'up', pad: m.lane };
    case 'CastSpell':
      return { source: 'hand', card: m.card, face: 'up', pad: 1, target: m.target, aux: m.aux };
    case 'Advance':
      return { source: 'lane', pad: m.lane };
    case 'Pass':
      return { source: 'castle', action: 'pass' };
    case 'Mulligan':
      return { source: 'castle', action: 'mulligan' };
    default:
      return null;
  }
}
```

### Task L2: `gestures.js`: the wrist flip, the castle, the target timer

- [ ] **Step 1: The module:** `src/logic/gestures.js` (its tests are in `test/logic.test.js`)

```js
// gestures.js: small state machines for the hands-first verbs. Pure; every clock is passed in (ms).

// Face up or face down, from how the held card faces: `dot` is the card face's normal dotted with
// world up (1 = face up, -1 = face down). Hysteresis: it flips only past `downAt` or `upAt`, so a
// card held edge-on doesn't flicker between cast and charge.
export class FlipDetector {
  constructor({ upAt = 0.35, downAt = -0.35 } = {}) {
    this.upAt = upAt;
    this.downAt = downAt;
    this.face = 'up';
  }
  update(dot) {
    if (this.face === 'up' && dot < this.downAt) this.face = 'down';
    else if (this.face === 'down' && dot > this.upAt) this.face = 'up';
    return this.face;
  }
}

// The castle card: outside the mulligan window a tap passes at once (0009). Inside it, a tap opens a
// 3 s prompt: a second tap within the window is a mulligan, and if the 3 s run out it keeps and
// passes (0032 amendment). Nothing is sent until the prompt resolves.
export class CastleTaps {
  constructor({ windowMs = 3000 } = {}) {
    this.windowMs = windowMs;
    this.openedAt = null;
  }
  // Returns 'pass' | 'mulligan' | 'pending'.
  tap(now, mulliganOpen) {
    if (!mulliganOpen) {
      this.openedAt = null;
      return 'pass';
    }
    if (this.openedAt !== null && now - this.openedAt <= this.windowMs) {
      this.openedAt = null;
      return 'mulligan';
    }
    this.openedAt = now;
    return 'pending';
  }
  // Call every frame: 'pass' once the window runs out with no second tap, else null.
  poll(now) {
    if (this.openedAt !== null && now - this.openedAt > this.windowMs) {
      this.openedAt = null;
      return 'pass';
    }
    return null;
  }
  get pending() {
    return this.openedAt !== null;
  }
}

// A spell with several legal targets: look at one and pinch, or the default applies after 3 s (0009:
// nearest). `options` come from matchGesture's { need: 'target' }; `defaultIndex` picks among them.
export class TargetTimer {
  constructor({ ms = 3000 } = {}) {
    this.ms = ms;
    this.options = null;
  }
  start(now, options, defaultIndex = 0) {
    this.options = options;
    this.startedAt = now;
    this.defaultIndex = Math.min(Math.max(0, defaultIndex), options.length - 1);
  }
  // A gaze-and-pinch on a target byte: the menu index, or null if it isn't one of the options.
  pick(target) {
    if (!this.options) return null;
    const o = this.options.find((x) => x.target === target);
    if (!o) return null;
    this.options = null;
    return o.index;
  }
  // Call every frame: the default's menu index once 3 s have passed, else null.
  poll(now) {
    if (!this.options || now - this.startedAt < this.ms) return null;
    const o = this.options[this.defaultIndex];
    this.options = null;
    return o.index;
  }
  get active() {
    return this.options !== null;
  }
}

// IWSDK's Pressed fires for poke and ray alike and doesn't name its pointer. A press with a tracked
// index fingertip within `radius` metres of the target counts as a poke (the spike's heuristic).
export function pressKind(fingertipDistances, radius = 0.03) {
  return fingertipDistances.some((d) => d <= radius) ? 'poke' : 'ray';
}
```

### Task L3: `effects.js`: what to animate, from consecutive views

- [ ] **Step 1: The tests:** `test/logic.test.js`. The effects section replays the real desk fixture and holds the differ to what the engine did:
  - every point of castle life lost is a keep chip;
  - every charge lights one gem, and every draw flips one card;
  - every unit cast summons exactly once;
  - an advance is a move, never a death plus a summon.

```js
// The pure logic's tests: `node --test test/` from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { matchGesture, targetOf, CASTLE_TARGET } from '../src/logic/menu.js';
import { FlipDetector, CastleTaps, TargetTimer, pressKind } from '../src/logic/gestures.js';
import { diffViews, EffectQueue } from '../src/logic/effects.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '../../../../tapstone-arena/web/fixtures/desk-seed11.jsonl');
const views = readFileSync(FIXTURE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// A menu in tapstone-web's shape (after Task R2): the fields the matcher reads.
const item = (kind, card, lane = -1, target = 0, aux = 0) => ({ key: '', label: `${kind} ${card}`, kind, useful: true, card, lane, target, aux });

test('the fixture is the real desk match', () => {
  assert.equal(views.length, 79);
});

// ---- menu.js --------------------------------------------------------------------------------

test('a unit face up on pad N casts into lane N, and only there', () => {
  const menu = [item('Charge', 7), item('CastUnit', 7, 0), item('CastUnit', 7, 2), item('Pass', 0)];
  assert.deepEqual(matchGesture(menu, { source: 'hand', card: 7, face: 'up', pad: 2 }), { index: 2 });
  assert.deepEqual(matchGesture(menu, { source: 'hand', card: 7, face: 'up', pad: 0 }), { index: 1 });
  assert.ok(matchGesture(menu, { source: 'hand', card: 7, face: 'up', pad: 1 }).refused, 'lane 1 is not offered');
});

test('face down on any pad charges that card', () => {
  const menu = [item('Charge', 7), item('Charge', 9), item('CastUnit', 7, 1)];
  assert.deepEqual(matchGesture(menu, { source: 'hand', card: 9, face: 'down', pad: 0 }), { index: 1 });
  assert.ok(matchGesture(menu, { source: 'hand', card: 3, face: 'down' }).refused);
});

test('while draws are owed only the deck answers (0036)', () => {
  const menu = [item('Draw', 4)];
  assert.match(matchGesture(menu, { source: 'hand', card: 7, face: 'up', pad: 0 }).refused, /Draw first/);
  assert.deepEqual(matchGesture(menu, { source: 'deck' }), { index: 0 });
});

test('the castle passes, or mulligans only inside the window', () => {
  const menu = [item('Mulligan', 0), item('Pass', 0)];
  assert.deepEqual(matchGesture(menu, { source: 'castle', action: 'pass' }), { index: 1 });
  assert.deepEqual(matchGesture(menu, { source: 'castle', action: 'mulligan' }), { index: 0 });
  assert.ok(matchGesture([item('Pass', 0)], { source: 'castle', action: 'mulligan' }).refused);
});

test('a spell with several targets asks for one; a target picks exactly its item', () => {
  const mine = targetOf(0, 1, 2), theirs = targetOf(1, 1, 2); // same lane and cell, different seats
  const menu = [item('CastSpell', 11, -1, mine), item('CastSpell', 11, -1, theirs), item('CastSpell', 11, -1, CASTLE_TARGET)];
  const ask = matchGesture(menu, { source: 'hand', card: 11, face: 'up', pad: 0 });
  assert.equal(ask.need, 'target');
  assert.equal(ask.options.length, 3);
  // The seat is in the target byte, so my unit and theirs at the same lane and cell stay apart
  // (the menu KEY drops the seat: s/<card>/<lane><cell>).
  assert.deepEqual(matchGesture(menu, { source: 'hand', card: 11, face: 'up', target: theirs }), { index: 1 });
  assert.deepEqual(matchGesture(menu, { source: 'hand', card: 11, face: 'up', target: mine }), { index: 0 });
});

test('a bare fingertip on a pad advances that lane (rules-v0: "Advance: touch a lane")', () => {
  const menu = [item('Advance', 0, 0), item('Advance', 0, 2), item('Pass', 0)];
  assert.deepEqual(matchGesture(menu, { source: 'lane', pad: 2 }), { index: 1 });
  assert.match(matchGesture(menu, { source: 'lane', pad: 1 }).refused, /advance/i);
});

test('an empty menu is not your move', () => {
  assert.match(matchGesture([], { source: 'deck' }).refused, /your move/);
});

// ---- gestures.js ----------------------------------------------------------------------------

test('the wrist flip has hysteresis: edge-on does not flicker', () => {
  const f = new FlipDetector();
  assert.equal(f.update(0.9), 'up');
  assert.equal(f.update(-0.2), 'up', 'not past the down threshold');
  assert.equal(f.update(-0.5), 'down');
  assert.equal(f.update(0.2), 'down', 'not past the up threshold');
  assert.equal(f.update(0.6), 'up');
});

test('the castle: pass at once outside the window; inside, a second tap within 3 s mulligans', () => {
  const c = new CastleTaps();
  assert.equal(c.tap(0, false), 'pass');
  assert.equal(c.tap(1000, true), 'pending');
  assert.equal(c.poll(3000), null, 'the window is still open at 2 s');
  assert.equal(c.tap(3500, true), 'mulligan', 'second tap at 2.5 s');
  assert.equal(c.tap(10000, true), 'pending');
  assert.equal(c.poll(13001), 'pass', 'the window ran out: keep and pass');
  assert.equal(c.poll(14000), null, 'only once');
});

test('a target: gaze and pinch picks it; otherwise the default applies after 3 s', () => {
  const t = new TargetTimer();
  const options = [{ index: 4, target: 0x12 }, { index: 5, target: 0x16 }];
  t.start(0, options, 1);
  assert.equal(t.pick(0x99), null, 'not an option');
  assert.equal(t.pick(0x12), 4);
  t.start(0, options, 1);
  assert.equal(t.poll(2999), null);
  assert.equal(t.poll(3000), 5, 'the default');
  assert.equal(t.active, false);
});

test('poke or ray, by fingertip distance', () => {
  assert.equal(pressKind([0.02]), 'poke');
  assert.equal(pressKind([0.05, 0.4]), 'ray');
  assert.equal(pressKind([]), 'ray');
});

// ---- effects.js: replay the real match --------------------------------------------------------

const all = [];
for (let i = 1; i < views.length; i++) all.push({ i, v: views[i], fx: diffViews(views[i - 1], views[i], 0) });
const count = (type) => all.reduce((n, x) => n + x.fx.filter((e) => e.type === type).length, 0);

test('every castle life lost is a keep chip, exactly', () => {
  const lost = [0, 0];
  for (const x of all) for (const e of x.fx) if (e.type === 'keepChip') lost[e.seat] += e.amount;
  const end = views.at(-1).last_over ?? views.at(-1);
  assert.deepEqual(lost, [20 - end.seats[0].life, 20 - end.seats[1].life]);
});

test('every charge record lights exactly one gem', () => {
  const charges = views.filter((v) => v.last && v.last.kind === 'Charge').length;
  assert.equal(count('chargeGem'), charges);
  assert.ok(charges > 0);
});

test('every draw record flips exactly one card; only the person sees its name', () => {
  const draws = views.filter((v) => v.last && v.last.kind === 'Draw').length;
  assert.equal(count('drawFlip'), draws);
  for (const x of all) for (const e of x.fx) if (e.type === 'drawFlip') assert.equal(e.card !== null, e.seat === 0);
});

test('every unit cast summons exactly once, and the commanders arrive at the start', () => {
  const casts = views.filter((v) => v.last && v.last.kind === 'CastUnit').length;
  const commanders = all.flatMap((x) => x.fx).filter((e) => e.type === 'summon' && e.commander).length;
  const summonsOnCast = all.filter((x) => (x.v.last || {}).kind === 'CastUnit').map((x) => x.fx.filter((e) => e.type === 'summon' && !e.commander).length);
  assert.equal(summonsOnCast.length, casts);
  assert.ok(summonsOnCast.every((n) => n === 1), `each cast summons one: ${summonsOnCast}`);
  assert.ok(commanders >= 2, 'both commanders');
});

test('an advance is a move, never a death plus a summon', () => {
  for (const x of all.filter((y) => (y.v.last || {}).kind === 'Advance')) {
    const kinds = x.fx.map((e) => e.type);
    assert.ok(!kinds.includes('summon'), `view ${x.i}: an advance summoned ${JSON.stringify(x.fx)}`);
  }
  assert.ok(count('advance') > 0);
});

test('the match ends with one result, naming the winner', () => {
  const results = all.flatMap((x) => x.fx).filter((e) => e.type === 'result');
  assert.equal(results.length, 1);
  assert.equal(results[0].winner, (views.at(-1).last_over ?? views.at(-1)).winner);
});

test('the queue plays one effect at a time and compresses a backlog, keeping the result', () => {
  const q = new EffectQueue({ maxPending: 3 });
  q.push([{ type: 'damage' }, { type: 'death' }, { type: 'keepChip' }, { type: 'chargeGem' }, { type: 'result', winner: 0 }]);
  assert.equal(q.length, 3);
  assert.equal(q.next(0).type, 'keepChip', 'the oldest were dropped');
  assert.equal(q.next(100), null, 'still playing');
  assert.equal(q.next(300).type, 'chargeGem');
  assert.equal(q.next(600).type, 'result');
});
```

- [ ] **Step 2: The module:** `src/logic/effects.js`

```js
// effects.js: what to animate, computed from two consecutive view models (0027's amendment: state
// only the view needs is computed by the view, never sent). Pure; tested against the real desk
// fixture. The scene plays these in order; the board itself always shows the newest view.
//
// Effect types (spec 2026-09-25 §3.2 / experience.md §3.2):
//   summon {seat, lane, cell, faction, commander}   a unit arrived: the arc from the altar, the rise
//   advance {seat, lane, from, to}                  a unit stepped forward
//   damage {seat, lane, cell, amount}               a unit was struck: stagger + rim flash
//   death {seat, lane, cell, faction}               a unit is gone: the crumble
//   clash {lane}                                    both front cells of a lane were hit at once
//   keepChip {seat, amount}                         a castle lost life: a chip flies off the keep
//   chargeGem {seat}                                a mana gem lit
//   drawFlip {seat, card}                           a card was drawn (card name: the person's own draws only)
//   commanderFall {seat, lane}, commanderReturn {seat, lane}
//   result {winner}                                 the match ended (winner null: void)

const board = (v) => (v && v.phase === 'lobby' && !v.lobby.length && v.last_over ? v.last_over : v);
const unitAt = (v, s, l, c) => (v && v.seats && v.seats[s] ? v.seats[s].cells[l][c] : null);

export function diffViews(prev, next, mySeat = null) {
  const a = board(prev), b = board(next);
  const out = [];
  if (!b || !b.seats || !b.seats.length) return out;
  const hadBoard = a && a.seats && a.seats.length;
  const last = next.last || {};
  const moved = new Set(); // "s:l:c" keys consumed by an advance pairing
  // Advances: the acting seat's units in one lane shift forward; pair each vanished unit with an
  // appeared one of the same name further forward in the same lane.
  if (hadBoard && last.kind === 'Advance') {
    const s = last.seat;
    for (let l = 0; l < 3; l++) {
      for (let c = 2; c >= 0; c--) {
        const was = unitAt(a, s, l, c);
        if (!was || (unitAt(b, s, l, c) && unitAt(b, s, l, c).name === was.name)) continue;
        for (let d = c + 1; d <= 2; d++) {
          const now = unitAt(b, s, l, d);
          if (now && now.name === was.name && !moved.has(`${s}:${l}:${d}`) && !(unitAt(a, s, l, d) && unitAt(a, s, l, d).name === now.name)) {
            out.push({ type: 'advance', seat: s, lane: l, from: c, to: d });
            moved.add(`${s}:${l}:${c}`);
            moved.add(`${s}:${l}:${d}`);
            break;
          }
        }
      }
    }
  }
  const hit = [[false, false, false], [false, false, false]]; // front-cell hits per seat per lane
  for (let s = 0; s < 2; s++) {
    for (let l = 0; l < 3; l++) {
      for (let c = 0; c < 3; c++) {
        const key = `${s}:${l}:${c}`;
        const was = hadBoard ? unitAt(a, s, l, c) : null;
        const now = unitAt(b, s, l, c);
        if (moved.has(key)) {
          if (was && now && now.name === was.name && now.damage > was.damage) {
            out.push({ type: 'damage', seat: s, lane: l, cell: c, amount: now.damage - was.damage });
          }
          continue;
        }
        if (now && (!was || was.name !== now.name)) {
          if (was) out.push({ type: 'death', seat: s, lane: l, cell: c, faction: was.faction });
          out.push({ type: 'summon', seat: s, lane: l, cell: c, faction: now.faction, commander: !!now.commander });
        } else if (was && !now) {
          out.push({ type: 'death', seat: s, lane: l, cell: c, faction: was.faction });
          if (c === 2) hit[s][l] = true;
        } else if (was && now && now.damage > was.damage) {
          out.push({ type: 'damage', seat: s, lane: l, cell: c, amount: now.damage - was.damage });
          if (c === 2) hit[s][l] = true;
        }
      }
    }
  }
  for (let l = 0; l < 3; l++) if (hit[0][l] && hit[1][l]) out.push({ type: 'clash', lane: l });
  if (hadBoard) {
    for (let s = 0; s < 2; s++) {
      const was = a.seats[s], now = b.seats[s];
      if (now.life < was.life) out.push({ type: 'keepChip', seat: s, amount: was.life - now.life });
      if (now.charged > was.charged) out.push({ type: 'chargeGem', seat: s });
      if (was.commander_returns === 0 && now.commander_returns > 0) out.push({ type: 'commanderFall', seat: s, lane: now.commander_lane });
      if (was.commander_returns > 0 && now.commander_returns === 0) out.push({ type: 'commanderReturn', seat: s, lane: now.commander_lane });
    }
    if (last.kind === 'Draw' && b.seats[last.seat] && b.seats[last.seat].hand > a.seats[last.seat].hand) {
      out.push({ type: 'drawFlip', seat: last.seat, card: last.seat === mySeat ? last.card : null });
    }
  }
  if (b.phase === 'over' && (!a || a.phase !== 'over')) out.push({ type: 'result', winner: b.winner ?? null });
  return out;
}

// How long each effect plays, in ms. One big effect at a time, in record order.
export const DURATION = {
  summon: 600, advance: 250, damage: 250, death: 400, clash: 350, keepChip: 300,
  chargeGem: 250, drawFlip: 250, commanderFall: 500, commanderReturn: 600, result: 2000,
};

// The queue the scene drains. If records arrive faster than effects play, it compresses: past
// `maxPending` effects it drops the oldest (the board already shows the newest state, so nothing
// is lost but motion), always keeping a `result`. The view is never behind the chain.
export class EffectQueue {
  constructor({ maxPending = 8 } = {}) {
    this.maxPending = maxPending;
    this.items = [];
    this.playing = null;
  }
  push(effects) {
    this.items.push(...effects);
    while (this.items.length > this.maxPending) {
      const drop = this.items.findIndex((e) => e.type !== 'result');
      if (drop < 0) break;
      this.items.splice(drop, 1);
    }
  }
  // The effect to start now, or null while one is still playing or the queue is empty.
  next(now) {
    if (this.playing && now < this.playing.until) return null;
    this.playing = null;
    const e = this.items.shift();
    if (!e) return null;
    this.playing = { effect: e, until: now + (DURATION[e.type] ?? 300) };
    return e;
  }
  get length() {
    return this.items.length;
  }
}
```

### Task L4: `layout.js`: the table, sized to the FoV budget

- [ ] **Step 1: The tests:** `test/layout.test.js`

```js
// The layout's FoV budget, on the numbers the scene builds with (spec 2026-09-25 §3.1, 0039).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD, PAD, PROMPT, LANE_W, essentials, offGaze, cellCenter, padCenter, ALTAR, PLACE, defaultHead, DOORS, RED_DOOR, doorCenter } from '../src/logic/layout.js';

test('0039: the board stays within the lower-central ~50° (±26° yaw at the default placement)', () => {
  for (const [name, p] of Object.entries(essentials()).filter(([n]) => n.startsWith('board'))) {
    const a = offGaze(p);
    assert.ok(Math.abs(a.yaw) <= 26, `${name} at yaw ${a.yaw.toFixed(1)}`);
  }
});

test('every essential sits within ±32° yaw and ±30° pitch: inside a 70° device, with margin', () => {
  for (const [name, p] of Object.entries(essentials())) {
    const a = offGaze(p);
    assert.ok(Math.abs(a.yaw) <= 32 && Math.abs(a.pitch) <= 30, `${name} at yaw ${a.yaw.toFixed(1)}, pitch ${a.pitch.toFixed(1)}`);
  }
});

test('each pad sits under its own lane, left to right, and the altar is within a seated reach', () => {
  for (let l = 0; l < 3; l++) {
    const laneX = -BOARD.w / 2 + LANE_W * (l + 0.5);
    assert.ok(Math.abs(PAD.x[l] - laneX) < LANE_W / 2, `pad ${l} is under lane ${l}`);
  }
  assert.ok(PAD.x[0] < PAD.x[1] && PAD.x[1] < PAD.x[2]);
  const h = defaultHead();
  for (let l = 0; l < 3; l++) {
    const a = padCenter(l);
    const reach = Math.hypot(a.x - h.x, a.y - h.y, a.z - h.z);
    // The spike's touches worked at ~0.50 m (spec §3.2, after the spike: "within seated reach").
    assert.ok(reach <= 0.51, `pad ${l} is ${reach.toFixed(3)} m from the head`);
  }
  assert.ok(ALTAR.z > BOARD.d / 2, 'the altar is between the player and the board');
  assert.equal(PLACE.ahead, h.z);
});

test("the person's back row is nearest them; the other seat's back row is at the far edge", () => {
  const mine = cellCenter(0, 1, 0, 0), theirs = cellCenter(1, 1, 0, 0);
  assert.ok(mine.z > 0 && theirs.z < 0);
  assert.ok(cellCenter(0, 1, 2, 0).z < mine.z, "my front cell is further than my back cell");
});

test('0039: each realm door shown during play stands outside the play budget (|yaw| > 32°) and in the room (< 80°)', () => {
  for (const d of DOORS) {
    const a = offGaze(doorCenter(d));
    assert.ok(Math.abs(a.yaw) > 32 && Math.abs(a.yaw) < 80, `${d.realm} door at yaw ${a.yaw.toFixed(1)}`);
  }
  assert.equal(DOORS.length, 6, 'the six canon realms');
  assert.ok(RED_DOOR.lobbyOnly, 'the red door is gone once the match is on');
});

test('0039: the realm doors are the canon six, each named once; faction pairings are only on two', () => {
  const names = DOORS.map((d) => d.realm);
  assert.deepEqual([...names].sort(), ['Deep Tides', 'Forge Peaks', 'Hearthlands', 'Star Fields', 'Wandering Courts', 'the Dreaming'].sort());
  assert.equal(DOORS.filter((d) => d.faction).length, 2);
});

test('every touch target is at least 6 cm (spec §3.2, after the spike: sized for a fingertip)', () => {
  assert.ok(PAD.w >= 0.06 && PAD.d >= 0.06, `pads ${PAD.w} x ${PAD.d} m`);
  assert.ok(PROMPT.w / 3 - 0.006 >= 0.06 && PROMPT.h >= 0.06, `prompt tiles ${(PROMPT.w / 3 - 0.006).toFixed(3)} x ${PROMPT.h} m`);
});
```

- [ ] **Step 2: The module:** `src/logic/layout.js`

```js
// layout.js: the table's geometry in metres, board-local: origin at the board's centre on the
// table surface, +z toward the player, +x to their right, +y up. Pure (no three.js), so the FoV test
// runs under Node on the same numbers the scene builds with.
//
// Spec 2026-09-25 §3.1 orders it from the player outward: the hand, the altar (three lane pads on
// its top), the deck at the altar's right end, my castle (a low plaque), the board. The day-1 spike
// (scratch/vr/spike-day1.md) measured the spike's layout at 60.7-79.3° across on the Quest 2, over a
// 70° device, so this layout is sized to the budget and tested:
//   - the board is 0.50 x 0.35 m (spec: 0.60 x 0.42): at a seated reach the 0.60 board spans ~63°,
//     past 0039's "lower-central 50°"; at 0.50 its near corners sit at ±25.5°;
//   - the altar sits within seated reach (the spec, after the spike: targets "within seated reach",
//     at least 6 cm): its pads are 0.51 m from the head, where the spike's touches worked (18 of 27
//     taps were touches). On a table 0.42 m below the eyes nothing is closer than 0.42 m, so the
//     spec's "about 30-40 cm" can't be literal here; the test holds the measured 0.51 m;
//   - reach and FoV together narrow it: 0.30 m wide (spec: 0.62), pads 8 x 7 cm at ±0.10, converging
//     toward the middle (still plainly left / middle / right, and each within its lane's half-width);
//   - the menu row is gone: the prompt (a spell's targets, the mulligan) floats over the altar's
//     middle, and nothing floats past the near edge.

export const BOARD = { w: 0.5, d: 0.35 };
export const LANES = 3;
export const ROWS = 6;
export const LANE_W = BOARD.w / LANES;
export const ROW_D = BOARD.d / ROWS;

export const ALTAR = { w: 0.3, d: 0.1, h: 0.025, z: 0.4 };
export const PAD = { w: 0.08, d: 0.07, x: [-0.1, 0, 0.1] }; // lane 0, 1, 2 from the player's left
export const CARD = { w: 0.054, d: 0.086 }; // CR80 portrait, like the paper cards
export const DECK = { x: ALTAR.w / 2 + 0.03, z: ALTAR.z };
export const CASTLE_PLAQUE = { w: 0.2, d: 0.03, h: 0.01, z: BOARD.d / 2 + 0.01 };
export const FAR_KEEP = { w: 0.12, d: 0.05, h: 0.12, z: -BOARD.d / 2 - 0.03 };
export const HAND = { z: 0.5, y: 0.18, spread: 0.1 }; // the fan's centre and half-width
export const PROMPT = { y: 0.08, z: ALTAR.z, w: 0.27, h: 0.06 }; // three tiles, each 9 x 6 cm

// The Tea House's doors (0039, amended to the canon of JP's *Inner Authority*; the bible is in
// scratch/lore/). The six realm doors stand round the room at the edge of view, outside the ±32° kept
// for play ("nothing essential ever sits in a door") and inside a Quest's view. `realm` is the canon
// name. `faction` pairs a realm with the engine's faction for the doors' reactions: a PROPOSAL to JP
// (Tide ~ the Deep Tides, Ember ~ the Forge Peaks), not canon.
export const DOORS = [
  { realm: 'Deep Tides', faction: 'tide', yawDeg: 42 }, // the blue door (canon)
  { realm: 'Forge Peaks', faction: 'ember', yawDeg: -42 },
  { realm: 'Hearthlands', faction: null, yawDeg: -56 },
  { realm: 'Wandering Courts', faction: null, yawDeg: 56 },
  { realm: 'Star Fields', faction: null, yawDeg: -70 },
  { realm: 'the Dreaming', faction: null, yawDeg: 70 },
];
// The red door (canon: "the red door" opens onto the Dueling Grounds, a pocket dimension). It stands
// straight ahead in the Tea House while the table is gathering, and is gone once the match is on:
// the board takes its place. It is never shown during play, so it has no FoV constraint then.
export const RED_DOOR = { yawDeg: 0, lobbyOnly: true };
export const DOOR_DISTANCE = 1.8;

export function doorCenter(d) {
  const yaw = (d.yawDeg * Math.PI) / 180;
  return { x: Math.sin(yaw) * DOOR_DISTANCE, y: 0.8, z: PLACE.ahead - Math.cos(yaw) * DOOR_DISTANCE };
}

// Where the board goes at the first immersive frame, relative to the head (the player then places
// it for real): its centre 0.70 m ahead and 0.42 m down, which keeps the board inside 0039's 50°.
export const PLACE = { ahead: 0.7, down: 0.42 };

// A cell's centre on the board, for seat `seat` seen from the person's side. `near` is the seat
// nearest the player (the person's own seat), whose back cell (cell 0) is the row nearest them.
export function cellCenter(seat, lane, cell, near) {
  const row = seat === near ? ROWS - 1 - cell : cell; // row 0 = the far edge
  return { x: -BOARD.w / 2 + LANE_W * (lane + 0.5), y: 0, z: -BOARD.d / 2 + ROW_D * (row + 0.5) };
}

export function padCenter(lane) {
  return { x: PAD.x[lane], y: ALTAR.h, z: ALTAR.z };
}

// The head at the default placement, and the gaze (toward the board's centre).
export function defaultHead() {
  return { x: 0, y: PLACE.down, z: PLACE.ahead };
}

// A point's yaw and pitch, in degrees, off the gaze from `head` to the board's centre.
export function offGaze(p, head = defaultHead()) {
  const g = norm(sub({ x: 0, y: 0, z: 0 }, head));
  const v = norm(sub(p, head));
  const yaw = Math.atan2(v.x, -v.z) - Math.atan2(g.x, -g.z);
  const pitch = Math.asin(v.y) - Math.asin(g.y);
  return { yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI };
}

// Everything the player must see to play, by name: the board's corners, the far keep's top, the
// altar's corners and pads, the deck, the hand fan's ends and the prompt.
export function essentials() {
  const out = {};
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out[`board ${sx},${sz}`] = { x: (sx * BOARD.w) / 2, y: 0, z: (sz * BOARD.d) / 2 };
  out['far keep top'] = { x: 0, y: FAR_KEEP.h, z: FAR_KEEP.z };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out[`altar ${sx},${sz}`] = { x: (sx * ALTAR.w) / 2, y: ALTAR.h, z: ALTAR.z + (sz * ALTAR.d) / 2 };
  for (let l = 0; l < LANES; l++) out[`pad ${l}`] = padCenter(l);
  out.deck = { x: DECK.x, y: 0.03, z: DECK.z };
  for (const sx of [-1, 1]) out[`hand ${sx}`] = { x: sx * HAND.spread, y: HAND.y, z: HAND.z };
  out.prompt = { x: 0, y: PROMPT.y, z: PROMPT.z };
  return out;
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const norm = (a) => {
  const n = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / n, y: a.y / n, z: a.z / n };
};
```

### Task L5: a whole match played only by gestures, on the real wasm

- [ ] **Step 1:** Copy the wasm from lane R's build into `test/fixtures/tapstone_web.wasm`, or point `TAPSTONE_WASM` at it.
- [ ] **Step 2: The test:** `test/match.test.js`

```js
// A whole match played through gestures only, on the real in-page arena (tapstone_web.wasm from
// Task R2): every move is chosen as the web gate chooses (the first useful non-mulligan item), turned
// into a gesture, matched back to the menu, and proposed. It proves hands can reach every move the
// engine offers, and that the hand the page shows is the one it plays from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { matchGesture, gestureForItem } from '../src/logic/menu.js';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = process.env.TAPSTONE_WASM ?? join(here, 'fixtures/tapstone_web.wasm');

async function openTable(seed, human) {
  const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {});
  const x = instance.exports;
  const read = (n) => new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.out_ptr(), n));
  x.table_new(BigInt(seed), human);
  return { x, read };
}

test('a whole match, every move made by a gesture, and the round trip exact', async () => {
  const { x, read } = await openTable(11, 0);
  let taps = 0, kinds = new Set();
  for (let s = 0n; s < 60000n; s++) {
    x.table_step(s * 10n);
    if (x.table_done()) break;
    const menu = JSON.parse(read(x.table_choices()));
    const i = menu.findIndex((m) => m.useful && m.kind !== 'Mulligan');
    if (i < 0) continue;
    const hand = JSON.parse(read(x.table_hand()));
    const g = gestureForItem(menu[i]);
    assert.ok(g, `no gesture for ${menu[i].kind}`);
    if (g.source === 'hand') assert.ok(hand.some((c) => c.card === g.card), `${menu[i].label}: the card is not in the shown hand`);
    const r = matchGesture(menu, g);
    // Round trip: the gesture picks an item with the same move (a repeated identical move may sit
    // earlier in the menu; the kind, card, lane and target must match).
    const picked = menu[r.index];
    assert.ok(picked, `${menu[i].label}: the gesture picked nothing (${JSON.stringify(r)})`);
    for (const f of ['kind', 'card', 'lane', 'target', 'aux']) assert.equal(picked[f], menu[i][f], `${menu[i].label}: ${f}`);
    // propose indexes the menu last returned by table_choices (hand() doesn't reset it).
    assert.ok(x.table_propose(r.index, s * 10n), `${picked.label} was refused`);
    taps++;
    kinds.add(picked.kind);
  }
  assert.ok(x.table_done(), 'the match finished');
  assert.ok(taps >= 20, `taps ${taps}`);
  for (const k of ['Draw', 'Charge', 'CastUnit', 'Advance']) assert.ok(kinds.has(k), `${k} was played by a gesture (${[...kinds]})`);
});
```

- [ ] **Step 3: Run everything.** `node --test test/*.test.js`. Expected: **`tests 27 … pass 27 … fail 0`**.
- [ ] **Step 4: Perturb each once, with `timeout 30`, and restore:**

| Change | Expected red |
|---|---|
| effects: `if (hadBoard && last.kind === 'Advance') {` → `if (false) {` | `an advance is a move, never a death plus a summon` |
| effects: keep chips for seat 0 only | `every castle life lost is a keep chip, exactly` |
| gestures: `FlipDetector` flips at `dot < 0` | `the wrist flip has hysteresis` |
| layout: `BOARD = { w: 0.6, d: 0.42 }` (the spec's board) | both FoV tests |
| layout: `ALTAR.z = 0.255` (the first draft's altar, 0.60 m away) | `… and the altar is within a seated reach` |
| menu: `gestureForItem` answers Advance with a pass | `a whole match, every move made by a gesture` |
| menu: no `'lane'` branch | `a bare fingertip on a pad advances that lane` |

- [ ] **Step 5: Commit** `feat(xr): the table's pure logic, tested under Node`, then push `feat/m1b-logic`.

---

## Lane S: the scene (IWSDK)

The scene draws and listens; every decision is `logic/`'s or the engine's. These files **build with Vite against IWSDK rc.2 with no missing export**. They haven't run in IWER or on the Quest 2: that's Task S5 and Task V1.

### Task S1: the app, from the spike's scaffold

**Files:** Create `rust/tapstone-web/www/xr/` from `spike/xr-day1` at e49a3f9 (after the prerequisite push).

- [ ] **Step 1: Copy the scaffold and the proven helpers**, unchanged unless listed:

```sh
cd rust/tapstone-web/www && mkdir -p xr/src && git fetch origin spike/xr-day1
for f in package.json package-lock.json iwsdk.config.json vite.config.js index.html src/assets.js src/net.js; do
  git show e49a3f9:rust/tapstone-web/www/spike/$f > xr/$f; done
git archive e49a3f9 rust/tapstone-web/www/spike/public | tar -x --strip-components=4 -C xr   # xr/public/: profiles (vendored input models), scenes, ui
```
- Then set `"name": "tapstone-xr"` in `xr/package.json`.
- Delete the starter's unused `public/audio`, `public/gltf` and `public/textures`. That's spike-day1's 11 MB `dist/` trim.
- Keep `public/profiles/`. Those are the six vendored hand and controller models, and without them IWSDK fetches from jsdelivr after load.
- Run `npm ci`.

- [ ] **Step 2: Make a missing export fatal.** In `xr/vite.config.js`, replace `rollupOptions: { input: './index.html' },` with:

```js
rollupOptions: {
            input: './index.html',
            // A missing export is only a warning to Rollup, and the build exits 0 (a planted bad
            // import proved it). Make it fatal, so a wrong IWSDK name fails the build.
            onwarn(w, warn) {
                if (w.code === 'MISSING_EXPORT') throw new Error(w.message);
                warn(w);
            },
        },
```

- [ ] **Step 3:** Copy lane R's `tapstone_web.wasm` to `xr/public/`.

### Task S2: the scene modules

**Files:** Create in `rust/tapstone-web/www/xr/src/`: `tags.js`, `components.js`, `table.js`, `board.js`, `altar.js`, `hand.js`, `play.js`.

- [ ] **Step 1:** `src/tags.js`

```js
// tags.js: the tags the systems query. System-free, as IWSDK requires; registered with IWSDK by
// components.js (iwsdk.config.json's "components" module).
import { createComponent, Types } from '@iwsdk/core';

// A lane pad on the altar (lane 0..2 from the player's left): touch a card to it.
export const Pad = createComponent('Pad', { lane: { type: Types.Int8, default: 0 } });
// A card in the person's hand: `slot` indexes the hand array from table.hand().
export const HandCard = createComponent('HandCard', { slot: { type: Types.Int16, default: -1 } });
// The deck's top card (draw: touch it to any pad).
export const DeckTop = createComponent('DeckTop', {});
// The person's castle card (pass; twice within 3 s in the mulligan window = mulligan).
export const CastleCard = createComponent('CastleCard', {});
// A prompt tile over the altar: one of a spell's targets, by index into the prompt's options.
export const PromptTile = createComponent('PromptTile', { option: { type: Types.Int16, default: -1 } });
// A unit on the board that a spell may target: the raw target byte (seat << 4 | lane << 2 | cell).
export const TargetUnit = createComponent('TargetUnit', { target: { type: Types.Int16, default: -1 } });
```

- [ ] **Step 2:** `src/components.js` (IWSDK's component manifest imports its default export)

```js
// The components module iwsdk.config.json names: IWSDK's component manifest imports its default
// export (a build without it fails: "default is not exported by src/components.js").
import { defineComponents } from '@iwsdk/core';
import { CastleCard, DeckTop, HandCard, Pad, PromptTile, TargetUnit } from './tags.js';

export default defineComponents([Pad, HandCard, DeckTop, CastleCard, PromptTile, TargetUnit]);
```

- [ ] **Step 3:** `src/table.js`

```js
// table.js: the in-page arena (tapstone_web.wasm, plan M1a) behind a small JS face. Each frame the
// page advances the simulated clock in 10 ms steps; views arrive as JSON lines. choices() is the
// engine's own menu for the person's seat, hand() their cards (private to this page), seat() the
// seat their shrine holds (null until the claim lands).
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
        if (n) for (const line of read(n).split('\n')) onView(JSON.parse(line));
      }
    },
    choices: () => JSON.parse(read(x.table_choices())),
    hand: () => JSON.parse(read(x.table_hand())),
    seat: () => {
      const s = x.table_seat();
      return s === 255 ? null : s;
    },
    propose: (i) => !!x.table_propose(i, clock),
    done: () => !!x.table_done(),
    now: () => Number(clock),
  };
}
```

- [ ] **Step 4:** `src/board.js`

```js
// board.js: the battlefield drawn from the view JSON (spec 2026-09-25 §3.1): 3 lanes x 6 cells,
// the units, my castle plaque and the far keep. It holds no rules; applyView draws what the engine
// said. 0027 in 3D: the person's own units are objects (tall, lit, stats on a plate); the other
// seat's are entries (low stone plinths with one tag). Positions come from logic/layout.js, the same
// numbers the FoV test checks.
import { BoxGeometry, CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from '@iwsdk/core';
import { BOARD, CASTLE_PLAQUE, FAR_KEEP, LANE_W, ROW_D, cellCenter } from './logic/layout.js';

export const FACTION = { ember: 0xe0663a, tide: 0x3a9be0, neutral: 0x7d8793 };

// A small canvas label, redrawn in place.
export function label(w = 256, h = 96, bg = 'rgba(16,20,26,0.85)', fg = '#f0ece2') {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new CanvasTexture(c);
  const draw = (text) => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    const lines = String(text).split('\n');
    const size = Math.floor(h / (lines.length + 0.5));
    g.font = `600 ${size}px system-ui, sans-serif`;
    g.textAlign = 'center';
    lines.forEach((l, i) => g.fillText(l, w / 2, size * (i + 1), w - 8));
    tex.needsUpdate = true;
  };
  return { tex, draw };
}

export class Board {
  constructor() {
    this.group = new Group();
    const base = new Mesh(new PlaneGeometry(BOARD.w, BOARD.d), new MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.9 }));
    base.rotation.x = -Math.PI / 2;
    this.group.add(base);
    const cellGeo = new PlaneGeometry(LANE_W * 0.92, ROW_D * 0.88);
    for (let lane = 0; lane < 3; lane++) {
      for (let row = 0; row < 6; row++) {
        const m = new Mesh(cellGeo, new MeshBasicMaterial({ color: row < 3 ? 0x444a5c : 0x3c4252 }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(-BOARD.w / 2 + LANE_W * (lane + 0.5), 0.001, -BOARD.d / 2 + ROW_D * (row + 0.5));
        this.group.add(m);
      }
    }
    // One figure and one plinth per (seat, lane, cell), shown per view: pooled, so a view never allocates.
    this.slots = new Map();
    const figureGeo = new BoxGeometry(LANE_W * 0.45, 1, ROW_D * 0.55);
    const plinthGeo = new BoxGeometry(LANE_W * 0.55, 0.012, ROW_D * 0.6);
    for (let seat = 0; seat < 2; seat++) {
      for (let lane = 0; lane < 3; lane++) {
        for (let cell = 0; cell < 3; cell++) {
          const figure = new Mesh(figureGeo, new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
          const plinth = new Mesh(plinthGeo, new MeshStandardMaterial({ color: 0x6d7480, roughness: 1 }));
          const tag = label(192, 64);
          const plate = new Mesh(new PlaneGeometry(LANE_W * 0.7, 0.022), new MeshBasicMaterial({ map: tag.tex, transparent: true, side: DoubleSide }));
          figure.visible = plinth.visible = plate.visible = false;
          this.group.add(figure, plinth, plate);
          this.slots.set(`${seat}:${lane}:${cell}`, { figure, plinth, plate, tag, seat, lane, cell });
        }
      }
    }
    this.myPlaque = new Mesh(new BoxGeometry(CASTLE_PLAQUE.w, CASTLE_PLAQUE.h, CASTLE_PLAQUE.d), new MeshStandardMaterial({ color: 0x7d8793 }));
    this.myPlaque.position.set(0, CASTLE_PLAQUE.h / 2, CASTLE_PLAQUE.z);
    this.farKeep = new Mesh(new BoxGeometry(FAR_KEEP.w, FAR_KEEP.h, FAR_KEEP.d), new MeshStandardMaterial({ color: 0x7d8793 }));
    this.farKeep.position.set(0, FAR_KEEP.h / 2, FAR_KEEP.z);
    this.group.add(this.myPlaque, this.farKeep);
    this.lifeTags = [label(256, 64), label(256, 64)];
    this.lifeMeshes = this.lifeTags.map((t) => new Mesh(new PlaneGeometry(0.16, 0.04), new MeshBasicMaterial({ map: t.tex, transparent: true, side: DoubleSide })));
    this.lifeMeshes[0].position.set(0, 0.035, CASTLE_PLAQUE.z + 0.02);
    this.lifeMeshes[0].rotation.x = -Math.PI / 4;
    this.lifeMeshes[1].position.set(0, FAR_KEEP.h + 0.03, FAR_KEEP.z);
    this.group.add(...this.lifeMeshes);
  }

  // The world position of a cell's centre (for effects).
  cellWorld(seat, lane, cell, near, out) {
    const p = cellCenter(seat, lane, cell, near);
    return this.group.localToWorld(out.set(p.x, p.y, p.z));
  }

  // Draw a view (the board to show: view, or last_over after a result) for the person in `near`.
  applyView(v, near) {
    const b = v.phase === 'lobby' && !v.lobby.length && v.last_over ? v.last_over : v;
    for (const s of this.slots.values()) s.figure.visible = s.plinth.visible = s.plate.visible = false;
    if (!b.seats || !b.seats.length) return;
    for (const s of this.slots.values()) {
      const u = b.seats[s.seat].cells[s.lane][s.cell];
      if (!u) continue;
      const p = cellCenter(s.seat, s.lane, s.cell, near);
      const hp = u.toughness - u.damage;
      const colour = FACTION[u.faction] ?? FACTION.neutral;
      if (s.seat === near) {
        // mine: an object, its height the unit's remaining health, a commander taller
        const h = 0.03 + 0.006 * Math.min(hp, 8) + (u.commander ? 0.02 : 0);
        s.figure.scale.set(1, h, 1);
        s.figure.position.set(p.x, h / 2, p.z);
        s.figure.material.color.setHex(colour);
        s.figure.material.emissive?.setHex(u.commander ? 0x332200 : 0x000000);
        s.figure.visible = true;
        s.tag.draw(`${u.commander ? '♛ ' : ''}${u.attack} / ${hp}${u.keyword ? ` ${u.keyword}` : ''}`);
        s.plate.position.set(p.x, h + 0.018, p.z + ROW_D * 0.3);
      } else {
        // theirs: an entry, a low plinth in their colour and one small tag
        s.plinth.position.set(p.x, 0.006, p.z);
        s.plinth.material.color.setHex(colour);
        s.plinth.visible = true;
        s.tag.draw(`${u.commander ? '♛' : ''}${u.attack}/${hp}${u.keyword ? ` ${u.keyword.slice(0, 2)}` : ''}`);
        s.plate.position.set(p.x, 0.03, p.z);
      }
      s.plate.visible = true;
    }
    const mine = b.seats[near], theirs = b.seats[1 - near];
    this.myPlaque.material.color.setHex(FACTION[mine.faction] ?? FACTION.neutral);
    this.farKeep.material.color.setHex(FACTION[theirs.faction] ?? FACTION.neutral);
    this.lifeTags[0].draw(`♥ ${mine.life}  mana ${mine.charged - mine.spent}/${mine.charged}`);
    this.lifeTags[1].draw(`♥ ${theirs.life}`);
  }
}
```

- [ ] **Step 5:** `src/altar.js`

```js
// altar.js: the virtual shrine as a low stone with three lane pads on top (spec 2026-09-25 §3.1),
// its eye and voice line on the front face, the deck at its right end, the castle card at its left,
// and the prompt (a spell's targets) over its middle. Pads take a fingertip poke AND a ray pinch
// (spike-day1.md: IWSDK makes poke a separate opt-in, PokeInteractable; one Pressed handler serves
// both). Cards take OneHandGrabbable, so a card follows the hand that pinched it.
import {
  BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, OneHandGrabbable,
  PlaneGeometry, PokeInteractable, RayInteractable, SphereGeometry,
} from '@iwsdk/core';
import { ALTAR, CARD, DECK, PAD, PROMPT } from './logic/layout.js';
import { CastleCard, DeckTop, Pad, PromptTile } from './tags.js';
import { label } from './board.js';

export class Altar {
  constructor(world, parentEntity, parentGroup) {
    this.group = new Group();
    parentGroup.add(this.group);
    this.entity = world.createTransformEntity(this.group, parentEntity);
    const stone = new Mesh(new BoxGeometry(ALTAR.w, ALTAR.h, ALTAR.d), new MeshStandardMaterial({ color: 0x5b5f66, roughness: 1 }));
    stone.position.set(0, ALTAR.h / 2, ALTAR.z);
    this.group.add(stone);
    // Pads: sized for a fingertip (12 x 8 cm), lying on the stone.
    this.pads = [0, 1, 2].map((lane) => {
      const m = new Mesh(new PlaneGeometry(PAD.w, PAD.d), new MeshStandardMaterial({ color: 0x2b3440, emissive: 0x000000 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(PAD.x[lane], ALTAR.h + 0.001, ALTAR.z);
      const e = world.createTransformEntity(m, this.entity);
      e.addComponent(PokeInteractable);
      e.addComponent(RayInteractable);
      e.addComponent(Pad, { lane });
      return { m, e, lane };
    });
    // The eye: amber at rest, a red pulse on a refusal.
    this.eye = new Mesh(new SphereGeometry(0.008, 16, 12), new MeshBasicMaterial({ color: 0xe0a526 }));
    this.eye.position.set(0, ALTAR.h / 2, ALTAR.z + ALTAR.d / 2 + 0.002);
    this.group.add(this.eye);
    this.redUntil = 0;
    // The voice line on the front face: one sentence, newest wins (0032).
    this.voice = label(768, 64, 'rgba(16,20,26,0.9)');
    const v = new Mesh(new PlaneGeometry(ALTAR.w * 0.9, 0.022), new MeshBasicMaterial({ map: this.voice.tex, transparent: true, side: DoubleSide }));
    v.position.set(0, -0.014, ALTAR.z + ALTAR.d / 2 + 0.003);
    this.group.add(v);
    // The deck: a short stack, its top card grabbable.
    const stack = new Mesh(new BoxGeometry(CARD.w, 0.02, CARD.d), new MeshStandardMaterial({ color: 0x3a2f28 }));
    stack.position.set(DECK.x, 0.01, DECK.z);
    this.group.add(stack);
    this.deckTop = cardMesh(0x5a4636);
    this.deckTop.position.set(DECK.x, 0.021, DECK.z);
    this.deckEntity = world.createTransformEntity(this.deckTop, this.entity);
    this.deckEntity.addComponent(OneHandGrabbable, {});
    this.deckEntity.addComponent(RayInteractable);
    this.deckEntity.addComponent(DeckTop);
    // The castle card, at the altar's left end.
    this.castle = cardMesh(0x7d8793);
    this.castle.position.set(-DECK.x, 0.002, DECK.z);
    this.castleEntity = world.createTransformEntity(this.castle, this.entity);
    this.castleEntity.addComponent(OneHandGrabbable, {});
    this.castleEntity.addComponent(RayInteractable);
    this.castleEntity.addComponent(CastleCard);
    // The prompt: up to three target tiles over the altar's middle, hidden until needed.
    this.prompt = [0, 1, 2].map((option) => {
      const lab = label(384, 96);
      const m = new Mesh(new PlaneGeometry(PROMPT.w / 3 - 0.006, PROMPT.h), new MeshBasicMaterial({ map: lab.tex, transparent: true, side: DoubleSide }));
      m.position.set(-PROMPT.w / 3 + option * (PROMPT.w / 3), PROMPT.y, PROMPT.z);
      m.rotation.x = -Math.PI / 6;
      const e = world.createTransformEntity(m, this.entity);
      e.addComponent(PokeInteractable);
      e.addComponent(RayInteractable);
      e.addComponent(PromptTile, { option });
      m.visible = false;
      return { m, e, lab };
    });
  }

  say(text) {
    this.voice.draw(text);
  }

  refuse(text, now) {
    this.say(text);
    this.redUntil = now + 600;
  }

  showPrompt(options) {
    this.prompt.forEach((t, k) => {
      const o = options[k];
      t.m.visible = !!o;
      if (o) t.lab.draw(o.label.replace(/^Cast /, ''));
    });
  }

  hidePrompt() {
    this.showPrompt([]);
  }

  // Put a card back where it rests (after a refusal, or after it was played).
  rest(mesh, x, y, z) {
    mesh.position.set(x, y, z);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
  }

  update(now) {
    this.eye.material.color.setHex(now < this.redUntil ? 0xd9534f : 0xe0a526);
  }
}

// A card-sized thin box lying flat, face up (+y).
export function cardMesh(colour) {
  const m = new Mesh(new BoxGeometry(CARD.w, 0.002, CARD.d), new MeshStandardMaterial({ color: colour }));
  return m;
}
```

- [ ] **Step 6:** `src/hand.js`

```js
// hand.js: the person's cards, fanned low in front of them (spec 2026-09-25 §3.1), drawn from
// table.hand() (the page's own shrine knows its hand; the view carries only a count). Each card is
// OneHandGrabbable, so a pinch picks it up and it follows the hand; RayInteractable, so the
// eyes-and-hands path can select it from afar. The face is read from the card's own orientation:
// its local +y dotted with world up (1 = face up), through FlipDetector's hysteresis.
import { CanvasTexture, Mesh, MeshStandardMaterial, OneHandGrabbable, RayInteractable, Vector3, BoxGeometry } from '@iwsdk/core';
import { CARD, HAND } from './logic/layout.js';
import { FlipDetector } from './logic/gestures.js';
import { HandCard } from './tags.js';
import { FACTION } from './board.js';

const MAX = 10;

function face(card) {
  const c = document.createElement('canvas');
  c.width = 216;
  c.height = 344;
  const g = c.getContext('2d');
  g.fillStyle = '#efe6cf';
  g.fillRect(0, 0, 216, 344);
  g.fillStyle = `#${(FACTION[card.faction] ?? FACTION.neutral).toString(16).padStart(6, '0')}`;
  g.fillRect(10, 10, 196, 150);
  g.fillStyle = '#2a2622';
  g.font = '600 26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(card.name, 108, 200, 196);
  g.font = '500 22px system-ui, sans-serif';
  g.fillText(`cost ${card.cost}`, 108, 240);
  if (card.kind === 'unit') g.fillText(`${card.attack} / ${card.toughness}${card.keyword ? `  ${card.keyword}` : ''}`, 108, 280);
  else if (card.effect) g.fillText(card.effect, 108, 280, 196);
  return new CanvasTexture(c);
}

export class Hand {
  constructor(world, parentEntity, parentGroup) {
    this.cards = [];
    for (let slot = 0; slot < MAX; slot++) {
      const mesh = new Mesh(new BoxGeometry(CARD.w, 0.002, CARD.d), new MeshStandardMaterial({ color: 0xffffff }));
      mesh.visible = false;
      parentGroup.add(mesh);
      const e = world.createTransformEntity(mesh, parentEntity);
      e.addComponent(OneHandGrabbable, {});
      e.addComponent(RayInteractable);
      e.addComponent(HandCard, { slot });
      this.cards.push({ mesh, e, flip: new FlipDetector(), data: null, key: '' });
    }
    this.up = new Vector3();
  }

  // Show `hand` (table.hand()'s array); cards not held return to the fan.
  set(hand, heldSlots) {
    const n = Math.min(hand.length, MAX);
    this.cards.forEach((c, slot) => {
      const card = hand[slot];
      c.mesh.visible = slot < n;
      if (!card) {
        c.data = null;
        return;
      }
      const key = `${card.card}:${card.name}`;
      if (key !== c.key) {
        c.key = key;
        c.data = card;
        c.mesh.material.map = face(card);
        c.mesh.material.needsUpdate = true;
      }
      if (!heldSlots.has(slot)) this.fan(c, slot, n);
    });
  }

  fan(c, slot, n) {
    const t = n > 1 ? slot / (n - 1) - 0.5 : 0; // -0.5 .. 0.5
    c.mesh.position.set(t * 2 * HAND.spread, HAND.y - Math.abs(t) * 0.02, HAND.z);
    c.mesh.rotation.set(-Math.PI / 3, 0, -t * 0.5); // tilted toward the player, fanned
  }

  // Face up or down for a held card this frame.
  faceOf(slot) {
    const c = this.cards[slot];
    this.up.set(0, 1, 0).applyQuaternion(c.mesh.getWorldQuaternion(c.mesh.quaternion.clone()));
    return c.flip.update(this.up.y);
  }
}
```

- [ ] **Step 7:** `src/play.js`, the one door to the engine:

```js
// play.js: the table system. It advances the in-page arena, draws each view, and turns the
// person's gestures into menu picks (logic/menu.js): the engine's own menu is the only source of
// moves, so a gesture either picks one of them or is refused locally, and a refused card goes back to
// the hand at no cost (spec 2026-09-25 §3.2).
//
// Two paths to every action (spec §3.2, "an eyes-and-hands path for everything"):
//   touch: pinch a card (OneHandGrabbable), turn the wrist for face down, touch it to a pad;
//   eyes-and-hands: ray-pinch a card to lift it (pinch it again to turn it face down), then
//   ray-pinch or poke a pad. The same gesture object goes to matchGesture either way.
//   advance: a pad pressed with no card lifted advances that lane (rules-v0: "touch a lane").
import { createSystem, Grabbed, Group, Pressed, Vector3, VisibilityState } from '@iwsdk/core';
import { Board } from './board.js';
import { Altar } from './altar.js';
import { Hand } from './hand.js';
import { CastleCard, DeckTop, HandCard, Pad, PromptTile, TargetUnit } from './tags.js';
import { openTable } from './table.js';
import { markLoaded, preloadProfiles } from './net.js';
import { matchGesture, gestureForItem } from './logic/menu.js';
import { CastleTaps, TargetTimer, pressKind } from './logic/gestures.js';
import { PLACE, padCenter } from './logic/layout.js';

const SEED = 11, HUMAN = 0;
const TOUCH = { flat: 0.045, height: 0.03 }; // a held card counts as touching a pad within these (m)

export class PlaySystem extends createSystem({
  heldCards: { required: [HandCard, Grabbed] },
  heldDeck: { required: [DeckTop, Grabbed] },
  heldCastle: { required: [CastleCard, Grabbed] },
  pressedCards: { required: [HandCard, Pressed] },
  pressedDeck: { required: [DeckTop, Pressed] },
  pressedCastle: { required: [CastleCard, Pressed] },
  pressedPads: { required: [Pad, Pressed] },
  pressedPrompt: { required: [PromptTile, Pressed] },
  pressedUnits: { required: [TargetUnit, Pressed] },
}) {
  init() {
    this.root = new Group();
    this.rootEntity = this.world.createTransformEntity(this.root);
    this.board = new Board();
    this.root.add(this.board.group);
    this.altar = new Altar(this.world, this.rootEntity, this.root);
    this.hand = new Hand(this.world, this.rootEntity, this.root);
    this.table = null;
    this.view = null;
    this.prev = null;
    this.menu = [];
    this.handCards = [];
    this.near = HUMAN;
    this.placed = false;
    this.frames = 0;
    this.touched = new Set(); // grab ids that already touched a pad this grab
    this.lifted = null; // eyes-and-hands: { source, slot?, face }
    this.castle = new CastleTaps();
    this.target = new TargetTimer();
    this.pendingSpell = null;
    this.stats = { taps: 0, refused: 0, poke: 0, ray: 0, touch: 0 };
    this.onView = null; // set by EffectsSystem: (prev, next, near) => void
    this.queries.pressedCards.subscribe('qualify', (e) => this.liftCard(e.getValue(HandCard, 'slot')));
    this.queries.pressedDeck.subscribe('qualify', () => this.lift({ source: 'deck' }));
    this.queries.pressedCastle.subscribe('qualify', () => this.castleTap());
    this.queries.pressedPads.subscribe('qualify', (e) => this.padPressed(e.getValue(Pad, 'lane'), e));
    this.queries.pressedPrompt.subscribe('qualify', (e) => this.promptPressed(e.getValue(PromptTile, 'option')));
    this.queries.pressedUnits.subscribe('qualify', (e) => this.unitPressed(e.getValue(TargetUnit, 'target')));
    Promise.all([openTable(`${import.meta.env.BASE_URL}tapstone_web.wasm`, SEED, HUMAN), preloadProfiles(import.meta.env.BASE_URL)]).then(([t]) => {
      this.table = t;
      markLoaded();
      globalThis.__tapstone = {
        table: t,
        play: this,
        stats: () => ({ ...this.stats, done: t.done(), seat: this.near }),
        // Test hook (the IWER gate): one move chosen as the web gate chooses, sent through the SAME
        // gesture path the hands use (play(gesture)), never propose() directly.
        gestureStep: () => {
          const menu = t.choices();
          const item = menu.find((m) => m.useful && m.kind !== 'Mulligan');
          if (item) this.play(gestureForItem(item));
          return item ? item.label : null;
        },
      };
    });
  }

  now() {
    return performance.now();
  }

  // ---- the eyes-and-hands path ----------------------------------------------------------------
  liftCard(slot) {
    if (this.lifted && this.lifted.source === 'hand' && this.lifted.slot === slot) {
      this.lifted.face = this.lifted.face === 'up' ? 'down' : 'up'; // a second pinch turns it over
      this.altar.say(this.lifted.face === 'down' ? 'Face down: touch a pad to charge it.' : 'Face up: touch the pad under a lane.');
      return;
    }
    this.lift({ source: 'hand', slot, face: 'up' });
  }

  lift(l) {
    this.lifted = l;
    const card = l.source === 'hand' ? this.handCards[l.slot] : null;
    this.altar.say(card ? `${card.name}: touch a pad.` : l.source === 'deck' ? 'The top card: touch a pad to draw it.' : '');
  }

  padPressed(lane, entity) {
    const tip = this.fingertipDistanceTo(entity);
    const kind = pressKind(tip);
    this.stats[kind]++;
    if (!this.lifted) {
      // A bare fingertip (or a pinch) on a lane's pad, with no card lifted: advance that lane.
      this.play({ source: 'lane', pad: lane });
      return;
    }
    const l = this.lifted;
    this.lifted = null;
    this.play(this.gestureFor(l.source, l.slot, l.face, lane));
  }

  // ---- the touch path: a held card meets a pad ----------------------------------------------
  checkTouches() {
    const held = [
      ...[...this.queries.heldCards.entities].map((e) => ({ e, source: 'hand', slot: e.getValue(HandCard, 'slot') })),
      ...[...this.queries.heldDeck.entities].map((e) => ({ e, source: 'deck' })),
      ...[...this.queries.heldCastle.entities].map((e) => ({ e, source: 'castle' })),
    ];
    const p = new Vector3(), q = new Vector3();
    for (const h of held) {
      const id = h.e.index;
      if (this.touched.has(id)) continue;
      h.e.object3D.getWorldPosition(p);
      for (let lane = 0; lane < 3; lane++) {
        const c = padCenter(lane);
        this.root.localToWorld(q.set(c.x, c.y, c.z));
        const flat = Math.hypot(p.x - q.x, p.z - q.z), up = p.y - q.y;
        if (flat <= TOUCH.flat && up >= -0.01 && up <= TOUCH.height) {
          this.touched.add(id);
          this.stats.touch++;
          if (h.source === 'castle') this.castleTap();
          else this.play(this.gestureFor(h.source, h.slot, h.source === 'hand' ? this.hand.faceOf(h.slot) : 'up', lane));
          break;
        }
      }
    }
    // A released card may touch again on its next grab.
    const live = new Set(held.map((h) => h.e.index));
    for (const id of this.touched) if (!live.has(id)) this.touched.delete(id);
  }

  gestureFor(source, slot, face, lane) {
    if (source === 'deck') return { source: 'deck' };
    const card = this.handCards[slot];
    return { source: 'hand', card: card ? card.card : -1, face, pad: lane };
  }

  // ---- the castle: pass, or (inside the mulligan window) twice within 3 s to mulligan ----------
  castleTap() {
    const open = this.menu.some((m) => m.kind === 'Mulligan');
    const r = this.castle.tap(this.now(), open);
    if (r === 'pending') this.altar.say('Pass. Tap the castle again within 3 s to mulligan.');
    else this.play({ source: 'castle', action: r });
  }

  // ---- a spell's target ----------------------------------------------------------------------
  promptPressed(option) {
    if (!this.target.active || !this.target.options[option]) return;
    const index = this.target.pick(this.target.options[option].target);
    this.altar.hidePrompt();
    if (index !== null) this.propose(index);
  }

  unitPressed(target) {
    if (!this.target.active) return;
    const index = this.target.pick(target);
    if (index !== null) {
      this.altar.hidePrompt();
      this.propose(index);
    }
  }

  // ---- the one door to the engine --------------------------------------------------------------
  play(g) {
    if (!this.table) return;
    this.menu = this.table.choices();
    const r = matchGesture(this.menu, g);
    if (r.index !== undefined) return this.propose(r.index);
    if (r.need === 'target') {
      this.target.start(this.now(), r.options, 0);
      this.altar.showPrompt(r.options);
      this.altar.say('Choose a target: look and pinch, or wait 3 s for the nearest.');
      return;
    }
    this.stats.refused++;
    this.altar.refuse(r.refused, this.now());
  }

  propose(index) {
    const item = this.menu[index];
    if (this.table.propose(index)) {
      this.stats.taps++;
      this.altar.say(item ? item.label : '');
    } else {
      this.stats.refused++;
      this.altar.refuse('The stone refused that move.', this.now());
    }
    this.menu = [];
  }

  fingertipDistanceTo(entity) {
    const xr = this.world.renderer.xr, frame = xr.getFrame(), ref = xr.getReferenceSpace();
    const out = [];
    if (!frame || !ref || !entity.object3D) return out;
    const at = entity.object3D.getWorldPosition(new Vector3());
    for (const src of frame.session.inputSources) {
      const tip = src.hand && frame.getJointPose(src.hand.get('index-finger-tip'), ref);
      if (tip) out.push(at.distanceTo(new Vector3(tip.transform.position.x, tip.transform.position.y, tip.transform.position.z)));
    }
    return out;
  }

  // Until the player places the board: PLACE.ahead in front of the head and PLACE.down below it,
  // turned so its +z (the altar side) faces the head. Placement proper (a table hit-test and an
  // anchor, or palm-press on Quest 2) is spec §3.1's and replaces this once done.
  autoPlace() {
    // As the spike placed it (measured on the Quest 2): ahead along -z from the first head pose.
    const h = this.player.head.getWorldPosition(new Vector3());
    this.root.position.set(h.x, h.y - PLACE.down, h.z - PLACE.ahead);
    this.root.rotation.set(0, Math.atan2(h.x - this.root.position.x, h.z - this.root.position.z), 0);
    this.placed = true;
  }

  // The voice line, in the Tea House's manner: its intelligence "offers, never forces" (0039, from
  // the canon; scratch/lore/). Even an owed draw, which the engine requires, is put as an offer.
  voiceFor(v) {
    const me = v.seats && v.seats[this.near];
    if (!me) return v.phase === 'lobby' ? 'The table is gathering. Take your seat when you like.' : '';
    if (me.owed_draws > 0) return `${me.owed_draws === 1 ? 'A card waits' : `${me.owed_draws} cards wait`} in your deck: touch the top one to the stone.`;
    if (v.phase === 'over') return v.winner === this.near ? 'The duel is yours. The Tea House is open when you are ready.' : 'The duel is done. Another, when you are ready?';
    return v.active === this.near ? 'Your move, whenever you are ready.' : 'The other duelist is thinking.';
  }

  update(delta) {
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (immersive && !this.placed && ++this.frames === 2) this.autoPlace();
    if (!this.table) return;
    const now = this.now();
    let changed = false;
    this.table.advance(Math.min(delta * 1000, 100), (v) => {
      this.prev = this.view;
      this.view = v;
      changed = true;
      const seat = this.table.seat();
      if (seat !== null) this.near = seat;
      this.onView?.(this.prev, v, this.near);
    });
    if (changed) {
      this.board.applyView(this.view, this.near);
      this.menu = this.table.choices();
      this.handCards = this.table.hand();
      const held = new Set([...this.queries.heldCards.entities].map((e) => e.getValue(HandCard, 'slot')));
      this.hand.set(this.handCards, held);
      if (!this.target.active) this.altar.say(this.voiceFor(this.view));
    }
    this.checkTouches();
    const castle = this.castle.poll(now);
    if (castle) this.play({ source: 'castle', action: castle });
    const auto = this.target.poll(now);
    if (auto !== null) {
      this.altar.hidePrompt();
      this.propose(auto);
    }
    this.altar.update(now);
  }
}
```

### Task S3: the effects player

- [ ] **Step 1:** `src/effects-player.js`

```js
// effects-player.js: plays logic/effects.js's queue on the scene, one effect at a time (spec
// 2026-09-25 §3.2). Every effect is computed from two consecutive views, so nothing here is sent
// or hashed (0027's amendment). The board already shows the newest view; an effect only moves a
// marker over it, so dropping one (the queue compresses a backlog) loses motion, never state.
import { createSystem, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from '@iwsdk/core';
import { diffViews, EffectQueue, DURATION } from './logic/effects.js';
import { PlaySystem } from './play.js';
import { padCenter, CASTLE_PLAQUE, FAR_KEEP } from './logic/layout.js';
import { FACTION } from './board.js';

const ease = (t) => t * t * (3 - 2 * t);

export class EffectsSystem extends createSystem({}) {
  init() {
    this.queue = new EffectQueue();
    this.active = null;
    this.spark = new Mesh(new SphereGeometry(0.012, 12, 8), new MeshBasicMaterial({ color: 0xfff3c4, transparent: true }));
    this.spark.visible = false;
    this.listeners = [];
    this.bound = false;
  }

  // Other systems (the teahouse doors) hear every effect as it starts.
  onEffect(fn) {
    this.listeners.push(fn);
  }

  bind() {
    const play = this.world.getSystem(PlaySystem);
    if (!play || this.bound) return play;
    play.root.add(this.spark);
    play.onView = (prev, next, near) => this.queue.push(diffViews(prev, next, near));
    this.bound = true;
    return play;
  }

  start(e, play, now) {
    const a = new Vector3(), b = new Vector3();
    let from = null, to = null, colour = 0xfff3c4;
    const near = play.near;
    if (e.type === 'summon') {
      const pad = padCenter(e.lane);
      from = e.seat === near ? a.set(pad.x, pad.y + 0.02, pad.z) : a.set(0, FAR_KEEP.h, FAR_KEEP.z);
      to = play.board.group.worldToLocal(play.board.cellWorld(e.seat, e.lane, e.cell, near, b));
      colour = FACTION[e.faction] ?? colour;
    } else if (e.type === 'keepChip') {
      from = e.seat === near ? a.set(0, CASTLE_PLAQUE.h, CASTLE_PLAQUE.z) : a.set(0, FAR_KEEP.h, FAR_KEEP.z);
      to = b.copy(from).add(new Vector3(0.05, 0.08, 0));
      colour = 0xc9c1ad;
    } else if (e.type === 'damage' || e.type === 'death' || e.type === 'commanderFall' || e.type === 'commanderReturn') {
      const cell = e.cell ?? 0;
      from = play.board.group.worldToLocal(play.board.cellWorld(e.seat, e.lane, cell, near, a));
      to = b.copy(from).add(new Vector3(0, e.type === 'commanderReturn' ? 0.08 : 0.03, 0));
      colour = e.type === 'damage' ? 0xd9534f : e.type === 'death' ? 0x555555 : 0xe0a526;
    } else if (e.type === 'drawFlip' && e.seat === near) {
      // A draw is the Deck's element arriving by teleportation (0039, from the canon): a shimmer that
      // lands in the hand, not a card dealt from the deck.
      from = a.set(0, 0.35, 0.3);
      to = b.set(0, 0.18, 0.5);
      colour = 0xbfe6ff;
    } else if (e.type === 'chargeGem') {
      from = a.set(0.18, 0.03, CASTLE_PLAQUE.z + 0.05);
      to = b.copy(from).add(new Vector3(0, 0.02, 0));
      colour = 0x5bc0de;
    }
    this.active = { e, until: now + (DURATION[e.type] ?? 300), began: now, from: from && from.clone(), to: to && to.clone() };
    this.spark.visible = !!from;
    this.spark.material.color.setHex(colour);
    for (const fn of this.listeners) fn(e);
  }

  update() {
    const play = this.bind();
    if (!play) return;
    const now = performance.now();
    const next = this.queue.next(now);
    if (next) this.start(next, play, now);
    const a = this.active;
    if (!a) return;
    const t = Math.min(1, (now - a.began) / (a.until - a.began));
    if (a.from && a.to) {
      // An arc for a summon (the thread of light from the pad), a straight rise otherwise.
      this.spark.position.lerpVectors(a.from, a.to, ease(t));
      if (a.e.type === 'summon') this.spark.position.y += Math.sin(Math.PI * t) * 0.12;
      this.spark.material.opacity = 1 - t * 0.6;
    }
    if (t >= 1) {
      this.spark.visible = false;
      this.active = null;
    }
  }
}
```

### Task S4: boot, and the XR-entry pre-warm

- [ ] **Step 1:** `src/index.js`, replacing the spike's:

```js
/**
 * Tapstone in the headset (VR M1b): the in-page arena (tapstone_web.wasm) played with virtual
 * cards on a virtual altar, in the Tea House and on its Dueling Grounds (0039). Hands first:
 * touch or pinch.
 */
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { PlaySystem } from './play.js';
import { EffectsSystem } from './effects-player.js';
import { TeahouseSystem } from './teahouse.js';
import { netWatch } from './net.js';

netWatch(); // before anything else loads, so every request after "loaded" is counted

// XR entry stalled on the Quest 2 (spike-day1.md: min ~4 fps in the first frames, before any play):
// shaders compiled and models uploaded on first use. So everything is built and drawn once BEFORE the
// session starts: the systems create their pooled meshes in init(), then one compile pass runs.
function prewarm(world) {
  try {
    world.renderer.compile(world.scene, world.camera);
    console.log('[tapstone] prewarm: shaders compiled before XR entry');
  } catch (e) {
    console.warn('[tapstone] prewarm skipped', e);
  }
}

World.create(document.getElementById('scene-container'), projectOptions).then((world) => {
  world.registerSystem(PlaySystem);
  world.registerSystem(EffectsSystem);
  world.registerSystem(TeahouseSystem);
  requestAnimationFrame(() => prewarm(world));
});
```

- [ ] **Step 2: Build.** `npx vite build`. Expected: `✓ built`, exit 0.
  - **Perturb:** add `NotARealExport` to `teahouse.js`'s import list. Expected: exit 1 with `"NotARealExport" is not exported`. Restore it.
  - Without Step S1's `onwarn`, the same plant exits **0**. That's measured.

### Task S5: IWER: a whole match through the gesture path

`tools/cdp.mjs` evaluates an expression in the page over CDP:

```js
// Evaluate an expression in the Tapstone page over the Chrome DevTools Protocol: IWER's managed
// Chrome (katana :9222) or the Quest Browser (adb forward to CDP_PORT). Prints the value as JSON.
//   CDP_PORT=9222 PAGE_MATCH=localhost:8081 node tools/cdp.mjs '__tapstone.stats()'
const expr = process.argv[2];
const port = process.env.CDP_PORT || 9222, match = process.env.PAGE_MATCH || 'localhost';
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((p) => p.type === 'page' && p.url.includes(match));
if (!page) {
  console.error('no Tapstone page; pages:', pages.map((p) => p.url));
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
const reply = new Promise((r) => (ws.onmessage = (m) => r(JSON.parse(m.data))));
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `JSON.stringify(${expr})`, returnByValue: true } }));
const d = await reply;
ws.close();
console.log(d.result?.result?.value ?? JSON.stringify(d.result));
```

- [ ] **Step 1: Start IWER, enter XR, play.** This is the spike's method, `scratch/vr/iwer-drive.sh`, but each move is `__tapstone.gestureStep()`, which sends one gesture through `play()` and never calls `propose()` directly.

```sh
tmux new-session -d -s m1b-iwer -c rust/tapstone-web/www/xr 'npx @iwsdk/cli dev up --headless --foreground'
sleep 20 && npx @iwsdk/cli xr enter
for i in $(seq 1 400); do
  node tools/cdp.mjs '__tapstone.gestureStep()' >/dev/null
  node tools/cdp.mjs '__tapstone.stats()' | grep -q '"done":true' && break; sleep 0.3; done
node tools/cdp.mjs '__tapstone.stats()'; node tools/cdp.mjs '__tapstoneNet ?? __spikeNet'
```
Expected:
- `"done": true`, with `taps` of at least 20 and `refused` at 0;
- 0 requests after load, per `net.js`'s counter;
- the page's console shows `[tapstone] prewarm: shaders compiled before XR entry`.

- [ ] **Step 2: Commit and push** `feat/m1b-scene`.

---

## Lane T: the Tea House and its Dueling Grounds (0039)

**The canon is JP's *Inner Authority* and its Luna Multiverse bible** (`scratch/lore/inner-authority.md`, `scratch/lore/bible.txt`; it's an unpublished novel, so read it there and never quote it into the repo beyond short names and phrases).
- The canon gives: the Tea House as a safe-zone hub, with lantern light, a fireside and a Shinto/Mayan influence; the red door onto the Dueling Grounds; the six realm doors, with the blue door's look for the Deep Tides.
- Everything else is a `LORE:` slot: the four other doors' looks, the Grounds' look and the house's keeper.

### Task T1: the two places and the doors

- [ ] **Step 1:** `src/teahouse.js`. Door placement comes from `logic/layout.js` (`DOORS`, `RED_DOOR`), which Task L4's tests hold outside the play budget and inside the room, with the canon six realm names.

```js
// teahouse.js: the Tea House and its Dueling Grounds (0039, amended to the canon of JP's LitRPG
// *Inner Authority* and its Luna Multiverse bible; read it in scratch/lore/, never quote it here).
//
// Two places (0039):
//   - the Tea House, a safe-zone hub: where the table gathers (the lobby), the result beat and the
//     rematch happen. Lantern light, a fireside, comfortable seating, a Shinto/Mayan influence. Its
//     six realm doors stand at the edge of view as scenery that reacts to play, and the red door
//     stands ahead.
//   - the Dueling Grounds, a pocket dimension: when the match begins the red door opens, the Tea
//     House falls away and the board lies in the Grounds. At the result the red door returns you.
// Mixed reality: the player's own room is the Tea House; the red door and the realm doors appear as
// portals, and the board lies on the real table (spec §3.1). The full interior is the opaque (VR)
// setting. Doors never carry rules or offer a choice the table doesn't (0039).
import {
  AmbientLight, BoxGeometry, CanvasTexture, createSystem, CylinderGeometry, DoubleSide, Group, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, SphereGeometry,
} from '@iwsdk/core';
import { EffectsSystem } from './effects-player.js';
import { PlaySystem } from './play.js';
import { label } from './board.js';
import { DOORS, RED_DOOR, doorCenter } from './logic/layout.js';

// What the canon says each door looks like (short phrases only; the bible is in scratch/lore/).
// LORE: slots are what the bible doesn't describe; fill them from the bible or ask JP.
export const DOOR_LOOK = {
  'Deep Tides': { colour: 0x1d4f8a, motif: 'water', canon: 'the blue door: deep blue light, water motifs' },
  'Forge Peaks': { colour: 0x6b3a22, motif: 'plain', canon: 'LORE:forge-peaks-door-look' },
  Hearthlands: { colour: 0x5a4a2a, motif: 'plain', canon: 'LORE:hearthlands-door-look' },
  'Wandering Courts': { colour: 0x4a3a5a, motif: 'plain', canon: 'LORE:wandering-courts-door-look' },
  'Star Fields': { colour: 0x20243a, motif: 'plain', canon: 'LORE:star-fields-door-look' },
  'the Dreaming': { colour: 0x3a2a4a, motif: 'plain', canon: 'LORE:the-dreaming-door-look' },
};
export const RED_DOOR_LOOK = { colour: 0x7a1620, motif: 'geometric', canon: 'deep red, carved with interlocking geometric patterns' };
// LORE: the Dueling Grounds' own look (the bible calls it a pocket dimension, and says no more).
export const GROUNDS_LOOK = 'LORE:dueling-grounds-look';

// A door face's pattern, drawn procedurally (no asset pipeline): water motifs for the blue door,
// interlocking geometry for the red, a plain panel otherwise.
function doorFace(colour, motif) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  const hex = `#${colour.toString(16).padStart(6, '0')}`;
  g.fillStyle = hex;
  g.fillRect(0, 0, 128, 256);
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  g.lineWidth = 3;
  if (motif === 'water') {
    for (let y = 20; y < 256; y += 22) {
      g.beginPath();
      for (let x = 0; x <= 128; x += 8) g.lineTo(x, y + Math.sin(x / 12 + y) * 6);
      g.stroke();
    }
  } else if (motif === 'geometric') {
    for (let y = 0; y < 256; y += 32) for (let x = 0; x < 128; x += 32) {
      g.strokeRect(x + 4, y + 4, 24, 24);
      g.beginPath();
      g.moveTo(x + 4, y + 4);
      g.lineTo(x + 28, y + 28);
      g.moveTo(x + 28, y + 4);
      g.lineTo(x + 4, y + 28);
      g.stroke();
    }
  } else {
    g.strokeRect(12, 12, 104, 232);
  }
  return new CanvasTexture(c);
}

function makeDoor(look, name) {
  const door = new Group();
  const frame = new Mesh(new BoxGeometry(0.9, 1.9, 0.08), new MeshStandardMaterial({ color: 0x2a1d14 }));
  // A stepped lintel, a light nod to the canon's Shinto/Mayan influence (placeholder geometry).
  const lintel = new Mesh(new BoxGeometry(1.15, 0.08, 0.12), new MeshStandardMaterial({ color: 0x2a1d14 }));
  lintel.position.y = 1.0;
  const face = new Mesh(new PlaneGeometry(0.72, 1.7), new MeshBasicMaterial({ map: doorFace(look.colour, look.motif), transparent: true, opacity: 0.85, side: DoubleSide }));
  face.position.z = 0.05;
  const tag = label(384, 64, 'rgba(20,14,10,0.8)', '#f0e0c0');
  tag.draw(name);
  const plate = new Mesh(new PlaneGeometry(0.6, 0.1), new MeshBasicMaterial({ map: tag.tex, transparent: true }));
  plate.position.set(0, 1.12, 0.07);
  door.add(frame, lintel, face, plate);
  return { door, face };
}

export class TeahouseSystem extends createSystem({}) {
  init() {
    this.teahouse = new Group(); // the interior (opaque sessions only)
    this.grounds = new Group(); // the pocket dimension around the board
    this.doors = [];
    this.glow = new Map();
    this.built = false;
    this.place = 'teahouse'; // 'teahouse' | 'grounds'
  }

  build(play) {
    const opaque = this.world.renderer.xr.getSession()?.environmentBlendMode === 'opaque';
    play.root.add(this.teahouse, this.grounds);
    if (opaque) {
      // The Tea House: warm, lantern-lit, hand-made. Parts, baked colour, one warm light: cheap
      // enough for the Quest 2's 90 Hz (the spike held a 90.1 fps median).
      const floor = new Mesh(new PlaneGeometry(8, 8), new MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.4;
      const table = new Mesh(new BoxGeometry(0.9, 0.38, 0.8), new MeshStandardMaterial({ color: 0x5a3f2a, roughness: 0.8 }));
      table.position.set(0, -0.2 - 0.005, 0.1);
      this.teahouse.add(floor, table);
      for (const [x, z, ry] of [[0, -3, 0], [0, 3, Math.PI], [-3, 0, Math.PI / 2], [3, 0, -Math.PI / 2]]) {
        const wall = new Mesh(new PlaneGeometry(6, 3), new MeshStandardMaterial({ color: 0x4a3526, roughness: 1, side: DoubleSide }));
        wall.position.set(x, 1.1, z);
        wall.rotation.y = ry;
        this.teahouse.add(wall);
      }
      for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
        const lantern = new Mesh(new CylinderGeometry(0.06, 0.06, 0.14, 12), new MeshBasicMaterial({ color: 0xffc070 }));
        lantern.position.set(x, 0.9, z);
        this.teahouse.add(lantern);
      }
      // The fireside gathering place (canon: the Tea House has one), off to the side, out of play's view.
      const hearth = new Mesh(new SphereGeometry(0.12, 12, 8), new MeshBasicMaterial({ color: 0xff8a3a }));
      hearth.position.set(-2.2, -0.25, 1.4);
      this.teahouse.add(hearth);
      const warm = new PointLight(0xffb060, 1.2, 6);
      warm.position.set(0, 1.2, 0);
      this.teahouse.add(warm, new AmbientLight(0x604030, 0.6));
      // The Dueling Grounds: a dim pocket dimension, only the board lit (GROUNDS_LOOK is a LORE: slot).
      const sky = new Mesh(new SphereGeometry(6, 24, 16), new MeshBasicMaterial({ color: 0x0c0a14, side: DoubleSide }));
      this.grounds.add(sky, new AmbientLight(0x404060, 0.8));
    }
    // The realm doors, at the edge of view (layout.js; the FoV test keeps them out of play's way).
    for (const d of DOORS) {
      const c = doorCenter(d);
      const { door, face } = makeDoor(DOOR_LOOK[d.realm], d.realm);
      door.position.set(c.x, c.y - 0.4, c.z);
      door.rotation.y = Math.atan2(-c.x, 0.7 - c.z);
      this.teahouse.add(door);
      this.doors.push({ ...d, door, face });
      if (d.faction) this.glow.set(d.faction, 0);
    }
    // The red door, straight ahead while the table gathers.
    const red = makeDoor(RED_DOOR_LOOK, 'Dueling Grounds');
    const rc = doorCenter(RED_DOOR);
    red.door.position.set(rc.x, rc.y - 0.4, rc.z - 0.6);
    this.redDoor = red.door;
    play.root.add(this.redDoor);
    this.world.getSystem(EffectsSystem)?.onEffect((e) => this.react(e, play));
    this.built = true;
  }

  // The red door: open onto the Grounds when the match is on, back to the Tea House at the result.
  setPlace(place) {
    if (place === this.place) return;
    this.place = place;
    const onGrounds = place === 'grounds';
    this.teahouse.visible = !onGrounds;
    this.grounds.visible = onGrounds;
    this.redDoor.visible = !onGrounds; // RED_DOOR.lobbyOnly: never shown during play
  }

  // A door reacts to play; it never carries rules or offers a choice (0039). The faction pairings it
  // glows for are a PROPOSAL to JP (layout.js DOORS).
  react(e, play) {
    if (e.type === 'summon' && this.glow.has(e.faction)) this.glow.set(e.faction, 1);
    if (e.type === 'result' && e.winner !== null && play.view && play.view.seats) {
      const f = (play.view.last_over ?? play.view).seats?.[e.winner]?.faction;
      if (this.glow.has(f)) this.glow.set(f, 3);
    }
  }

  update(delta) {
    const play = this.world.getSystem(PlaySystem);
    if (!play) return;
    if (!this.built && this.world.renderer.xr.getSession()) this.build(play);
    if (!this.built) return;
    const v = play.view;
    this.setPlace(v && v.phase === 'playing' ? 'grounds' : 'teahouse');
    for (const d of this.doors) {
      if (!d.faction) continue;
      const g = this.glow.get(d.faction);
      d.face.material.opacity = 0.85 - 0.3 + Math.min(0.45, g * 0.25);
      d.door.scale.y = 1 + Math.min(0.15, g * 0.05);
      this.glow.set(d.faction, Math.max(0, g - delta * 0.8));
    }
  }
}
```

- [ ] **Step 2:** Register it in `index.js` (already in Task S4). Build: `npx vite build` exits 0.
- [ ] **Step 3: Fill the `LORE:` slots from the bible,** or open a question to JP for each one the bible doesn't answer. The code doesn't change: only `DOOR_LOOK`, `GROUNDS_LOOK` and the proposal flags on `DOORS`.

### Task T2: IWER check, and the mixed-reality mode

- [ ] In IWER (Task S5's session):
  - An **opaque (VR)** session starts in the Tea House, with the red door ahead.
  - When the match's first `playing` view arrives, the Tea House gives way to the Grounds, and the red door is gone.
  - On the result it returns.
  - In **AR**, only the portals show, and the board lies on the table.
- [ ] **Anchoring the realm doors to detected walls** (0039: "portals … beside the real table" or at the walls): M1b ships the fallback, beside the table. Wall anchoring through `XRPlane` is the next plan's first task, because it needs a Quest room scan.
- [ ] **The Roblox place's Tea House** belongs to the Selene lane (`feat/roblox-teahouse`), not this plan. It reads the same canon, so a door name or colour changed here should be changed there too.

---

## Task V1: the Quest 2 sheet (by hand, JP; results in `scratch/vr/m1b-quest.md` with the date)

Serve `dist/` as the spike did (`python3 -m http.server 8082 --bind 127.0.0.1 --directory dist`, `adb reverse tcp:8082 tcp:8082`, then Quest Browser on `http://localhost:8082/`). Read `__tapstone.stats()` over `tools/cdp.mjs` (`CDP_PORT=9333`, the spike's forward).

1. **Poke:** a fingertip on a pad (no card) advances that lane. `stats().poke` rises.
2. **Touch:** pinch a hand card, touch it face up to pad N, and it's cast in lane N. `stats().touch` rises.
3. **Flip:** turn the wrist so the card is face down, touch a pad, and it's charged (a gem lights).
4. **Deck:** pinch the deck's top card, touch a pad, and it's drawn (the card flips into the hand).
5. **Castle:** touch it to a pad to pass. In the mulligan window, twice within 3 s mulligans.
6. **Target:** a spell with several targets shows the prompt. Look and pinch a unit, or wait 3 s for the default.
7. **Refusal:** play a card that can't go there. The eye pulses red, the voice line explains, and the card returns.
8. **Eyes and hands:** a whole turn played by ray and pinch only, with no reaching.
9. **Animations:** the summon arc from the pad, the clash, a death, a keep chip, a gem, a draw flip.
10. **FoV:** nothing essential outside the view while seated. The realm doors are at the edge.
11. **The Tea House:** a VR session starts there, the red door opens onto the Dueling Grounds when the match begins, and the result brings you back. The voice line reads as an offer.
12. **Frame rate:** the median holds 90 on the Quest 2. The **XR-entry minimum** is now above the spike's ~4 fps (the pre-warm).
13. **Hands only:** `stats()` taps all hands-only. The headset's hand-tracking service is the second instrument (spike-day1.md).

## After this plan

- Doors anchored to detected walls in mixed reality (`XRPlane`).
- Placement (a table hit-test plus an anchor, and the Quest 2 palm-press, spec §3.1).
- The first-five-minutes beat script (spec §3.4).
- The bot's translucent hand (§3.3).
- 0014's art on the figures.
- The `LORE:` slots, filled from the bible.
