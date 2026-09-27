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
import { createSystem, Grabbed, Group, Pressed, Vector3, VisibilityState } from '@iwsdk/core';
import { Board } from './board.js';
import { Altar } from './altar.js';
import { Hand } from './hand.js';
import { CastleCard, DeckTop, HandCard, Pad, PromptTile, TargetUnit } from './tags.js';
import { openTable } from './table.js';
import { markLoaded, preloadProfiles } from './net.js';
import { preloadCardArt } from './card-art.js';
import { preloadVoice } from './voice.js';
import { handsGuard } from './guard.js';
import { matchGesture, gestureForItem } from './logic/menu.js';
import { CastleTaps, TargetTimer, pressKind } from './logic/gestures.js';
import { FirstFive, beatEvents, gestureOf } from './logic/first-five.js';
import { PLACE, padCenter } from './logic/layout.js';
import { shouldReplace, SETTLE } from './logic/access.js';
import { FrameLog } from './logic/frames.js';
import { access, onAccess } from './access.js';

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
    this.stats = { taps: 0, refused: 0, poke: 0, ray: 0, touch: 0, guarded: 0 };
    this.guard = { blocked: false, message: null };
    this.onView = null; // set by EffectsSystem: (prev, next, near) => void
    this.sfxStats = null; // set by EffectsSystem: the payoff sounds' counts, for the IWER gate
    this.placedY = null; // the head height the board was placed for (seated mode re-places from it)
    this.headYs = []; // the last ~second of head heights, while seated: [{ t, y }]
    this.replaced = 0;
    this.altar.applySides(access);
    onAccess((a, key) => {
      if (key === 'leftHanded') this.altar.applySides(a);
      if (key === 'seated') this.headYs = [];
    });
    this.beats = new FirstFive();
    this.beatLog = []; // [{ at, beat, why, say }]: what the tutorial said, for the IWER gate
    this.beat(this.beats.start(this.now()));
    this.queries.pressedCards.subscribe('qualify', (e) => this.liftCard(e.getValue(HandCard, 'slot')));
    this.queries.pressedDeck.subscribe('qualify', () => this.lift({ source: 'deck' }));
    this.queries.pressedCastle.subscribe('qualify', () => this.castleTap());
    this.queries.pressedPads.subscribe('qualify', (e) => this.padPressed(e.getValue(Pad, 'lane'), e));
    this.queries.pressedPrompt.subscribe('qualify', (e) => this.promptPressed(e.getValue(PromptTile, 'option')));
    this.queries.pressedUnits.subscribe('qualify', (e) => this.unitPressed(e.getValue(TargetUnit, 'target')));
    Promise.all([openTable(`${import.meta.env.BASE_URL}tapstone_web.wasm`, SEED, HUMAN), preloadProfiles(import.meta.env.BASE_URL), preloadCardArt(import.meta.env.BASE_URL), preloadVoice(import.meta.env.BASE_URL)]).then(([t, , , speaker]) => {
      this.table = t;
      this.altar.attach(speaker);
      markLoaded();
      globalThis.__tapstone = {
        table: t,
        play: this,
        // M3 (tools/iwer-profile.mjs): the frame log's report, and a reset to start a window.
        frames: (opts) => this.frames.report(opts),
        framesReset: () => (this.frames = this.altar.frames = new FrameLog()) && true,
        access: () => ({ ...access, replaced: this.replaced, placedY: this.placedY }),
        stats: () => ({ ...this.stats, done: t.done(), seat: this.near, voice: { ...speaker.stats, heard: [...speaker.stats.heard] }, sfx: this.sfxStats ? { ...this.sfxStats, byName: { ...this.sfxStats.byName } } : null }),
        beats: () => ({ beat: this.beats.beat?.id ?? null, done: this.beats.done, said: [...this.beatLog] }),
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

  now() {
    return performance.now();
  }

  // The tutorial's sentence, when a beat starts or reminds.
  beat(text) {
    if (!text) return;
    this.altar.say(text);
    this.beatLog.push({ at: Math.round(this.now()), beat: this.beats.beat?.id ?? null, why: this.beats.why, say: text });
  }

  // Every other voice line: held back while a beat is teaching, so one sentence at a time. An
  // unanswered beat hands the voice back when its clock window ends (logic/first-five.js holding()).
  voice(text) {
    if (!this.beats.holding(this.now())) this.altar.say(text);
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
    // The claim beat: the castle on the stone is the claim itself (the desk seats the person), so
    // the tap is the beat's gesture and goes no further.
    if (this.beats.active && this.beats.beat.teaches === 'claim') return this.beat(this.beats.gesture('claim', this.now()));
    const open = this.menu.some((m) => m.kind === 'Mulligan');
    const r = this.castle.tap(this.now(), open);
    if (r === 'pending') this.voice('Pass. Tap the castle again within 3 s to mulligan.');
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
  // The XR session's input sources this frame (empty outside a session).
  inputSources() {
    return [...(this.world.renderer.xr.getSession()?.inputSources ?? [])];
  }

  play(g) {
    if (!this.table) return;
    // The hands-only guard: nothing is played while a controller is connected (guard.js).
    const guard = handsGuard(this.inputSources());
    if (guard.blocked) {
      this.stats.guarded++;
      this.altar.refuse(guard.message, this.now());
      return;
    }
    this.menu = this.table.choices();
    const r = matchGesture(this.menu, g);
    if (r.index !== undefined) return this.propose(r.index);
    if (r.need === 'target') {
      this.target.start(this.now(), r.options, 0);
      this.altar.showPrompt(r.options);
      this.voice('Choose a target: look and pinch, or wait 3 s for the nearest.');
      return;
    }
    this.stats.refused++;
    this.altar.refuse(r.refused, this.now());
  }

  propose(index) {
    const item = this.menu[index];
    if (this.table.propose(index)) {
      this.stats.taps++;
      this.voice(item ? item.label : '');
      this.beat(this.beats.gesture(gestureOf(item), this.now()));
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
    this.placedY = h.y;
    this.headYs = [];
    const now = this.now();
    this.beat(this.beats.gesture('place', now));
    this.beat(this.beats.event('placed', now));
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
    let changed = false;
    this.table.advance(Math.min(delta * 1000, 100), (v) => {
      this.prev = this.view;
      this.view = v;
      changed = true;
      const seat = this.table.seat();
      if (seat !== null) this.near = seat;
      this.onView?.(this.prev, v, this.near);
      for (const e of beatEvents(this.prev, v, this.near)) this.beat(this.beats.event(e, now));
    });
    if (changed) {
      this.frames.tag('view');
      this.board.applyView(this.view, this.near);
      this.menu = this.table.choices();
      this.handCards = this.table.hand();
      const held = new Set([...this.queries.heldCards.entities].map((e) => e.getValue(HandCard, 'slot')));
      const painted = this.hand.set(this.handCards, held);
      if (painted) this.frames.tag('hand', painted);
      if (!this.target.active) this.voice(this.voiceFor(this.view));
    }
    // Keep the put-it-down line on the altar while a controller is connected, and clear it after.
    const guard = handsGuard(this.inputSources());
    if (guard.blocked !== this.guard.blocked) {
      this.guard = guard;
      if (guard.blocked) this.altar.say(guard.message);
      else if (this.beats.holding(now)) this.altar.say(this.beats.beat.say);
      else this.altar.say(this.view ? this.voiceFor(this.view) : '');
    }
    this.checkTouches();
    this.beat(this.beats.poll(now));
    // The beat's hold just ended: say the line it held back (the voice band's current state).
    if (this.beats.release(now) && this.view && !this.target.active && !this.guard.blocked) this.voice(this.voiceFor(this.view));
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
