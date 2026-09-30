// spell-fx.js: the light the summons throw: a pool of motes (one Points, one draw call, whatever is
// bursting), and set 1's seven spells as short effects at their target (spells.js says which kind
// and where). Every mesh is pooled and built at init, so a cast never allocates or compiles.
import { BufferAttribute, BufferGeometry, Color, Group, IcosahedronGeometry, Mesh, PlaneGeometry, Points, RingGeometry, ShaderMaterial, Vector3 } from '@iwsdk/core';
import { glowMaterial, LIGHT_BLEND } from './holo.js';

const MOTES = 320; // the whelp's fire and the shatters need more than the spells did

export class Motes {
  constructor() {
    this.pos = new Float32Array(MOTES * 3);
    this.col = new Float32Array(MOTES * 3);
    this.life = new Float32Array(MOTES); // remaining 0..1; 0 = free
    this.vel = new Float32Array(MOTES * 3);
    this.rate = new Float32Array(MOTES);
    this.swirl = new Float32Array(MOTES);
    this.gravity = new Float32Array(MOTES); // m/s², downward (a shatter's sparks fall)
    this.next = 0;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 3));
    g.setAttribute('life', new BufferAttribute(this.life, 1));
    this.points = new Points(g, new ShaderMaterial({
      transparent: true, depthWrite: false, ...LIGHT_BLEND, vertexColors: true,
      vertexShader: 'attribute float life; varying float vLife; varying vec3 vCol; void main() { vLife = life; vCol = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = life > 0.0 ? (0.004 + 0.006 * life) * 1400.0 / -mv.z : 0.0; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vLife; varying vec3 vCol; void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25 || vLife <= 0.0) discard; gl_FragColor = vec4(vCol * (1.0 - d * 4.0) * (0.4 + vLife), 1.0); }',
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.live = 0;
  }

  // `n` motes at `p` (a Vector3, parent-local), thrown at `speed` m/s, living `ms`, with a `swirl`
  // (rad/s about the vertical through p) and an upward `lift` (m/s).
  burst(p, color, { n = 24, speed = 0.12, ms = 700, lift = 0.05, swirl = 0, spread = 0.004, gravity = 0 } = {}) {
    const c = new Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MOTES;
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      this.pos.set([p.x + r * Math.cos(th) * spread, p.y + u * spread, p.z + r * Math.sin(th) * spread], i * 3);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.vel.set([r * Math.cos(th) * s, Math.abs(u) * s * 0.6 + lift, r * Math.sin(th) * s], i * 3);
      this.col.set([c.r, c.g, c.b], i * 3);
      this.life[i] = 1;
      this.rate[i] = 1000 / (ms * (0.6 + Math.random() * 0.4));
      this.swirl[i] = swirl;
      this.gravity[i] = gravity;
    }
  }

  // `n` motes from `p` along the unit vector `dir` (fire from a jaw): a cone `spread` wide (rad-ish).
  jet(p, dir, color, { n = 6, speed = 0.5, spread = 0.25, ms = 500 } = {}) {
    const c = new Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MOTES;
      const s = speed * (0.6 + Math.random() * 0.5);
      const jx = (Math.random() * 2 - 1) * spread, jy = (Math.random() * 2 - 1) * spread, jz = (Math.random() * 2 - 1) * spread;
      this.pos.set([p.x, p.y, p.z], i * 3);
      this.vel.set([(dir.x + jx) * s, (dir.y + jy) * s, (dir.z + jz) * s], i * 3);
      this.col.set([c.r, c.g, c.b], i * 3);
      this.life[i] = 1;
      this.rate[i] = 1000 / (ms * (0.6 + Math.random() * 0.4));
      this.swirl[i] = 0;
      this.gravity[i] = -0.12; // fire rises a little as it slows
    }
  }

  update(dt) {
    let live = 0;
    for (let i = 0; i < MOTES; i++) {
      if (this.life[i] <= 0) continue;
      live++;
      this.life[i] = Math.max(0, this.life[i] - dt * this.rate[i]);
      const j = i * 3;
      if (this.swirl[i]) {
        const a = this.swirl[i] * dt, vx = this.vel[j], vz = this.vel[j + 2];
        this.vel[j] = vx * Math.cos(a) - vz * Math.sin(a);
        this.vel[j + 2] = vx * Math.sin(a) + vz * Math.cos(a);
      }
      this.vel[j] *= 1 - 1.8 * dt;
      this.vel[j + 2] *= 1 - 1.8 * dt;
      this.pos[j] += this.vel[j] * dt;
      this.vel[j + 1] -= this.gravity[i] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
    }
    this.live = live;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = g.attributes.life.needsUpdate = g.attributes.color.needsUpdate = true;
  }
}

const ease = (t) => t * t * (3 - 2 * t);

// The spells: a bolt (a glowing core on an arc), a ring (flat on the board: bursts, vortices, heals)
// and a wave (a standing sheet across the lanes). Two of each, reused.
export class SpellFx {
  constructor(motes, faction) {
    this.motes = motes;
    this.faction = faction; // board.js FACTION
    this.group = new Group();
    this.bolts = [0, 1].map(() => new Mesh(new IcosahedronGeometry(0.009, 1), glowMaterial(0xffffff)));
    this.rings = [0, 1, 2].map(() => new Mesh(new RingGeometry(0.02, 0.026, 40), glowMaterial(0xffffff)));
    for (const r of this.rings) r.rotation.x = -Math.PI / 2;
    this.waves = [0].map(() => new Mesh(new PlaneGeometry(0.05, 0.035), glowMaterial(0xffffff, 0.6)));
    for (const m of [...this.bolts, ...this.rings, ...this.waves]) {
      m.visible = false;
      m.renderOrder = 9;
      this.group.add(m);
    }
    this.active = [];
  }

  take(pool) {
    return pool.find((m) => !m.visible) ?? pool[0];
  }

  // A job: {mesh, t0, ms, step(k)}; step() places the mesh at k = 0..1; done() ends it.
  run(mesh, ms, step, done) {
    mesh.visible = true;
    this.active.push({ mesh, t0: performance.now(), ms, step, done });
  }

  ring(p, color, { from = 0.4, to = 2.2, ms = 500, spin = 0, y = 0.004 } = {}) {
    const r = this.take(this.rings);
    r.material.color.setHex(color);
    this.run(r, ms, (k) => {
      const s = from + (to - from) * ease(k);
      r.scale.set(s, s, 1);
      r.position.set(p.x, p.y + y, p.z);
      r.rotation.z = spin * k;
      r.material.opacity = 1 - k;
    });
  }

  // Play a spell (spells.js) from `from` to `to` (parent-local Vector3s); `reduced`: no travel.
  play(spell, from, to, reduced) {
    const color = this.faction[spell.faction] ?? 0xffffff;
    const hot = new Color(color).lerp(new Color(0xffffff), 0.35).getHex();
    if (spell.kind === 'bolt') {
      const b = this.take(this.bolts);
      b.material.color.setHex(hot);
      const size = spell.big ? 1.6 : 1;
      const impact = () => {
        this.ring(to, color, { from: 0.3, to: spell.big ? 3.4 : 2.4, ms: 450 });
        this.motes.burst(to, hot, { n: spell.big ? 40 : 26, speed: spell.big ? 0.3 : 0.2, ms: 650, lift: 0.08 });
      };
      if (reduced) {
        impact();
        return;
      }
      const at = new Vector3();
      this.run(b, 420, (k) => {
        at.lerpVectors(from, to, ease(k));
        at.y += Math.sin(Math.PI * k) * 0.07;
        b.position.copy(at);
        b.scale.setScalar(size * (0.8 + 0.4 * Math.sin(k * 30)));
        if (Math.random() < 0.7) this.motes.burst(at, color, { n: 1, speed: 0.02, ms: 350, lift: 0.01 });
      }, impact);
    } else if (spell.kind === 'vortex') {
      this.ring(to, color, { from: 2.6, to: 0.2, ms: reduced ? 300 : 800, spin: 9 });
      this.ring(to, hot, { from: 1.8, to: 0.1, ms: reduced ? 300 : 700, spin: -12, y: 0.012 });
      this.motes.burst(new Vector3(to.x, to.y + 0.02, to.z), color, { n: 36, speed: 0.06, ms: 800, lift: -0.02, swirl: reduced ? 0 : 9, spread: 0.035 });
    } else if (spell.kind === 'wave') {
      const w = this.take(this.waves);
      w.material.color.setHex(hot);
      this.run(w, reduced ? 1 : 520, (k) => {
        w.position.lerpVectors(from, to, ease(k));
        w.position.y += 0.018;
        w.rotation.y = Math.PI / 2;
        w.scale.set(1, 0.4 + Math.sin(Math.PI * k) * 0.8, 1);
        w.material.opacity = 0.7 * Math.sin(Math.PI * k);
        if (Math.random() < 0.8) this.motes.burst(w.position, color, { n: 1, speed: 0.03, ms: 400, lift: 0.03, spread: 0.02 });
      });
    } else {
      // motes: Mend's rising light and ring; Deep Breath's swirl at the deck.
      this.ring(to, hot, { from: 0.4, to: 1.8, ms: 600 });
      this.motes.burst(to, hot, { n: 34, speed: 0.04, ms: 900, lift: 0.09, swirl: reduced ? 0 : 6, spread: 0.02 });
    }
  }

  update(now) {
    this.active = this.active.filter((j) => {
      const k = Math.min(1, (now - j.t0) / j.ms);
      j.step(k);
      if (k < 1) return true;
      j.mesh.visible = false;
      j.done?.();
      return false;
    });
  }
}
