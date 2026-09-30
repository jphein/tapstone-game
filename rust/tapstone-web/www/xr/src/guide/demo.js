// guide/demo.js: the ghost hand's demonstrations as keyframes (guide v2). Pure: positions in, poses
// out, so node checks each one (a charge turns the card face down BEFORE it touches the stone; a cast
// never does; the card is only carried between the pinch and the release).
//
// Staged where the move happens (the lead's review of #198: the hand filled a quarter of the view,
// its forearm running back toward the eyes). The hand works from the reaching hand's side of the move,
// square to the line of sight (stage()): it comes in from that side to the card, carries it on an arc
// that bows out to that side, and leaves the same way, fading in and out. It never reaches down from
// above the card toward the head, and test/guide-staging.test.js holds it clear of the eyes, the target
// pad, the caption and the card it shows, from standing, seated and leaning heads, either hand.
// Positions are board-local metres, like everything else under play.js's root.
export const PHASES = [
  // [name, ms]
  ['reach', 500],
  ['down', 300],
  ['pinch', 250],
  ['lift', 300],
  ['carry', 900],
  ['touch', 300],
  ['release', 250],
  ['rise', 400],
  ['rest', 1100],
];
export const LOOP_MS = PHASES.reduce((a, [, ms]) => a + ms, 0);
export const HOVER = 0.03; // above a thing before going down to it, and the lift (m)
export const SIDE = 0.12; // the reach comes in from, and the rise leaves to, this far to the side (m)
export const BOW = 0.07; // the carry bows this far out to the side (m)
export const TOUCH_Y = 0.012; // the held card just above the stone at the touch
export const FADE_MS = 250;
// The hand model (ghost.js builds its mesh from these): the pinch at its origin, the palm and a short
// wrist behind it along the lateral direction. Life size: pinch to wrist 15 cm, as an adult hand.
// `radius` bounds the whole hand (the eye and footprint checks); the palm and wrist, behind the
// fingertips, are what can hide something (`palmAt` from the pinch, `palmR`): the fingertips touch the
// card and the stone by design.
export const HAND = { length: 0.15, palmY: 0.028, radius: 0.08, palmAt: 0.085, palmR: 0.055, thick: 0.04 };
// The rule the staging holds (breaches(), test/guide-staging.test.js): no part of the hand nearer the
// eyes than the thing it demonstrates, less EYE_SLACK (it is AT the card, never in front of it), and
// never nearer than MIN_EYE whatever the head; never wider than MAX_DEG in the view.
export const EYE_SLACK = 0.03;
export const MIN_EYE = 0.12;
export const MAX_DEG = 45;

const nrm2 = (x, z) => {
  const n = Math.hypot(x, z) || 1;
  return { x: x / n, y: 0, z: z / n };
};

// The lateral direction the hand works from, for a move from `from` to `to` seen from `head`: level,
// square to the line of sight to the move, on the reaching side (side 1: the right hand, -1: the left),
// and turned a little away from the head, so the hand is beside the move and never in front of it.
// If that staging would cover something (breaches(): the target pad seen past the card, say), the
// nearest turn that covers nothing is used instead; `caption` is the banner to keep clear.
const TURNS = [0, 30, -30, 60, -60, 90, -90, 135, -135, 180].map((d) => (d * Math.PI) / 180);
export function stage(head, from, to, side = 1, { move = 'cast', caption = null } = {}) {
  const mx = (from.x + to.x) / 2, mz = (from.z + to.z) / 2;
  const f = nrm2(mx - head.x, mz - head.z);
  const base = nrm2(-f.z * side + 0.35 * f.x, f.x * side + 0.35 * f.z);
  let best = null;
  for (const a of TURNS) {
    const turn = a * side, c = Math.cos(turn), s = Math.sin(turn);
    const lat = nrm2(base.x * c - base.z * s, base.x * s + base.z * c);
    const n = breaches(move, from, to, head, lat, { caption, step: 60, first: true }).length;
    if (n === 0) return lat;
    if (!best || n < best.n) best = { lat, n };
  }
  return best.lat;
}

const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len3 = (a) => Math.sqrt(dot3(a, a));
function toSegment(p, a, b) {
  const ab = sub3(b, a), t = Math.max(0, Math.min(1, dot3(sub3(p, a), ab) / dot3(ab, ab)));
  return len3(sub3(p, { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t }));
}

// Every breach of the staging rule for one demo from one head (strings, [] when none), sampled every
// `step` ms: the hand nearer the eyes than what it shows (less EYE_SLACK) or than MIN_EYE; wider than
// MAX_DEG; its palm and wrist on the line of sight to the target pad, to the caption, or (before the
// pinch) to the card it shows. A faded-out hand covers nothing.
export function breaches(move, from, to, head, lat, { caption = null, step = 20, first = false } = {}) {
  const out = [];
  const shown = Math.min(len3(sub3(from, head)), len3(sub3(to, head)));
  const floor = Math.max(MIN_EYE, shown - EYE_SLACK - HAND.thick);
  for (let t = 0; t < LOOP_MS; t += step) {
    const p = poseAt(move, from, to, t, { lat });
    if (!p.show || p.alpha < 0.05) continue;
    const s = handSphere(p, lat), name = p.phase;
    const d = len3(sub3(s.c, head));
    const bad = [];
    // The hand's nearest point: of the pinch, the palm and the wrist, less the hand's thickness.
    const near = Math.min(...[p.pos, s.palm, s.wrist].map((q) => len3(sub3(q, head)))) - HAND.thick;
    if (near < floor) bad.push(`${near.toFixed(3)} m from the eyes (floor ${floor.toFixed(3)})`);
    const deg = (2 * Math.atan(s.r / d) * 180) / Math.PI;
    if (deg > MAX_DEG) bad.push(`${deg.toFixed(1)}° wide`);
    if (toSegment(s.palm, head, to) < s.palmR) bad.push('covers the target pad');
    if (caption && toSegment(s.palm, head, caption) < s.palmR) bad.push('covers the caption');
    if (!p.carrying && (name === 'reach' || name === 'down') && toSegment(s.palm, head, from) < s.palmR) bad.push('covers the card it shows');
    for (const b of bad) out.push(`${name} ${t} ms: ${b}`);
    if (first && out.length) return out;
  }
  return out;
}

// The hand at pose `p`: its bounding sphere (c, r), and the palm and wrist's (palm, palmR), which is
// what could stand between the eyes and something; both lie behind the pinch along `lat`.
export function handSphere(p, lat) {
  const at = (d) => ({ x: p.pos.x + lat.x * d, y: p.pos.y + HAND.palmY * 0.7, z: p.pos.z + lat.z * d });
  return { c: at(HAND.length / 2), r: HAND.radius, palm: at(HAND.palmAt), palmR: HAND.palmR, wrist: at(HAND.length) };
}

// The phase at `t` ms into the loop: { name, k } with k 0..1 through it.
export function phaseAt(t) {
  let u = ((t % LOOP_MS) + LOOP_MS) % LOOP_MS;
  for (const [name, ms] of PHASES) {
    if (u < ms) return { name, k: u / ms };
    u -= ms;
  }
  return { name: 'rest', k: 1 };
}

const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => k * k * (3 - 2 * k);
const mix = (p, q, k) => ({ x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k), z: lerp(p.z, q.z, k) });
const up = (p, dy) => ({ x: p.x, y: p.y + dy, z: p.z });

// The pose at `t`: { pos (the pinch point), roll (degrees: 180 = palm up, the card face down), pinch
// (0 open .. 1 closed), carrying (the ghost card is in the fingers), faceDown (the card's face), alpha
// (the fade), show }. move: 'draw' | 'charge' | 'cast' | 'claim' | 'pass'. opts.lat: stage()'s
// direction (default: from the right, level).
export function poseAt(move, from, to, t, { lat = { x: 1, y: 0, z: 0 } } = {}) {
  const { name, k } = phaseAt(t);
  const e = ease(k);
  const flips = move === 'charge';
  const side = (p, d, dy) => ({ x: p.x + lat.x * d, y: p.y + dy, z: p.z + lat.z * d });
  const land = up(to, TOUCH_Y);
  const u = ((t % LOOP_MS) + LOOP_MS) % LOOP_MS;
  const end = LOOP_MS - PHASES.at(-1)[1]; // the rise ends here
  const alpha = Math.max(0, Math.min(1, u / FADE_MS, (end - u) / FADE_MS));
  let pos, roll = 0, pinch = 0, carrying = false;
  switch (name) {
    case 'reach':
      pos = mix(side(from, SIDE, HOVER), up(from, HOVER), e); // in from the side, at the card's height
      break;
    case 'down':
      pos = mix(up(from, HOVER), up(from, 0.004), e);
      break;
    case 'pinch':
      pos = up(from, 0.004);
      pinch = e;
      carrying = k > 0.5;
      break;
    case 'lift':
      pos = mix(up(from, 0.004), up(from, HOVER), e);
      pinch = 1;
      carrying = true;
      break;
    case 'carry': {
      const flat = mix(up(from, HOVER), up(to, HOVER), e);
      const b = Math.sin(Math.PI * e) * BOW; // bowed out to the side, not up toward the eyes
      pos = { x: flat.x + lat.x * b, y: flat.y + Math.sin(Math.PI * e) * 0.02, z: flat.z + lat.z * b };
      roll = flips ? 180 * ease(Math.min(1, k / 0.8)) : 0; // the wrist is over before it comes down
      pinch = 1;
      carrying = true;
      break;
    }
    case 'touch':
      pos = mix(up(to, HOVER), land, e);
      roll = flips ? 180 : 0;
      pinch = 1;
      carrying = true;
      break;
    case 'release':
      pos = land;
      roll = flips ? 180 : 0;
      pinch = 1 - e;
      carrying = k < 0.5;
      break;
    case 'rise':
      pos = mix(land, side(to, SIDE, HOVER), e); // away to the side it came from
      roll = flips ? 180 * (1 - e) : 0;
      break;
    default: // rest: hidden, then it starts again
      return { pos: side(from, SIDE, HOVER), roll: 0, pinch: 0, carrying: false, faceDown: false, alpha: 0, show: false, phase: name };
  }
  return { pos, roll, pinch, carrying, faceDown: flips && roll >= 90, alpha, show: true, phase: name };
}

// Points along the route, for the dotted path: from above the source to above the target, bowed out to
// the side as the carry is.
export function pathPoints(from, to, n = 12, lat = { x: 1, y: 0, z: 0 }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = i / (n - 1);
    const flat = mix(up(from, HOVER), up(to, HOVER), e);
    const b = Math.sin(Math.PI * e) * BOW;
    out.push({ x: flat.x + lat.x * b, y: flat.y + Math.sin(Math.PI * e) * 0.02, z: flat.z + lat.z * b });
  }
  return out;
}

// The head-gaze demo (guide/modes.js steps: #200's gazeForItem targets): a dwell ring fills on each
// target in turn, one dwell each, GAZE_GAP between, then it rests and loops. Answers { step, progress
// (0..1), show }.
export const GAZE_GAP = 300;
export const GAZE_REST = 1000;
export function gazePoseAt(steps, t, dwellMs) {
  const each = dwellMs + GAZE_GAP, loop = steps.length * each + GAZE_REST;
  const u = ((t % loop) + loop) % loop;
  const step = Math.floor(u / each);
  if (step >= steps.length) return { step: steps.length - 1, progress: 1, show: false };
  const into = u - step * each;
  return { step, progress: Math.min(1, into / dwellMs), show: true };
}
