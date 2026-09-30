// Voice commands (src/logic/voice-commands.js): the grammar the keyword spotter listens for, how a
// heard phrase becomes the same gesture a hand makes, and a whole match played by voice alone on the
// real in-page arena (tapstone_web.wasm), as match.test.js plays one by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CARDS, HELP, heardText, parse, phrases, resolve, tagOf, voiceForItem } from '../src/logic/voice-commands.js';
import { CASTLE_TARGET, matchGesture } from '../src/logic/menu.js';

const here = dirname(fileURLToPath(import.meta.url));
const XR = join(here, '..');
const WASM = process.env.TAPSTONE_WASM ?? join(here, 'fixtures/tapstone_web.wasm');

test('the card list is set 1: every playable design, spelled as the TOML spells it', () => {
  const dir = join(XR, '../../../../game/cards/set1');
  const designs = readdirSync(dir).filter((f) => f.endsWith('.toml')).map((f) => readFileSync(join(dir, f), 'utf8'))
    .filter((s) => !/^type = "castle"/m.test(s))
    .map((s) => ({ name: s.match(/^name = "(.*)"/m)[1], kind: s.match(/^type = "(.*)"/m)[1] }));
  assert.equal(designs.length, 18);
  assert.deepEqual(CARDS.map(({ name, kind }) => ({ name, kind })).sort((a, b) => a.name.localeCompare(b.name)), designs.sort((a, b) => a.name.localeCompare(b.name)));
});

test('the brief\'s commands parse, in any case, with punctuation and a please', () => {
  assert.deepEqual(parse('draw'), { verb: 'draw' });
  assert.deepEqual(parse('End turn.'), { verb: 'pass' });
  assert.deepEqual(parse('pass turn'), { verb: 'pass' });
  assert.deepEqual(parse('mulligan'), { verb: 'mulligan' });
  assert.deepEqual(parse('claim'), { verb: 'claim' });
  assert.deepEqual(parse('Summon Cinder Whelp in lane two, please'), { verb: 'summon', card: 'Cinder Whelp', lane: 1 });
  assert.deepEqual(parse('summon forge runner in the left lane'), { verb: 'summon', card: 'Forge Runner', lane: 0 });
  assert.deepEqual(parse('advance the middle lane'), { verb: 'advance', lane: 1 });
  assert.deepEqual(parse('advance lane three'), { verb: 'advance', lane: 2 });
  assert.deepEqual(parse('charge tidal lash'), { verb: 'charge', card: 'Tidal Lash' });
  assert.deepEqual(parse('charge card two'), { verb: 'charge', slot: 1 });
  assert.deepEqual(parse('cast flare at the castle'), { verb: 'cast', card: 'Flare', at: { castle: true } });
  assert.deepEqual(parse('cast riptide at trench leviathan'), { verb: 'cast', card: 'Riptide', at: { unit: 'Trench Leviathan' } });
  assert.deepEqual(parse('cast mend at lane one'), { verb: 'cast', card: 'Mend', at: { lane: 0 } });
  assert.deepEqual(parse('cast deep breath'), { verb: 'cast', card: 'Deep Breath', at: null });
  assert.deepEqual(parse('target three'), { verb: 'pick', option: 2 });
  assert.deepEqual(parse('high contrast on'), { verb: 'set', key: 'highContrast', value: true });
  assert.deepEqual(parse('stop listening'), { verb: 'mic', on: false });
  assert.deepEqual(parse('summon tide caller in lane one'), { verb: 'summon', card: 'Tidecaller', lane: 0 }, 'the split spelling the spotter hears');
});

test('anything off the grammar is nothing, not a guess', () => {
  for (const t of ['pass', 'can you pass me the tea', 'summon', 'cast flare', 'lane two', '', null, 7, 'summon cinder whelp in lane four']) {
    assert.equal(parse(t), null, JSON.stringify(t));
  }
});

test('no phrase is a prefix of another phrase (a spotter reports the prefix first)', () => {
  const all = phrases().map((p) => p.text);
  const set = new Set(all);
  for (const t of all) {
    const words = t.split(' ');
    for (let n = 1; n < words.length; n++) assert.ok(!set.has(words.slice(0, n).join(' ')), `"${words.slice(0, n).join(' ')}" is a prefix of "${t}"`);
  }
});

test('phrases and tags round-trip, and every set 1 card can be summoned or cast, and charged', () => {
  const all = phrases();
  assert.ok(all.length > 1000, `${all.length} phrases`);
  for (const p of all) assert.deepEqual(parse(tagOf(p.text)), p.intent, p.text);
  for (const c of CARDS) {
    assert.ok(all.some((p) => p.intent.verb === 'charge' && p.intent.card === c.name), `charge ${c.name}`);
    const verb = c.kind === 'unit' ? 'summon' : 'cast';
    assert.ok(all.some((p) => p.intent.verb === verb && p.intent.card === c.name), `${verb} ${c.name}`);
  }
});

test('the keyword file lists every phrase once, and nothing else (tools/voice_keywords.py)', () => {
  const lines = readFileSync(join(XR, 'public/kws/keywords.txt'), 'utf8').trim().split('\n');
  const tags = lines.map((l) => l.split(' @')[1]);
  assert.deepEqual(tags.slice().sort(), phrases().map((p) => tagOf(p.text)).sort(), 'rerun tools/voice_keywords.py');
  const tokens = new Set(readFileSync(join(XR, 'public/kws/tokens.txt'), 'utf8').trim().split('\n').map((l) => l.split(' ')[0]));
  // Word pieces, then optionally a phrase's own boost and threshold (":3.0 #0.02").
  for (const l of lines) for (const tok of l.split(' @')[0].split(' ').filter((t) => !/^[:#][0-9.]+$/.test(t))) assert.ok(tokens.has(tok), `${tok} in ${l}`);
  for (const l of lines) {
    const short = l.split(' @')[1].split('_').length <= 2;
    assert.equal(/ :[0-9.]+ #[0-9.]+ @/.test(l), short, `a short phrase, and only a short phrase, has its own boost: ${l}`);
  }
});

const hand = [{ card: 2, name: 'Cinder Whelp' }, { card: 5, name: 'Flare' }, { card: 11, name: 'Deep Breath' }];

test('a resolved command is the same gesture a hand makes', () => {
  assert.deepEqual(resolve(parse('draw')), { gesture: { source: 'deck' } });
  assert.deepEqual(resolve(parse('end turn')), { gesture: { source: 'castle', action: 'pass' } });
  assert.deepEqual(resolve(parse('advance lane one')), { gesture: { source: 'lane', pad: 0 } });
  assert.deepEqual(resolve(parse('summon cinder whelp in lane three'), { hand }), { gesture: { source: 'hand', card: 2, face: 'up', pad: 2 } });
  assert.deepEqual(resolve(parse('charge flare'), { hand }), { gesture: { source: 'hand', card: 5, face: 'down', pad: 0 } });
  assert.deepEqual(resolve(parse('charge card one'), { hand }), { gesture: { source: 'hand', card: 2, face: 'down', pad: 0 } });
  assert.deepEqual(resolve(parse('cast deep breath'), { hand }), { gesture: { source: 'hand', card: 11, face: 'up', pad: 1 } });
  assert.match(resolve(parse('summon slag brute in lane one'), { hand }).refused, /No Slag Brute/);
  assert.match(resolve(parse('charge card eight'), { hand }).refused, /no card 8/);
});

test("a spell's spoken target narrows the engine's targets: one fits, several are offered, none is refused", () => {
  const menu = [
    { kind: 'CastSpell', card: 5, target: CASTLE_TARGET, aux: 0, label: 'Cast Flare at the enemy castle' },
    { kind: 'CastSpell', card: 5, target: (1 << 4) | (0 << 2) | 2, aux: 0, label: 'Cast Flare at seat 1 lane 0 front (Reef Archer)' },
    { kind: 'CastSpell', card: 5, target: (1 << 4) | (0 << 2) | 1, aux: 0, label: 'Cast Flare at seat 1 lane 0 mid (Tidecaller)' },
  ];
  assert.deepEqual(resolve(parse('cast flare at the castle'), { menu, hand }).gesture, { source: 'hand', card: 5, face: 'up', pad: 1, target: CASTLE_TARGET, aux: 0 });
  assert.equal(resolve(parse('cast flare at reef archer'), { menu, hand }).gesture.target, menu[1].target);
  assert.deepEqual(resolve(parse('cast flare at lane one'), { menu, hand }).choose.map((o) => o.index), [1, 2]);
  assert.match(resolve(parse('cast flare at lane three'), { menu, hand }).refused, /can't reach/);
  // The resolved gesture is one matchGesture picks directly.
  assert.equal(matchGesture(menu, resolve(parse('cast flare at the castle'), { menu, hand }).gesture).index, 0);
});

test('what was heard is captioned with the lane as spoken and its side', () => {
  assert.equal(heardText(parse('summon cinder whelp in lane two')), 'Heard: summon Cinder Whelp in lane 2 (middle).');
  assert.equal(heardText(parse('advance the left lane')), 'Heard: advance lane 1 (left).');
  assert.equal(heardText(parse('cast flare at the castle')), 'Heard: cast Flare at the castle.');
  assert.equal(heardText(null), '');
  assert.ok(HELP.length < 200, 'the help fits the band');
});

// ---- a whole match by voice, on the real arena --------------------------------------------------

async function openTable(seed, human) {
  const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {});
  const x = instance.exports;
  const read = (n) => new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.out_ptr(), n));
  x.table_new(BigInt(seed), human);
  return { x, read };
}

// The menu index that saying `said` (phrases in order) picks, as play.js would: resolve, then
// matchGesture, then a prompt pick for "target <n>".
function spoken(said, menu, hand) {
  let offered = null;
  for (const text of said) {
    const r = resolve(parse(text), { menu, hand });
    if (r.pick !== undefined) return offered?.[r.pick]?.index;
    if (r.choose) {
      offered = r.choose;
      continue;
    }
    if (!r.gesture) return undefined;
    const m = matchGesture(menu, r.gesture);
    if (m.index !== undefined) return m.index;
    if (m.need === 'target') offered = m.options;
    else return undefined;
  }
  return undefined;
}

// The same move. Every Draw is one move: the menu names the card each would draw, but a draw takes
// the deck's top card whichever item is picked (a hand touching the deck can't choose either).
const same = (a, b) => (a.kind === 'Draw' && b.kind === 'Draw') || ['kind', 'card', 'lane', 'target', 'aux'].every((f) => a[f] === b[f]);

test('voice can play every move: a whole match by voice, and every menu item at every step reachable', async () => {
  const { x, read } = await openTable(11, 0);
  let taps = 0, checked = 0;
  const kinds = new Set();
  for (let s = 0n; s < 60000n; s++) {
    x.table_step(s * 10n);
    if (x.table_done()) break;
    const menu = JSON.parse(read(x.table_choices()));
    if (!menu.length) continue;
    const hand = JSON.parse(read(x.table_hand()));
    for (const m of menu) {
      const said = voiceForItem(m, menu, hand);
      assert.ok(said, `no phrase for ${m.kind}`);
      for (const t of said) assert.ok(parse(t), `"${t}" is off the grammar`);
      const k = spoken(said, menu, hand);
      assert.ok(k !== undefined && same(menu[k], m), `${m.label}: saying ${JSON.stringify(said)} picked ${k === undefined ? 'nothing' : menu[k].label}`);
      checked++;
    }
    const i = menu.findIndex((m) => m.useful && m.kind !== 'Mulligan');
    if (i < 0) continue;
    const k = spoken(voiceForItem(menu[i], menu, hand), menu, hand);
    assert.ok(x.table_propose(k, s * 10n), `${menu[k].label} was refused`);
    taps++;
    kinds.add(menu[k].kind);
  }
  assert.ok(x.table_done(), 'the match finished');
  assert.ok(taps >= 20, `taps ${taps}`);
  assert.ok(checked > taps * 3, `checked ${checked} items`);
  for (const k of ['Draw', 'Charge', 'CastUnit', 'Advance', 'Pass']) assert.ok(kinds.has(k), `${k} was played by voice (${[...kinds]})`);
});
