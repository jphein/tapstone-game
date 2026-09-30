// system.js: the summons in the scene (design note 2026-09-28-xr-summons-design.md). The director
// (direct.js) says what each creature does, from the effect queue as it plays; this carries it out:
// the card's hologram lifting off the pad and burning away, the creature forming out of that light
// and flying the arc to its cell, then idle, attack, hit and death clips, with the faction's
// holographic material (holo.js). My creatures draw LOD0 and the other seat's LOD1 (0027: mine are
// objects, theirs are entries). The board stays the truth: while the queue is idle the director
// reconciles to the newest view.
import { AnimationMixer, Box3, Quaternion, CanvasTexture, CircleGeometry, Color, Group, IcosahedronGeometry, InstancedMesh, LoopOnce, LoopRepeat, Matrix4, Mesh, PlaneGeometry, SRGBColorSpace, ShaderMaterial, Vector3, createSystem } from '@iwsdk/core';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PlaySystem } from '../play.js';
import { EffectsSystem } from '../effects-player.js';
import { FACTION } from '../board.js';
import { CARD, CASTLE_PLAQUE, FAR_KEEP, ALTAR, cellCenter, padCenter } from '../logic/layout.js';
import { FACE } from '../logic/card-art.js';
import { sides } from '../logic/access.js';
import { access } from '../access.js';
import { cardArt } from '../card-art.js';
import { CARD_ID, creatureFor, resolveModel, modelFile, modelsNeeded } from './creatures.js';
import { Director, STATE_MS, settled } from './direct.js';
import { ghostMaterial, glowMaterial, holoMaterial, setLook, tick, LIGHT_BLEND } from './holo.js';
import { flight, lookFor, soar, summonStyle, SOAR } from './look.js';
import { Wyrm } from './wyrm.js';
import { pose as wyrmPose, span as wyrmSpan } from './wyrm-pose.js';
import { TeahouseSystem } from '../teahouse.js';
import { themed, themeName, onTheme } from '../theme.js';
import { LANE_W } from '../logic/layout.js';
import { Motes, SpellFx } from './spell-fx.js';

const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// The summon's timeline (ms from the cast), design note §"Card → creature".
// A flier's flight is the long, turning one (look.js flight()); a walker leaps.
const T = { lift: 350, dissolve: [300, 650], form: [450, 900], fly: [900, 1500], flyWing: [900, 2300], formScale: 1.15, formHere: 900 };
const DISCS = 24;
const WYRM_SPAN = wyrmSpan(wyrmPose('glide', 0)); // dragon units, wings spread
const turnTo = (a, b, k) => a + (((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * k;

export class SummonsSystem extends createSystem({}) {
  init() {
    this.group = new Group();
    this.group.name = 'summons';
    this.models = new Map(); // model → {scene, clips, top}
    this.creatures = new Map(); // director id → creature
    this.director = new Director({ reduced: access.reducedMotion });
    this.motes = new Motes();
    this.fx = new SpellFx(this.motes, FACTION);
    this.group.add(this.motes.points, this.fx.group);
    this.ghosts = [0, 1].map(() => this.makeGhost());
    this.wispGeo = new IcosahedronGeometry(0.014, 1);
    this.coreGeo = new IcosahedronGeometry(1, 1);
    // The glow each creature stands in (a flier's is softer, on the cell below it): every one of
    // them in one instanced draw call.
    this.discs = new InstancedMesh(new CircleGeometry(1, 28), new ShaderMaterial({
      transparent: true, depthWrite: false, ...LIGHT_BLEND,
      vertexShader: 'varying vec2 vUv; varying vec3 vC; void main() { vUv = position.xy; vC = instanceColor; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec2 vUv; varying vec3 vC; void main() { float r = length(vUv); float a = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(vC * a * a * (0.55 + 0.45 * smoothstep(0.55, 0.8, r) * smoothstep(1.0, 0.8, r) * 2.0), 1.0); }',
    }), DISCS);
    this.discs.instanceMatrix.setUsage(35048); // DynamicDrawUsage
    this.discs.setColorAt(0, new Color(0));
    this.discs.count = 0;
    this.discs.frustumCulled = false;
    this.discs.renderOrder = 2;
    this.group.add(this.discs);
    this._m = new Matrix4();
    this._c = new Color();
    // The faction tints, themed once (theme.js): a creature copies its faction's on spawn and when the
    // theme changes, so no per-creature material is ever registered.
    this.tints = Object.fromEntries(Object.entries(FACTION).map(([f, hex]) => [f, themed({ color: new Color(hex) }, `faction.${f}`)]));
    onTheme(() => {
      for (const c of this.creatures.values()) this.paintTint(c);
    });
    this.lookKey = null;
    this.bound = false;
    this.last = performance.now();
    this.reconciled = null;
    this.failed = [];
    this.cost = { n: 0, sum: 0, max: 0 };
    this.stats = { spawned: 0, attacks: 0, hits: 0, deaths: 0, spells: 0, reconciled: 0, wisps: 0, loadMs: 0 };
    const play = this.world.getSystem(PlaySystem);
    const base = import.meta.env.BASE_URL;
    this.ready = this.load(base);
    // "Loaded" (net.js: nothing on the network after it) waits for the creatures too.
    play?.loadGate?.push(this.ready);
    globalThis.__tapstoneSummons = {
      stats: () => this.report(),
      census: () => this.director.census(),
      costReset: () => (this.cost = { n: 0, sum: 0, max: 0 }) && true,
      gallery: (per) => this.gallery(per),
      // Why a census might differ from the board: the queue's state and the last reconcile.
      debug: () => {
        const pl = this.world.getSystem(PlaySystem);
        return { active: this.effects?.active?.e.type ?? null, queued: this.effects?.queue.length ?? null, reconciledSeq: this.reconciled?.seq ?? null, viewSeq: pl?.view?.seq ?? null, same: this.reconciled === pl?.view };
      },
    };
  }

  async load(base) {
    const t0 = performance.now();
    const loader = new GLTFLoader();
    await Promise.all(modelsNeeded().map(async (m) => {
      try {
        // `?summonsDrop=<model>` (test hook, tools/iwer-summons.mjs --drop): act as if its file failed.
        if (globalThis.location && new URLSearchParams(globalThis.location.search).get('summonsDrop') === m) throw new Error('dropped by ?summonsDrop');
        const g = await loader.loadAsync(`${base}${modelFile(m)}`);
        const box = new Box3().setFromObject(g.scene);
        this.models.set(m, { scene: g.scene, clips: Object.fromEntries(g.animations.map((a) => [a.name, a])), top: box.max.y, len: box.max.z - box.min.z });
      } catch (e) {
        this.failed.push(m);
        console.warn(`[tapstone] summons: no ${m}, the wisp stands in`, e);
      }
    }));
    this.stats.loadMs = Math.round(performance.now() - t0);
    console.log(`[tapstone] summons: ${this.models.size} creatures in ${this.stats.loadMs} ms`);
    this.prewarm();
  }

  // Build one of each kind and compile it before XR entry (index.js prewarm's reason: a shader
  // compiled on first use stalls the Quest's first frames).
  prewarm() {
    const play = this.world.getSystem(PlaySystem);
    if (!play || !this.world.renderer) return;
    const tmp = [this.build({ name: 'Cinder Whelp', faction: 'ember' }, 0, 0), this.build({ name: 'Reef Archer', faction: 'tide' }, 1, 0), this.build({ name: '(wisp)', faction: 'tide' }, 1, 0)];
    for (const c of tmp) this.group.add(c.root);
    for (const g of this.ghosts) g.mesh.visible = true;
    for (const m of [...this.fx.bolts, ...this.fx.rings, ...this.fx.waves]) m.visible = true;
    play.root.add(this.group);
    try {
      this.world.renderer.compile(this.world.scene, this.world.camera);
    } catch (e) {
      console.warn('[tapstone] summons prewarm skipped', e);
    }
    for (const c of tmp) {
      this.group.remove(c.root);
      if (c.wyrm) c.wyrm.dispose();
      else for (const m of c.mats) m.dispose();
    }
    this.stats.wisps = 0; // the prewarm's wisp is no unit
    this.stats.fallbacks = 0; // nor are its creatures
    for (const g of this.ghosts) g.mesh.visible = false;
    for (const m of [...this.fx.bolts, ...this.fx.rings, ...this.fx.waves]) m.visible = false;
  }

  bind() {
    if (this.bound) return this.world.getSystem(PlaySystem);
    const play = this.world.getSystem(PlaySystem);
    const fx = this.world.getSystem(EffectsSystem);
    if (!play || !fx || !play.board) return null;
    if (this.group.parent !== play.root) play.root.add(this.group);
    this.near = play.near;
    fx.onEffect((e) => this.onEffect(e));
    this.effects = fx;
    this.bound = true;
    return play;
  }

  // ---- places (root-local: the board group sits at the root's origin) ----------------------------

  cell(seat, lane, cell, out = new Vector3()) {
    const p = cellCenter(seat, lane, cell, this.near);
    return out.set(p.x, p.y, p.z);
  }

  castle(seat, out = new Vector3()) {
    return seat === this.near ? out.set(0, CASTLE_PLAQUE.h + 0.01, CASTLE_PLAQUE.z) : out.set(0, FAR_KEEP.h * 0.7, FAR_KEEP.z + FAR_KEEP.d / 2);
  }

  targetPoint(t, out = new Vector3()) {
    if (!t) return out.set(0, 0.02, 0);
    if (t.castle !== undefined) return this.castle(t.castle, out);
    if (t.deck !== undefined) {
      if (t.deck === this.near) {
        const d = sides(access).deck;
        return out.set(d.x, ALTAR.h + 0.02, d.z);
      }
      return out.set(0.05, FAR_KEEP.h, FAR_KEEP.z);
    }
    return this.cell(t.seat, t.lane, t.cell, out).add(new Vector3(0, 0.03, 0));
  }

  // ---- the card's hologram ------------------------------------------------------------------------

  makeGhost() {
    const canvas = document.createElement('canvas');
    canvas.width = FACE.w;
    canvas.height = FACE.h;
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(new PlaneGeometry(CARD.w, CARD.d), ghostMaterial(tex));
    mesh.visible = false;
    mesh.renderOrder = 8;
    this.group.add(mesh);
    return { canvas, tex, mesh, busy: false };
  }

  paintGhost(g, name, faction) {
    const c = g.canvas.getContext('2d');
    const col = hex(FACTION[faction] ?? FACTION.neutral);
    c.clearRect(0, 0, FACE.w, FACE.h);
    c.fillStyle = 'rgba(10,14,22,0.72)';
    c.fillRect(0, 0, FACE.w, FACE.h);
    c.strokeStyle = col;
    c.lineWidth = 8;
    c.strokeRect(4, 4, FACE.w - 8, FACE.h - 8);
    const a = FACE.art;
    const art = CARD_ID[name] !== undefined ? cardArt(CARD_ID[name]) : null;
    if (art) c.drawImage(art, a.x, a.y, a.w, a.h);
    else {
      c.fillStyle = col;
      c.fillRect(a.x, a.y, a.w, a.h);
    }
    c.fillStyle = '#f4efe2';
    c.font = '600 26px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText(name, FACE.w / 2, FACE.nameY, FACE.w - 20);
    g.tex.needsUpdate = true;
  }

  // ---- creatures -----------------------------------------------------------------------------------

  build(unit, seat, lane) {
    const spec = resolveModel(creatureFor(unit), new Set(this.models.keys()));
    if (spec.fellBack) this.stats.fallbacks = (this.stats.fallbacks ?? 0) + 1;
    const tint = FACTION[unit.faction] ?? FACTION.neutral;
    const root = new Group();
    const body = new Group();
    root.add(body);
    const model = this.models.get(spec.model);
    const c = { unit, spec, root, body, seat, lane, mats: [], mixer: null, actions: {}, current: null, meshes: [], tris: [0, 0] };
    if (spec.procedural) {
      // The Cinder Whelp (wyrm.js): standing on its legs, its span a cell wide.
      const w = new Wyrm(tint);
      const k = spec.span / WYRM_SPAN;
      w.object.scale.setScalar(k);
      w.object.position.y = 0.15 * k;
      body.add(w.object);
      c.wyrm = w;
      c.mats.push(w.material);
      c.meshes = [w.mesh];
      c.tris = [w.tris, w.tris];
      this.playClip(c, 'idle'); // perched until its summon says otherwise
    } else if (model) {
      const scene = cloneSkinned(model.scene);
      // By its length nose to tail (the drake), or by its height (the rest).
      const scale = spec.length ? spec.length / model.len : spec.height / model.top;
      scene.scale.setScalar(scale);
      const mat = holoMaterial(tint);
      c.mats.push(mat);
      const skinned = [];
      scene.traverse((o) => {
        if (!o.isMesh) return;
        o.material = mat;
        o.frustumCulled = false; // a skinned creature's bind-pose bounds lag its clips
        skinned.push(o);
      });
      skinned.sort((x, y) => y.geometry.index.count - x.geometry.index.count); // [lod0, lod1]
      c.meshes = skinned;
      c.tris = skinned.map((m) => m.geometry.index.count / 3);
      body.add(scene);
      c.mixer = new AnimationMixer(scene);
      for (const [role, clip] of Object.entries(model.clips)) c.actions[role] = c.mixer.clipAction(clip);
      c.mixer.addEventListener('finished', (ev) => {
        if (ev.action !== c.actions.death && !c.dying) this.playClip(c, c.flying ? 'move' : 'idle');
      });
      // The drake's bones the summons drive: its jaw (fire), its head (the fire's source), its chest
      // (the fire heart, riding it).
      const bone = (n) => scene.getObjectByName(n) ?? null;
      c.bones = { jaw: bone('beak_001B'), head: bone('head'), chest: bone('spine005'), fire: spec.fireFrom ? bone(spec.fireFrom) : null };
      if (spec.glowBone && bone(spec.glowBone)) {
        // Forge Runner's ember, glowing in his hand.
        const ember = new Mesh(this.coreGeo, glowMaterial(0xffa040, 0.9));
        ember.scale.setScalar(0.005 / scale);
        ember.renderOrder = 2;
        ember.frustumCulled = false;
        bone(spec.glowBone).add(ember);
        c.core = ember;
      }
      if (spec.soars && c.bones.chest) {
        const core = new Mesh(this.coreGeo, glowMaterial(0xff9a3a, 0.85));
        core.scale.setScalar(0.006 / scale); // ~6 mm at board size, in the chest bone's (scaled) space
        core.renderOrder = 2;
        core.frustumCulled = false;
        c.bones.chest.add(core);
        c.core = core;
      }
      this.playClip(c, 'idle', Math.random());
    } else {
      // The wisp: a holographic core that bobs; generic, and still alive.
      const mat = holoMaterial(tint, { vertexColors: false });
      mat.color.setHex(0xffffff);
      c.mats.push(mat);
      const core = new Mesh(this.wispGeo, mat);
      core.position.y = spec.height * 0.6;
      core.frustumCulled = false;
      body.add(core);
      c.meshes = [core];
      c.tris = [this.wispGeo.index ? this.wispGeo.index.count / 3 : this.wispGeo.attributes.position.count / 3, 0];
      c.wisp = core;
      this.stats.wisps++;
    }
    // Mine face the other seat (-z); theirs face me (+z). The models face +z.
    body.rotation.order = 'YXZ'; // heading, then the bank
    c.facing = seat === this.near ? Math.PI : 0;
    body.rotation.y = c.facing;
    this.paintTint(c);
    this.setLod(c);
    return c;
  }

  paintTint(c) {
    const t = (this.tints[c.unit.faction] ?? this.tints.neutral).color;
    for (const m of c.mats) m.userData.holo.uTint.value.copy(t);
  }

  setLod(c) {
    const lod = c.seat === this.near ? 0 : 1;
    if (c.meshes.length === 2) c.meshes.forEach((m, i) => (m.visible = i === lod));
    c.lod = c.meshes.length === 2 ? lod : 0;
  }

  playClip(c, role, at = 0, { once = false, seconds = null } = {}) {
    if (c.wyrm) {
      // The whelp's "clips" are its pose modes (wyrm-pose.js): it perches, flies, strikes, spreads to die.
      if (role === 'idle') c.wyrm.setMode('perch');
      else if (role === 'move') c.wyrm.setMode('fly');
      else if (role === 'death') c.wyrm.setMode('glide');
      else if (role === 'attack' || role === 'hit') c.wyrm.strike();
      c.current = { getClip: () => ({ name: role === 'attack' || role === 'hit' ? c.wyrm.mode : role }) };
      return;
    }
    c.role = role; // what the creature is doing (a one-clip model plays every role from one clip)
    let to = c.actions[role];
    let speed = 1;
    if (!to && c.spec.clipFrom) {
      // One clip, every role (the drake's flight): slow for its idle hover, fast to strike, and a
      // death is the shatter alone (its wings still beat, slowing, as it dissolves).
      to = c.actions[c.spec.clipFrom];
      speed = { idle: 0.55, attack: 1.9, hit: 1.5, move: 1, death: 0.35 }[role] ?? 1;
      once = false;
      seconds = null;
    }
    if (!to) return;
    if (c.current === to && c.spec.clipFrom) {
      to.timeScale = speed;
      return;
    }
    to.reset();
    to.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
    to.clampWhenFinished = role === 'death';
    to.timeScale = seconds ? Math.max(0.6, to.getClip().duration / seconds) : speed;
    if (at) to.time = at * to.getClip().duration;
    if (c.current && c.current !== to) c.current.fadeOut(0.12);
    to.fadeIn(0.12).play();
    c.current = to;
  }

  setForm(c, k, base, height) {
    for (const m of c.mats) {
      const u = m.userData.holo;
      u.uForm.value = k;
      u.uBase.value = base;
      u.uH.value = height;
    }
  }

  // ---- ops from the director -------------------------------------------------------------------

  onEffect(e) {
    this.director.reduced = access.reducedMotion;
    const now = performance.now();
    for (const op of this.director.apply(e, now, this.near)) this.run(op, now);
  }

  run(op, now) {
    const reduced = access.reducedMotion;
    if (op.op === 'spawn') this.spawn(op, now, reduced);
    else if (op.op === 'remove') this.remove(op.id);
    else if (op.op === 'die') this.die(op.id, now, reduced);
    else if (op.op === 'move') this.move(op, now, reduced);
    else if (op.op === 'hit') this.hit(op.id, now);
    else if (op.op === 'attack') this.attack(op, now, reduced);
    else if (op.op === 'spell') this.spell(op.spell, reduced);
  }

  worldTop(c) {
    return this.group.localToWorld(c.root.position.clone()).y;
  }

  spawn(op, now, reduced) {
    const c = this.build(op.unit, op.seat, op.lane);
    c.id = op.id;
    c.key = op.key;
    c.cellAt = this.cell(op.seat, op.lane, op.cell);
    c.root.position.copy(c.cellAt);
    this.group.add(c.root);
    this.creatures.set(op.id, c);
    this.stats.spawned++;
    const tint = FACTION[op.unit.faction] ?? FACTION.neutral;
    if (reduced) {
      // A calm, short form where it stands: the scan rises once, fading in; no card flight, no
      // swell, no motes.
      c.anim = { kind: 'formHere', t0: now, ms: STATE_MS.reduced.forming, calm: true };
      this.setForm(c, 0, 0, 1);
      return;
    }
    if (op.origin === 'here') {
      c.anim = { kind: 'formHere', t0: now, ms: T.formHere };
      this.setForm(c, 0, 0, 1);
      this.motes.burst(c.cellAt.clone().add(new Vector3(0, 0.01, 0)), tint, { n: 20, speed: 0.03, ms: 900, lift: 0.1, spread: 0.02 });
      return;
    }
    // The card: from my pad (flat, face up), or from above the far keep (upright, facing me).
    const g = this.ghosts.find((x) => !x.busy) ?? this.ghosts[0];
    g.busy = true;
    this.paintGhost(g, op.unit.name, op.unit.faction);
    g.mesh.material.userData.ghost.uTint.value.setHex(tint);
    g.mesh.material.userData.ghost.uDissolve.value = 0;
    const start = op.origin === 'pad' ? (() => { const p = padCenter(op.lane); return new Vector3(p.x, p.y + 0.004, p.z); })() : new Vector3(0, FAR_KEEP.h + 0.02, FAR_KEEP.z);
    // Up and out toward the board, never into the face: the head leans in ~0.27 m over the pads.
    const lifted = start.clone().add(new Vector3(0, op.origin === 'pad' ? 0.05 : 0.05, op.origin === 'pad' ? -0.07 : 0.02));
    c.anim = { kind: 'summon', t0: now, ghost: g, start, lifted, flat: op.origin === 'pad', tint };
    if (summonStyle({ soars: !!c.spec.soars, origin: op.origin, reduced }) === 'soar') {
      // The whelp's summon (look.js soar): big, up past the person's head on its lane's side, a breath
      // of fire over the table, and down to its cell. The head is read once, where it is now.
      const head = this.group.worldToLocal(this.world.camera.getWorldPosition(new Vector3()));
      c.anim.soar = soar(lifted, c.cellAt, head, op.lane === 0 ? -1 : 1);
      c.anim.head = head;
      this.stats.soars = (this.stats.soars ?? 0) + 1;
    }
    c.root.position.copy(lifted);
    c.root.scale.setScalar(T.formScale);
    c.flying = true;
    this.setForm(c, 0, 0, 1);
    c.root.visible = false;
  }

  remove(id) {
    const c = this.creatures.get(id);
    if (!c) return;
    this.creatures.delete(id);
    if (c.anim?.ghost) {
      c.anim.ghost.mesh.visible = false;
      c.anim.ghost.busy = false;
    }
    this.group.remove(c.root);
    c.mixer?.stopAllAction();
    if (c.wyrm) c.wyrm.dispose();
    else for (const m of c.mats) m.dispose();
  }

  die(id, now, reduced) {
    const c = this.creatures.get(id);
    if (!c) return;
    if (c.anim?.ghost) {
      c.anim.ghost.mesh.visible = false;
      c.anim.ghost.busy = false;
    }
    c.dying = true;
    this.stats.deaths++;
    c.root.visible = true;
    c.root.scale.setScalar(1);
    this.setForm(c, 1, 0, 1);
    c.anim = { kind: 'die', t0: now, ms: reduced ? STATE_MS.reduced.dying : STATE_MS.dying, reduced };
    if (!reduced) this.playClip(c, 'death', 0, { once: true, seconds: 0.55 });
    const tint = FACTION[c.unit.faction] ?? FACTION.neutral;
    // The shatter: the hologram bursts into its faction's sparks (embers for Ember), which fall and fade.
    const at = c.root.position.clone().add(new Vector3(0, c.spec.height * 0.5, 0));
    const spark = c.unit.faction === 'ember' ? 0xffa040 : tint;
    if (reduced) this.motes.burst(at, spark, { n: 8, speed: 0.03, ms: 600, lift: 0.01, spread: 0.01 });
    else {
      this.motes.burst(at, spark, { n: 44, speed: 0.22, ms: 1100, lift: 0.06, spread: c.spec.height * 0.35, gravity: 0.35 });
      this.motes.burst(at, 0xffffff, { n: 10, speed: 0.12, ms: 450, lift: 0.02, spread: c.spec.height * 0.2 });
    }
  }

  move(op, now, reduced) {
    const c = this.creatures.get(op.id);
    if (!c) return;
    c.key = op.key;
    c.lane = op.lane;
    const to = this.cell(op.seat, op.lane, op.cell);
    if (reduced || c.anim?.kind === 'summon') {
      c.cellAt = to;
      if (!c.anim) c.root.position.copy(to);
      return;
    }
    c.anim = { kind: 'move', t0: now, ms: STATE_MS.moving, from: c.root.position.clone(), to };
    c.cellAt = to;
    this.playClip(c, 'move');
  }

  hit(id, now) {
    const c = this.creatures.get(id);
    if (!c || c.dying) return;
    this.stats.hits++;
    if (c.actions.hit) this.playClip(c, 'hit', 0, { once: true, seconds: 0.4 });
    c.flash = { t0: now, ms: 260 };
  }

  attack(op, now, reduced) {
    const c = this.creatures.get(op.id);
    if (!c || c.dying) return;
    this.stats.attacks++;
    const tint = FACTION[c.unit.faction] ?? FACTION.neutral;
    const target = this.targetPoint(op.target);
    this.playClip(c, 'attack', 0, { once: true, seconds: 0.65 });
    if ((c.spec.soars || c.spec.fireFrom) && !reduced) {
      // The whelp breathes at its target; Bellows Raider's bellows throw a jet of flame from his hand.
      c.fire = { until: now + (c.spec.fireFrom ? 420 : 320), n: c.spec.fireFrom ? 5 : 4, speed: 0.4, at: target };
      c.jawUntil = now + 420;
    }
    if (op.ranged) {
      const from = c.root.position.clone().add(new Vector3(0, c.spec.height * 0.6, 0));
      this.fx.play({ kind: 'bolt', faction: c.unit.faction, big: false }, from, target, reduced);
    } else if (!reduced && !c.anim) {
      c.anim = { kind: 'lunge', t0: now, ms: STATE_MS.attack, from: c.root.position.clone(), to: target, tint };
    } else {
      this.motes.burst(target, tint, { n: 10, speed: 0.1, ms: 450 });
    }
  }

  spell(s, reduced) {
    this.stats.spells++;
    const to = this.targetPoint(s.target);
    let from;
    if (s.kind === 'wave' && s.target && s.target.toLane !== undefined) {
      from = this.cell(s.target.seat, s.target.lane, s.target.cell);
      this.cell(s.target.seat, s.target.toLane, s.target.cell, to);
    } else {
      from = this.castle(s.seat).add(new Vector3(0, 0.04, 0));
    }
    this.fx.play(s, from, to, reduced);
  }

  // ---- every frame -------------------------------------------------------------------------------

  animate(c, now) {
    const a = c.anim;
    if (!a) return;
    const t = now - a.t0;
    if (a.kind === 'fadeIn') {
      const k = clamp01(t / a.ms);
      for (const m of c.mats) m.userData.holo.uAlpha.value = k;
      if (k >= 1) c.anim = null;
    } else if (a.kind === 'formHere') {
      const k = clamp01(t / a.ms);
      this.setForm(c, ease(k), this.worldTop(c), this.worldHeight(c));
      if (a.calm) for (const m of c.mats) m.userData.holo.uAlpha.value = 0.4 + 0.6 * k;
      if (k >= 1) c.anim = null;
    } else if (a.kind === 'summon') {
      const g = a.ghost;
      // The card: lift and turn upright, then burn away.
      if (t < T.dissolve[1]) {
        const k = ease(clamp01(t / T.lift));
        g.mesh.visible = true;
        g.mesh.position.lerpVectors(a.start, a.lifted, k);
        g.mesh.rotation.set(a.flat ? -Math.PI / 2 * (1 - k) : 0, 0, 0);
        g.mesh.material.userData.ghost.uDissolve.value = clamp01((t - T.dissolve[0]) / (T.dissolve[1] - T.dissolve[0]));
        if (t >= T.dissolve[0] && !a.burst) {
          a.burst = true;
          this.motes.burst(a.lifted, a.tint, { n: 36, speed: 0.12, ms: 700, lift: 0.04, spread: 0.02 });
        }
      } else if (g.busy) {
        g.mesh.visible = false;
        g.busy = false;
      }
      // The creature: forms at the card, at 1.15x, then flies the arc to its cell.
      if (t >= T.form[0]) {
        c.root.visible = true;
        if (!a.formed) {
          a.formed = true;
          this.playClip(c, c.actions.move && c.spec.flies ? 'move' : 'idle');
        }
        const kf = clamp01((t - T.form[0]) / (T.form[1] - T.form[0]));
        if (t < T.fly[0]) this.setForm(c, ease(kf), this.worldTop(c), this.worldHeight(c));
        else this.setForm(c, 1, 0, 1);
        const span = a.soar ? [T.fly[0], T.fly[0] + SOAR.ms] : c.spec.flies ? T.flyWing : T.fly;
        const kr = clamp01((t - span[0]) / (span[1] - span[0]));
        const f = a.soar ? a.soar(kr) : flight(a.lifted, c.cellAt, kr, c.spec.flies);
        c.root.position.set(f.x, f.y, f.z);
        c.root.scale.setScalar(a.soar ? f.size : T.formScale + (1 - T.formScale) * ease(kr));
        if (a.soar) {
          c.body.rotation.x = -(f.pitch ?? 0) * 0.7 * (1 - clamp01((kr - 0.8) / 0.2));
          // The breath: a jet of fire from the jaw over the table, once, at SOAR.fire.
          if (kr >= SOAR.fire && !a.breathed) {
            a.breathed = true;
            // Over the table, away from the person: the jet aims at the board's far half.
            c.fire = { until: now + SOAR.fireMs, n: 7, speed: 0.55, at: new Vector3(c.cellAt.x * 0.3, 0.01, -0.08) };
            this.glide(c, true, SOAR.fireMs / 1000 + 0.2);
          }
          if (a.breathed && now > (c.fire?.until ?? 0) && c.gliding && kr < 0.97) this.glide(c, false);
        }
        if (kr > 0) {
          // Heading along the path, banking into the turn; the last fifth turns to face the other seat.
          const land = clamp01((kr - 0.8) / 0.2);
          c.body.rotation.y = turnTo(f.yaw, c.facing, ease(land));
          c.body.rotation.z = f.roll * (1 - land);
          if (c.spec.flies && Math.random() < 0.8) this.motes.burst(c.root.position, a.tint, { n: 1, speed: 0.015, ms: 650, lift: -0.01, spread: 0.006 });
        }
        if (t >= span[1]) {
          c.anim = null;
          c.flying = false;
          c.root.position.copy(c.cellAt);
          c.root.scale.setScalar(1);
          c.body.rotation.set(0, c.facing, 0);
          if (a.soar) {
            // The landing: a puff of warm dust and a ring on the cell.
            this.fx.ring(c.cellAt, a.tint, { from: 0.3, to: 1.7, ms: 480 });
            this.motes.burst(c.cellAt.clone().add(new Vector3(0, 0.004, 0)), 0xffc28a, { n: 22, speed: 0.12, ms: 600, lift: 0.015, spread: 0.02 });
          }
          this.playClip(c, 'idle');
          this.motes.burst(c.cellAt.clone().add(new Vector3(0, 0.005, 0)), a.tint, { n: 14, speed: 0.07, ms: 500, lift: 0.01 });
        }
      }
    } else if (a.kind === 'move') {
      const k = ease(clamp01(t / a.ms));
      c.root.position.lerpVectors(a.from, a.to, k);
      c.root.position.y += Math.sin(Math.PI * k) * 0.015;
      if (k >= 1) {
        c.anim = null;
        this.playClip(c, 'idle');
      }
    } else if (a.kind === 'lunge') {
      const k = clamp01(t / a.ms);
      // Wind up, strike 35% of the way to the target at 45%, and come back.
      const reach = k < 0.45 ? ease(k / 0.45) * 0.35 : 0.35 * (1 - ease((k - 0.45) / 0.55));
      c.root.position.lerpVectors(a.from, a.to, reach);
      c.root.position.y = a.from.y;
      if (k >= 0.45 && !a.struck) {
        a.struck = true;
        this.motes.burst(a.to, a.tint, { n: 14, speed: 0.12, ms: 450, lift: 0.03 });
      }
      if (k >= 1) {
        c.root.position.copy(a.from);
        c.anim = null;
      }
    } else if (a.kind === 'die') {
      const k = clamp01(t / a.ms);
      const fade = a.reduced ? k : clamp01((k - 0.3) / 0.7);
      for (const m of c.mats) {
        m.userData.holo.uFade.value = a.reduced ? 0 : fade;
        m.userData.holo.uAlpha.value = a.reduced ? 1 - k : 1;
      }
    }
  }

  // A jet of fire from the whelp's jaw, along its snout (or toward its target), in the group's frame.
  breatheFire(c) {
    c.root.updateMatrixWorld(true);
    let p, q;
    if (c.wyrm) {
      const w = c.wyrm, m = w.mouth();
      if (!m) return;
      p = this.group.worldToLocal(w.object.localToWorld(new Vector3(m.x, m.y, m.z)));
      q = this.group.worldToLocal(w.object.localToWorld(new Vector3(m.x + m.dx * 0.2, m.y + m.dy * 0.2 - 0.03, m.z + m.dz * 0.2)));
    } else if (c.bones?.fire) {
      // From a hand (Bellows Raider), toward the target.
      p = this.group.worldToLocal(c.bones.fire.getWorldPosition(new Vector3()));
      q = p.clone().add(new Vector3(0, 0, c.facing === 0 ? 0.05 : -0.05));
    } else if (c.bones?.head) {
      // The drake: from its head, ahead along its body's heading.
      p = this.group.worldToLocal(c.bones.head.getWorldPosition(new Vector3()));
      const ahead = new Vector3(0, -0.2, 1).applyQuaternion(c.body.getWorldQuaternion(new Quaternion())).multiplyScalar(0.05);
      q = this.group.worldToLocal(c.bones.head.getWorldPosition(new Vector3()).add(ahead));
      p.lerp(q, 0.25); // the jaw is a little ahead of the head bone
    } else return;
    const dir = c.fire.at ? c.fire.at.clone().sub(p).normalize() : q.sub(p).normalize();
    const size = c.root.scale.x;
    this.motes.jet(p, dir, 0xffd070, { n: c.fire.n, speed: c.fire.speed * Math.sqrt(size), spread: 0.25, ms: 520 });
    this.motes.jet(p, dir, 0xff5a1a, { n: Math.ceil(c.fire.n / 2), speed: c.fire.speed * 0.8 * Math.sqrt(size), spread: 0.4, ms: 700 });
  }

  // The whelp's fire posture: the wyrm glides with its jaw wide; the drake's wingbeat slows and its jaw opens.
  glide(c, on, seconds = 0.6) {
    c.gliding = on;
    if (c.wyrm) {
      if (on) c.wyrm.breathe(seconds);
      c.wyrm.setMode(on ? 'glide' : 'fly');
    } else if (c.current) {
      c.current.timeScale = on ? 0.45 : 1;
      if (on) c.jawUntil = performance.now() + seconds * 1000;
    }
  }

  worldHeight(c) {
    return c.spec.height * c.root.scale.y * this.group.getWorldScale(new Vector3()).y;
  }

  update() {
    const play = this.bind();
    if (!play) return;
    const now = performance.now();
    this.step(play, now);
    // This system's own CPU per frame (the budget in the PR): mean and worst since the last reset.
    const ms = performance.now() - now;
    const k = this.cost;
    k.n++;
    k.sum += ms;
    k.max = Math.max(k.max, ms);
  }

  step(play, now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.near !== play.near) {
      this.near = play.near;
      for (const c of this.creatures.values()) this.setLod(c);
    }
    tick(now / 1000);
    // The room (luna's lantern-lit interior, or the person's own room), the theme and the motion setting.
    const room = this.world.getSystem(TeahouseSystem)?.kind === 'interior' ? 'interior' : 'doors';
    const key = `${room}:${themeName()}:${access.reducedMotion}`;
    if (key !== this.lookKey) {
      this.lookKey = key;
      this.look = lookFor({ room, contrast: themeName() === 'contrast', reduced: access.reducedMotion });
      setLook(this.look);
    }
    for (const op of this.director.tick(now)) this.run(op, now);
    // No placing effect is queued (direct.js settled()): the director has applied every summon,
    // death and move that will reach it, so the creatures must be the newest view's units. Whatever
    // the queue dropped in a backlog is made good here, even in a fast match whose queue never empties.
    const fx = this.effects;
    if (play.view && this.reconciled !== play.view && settled(fx.queue.items)) {
      this.reconciled = play.view;
      const ops = this.director.reconcile(play.view, now);
      if (ops.length) {
        this.stats.reconciled += ops.length;
        for (const op of ops) this.run(op, now);
      }
    }
    for (const c of this.creatures.values()) {
      this.animate(c, now);
      c.mixer?.update(dt);
      if (c.wyrm) c.wyrm.update(access.reducedMotion ? dt * 0.6 : dt);
      if (c.fire && now < c.fire.until) this.breatheFire(c);
      // The drake's jaw opens for fire and a strike (after the clip has posed it this frame).
      if (c.bones?.jaw && now < (c.jawUntil ?? 0)) c.bones.jaw.rotation.x += 0.55;
      // Idle: a flier hovers; an Ember creature sheds a drifting ember now and then (look.js).
      if (!c.anim && !c.dying) {
        c.body.position.y = c.spec.flies && !c.wyrm ? this.look.bob * Math.sin(now / 520 + c.lane * 1.7 + c.seat) : 0;
        if (this.look.embers && c.unit.faction === 'ember' && Math.random() < this.look.embers * dt) {
          const p = c.root.position.clone();
          p.y += c.spec.height * (0.45 + Math.random() * 0.3);
          this.motes.burst(p, 0xffb347, { n: 1, speed: 0.01, ms: 1100, lift: 0.035, spread: 0.012 });
        }
      }
      if (c.wisp) {
        c.wisp.position.y = c.spec.height * (0.6 + 0.08 * Math.sin(now / 400 + c.lane));
        c.wisp.rotation.y += dt * 1.5;
      }
      if (c.flash) {
        const k = clamp01((now - c.flash.t0) / c.flash.ms);
        for (const m of c.mats) m.userData.holo.uAlpha.value = 0.55 + 0.45 * k;
        if (k >= 1) c.flash = null;
      }
    }
    this.fx.update(now);
    this.motes.update(dt);
    this.paintDiscs(now);
    this.dress(play);
  }

  paintDiscs(now) {
    let n = 0;
    for (const c of this.creatures.values()) {
      if (!c.root.visible || n >= DISCS) continue;
      const k = c.anim?.kind === 'summon' ? clamp01((now - c.anim.t0 - T.form[0]) / 900) : c.anim?.kind === 'formHere' ? clamp01((now - c.anim.t0) / c.anim.ms) : 1;
      const fade = c.dying ? 1 - clamp01((now - c.anim.t0) / c.anim.ms) : 1;
      const r = LANE_W * (c.spec.flies ? 0.27 : 0.22);
      const at = c.anim?.kind === 'summon' ? c.cellAt : c.root.position;
      this._m.makeRotationX(-Math.PI / 2).setPosition(at.x, 0.0025, at.z);
      this._m.scale(new Vector3(r, r, 1));
      this.discs.setMatrixAt(n, this._m);
      const t = (this.tints[c.unit.faction] ?? this.tints.neutral).color;
      this.discs.setColorAt(n, this._c.copy(t).multiplyScalar((c.spec.flies ? 0.35 : 0.5) * k * fade));
      n++;
    }
    this.discs.count = n;
    this.discs.instanceMatrix.needsUpdate = true;
    if (this.discs.instanceColor) this.discs.instanceColor.needsUpdate = true;
  }

  // The board's stand-in box gives way to the creature (every unit gets one, the wisp at worst, so
  // the box is hidden even before its summon plays); the stat plate floats over the creature's head.
  dress(play) {
    for (const s of play.board.slots.values()) if (s.plate.visible) s.figure.visible = false;
    for (const c of this.creatures.values()) {
      if (c.dying || !c.key) continue;
      const s = play.board.slots.get(c.key);
      if (!s || !s.plate.visible) continue;
      s.plate.position.y = c.spec.height + (c.spec.flies ? 0.03 : 0.022); // over its head, not across its body
    }
  }

  // ---- proof and budget --------------------------------------------------------------------------

  report() {
    let tris = 0, draws = 0, live = 0;
    const lods = [0, 0];
    const bySide = [0, 0];
    for (const c of this.creatures.values()) {
      if (!c.root.visible) continue;
      live++;
      tris += c.tris[c.lod] ?? c.tris[0];
      draws++;
      lods[c.lod]++;
      bySide[c.seat === this.near ? 0 : 1]++;
    }
    const visibleFx = [...this.ghosts.map((g) => g.mesh), ...this.fx.bolts, ...this.fx.rings, ...this.fx.waves].filter((m) => m.visible).length;
    return {
      ...this.stats, models: this.models.size, updateMs: { mean: +(this.cost.sum / Math.max(1, this.cost.n)).toFixed(3), max: +this.cost.max.toFixed(2), frames: this.cost.n }, failed: [...this.failed], live, mine: bySide[0], theirs: bySide[1], lods,
      creatureTris: tris, creatureDraws: draws, fxDraws: visibleFx + (this.motes.live ? 1 : 0), motes: this.motes.live,
      census: this.director.census(),
      creatures: [...this.creatures.values()].map((c) => ({ key: c.key, name: c.unit.name, model: c.spec.model, lod: c.lod, anim: c.anim?.kind ?? null, clip: c.role ?? c.current?.getClip().name ?? null, fellBack: c.spec.fellBack ?? null, dying: !!c.dying })),
    };
  }

  // Creatures on both sides at once, for the budget and the shots: `per` a side (default 9, every
  // cell: the worst case). With 3 a side they stand in the front cells, the heaviest models first.
  gallery(per = 9) {
    const tide = new Set(['Reef Archer', 'Brine Skimmer', 'Tidecaller', 'Pearl Shieldbearer', 'Trench Leviathan']);
    const all = ['Cinder Whelp', 'Forge Runner', 'Bellows Raider', 'Ashen Vanguard', 'Hearth Warden', 'Slag Brute', 'Reef Archer', 'Brine Skimmer', 'Tidecaller', 'Pearl Shieldbearer', 'Trench Leviathan', 'Commander'];
    const three = [['Cinder Whelp', 'Ashen Vanguard', 'Slag Brute'], ['Trench Leviathan', 'Pearl Shieldbearer', 'Tidecaller']];
    let i = 0;
    const now = performance.now();
    for (let s = 0; s < 2; s++) for (let l = 0; l < 3; l++) for (let c = 0; c < 3; c++) {
      if (per <= 3 && (c !== 2 || l >= per)) continue;
      const name = per <= 3 ? three[s === this.near ? 0 : 1][l] : all[i % all.length];
      i++;
      const unit = { name, faction: name === 'Commander' ? (s === 0 ? 'ember' : 'tide') : tide.has(name) ? 'tide' : 'ember', commander: name === 'Commander' };
      this.spawn({ op: 'spawn', id: `gallery:${s}:${l}:${c}`, key: null, unit, seat: s, lane: l, cell: c, origin: 'here' }, now + i * 40, access.reducedMotion);
    }
    return this.report();
  }
}
