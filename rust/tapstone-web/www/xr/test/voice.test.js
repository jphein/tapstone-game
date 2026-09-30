// The voice lookup's tests (src/logic/voice.js), and the clip set's coverage of what the headset
// actually says: `node --test test/` from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VoiceIndex, VoiceLine } from '../src/logic/voice.js';
import { PUT_DOWN } from '../src/guard.js';

const here = dirname(fileURLToPath(import.meta.url));
const XR = join(here, '..');
const VOICE = join(XR, 'public/voice');
const manifest = JSON.parse(readFileSync(join(VOICE, 'manifest.json'), 'utf8'));
const index = new VoiceIndex(manifest);

const tiny = { lines: [{ id: 'your-move', text: 'Your move.', file: 'your-move.webm' }, { id: 'lobby', text: 'Setting the table…', file: 'lobby.webm' }] };

test('a line whose text matches exactly has its clip', () => {
  const v = new VoiceIndex(tiny);
  assert.equal(v.clipFor('Your move.'), 'your-move.webm');
  assert.equal(v.clipFor('Setting the table…'), 'lobby.webm');
  assert.equal(v.size, 2);
});

test('anything else has none, and the caller keeps its text-only behaviour', () => {
  const v = new VoiceIndex(tiny);
  for (const t of ['Your move', 'your move.', 'Your move. ', ' Your move.', 'Setting the table...', '', undefined, null, 7, 'Beat one: draw your first card.']) {
    assert.equal(v.clipFor(t), null, JSON.stringify(t));
  }
});

test('no manifest (a build without clips, or a failed fetch) answers null for every line', () => {
  for (const m of [undefined, null, {}, { lines: [] }]) {
    const v = new VoiceIndex(m);
    assert.equal(v.size, 0);
    assert.equal(v.clipFor('Your move.'), null);
  }
});

test('a file is resolved against the base the page is served from', () => {
  const v = new VoiceIndex(tiny);
  assert.equal(v.urlFor('Your move.', '/xr/'), '/xr/voice/your-move.webm');
  assert.equal(v.urlFor('No such line.', '/xr/'), null);
});

test('the voice line speaks a clip once, not again on every view that repeats it', () => {
  const line = new VoiceLine(new VoiceIndex(tiny));
  assert.equal(line.next('Your move.'), 'your-move.webm');
  assert.equal(line.next('Your move.'), null, 'the same sentence again is only redrawn');
  assert.equal(line.next('A dynamic label with no clip.'), null);
  assert.equal(line.next('Your move.'), 'your-move.webm', 'a different line in between: say it again');
});

test('a refusal is spoken again even when it repeats', () => {
  const line = new VoiceLine(new VoiceIndex(tiny));
  assert.equal(line.next('Your move.', { force: true }), 'your-move.webm');
  assert.equal(line.next('Your move.', { force: true }), 'your-move.webm');
});

test('an empty line clears, so the next line is spoken', () => {
  const line = new VoiceLine(new VoiceIndex(tiny));
  line.next('Your move.');
  assert.equal(line.next(''), null);
  assert.equal(line.next('Your move.'), 'your-move.webm');
});

// ---- the committed clip set ------------------------------------------------------------------

// Every sentence-shaped string literal in the files the headset speaks from. Template literals
// (`${card.name}: …`, `Draw ${n}: …`) are expanded below from their own sources instead.
const SPOKEN_FROM = ['src/play.js', 'src/guard.js', 'src/logic/menu.js', 'src/logic/first-five.js', 'src/guide/lesson.js'];
function sentences(file) {
  const src = readFileSync(join(XR, file), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const out = [];
  const re = /(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  for (let m; (m = re.exec(src));) {
    const t = m[2].replace(/\\(.)/g, '$1');
    if (/^[A-Z].*[.…?!]$/.test(t)) out.push(t);
  }
  return out;
}

test('every fixed sentence the headset says has a clip', () => {
  const said = SPOKEN_FROM.flatMap((f) => sentences(f).map((t) => [f, t]));
  // A floor: a scan that finds nothing would pass having checked nothing.
  assert.ok(said.length >= 23, `only ${said.length} sentences found`);
  assert.ok(said.some(([, t]) => t === PUT_DOWN), 'the scan sees guard.js');
  const missing = said.filter(([, t]) => index.clipFor(t) === null);
  assert.deepEqual(missing, [], 'add these to game/voice/headset.toml and run tools/voice_lines.py');
});

test("every set 1 card a hand can hold has its 'touch a pad' clip (play.js lift())", () => {
  const dir = join(XR, '../../../../game/cards/set1');
  const names = readdirSync(dir).filter((f) => f.endsWith('.toml')).map((f) => readFileSync(join(dir, f), 'utf8'))
    .filter((s) => !/^type = "castle"/m.test(s)).map((s) => s.match(/^name = "(.*)"/m)[1]);
  assert.equal(names.length, 18); // set 1 since #147: 18 playable designs, plus the two castles
  for (const n of names) assert.ok(index.clipFor(`${n}: touch a pad.`), n);
});

test('every owed draw up to the opening five has its clip (play.js voiceFor())', () => {
  for (let n = 1; n <= 5; n++) assert.ok(index.clipFor(`Draw ${n}: touch the top card of your deck to the stone.`), `Draw ${n}`);
});

test('every clip in the manifest is on disk at its recorded size, and nothing else is', () => {
  const listed = new Set(manifest.lines.map((e) => e.file));
  for (const e of manifest.lines) {
    const p = join(VOICE, e.file);
    assert.ok(existsSync(p), e.file);
    assert.equal(statSync(p).size, e.bytes, e.file);
  }
  const stray = readdirSync(VOICE).filter((f) => f !== 'manifest.json' && !listed.has(f));
  assert.deepEqual(stray, []);
  assert.equal(index.size, manifest.lines.length, 'texts are unique');
});
