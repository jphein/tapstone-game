// assist.js: the accessibility system (design note 2026-09-28-xr-accessibility-design.md). Three
// ways in besides the hands, all of them through play.js's one door (play.play(), castleTap(),
// promptPressed(), unitPressed()), so the engine's menu stays the only source of moves:
//
//   head gaze   a reticle where the head points and a ring that fills while it rests on a card, pad,
//               castle, prompt tile or unit (logic/gaze.js). The Quest 2 and 3S have no eye
//               tracking: this is HEAD gaze, and says so.
//   voice       the on-device keyword spotter (voice-input.js) hears a phrase from the grammar
//               (logic/voice-commands.js); what was heard is shown on the listening chip, and a
//               refusal on the caption band.
//   the panel   a gear beside the altar that opens a column of settings tiles, each reachable by a
//               poke or ray pinch, a dwell, or a spoken "<setting> on/off"; and, on a first run, the
//               offer "hands, head gaze or voice" facing the person at the first frame.
//
// High contrast (theme.js) and large captions are applied here too. None of it adds a sentence to
// the voice clip set: every line it shows is text only (0033: the band is the source of truth).
import {
  createSystem, Mesh, MeshBasicMaterial, PlaneGeometry, PokeInteractable, Pressed,
  Quaternion, Raycaster, RayInteractable, SphereGeometry, Vector3,
} from '@iwsdk/core';
import { PlaySystem } from './play.js';
import { hexVec, ringMaterial } from './dwell-ring.js';
import { AssistTile } from './tags.js';
import { label } from './board.js';
import { access, onAccess, setAccess } from './access.js';
import { palette, onTheme, repaint, themeName, themed } from './theme.js';
import { VoiceInput } from './voice-input.js';
import { Dwell, DWELL_CHOICES, gazeStep, keyOf, lapsFor } from './logic/gaze.js';
import { HELP, heardText, parse, resolve } from './logic/voice-commands.js';
import { targetOf, CASTLE_TARGET } from './logic/menu.js';
import { ALTAR, PLACE } from './logic/layout.js';
import { ambienceName, nextAmbience } from './logic/atmosphere.js';

// The tiles: settings (the panel) and the first-run offer. `text(a, voice)` is the tile's label now.
const onOff = (v) => (v ? 'on' : 'off');
const VOICE_STATE = { off: 'off', starting: 'starting…', listening: 'listening', error: 'unavailable', unavailable: 'not installed' };
export const TILES = [
  { key: 'panel', text: (a, open) => (open ? 'Close settings' : 'Accessibility') },
  { key: 'voice', panel: true, text: (a, v) => `Voice: ${VOICE_STATE[v] ?? v}` },
  { key: 'gaze', panel: true, text: (a) => `Head gaze: ${onOff(a.gaze)}` },
  { key: 'dwellMs', panel: true, text: (a) => `Dwell: ${(a.dwellMs / 1000).toFixed(1)} s` },
  { key: 'highContrast', panel: true, text: (a) => `High contrast: ${onOff(a.highContrast)}` },
  { key: 'largeText', panel: true, text: (a) => `Large captions: ${onOff(a.largeText)}` },
  { key: 'seated', panel: true, text: (a) => `Seated: ${onOff(a.seated)}` },
  { key: 'leftHanded', panel: true, text: (a) => `Left-handed: ${onOff(a.leftHanded)}` },
  { key: 'reducedMotion', panel: true, text: (a) => `Reduced motion: ${onOff(a.reducedMotion)}` },
  { key: 'ambience', panel: true, text: (a) => `Ambient sound: ${ambienceName(a.ambience)}` },
  // Plain text: the canvas font may have no emoji (IWER's Chromium drew them as boxes).
  { key: 'offer.hands', offer: true, text: () => 'Play with my hands' },
  { key: 'offer.gaze', offer: true, text: () => 'Play by looking\n(head gaze)' },
  { key: 'offer.voice', offer: true, text: () => 'Play by voice' },
];
const TILE = { w: 0.1, h: 0.025, gap: 0.006 };
const OFFER = { w: 0.13, h: 0.04 };
// Where the panel stands, board-local: left of the altar and up, turned to the head. Outside the
// ±32° the layout keeps for play, so an open panel never covers a pad or the board.
const PANEL = { x: -0.27, y: 0.05, z: ALTAR.z };
const CONE = (2.5 * Math.PI) / 180; // a target this close to the line of sight counts without a ray hit


export class AssistSystem extends createSystem({
  pressedTiles: { required: [AssistTile, Pressed] },
}) {
  init() {
    this.play = this.world.getSystem(PlaySystem);
    this.dwell = new Dwell({ ms: access.dwellMs });
    this.raycaster = new Raycaster();
    this.head = { p: new Vector3(), q: new Quaternion(), dir: new Vector3() };
    this.gazeStats = { fired: 0, played: 0, byKind: {} };
    this.heard = []; // the last 20 phrases: { at, text, intent, result }
    this.tileLog = []; // the last 50 tile activations: { at, key, via }
    this.panelOpen = false;
    this.offerShown = false;
    this.voice = new VoiceInput(null);
    this.play.kws?.then((b) => {
      this.voice = new VoiceInput(b);
      this.voice.onKeyword((tag) => this.hear(tag, 'mic'));
      this.voice.onState((st, err) => {
        this.drawTiles();
        this.drawChip(st === 'error' ? `Voice unavailable: ${err}` : null);
        if (st === 'error') this.play.altar.say(`Voice unavailable: ${err}`);
      });
      this.drawTiles();
    });
    this.buildGaze();
    this.buildTiles();
    this.buildChip();
    this.themeScene();
    this.applyAccess();
    onAccess((a, key) => this.accessChanged(a, key));
    onTheme(() => {
      this.drawTiles();
      hexVec(palette().dwell, this.ring.material.uniforms.color.value);
      this.reticle.material.color.setHex(palette().reticle);
    });
    this.queries.pressedTiles.subscribe('qualify', (e) => this.activate(TILES[e.getValue(AssistTile, 'key')].key, 'hand'));
    this.world.renderer?.xr?.addEventListener('sessionstart', () => this.sessionStarted());
  }

  // ---- building ------------------------------------------------------------------------------
  buildGaze() {
    this.reticle = new Mesh(new SphereGeometry(0.0025, 8, 6), new MeshBasicMaterial({ color: palette().reticle, depthTest: false, transparent: true }));
    this.reticle.renderOrder = 1000;
    this.ring = new Mesh(new PlaneGeometry(0.03, 0.03), ringMaterial());
    this.ring.renderOrder = 1001;
    hexVec(palette().dwell, this.ring.material.uniforms.color.value);
    this.world.scene.add(this.reticle, this.ring);
    // Compiled now, not at the first dwell (the Quest 2 stalls on a first-use shader compile; index.js
    // prewarm() compiles only what is visible).
    try {
      this.world.renderer.compile(this.ring, this.world.camera);
      this.world.renderer.compile(this.reticle, this.world.camera);
    } catch (e) {
      console.warn('[assist] ring prewarm skipped', e);
    }
    this.reticle.visible = this.ring.visible = false;
  }

  buildTiles() {
    this.tiles = TILES.map((t, i) => {
      const big = !!t.offer;
      const lab = label(big ? 384 : 256, big ? 120 : 64); // ~1 MB of canvases in all, with mipmaps
      // Front side only: a tile always faces the person, and a double-sided transparent quad costs
      // three.js two draw calls (back pass, front pass). Measured in IWER: 26 calls for the open panel.
      const m = new Mesh(new PlaneGeometry(big ? OFFER.w : TILE.w, big ? OFFER.h : TILE.h), new MeshBasicMaterial({ map: lab.tex, transparent: true }));
      const e = this.world.createTransformEntity(m, this.play.rootEntity);
      e.addComponent(PokeInteractable);
      e.addComponent(RayInteractable);
      e.addComponent(AssistTile, { key: i });
      m.userData.gaze = { kind: 'tile', key: t.key };
      return { ...t, m, e, lab };
    });
    this.layoutTiles();
    this.drawTiles();
  }

  layoutTiles() {
    const s = access.largeText ? 1.3 : 1;
    let row = 0;
    const face = (m) => m.lookAt(this.play.root.localToWorld(new Vector3(0, PLACE.down, PLACE.ahead)));
    for (const t of this.tiles) {
      t.m.scale.setScalar(s);
      if (t.offer) {
        const k = ['offer.hands', 'offer.gaze', 'offer.voice'].indexOf(t.key);
        t.m.position.set((k - 1) * (OFFER.w + 0.01) * s, 0.2, 0.3);
      } else if (t.key === 'panel') {
        t.m.position.set(PANEL.x, PANEL.y, PANEL.z);
      } else {
        row++;
        t.m.position.set(PANEL.x, PANEL.y + row * (TILE.h + TILE.gap) * s, PANEL.z);
      }
      face(t.m);
    }
    this.showTiles();
  }

  showTiles() {
    for (const t of this.tiles) t.m.visible = t.offer ? this.offerShown : t.panel ? this.panelOpen : true;
  }

  drawTiles() {
    for (const t of this.tiles) t.lab.draw(t.text(access, t.key === 'panel' ? this.panelOpen : this.voice.state));
  }

  // The listening chip, under the caption band: a dot that swells with the mic's level, and the
  // last phrase heard. Shown only while the mic is open (or to say why it couldn't open).
  buildChip() {
    this.chip = label(768, 64);
    this.chipMesh = new Mesh(new PlaneGeometry(ALTAR.w * 0.9, 0.022), new MeshBasicMaterial({ map: this.chip.tex, transparent: true }));
    this.chipMesh.position.set(0.012, -0.04, ALTAR.z + ALTAR.d / 2 + 0.003);
    this.dot = new Mesh(new SphereGeometry(0.005, 12, 8), new MeshBasicMaterial({ color: 0xff3b3b }));
    this.dot.position.set(-ALTAR.w * 0.45 - 0.004, -0.04, ALTAR.z + ALTAR.d / 2 + 0.006);
    this.play.altar.group.add(this.chipMesh, this.dot);
    this.drawChip();
  }

  drawChip(message = null) {
    const listening = this.voice.state === 'listening' || this.voice.state === 'starting';
    this.chipMesh.visible = this.dot.visible = listening || !!message;
    const last = this.heard[this.heard.length - 1];
    this.chip.draw(message ?? (this.voice.state === 'starting' ? 'Voice: starting…' : `Listening${last ? ` · heard “${last.text.toLowerCase()}”${last.ok ? '' : ' ✗'}` : ' · say “what can I say”'}`));
  }

  // High contrast for the altar and the board, themed by their parts from here (theme.js keeps each
  // material's own colour as its standard, so the world art's look is untouched until the switch):
  // the pads, the deck, the castle card, the stone; the board's cells and base (where they are plain
  // colours: a painted mat is the art's to theme, theme.js says how); and the units, whose colour
  // each view sets again (their faction), so the board's applyView is followed by a repaint.
  themeScene() {
    const p = this.play, a = p.altar, b = p.board;
    const plain = (m) => m.isMesh && m.material && !m.material.map && m.material.color;
    a.pads.forEach((pad) => themed(pad.m.material, 'pad'));
    themed(a.deckTop.material, 'deck.top');
    themed(a.castle.material, 'castle');
    if (a.stack) themed(a.stack.material, 'deck');
    const known = new Set([a.eye, a.deckTop, a.castle, a.stack, ...a.pads.map((x) => x.m)]);
    for (const m of a.group.children) if (plain(m) && !known.has(m)) themed(m.material, 'altar.stone');
    const units = new Set([...b.slots.values()].flatMap((s) => [s.figure, s.plinth]));
    for (const m of b.group.children) {
      if (!plain(m) || units.has(m) || m === b.myPlaque || m === b.farKeep) continue;
      themed(m.material, m.material.isMeshBasicMaterial ? 'board.near' : 'board.base');
    }
    const faction = (f) => `faction.${f === 'ember' || f === 'tide' ? f : 'neutral'}`;
    const apply = b.applyView.bind(b);
    b.applyView = (v, near) => {
      apply(v, near);
      const seats = (v.phase === 'lobby' && !v.lobby?.length && v.last_over ? v.last_over : v).seats;
      if (!seats?.length) return;
      for (const s of b.slots.values()) {
        const u = seats[s.seat]?.cells[s.lane][s.cell];
        if (!u) continue;
        for (const m of [s.figure, s.plinth]) {
          themed(m.material, faction(u.faction));
          repaint(m.material);
        }
      }
      for (const [m, seat] of [[b.myPlaque, seats[near]], [b.farKeep, seats[1 - near]]]) {
        if (!m?.material?.color || !seat) continue;
        themed(m.material, faction(seat.faction));
        repaint(m.material);
      }
    };
    onTheme(() => this.play.view && b.applyView(this.play.view, this.play.near));
    // The caption band: found by its texture, so a rebuilt altar still has one to enlarge.
    this.band = a.band ?? a.group.children.find((m) => m.material?.map && m.material.map === a.voice?.tex) ?? null;
    this.themeName = themeName;
  }

  // ---- settings ------------------------------------------------------------------------------
  applyAccess() {
    this.dwell.ms = access.dwellMs;
    this.band?.scale.setScalar(access.largeText ? 1.5 : 1);
    this.chipMesh.position.y = access.largeText ? -0.052 : -0.04;
    this.dot.position.y = this.chipMesh.position.y;
    this.chipMesh.scale.setScalar(access.largeText ? 1.3 : 1);
    // Gaze and voice take longer than a pinch: the target prompt's default and the castle's mulligan
    // window wait longer, so the default doesn't win while a person is still looking or speaking.
    const slow = access.gaze || access.voice;
    this.play.target.ms = slow ? 8000 : 3000;
    this.play.castle.windowMs = slow ? 6000 : 3000;
  }

  accessChanged(a, key) {
    this.applyAccess();
    if (key === 'largeText') this.layoutTiles();
    if (key === 'gaze' && !a.gaze) this.dwell.reset();
    if (key === 'voice') a.voice ? this.voice.start() : this.voice.stop();
    this.drawTiles();
    this.drawChip();
  }

  // A tile, by hand, gaze or voice.
  activate(key, via) {
    const flip = (k) => setAccess(k, !access[k]);
    switch (key) {
      case 'panel':
        this.openPanel(!this.panelOpen);
        break;
      case 'voice':
        setAccess('voice', !(this.voice.state === 'listening' || this.voice.state === 'starting'));
        if (access.voice && this.voice.state === 'off') this.voice.start();
        break;
      case 'dwellMs':
        setAccess('dwellMs', DWELL_CHOICES[(DWELL_CHOICES.indexOf(access.dwellMs) + 1) % DWELL_CHOICES.length]);
        break;
      case 'ambience':
        setAccess('ambience', nextAmbience(access.ambience));
        break;
      case 'offer.hands':
      case 'offer.gaze':
      case 'offer.voice':
        this.answerOffer(key.slice(6));
        break;
      default:
        flip(key);
    }
    this.drawTiles();
    this.tileLog.push({ at: Math.round(this.play.now()), key, via });
    if (this.tileLog.length > 50) this.tileLog.shift();
  }

  openPanel(open) {
    this.panelOpen = open;
    this.showTiles();
    this.drawTiles();
  }

  // ---- the first run -------------------------------------------------------------------------
  // At the first frame of a first session (nothing stored says the offer was answered), the offer
  // faces the person before anything else asks for a move. The guide (the first five) is not held:
  // the offer is its own tiles, and answering it takes one pinch, one dwell or one phrase.
  sessionStarted() {
    if (!access.offered) {
      this.offerShown = true;
      this.showTiles();
    }
    // A remembered voice opt-in reopens the mic with the session (and its indicator shows).
    if (access.voice && this.voice.state === 'off') this.voice.start();
  }

  answerOffer(way) {
    this.offerShown = false;
    setAccess('offered', true);
    if (way === 'gaze') setAccess('gaze', true);
    if (way === 'voice') setAccess('voice', true);
    this.showTiles();
    // Through the guide's line queue (guide/lines.js), so the lesson that follows waits for it.
    this.play.voice(way === 'gaze' ? 'Head gaze on: rest your view on a card, then on a pad, to play it.' : way === 'voice' ? `Voice on. ${HELP}` : 'Hands it is. The Accessibility tile left of the stone changes this any time.', 'lesson');
  }

  // ---- voice ---------------------------------------------------------------------------------
  // A heard phrase (a spotter tag, or typed text from __tapstone.hear) through the grammar, then
  // through play.js exactly as a hand's gesture. Answers what happened, for the IWER driver.
  hear(text, source = 'typed') {
    const p = this.play;
    const intent = parse(text);
    const entry = { at: Math.round(p.now()), text: String(text).replace(/_/g, ' '), source, intent, ok: false, result: null };
    this.heard.push(entry);
    if (this.heard.length > 20) this.heard.shift();
    if (!intent) {
      entry.result = 'not in the grammar';
      this.drawChip();
      return entry;
    }
    const r = p.table ? resolve(intent, { menu: p.table.choices(), hand: p.handCards }) : { refused: 'The table is still setting up.' };
    entry.ok = !r.refused;
    if (r.refused) {
      p.stats.refused++;
      p.refuse(`${heardText(intent)} ${r.refused}`); // the guide's queue: only the newest refusal waits
      entry.result = r.refused;
    } else if (r.gesture) {
      const before = p.stats.taps;
      p.play(r.gesture, 'voice');
      entry.result = p.stats.taps > before ? 'played' : 'sent';
    } else if (r.choose) {
      p.menu = p.table.choices();
      p.target.start(p.now(), r.choose, 0);
      p.altar.showPrompt(r.choose);
      p.altar.say(`${heardText(intent)} Say target 1 to ${r.choose.length}.`);
      entry.result = `choose ${r.choose.length}`;
    } else if (r.pick !== undefined) {
      if (p.target.active && p.target.options[r.pick]) p.promptPressed(r.pick);
      else p.refuse(`${heardText(intent)} There is no target ${r.pick + 1} to choose.`);
      entry.result = 'pick';
    } else if (r.claim) {
      if (p.beats.active && p.beats.beat.teaches === 'claim') p.castleTap('voice');
      else p.refuse(`${heardText(intent)} There is nothing to claim now.`);
      entry.result = 'claim';
    } else if (r.cancel) {
      p.lifted = null;
      p.altar.say('Cancelled.');
      entry.result = 'cancel';
    } else if (r.help) {
      p.altar.say(HELP);
      entry.result = 'help';
    } else if (r.setting) {
      setAccess(r.setting.key, r.setting.value);
      p.altar.say(`${heardText(intent)}`);
      entry.result = 'setting';
    } else if (r.panel !== undefined) {
      this.openPanel(r.panel);
      entry.result = 'panel';
    } else if (r.mic === false) {
      setAccess('voice', false);
      this.voice.stop();
      entry.result = 'mic off';
    }
    this.drawChip();
    return entry;
  }

  // ---- gaze ----------------------------------------------------------------------------------
  // What the head points at this frame, as a gaze target, and where (for the reticle). Tiles are
  // always targets, so a person with no hands can reach the panel (and turn gaze on) by looking;
  // the game's things only while gaze is on.
  targets() {
    const p = this.play, out = [];
    const add = (m, t) => {
      if (m?.visible && m.parent?.visible !== false) {
        m.userData.gaze = t;
        out.push(m);
      }
    };
    for (const t of this.tiles) if (t.m.visible) out.push(t.m);
    if (!access.gaze) return out;
    p.altar.pads.forEach((pad) => add(pad.m, { kind: 'pad', lane: pad.lane }));
    add(p.altar.deckTop, { kind: 'deck' });
    add(p.altar.castle, { kind: 'castle' });
    p.hand.cards.forEach((c, slot) => add(c.mesh, { kind: 'hand', slot }));
    if (p.target.active) {
      p.altar.prompt.forEach((t, option) => add(t.m, { kind: 'prompt', option }));
      for (const s of p.board.slots.values()) {
        const t = { kind: 'unit', target: targetOf(s.seat, s.lane, s.cell) };
        add(s.figure, t);
        add(s.plinth, t);
      }
      add(p.board.farKeep, { kind: 'unit', target: CASTLE_TARGET });
    }
    return out;
  }

  gaze(now) {
    const head = this.player?.head;
    if (!head) return;
    head.getWorldPosition(this.head.p);
    head.getWorldQuaternion(this.head.q);
    this.head.dir.set(0, 0, -1).applyQuaternion(this.head.q);
    this.raycaster.set(this.head.p, this.head.dir);
    this.raycaster.far = 3;
    const list = this.targets();
    const hit = this.pick(list);
    const target = hit?.object.userData.gaze ?? null;
    const onTile = target?.kind === 'tile';
    // With gaze off, a tile takes one and a half dwells: looking round the room shouldn't open things.
    const laps = !access.gaze && onTile ? 1.5 : lapsFor(target, this.play.lifted);
    const d = this.dwell.update(now, target, laps);
    // The reticle: always while gaze is on; otherwise only on a tile, where a dwell would act.
    const show = access.gaze || onTile;
    const at = hit ? hit.point : this.head.p.clone().addScaledVector(this.head.dir, 0.6);
    const toward = at.clone().addScaledVector(this.head.dir, -0.004);
    this.reticle.visible = show;
    this.reticle.position.copy(toward);
    this.ring.visible = show && d.progress > 0;
    this.ring.position.copy(toward);
    this.ring.quaternion.copy(this.head.q);
    this.ring.material.uniforms.progress.value = d.progress;
    this.gazeNow = { target, key: d.key, progress: d.progress };
    if (d.fired) this.dwelt(d.fired);
  }

  // What the head is looking at: of everything the ray crosses (and anything within a small cone of
  // it, as IWSDK's own gaze system widens small targets), the one whose centre is nearest the line
  // of sight. The first thing the ray crosses isn't it: the hand's fan grazes the ray to the deck
  // (measured in IWER: a look at the deck lifted the rightmost card), and a person looking at the
  // deck is looking at the deck. Answers { object, point } or null.
  pick(list) {
    if (!list.length) return null;
    const hits = this.raycaster.intersectObjects(list, false);
    const c = new Vector3();
    let best = null;
    for (const m of list) {
      m.getWorldPosition(c);
      const to = c.sub(this.head.p);
      const dist = to.length();
      const angle = to.angleTo(this.head.dir);
      const crossed = hits.find((h) => h.object === m);
      if (!crossed && angle > CONE) continue;
      if (!best || angle < best.angle) best = { object: m, angle, point: crossed ? crossed.point : this.head.p.clone().addScaledVector(this.head.dir, dist) };
    }
    return best;
  }

  // A completed dwell: the same effect a pinch has on the eyes-and-hands path (logic/gaze.js).
  dwelt(t) {
    const p = this.play;
    this.gazeStats.fired++;
    this.gazeStats.byKind[t.kind] = (this.gazeStats.byKind[t.kind] ?? 0) + 1;
    const s = gazeStep(p.lifted, t, p.handCards);
    if (t.kind === 'hand') return p.liftCard(t.slot);
    if (t.kind === 'deck') return p.lift({ source: 'deck' });
    if (s.gesture) {
      p.lifted = s.lifted;
      this.gazeStats.played++;
      return p.play(s.gesture, 'gaze');
    }
    if (s.castle) return p.castleTap('gaze');
    if (s.prompt !== undefined) return p.promptPressed(s.prompt);
    if (s.unit !== undefined) return p.unitPressed(s.unit);
    if (s.tile) return this.activate(s.tile, 'gaze');
  }

  update() {
    const now = this.play.now();
    if (this.hideAll) {
      // For measuring what this system costs (__tapstone.assistHidden): nothing of it is drawn.
      for (const m of [...this.tiles.map((t) => t.m), this.chipMesh, this.dot, this.reticle, this.ring]) m.visible = false;
      return this.expose();
    }
    this.gaze(now);
    if (this.dot.visible) this.dot.scale.setScalar(1 + Math.min(1, this.voice.level * 12) * 1.5);
    this.expose();
  }

  // The IWER driver's hooks, added to the page's __tapstone once play.js has made it.
  expose() {
    const t = globalThis.__tapstone;
    if (!t || t.assist) return;
    t.assist = () => ({
      access: { ...access },
      gaze: { ...this.gazeNow, key: this.gazeNow?.key ?? null, stats: { ...this.gazeStats, byKind: { ...this.gazeStats.byKind } } },
      voice: { state: this.voice.state, error: this.voice.error, stats: { ...this.voice.stats }, level: this.voice.level, heard: this.heard.map((h) => ({ ...h })) },
      panelOpen: this.panelOpen,
      offerShown: this.offerShown,
      tiles: this.tileLog.map((x) => ({ ...x })),
    });
    t.hear = (text) => ({ ...this.hear(text, 'typed') });
    t.tile = (key) => (this.activate(key, 'hook'), true);
    t.voiceStart = () => this.voice.start().then(() => this.voice.state);
    t.assistHidden = (on) => {
      this.hideAll = !!on;
      if (!on) {
        this.showTiles();
        this.drawChip();
      }
      return this.hideAll;
    };
    // Where each gaze target is in the world, so a driver can turn IWER's head to it.
    t.gazeTargets = () => this.targets().map((m) => {
      const w = m.getWorldPosition(new Vector3());
      return { ...m.userData.gaze, key: keyOf(m.userData.gaze), x: w.x, y: w.y, z: w.z };
    });
  }
}
