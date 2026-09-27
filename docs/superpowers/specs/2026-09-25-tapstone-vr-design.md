# Tapstone in a headset: design (Meta VR Start Developer Competition)

Date: 2026-09-25 · Author: the lead, synthesising three research lanes under JP's full-auto mode
(nebula-rules: contest rules; nebula-xr: platform and a WASM probe; luna-vr: experience design)
· Status: **proposed, awaiting JP** · Plan: to follow (`superpowers:writing-plans`) once this is approved.

Sources: 0027 (ownership in the view), 0028 (the arena is the board), 0029 (commander), 0030
(ledger), 0032 (station screens), 0033 (voice), 0034 (breadth), 0036 (draws are taps), **0037
(cross-play: a headset is an arena view, never the source of truth)**; the arena spec
(`2026-09-23-arena-service-design.md`). Contest text was read on 2026-09-25 from
start-developer-competition-26.devpost.com (rules, FAQ, overview, webinars) and the Start program
terms; quotes came through a text extractor, since Devpost returns 403 to curl, so **re-read the rules in a browser before any
irreversible step**. Mocks: `docs/design/vr/*.svg`.

## 1. What is being entered, and why this shape

The contest rules settle four things:

| Constraint | Source text | Consequence |
|---|---|---|
| The judged build runs on a Meta headset **alone** | FAQ: "Your experience should not require a third-party device to operate." | Shrines, NFC cards, the gateway and a LAN arena can't be required. The entry is a **standalone mode**, and the physical game is the video's story. |
| Hands-first is required | "Fully usable with hands end-to-end. Controller support optional." | No controller anywhere. |
| Performance and FoV are judged | "min 60 fps"; "keep essential UI … within a comfortable, narrower FoV" | Budget for 60 fps on a Quest 2; keep every essential within about ±23°. |
| Division | New: "No pre-existing codebases" | **Gaming × Adapted/Significantly Updated** ($100k / $50k). A VR/MR mode added to an existing game is a named Adapted example. |

Special awards aimed at: **Best Social & Multiplayer** ("asymmetric multiplayer" is headset vs
browser vs shrine cross-play), with **Best First Five Minutes** and **Boldest Original Concept** as
secondary targets. Judging is 25% each: Innovation, Experience Design, Technical Implementation and Polish.

Deadline **2026-11-18 12:00 PT**. The entry is frozen at that moment and must stay available until
about 2026-12-11.

## 2. Architecture

**One renderer, two sources of view models.** The renderer consumes the arena's existing view-model
JSON (the SSE payload `app.js` already renders) and doesn't care where it comes from:

- **(A) Standalone, the judged build.** The arena runs **in the page**: `tapstone-rules`, the
  `tapstone-arena` core and the desk-mode link, compiled to `wasm32-unknown-unknown`. The human seat
  is the desk link's manual seat; the opponent is `DeskShrine` (the follower plus `ScriptedSeat`).
  There's no server and no network after load. **That includes IWSDK's hand and controller models:**
  `@iwsdk/xr-input` fetches them from a hard-coded jsdelivr path (`DEFAULT_PROFILES_PATH`) when an input
  source connects, i.e. after load. The build ships every input-profile glb it can request
  (`generic-hand`, and the Quest controller profiles) and serves them locally, or sets the
  `profileAssetPath` hook; the in-page resource counter guards it (day-1 spike, 2026-09-26, `scratch/vr/spike-day1.md`; summary in §8.1).
- **(B) Real table, cross-play.** The same renderer reads the arena's `/events` over the LAN, anchored
  between the two real shrines. The headset is a spectator view in this mode (§6).

0037 holds in both. In (A) the in-page arena core arbitrates; the renderer only renders and proposes
taps, and the engine refuses a bad tap from the human and from the bot alike.

**Platform: WebXR, on Meta's Immersive Web SDK (IWSDK, three.js).** The judges get a link.
- **Reuse.** (A) and (B) are literally one renderer, and (B) is `/xr` beside `/` on the same SSE.
- **Judges need no headset.** The IWER emulator runs in a desktop browser.
- **A Linux dev loop.** IWSDK needs no Windows or Mac editor.
- **Occlusion.** WebXR has depth-sensing on Quest 3/3S (experimental). Spatial SDK documents no depth path.
- **The build stays Rust.** Spatial SDK would need an NDK/JNI build of the Rust or a second rules
  implementation in Kotlin.
- **No platform lock.** The Start application named Spatial SDK, but nothing found in the rules or the
  Start terms ties an entry to its declared tool; the rules list "IWSDK (WebXR): A link" as a build path.
  (That rests on text extraction; confirm with MetaHorizonStart@meta.com or at the 10/7 webinar.)
- **Known tilt.** Technical Implementation names "gaze interactions (Unity/Unreal ISDK v207+)". Answer
  it by making gaze-plus-pinch a visible primary input (IWSDK has it) and naming it in the
  hand-interaction write-up.

**WASM feasibility: verified 2026-09-25** (probe in `scratch/vr/wasm-probe/`, re-run by the lead):
- The unmodified arena core, view model, decks, registry, transcript and desk link build to
  263 KB (87 KB gzipped) with zero imports.
- `record_desk_match(11)` in Node reproduces the committed `web/fixtures/desk-seed11.jsonl` byte for
  byte, in about 5–8 ms.
- The check can fail: seed 12 doesn't match, and a one-line change to the fixture reads not identical.
- `tapstone-rules`, `tapstone-proto` and `tapstone-progression` build as they are.

Code changes this needs (small, and each is its own PR):
1. **Split the arena crate.** Add a default `server` feature to `tapstone-arena`:
   - Gate `http`, `ledger`, `poster`, `config`, `version`, `link::serial` and `main.rs` behind it.
   - Make tokio, tokio-stream, axum, rusqlite, serialport, ureq, clap and realm-sigil optional.
   - `core`, `view`, `decks`, `registry`, `transcript` and `link/{desk,lines}` are already wasm-safe and
     stay unmodified.
   - The alternative is a separate core crate: cleaner for vendoring, but a bigger change.
2. **The sim's `rand` feature.** In `tapstone-sim`, set `rand` to `default-features = false,
   features = ["std", "std_rng"]`. It only seeds `StdRng`. Native tests pass 140/0 with the patch.
3. **A `tapstone-web` crate.** A thin wasm-bindgen facade: `new_match(seed, rules)`, `propose(tap)`,
   `tick(ms)` → view-model JSON.
4. **A gate** (no CI here, so run it on familiar):
   - a Node test that the wasm build's `record(11)` equals the fixture;
   - a perturbed-fixture negative that must fail.

**Delivery.** A static site, deployed from tag `vr-competition-v1` to an immutable path
(`tapstone.realm.watch/competition/v1/`, with realm-sigil and a status.realm.watch check) that is never
redeployed after Nov 18. HTTPS is inherent. (B)'s LAN `/xr` serves only `/xr` and `/events` over
HTTPS and never exposes `/dev/*`.

## 3. (A) The judged game

### 3.1 Layout on the table (`docs/design/vr/standalone-q3.svg`)

From the player outward:
1. **The hand.** Virtual cards, fanned low.
2. **The altar.** The virtual shrine is a low stone, 62 × 12 × 2.5 cm, with **three lane pads on its
   top, each under its lane**. Its eye and voice line sit on the front face. The tagline becomes
   literal: *tap the card to the stone.*
3. **The deck** at the altar's right end.
4. **My castle**, a low plaque.
5. **The board**, 60 × 42 cm: 3 lanes × 6 cells, with the opponent's tall keep and altar at the far end.

The mock renders forced four layout rules:
1. My castle is low and theirs is tall, because a tall near castle hid my back row (0027's asymmetry, found again).
2. Stat plates are lifted 3 cm.
3. Nothing essential sits beside the board, because a side shrine fell past the 70° edge.
4. The shrine is an altar with pads on top, because a tall shrine body hid pad 1.

**FoV.** Every essential sits within ±23° yaw and ±16° elevation, which fits a 70° device (the VR
Glasses profile) with margin. **Measured:** the spike's board, HUD and menu together spanned 48–79°
from the head (0.65–0.92 m), over 70° whenever the player leaned in (day-1 spike, 2026-09-26, `scratch/vr/spike-day1.md`; summary in §8.1). So essentials stay
within about **50°**, lower-central, and the move menu is pulled in from the board's edges.
*Correction:* IWSDK 1.0.0-rc.2 has **no `fieldOfViewMask`** (the glasses guide documents one; a grep of
`@iwsdk/*` finds only WebXR's `inlineVerticalFieldOfView`). Measure the span geometrically from the
head pose instead, as the spike's `stats().boardSpanDeg` does, until IWSDK ships the mask.

**Placement.**
- One table hit-test, with the board facing the player, plus a persistent anchor.
- Quest 2 fallback, since it has no depth: a flat palm sets the height, then pinch-drag.

### 3.2 Hands-first input: one verb, two modifiers

| Action (rule) | Gesture |
|---|---|
| Claim seat | touch your **castle card** to the altar; the commander forms (0029) |
| Draw (0036) | pinch the deck's top card, touch any pad |
| Cast a unit in lane N | card **face up** on **pad N**: where you tap is where it goes, so there's no lane prompt |
| Charge | **turn your wrist** face down, touch any pad |
| Spell target | face up on any pad → look at a unit and pinch; the default auto-applies after 3 s |
| Pass / mulligan | castle card on a pad / castle twice within 3 s |
| Inspect | pinch and hold a figure |

- **Touch first, pinch second, on every target** (day-1 spike, 2026-09-26, `scratch/vr/spike-day1.md`; summary in §8.1). On the Quest 2, a target carrying only
  `RayInteractable` ignored a fingertip: JP, *"tapping the buttons don't, i have to use the pinch"*.
  With `PokeInteractable` added (TouchPointer at the index tip), a fingertip touch selected, and in the
  finished hands-only match **18 of 27 taps were touches** and 9 ray-pinches. So every pad and tile
  carries **`PokeInteractable` + `RayInteractable`**, with one `Pressed` handler (it fires for both).
  Targets are **at least 6 cm** and sit **within seated reach** (about 30–40 cm from the head, on or
  just above the table). A ray-only target reads as broken to a first-timer.
- **A hands-only guard** (day-1 spike, 2026-09-26, `scratch/vr/spike-day1.md`; summary in §8.1). JP's headset had hand tracking **off**
  (`IHandTrackingService`: "Hand Enabled: no"), so the first run was controller selects that nobody
  noticed. When any connected input source lacks `hand`, the build says "set your controllers down"
  and offers nothing until hands appear. The contest build must be completable without a controller,
  and the Quest silently prefers controllers.
- **An eyes-and-hands path for everything.** Look and pinch to lift, then look and pinch to place,
  with no reaching. That covers accessibility, and it's the judged "gaze interactions" line.
- **Voice and contrast.** The voice line is always spoken *and* shown. There's a high-contrast toggle
  and reduced motion.
- **Refusals.** The engine's own codes show as a red pulse of the eye plus a sentence; the card returns
  to your hand, so a wrong move costs nothing.
- **Menu.** The move menu is `tapstone_sim::human::legal_choices(game, seat)`, each choice already
  tried against the engine.

### 3.3 The opponent
- **Brain:** `ScriptedSeat`, proposing through the same path as the player.
  - Risk: it picks moves at weighted random, so it plays weakly.
  - MVP: tune its weights for a new player's first match. A greedy picker over `legal_choices` is a stretch item for the rematch.
- **Body:** a translucent hand reaching to the far altar, with 0.8–2 s of think time. Its cards stay face down until cast.
- **Voice:** a few fixed commander lines in the 0033 clip style.

### 3.4 The first five minutes
One new gesture per beat, each paid off within 3 s. No text panel; the voice teaches one sentence at a time.

| Clock | Beat | Payoff |
|---|---|---|
| 0:00–0:15 | place the stone | the board unrolls |
| 0:15–0:35 | castle on the stone | your commander forms |
| 0:35–1:10 | five draw taps | the verb becomes muscle memory |
| 1:10–1:40 | the wrist flip | a mana gem lights |
| 1:40–2:10 | face up on a pad | the summon arc, and a figure rises |
| 2:10–2:30 | castle to pass | the bot's hand moves |
| 2:30–3:30 | the bot's turn | the first clash and the first kill |
| 3:30–5:00 | unguided play | a chip flies off the enemy keep |

**A "first match" ruleset needs no engine change.** It uses existing `HouseRules` fields: castle_life 10,
pressure_from 4, stop_round 6, plus a scanned seed.
- **Owed, and measured before it's adopted:** a harness run on familiar for the median match length
  (target 5–7 min at ~4 s per tap) and the bot's win rate against a play-out player.
- **Measured 2026-09-27, re-measured the same day on #147's 30-card decks** on familiar by `cargo test
  --release -p tapstone-sim --test first_match -- --nocapture`, which also fails if this paragraph stops
  quoting its numbers (branch feat/set1-expansion off main 6603f52; picker play-out on both seats, the desk
  bot's own picker; default decks, the person in seat 0 with Ember; seeds 1–4000): median **56 taps** a
  match (29 the person's, p10–p90 23–35; 27 the bot's), 4.0 rounds, every match lethal, none reaching
  the stop round. The bot wins **29.5% ±1.4**. `tapstone-sim balance --life 10 --from 4 --stop 6` agrees
  (70.5 / 29.5, 4.02 rounds). Two readings, offered for checking rather than as findings: 56 taps at ~4 s
  is **about 3.7 min, still under the 5–7 min target**; and the 29.5% is now mostly the seat, not the deck
  (swapped decks: bot 52.8%; mirror Ember: 37.2%; mirror Tide: 32.2%). On the 25-card decks before #147
  the same run gave 54 taps (30 / 23), 3.6 rounds and a bot at 4.0% ±0.6, mostly the deck (swapped
  73.6%, mirrors 35.5% / 21.6%). Not adopted yet: the in-page table still plays the default rules.
  The beat script itself is `www/xr/src/logic/first-five.js`.

### 3.5 Coming back
- An on-device ledger in browser storage, following the 0030 shape.
- A result beat: XP, a level, and a loot chest on the altar.
- Breadth, not power (0034).

## 4. (B) The real table (`table-mr.svg`, `crossplay.svg`)

- **Placement.** `/xr` anchors the board between the two real shrines with a two-touch calibration.
  Players keep the shrines within about 40 cm of the board's ends; a side shrine sits at −28°.
- **Spectating.** The headset spectates: it renders the same stream the browser board does. It holds
  no state, so taking it off mid-match changes nothing, and putting it back on resyncs.
- **Inputs stay physical.** Cards on real shrines, over NFC.

## 5. Scope

**MVP by Nov 18:**
1. The code changes in §2.
2. The in-page arena and bot.
3. The renderer: board, figures and plinths, castles, readouts, voice line, owed draws, winner.
   Low-poly primitives plus 0014's 48 px art on thin billboards, so **no 3D modelling on the critical path**.
4. The effects, diffed from consecutive view models; keep cracks and the victory beat are stretch.
5. The hands-first and eyes-and-hands input.
6. Placement, with the Quest 2 fallback.
7. The first five minutes, with the measured ruleset.
8. The result beat and the ledger.
9. Accessibility.
10. **A measured 60 fps on a Quest 2** in a full match.
11. (B), minimal: the `/xr` spectator on the LAN, for the video.

**Stretch, by judging value per hour:**
1. Keep cracks and the victory beat.
2. Paperdoll gear on the 3D commander.
3. The bot's voice and personality.
4. Voice commands ("cast", "charge", "lane two"), for accessibility.
5. A "watching in 3D" tag on the browser board.
6. A greedy or aggressive second bot.
7. Depth occlusion on Quest 3/3S.

**Not in scope:**
- Headset input at the real table. It needs a new protocol answer frame; revisit after Nov 18.
- Any state held in the headset.
- Rules outside the engine crate.
- Computer vision on cards.
- Internet multiplayer.
- 3D-modelled units.
- AI-generated video.

## 6. Hardware

- **Dev headset: JP's Quest 2.** It proves the stream, placement, anchors, hands and the frame budget,
  with greyscale passthrough. It can't prove occlusion or colour legibility; a lit ghost hand stands in
  for occlusion.
- **Target headset: a Quest 3S (~$299).**
  - It has the same chip and RAM as the Quest 3, colour passthrough, and the Depth API from its stereo
    cameras, so it has every feature this design uses.
  - A Quest 3 (~$499) is worth it only if video quality is the priority.
  - Arrival by about Oct 9 is useful for development. After ~Oct 23 it only validates. After ~Nov 6 it
    doesn't change the entry.
  - **No agent orders hardware.** The Quest 3S purchase is being arranged separately.

## 7. The video (2:45, under the 3:00 cap)

Twelve shots. Every gameplay shot is a headset capture (Quest 3/3S for mixed reality), and there are
two short phone shots of the physical game.
- 0:00–0:15: a card tapped on a real shrine.
- 0:15–0:58: **(B) cross-play.** The board lands between the real shrines. A split screen shows the
  headset beside the browser board. The headset comes off and the match carries on.
- 1:05–2:25: **(A)'s first five minutes**, with no narration, so the game teaches itself.
- 2:25–2:45: eyes-and-hands and Quest 2 greyscale, then the tagline.

Only entrants may appear, so the second player is an entrant or is shown hands-only. There's no
AI-generated footage. The full shot list is in `scratch/vr/experience.md` §5.

## 8. Sequence

Three milestones, all serving the first five minutes. Test on the Quest 2 (the worst case) first, then the Quest 3S when it arrives.

- **M1 "five minutes, ugly", ~Oct 16**
  - The in-page arena and a wireframe renderer.
  - Hands-only input, with **no controller code path at all**, so the controller test passes by construction.
  - Palm-press placement.
  - The measured first-match ruleset and the beat script.
  - Exit test: someone who has never seen the game finishes a match with no help, and we note where they hesitate.
- **M2 "the payoffs", ~Nov 1**
  - The effects, built in beat order, with sound per beat.
  - The bot's hand, the art pass, and accessibility.
- **M3 "solid", ~Nov 11**
  - 60 fps on the Quest 2 over a full match.
  - Tested in three rooms nobody tuned for. The ghost hand and palm-press switch in automatically on any device when depth or table detection is poor, which answers the rules' "rooms the developer never tested".
  - The ledger and rematch, and pause/resume.
  - Minimal (B), the submission text, and the frozen build.

### 8.1 Day-1 spike result (Quest 2, 2026-09-26)

On JP's Quest 2 (hands only, the in-page wasm arena, IWSDK 1.0.0-rc.2; detail in
`scratch/vr/spike-day1.md`, code on `spike/xr-day1` e49a3f9):

| Pass line | Result |
|---|---|
| A whole match, hands only | **Pass.** It ended with a winner; 27 taps, 27 hands-only, 0 with a gamepad (18 touch, 9 ray-pinch) |
| Zero network after load | **Pass.** In-page 0 in every run. DevTools saw one localhost-only load, nothing after it, and no off-box host |
| ≥ 60 fps | **Pass.** Median 89–90 (the 90 Hz display); p1 64–71; 0.5% of frames over 16.7 ms (worst 135 ms, one-off hitches) |
| Placement survives looking away | **Not verified.** Palm-press placement works (the board moved to the fingertip), but no look-away was instrumented |
| IWER plays the same page | **Pass.** 33 emulated hand-ray pinches to a finished match |

What the next spike instruments:
- A per-phase frame histogram (XR entry vs play), to confirm the hitches are warm-up.
- A head-yaw log with the board's pose before and after a deliberate look-away, to settle placement.
- Touch vs ray per tap (the spike's fingertip-within-3-cm test), kept.

Questions for the 10/7 "How to Win" webinar:
1. Does an unshipped pre-existing project count as Adapted?
2. Does IWSDK's gaze-plus-pinch score equal to ISDK v207 gaze?
3. May the video open with two real-world establishing shots?

| When | What |
|---|---|
| Week 1 (from approval) | **Day-1 spike on the Quest 2:** an IWSDK page with the WASM arena, the board placed on the table, hand tracking, and one match played to the end with zero network requests after load, at a measured frame rate. The crate split, the rand patch and the gate PRs. |
| Weeks 2–3 | renderer and effects; hands-first input; the bot's presence |
| Week 4 | first five minutes, with the measured ruleset; the result beat and ledger |
| Week 5 | accessibility, 60 fps pass, and (B) `/xr` on the LAN; target headset testing if it has arrived |
| Week 6 | polish, video capture, description (≤500 words), hand-interaction write-up, Adapted summary |
| Week 7 (by Nov 13) | freeze: tag `vr-competition-v1`, deploy the immutable path, check it from a clean headset and from IWER, submit. Five days of slack before Nov 18. |

## 9. Decisions for JP

1. **Approve this design** (IWSDK/WebXR, standalone-first, the scope above).
2. **The entrant identity.** Confirm which Meta developer org the Start application went through, since
   the Start terms bind "you, individually, and your Organization".
3. **The headset purchase** (Quest 3S recommended), being arranged separately.
4. **Headset input at the real table: not for Nov 18** (recommended).
5. **Amend the Start application** (its factual errors, per `scratch/vr/pitch-as-corrected.md`), and
   ask Meta whether an unshipped pre-existing project counts as Adapted: email, or the 10/7 "How to
   Win" webinar.
6. **The second player on camera:** who, since only entrants may appear.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Adapted eligibility for an unshipped project is ambiguous | ask at the 10/7 webinar; the division text says "Pre-existing project", not "published" |
| Start approval timing is unpublished, and approval gates submission | amend and chase early |
| Hand-tracked touch on the Quest 2 (false or missed taps) | a proximity + velocity threshold tuned on the Quest 2; eyes-and-hands as the fallback |
| The weak bot | tune the weights for the first match; a greedy picker as a stretch |
| three.js depth-occlusion bugs | occlusion is stretch; the ghost hand is the baseline |
| A web build is live code | an immutable tagged path, never redeployed |
