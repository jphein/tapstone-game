// look.js: how the creatures look and fly, per room and per setting (pure, so Node holds it). The
// shader (holo.js) and the system (system.js) read these numbers; nothing here touches three.
//
//   lookFor({ room, contrast, reduced })   the hologram's parameters:
//     key, keyMix   the baked key light's colour and how much it shapes the body. The full-VR Tea
//                   House is lantern-lit (0039, luna's interior, src/art), so its key is warm; mixed
//                   reality is the person's own room, so its key is neutral.
//     tintMix       how far the part colours go toward the faction's (the rim is always the faction's)
//     scan, flicker the holographic scanlines' and flicker's depth
//     alpha         the body's opacity
//     rim           the rim's colour: the faction's, or white in high contrast
//     bob, embers   the idle hover (m) and the whelp's drifting embers (per second)
//   High contrast (logic/theme.js) wants a legible silhouette: an opaque, flat, faction-bright body
//   with a white rim, and no scanlines or flicker. Reduced motion (logic/access.js) keeps the look
//   but stills the hover and the embers.
//
//   flight(from, to, k, flies)   where a summoned creature is at k = 0..1 of its flight, and its
//     heading and bank. A flier takes off in a rising turn over the board and swoops down to its
//     cell; a walker leaps the arc. PROPOSAL (art direction), like every look here.

export const ROOM_KEY = { interior: 0xffc98a, doors: 0xf4f1ea };

export function lookFor({ room = 'doors', contrast = false, reduced = false } = {}) {
  const base = {
    key: ROOM_KEY[room] ?? ROOM_KEY.doors,
    keyMix: 0.55,
    tintMix: 0.18,
    scan: 0.07,
    flicker: 0.03,
    alpha: 0.93,
    rim: null, // the faction's
    bob: reduced ? 0 : 0.004,
    embers: reduced ? 0 : 2.5,
  };
  if (!contrast) return base;
  return { ...base, keyMix: 0.35, tintMix: 0.62, scan: 0, flicker: 0, alpha: 1, rim: 0xffffff };
}

// The flight's shape (m, board-local): how high the turn climbs above the higher end, its radius.
export const FLIGHT = { climb: 0.11, radius: 0.07, turns: 0.85, hop: 0.05 };

const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

function pos(from, to, k, flies) {
  const e = ease(k);
  let x = lerp(from.x, to.x, e), z = lerp(from.z, to.z, e);
  let y;
  if (flies) {
    // A turn that opens and closes with the flight (radius sin(πk)), climbing, then the swoop.
    const r = FLIGHT.radius * Math.sin(Math.PI * k);
    const a = 2 * Math.PI * FLIGHT.turns * e;
    x += r * Math.sin(a);
    z -= r * (1 - Math.cos(a)) * 0.6; // the turn swings out over the board, away from the face
    y = lerp(from.y, to.y, e) + FLIGHT.climb * Math.sin(Math.PI * Math.min(1, k * 1.15));
  } else {
    y = lerp(from.y, to.y, e) + FLIGHT.hop * Math.sin(Math.PI * k);
  }
  return { x, y, z };
}

// {x, y, z, yaw, roll} at k (0..1). `from`/`to` are {x, y, z}. Yaw is the heading about +y (0 faces
// +z, as the models do), along the path; roll is the bank into the turn (fliers only).
export function flight(from, to, k, flies) {
  k = Math.min(1, Math.max(0, k));
  const p = pos(from, to, k, flies);
  const a = pos(from, to, Math.max(0, k - 0.01), flies), b = pos(from, to, Math.min(1, k + 0.01), flies);
  const yaw = Math.hypot(b.x - a.x, b.z - a.z) > 1e-7 ? Math.atan2(b.x - a.x, b.z - a.z) : Math.atan2(to.x - from.x, to.z - from.z);
  return { ...p, yaw, roll: flies ? -0.5 * Math.sin(Math.PI * k) : 0 };
}

// ---- the whelp's summon: the sweep past the head (design note 2026-09-29-xr-summons-fidelity) ----------
//
//   soar(card, cell, head, side)   the big flight, as a function of k (0..1) → {x, y, z, yaw, roll, size}.
//     From the card it rises toward the person's eye line, sweeps past their head on `side` (-1 left,
//     +1 right; never nearer than SOAR.clear), turns out over the table, breathes fire at SOAR.fire
//     (heading away from the person, down toward the board), and descends to its cell, shrinking from
//     SOAR.big (×board size) back to 1. All positions are root-local (logic/layout.js), `head` too.
// clear: the nearest its centre comes to the head (m); view: the widest it strays from the gaze at the
// board while it passes (deg), so the person sees it go by.
export const SOAR = { ms: 3600, big: 2.3, clear: 0.25, view: 50, fire: 0.6, fireMs: 450 };

const cr = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), z: f(p0.z, p1.z, p2.z, p3.z) };
};

export function soarPoints(card, cell, head, side) {
  const P = (x, y, z) => ({ x, y, z });
  return [
    card,
    P(card.x + side * 0.1 + (head.x - card.x) * 0.3, card.y + 0.12, card.z + (head.z - card.z) * 0.25),
    P(head.x + side * 0.18, head.y - 0.09, head.z - 0.28), // past the head, in view, just below the eyes
    P(head.x + side * 0.24, head.y - 0.12, head.z - 0.5), // turning out over the table
    P(cell.x * 0.4 - side * 0.04, cell.y + 0.2, 0.02), // over the board: the breath
    P(cell.x, cell.y + 0.06, cell.z + 0.05),
    cell,
  ];
}

const pathAt = (pts, k) => {
  const n = pts.length - 1;
  const x = Math.min(0.999999, Math.max(0, k)) * n;
  const i = Math.floor(x);
  const g = (j) => pts[Math.max(0, Math.min(n, j))];
  return cr(g(i - 1), g(i), g(i + 1), g(i + 2), x - i);
};

// The size (× board size) over the flight: grows as it rises, stays big through the sweep and the
// breath, and shrinks as it comes down to its cell.
export function soarSize(k) {
  const { big } = SOAR;
  if (k < 0.15) return 1.3 + (big - 1.3) * ease(k / 0.15);
  if (k < 0.62) return big;
  if (k < 0.95) return big + (1 - big) * ease((k - 0.62) / 0.33);
  return 1;
}

export function soar(card, cell, head, side) {
  const pts = soarPoints(card, cell, head, side);
  const at = (k) => (k >= 1 ? { ...cell } : pathAt(pts, k));
  return (k) => {
    k = Math.min(1, Math.max(0, k));
    const p = at(k);
    const a = at(Math.max(0, k - 0.012)), b = at(Math.min(1, k + 0.012));
    const dx = b.x - a.x, dz = b.z - a.z;
    const yaw = Math.hypot(dx, dz) > 1e-7 ? Math.atan2(dx, dz) : 0;
    // Bank into the turn: the heading's rate of change.
    const a2 = at(Math.max(0, k - 0.04)), b2 = at(Math.min(1, k + 0.04));
    const y1 = Math.atan2(p.x - a2.x, p.z - a2.z), y2 = Math.atan2(b2.x - p.x, b2.z - p.z);
    let turn = y2 - y1;
    turn = ((turn + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const roll = Math.max(-0.7, Math.min(0.7, -turn * 2.2)) * Math.sin(Math.PI * k);
    const pitch = Math.atan2(b.y - a.y, Math.hypot(dx, dz) || 1e-7);
    return { ...p, yaw, roll, pitch: Math.max(-0.6, Math.min(0.6, pitch)), size: soarSize(k), heading: { x: dx, y: b.y - a.y, z: dz } };
  };
}

// Which summon a creature gets: 'form' (a calm, short form where it stands: reduced motion, or a
// creature already on the board), 'soar' (the whelp from the person's own pad: the big sweep), or
// 'flight' (the card's arc to the cell, look.js flight()).
// `soars`: the creature's model does the big sweep (the whelp: the drake, or the wyrm).
export function summonStyle({ soars = false, origin = 'pad', reduced = false } = {}) {
  if (reduced || origin === 'here') return 'form';
  return soars && origin === 'pad' ? 'soar' : 'flight';
}

// Light in mixed reality (holo.js LIGHT_BLEND): the colour adds, the framebuffer's alpha is kept, since
// in passthrough the alpha is what hides the person's room (three's AdditiveBlending adds to it, which
// turned dim sparks into dark blobs over the room, IWER 2026-09-29).
export const LIGHT = { rgb: { src: 'srcAlpha', dst: 'one' }, alpha: { src: 'zero', dst: 'one' } };
