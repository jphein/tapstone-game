// gaze.js: eyes-only play by HEAD gaze and dwell (accessibility, design note
// 2026-09-28-xr-accessibility-design.md). Pure: every clock is passed in (ms), tested under Node.
//
// The Quest 2 and 3S have no eye tracking, so "gaze" here is where the head points: a reticle at
// the centre of view (src/gaze.js raycasts along the head's forward axis). Resting it on a target
// for `ms` selects it, with a ring that fills as it goes.
//
// Dwell input has one classic failure: whatever the eyes rest on gets selected ("the Midas touch").
// So: a target fires once and must be left before it can fire again; a glance away shorter than
// `graceMs` keeps the progress (head tremor, a blink of tracking); and a move that costs something
// on a bare look (advancing a lane: looking at a pad with nothing lifted) takes two laps.

// Targets are plain objects: { kind: 'hand', slot } | { kind: 'deck' } | { kind: 'castle' } |
// { kind: 'pad', lane } | { kind: 'prompt', option } | { kind: 'unit', target } | { kind: 'tile', key }.
export const keyOf = (t) => (t ? `${t.kind}:${t.slot ?? t.lane ?? t.option ?? t.target ?? t.key ?? ''}` : null);

export const DWELL_DEFAULT = 1000;
export const DWELL_CHOICES = [800, 1000, 1500, 2000];

export class Dwell {
  constructor({ ms = DWELL_DEFAULT, graceMs = 250 } = {}) {
    this.ms = ms;
    this.graceMs = graceMs;
    this.key = null; // the target being dwelt on
    this.since = 0; // when the dwell on it started
    this.seen = 0; // when it was last under the reticle
    this.spent = false; // it fired, and hasn't been left since
  }

  // One frame: `target` is what the reticle is on (or null), `laps` how many dwell lengths it
  // takes. Answers { key, progress (0..1), fired: target | null }.
  update(now, target, laps = 1) {
    const k = keyOf(target);
    if (k === null) {
      // Off every target: a short glance keeps the dwell; a longer one ends it.
      if (this.key !== null && now - this.seen > this.graceMs) this.reset();
      return { key: this.key, progress: this.progressAt(now, laps), fired: null };
    }
    if (k !== this.key) {
      this.key = k;
      this.since = now;
      this.spent = false;
    }
    this.seen = now;
    const progress = this.progressAt(now, laps);
    if (progress >= 1) {
      this.spent = true;
      return { key: k, progress: 1, fired: target };
    }
    return { key: k, progress, fired: null };
  }

  // 0 once fired (spent): the ring empties, and it can't fire again until the target is left.
  progressAt(now, laps = 1) {
    if (this.key === null || this.spent) return 0;
    return Math.min(1, (now - this.since) / (this.ms * laps));
  }

  reset() {
    this.key = null;
    this.spent = false;
  }
}

// How many dwell lengths a target takes, given what is lifted: a bare pad advances a lane, which
// can waste the lane's advance (human.rs says so plainly), so it takes two; everything else one.
export function lapsFor(target, lifted) {
  return target?.kind === 'pad' && !lifted ? 2 : 1;
}

// One dwell's effect, mirroring play.js's eyes-and-hands path (a pinch there is a dwell here):
// a hand card lifts it (the same card again turns it over), the deck lifts its top card, a pad plays
// what is lifted there (or advances its lane), the castle is a castle tap, and a prompt tile or a
// target unit picks a spell's target. `hand` is the shown hand ([{ card, name }]).
// Answers { lifted } (the new lifted state) plus at most one of { gesture }, { castle: true },
// { prompt: option }, { unit: target }, { tile: key }.
export function gazeStep(lifted, t, hand = []) {
  switch (t?.kind) {
    case 'hand':
      if (lifted?.source === 'hand' && lifted.slot === t.slot) return { lifted: { ...lifted, face: lifted.face === 'up' ? 'down' : 'up' } };
      return { lifted: { source: 'hand', slot: t.slot, face: 'up' } };
    case 'deck':
      return { lifted: { source: 'deck' } };
    case 'pad': {
      if (!lifted) return { lifted: null, gesture: { source: 'lane', pad: t.lane } };
      if (lifted.source === 'deck') return { lifted: null, gesture: { source: 'deck' } };
      const c = hand[lifted.slot];
      return { lifted: null, gesture: { source: 'hand', card: c ? c.card : -1, face: lifted.face, pad: t.lane } };
    }
    case 'castle':
      return { lifted, castle: true };
    case 'prompt':
      return { lifted, prompt: t.option };
    case 'unit':
      return { lifted, unit: t.target };
    case 'tile':
      return { lifted, tile: t.key };
    default:
      return { lifted };
  }
}

// The inverse, for tests and the IWER driver: the dwell targets that play menu item `m` from
// nothing lifted, in order. `options` are the spell's target prompt (matchGesture's
// { need: 'target' } options), when the pad alone can't say which target: the person then looks at
// the prompt tile that names it, or, past the altar's three tiles (PROMPT_TILES), at the unit
// itself on the board (the far keep for the castle), which names its target byte.
export const PROMPT_TILES = 3;
export function gazeForItem(m, hand, options = null) {
  const slot = hand.findIndex((c) => c.card === m.card);
  switch (m.kind) {
    case 'Draw':
      return [{ kind: 'deck' }, { kind: 'pad', lane: 1 }];
    case 'Charge':
      return [{ kind: 'hand', slot }, { kind: 'hand', slot }, { kind: 'pad', lane: 1 }];
    case 'CastUnit':
      return [{ kind: 'hand', slot }, { kind: 'pad', lane: m.lane }];
    case 'CastSpell': {
      const steps = [{ kind: 'hand', slot }, { kind: 'pad', lane: 1 }];
      if (!options) return steps;
      const k = options.findIndex((o) => o.target === m.target && o.aux === m.aux);
      if (k < 0) return null;
      if (k < PROMPT_TILES) return [...steps, { kind: 'prompt', option: k }];
      // Past the tiles: the unit (or keep) itself, if its target byte says which option it is.
      if (options.filter((o) => o.target === m.target).length !== 1) return null;
      return [...steps, { kind: 'unit', target: m.target }];
    }
    case 'Advance':
      return [{ kind: 'pad', lane: m.lane }];
    case 'Pass':
    case 'Mulligan':
      // The castle: once to pass; inside the mulligan window, twice (logic/gestures.js CastleTaps).
      return m.kind === 'Pass' ? [{ kind: 'castle' }] : [{ kind: 'castle' }, { kind: 'castle' }];
    default:
      return null;
  }
}
