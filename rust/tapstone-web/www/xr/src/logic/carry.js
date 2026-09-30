// One carry, one pad action. Pure, so node checks it (test/carry.test.js).
//
// Root cause (quill's #188 finding, traced by tools/iwer-press-log.mjs on 2026-09-28): a card carried
// to a pad reached play.js up to four ways, and each became an action. The pinch that picks a card up
// both grabs it (the touch path plays it on a pad) and presses it (the eyes-and-hands path lifts it),
// so the lift was replayed by the next pad press. The carrying hand's fingertip pressed the pads it
// crossed and the one it landed on (bare "advances"), and pressed it again as it left, 258-284 ms after
// letting go. A whole match: 41 plays, 38-41 refusals, 12-14 voice lines cut short. A real hand does all
// of this: pinching is how a card is picked up, and a fingertip holding a card touches the pad with it.
//
// The rule: while a hand carries something, its pad presses are the carry (the touch path owns the
// card), and for SETTLE_MS after it lets go they are the hand leaving. The other hand is never gated
// (hold a card in one hand, poke a pad with the other). Pokes with no carry always count, so a lane can
// be advanced twice in a row, and each pinch of the castle is one tap (the double-tap mulligan is two
// pinches; a castle carried onto a pad doesn't tap again).
export const SETTLE_MS = 500; // ~1.75x the longest measured leave (284 ms); a deliberate poke takes longer
export const REACH_M = 0.15; // a fingertip within this of the pad pressed it; else the hand is unknown (a ray)
const EARLY_MS = 100; // a castle press may land a frame or so before its grab

export class CarryGate {
  constructor({ settleMs = SETTLE_MS } = {}) {
    this.settleMs = settleMs;
    this.holding = new Map(); // key -> { hand, at }
    this.ended = new Map(); // hand -> when it let go
    this.castleAt = -Infinity; // the last castle tap
  }

  grab(key, hand, now) {
    this.holding.set(key, { hand: hand ?? null, at: now });
  }

  release(key, now) {
    const h = this.holding.get(key);
    if (!h) return;
    this.holding.delete(key);
    this.ended.set(h.hand, now);
  }

  // What a pad press by `hand` (null: unknown) means: 'carry' or 'settle' (swallowed), else 'lifted'
  // (play the lifted card there) or 'advance'.
  pad(now, hand, lifted) {
    for (const h of this.holding.values()) if (h.hand === hand || h.hand === null || hand === null) return 'carry';
    const ends = hand === null ? [...this.ended.values()] : [this.ended.get(hand), this.ended.get(null)];
    if (ends.some((t) => t !== undefined && now - t < this.settleMs)) return 'settle';
    return lifted ? 'lifted' : 'advance';
  }

  // Whether a castle tap at `now` counts: one per pinch of the castle.
  castleTap(now) {
    const g = this.holding.get('castle');
    const same = g ? this.castleAt >= g.at - EARLY_MS : now - this.castleAt < EARLY_MS;
    if (same) return false;
    this.castleAt = now;
    return true;
  }
}

// Where a held card counts as on a pad (offsets from the pad's centre, metres). `touch` is the card
// alone meeting the pad; `land` is the carrying hand's fingertip pressing that pad while the card hangs
// just above it (IWER measured 31-33 mm, over the 30 mm touch height, on every missed placing).
export const TOUCH = { flat: 0.045, height: 0.03 };
export const LAND = { flat: TOUCH.flat, height: 0.06 };
export const onPad = ({ flat, up }, zone = TOUCH) => flat <= zone.flat && up >= -0.01 && up <= zone.height;

// The touch path played `source` (slot for a hand card): the lift made by the same pinch is spent.
export function liftSpent(lifted, source, slot) {
  return !!lifted && lifted.source === source && (source !== 'hand' || lifted.slot === slot);
}

// dists: [{ hand, d }] (metres from each tracked index fingertip). The nearest, if within reach.
export function nearestHand(dists) {
  let best = null;
  for (const x of dists) if (x.d <= REACH_M && (!best || x.d < best.d)) best = x;
  return best ? best.hand : null;
}
