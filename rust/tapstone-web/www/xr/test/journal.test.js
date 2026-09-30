// Coming back (spec 2026-09-25 §3.5): the in-page arena's journal, in browser storage, in 0030's
// ledger shape (the match's transcript of taps plus the chain head). A reload mid-match resumes the
// same match, and the journal is never trusted: on load it is replayed through the wasm engine, and
// one that does not reproduce its own head, taps and menu keys is discarded for a fresh match.
// Run: node --test test/journal.test.js from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decode, journalStore, KEY, newJournal } from '../src/logic/journal.js';
import { tableFrom } from '../src/table.js';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = process.env.TAPSTONE_WASM ?? join(here, 'fixtures/tapstone_web.wasm');
const bytes = readFileSync(WASM);
// Every page load is a fresh wasm instance: nothing survives a reload except the storage.
const exportsOf = async () => (await WebAssembly.instantiate(bytes, {})).instance.exports;

// localStorage's surface, in memory. `writes` counts setItem calls.
function memoryStorage() {
  const m = new Map();
  const s = {
    writes: 0,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => (s.writes++, m.set(k, String(v))),
    removeItem: (k) => m.delete(k),
  };
  return s;
}

// The web gate's chooser at a page's frame rate. Stops after `taps` taps (a reload), or at the end.
function drive(t, { taps = Infinity, frameMs = 16 } = {}) {
  let n = 0;
  for (let frame = 0; frame < 100000 && !t.done() && n < taps; frame++) {
    t.advance(frameMs, () => {});
    const menu = t.choices();
    const i = menu.findIndex((m) => m.useful && m.kind !== 'Mulligan');
    if (i >= 0 && t.propose(i)) n++;
  }
  return n;
}

async function uninterrupted() {
  const t = tableFrom(await exportsOf(), 11, 0, journalStore(memoryStorage()));
  drive(t);
  assert.ok(t.done(), 'the uninterrupted match finished');
  return t.journal;
}

test('every accepted tap is in storage before propose returns (nothing half-applied)', async () => {
  const storage = memoryStorage();
  const t = tableFrom(await exportsOf(), 11, 0, journalStore(storage));
  let checked = 0;
  for (let frame = 0; frame < 100000 && !t.done() && checked < 10; frame++) {
    t.advance(16, () => {});
    const menu = t.choices();
    const i = menu.findIndex((m) => m.useful && m.kind !== 'Mulligan');
    if (i < 0) continue;
    assert.ok(t.propose(i));
    const saved = decode(storage.getItem(KEY));
    assert.ok(saved, 'the stored journal decodes');
    assert.equal(saved.taps.length, t.journal.taps.length, 'the tap is stored');
    assert.equal(saved.taps.at(-1).key, menu[i].key);
    checked++;
  }
  assert.equal(checked, 10);
});

test('a reload mid-match resumes the same match and ends with the same final head', async () => {
  const base = await uninterrupted();
  assert.ok(base.final, 'a final head');
  assert.ok(base.taps.length >= 20, `taps ${base.taps.length}`);
  // Reload at several points, including twice in one match (docs/verification.md: test the second).
  for (const cuts of [[1], [7], [Math.floor(base.taps.length / 2)], [base.taps.length - 1], [5, 12]]) {
    const storage = memoryStorage();
    let t = tableFrom(await exportsOf(), 11, 0, journalStore(storage));
    let made = 0;
    for (const cut of cuts) {
      made += drive(t, { taps: cut - made });
      const before = { ...t.journal, taps: [...t.journal.taps] };
      t = tableFrom(await exportsOf(), 11, 0, journalStore(storage)); // the reload
      assert.equal(t.resumed.from, 'journal', `cut ${cut}: resumed (${JSON.stringify(t.resumed)})`);
      assert.equal(t.resumed.taps, cut, `cut ${cut}: every tap replayed`);
      assert.equal(t.now(), before.clock, `cut ${cut}: the same clock`);
      assert.equal(t.journal.head, before.head, `cut ${cut}: the same head`);
      assert.ok(t.resumed.view, `cut ${cut}: the last view is handed to the page`);
      let first = null;
      t.advance(0, (v) => (first ??= v));
      assert.equal(first?.seq, before.seq, `cut ${cut}: the page is drawn from the resumed view first`);
    }
    drive(t);
    assert.ok(t.done(), `cuts ${cuts}: the resumed match finished`);
    assert.equal(t.journal.final, base.final, `cuts ${cuts}: the same final head`);
    assert.deepEqual(t.journal.taps.map((x) => x.key), base.taps.map((x) => x.key), `cuts ${cuts}: the same taps`);
  }
});

// A stored journal after 9 taps and a few frames more (so the 9th tap's commit is in the head), to
// tamper with.
async function stored9() {
  const storage = memoryStorage();
  const t = tableFrom(await exportsOf(), 11, 0, journalStore(storage));
  drive(t, { taps: 9 });
  for (let k = 0; k < 3; k++) t.advance(16, () => {});
  return JSON.parse(storage.getItem(KEY));
}

async function loadWith(j) {
  const storage = memoryStorage();
  storage.setItem(KEY, typeof j === 'string' ? j : JSON.stringify(j));
  const t = tableFrom(await exportsOf(), 11, 0, journalStore(storage));
  return { t, storage };
}

test('the untampered journal resumes (the control for every refusal below)', async () => {
  const { t } = await loadWith(await stored9());
  assert.equal(t.resumed.from, 'journal');
  assert.equal(t.resumed.taps, 9);
});

test('a tampered, corrupted or foreign journal is refused and the page starts fresh', async () => {
  const j = await stored9();
  const lastKey = j.taps.at(-1).key;
  const other = j.taps.find((x) => x.key !== lastKey).key;
  const cases = {
    'the head rewritten': { ...j, head: '0123456789abcdef' },
    'a tap swapped for another move': { ...j, taps: j.taps.map((x, k) => (k === 8 ? { ...x, key: other } : x)) },
    'the last tap dropped': { ...j, taps: j.taps.slice(0, 8) },
    'a middle tap dropped': { ...j, taps: j.taps.filter((_, k) => k !== 4) },
    'a tap moved to another menu item': { ...j, taps: j.taps.map((x, k) => (k === 8 ? { ...x, i: x.i + 1 } : x)) },
    'the clock rolled back past a tap': { ...j, clock: j.taps.at(-1).at - 10 },
    'another seed (a foreign match)': { ...j, seed: 12 },
    'another seat': { ...j, human: 1 },
    'another ruleset': { ...j, rules: 'tapstone-web/desk/0' },
    'a finished match': { ...j, over: true },
    'truncated JSON': JSON.stringify(j).slice(0, 200),
    'not JSON': 'hello',
    'an empty object': {},
    'a clock past any match': { ...j, clock: 1e12 },
  };
  for (const [name, bad] of Object.entries(cases)) {
    const { t, storage } = await loadWith(bad);
    assert.equal(t.resumed.from, 'fresh', `${name}: refused`);
    assert.ok(t.resumed.refused, `${name}: says why`);
    assert.equal(storage.getItem(KEY), null, `${name}: the bad journal is discarded`);
    assert.equal(t.now(), 0, `${name}: a fresh clock`);
    assert.equal(t.journal.taps.length, 0, `${name}: no taps carried over`);
    // Fresh means fresh: the same match an untouched page plays.
    drive(t, { taps: 3 });
    const clean = tableFrom(await exportsOf(), 11, 0, null);
    drive(clean, { taps: 3 });
    assert.equal(t.journal.head, clean.journal.head, `${name}: the fresh match is the clean one`);
  }
});

test('the ledger shape (0030): the transcript of taps plus the head', () => {
  const j = newJournal(11, 0);
  for (const f of ['v', 'rules', 'seed', 'human', 'match_id', 'clock', 'taps', 'seq', 'head', 'final', 'over']) assert.ok(f in j, f);
  assert.deepEqual(decode(JSON.stringify(j)), j, 'a fresh journal round-trips');
});
