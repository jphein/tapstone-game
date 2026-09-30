// guide/modes.js: the guide's lesson in the way the person chose to play (#200's first-run offer:
// hands, head gaze or voice). Pure. A person playing by head gaze is shown a dwell ring on each target
// in turn and told where to look; one playing by voice is shown the phrase to say; neither is shown a
// hand pinch. The targets and phrases are #200's own (logic/gaze.js gazeForItem, logic/voice-commands.js
// voiceForItem), so the guide never teaches a gesture the mode doesn't have.
//
// The lines here are composed (card names, lanes, a phrase), so they are drawn on the band and the
// caption, not spoken (0033; the hands' lesson sentences keep their rendered clips).
import { gazeForItem } from '../logic/gaze.js';
import { voiceForItem } from '../logic/voice-commands.js';

export const modeOf = (a) => (a?.voice ? 'voice' : a?.gaze ? 'gaze' : 'hands');

const LANE = ['left', 'middle', 'right'];
function nameOf(t, hand) {
  switch (t.kind) {
    case 'deck':
      return 'your deck';
    case 'castle':
      return 'your castle card';
    case 'pad':
      return `the ${LANE[t.lane]} pad`;
    case 'hand':
      return hand[t.slot]?.name ?? 'the card';
    case 'prompt':
      return `target ${t.option + 1}`;
    default:
      return 'the target';
  }
}

// "Look at A twice, then at B." from the steps (a repeated target is "twice").
function lookLine(steps, hand) {
  const runs = [];
  for (const t of steps) {
    const n = nameOf(t, hand), last = runs.at(-1);
    if (last && last.n === n) last.k++;
    else runs.push({ n, k: 1 });
  }
  const said = runs.map((r) => (r.k === 2 ? `${r.n} twice` : r.k > 2 ? `${r.n} ${r.k} times` : r.n));
  return `Look at ${said[0]}${said.slice(1).map((x) => `, then at ${x}`).join('')}.`;
}

// The lesson in `mode`: { mode, line } plus { steps } (gaze: the targets to dwell on, in order) or
// { phrase } (voice). A lesson with no move (the stone's placing, the watching beats) is its sentence.
export function inMode(lesson, mode, { menu = [], hand = [] } = {}) {
  if (!lesson?.say || mode === 'hands') return { mode: 'hands', line: lesson?.say ?? null };
  // The mana detour keeps its first sentence (the card's cost and the mana you have).
  const pre = lesson.id === 'mana' ? `${lesson.say.split('. ')[0]}. ` : '';
  if (mode === 'voice') {
    const phrase = lesson.id === 'claim' ? 'claim' : lesson.item ? voiceForItem(lesson.item, menu, hand)?.[0] : null;
    return phrase ? { mode, phrase, line: `${pre}Say “${phrase}”.` } : { mode, line: lesson.say };
  }
  const steps = lesson.id === 'claim' ? [{ kind: 'castle' }] : lesson.item ? gazeForItem(lesson.item, hand) : null;
  return steps?.length ? { mode, steps, line: `${pre}${lookLine(steps, hand)}` } : { mode, line: lesson.say };
}
