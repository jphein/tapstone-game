// wyrm-pose.js: the Cinder Whelp's body in motion (design note 2026-09-29-xr-summons-fidelity-design.md).
// Pure math, no three: wyrm.js builds the mesh and asks this where every part is. The dragon is
// described in its own units: +z is forward (its snout), +y up, +x its right; nose to tail tip is ~1.
// The look is PROPOSAL (art direction): the bible describes no dragon.
//
//   pose(mode, t, opts)   the pose at time t (s) in a mode:
//     'fly'    a flap cycle: a fast, deep downstroke and a slower upstroke; legs tucked, tail streaming
//     'glide'  wings spread and still but for a flutter at the tips; legs tucked
//     'perch'  standing on its cell, wings folded; it breathes, its tail sways, its neck looks about,
//              and now and then it stretches its wings (STRETCH)
//     opts.snap 0..1: the attack's head strike (the neck thrusts, the jaw opens)
//     opts.breath 0..1: fire (the jaw opens wide, the neck arches)
//   chain(p)   the spine's points from p: the front chain (root → snout) and the back chain (root →
//              tail tip), each point {x, y, z, r} with r the body's radius there. Segment lengths never
//              change with the pose: only the angles do.
//   wing(p, side)  the wing's joints (shoulder, elbow, wrist and three finger tips), side -1 left, +1 right.

// Segment lengths (dragon units), root (mid-body) → snout, and root → tail tip.
export const FRONT = [0.06, 0.055, 0.05, 0.047, 0.045, 0.043, 0.04, 0.045, 0.05];
export const BACK = [0.06, 0.058, 0.055, 0.052, 0.05, 0.048, 0.046, 0.044, 0.042, 0.04, 0.038, 0.036, 0.034, 0.034];
// The rest pitch of each joint (rad; positive: the chain rises as it goes out from the root). The neck
// rises and the head levels; the tail droops, then its tip curls up.
const FRONT_PITCH = [0.05, 0.12, 0.28, 0.32, 0.26, 0.14, -0.08, -0.32, -0.12];
const BACK_PITCH = [-0.05, -0.07, -0.08, -0.06, -0.03, 0.0, 0.03, 0.05, 0.06, 0.07, 0.08, 0.09, 0.11, 0.13];
// Body radius along each chain (at each point, root first).
const FRONT_R = [0.095, 0.09, 0.074, 0.056, 0.045, 0.04, 0.038, 0.05, 0.047, 0.022];
const BACK_R = [0.095, 0.092, 0.082, 0.07, 0.058, 0.047, 0.039, 0.032, 0.027, 0.022, 0.018, 0.014, 0.011, 0.008, 0.005];

export const SHOULDER = { at: 1, up: 0.045, out: 0.045 }; // on the front chain's point 1
// The fingers fan from the wrist: the first straight out, the last back toward the tail (rad, toward the tail).
export const WING = { humerus: 0.17, forearm: 0.21, fingers: [0.3, 0.27, 0.22], back: [-0.05, 0.55, 1.15] };
export const FLAP = { hz: 2.4, down: 0.4, lift: 0.95, dip: -0.75 }; // down: the downstroke's share of the cycle
export const STRETCH = { every: 7, ms: 1300 };

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => x * x * (3 - 2 * x);

// The flap's shoulder angle (rad, up +) at cycle phase u (0..1): a fast downstroke then a slow upstroke,
// continuous at both ends.
export function flapAngle(u) {
  u = u - Math.floor(u);
  const { down, lift, dip } = FLAP;
  return u < down ? lift + (dip - lift) * ease(u / down) : dip + (lift - dip) * ease((u - down) / (1 - down));
}

// The wing stretch's strength (0..1) at time t in perch: a slow rise, a hold, and a fold back, once
// every STRETCH.every seconds.
export function stretchAt(t) {
  const d = STRETCH.ms / 1000;
  const x = t % STRETCH.every;
  if (x > d) return 0;
  return Math.sin(Math.PI * (x / d)) ** 2;
}

export function pose(mode, t, { snap = 0, breath = 0 } = {}) {
  const front = FRONT_PITCH.map((p) => ({ pitch: p, yaw: 0 }));
  const back = BACK_PITCH.map((p) => ({ pitch: p, yaw: 0 }));
  const p = { mode, front, back, wing: { lift: 0, fold: 0, sweep: 0, tip: 0 }, jaw: 0.04, tuck: 0, chest: 1 };
  // Breathing: the chest swells and the neck rises a little with each breath (both modes).
  const br = Math.sin(TAU * 0.35 * t);
  p.chest = 1 + 0.035 * br;
  if (mode === 'fly' || mode === 'glide') {
    p.tuck = 1;
    const u = t * FLAP.hz;
    if (mode === 'fly') {
      p.wing.lift = flapAngle(u);
      // The body heaves against each stroke; the tail streams, lagging in a travelling wave.
      const heave = Math.sin(TAU * u + 1.2);
      for (let i = 0; i < front.length; i++) front[i].pitch -= 0.03 * heave * (i < 4 ? 1 : 0.4);
      for (let i = 0; i < back.length; i++) {
        back[i].pitch = back[i].pitch * 0.4 + 0.035 * Math.sin(TAU * u - i * 0.5);
        back[i].yaw = 0.03 * Math.sin(TAU * 0.5 * t - i * 0.35);
      }
      p.wing.fold = 0.12 + 0.18 * (1 - (p.wing.lift - FLAP.dip) / (FLAP.lift - FLAP.dip)); // the upstroke folds a little
      p.wing.tip = 0.25 * Math.sin(TAU * u - 1.0);
    } else {
      p.wing.lift = 0.12 + 0.03 * Math.sin(TAU * 1.3 * t);
      p.wing.tip = 0.08 * Math.sin(TAU * 3.1 * t);
      for (let i = 0; i < back.length; i++) {
        back[i].pitch *= 0.4;
        back[i].yaw = 0.045 * Math.sin(TAU * 0.4 * t - i * 0.3);
      }
    }
  } else {
    // Perched: wings folded along the flanks, tail curling and swaying, neck looking about.
    const st = stretchAt(t);
    p.wing.lift = 0.55 * st + 0.35;
    p.wing.fold = 1 - 0.85 * st;
    p.wing.sweep = 0.1 * (1 - st);
    p.wing.tip = 0.1 * st * Math.sin(TAU * 1.5 * t);
    for (let i = 0; i < back.length; i++) {
      back[i].pitch += 0.03 * Math.sin(TAU * 0.25 * t - i * 0.4);
      back[i].yaw = 0.07 * Math.sin(TAU * 0.22 * t - i * 0.32) + 0.035 * i / back.length;
    }
    const look = Math.sin(TAU * 0.09 * t) * 0.55 + Math.sin(TAU * 0.23 * t) * 0.15;
    for (let i = 3; i < front.length; i++) front[i].yaw = look * 0.12;
    for (let i = 2; i < 6; i++) front[i].pitch += 0.02 * br + 0.06 * st;
  }
  if (snap) {
    // The strike: the neck thrusts forward and down, the head levels, the jaw opens.
    for (let i = 2; i < front.length; i++) front[i].pitch -= snap * (i < 6 ? 0.22 : -0.1);
    p.jaw = Math.max(p.jaw, 0.55 * snap);
  }
  if (breath) {
    // Fire: the neck thrusts forward and a little down, the head juts, the jaw opens wide.
    for (let i = 2; i < 6; i++) front[i].pitch -= 0.09 * breath;
    front[front.length - 1].pitch -= 0.12 * breath;
    p.jaw = Math.max(p.jaw, 0.7 * breath);
  }
  return p;
}

// Walk a chain from the root, outward along +z (dir 1, to the snout) or -z (dir -1, to the tail),
// bending by each joint's pitch (positive: the chain rises as it goes out) and yaw.
function walk(lengths, joints, radii, dir, chest) {
  const out = [{ x: 0, y: 0, z: 0, r: radii[0] * chest }];
  let pitch = 0, yaw = 0, x = 0, y = 0, z = 0;
  for (let i = 0; i < lengths.length; i++) {
    pitch += joints[i].pitch;
    yaw += joints[i].yaw;
    const L = lengths[i];
    x += L * Math.cos(pitch) * Math.sin(yaw);
    y += L * Math.sin(pitch);
    z += dir * L * Math.cos(pitch) * Math.cos(yaw);
    out.push({ x, y, z, r: radii[i + 1] * (i < 2 ? chest : 1) });
  }
  return out;
}

export function chain(p) {
  return { front: walk(FRONT, p.front, FRONT_R, 1, p.chest), back: walk(BACK, p.back, BACK_R, -1, p.chest) };
}

// Rotate v about the z axis (the body's length) by a, then about the y axis by b.
const rotZ = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a), z: v.z });
const rotY = (v, b) => ({ x: v.x * Math.cos(b) + v.z * Math.sin(b), y: v.y, z: -v.x * Math.sin(b) + v.z * Math.cos(b) });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (v, k) => ({ x: v.x * k, y: v.y * k, z: v.z * k });

// A wing's joints, in dragon units. The arm lifts about the body's axis (lift), folds (fold 0 spread,
// 1 folded along the flank), and sweeps back (sweep); the fingers fan from the wrist.
export function wing(p, side, c = chain(p)) {
  const s = c.front[SHOULDER.at];
  const shoulder = { x: s.x + side * SHOULDER.out, y: s.y + SHOULDER.up, z: s.z };
  const { lift, fold, sweep, tip } = p.wing;
  // The arm: out to the side, raised by `lift`, swept back by `sweep` and by the fold.
  const out = (len, extraBack, extraLift) => {
    const v = rotY({ x: side * len, y: 0, z: 0 }, side * (sweep + extraBack)); // positive: toward the tail
    return rotZ(v, side * (lift + extraLift));
  };
  const elbow = add(shoulder, out(WING.humerus, fold * 0.9, 0));
  const wrist = add(elbow, out(WING.forearm, -0.3 + fold * 2.2, -0.15 * fold));
  const fingers = WING.fingers.map((len, i) => add(wrist, out(len * (1 - 0.55 * fold), WING.back[i] * (1 - fold) + fold * 2.8, -0.2 - tip * (i + 1) * 0.5)));
  // The membrane's trailing root: the flank behind the shoulder.
  const h = c.back[3];
  const hip = { x: h.x + side * h.r * 0.8, y: h.y + h.r * 0.3, z: h.z };
  return { shoulder, elbow, wrist, fingers, hip };
}

// The span tip to tip (dragon units) of a pose: the widest x of either wing's joints.
export function span(p) {
  const c = chain(p);
  let w = 0;
  for (const side of [-1, 1]) {
    const j = wing(p, side, c);
    for (const q of [j.elbow, j.wrist, ...j.fingers]) w = Math.max(w, Math.abs(q.x));
  }
  return 2 * w;
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export { add, scale };
