// The guide follows the match (guide v2): on the real in-page arena, a whole fresh match taught beat
// by beat, and JP's case from the Quest 2 (a round-3 match resumed from the journal, charging never
// learned), with every lesson held to contradicts().
// Run: node --test test/guide-lesson.test.js from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tableFrom } from '../src/table.js';
import { journalStore } from '../src/logic/journal.js';
import { BEATS } from '../src/logic/first-five.js';
import { contradicts, factsFrom, firstUndone, historyFrom, kindOfKey, lessonFor, manaOf } from '../src/guide/lesson.js';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = process.env.TAPSTONE_WASM ?? join(here, 'fixtures/tapstone_web.wasm');
const bytes = readFileSync(WASM);
const exportsOf = async () => (await WebAssembly.instantiate(bytes, {})).instance.exports;
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test('journal keys map to the gestures the guide counts', () => {
  assert.deepEqual(['d/3', 'c/7', 'u/2/1', 's/9/k', 'a/0', 'p', 'm', '?'].map(kindOfKey), ['draw', 'charge', 'cast', 'spell', 'advance', 'pass', 'mulligan', null]);
  assert.deepEqual([...historyFrom([{ key: 'd/1' }, { key: 'c/4' }], ['claim'])].sort(), ['charge', 'claim', 'draw']);
});

test('a fresh match, taught beat by beat: every lesson true to the state, in order, none repeated', async () => {
  const t = tableFrom(await exportsOf(), 11, 0, null);
  const history = new Set();
  let view = null, placed = false, at = 0;
  const seen = [], problems = [];
  for (let frame = 0; frame < 20000 && !t.done(); frame++) {
    t.advance(16, (v) => (view = v));
    if (frame === 2) placed = true; // the board is placed on the second immersive frame (play.js)
    const menu = t.choices(), hand = t.hand();
    const facts = factsFrom({ view, near: 0, history, placed });
    at = Math.max(at, firstUndone(facts)); // the guide only moves forward
    const beat = BEATS[at]?.id ?? null;
    if (!beat) break;
    const lesson = lessonFor(beat, { view, near: 0, menu, hand });
    const why = contradicts(lesson, { view, near: 0, menu, hand, facts });
    if (why) problems.push(`frame ${frame}: ${why}`);
    if (lesson.id !== 'wait' && seen.at(-1) !== lesson.id) seen.push(lesson.id);
    // The learner does what the lesson shows; with nothing to do, what the web gate would.
    if (lesson.id === 'claim') history.add('claim');
    const pick = (kind, card) => menu.findIndex((m) => m.kind === kind && (card === undefined || m.card === card));
    const shown = { draw: () => pick('Draw'), flip: () => pick('Charge'), mana: () => pick('Charge'), cast: () => pick('CastUnit', hand[lesson.demo.from.slot]?.card), pass: () => pick('Pass') }[lesson.id];
    let i = shown ? shown() : -1;
    // Before the claim the learner only watches (the place and claim beats take no engine move).
    if (i < 0 && !['place', 'claim'].includes(lesson.id)) i = menu.findIndex((m) => m.useful && m.kind !== 'Mulligan');
    if (i >= 0) {
      const k = { Draw: 'draw', Charge: 'charge', CastUnit: 'cast', CastSpell: 'spell', Advance: 'advance', Pass: 'pass' }[menu[i].kind];
      if (t.propose(i) && k) history.add(k);
    }
  }
  assert.deepEqual(problems, [], 'no lesson contradicted the state');
  // The teaching beats come in the table's order, each exactly once; 'mana' may detour inside 'cast'.
  const taught = seen.filter((id) => ['claim', 'draw', 'flip', 'cast', 'pass'].includes(id));
  assert.deepEqual(taught, ['claim', 'draw', 'flip', 'cast', 'pass'], `taught ${seen}`);
  for (const id of ['bot', 'unguided']) assert.ok(seen.includes(id), `${id} was reached (${seen})`);
});

// JP's run: never charges, so no unit is ever affordable; the match plays on by advances and passes.
async function roundThreeWithoutCharging() {
  const storage = memoryStorage();
  const t = tableFrom(await exportsOf(), 11, 0, journalStore(storage));
  let view = null;
  const ready = (menu) => view?.round >= 3 && view.active === 0 && view.seats[0].owed_draws === 0 && menu.some((m) => m.kind === 'Charge');
  for (let frame = 0; frame < 20000 && !t.done(); frame++) {
    t.advance(16, (v) => (view = v));
    const menu = t.choices();
    if (ready(menu)) break; // their move in round 3, hand drawn: where JP tried his cards
    const i = menu.findIndex((m) => m.useful && !['Mulligan', 'Charge', 'CastUnit', 'CastSpell'].includes(m.kind));
    if (i >= 0) t.propose(i);
  }
  assert.ok(view.round >= 3, `reached round ${view.round}`);
  const back = tableFrom(await exportsOf(), 11, 0, journalStore(storage)); // the reload
  assert.equal(back.resumed.from, 'journal');
  return back;
}

test("JP's resume: round 3, never charged — the guide stands on 'flip', never on 'claim' or 'draw'", async () => {
  const t = await roundThreeWithoutCharging();
  const view = t.resumed.view, menu = t.choices(), hand = t.hand();
  const history = historyFrom(t.journal.taps);
  assert.ok(!history.has('charge'), 'the journal holds no charge');
  const facts = factsFrom({ view, near: 0, history, placed: true });
  assert.ok(facts.claimed && facts.drawn, 'claim and draw are done');
  const beat = BEATS[firstUndone(facts)].id;
  assert.equal(beat, 'flip', `the guide resumes on ${beat}`);
  const lesson = lessonFor(beat, { view, near: 0, menu, hand });
  assert.equal(lesson.id, 'flip', 'it is their move and a charge is on offer');
  assert.equal(contradicts(lesson, { view, near: 0, menu, hand, facts }), null);
  assert.equal(hand[lesson.demo.from.slot].card, menu.find((m) => m.kind === 'Charge').card, 'the ghost shows a card the engine will charge');
  // And the guide's old script position would have contradicted this state.
  assert.match(contradicts(lessonFor('claim', { view }), { view, near: 0, menu, hand, facts }), /already done/);
});

test("the mana detour speaks the engine's numbers, and only while the card is unaffordable", async () => {
  const t = await roundThreeWithoutCharging();
  const view = t.resumed.view, menu = t.choices(), hand = t.hand();
  const facts = factsFrom({ view, near: 0, history: historyFrom(t.journal.taps, ['claim']), placed: true });
  const lesson = lessonFor('cast', { view, near: 0, menu, hand });
  assert.equal(lesson.id, 'mana');
  const card = hand.find((c) => c.card === lesson.card);
  assert.equal(manaOf(view.seats[0]), 0);
  assert.equal(lesson.say, `${card.name} needs ${card.cost} mana — you have 0. Charge a card: flip it face down and touch it to the stone.`);
  assert.equal(contradicts(lesson, { view, near: 0, menu, hand, facts }), null);
  // The same lesson against a menu where the card is castable is a contradiction.
  const castable = [...menu, { kind: 'CastUnit', card: lesson.card, lane: 1 }];
  assert.match(contradicts(lesson, { view, near: 0, menu: castable, hand, facts }), /affordable/);
});

test('a teaching lesson waits for the move to be on offer: nothing to say on the other seat\'s turn', () => {
  const view = { phase: 'playing', active: 1, round: 2, seats: [{ owed_draws: 0, hand: 4, charged: 0, spent: 0, cells: [[], [], []] }, { life: 20 }] };
  for (const id of ['flip', 'cast', 'pass']) assert.equal(lessonFor(id, { view, near: 0, menu: [], hand: [] }).id, 'wait', id);
});

test('a round-3 resume while draws are owed is not the draw lesson again (JP: "then draw")', () => {
  const view = { phase: 'playing', active: 0, round: 3, seats: [{ owed_draws: 2, hand: 3, charged: 0, spent: 0, cells: [[], [], []] }, { life: 20 }] };
  const facts = factsFrom({ view, near: 0, history: historyFrom([{ key: 'd/4' }, { key: 'p' }]), placed: true });
  assert.ok(facts.drawn, 'the opening hand was drawn long ago');
  assert.notEqual(BEATS[firstUndone(facts)].id, 'draw');
  assert.equal(BEATS[firstUndone(facts)].id, 'flip');
});
