// wyrm.js: the Cinder Whelp, built in code (design note 2026-09-29-xr-summons-fidelity-design.md). One
// BufferGeometry, deformed on the CPU every frame from wyrm-pose.js's pose, in the holographic material
// (holo.js, with its `vein` attribute: the wing bones, the spine's ridge and the eyes glow in the
// faction's light), plus an additive fire heart inside the chest, seen through the body. Two draw calls.
//
// Parts: the body (one tube from tail tip to snout, elliptical, dark along the back and gold along the
// belly), the lower jaw, four horns, a ridge of dorsal spines, the tail's spade, four legs, and two wings
// whose membranes hang between the arm, three fingers and the flank, scalloped along the trailing edge.
// Dragon units (wyrm-pose.js): nose to tail ~1; `size` scales the whole to metres.
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, IcosahedronGeometry, Mesh } from '@iwsdk/core';
import { pose, chain, wing, span as spanOf } from './wyrm-pose.js';
import { holoMaterial, glowMaterial } from './holo.js';

const RAD = 14; // vertices around the body tube
const LEG = 5; // around a leg
const HORN = 5; // around a horn
const PANEL_U = 7, PANEL_V = 5; // a membrane panel's grid
export const PERCH_HZ = 30; // a calm perched whelp is deformed at this rate (the budget: see update())

// The Forge Peaks' whelp (0039: Ember comes from the Forge Peaks). Linear-ish sRGB hexes, converted by Color.
export const WHELP_COLOURS = {
  back: 0x2e0602, flank: 0x7a1608, belly: 0xe0861f, membrane: 0xa82810, trailing: 0xf07a28,
  horn: 0xf1e2c2, claw: 0x2a1410, eye: 0xffe07a, spine: 0xff7a2a,
};

// Where each part's vertices start, and how many (built once; the index never changes).
function layout(nPts) {
  let v = 0;
  const take = (n) => { const a = v; v += n; return a; };
  const L = {};
  L.body = take(nPts * RAD + 2); // rings + the snout's and the tail's tips
  L.jaw = take(6);
  L.horns = [0, 1, 2, 3].map(() => take(HORN * 3 + 1));
  L.spines = take(14 * 3);
  L.spade = take(4);
  L.legs = [0, 1, 2, 3].map(() => take(LEG * 3 + 1));
  L.wings = [0, 1].map(() => [0, 1, 2, 3].map(() => take(PANEL_U * PANEL_V)));
  L.count = v;
  return L;
}

export class Wyrm {
  constructor(faction, colours = WHELP_COLOURS) {
    this.colours = Object.fromEntries(Object.entries(colours).map(([k, h]) => [k, new Color(h)]));
    const c0 = chain(pose('perch', 0));
    this.nPts = c0.back.length + c0.front.length - 1;
    this.L = layout(this.nPts);
    const n = this.L.count;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.vein = new Float32Array(n);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 3));
    g.setAttribute('vein', new BufferAttribute(this.vein, 1));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(n * 3), 3));
    g.setIndex(this.indices());
    this.geometry = g;
    this.material = holoMaterial(faction, { veins: true });
    this.material.side = DoubleSide;
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    // The fire heart: an additive core in the chest, drawn first so the body's glass shows it.
    this.core = new Mesh(new IcosahedronGeometry(0.05, 1), glowMaterial(0xff9a3a, 0.9));
    this.core.renderOrder = 2;
    this.core.frustumCulled = false;
    this.object = new Group();
    this.object.add(this.core, this.mesh);
    this.paintColours();
    this.mode = 'perch';
    this.t = Math.random() * 10;
    this.snap = 0;
    this.breath = 0;
    this.apply(pose('perch', this.t));
  }

  get tris() {
    return this.geometry.index.count / 3;
  }

  // ---- topology --------------------------------------------------------------------------------------

  indices() {
    const I = [];
    const L = this.L, N = this.nPts;
    const quad = (a, b, c, d) => I.push(a, b, c, a, c, d);
    // Body tube: ring i, vertex j → L.body + i*RAD + j; caps at the tail (first) and the snout (last).
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < RAD; j++) {
      const a = L.body + i * RAD + j, b = L.body + i * RAD + ((j + 1) % RAD);
      quad(a, b, b + RAD, a + RAD);
    }
    const tail = L.body + N * RAD, snout = tail + 1;
    for (let j = 0; j < RAD; j++) {
      I.push(tail, L.body + ((j + 1) % RAD), L.body + j);
      I.push(snout, L.body + (N - 1) * RAD + j, L.body + (N - 1) * RAD + ((j + 1) % RAD));
    }
    // Jaw: a wedge (hinge left/right, tip; each top and bottom).
    const J = L.jaw;
    I.push(J, J + 1, J + 2, J + 3, J + 5, J + 4, J, J + 3, J + 4, J, J + 4, J + 1, J + 1, J + 4, J + 5, J + 1, J + 5, J + 2, J + 2, J + 5, J + 3, J + 2, J + 3, J);
    // Cones (horns, legs): rings of `k`, `rings` deep, then a tip.
    const cone = (base, k, rings) => {
      for (let r = 0; r < rings - 1; r++) for (let j = 0; j < k; j++) quad(base + r * k + j, base + r * k + ((j + 1) % k), base + (r + 1) * k + ((j + 1) % k), base + (r + 1) * k + j);
      const tip = base + rings * k;
      for (let j = 0; j < k; j++) I.push(base + (rings - 1) * k + j, base + (rings - 1) * k + ((j + 1) % k), tip);
    };
    for (const h of L.horns) cone(h, HORN, 3);
    for (const l of L.legs) cone(l, LEG, 3);
    for (let s = 0; s < 14; s++) I.push(L.spines + s * 3, L.spines + s * 3 + 1, L.spines + s * 3 + 2);
    I.push(L.spade, L.spade + 1, L.spade + 2, L.spade, L.spade + 2, L.spade + 3);
    for (const w of L.wings) for (const p of w) {
      for (let u = 0; u < PANEL_U - 1; u++) for (let v = 0; v < PANEL_V - 1; v++) quad(p + u * PANEL_V + v, p + (u + 1) * PANEL_V + v, p + (u + 1) * PANEL_V + v + 1, p + u * PANEL_V + v + 1);
    }
    return I;
  }

  // ---- colours and veins (once) -------------------------------------------------------------------

  paintColours() {
    const C = this.colours, L = this.L, N = this.nPts;
    const set = (i, c, vein = 0) => {
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      this.vein[i] = vein;
    };
    const mix = new Color();
    for (let i = 0; i < N; i++) for (let j = 0; j < RAD; j++) {
      const a = (j / RAD) * Math.PI * 2; // 0 = the top of the ring
      const up = Math.cos(a);
      mix.copy(C.flank).lerp(up > 0 ? C.back : C.belly, Math.abs(up) ** 0.8);
      // Ventral plates: the belly bands light and dark ring by ring; the back darkens between scales.
      if (up < -0.35) mix.multiplyScalar(i % 2 ? 0.78 : 1.08);
      else if (up > 0.35 && i % 2) mix.multiplyScalar(0.85);
      // The ridge glows along the spine; the eyes glow on the head's flanks.
      const ridge = up > 0.93 ? 0.55 : 0;
      const eye = i === N - 3 && Math.abs(Math.sin(a)) > 0.8 && up > 0.1 ? 1 : 0;
      set(L.body + i * RAD + j, eye ? C.eye : mix, Math.max(ridge, eye));
    }
    set(L.body + N * RAD, C.flank);
    set(L.body + N * RAD + 1, C.flank);
    for (let k = 0; k < 6; k++) set(L.jaw + k, C.belly, k === 2 || k === 5 ? 0.3 : 0);
    for (const h of L.horns) for (let k = 0; k <= HORN * 3; k++) set(h + k, C.horn, k >= HORN * 2 ? 0.25 : 0);
    for (let k = 0; k < 42; k++) set(L.spines + k, C.spine, k % 3 === 2 ? 0.9 : 0.35);
    for (let k = 0; k < 4; k++) set(L.spade + k, C.flank, 0.5);
    for (const l of L.legs) for (let k = 0; k <= LEG * 3; k++) set(l + k, k >= LEG * 2 ? C.claw : C.flank);
    for (const w of L.wings) w.forEach((p, panel) => {
      for (let u = 0; u < PANEL_U; u++) for (let v = 0; v < PANEL_V; v++) {
        const onBone = v === 0 || (v === PANEL_V - 1 && panel < 2); // the fingers are bones; the flank edge is not
        const fu = u / (PANEL_U - 1);
        mix.copy(C.membrane).lerp(C.trailing, fu * 0.7);
        set(p + u * PANEL_V + v, mix, onBone ? 0.95 - 0.4 * fu : 0.02 + 0.04 * fu);
      }
    });
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.vein.needsUpdate = true;
  }

  // ---- the pose, every frame ----------------------------------------------------------------------

  setMode(mode) {
    this.mode = mode;
  }

  // Perched and still (no strike, no breath), its motion is slow (breathing, a sway): deform it at
  // PERCH_HZ, not every frame; in flight, a strike or fire, every frame. Returns whether it deformed.
  update(dt) {
    this.t += dt;
    this.snap = Math.max(0, this.snap - dt * 2.2);
    this.breath = Math.max(0, this.breath - dt * 1.6);
    this.since = (this.since ?? 1) + dt;
    const calm = this.mode === 'perch' && this.snap === 0 && this.breath === 0;
    if (calm && this.since < 1 / PERCH_HZ) return false;
    this.since = 0;
    const s = this.snap > 0 ? Math.sin(Math.PI * Math.min(1, this.snap)) : 0;
    this.apply(pose(this.mode, this.t, { snap: s, breath: Math.min(1, this.breath * 1.4) }));
    return true;
  }

  strike() {
    this.snap = 1;
  }

  breathe(seconds = 0.6) {
    this.breath = seconds;
  }

  // The mouth, in dragon units (the fire's origin), and the snout's direction.
  mouth() {
    return this.mouthAt;
  }

  apply(p) {
    const c = chain(p);
    this.lastPose = p;
    const P = this.pos, L = this.L;
    const put = (i, x, y, z) => {
      P[i * 3] = x;
      P[i * 3 + 1] = y;
      P[i * 3 + 2] = z;
    };
    // The spine, tail tip → root → snout.
    const pts = [...c.back.slice(1).reverse(), ...c.front];
    const N = pts.length;
    for (let i = 0; i < N; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      // side: horizontal and to the right of the tangent; up: t × side
      let sx = tz, sy = 0, sz = -tx;
      const sl = Math.hypot(sx, sz) || 1;
      sx /= sl; sz /= sl;
      const ux = ty * sz - tz * sy, uy = tz * sx - tx * sz, uz = tx * sy - ty * sx; // up = t × side
      const q = pts[i];
      const headish = i >= N - 4;
      const w = q.r * (headish ? 1.15 : 1.0), h = q.r * (headish ? 0.78 : 1.12);
      for (let j = 0; j < RAD; j++) {
        const ang = (j / RAD) * Math.PI * 2;
        const cu = Math.cos(ang) * h, cs = Math.sin(ang) * w;
        put(L.body + i * RAD + j, q.x + ux * cu + sx * cs, q.y + uy * cu + sy * cs, q.z + uz * cu + sz * cs);
      }
      if (i === 0) put(L.body + N * RAD, q.x - tx * 0.01, q.y - ty * 0.01, q.z - tz * 0.01);
      if (i === N - 1) {
        put(L.body + N * RAD + 1, q.x + tx * 0.03, q.y + ty * 0.03, q.z + tz * 0.03);
        this.mouthAt = { x: q.x + tx * 0.03, y: q.y + ty * 0.03 - q.r * 0.3, z: q.z + tz * 0.03, dx: tx, dy: ty, dz: tz };
      }
    }
    // The jaw: hinged under the head, opening by p.jaw.
    const head = c.front[c.front.length - 3], tip = c.front[c.front.length - 1];
    const hr = head.r;
    const dz = tip.z - head.z, dy = tip.y - head.y;
    const len = Math.hypot(dz, dy) * 1.05;
    const ang = Math.atan2(dy, dz) - p.jaw;
    const jy = head.y - hr * 0.55, jz = head.z;
    const ty = jy + Math.sin(ang) * len, tz2 = jz + Math.cos(ang) * len;
    put(L.jaw, head.x - hr * 0.6, jy, jz);
    put(L.jaw + 1, head.x + hr * 0.6, jy, jz);
    put(L.jaw + 2, tip.x, ty, tz2);
    put(L.jaw + 3, head.x - hr * 0.5, jy - hr * 0.35, jz);
    put(L.jaw + 4, head.x + hr * 0.5, jy - hr * 0.35, jz);
    put(L.jaw + 5, tip.x, ty - hr * 0.2, tz2);
    // Horns: two long ones sweeping back from the crown, two short ones behind the jaw.
    const crown = c.front[c.front.length - 2];
    const horns = [
      { side: -1, at: crown, up: 0.9, len: 0.13, back: 0.85, rad: 0.012 },
      { side: 1, at: crown, up: 0.9, len: 0.13, back: 0.85, rad: 0.012 },
      { side: -1, at: head, up: 0.1, len: 0.06, back: 0.9, rad: 0.008 },
      { side: 1, at: head, up: 0.1, len: 0.06, back: 0.9, rad: 0.008 },
    ];
    horns.forEach((hn, k) => {
      const b = L.horns[k];
      const bx = hn.at.x + hn.side * hn.at.r * 0.6, by = hn.at.y + hn.at.r * hn.up * 0.8, bz = hn.at.z;
      for (let r = 0; r < 3; r++) {
        const f = r / 3;
        const cx = bx + hn.side * f * hn.len * 0.35, cy = by + f * hn.len * (0.45 + 0.25 * f), cz = bz - f * hn.len * hn.back;
        const rr = hn.rad * (1 - f * 0.7);
        for (let j = 0; j < HORN; j++) {
          const a = (j / HORN) * Math.PI * 2;
          put(b + r * HORN + j, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, cz);
        }
      }
      put(b + 3 * HORN, bx + hn.side * hn.len * 0.4, by + hn.len * 0.85, bz - hn.len * hn.back * 1.05);
    });
    // Dorsal spines: 14 fins along the back, from the neck to the tail's middle.
    for (let s = 0; s < 14; s++) {
      const i = Math.round(N - 6 - s * ((N - 10) / 13));
      const q = pts[Math.max(1, Math.min(N - 2, i))], q2 = pts[Math.max(0, Math.min(N - 1, i - 1))];
      const top = q.y + q.r * 1.1;
      const hgt = 0.018 + 0.022 * Math.sin(Math.PI * (s / 13) * 0.9 + 0.3);
      put(L.spines + s * 3, q.x, top - 0.003, q.z);
      put(L.spines + s * 3 + 1, q2.x, top - 0.003, q2.z);
      put(L.spines + s * 3 + 2, (q.x + q2.x) / 2, top + hgt, q.z * 0.35 + q2.z * 0.65);
    }
    // The spade at the tail's tip.
    const t0 = pts[0], t1 = pts[2];
    const ax = t0.x - t1.x, az = t0.z - t1.z;
    const al = Math.hypot(ax, az) || 1;
    put(L.spade, t0.x, t0.y, t0.z);
    put(L.spade + 1, t0.x + az / al * 0.03, t0.y, t0.z - ax / al * 0.03 + (ax / al) * 0.0);
    put(L.spade + 2, t0.x + ax / al * 0.06, t0.y + 0.004, t0.z + az / al * 0.06);
    put(L.spade + 3, t0.x - az / al * 0.03, t0.y, t0.z + ax / al * 0.03);
    // Legs: forelegs under the chest, hind legs under the hips; standing (tuck 0) or folded back (1).
    const legs = [
      { at: c.front[1], side: -1, fwd: 0.02 }, { at: c.front[1], side: 1, fwd: 0.02 },
      { at: c.back[4], side: -1, fwd: -0.01 }, { at: c.back[4], side: 1, fwd: -0.01 },
    ];
    const stand = 0.15; // the root's height above the ground when perched (dragon units)
    legs.forEach((lg, k) => {
      const b = L.legs[k];
      const hip = { x: lg.at.x + lg.side * lg.at.r * 0.75, y: lg.at.y - lg.at.r * 0.4, z: lg.at.z + lg.fwd };
      const t = p.tuck;
      // Tucked, the legs fold flat under the belly, feet trailing: no sticks hanging in flight.
      const foot = { x: hip.x + lg.side * 0.02 * (1 - t), y: -stand * (1 - t) + (hip.y - 0.012) * t, z: hip.z + 0.02 * (1 - t) - 0.075 * t };
      const knee = { x: (hip.x + foot.x) / 2 + lg.side * 0.012, y: (hip.y + foot.y) / 2 - 0.006 * t, z: (hip.z + foot.z) / 2 + (k < 2 ? -0.03 : 0.035) * (1 - t) };
      const joints = [hip, knee, foot];
      const rads = [0.03, 0.017, 0.011]; // a thigh, a shin, an ankle
      for (let r = 0; r < 3; r++) for (let j = 0; j < LEG; j++) {
        const a = (j / LEG) * Math.PI * 2;
        put(b + r * LEG + j, joints[r].x + Math.cos(a) * rads[r], joints[r].y, joints[r].z + Math.sin(a) * rads[r]);
      }
      put(b + 3 * LEG, foot.x, foot.y - 0.008, foot.z + 0.02);
    });
    // Wings: four membrane panels each, between the fingers, the last finger and the flank, and the arm
    // and the flank. u runs along the bones (0 at the wrist or shoulder), v across the membrane.
    for (const [w, side] of [[0, -1], [1, 1]]) {
      const j = wing(p, side, c);
      const edges = [
        [[j.wrist, j.fingers[0]], [j.wrist, j.fingers[1]]],
        [[j.wrist, j.fingers[1]], [j.wrist, j.fingers[2]]],
        [[j.wrist, j.fingers[2]], [j.elbow, j.hip]],
        [[j.shoulder, j.elbow], [j.shoulder, j.hip]],
      ];
      edges.forEach(([e0, e1], panel) => {
        const base = L.wings[w][panel];
        for (let u = 0; u < PANEL_U; u++) {
          const fu = u / (PANEL_U - 1);
          const a = { x: e0[0].x + (e0[1].x - e0[0].x) * fu, y: e0[0].y + (e0[1].y - e0[0].y) * fu, z: e0[0].z + (e0[1].z - e0[0].z) * fu };
          const b = { x: e1[0].x + (e1[1].x - e1[0].x) * fu, y: e1[0].y + (e1[1].y - e1[0].y) * fu, z: e1[0].z + (e1[1].z - e1[0].z) * fu };
          for (let v = 0; v < PANEL_V; v++) {
            const fv = v / (PANEL_V - 1);
            // The trailing edge scallops toward the wrist between the bones; the membrane billows.
            const scal = panel < 3 ? 0.22 * Math.sin(Math.PI * fv) * fu * fu : 0;
            const billow = 0.025 * Math.sin(Math.PI * fv) * Math.sin(Math.PI * fu);
            const x = a.x + (b.x - a.x) * fv, y = a.y + (b.y - a.y) * fv, z = a.z + (b.z - a.z) * fv;
            const cx = e0[0].x, cy = e0[0].y, cz = e0[0].z;
            put(base + u * PANEL_V + v, x + (cx - x) * scal, y + (cy - y) * scal - billow, z + (cz - z) * scal);
          }
        }
      });
    }
    // The fire heart sits in the chest, and brightens with a breath.
    const chest = c.front[1];
    this.core.position.set(chest.x, chest.y, chest.z);
    this.core.scale.setScalar(p.chest * (1 + 0.6 * (this.breath > 0 ? 1 : 0)));
    const g = this.geometry;
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
  }

  span() {
    return spanOf(this.lastPose);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.core.geometry.dispose();
    this.core.material.dispose();
  }
}
