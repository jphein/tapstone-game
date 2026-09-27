// sfx.js: the payoff sounds (VR spec 2026-09-25 §8, M2: "with sound per beat"). Pure: which
// view-diff event (logic/effects.js) makes which sound, and each sound as a recipe the page
// synthesizes with WebAudio (src/sfx.js). No clips: nothing to fetch, nothing to license.
//
// A sound starts when its effect starts (effects-player.js), so it follows the effect queue: one at
// a time, in record order, and a dropped effect (a compressed backlog) is also a dropped sound. Each
// sound is no longer than its effect (test/sfx.test.js holds that), so two never overlap.
//
// A recipe is a list of voices. A voice is one oscillator (`wave`, gliding f0 → f1 Hz) or a burst of
// band-passed noise (`wave: 'noise'`, centred on f0), starting `at` s into the sound, lasting `dur`
// s, with a 5 ms attack to `peak` gain and an exponential fall.

export const WAVES = ['sine', 'triangle', 'square', 'sawtooth', 'noise'];

const v = (wave, f0, at, dur, peak, f1) => ({ wave, f0, f1: f1 ?? f0, at, dur, peak });

export const SOUNDS = {
  // A card leaves the deck: a paper flick and a small lift.
  draw: { voices: [v('noise', 3200, 0, 0.06, 0.18), v('triangle', 880, 0.02, 0.14, 0.16, 1320)] },
  // A mana gem lights: a glassy ping and its fifth.
  charge: { voices: [v('sine', 1320, 0, 0.22, 0.3), v('sine', 1980, 0.03, 0.18, 0.12)] },
  // The summon arc: a rising sweep with a shimmer over it.
  summon: { voices: [v('triangle', 330, 0, 0.5, 0.3, 990), v('sine', 660, 0.12, 0.42, 0.14, 1320)] },
  // Both front cells struck at once: a bright hit on a low thud.
  clash: { voices: [v('noise', 1800, 0, 0.12, 0.34), v('square', 180, 0, 0.16, 0.12, 110)] },
  // A unit crumbles: dull rubble and a falling tone.
  kill: { voices: [v('noise', 600, 0, 0.32, 0.3), v('triangle', 220, 0, 0.34, 0.2, 110)] },
  // A chip off a keep: a short knock and a grit burst.
  keepChip: { voices: [v('square', 520, 0, 0.08, 0.14, 260), v('noise', 2500, 0.01, 0.07, 0.2)] },
  // The match: a rising arpeggio (C E G C) for a win, a falling one for a loss.
  win: { voices: [v('triangle', 523, 0, 0.3, 0.2), v('triangle', 659, 0.18, 0.3, 0.2), v('triangle', 784, 0.36, 0.3, 0.2), v('triangle', 1047, 0.54, 0.9, 0.2)] },
  lose: { voices: [v('triangle', 392, 0, 0.35, 0.22), v('triangle', 330, 0.28, 0.35, 0.22), v('triangle', 262, 0.56, 1.0, 0.22, 247)] },
};

// The effect type each sound belongs to (the result's two sounds share one).
export const SOURCE = { draw: 'drawFlip', charge: 'chargeGem', summon: 'summon', clash: 'clash', kill: 'death', keepChip: 'keepChip', win: 'result', lose: 'result' };

// Effects that move but make no sound, each by name: a stagger (damage) is heard as the clash or the
// kill it leads to, a step forward is quiet, and the commander's fall and return have the summon's
// and the kill's company in the same diff. Any effect type not here must have a sound.
export const SILENT = ['advance', 'damage', 'commanderFall', 'commanderReturn'];

const BY_TYPE = Object.fromEntries(Object.entries(SOURCE).filter(([, t]) => t !== 'result').map(([s, t]) => [t, s]));

// The sound for one effect, heard from seat `near`, or null. A void match (winner null) is neither
// a win nor a loss, and stays silent.
export function soundFor(e, near) {
  if (!e) return null;
  if (e.type === 'result') return e.winner === null || e.winner === undefined ? null : e.winner === near ? 'win' : 'lose';
  return BY_TYPE[e.type] ?? null;
}

// Seconds from the first voice's start to the last voice's end.
export const soundLength = (s) => Math.max(...s.voices.map((x) => x.at + x.dur));

// The loudest the voices could be together (every peak at once): the headroom check's worst case.
export const soundPeak = (s) => Math.round(s.voices.reduce((a, x) => a + x.peak, 0) * 1000) / 1000;
