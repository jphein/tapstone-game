// A whole match played through gestures only, on the real in-page arena (tapstone_web.wasm from
// Task R2): every move is chosen as the web gate chooses (the first useful non-mulligan item), turned
// into a gesture, matched back to the menu, and proposed. It proves hands can reach every move the
// engine offers, and that the hand the page shows is the one it plays from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { matchGesture, gestureForItem } from '../src/logic/menu.js';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = process.env.TAPSTONE_WASM ?? join(here, 'fixtures/tapstone_web.wasm');

async function openTable(seed, human) {
  const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {});
  const x = instance.exports;
  const read = (n) => new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.out_ptr(), n));
  x.table_new(BigInt(seed), human);
  return { x, read };
}

test('a whole match, every move made by a gesture, and the round trip exact', async () => {
  const { x, read } = await openTable(11, 0);
  let taps = 0, kinds = new Set();
  for (let s = 0n; s < 60000n; s++) {
    x.table_step(s * 10n);
    if (x.table_done()) break;
    const menu = JSON.parse(read(x.table_choices()));
    const i = menu.findIndex((m) => m.useful && m.kind !== 'Mulligan');
    if (i < 0) continue;
    const hand = JSON.parse(read(x.table_hand()));
    const g = gestureForItem(menu[i]);
    assert.ok(g, `no gesture for ${menu[i].kind}`);
    if (g.source === 'hand') assert.ok(hand.some((c) => c.card === g.card), `${menu[i].label}: the card is not in the shown hand`);
    const r = matchGesture(menu, g);
    // Round trip: the gesture picks an item with the same move (a repeated identical move may sit
    // earlier in the menu; the kind, card, lane and target must match).
    const picked = menu[r.index];
    assert.ok(picked, `${menu[i].label}: the gesture picked nothing (${JSON.stringify(r)})`);
    for (const f of ['kind', 'card', 'lane', 'target', 'aux']) assert.equal(picked[f], menu[i][f], `${menu[i].label}: ${f}`);
    // propose indexes the menu last returned by table_choices (hand() doesn't reset it).
    assert.ok(x.table_propose(r.index, s * 10n), `${picked.label} was refused`);
    taps++;
    kinds.add(picked.kind);
  }
  assert.ok(x.table_done(), 'the match finished');
  assert.ok(taps >= 20, `taps ${taps}`);
  for (const k of ['Draw', 'Charge', 'CastUnit', 'Advance']) assert.ok(kinds.has(k), `${k} was played by a gesture (${[...kinds]})`);
});
