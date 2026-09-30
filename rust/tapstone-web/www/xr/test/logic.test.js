// The pure logic's tests: `node --test test/` from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { matchGesture, targetOf, CASTLE_TARGET } from '../src/logic/menu.js';
import { FlipDetector, CastleTaps, TargetTimer, pressKind } from '../src/logic/gestures.js';
import { diffViews, EffectQueue } from '../src/logic/effects.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '../../../../tapstone-arena/web/fixtures/desk-seed11.jsonl');
const views = readFileSync(FIXTURE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// A menu in tapstone-web's shape (after Task R2): the fields the matcher reads.
const item = (kind, card, lane = -1, target = 0, aux = 0) => ({ key: '', label: `${kind} ${card}`, kind, useful: true, card, lane, target, aux });

test('the fixture is the real desk match', () => {
  assert.equal(views.length, 87);
});

// ---- menu.js --------------------------------------------------------------------------------

test('a unit face up on pad N casts into lane N, and only there', () => {
  const menu = [item('Charge', 7), item('CastUnit', 7, 0), item('CastUnit', 7, 2), item('Pass', 0)];
  assert.deepEqual(matchGesture(menu, { source: 'hand', card: 7, face: 'up', pad: 2 }), { index: 2 });
  assert.deepEqual(matchGesture(menu, { source: 'hand', card: 7, face: 'up', pad: 0 }), { index: 1 });
  assert.ok(matchGesture(menu, { source: 'hand', card: 7, face: 'up', pad: 1 }).refused, 'lane 1 is not offered');
});

test('face down on any pad charges that card', () => {
  const menu = [item('Charge', 7), item('Charge', 9), item('CastUnit', 7, 1)];
  assert.deepEqual(matchGesture(menu, { source: 'hand', card: 9, face: 'down', pad: 0 }), { index: 1 });
  assert.ok(matchGesture(menu, { source: 'hand', card: 3, face: 'down' }).refused);
});

test('while draws are owed only the deck answers (0036)', () => {
  const menu = [item('Draw', 4)];
  assert.match(matchGesture(menu, { source: 'hand', card: 7, face: 'up', pad: 0 }).refused, /Draw first/);
  assert.deepEqual(matchGesture(menu, { source: 'deck' }), { index: 0 });
});

test('the castle passes, or mulligans only inside the window', () => {
  const menu = [item('Mulligan', 0), item('Pass', 0)];
  assert.deepEqual(matchGesture(menu, { source: 'castle', action: 'pass' }), { index: 1 });
  assert.deepEqual(matchGesture(menu, { source: 'castle', action: 'mulligan' }), { index: 0 });
  assert.ok(matchGesture([item('Pass', 0)], { source: 'castle', action: 'mulligan' }).refused);
});

test('a spell with several targets asks for one; a target picks exactly its item', () => {
  const mine = targetOf(0, 1, 2), theirs = targetOf(1, 1, 2); // same lane and cell, different seats
  const menu = [item('CastSpell', 11, -1, mine), item('CastSpell', 11, -1, theirs), item('CastSpell', 11, -1, CASTLE_TARGET)];
  const ask = matchGesture(menu, { source: 'hand', card: 11, face: 'up', pad: 0 });
  assert.equal(ask.need, 'target');
  assert.equal(ask.options.length, 3);
  // The seat is in the target byte, so my unit and theirs at the same lane and cell stay apart
  // (the menu KEY drops the seat: s/<card>/<lane><cell>).
  assert.deepEqual(matchGesture(menu, { source: 'hand', card: 11, face: 'up', target: theirs }), { index: 1 });
  assert.deepEqual(matchGesture(menu, { source: 'hand', card: 11, face: 'up', target: mine }), { index: 0 });
});

test('a bare fingertip on a pad advances that lane (rules-v0: "Advance: touch a lane")', () => {
  const menu = [item('Advance', 0, 0), item('Advance', 0, 2), item('Pass', 0)];
  assert.deepEqual(matchGesture(menu, { source: 'lane', pad: 2 }), { index: 1 });
  assert.match(matchGesture(menu, { source: 'lane', pad: 1 }).refused, /advance/i);
});

test('an empty menu is not your move', () => {
  assert.match(matchGesture([], { source: 'deck' }).refused, /your move/);
});

// ---- gestures.js ----------------------------------------------------------------------------

test('the wrist flip has hysteresis: edge-on does not flicker', () => {
  const f = new FlipDetector();
  assert.equal(f.update(0.9), 'up');
  assert.equal(f.update(-0.2), 'up', 'not past the down threshold');
  assert.equal(f.update(-0.5), 'down');
  assert.equal(f.update(0.2), 'down', 'not past the up threshold');
  assert.equal(f.update(0.6), 'up');
});

test('the castle: pass at once outside the window; inside, a second tap within 3 s mulligans', () => {
  const c = new CastleTaps();
  assert.equal(c.tap(0, false), 'pass');
  assert.equal(c.tap(1000, true), 'pending');
  assert.equal(c.poll(3000), null, 'the window is still open at 2 s');
  assert.equal(c.tap(3500, true), 'mulligan', 'second tap at 2.5 s');
  assert.equal(c.tap(10000, true), 'pending');
  assert.equal(c.poll(13001), 'pass', 'the window ran out: keep and pass');
  assert.equal(c.poll(14000), null, 'only once');
});

test('a target: gaze and pinch picks it; otherwise the default applies after 3 s', () => {
  const t = new TargetTimer();
  const options = [{ index: 4, target: 0x12 }, { index: 5, target: 0x16 }];
  t.start(0, options, 1);
  assert.equal(t.pick(0x99), null, 'not an option');
  assert.equal(t.pick(0x12), 4);
  t.start(0, options, 1);
  assert.equal(t.poll(2999), null);
  assert.equal(t.poll(3000), 5, 'the default');
  assert.equal(t.active, false);
});

test('poke or ray, by fingertip distance', () => {
  assert.equal(pressKind([0.02]), 'poke');
  assert.equal(pressKind([0.05, 0.4]), 'ray');
  assert.equal(pressKind([]), 'ray');
});

// ---- effects.js: replay the real match --------------------------------------------------------

const all = [];
for (let i = 1; i < views.length; i++) all.push({ i, v: views[i], fx: diffViews(views[i - 1], views[i], 0) });
const count = (type) => all.reduce((n, x) => n + x.fx.filter((e) => e.type === type).length, 0);

test('every castle life lost is a keep chip, exactly', () => {
  const lost = [0, 0];
  for (const x of all) for (const e of x.fx) if (e.type === 'keepChip') lost[e.seat] += e.amount;
  const end = views.at(-1).last_over ?? views.at(-1);
  assert.deepEqual(lost, [20 - end.seats[0].life, 20 - end.seats[1].life]);
});

test('every charge record lights exactly one gem', () => {
  const charges = views.filter((v) => v.last && v.last.kind === 'Charge').length;
  assert.equal(count('chargeGem'), charges);
  assert.ok(charges > 0);
});

test('every draw record flips exactly one card; only the person sees its name', () => {
  const draws = views.filter((v) => v.last && v.last.kind === 'Draw').length;
  assert.equal(count('drawFlip'), draws);
  for (const x of all) for (const e of x.fx) if (e.type === 'drawFlip') assert.equal(e.card !== null, e.seat === 0);
});

test('every unit cast summons exactly once, and the commanders arrive at the start', () => {
  const casts = views.filter((v) => v.last && v.last.kind === 'CastUnit').length;
  const commanders = all.flatMap((x) => x.fx).filter((e) => e.type === 'summon' && e.commander).length;
  const summonsOnCast = all.filter((x) => (x.v.last || {}).kind === 'CastUnit').map((x) => x.fx.filter((e) => e.type === 'summon' && !e.commander).length);
  assert.equal(summonsOnCast.length, casts);
  assert.ok(summonsOnCast.every((n) => n === 1), `each cast summons one: ${summonsOnCast}`);
  assert.ok(commanders >= 2, 'both commanders');
});

test('an advance is a move, never a death plus a summon', () => {
  for (const x of all.filter((y) => (y.v.last || {}).kind === 'Advance')) {
    const kinds = x.fx.map((e) => e.type);
    assert.ok(!kinds.includes('summon'), `view ${x.i}: an advance summoned ${JSON.stringify(x.fx)}`);
  }
  assert.ok(count('advance') > 0);
});

test('the match ends with one result, naming the winner', () => {
  const results = all.flatMap((x) => x.fx).filter((e) => e.type === 'result');
  assert.equal(results.length, 1);
  assert.equal(results[0].winner, (views.at(-1).last_over ?? views.at(-1)).winner);
});

test('the queue plays one effect at a time and compresses a backlog, keeping the result', () => {
  const q = new EffectQueue({ maxPending: 3 });
  q.push([{ type: 'damage' }, { type: 'death' }, { type: 'keepChip' }, { type: 'chargeGem' }, { type: 'result', winner: 0 }]);
  assert.equal(q.length, 3);
  assert.equal(q.next(0).type, 'keepChip', 'the oldest were dropped');
  assert.equal(q.next(100), null, 'still playing');
  assert.equal(q.next(300).type, 'chargeGem');
  assert.equal(q.next(600).type, 'result');
});

// Refusals that say why (guide v2, JP's Quest 2 run): the engine's costs and mana (charged - spent).

const warden = { card: 7, name: 'Hearth Warden', cost: 2, kind: 'unit' };
const seat = (charged, spent, owed = 0) => ({ phase: 'playing', active: 0, seats: [{ charged, spent, owed_draws: owed }, {}] });

test('a card you cannot afford names its cost, your mana, and how to charge', () => {
  const menu = [{ kind: 'Charge', card: 7 }, { kind: 'Pass' }];
  const g = { source: 'hand', card: 7, face: 'up', pad: 1 };
  assert.equal(matchGesture(menu, g, { hand: [warden], view: seat(0, 0) }).refused, 'Hearth Warden needs 2 mana — you have 0. Charge a card: flip it face down and touch it to the stone.');
  assert.equal(matchGesture(menu, g, { hand: [warden], view: seat(3, 2) }).refused, 'Hearth Warden needs 2 mana — you have 1. Charge a card: flip it face down and touch it to the stone.');
  assert.equal(matchGesture([{ kind: 'Pass' }], g, { hand: [warden], view: seat(1, 1) }).refused, 'Hearth Warden needs 2 mana — you have 0. You can charge a card again next round.', 'no charge on offer: say when it comes back');
  assert.equal(matchGesture(menu, g).refused, "You can't play that card now.", 'no context: the old answer, unchanged');
});

test('the other refusals say why too', () => {
  const ctx = { hand: [warden], view: seat(0, 0, 3) };
  assert.equal(matchGesture([{ kind: 'Draw' }], { source: 'lane', pad: 1 }, ctx).refused, 'Draw 3 cards first: touch the top card of your deck to the stone.');
  assert.equal(matchGesture([{ kind: 'Pass' }], { source: 'deck' }, { view: seat(0, 0) }).refused, 'No draw is owed.', 'plain and voiced: nothing to add');
  assert.equal(matchGesture([{ kind: 'Pass' }, { kind: 'Advance', lane: 0 }], { source: 'lane', pad: 2 }, { view: seat(0, 0) }).refused, 'The right lane has already advanced this turn.');
  assert.equal(matchGesture([{ kind: 'Pass' }], { source: 'hand', card: 7, face: 'down' }, { hand: [warden], view: seat(1, 0) }).refused, "Hearth Warden stays in your hand: you've charged a card this round already, so charge again next round.");
  assert.equal(matchGesture([], { source: 'deck' }, { view: seat(0, 0) }).refused, "It isn't your move.", 'plain and voiced');
  assert.equal(matchGesture([], { source: 'deck' }, { view: { phase: 'over', seats: [] } }).refused, 'The match is over.');
  assert.equal(matchGesture([{ kind: 'Pass' }, { kind: 'CastUnit', card: 7, lane: 0 }], { source: 'hand', card: 7, face: 'up', pad: 2 }, { hand: [warden], view: seat(2, 0) }).refused, "That lane's entry cell is taken.", 'a lane-specific answer is already precise');
});

test("a refusal's way to charge is the mode's own: a phrase by voice, the dwells by head gaze", () => {
  const menu = [{ kind: 'Charge', card: 7 }, { kind: 'Pass' }];
  const g = { source: 'hand', card: 7, face: 'up', pad: 1 };
  assert.equal(matchGesture(menu, g, { hand: [warden], view: seat(0, 0), mode: 'voice' }).refused, 'Hearth Warden needs 2 mana — you have 0. Charge a card: say “charge Hearth Warden”.');
  assert.equal(matchGesture(menu, g, { hand: [warden], view: seat(0, 0), mode: 'gaze' }).refused, 'Hearth Warden needs 2 mana — you have 0. Charge a card: look at it twice, then at a pad.');
});
