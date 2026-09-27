// first-five.js: the headset's first five minutes (spec 2026-09-25 §3.4) as a beat table and the
// state machine that walks it. Pure (no DOM, no IWSDK); every clock is passed in (ms).
//
// One new gesture per beat, each paid off within 3 s, and no text panel: the altar's voice line
// speaks one sentence per beat. A beat that teaches waits for its gesture (`count` times), then for
// its payoff; it never advances on a gesture it did not teach. A beat that only watches (the bot's
// turn, unguided play) advances on its payoff or when its own clock runs out.
//
// Gestures (what play.js reports): 'place' (the board placed), 'claim' (the castle card on the
// stone in the lobby), and one per committed move, from gestureOf(menu item).
// Payoffs (beatEvents, from two views; 'placed' from placement): 'commander', 'drawFlip',
// 'chargeGem', 'summon', 'botTurn', 'death', 'enemyKeepChip', and 'over' (ends the tutorial).
import { diffViews } from './effects.js';

// The first-match house rules (§3.4): existing HouseRules fields, no engine change. Measured
// 2026-09-27 before adoption (the spec's note under §3.4); the in-page table still plays the defaults.
export const FIRST_MATCH = { castle_life: 10, pressure_from: 4, stop_round: 6 };

// How long a gesture waits for its payoff before the next beat starts anyway.
export const PAYOFF_MS = 3000;

const s = (m, sec) => (m * 60 + sec) * 1000;
// `beat` is the spec table's wording (a test holds them equal); `state` marks a payoff that is a
// standing fact rather than a moment, so it counts even if it happened before the gesture.
export const BEATS = [
  { id: 'place', clock: [s(0, 0), s(0, 15)], beat: 'place the stone', teaches: 'place', count: 1, say: 'Set the stone on your table.', payoff: 'placed', state: true },
  { id: 'claim', clock: [s(0, 15), s(0, 35)], beat: 'castle on the stone', teaches: 'claim', count: 1, say: 'Touch your castle card to the stone.', payoff: 'commander', state: true },
  { id: 'draw', clock: [s(0, 35), s(1, 10)], beat: 'five draw taps', teaches: 'draw', count: 5, say: 'Touch your deck to the stone five times to draw your hand.', payoff: 'drawFlip' },
  { id: 'flip', clock: [s(1, 10), s(1, 40)], beat: 'the wrist flip', teaches: 'charge', count: 1, say: 'Turn a card face down and touch it to a pad for mana.', payoff: 'chargeGem' },
  { id: 'cast', clock: [s(1, 40), s(2, 10)], beat: 'face up on a pad', teaches: 'cast', count: 1, say: 'Touch a card face up to a pad to summon it.', payoff: 'summon' },
  { id: 'pass', clock: [s(2, 10), s(2, 30)], beat: 'castle to pass', teaches: 'pass', count: 1, say: 'Touch your castle to the stone to end your turn.', payoff: 'botTurn' },
  { id: 'bot', clock: [s(2, 30), s(3, 30)], beat: "the bot's turn", teaches: null, count: 0, say: 'Now watch the other side move.', payoff: 'death' },
  { id: 'unguided', clock: [s(3, 30), s(5, 0)], beat: 'unguided play', teaches: null, count: 0, say: 'The board is yours, so break their keep.', payoff: 'enemyKeepChip' },
];

// The gesture a committed menu item was (menu.js's item kinds).
const GESTURE = { Draw: 'draw', Charge: 'charge', CastUnit: 'cast', CastSpell: 'spell', Advance: 'advance', Pass: 'pass', Mulligan: 'mulligan' };
export const gestureOf = (item) => (item ? GESTURE[item.kind] ?? null : null);

// The beat payoffs in one view change, from the same diffViews the scene animates.
export function beatEvents(prev, next, near) {
  const out = [];
  for (const e of diffViews(prev, next, near)) {
    if (e.type === 'summon' && e.seat === near) out.push(e.commander ? 'commander' : 'summon');
    else if ((e.type === 'drawFlip' || e.type === 'chargeGem') && e.seat === near) out.push(e.type);
    else if (e.type === 'death') out.push('death');
    else if (e.type === 'keepChip' && e.seat !== near) out.push('enemyKeepChip');
    else if (e.type === 'result') out.push('over');
  }
  if (prev && prev.active === near && next.phase === 'playing' && next.active !== near) out.push('botTurn');
  return out;
}

export class FirstFive {
  constructor({ beats = BEATS, payoffMs = PAYOFF_MS } = {}) {
    this.beats = beats;
    this.payoffMs = payoffMs;
    this.i = -1;
    this.seen = new Set(); // state payoffs seen so far, whichever beat was current
    this.states = new Set(beats.filter((b) => b.state).map((b) => b.payoff));
  }

  get beat() {
    return this.beats[this.i] ?? null;
  }
  get active() {
    return this.i >= 0 && !this.done;
  }
  get done() {
    return this.i >= this.beats.length;
  }

  // Each method returns the sentence the voice should say now, or null.
  start(now) {
    return this.enter(0, now, 'start');
  }

  gesture(kind, now) {
    const b = this.beat;
    if (!this.active || !b.teaches || kind !== b.teaches || this.paidAt !== null) return null;
    if (++this.made < b.count) return null;
    if (b.state && this.seen.has(b.payoff)) return this.enter(this.i + 1, now, 'payoff');
    this.paidAt = now; // the gesture is complete: now its payoff, within payoffMs
    return null;
  }

  event(kind, now) {
    if (kind === 'over') {
      this.i = this.beats.length;
      return null;
    }
    if (this.states.has(kind)) this.seen.add(kind);
    const b = this.beat;
    if (!this.active) return null;
    if (kind !== b.payoff) return null;
    if (b.teaches && this.paidAt === null) return null; // a payoff before the gesture isn't one
    return this.enter(this.i + 1, now, 'payoff');
  }

  // Call every frame: a missing payoff gives way after payoffMs; a watching beat ends with its
  // clock; a teaching beat whose gesture hasn't come repeats its sentence once per beat length.
  poll(now) {
    const b = this.beat;
    if (!this.active) return null;
    if (this.paidAt !== null && now - this.paidAt >= this.payoffMs) return this.enter(this.i + 1, now, 'fallback');
    const length = b.clock[1] - b.clock[0];
    if (now - this.since < length) return null;
    if (!b.teaches) return this.enter(this.i + 1, now, 'clock');
    if (this.paidAt !== null) return null;
    this.since = now; // remind, and wait another beat length before reminding again
    return b.say;
  }

  // Whether the current beat still holds the other voice lines (play.js speaks only the beat's
  // sentence, and refusals, while it does). A beat holds for its own clock window (§3.4: the
  // table's length for it, from when it started, as poll() times its reminder), and past it only
  // while a gesture it asked for waits on its payoff. An unanswered beat then hands the voice back:
  // it stays current, its gesture still counts, and its one reminder still speaks.
  holding(now) {
    if (!this.active) return false;
    if (this.paidAt !== null) return true;
    const b = this.beat;
    return now - this.at < b.clock[1] - b.clock[0];
  }

  // True once, on the frame the hold ends, so the caller can say the line it held back.
  release(now) {
    const h = this.holding(now);
    const r = this.held && !h;
    this.held = h;
    return r;
  }

  // `why` the last beat started: 'start', 'payoff', 'fallback' (no payoff within payoffMs) or
  // 'clock' (a watching beat ran out), so a run can say whether each payoff really came.
  enter(i, now, why) {
    this.i = i;
    this.why = why;
    this.since = now; // the reminder's clock (reset by each reminder)
    this.at = now; // the hold's clock (never reset)
    this.held = true;
    this.made = 0;
    this.paidAt = null;
    return this.beat ? this.beat.say : null;
  }
}
