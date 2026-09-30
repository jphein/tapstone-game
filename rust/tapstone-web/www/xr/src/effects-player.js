// effects-player.js: plays logic/effects.js's queue on the scene, one effect at a time (spec
// 2026-09-25 §3.2). Every effect is computed from two consecutive views, so nothing here is sent
// or hashed (0027's amendment). Each effect's sound (logic/sfx.js) starts with it. The board already shows the newest view; an effect only moves a
// marker over it, so dropping one (the queue compresses a backlog) loses motion, never state.
import { createSystem, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from '@iwsdk/core';
import { diffViews, EffectQueue, DURATION } from './logic/effects.js';
import { PlaySystem } from './play.js';
import { padCenter, CASTLE_PLAQUE, FAR_KEEP } from './logic/layout.js';
import { FACTION } from './board.js';
import { soundFor } from './logic/sfx.js';
import { motion } from './logic/access.js';
import { access } from './access.js';
import { createSfx } from './sfx.js';
import { enrich } from './summons/enrich.js';

export class EffectsSystem extends createSystem({}) {
  init() {
    this.queue = new EffectQueue();
    this.active = null;
    this.spark = new Mesh(new SphereGeometry(0.012, 12, 8), new MeshBasicMaterial({ color: 0xfff3c4, transparent: true }));
    this.spark.visible = false;
    this.listeners = [];
    this.viewListeners = [];
    this.bound = false;
    this.sfx = createSfx(); // each effect's sound starts with it (logic/sfx.js)
  }

  // Other systems (the teahouse doors) hear every effect as it starts.
  onEffect(fn) {
    this.listeners.push(fn);
  }

  // And every view as it arrives (a frame can bring several; the doors read each one's record).
  onView(fn) {
    this.viewListeners.push(fn);
  }

  bind() {
    const play = this.world.getSystem(PlaySystem);
    if (!play || this.bound) return play;
    play.root.add(this.spark);
    play.sfxStats = this.sfx.stats;
    play.onView = (prev, next, near) => {
      // The summons' strikes, spells and Undertow's shift join the queue (src/summons/enrich.js).
      this.queue.push(enrich(prev, next, diffViews(prev, next, near)));
      for (const fn of this.viewListeners) fn(next);
    };
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
    } else if (e.type === 'chargeGem') {
      from = a.set(0.18, 0.03, CASTLE_PLAQUE.z + 0.05);
      to = b.copy(from).add(new Vector3(0, 0.02, 0));
      colour = 0x5bc0de;
    }
    this.active = { e, until: now + (DURATION[e.type] ?? 300), began: now, from: from && from.clone(), to: to && to.clone() };
    this.spark.visible = !!from;
    this.spark.material.color.setHex(colour);
    play.frames.tag(`effect:${e.type}`);
    const sound = soundFor(e, near);
    if (sound) this.sfx.play(sound);
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
      // An arc for a summon (the thread of light from the pad), a straight rise otherwise; with
      // reduced motion, the spark shows where it lands and fades (logic/access.js motion()).
      const m = motion(a.e.type, t, access);
      this.spark.position.lerpVectors(a.from, a.to, m.k);
      this.spark.position.y += m.lift;
      this.spark.material.opacity = m.opacity;
    }
    if (t >= 1) {
      this.spark.visible = false;
      this.active = null;
    }
  }
}
