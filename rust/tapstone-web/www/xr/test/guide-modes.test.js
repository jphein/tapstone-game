// The guide in each way of playing (guide v2 with #200's first-run offer): a person who chose head gaze
// is shown a dwell ring on each target in turn, and one who chose voice the phrase to say, on the
// caption band. Neither is shown a hand pinch. The steps and phrases are #200's own (logic/gaze.js
// gazeForItem, logic/voice-commands.js voiceForItem), so the guide can't teach a gesture the mode lacks.
// Run: node --test test/guide-modes.test.js from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inMode, modeOf } from '../src/guide/modes.js';
import { gazePoseAt, GAZE_GAP } from '../src/guide/demo.js';
import { gazeForItem } from '../src/logic/gaze.js';
import { voiceForItem } from '../src/logic/voice-commands.js';
import { lessonFor } from '../src/guide/lesson.js';

const hand = [{ card: 3, name: 'Cinder Whelp', cost: 1, kind: 'unit' }, { card: 7, name: 'Hearth Warden', cost: 2, kind: 'unit' }];
const view = { phase: 'playing', active: 0, round: 1, seats: [{ owed_draws: 0, hand: 2, charged: 0, spent: 0, cells: [[], [], []] }, { life: 20 }] };
const menu = [{ kind: 'Charge', card: 3 }, { kind: 'Charge', card: 7 }, { kind: 'Advance', lane: 1 }, { kind: 'Pass' }];

test('the mode is what the first-run offer (or the panel) set', () => {
  assert.equal(modeOf({}), 'hands');
  assert.equal(modeOf({ gaze: true }), 'gaze');
  assert.equal(modeOf({ voice: true }), 'voice');
  assert.equal(modeOf({ voice: true, gaze: true }), 'voice', 'voice speaks for itself; its phrase is the caption');
});

test('hands: the lesson as spoken, its clip and its ghost hand', () => {
  const l = lessonFor('flip', { view, menu, hand });
  assert.deepEqual(inMode(l, 'hands', { menu, hand }), { mode: 'hands', line: l.say });
});

test("voice: the phrase #200's grammar plays, on the caption band", () => {
  const l = lessonFor('flip', { view, menu, hand });
  const m = inMode(l, 'voice', { menu, hand });
  assert.equal(m.phrase, voiceForItem(l.item, menu, hand)[0]);
  assert.equal(m.line, 'Say “charge Cinder Whelp”.');
  const claim = inMode(lessonFor('claim', { view }), 'voice', { menu, hand });
  assert.equal(claim.line, 'Say “claim”.');
  const pass = inMode(lessonFor('pass', { view, menu, hand }), 'voice', { menu, hand });
  assert.equal(pass.line, 'Say “end turn”.');
});

test("gaze: the targets #200's dwell plays, in order, named", () => {
  const l = lessonFor('flip', { view, menu, hand });
  const m = inMode(l, 'gaze', { menu, hand });
  assert.deepEqual(m.steps, gazeForItem(l.item, hand));
  assert.equal(m.line, 'Look at Cinder Whelp twice, then at the middle pad.');
  const claim = inMode(lessonFor('claim', { view }), 'gaze', { menu, hand });
  assert.deepEqual(claim.steps, [{ kind: 'castle' }]);
  assert.equal(claim.line, 'Look at your castle card.');
});

test('the mana detour keeps its numbers and ends with the mode\'s own way to charge', () => {
  const cast = lessonFor('cast', { view, menu, hand });
  assert.equal(cast.id, 'mana');
  assert.equal(inMode(cast, 'voice', { menu, hand }).line, 'Cinder Whelp needs 1 mana — you have 0. Say “charge Cinder Whelp”.');
  assert.equal(inMode(cast, 'gaze', { menu, hand }).line, 'Cinder Whelp needs 1 mana — you have 0. Look at Cinder Whelp twice, then at the middle pad.');
});

test('a watching beat is the same sentence in every mode', () => {
  for (const mode of ['gaze', 'voice']) assert.equal(inMode(lessonFor('bot', { view }), mode, {}).line, 'Now watch the other side move.');
});

test('the gaze demo fills a ring on each target in turn, one dwell each, then rests', () => {
  const steps = [{ kind: 'hand', slot: 0 }, { kind: 'hand', slot: 0 }, { kind: 'pad', lane: 1 }];
  const ms = 1000;
  assert.deepEqual(gazePoseAt(steps, 0, ms), { step: 0, progress: 0, show: true });
  assert.equal(gazePoseAt(steps, ms - 1, ms).progress > 0.99, true);
  assert.equal(gazePoseAt(steps, ms + GAZE_GAP + 1, ms).step, 1);
  assert.equal(gazePoseAt(steps, 2 * (ms + GAZE_GAP) + 500, ms).step, 2);
  assert.equal(gazePoseAt(steps, 3 * (ms + GAZE_GAP) + 10, ms).show, false, 'rests after the last');
  assert.equal(gazePoseAt(steps, 0 + (3 * (ms + GAZE_GAP) + 1100), ms).step, 0, 'and loops');
});
