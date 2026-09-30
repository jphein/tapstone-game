// The guide's brain on the real in-page arena (guide v2): a fresh match and JP's resumed round-3 match,
// every spoken lesson held to contradicts(). The perturbation to try: tick() without beats.sync().
// Run: node --test test/guide.test.js from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tableFrom } from '../src/table.js';
import { journalStore } from '../src/logic/journal.js';
import { gestureOf } from '../src/logic/first-five.js';
import { Guide } from '../src/guide/guide.js';

const here = dirname(fileURLToPath(import.meta.url));
const bytes = readFileSync(process.env.TAPSTONE_WASM ?? join(here, 'fixtures/tapstone_web.wasm'));
const exportsOf = async () => (await WebAssembly.instantiate(bytes, {})).instance.exports;
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// Play `t` as a learner who follows the guide (the demo's move when there is one, else the web gate's).
function follow(t, guide, { frames = 20000, until = () => false, start = 0, view: v0 = null } = {}) {
  let view = v0, now = start;
  for (let frame = 0; frame < frames && !t.done() && !until(view); frame++, now += 16) {
    t.advance(16, (v) => (view = v));
    if (frame === 2) guide.gesture('place', now);
    const menu = t.choices(), hand = t.hand();
    const { lesson } = guide.tick({ view, near: 0, menu, hand }, now);
    if (lesson.id === 'claim') guide.gesture('claim', now);
    if (['place', 'claim'].includes(lesson.id)) continue;
    const want = { draw: 'Draw', flip: 'Charge', mana: 'Charge', pass: 'Pass', cast: 'CastUnit' }[lesson.id];
    let i = want ? menu.findIndex((m) => m.kind === want) : -1;
    if (i < 0) i = menu.findIndex((m) => m.useful && m.kind !== 'Mulligan');
    if (i >= 0 && t.propose(i)) guide.gesture(gestureOf(menu[i]), now);
  }
  return view;
}

test('a fresh match: the lessons come in order, each said once, none contradicting the state', async () => {
  const t = tableFrom(await exportsOf(), 11, 0, null);
  const g = new Guide();
  g.start(0);
  follow(t, g);
  assert.ok(t.done());
  assert.deepEqual(g.log.filter((l) => l.why), [], 'no contradiction');
  const ids = g.log.map((l) => l.id);
  const firsts = ['claim', 'draw', 'flip', 'cast', 'pass'].map((id) => ids.indexOf(id));
  assert.ok(firsts.every((i) => i >= 0), `every teaching beat spoken (${ids})`);
  assert.deepEqual([...firsts].sort((a, b) => a - b), firsts, `in order (${ids})`);
  assert.equal(ids.filter((id) => id === 'claim').length, 1, 'claim once');
});

test("JP's resume: round 3, never charged — the first thing the guide says is how to charge", async () => {
  const storage = memoryStorage();
  const t = tableFrom(await exportsOf(), 11, 0, journalStore(storage));
  let view = null;
  for (let frame = 0; frame < 20000 && !t.done(); frame++) {
    t.advance(16, (v) => (view = v));
    const menu = t.choices();
    if (view?.round >= 3 && view.active === 0 && view.seats[0].owed_draws === 0 && menu.some((m) => m.kind === 'Charge')) break;
    const i = menu.findIndex((m) => m.useful && !['Mulligan', 'Charge', 'CastUnit', 'CastSpell'].includes(m.kind));
    if (i >= 0) t.propose(i);
  }
  const back = tableFrom(await exportsOf(), 11, 0, journalStore(storage));
  const g = new Guide();
  g.start(0);
  g.resume(back.journal.taps);
  g.gesture('place', 0); // the headset places the board on entry
  const first = back.resumed.view;
  back.advance(0, () => {}); // hand the resumed view over, as play.js's first frame does
  g.tick({ view: first, near: 0, menu: back.choices(), hand: back.hand() }, 16);
  assert.equal(g.log[0]?.id, 'flip', `first lesson ${JSON.stringify(g.log[0])}`);
  follow(back, g, { start: 32, view: first });
  const ids = g.log.map((l) => l.id);
  assert.ok(!ids.includes('claim') && !ids.includes('draw'), `never back to claim or draw (${ids})`);
  assert.deepEqual(g.log.filter((l) => l.why), [], 'no contradiction');
});

test("#200's first-run offer comes first: the guide says nothing and moves no beat until it is answered", () => {
  const g = new Guide();
  g.start(0);
  const view = { phase: 'playing', active: 0, round: 1, seats: [{ owed_draws: 5, hand: 0, charged: 0, spent: 0, cells: [[], [], []] }, { life: 20 }] };
  for (let t = 0; t < 60000; t += 500) assert.equal(g.tick({ view, near: 0, menu: [{ kind: 'Draw' }], hand: [], ready: false }, t).say, null, `quiet at ${t} ms`);
  assert.equal(g.log.length, 0);
  assert.equal(g.beats.beat.id, 'place', 'no beat moved on while the offer waited (the watching beats run on clocks)');
  assert.equal(g.tick({ view, near: 0, menu: [{ kind: 'Draw' }], hand: [], ready: true }, 60000).say, 'Set the stone on your table.', 'answered: it starts');
});
