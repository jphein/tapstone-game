// The hand cards' painted art (0014): one WebP per set 1 card in public/cards/, fetched during load.
// Run: node --test test/card-art.test.js from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FACE, SET1_IDS, artFile, artSize } from '../src/logic/card-art.js';

const here = dirname(fileURLToPath(import.meta.url));
const SET1 = join(here, '../../../../../game/cards/set1');
const PUBLIC = join(here, '../public');

// A lossy (VP8) or lossless (VP8L) WebP's pixel size, from its header.
function webpSize(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
  throw new Error(`unknown WebP chunk ${kind}`);
}

test('SET1_IDS is every card file in game/cards/set1', () => {
  const ids = readdirSync(SET1)
    .filter((f) => f.endsWith('.toml'))
    .map((f) => Number(/^id = "st1-(\d{3})"$/m.exec(readFileSync(join(SET1, f), 'utf8'))[1]))
    .sort((a, b) => a - b);
  assert.deepEqual(SET1_IDS, ids);
});

test('artFile names the card by its set id', () => {
  assert.equal(artFile(2), 'cards/st1-002.webp');
  assert.equal(artFile(13), 'cards/st1-013.webp');
});

test('the art window sits inside the face, above the name', () => {
  const a = FACE.art;
  assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= FACE.w && a.y + a.h <= FACE.h);
  assert.ok(a.y + a.h < FACE.nameY - 26, 'the name line clears the art');
});

// The cards with no painting yet (#147: the art waits for JP's OK), from the one list tools/card_art.py
// also reads. Both directions fail closed: a listed card with a WebP, or an unlisted card without one.
const AWAITING = (() => {
  const text = readFileSync(join(here, '../../../../../game/cards/awaiting-art.toml'), 'utf8');
  const m = /^set1 = \[([^\]]*)\]$/m.exec(text);
  if (!m) throw new Error('awaiting-art.toml has no set1 = [...] line'); // unparsed fails closed
  const ids = new Set([...m[1].matchAll(/"st1-(\d{3})"/g)].map((x) => Number(x[1])));
  // Every quoted entry is an st1 id: a malformed entry can't silently drop out of the set.
  if ((m[1].match(/"/g) ?? []).length !== ids.size * 2) throw new Error(`awaiting-art.toml set1 has a malformed entry: ${m[1]}`);
  return ids;
})();

test('awaiting-art.toml names set 1 cards, and exactly the ones without a WebP', () => {
  // An empty list is the end state: every card has its painting (the six from #166 landed 2026-09-28).
  for (const id of AWAITING) assert.ok(SET1_IDS.includes(id), `st1-${id} is not in set 1`);
  for (const id of SET1_IDS) {
    assert.equal(existsSync(join(PUBLIC, artFile(id))), !AWAITING.has(id), artFile(id));
  }
});

test('every card not awaiting art has its WebP: within 80 KB (80,000 bytes), at twice the art window', () => {
  const want = artSize();
  assert.deepEqual(want, { w: FACE.art.w * 2, h: FACE.art.h * 2 });
  for (const id of SET1_IDS.filter((i) => !AWAITING.has(i))) {
    const p = join(PUBLIC, artFile(id));
    assert.ok(statSync(p).size <= 80_000, `${p} is ${statSync(p).size} B`);
    assert.deepEqual(webpSize(readFileSync(p)), want, p);
  }
});
