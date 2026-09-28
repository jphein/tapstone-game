// The teahouse doors react to play (0039): a cast stirs the door of the CARD's faction, so a
// neutral card stirs the Hearthlands door (lead decision 2026-09-28), and a win stirs the winning
// seat's door (there is no neutral seat). Played on real engine output: the committed desk fixtures
// (seed 11, no neutral casts; seed 1, Tide casts Mend), which tests/fixture.rs keeps current.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CARD_FACTION, doorSigns, doorStep } from '../src/logic/doors.js';
import { DOORS } from '../src/logic/layout.js';
import { DOOR_LORE } from '../src/logic/lore.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../../../../..');
const DESK = join(ROOT, 'rust/tapstone-arena/web/fixtures/desk-seed11.jsonl');
const NEUTRAL = join(ROOT, 'rust/tapstone-arena/web/fixtures/desk-seed1.jsonl');

// game/cards/set1/*.toml, the one source of each card's faction (tools/compile_cards.py reads it too).
function set1() {
  const dir = join(ROOT, 'game/cards/set1');
  const out = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.toml'))) {
    const t = readFileSync(join(dir, f), 'utf8');
    out[t.match(/^name = "(.+)"$/m)[1]] = t.match(/^faction = "(.+)"$/m)[1];
  }
  return out;
}

const load = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function play(views, state = doorSigns()) {
  const counts = {};
  for (const v of views) for (const s of doorStep(state, v)) counts[`${s.kind} ${s.faction}`] = (counts[`${s.kind} ${s.faction}`] ?? 0) + 1;
  return counts;
}

// Neutral casts counted straight from the views' own records and the TOML, not through doors.js.
function neutralCasts(views, cards) {
  const seen = new Set();
  for (const v of views) {
    const b = v.phase === 'lobby' && !v.lobby.length && v.last_over ? v.last_over : v;
    const l = b.last;
    if (l && (l.kind === 'CastUnit' || l.kind === 'CastSpell') && cards[l.card] === 'neutral') seen.add(`${b.match_id}:${l.seq}`);
  }
  return seen.size;
}

test('every set 1 card has its TOML faction, and nothing else is listed (fails closed both ways)', () => {
  assert.deepEqual(CARD_FACTION, set1());
});

test('the Hearthlands door is the neutral door, a realm door with its own lore', () => {
  const door = DOORS.find((d) => d.faction === 'neutral');
  assert.ok(door, 'a neutral door');
  assert.equal(DOOR_LORE.neutral.name, 'The Hearthlands');
  for (const f of new Set(Object.values(CARD_FACTION))) assert.ok(DOORS.some((d) => d.faction === f), `${f} cards have a door to stir`);
});

test('the desk fixture (seed 11): Ember 4 casts, Tide 6, Tide wins once, the same as the Roblox tea house', () => {
  const views = load(DESK);
  assert.deepEqual(play(views), { 'cast ember': 4, 'cast tide': 6, 'win tide': 1 });
});

test("the neutral fixture (seed 1): Tide's Mend stirs the Hearthlands door, and the win stays Ember's", () => {
  const views = load(NEUTRAL);
  const want = neutralCasts(views, set1());
  assert.ok(want >= 1, `seed 1 has neutral casts to see (${want})`);
  const c = play(views);
  assert.equal(c['cast neutral'], want, JSON.stringify(c));
  // The same counts the Roblox tea house pins (roblox/tests/teahouse.luau).
  assert.deepEqual(c, { 'cast ember': 4, 'cast tide': 5, 'cast neutral': 1, 'win ember': 1 });
  // The second of anything: the same match again under another id stirs its doors again.
  const state = doorSigns();
  play(views, state);
  const again = views.map((v) => ({ ...v, match_id: v.match_id && 'second', last_over: v.last_over && { ...v.last_over, match_id: 'second' } }));
  assert.deepEqual(play(again, state), c);
});

test('the first view only primes, and a repeated view stirs nothing', () => {
  const views = load(DESK);
  const cast = views.findIndex((v) => v.last && v.last.kind === 'CastUnit');
  const late = doorSigns();
  assert.deepEqual(doorStep(late, views[cast]), [], 'joining on a cast replays nothing');
  const s = doorSigns();
  doorStep(s, views[0]);
  assert.equal(doorStep(s, views[cast]).length, 1);
  assert.deepEqual(doorStep(s, views[cast]), [], 'the same view again');
});
