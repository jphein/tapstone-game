// layout.js: the table's geometry in metres, board-local: origin at the board's centre on the
// table surface, +z toward the player, +x to their right, +y up. Pure (no three.js), so the FoV test
// runs under Node on the same numbers the scene builds with.
//
// Spec 2026-09-25 §3.1 orders it from the player outward: the hand, the altar (three lane pads on
// its top), the deck at the altar's right end, my castle (a low plaque), the board. The day-1 spike
// (scratch/vr/spike-day1.md) measured the spike's layout at 60.7-79.3° across on the Quest 2, over a
// 70° device, so this layout is sized to the budget and tested:
//   - the board is 0.50 x 0.35 m (spec: 0.60 x 0.42): at a seated reach the 0.60 board spans ~63°,
//     past 0039's "lower-central 50°"; at 0.50 its near corners sit at ±25.5°;
//   - the altar sits within seated reach (the spec, after the spike: targets "within seated reach",
//     at least 6 cm): its pads are 0.51 m from the head, where the spike's touches worked (18 of 27
//     taps were touches). On a table 0.42 m below the eyes nothing is closer than 0.42 m, so the
//     spec's "about 30-40 cm" can't be literal here; the test holds the measured 0.51 m;
//   - reach and FoV together narrow it: 0.30 m wide (spec: 0.62), pads 8 x 7 cm at ±0.10, converging
//     toward the middle (still plainly left / middle / right, and each within its lane's half-width);
//   - the menu row is gone: the prompt (a spell's targets, the mulligan) floats over the altar's
//     middle, and nothing floats past the near edge.

export const BOARD = { w: 0.5, d: 0.35 };
export const LANES = 3;
export const ROWS = 6;
export const LANE_W = BOARD.w / LANES;
export const ROW_D = BOARD.d / ROWS;

export const ALTAR = { w: 0.3, d: 0.1, h: 0.025, z: 0.4 };
export const PAD = { w: 0.08, d: 0.07, x: [-0.1, 0, 0.1] }; // lane 0, 1, 2 from the player's left
export const CARD = { w: 0.054, d: 0.086 }; // CR80 portrait, like the paper cards
export const DECK = { x: ALTAR.w / 2 + 0.03, z: ALTAR.z };
export const CASTLE_PLAQUE = { w: 0.2, d: 0.03, h: 0.01, z: BOARD.d / 2 + 0.01 };
export const FAR_KEEP = { w: 0.12, d: 0.05, h: 0.12, z: -BOARD.d / 2 - 0.03 };
export const HAND = { z: 0.5, y: 0.18, spread: 0.1 }; // the fan's centre and half-width
export const PROMPT = { y: 0.08, z: ALTAR.z, w: 0.27, h: 0.06 }; // three tiles, each 9 x 6 cm

// The teahouse's doors (0039): one per faction plane, this far from the head and this far round
// from the player's forward view. Outside the ±32° kept for play ("nothing essential ever sits in a
// door"), inside the room (|yaw| < 80°), and apart: a door is DOOR_W wide, so the test checks each
// pair's edges from DOOR_W and DOOR_DISTANCE. Neutral cards come from the Hearthlands (0039, lead
// decision 2026-09-28), whose door stands past Tide's on the right.
export const DOORS = [
  { faction: 'ember', yawDeg: -47 },
  { faction: 'tide', yawDeg: 47 },
  { faction: 'neutral', yawDeg: 76 },
];
export const DOOR_DISTANCE = 1.8;
export const DOOR_W = 0.9; // the frame's width; teahouse.js builds it

export function doorCenter(d) {
  const yaw = (d.yawDeg * Math.PI) / 180;
  return { x: Math.sin(yaw) * DOOR_DISTANCE, y: 0.8, z: PLACE.ahead - Math.cos(yaw) * DOOR_DISTANCE };
}

// Where the board goes at the first immersive frame, relative to the head (the player then places
// it for real): its centre 0.70 m ahead and 0.42 m down, which keeps the board inside 0039's 50°.
export const PLACE = { ahead: 0.7, down: 0.42 };

// A cell's centre on the board, for seat `seat` seen from the person's side. `near` is the seat
// nearest the player (the person's own seat), whose back cell (cell 0) is the row nearest them.
export function cellCenter(seat, lane, cell, near) {
  const row = seat === near ? ROWS - 1 - cell : cell; // row 0 = the far edge
  return { x: -BOARD.w / 2 + LANE_W * (lane + 0.5), y: 0, z: -BOARD.d / 2 + ROW_D * (row + 0.5) };
}

export function padCenter(lane) {
  return { x: PAD.x[lane], y: ALTAR.h, z: ALTAR.z };
}

// The head at the default placement, and the gaze (toward the board's centre).
export function defaultHead() {
  return { x: 0, y: PLACE.down, z: PLACE.ahead };
}

// A point's yaw and pitch, in degrees, off the gaze from `head` to the board's centre.
export function offGaze(p, head = defaultHead()) {
  const g = norm(sub({ x: 0, y: 0, z: 0 }, head));
  const v = norm(sub(p, head));
  const yaw = Math.atan2(v.x, -v.z) - Math.atan2(g.x, -g.z);
  const pitch = Math.asin(v.y) - Math.asin(g.y);
  return { yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI };
}

// Everything the player must see to play, by name: the board's corners, the far keep's top, the
// altar's corners and pads, the deck, the hand fan's ends and the prompt.
// `access` (logic/access.js) moves the deck to the side the person draws with.
export function essentials(access = null) {
  const out = {};
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out[`board ${sx},${sz}`] = { x: (sx * BOARD.w) / 2, y: 0, z: (sz * BOARD.d) / 2 };
  out['far keep top'] = { x: 0, y: FAR_KEEP.h, z: FAR_KEEP.z };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out[`altar ${sx},${sz}`] = { x: (sx * ALTAR.w) / 2, y: ALTAR.h, z: ALTAR.z + (sz * ALTAR.d) / 2 };
  for (let l = 0; l < LANES; l++) out[`pad ${l}`] = padCenter(l);
  out.deck = { x: access?.leftHanded ? -DECK.x : DECK.x, y: 0.03, z: DECK.z };
  for (const sx of [-1, 1]) out[`hand ${sx}`] = { x: sx * HAND.spread, y: HAND.y, z: HAND.z };
  out.prompt = { x: 0, y: PROMPT.y, z: PROMPT.z };
  return out;
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const norm = (a) => {
  const n = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / n, y: a.y / n, z: a.z / n };
};
