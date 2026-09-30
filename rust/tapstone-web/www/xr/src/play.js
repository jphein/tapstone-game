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
//
// The first five minutes (spec §3.4, logic/first-five.js): while its beats run, the altar's voice
// line speaks only the current beat's sentence (and refusals); the other lines wait until it ends,
// or until its clock window does, if nobody answers it.
//
// Coming back (spec §3.5): the match pauses whenever the person can't see it (logic/pause.js): the tab
// hidden, the XR session hidden or blurred (the Quest menu, the headset off), or the session ended.
// While paused the table doesn't advance, now() is frozen for every timer, and gestures are held and
// played on return. The table's journal is in localStorage (table.js, logic/journal.js), so a reload
// mid-match replays it and carries on; a returning player skips the first five's teaching.
import { createSystem, Grabbed, Group, Pressed, Vector3, VisibilityState } from '@iwsdk/core';
import { Board } from './board.js';
import { Altar } from './altar.js';
import { Hand } from './hand.js';
import { CastleCard, DeckTop, HandCard, HandGrip, Pad, PromptTile, TargetUnit } from './tags.js';
import { openTable } from './table.js';
import { markLoaded, preloadProfiles } from './net.js';
import { preloadCardArt } from './card-art.js';
import { preloadVoice } from './voice.js';
import { preloadKws } from './voice-input.js';
import { handsGuard } from './guard.js';
import { matchGesture, gestureForItem } from './logic/menu.js';
import { CastleTaps, TargetTimer, pressKind } from './logic/gestures.js';
import { beatEvents, gestureOf } from './logic/first-five.js';
import { Guide } from './guide/guide.js';
import { LineQueue } from './guide/lines.js';
import { Ghost } from './guide/ghost.js';
import { inMode, modeOf } from './guide/modes.js';
import { ALTAR, PLACE, padCenter } from './logic/layout.js';
import { shouldReplace, SETTLE } from './logic/access.js';
import { FrameLog } from './logic/frames.js';
import { PauseClock, pauseReasons } from './logic/pause.js';
import { CarryGate, LAND, liftSpent, nearestHand, onPad } from './logic/carry.js';
import { access, onAccess } from './access.js';
import { markPlayable } from './art/sparkle.js';

const SEED = 11, HUMAN = 0;
const TEACHING = new Set(['place', 'claim', 'draw', 'flip', 'mana', 'cast', 'pass']); // guide/lesson.js ids


export class PlaySystem extends createSystem({
  heldCards: { required: [HandCard, Grabbed] },
  heldDeck: { required: [DeckTop, Grabbed] },
  heldCastle: { required: [CastleCard, Grabbed] },
  heldGrip: { required: [HandGrip, Grabbed] },
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
    this.board.onFaction = (f) => this.altar.setCastle(f); // the castle card shows my seat's castle
    this.frames = new FrameLog(); // M3: every frame's interval, tagged with the work done in it
    this.altar.frames = this.frames;
    this.hand = new Hand(this.world, this.rootEntity, this.root);
    this.table = null;
    this.view = null;
    this.prev = null;
    this.menu = [];
    this.handCards = [];
    this.near = HUMAN;
    this.placed = false;
    this.immersiveFrames = 0;
    this.touched = new Set(); // grab ids that already touched a pad this grab
    this.lifted = null; // eyes-and-hands: { source, slot?, face }
    this.castle = new CastleTaps();
    this.target = new TargetTimer();
    this.pendingSpell = null;
    this.stats = { taps: 0, refused: 0, poke: 0, ray: 0, touch: 0, guarded: 0, swallowed: 0, landed: 0 };
    // One carry, one pad action (logic/carry.js): which hand holds what, and when it let go.
    this.carry = new CarryGate();
    this.inputs = []; // the last 200 pad presses: { t, lane, hand, kind, means } (__tapstone.inputs())
    this.guard = { blocked: false, message: null };
    this.onView = null; // set by EffectsSystem: (prev, next, near) => void
    this.sfxStats = null; // set by EffectsSystem: the payoff sounds' counts, for the IWER gate
    this.placedY = null; // the head height the board was placed for (seated mode re-places from it)
    this.headYs = []; // the last ~second of head heights, while seated: [{ t, y }]
    this.replaced = 0;
    this.altar.applySides(access);
    this.hand.useHand(access.leftHanded, [], new Set());
    onAccess((a, key) => {
      if (key === 'leftHanded') this.altar.applySides(a), this.hand.useHand(a.leftHanded, this.handCards, this.heldSlots());
      if (key === 'seated') this.headYs = [];
    });
    this.pause = new PauseClock();
    this.watchVisibility();
    // ms since navigation start (performance.now): the table playable, every fetch in, the first frame
    // that drew a view (tools/iwer-coldstart.mjs).
    this.coldStart = { ready: null, loaded: null, firstFrame: null };
    // The guide v2 (src/guide/): lessons read from the match, one line queue for everything the altar
    // says, and a ghost hand that shows each move.
    this.guide = new Guide();
    this.beats = this.guide.beats; // first-five's machine (the IWER tools read its beat)
    this.lines = new LineQueue();
    this.ghost = new Ghost(this.root);
    this.ghostKey = null;
    this.beatLog = []; // [{ at, beat, why, say }]: what the tutorial said, for the IWER gate
    this.guide.start(this.now());
    this.queries.pressedCards.subscribe('qualify', (e) => this.liftCard(e.getValue(HandCard, 'slot')));
    this.queries.pressedDeck.subscribe('qualify', () => this.lift({ source: 'deck' }));
    this.queries.pressedCastle.subscribe('qualify', () => this.castleTap());
    this.queries.pressedPads.subscribe('qualify', (e) => this.padPressed(e.getValue(Pad, 'lane'), e));
    const carried = (query, key, done) => {
      query.subscribe('qualify', (e) => this.carry.grab(key(e), nearestHand(this.handDistances(e)), this.now()));
      query.subscribe('disqualify', (e) => {
        this.carry.release(key(e), this.now());
        done?.();
      });
    };
    carried(this.queries.heldCards, (e) => `hand:${e.getValue(HandCard, 'slot')}`, () => this.refan());
    carried(this.queries.heldDeck, () => 'deck', () => this.altar.home('deck'));
    carried(this.queries.heldCastle, () => 'castle', () => this.altar.home('castle'));
    // The fan's grip is a carry too (its hand pressing a pad on the way is not a move), and letting go
    // leaves the hand where it is (hand.js, logic/hand-place.js).
    carried(this.queries.heldGrip, () => 'grip', () => {
      this.hand.dropGrip(this.handCards, this.heldSlots());
      this.ghostKey = null; // a demo from a card re-aims at the moved fan
    });
    this.queries.pressedPrompt.subscribe('qualify', (e) => this.promptPressed(e.getValue(PromptTile, 'option')));
    this.queries.pressedUnits.subscribe('qualify', (e) => this.unitPressed(e.getValue(TargetUnit, 'target')));
    // Each preload's finish time (ms since navigation start), for the cold-start report.
    const timed = (name, p) => p.then((v) => ((this.coldStart.parts[name] = Math.round(performance.now())), v));
    this.coldStart.parts = { init: Math.round(performance.now()) };
    const base = import.meta.env.BASE_URL;
    // The table plays as soon as the engine, the hand models and the card art are in (a resumed hand
    // is drawn on its first frame, so the art must be there). The voice clips finish last and gate
    // nothing: the altar speaks text only until they attach (altar.js). "Loaded" (net.js: nothing on
    // the network after it) still waits for every fetch.
    let speaker = null;
    const voice = timed('voice', preloadVoice(base)).then((s) => {
      s.onEnded = () => this.lines.ended();
      s.onBlocked = () => this.lines.blocked();
      this.altar.attach((speaker = s));
    });
    // The keyword spotter for voice commands (assist.js): fetched now, so that turning voice on
    // mid-match makes no request after "loaded"; it gates nothing and is compiled only on opt-in.
    this.kws = timed('kws', preloadKws(base));
    const ready = Promise.all([timed('table', openTable(`${base}tapstone_web.wasm`, SEED, HUMAN)), timed('profiles', preloadProfiles(base)), timed('art', preloadCardArt(base))]);
    this.loadGate = []; // other systems' loads (the summons' creatures) that "loaded" waits for too
    Promise.all([ready, voice, this.kws]).then(() => Promise.all(this.loadGate)).then(() => {
      markLoaded();
      this.coldStart.loaded = performance.now();
    });
    const silent = { clips: 0, played: 0, blocked: 0, silent: 0, cut: 0, heard: [] };
    ready.then(([t]) => {
      this.table = t;
      this.coldStart.ready = performance.now();
      // A match resumed mid-play: the guide starts from what the journal says was done (guide/lesson.js),
      // so it neither restarts at "claim" nor skips what was never learned.
      if (t.resumed.from === 'journal') this.guide.resume(t.journal.taps);
      console.log(`[tapstone] ${t.resumed.from === 'journal' ? `resumed a match: ${t.resumed.taps} taps, clock ${t.resumed.clock} ms` : `a fresh match${t.resumed.refused ? ` (stored journal refused: ${t.resumed.refused})` : ''}`}`);
      globalThis.__tapstone = {
        table: t,
        play: this,
        // M3 (tools/iwer-profile.mjs): the frame log's report, and a reset to start a window.
        frames: (opts) => this.frames.report(opts),
        framesReset: () => (this.frames = this.altar.frames = new FrameLog()) && true,
        access: () => ({ ...access, replaced: this.replaced, placedY: this.placedY }),
        stats: () => ({ ...this.stats, done: t.done(), seat: this.near, voice: { ...(speaker?.stats ?? silent), heard: [...(speaker?.stats ?? silent).heard] }, sfx: this.sfxStats ? { ...this.sfxStats, byName: { ...this.sfxStats.byName } } : null }),
        beats: () => ({ beat: this.beats.beat?.id ?? null, done: this.beats.done, said: [...this.beatLog] }),
        // The guide v2 (tools/iwer-guide.mjs): the lesson now, every lesson spoken with contradicts()'s
        // verdict, the history it reads, every line the queue started, and the ghost's state.
        guide: () => ({
          lesson: { ...this.guide.lesson },
          log: this.guide.log.map((l) => ({ ...l })),
          history: [...this.guide.history],
          lines: this.lines.said.map((l) => ({ ...l })),
          ghost: { visible: this.ghost.visible, demo: this.ghost.demo ? { move: this.ghost.demo.move } : null, hand: this.ghost.hand.visible },
          fan: { ...this.hand.origin },
        }),
        // Coming back (tools/iwer-pause.mjs, iwer-reload.mjs, iwer-coldstart.mjs).
        pause: () => ({ paused: this.pause.paused, reasons: [...this.pause.reasons], pauses: this.pause.pauses, held: this.pause.held.length, playNow: Math.round(this.now()), clock: t.now() }),
        journal: () => ({ resumed: { ...t.resumed, view: undefined }, ...t.journal, taps: t.journal.taps.map((x) => ({ ...x })) }),
        coldStart: () => ({ ...this.coldStart, parts: { ...this.coldStart.parts } }),
        // Both ways in (0039): the entry plan, this session's mode and room, and the last frame's
        // draw calls and triangles (renderer.info, reset every render), for tools/iwer-room.mjs.
        room: () => {
          const x = this.world.renderer.xr.getSession();
          return { plan: globalThis.__tapstoneEntry ?? null, mode: x ? (x.environmentBlendMode === 'opaque' ? 'vr' : 'ar') : null, blend: x?.environmentBlendMode ?? null, ...(this.roomState?.() ?? {}) };
        },
        render: () => ({ ...this.world.renderer.info.render }),
        inputs: () => this.inputs.map((x) => ({ ...x })),
        forget: () => (t.forget(), true),
        // Test hook (the IWER gate): one move chosen as the web gate chooses, sent through the SAME
        // gesture path the hands use (play(gesture)), never propose() directly.
        // `kind` (optional) prefers that menu kind, so a driver can teach a beat its own gesture.
        gestureStep: (kind) => {
          const menu = t.choices();
          const item = (kind && menu.find((m) => m.useful && m.kind === kind)) || menu.find((m) => m.useful && m.kind !== 'Mulligan');
          if (item) this.play(gestureForItem(item));
          return item ? item.label : null;
        },
      };
    });
  }

  // Play time: wall time with every pause taken out (logic/pause.js).
  now() {
    return this.pause.now(performance.now());
  }

  // Pause on anything that takes the match out of the person's sight. Events, not per-frame polling:
  // a hidden tab gets no animation frames at all, so the pause must start when the event fires.
  // Every event re-derives the whole set (logic/pause.js pauseReasons), and each frame re-checks it
  // (syncPause in update), so a missed or stale event can't leave the match paused.
  watchVisibility() {
    const doc = globalThis.document;
    const xr = this.world.renderer?.xr;
    let hadSession = false;
    this.syncPause = () => {
      const session = xr?.getSession?.() ?? null; // three clears it before 'sessionend'
      const want = pauseReasons({
        presenting: !!session,
        sessionVisibility: session?.visibilityState,
        docHidden: doc?.hidden,
        hadSession,
      });
      for (const [reason, on] of Object.entries(want)) {
        const r = this.pause.set(reason, on, performance.now());
        if (r) console.log(`[tapstone] ${r} (${reason})`);
      }
    };
    doc?.addEventListener('visibilitychange', this.syncPause);
    if (xr) {
      xr.addEventListener('sessionstart', () => {
        hadSession = true;
        this.replayLesson?.();
        xr.getSession()?.addEventListener('visibilitychange', this.syncPause);
        this.syncPause();
      });
      xr.addEventListener('sessionend', this.syncPause);
    }
    this.syncPause();
  }

  // While paused, a gesture waits and is played on return (the state it was aimed at hasn't moved).
  held(fn) {
    if (!this.pause.paused) return false;
    this.pause.hold(fn);
    return true;
  }

  // The guide's sentence (guide/guide.js tick): queued as a lesson, never cut off (guide/lines.js).
  beat(text, opts) {
    if (!text) return;
    this.lines.push(text, 'lesson', { ...opts, topic: 'guide' });
    this.beatLog.push({ at: Math.round(this.now()), beat: this.beats.beat?.id ?? null, why: this.beats.why, say: text });
  }

  // Every other line: a status plays only into silence, so it never talks over a lesson, and not at all
  // while the guide is teaching a move ("Draw 5" while it teaches the claim contradicts its order).
  voice(text, kind = 'status') {
    if (kind === 'status' && TEACHING.has(this.guide.lesson?.id)) return;
    // Nor before #200's first-run offer is answered: the offer comes first, then the guide.
    if (kind === 'status' && !access.offered) return;
    this.lines.push(text, kind);
  }

  // A refusal's words go through the queue (only the newest waits); the eye flashes at once.
  refuse(text, kind = 'refusal') {
    this.lines.push(text, kind);
    this.altar.flash(this.now());
  }

  // The hand-card slots a hand holds now.
  heldSlots() {
    return new Set([...this.queries.heldCards.entities].map((e) => e.getValue(HandCard, 'slot')));
  }

  // A thing's position under the board (the root), for the ghost's from and to.
  local(obj) {
    return this.root.worldToLocal(obj.getWorldPosition(new Vector3()));
  }

  spot(ref) {
    if (ref === 'deck') return this.local(this.altar.deckTop);
    if (ref === 'castle') return this.local(this.altar.castle);
    if (ref?.slot !== undefined) return this.hand.cards[ref.slot] ? this.local(this.hand.cards[ref.slot].mesh) : null;
    if (ref?.pad !== undefined) return this.local(this.altar.pads[ref.pad].m);
    return null;
  }

  // A gaze step (#200's logic/gaze.js targets) as the spot the ghost's dwell ring sits on.
  gazeSpot(t) {
    if (t.kind === 'hand') return this.spot({ slot: t.slot });
    if (t.kind === 'pad') return this.spot({ pad: t.lane });
    if (t.kind === 'deck' || t.kind === 'castle') return this.spot(t.kind);
    if (t.kind === 'prompt') return this.local(this.altar.prompt[t.option].m);
    return null;
  }

  // The lesson in the way the person chose to play (#200's offer; guide/modes.js).
  inMode(lesson) {
    return inMode(lesson, modeOf(access), { menu: this.menu, hand: this.handCards });
  }

  // The ghost follows the lesson: a new demo when the lesson's demo changes, gone when it has none.
  showLesson(lesson, now) {
    if (this.ghostHold) return; // tools/iwer-guide-shots.mjs holds a chosen demo for a still
    const m = this.inMode(lesson);
    const key = lesson.demo ? `${m.mode}|${access.leftHanded}|${lesson.id}|${JSON.stringify(lesson.demo)}|${JSON.stringify(m.steps ?? null)}` : null;
    // The same demo with a new sentence ("Draw 4" after "Draw 5"): only the caption changes.
    if (key && key === this.ghostKey && m.line !== this.ghost.said) return this.ghost.recaption(m.line);
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    const from = key && this.spot(lesson.demo.from), to = key && this.spot(lesson.demo.to);
    if (!from || !to) return this.ghost.hide();
    const spots = (m.steps ?? []).map((t) => this.gazeSpot(t)).filter(Boolean);
    // Staged from where the person's eyes are (board-local), on their reaching side.
    const head = this.player?.head ? this.root.worldToLocal(this.player.head.getWorldPosition(new Vector3())) : null;
    this.ghost.show({ move: lesson.demo.move, from, to }, m.line, now, this.captionAt(), { mode: m.mode, steps: m.steps, spots, head, side: access.leftHanded ? -1 : 1 });
  }

  // The caption floats above the fan, tipped toward the eyes, so it never covers a card or the stone.
  captionAt() {
    const o = this.hand.origin;
    return { x: o.x, y: o.y + 0.1, z: Math.min(o.z, ALTAR.z + 0.08) };
  }

  // On XR entry: say the lesson again (anything said before entry was blocked by autoplay).
  replayLesson() {
    const line = this.guide.lesson?.say ? this.inMode(this.guide.lesson).line : null;
    if (line) this.beat(line, { force: true });
  }

  // ---- the eyes-and-hands path ----------------------------------------------------------------
  liftCard(slot) {
    if (this.lifted && this.lifted.source === 'hand' && this.lifted.slot === slot) {
      this.lifted.face = this.lifted.face === 'up' ? 'down' : 'up'; // a second pinch turns it over
      this.voice(this.lifted.face === 'down' ? 'Face down: touch a pad to charge it.' : 'Face up: touch the pad under a lane.');
      return;
    }
    this.lift({ source: 'hand', slot, face: 'up' });
  }

  lift(l) {
    this.lifted = l;
    const card = l.source === 'hand' ? this.handCards[l.slot] : null;
    this.voice(card ? `${card.name}: touch a pad.` : l.source === 'deck' ? 'The top card: touch a pad to draw it.' : '');
  }

  padPressed(lane, entity) {
    const tip = this.fingertipDistanceTo(entity);
    const kind = pressKind(tip);
    this.stats[kind]++;
    // The carrying hand's fingertip on a pad, or that hand leaving it, is the carry, not a new move.
    const hand = nearestHand(this.handDistances(entity));
    const means = this.carry.pad(this.now(), hand, this.lifted);
    this.inputs.push({ t: Math.round(this.now()), lane, hand, kind, means, held: [...this.carry.holding.keys()] });
    if (this.inputs.length > 200) this.inputs.shift();
    // The carry's one pad action: its fingertip landing on the pad under the card, if the card hasn't
    // touched a pad yet. Any other press by a carrying hand (a pad crossed on the way) is swallowed.
    if (means === 'carry' && this.land(lane, hand)) return;
    if (means === 'carry' || means === 'settle') {
      this.stats.swallowed++;
      return;
    }
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
  heldThings() {
    return [
      ...[...this.queries.heldCards.entities].map((e) => ({ e, source: 'hand', slot: e.getValue(HandCard, 'slot'), key: `hand:${e.getValue(HandCard, 'slot')}` })),
      ...[...this.queries.heldDeck.entities].map((e) => ({ e, source: 'deck', key: 'deck' })),
      ...[...this.queries.heldCastle.entities].map((e) => ({ e, source: 'castle', key: 'castle' })),
    ];
  }

  // A held thing's offset from `lane`'s pad: { flat, up } in metres.
  offset(h, lane) {
    const p = h.e.object3D.getWorldPosition(new Vector3()), c = padCenter(lane);
    const q = this.root.localToWorld(new Vector3(c.x, c.y, c.z));
    return { flat: Math.hypot(p.x - q.x, p.z - q.z), up: p.y - q.y };
  }

  // A held thing reaches a pad: its one pad action for this carry.
  touchPlay(h, lane) {
    this.touched.add(h.e.index);
    this.stats.touch++;
    // The pinch that picked this up also lifted it (the eyes-and-hands path): that lift is spent.
    if (liftSpent(this.lifted, h.source, h.slot)) this.lifted = null;
    if (h.source === 'castle') this.castleTap();
    else this.play(this.gestureFor(h.source, h.slot, h.source === 'hand' ? this.hand.faceOf(h.slot) : 'up', lane));
  }

  // The carrying hand pressed `lane`'s pad: if it holds something over that pad that hasn't touched a
  // pad this carry, that is the placing. True if it played.
  land(lane, hand) {
    for (const h of this.heldThings()) {
      if (this.touched.has(h.e.index)) continue;
      const by = this.carry.holding.get(h.key)?.hand ?? null;
      if (hand !== null && by !== null && by !== hand) continue;
      if (onPad(this.offset(h, lane), LAND)) {
        this.stats.landed++;
        this.touchPlay(h, lane);
        return true;
      }
    }
    return false;
  }

  checkTouches() {
    const held = this.heldThings();
    for (const h of held) {
      if (this.touched.has(h.e.index)) continue;
      for (let lane = 0; lane < 3; lane++) {
        if (onPad(this.offset(h, lane))) {
          this.touchPlay(h, lane);
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
  // `via`: 'hand', or 'gaze' / 'voice' (assist.js), which the controller guard doesn't apply to.
  castleTap(via = 'hand') {
    if (this.held(() => this.castleTap(via))) return;
    // One tap per pinch of the castle: its press and the same carry touching a pad are one tap.
    if (!this.carry.castleTap(this.now())) return void this.stats.swallowed++;
    // The claim beat: the castle on the stone is the claim itself (the desk seats the person), so
    // the tap is the beat's gesture and goes no further.
    if (this.beats.active && this.beats.beat.teaches === 'claim') return this.guide.gesture('claim', this.now());
    const open = this.menu.some((m) => m.kind === 'Mulligan');
    const r = this.castle.tap(this.now(), open);
    this.castleVia = via;
    if (r === 'pending') this.voice('Pass. Tap the castle again within 3 s to mulligan.', 'lesson');
    else this.play({ source: 'castle', action: r }, via);
  }

  // ---- a spell's target ----------------------------------------------------------------------
  promptPressed(option) {
    if (this.held(() => this.promptPressed(option))) return;
    if (!this.target.active || !this.target.options[option]) return;
    const index = this.target.pick(this.target.options[option].target);
    this.altar.hidePrompt();
    if (index !== null) this.propose(index);
  }

  unitPressed(target) {
    if (this.held(() => this.unitPressed(target))) return;
    if (!this.target.active) return;
    const index = this.target.pick(target);
    if (index !== null) {
      this.altar.hidePrompt();
      this.propose(index);
    }
  }

  // ---- the one door to the engine --------------------------------------------------------------
  // The XR session's input sources this frame (empty outside a session).
  inputSources() {
    return [...(this.world.renderer.xr.getSession()?.inputSources ?? [])];
  }

  // `via` says what made the gesture: 'hand' (the default), or 'gaze' / 'voice' (assist.js).
  play(g, via = 'hand') {
    if (!this.table) return;
    if (this.held(() => this.play(g, via))) return;
    // The hands-only guard: no hand gesture is played while a controller is connected (guard.js).
    // Gaze and voice aren't controller selects, so a person playing by them isn't refused.
    const guard = via === 'hand' ? handsGuard(this.inputSources()) : { blocked: false };
    if (guard.blocked) {
      this.stats.guarded++;
      this.refuse(guard.message, 'guard');
      return;
    }
    this.menu = this.table.choices();
    // With the hand and the view, a refusal says why and what to do (logic/menu.js explainRefusal).
    const r = matchGesture(this.menu, g, { hand: this.handCards, view: this.view, near: this.near, mode: modeOf(access) });
    if (r.index !== undefined) return this.propose(r.index);
    if (r.need === 'target') {
      this.target.start(this.now(), r.options, 0);
      this.altar.showPrompt(r.options);
      this.voice('Choose a target: look and pinch, or wait 3 s for the nearest.', 'lesson');
      return;
    }
    this.stats.refused++;
    this.refuse(r.refused);
  }

  propose(index) {
    const item = this.menu[index];
    if (this.table.propose(index)) {
      this.stats.taps++;
      this.voice(item ? item.label : '');
      this.guide.gesture(gestureOf(item), this.now());
    } else {
      this.stats.refused++;
      this.refuse('The stone refused that move.');
    }
    this.menu = [];
  }

  // Each tracked hand's index fingertip distance to `entity`: [{ hand, d }] (logic/carry.js nearestHand).
  handDistances(entity) {
    const xr = this.world.renderer.xr, frame = xr.getFrame(), ref = xr.getReferenceSpace();
    const out = [];
    if (!frame || !ref || !entity.object3D) return out;
    const at = entity.object3D.getWorldPosition(new Vector3());
    for (const src of frame.session.inputSources) {
      const tip = src.hand && frame.getJointPose(src.hand.get('index-finger-tip'), ref);
      if (tip) out.push({ hand: src.handedness, d: at.distanceTo(new Vector3(tip.transform.position.x, tip.transform.position.y, tip.transform.position.z)) });
    }
    return out;
  }

  // A hand card let go of: back to the fan (a card played is gone from the hand at the next view).
  refan() {
    if (!this.handCards.length) return;
    const held = new Set([...this.queries.heldCards.entities].map((e) => e.getValue(HandCard, 'slot')));
    this.hand.set(this.handCards, held);
  }

  fingertipDistanceTo(entity) {
    return this.handDistances(entity).map((x) => x.d);
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
    this.placedY = h.y;
    this.headYs = [];
    const now = this.now();
    this.guide.gesture('place', now);
    this.guide.event('placed', now);
  }

  // Seated mode (logic/access.js): once the head has settled past the drift from where the board
  // was placed (sat down, or stood up, after the first frame), place it again from the head.
  followSeatedHead() {
    const t = this.now(), y = this.player.head.getWorldPosition(new Vector3()).y;
    this.headYs.push({ t, y });
    while (this.headYs.length && t - this.headYs[0].t > SETTLE.ms * 1.5) this.headYs.shift();
    if (!shouldReplace(access, this.placedY, this.headYs)) return;
    this.replaced++;
    this.autoPlace();
  }

  voiceFor(v) {
    const me = v.seats && v.seats[this.near];
    if (!me) return v.phase === 'lobby' ? 'Setting the table…' : '';
    if (me.owed_draws > 0) return `Draw ${me.owed_draws}: touch the top card of your deck to the stone.`;
    if (v.phase === 'over') return v.winner === this.near ? 'You win.' : 'The match is over.';
    return v.active === this.near ? 'Your move.' : 'The other seat is thinking…';
  }

  update(delta) {
    this.syncPause?.();
    const t0 = performance.now();
    this.frames.begin(t0);
    try {
      this.step(delta);
    } finally {
      this.frames.work(performance.now() - t0);
    }
  }

  step(delta) {
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (immersive && !this.placed && ++this.immersiveFrames === 2) this.autoPlace();
    if (immersive && this.placed && access.seated) this.followSeatedHead();
    if (!this.table) return;
    const now = this.now();
    const ms = this.pause.frameMs(delta * 1000);
    if (this.pause.paused) return this.altar.update(now);
    for (const fn of this.pause.drain()) fn();
    let changed = false, status = null;
    this.table.advance(ms, (v) => {
      this.prev = this.view;
      this.view = v;
      changed = true;
      const seat = this.table.seat();
      if (seat !== null) this.near = seat;
      this.onView?.(this.prev, v, this.near);
      for (const e of beatEvents(this.prev, v, this.near)) this.guide.event(e, now);
    });
    if (changed) {
      this.frames.tag('view');
      this.board.applyView(this.view, this.near);
      this.menu = this.table.choices();
      this.handCards = this.table.hand();
      const held = new Set([...this.queries.heldCards.entities].map((e) => e.getValue(HandCard, 'slot')));
      const painted = this.hand.set(this.handCards, held);
      if (painted) this.frames.tag('hand', painted);
      this.playable = markPlayable(this.hand.cards, this.handCards, this.menu, access); // the sparkle (art/sparkle.js)
      if (!this.target.active) status = this.voiceFor(this.view); // said after the guide's tick below
      if (this.coldStart.firstFrame === null) this.coldStart.firstFrame = performance.now();
    }
    // Keep the put-it-down line on the altar while a controller is connected, and clear it after.
    const guard = handsGuard(this.inputSources());
    if (guard.blocked !== this.guard.blocked) {
      this.guard = guard;
      // The guard's line waits its turn (it cut the claim line off on the Quest 2); once the
      // controllers are down, the lesson comes back.
      if (guard.blocked) this.voice(guard.message, 'guard');
      else if (this.guide.lesson?.say) this.beat(this.inMode(this.guide.lesson).line, { force: true });
      else if (this.view) this.voice(this.voiceFor(this.view));
    }
    if (this.queries.heldGrip.entities.size) this.hand.followGrip(this.handCards, this.heldSlots());
    this.checkTouches();
    // The guide reads the match every frame (guide/guide.js); its sentence joins the queue.
    // #200's first-run offer comes first: the guide starts once the person has chosen how to play.
    const { lesson, say } = this.guide.tick({ view: this.view, near: this.near, menu: this.menu, hand: this.handCards, ready: !!access.offered }, now);
    if (say) this.beat(this.inMode(lesson).line); // in gaze or voice, that mode's action, not a pinch
    if (status) this.voice(status); // after the tick, so a teaching lesson can hold it back
    this.showLesson(lesson, now);
    const busy = this.queries.heldCards.entities.size + this.queries.heldDeck.entities.size + this.queries.heldCastle.entities.size > 0;
    this.ghost.update(now, { busy, head: this.player?.head?.getWorldPosition(new Vector3()) ?? null, dwellMs: access.dwellMs });
    // The one voice: start the next line when the last has ended (guide/lines.js).
    const line = this.lines.next(now);
    if (line && this.altar.say(line.text, { force: line.kind === 'refusal' || line.force })) this.lines.playing(now);
    const castle = this.castle.poll(now);
    if (castle) this.play({ source: 'castle', action: castle }, this.castleVia);
    const auto = this.target.poll(now);
    if (auto !== null) {
      this.altar.hidePrompt();
      this.propose(auto);
    }
    this.altar.update(now);
  }
}
