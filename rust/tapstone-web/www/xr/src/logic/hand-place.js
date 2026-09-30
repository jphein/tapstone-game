// logic/hand-place.js: where the fan of cards sits (JP, 2026-09-28: "you need to be able to place your
// hand wherever is best for you"). Pure: board-local metres in, a clamped spot out, and the stored form.
//
// The spot is the fan's centre under play.js's root (the board), so seated mode's re-placing carries it
// along. It is clamped to a box a seated or standing player can reach without leaning over the board,
// and it is stored per page (localStorage), once for each hand: a left-handed layout keeps its own.
import { HAND } from './layout.js';

export const HAND_HOME = { x: 0, y: HAND.y, z: HAND.z };
// Reach, board-local: side to side, from just above the table to chest height, and never out over the
// board's far half nor behind the player.
export const REACH = { x: [-0.45, 0.45], y: [0.02, 0.45], z: [0.12, 0.75] };
export const HAND_KEY = 'tapstone.hand';

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
export function clampSpot(p) {
  const n = (v, d) => (Number.isFinite(v) ? v : d);
  return { x: clamp(n(p?.x, HAND_HOME.x), REACH.x), y: clamp(n(p?.y, HAND_HOME.y), REACH.y), z: clamp(n(p?.z, HAND_HOME.z), REACH.z) };
}

const side = (leftHanded) => (leftHanded ? 'left' : 'right');

// The stored spot for this handedness (HAND_HOME when none, or when the store is unreadable).
export function loadSpot(storage, leftHanded) {
  try {
    const all = JSON.parse(storage?.getItem(HAND_KEY) ?? 'null');
    const p = all?.[side(leftHanded)];
    return p ? clampSpot(p) : { ...HAND_HOME };
  } catch {
    return { ...HAND_HOME };
  }
}

export function saveSpot(storage, leftHanded, p) {
  const spot = clampSpot(p);
  try {
    const all = JSON.parse(storage?.getItem(HAND_KEY) ?? 'null') ?? {};
    all[side(leftHanded)] = spot;
    storage?.setItem(HAND_KEY, JSON.stringify(all));
  } catch {
    // private mode: the spot holds for this page
  }
  return spot;
}
