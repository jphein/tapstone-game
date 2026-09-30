// Accessibility (VR spec 2026-09-25 §3.2 "Voice and contrast", §5 MVP 9): a seated mode, a
// left-handed option, captions of the voice line always on, and a reduced-motion switch for the
// effects. src/logic/access.js; run: node --test test/access.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ACCESS_DEFAULTS, readAccess, sides, seatedDrift, replaceDrift, shouldReplace, motion, DRIFT_CAP, SETTLE } from '../src/logic/access.js';
import { essentials, offGaze, padCenter, defaultHead, DECK } from '../src/logic/layout.js';
import { DURATION } from '../src/logic/effects.js';

const here = dirname(fileURLToPath(import.meta.url));
const XR = join(here, '..');

// The layout test's budget (test/layout.test.js), applied to any head and any settings.
const fits = (head, a) => Object.values(essentials(a)).every((p) => {
  const g = offGaze(p, head);
  return Math.abs(g.yaw) <= 32 && Math.abs(g.pitch) <= 30;
});
const reachOk = (head) => [0, 1, 2].every((l) => {
  const p = padCenter(l);
  return Math.hypot(p.x - head.x, p.y - head.y, p.z - head.z) <= 0.51;
});

test('settings: defaults, the URL, what was stored, and the system reduced-motion preference', () => {
  assert.deepEqual(readAccess({}), { ...ACCESS_DEFAULTS, captions: true });
  assert.equal(ACCESS_DEFAULTS.seated, false);
  const u = readAccess({ search: '?seated=1&hand=left&motion=reduce' });
  assert.deepEqual([u.seated, u.leftHanded, u.reducedMotion], [true, true, true]);
  const s = readAccess({ stored: JSON.stringify({ seated: true, leftHanded: false }) });
  assert.deepEqual([s.seated, s.leftHanded], [true, false]);
  assert.equal(readAccess({ prefersReducedMotion: true }).reducedMotion, true, 'the system preference is the default');
  assert.equal(readAccess({ prefersReducedMotion: true, search: '?motion=full' }).reducedMotion, false, 'an explicit switch beats it');
  assert.equal(readAccess({ stored: JSON.stringify({ seated: true }), search: '?seated=0' }).seated, false, 'the URL beats what was stored');
  assert.deepEqual(readAccess({ stored: '{not json' }), { ...ACCESS_DEFAULTS, captions: true }, 'a corrupt store is ignored');
  assert.equal(readAccess({ stored: JSON.stringify({ seated: 'yes' }) }).seated, false, 'only booleans are read');
});

test('captions are always on: no setting, stored or in the URL, turns the voice band off', () => {
  for (const x of [{}, { search: '?captions=0' }, { stored: JSON.stringify({ captions: false }) }]) assert.equal(readAccess(x).captions, true);
  assert.ok(!('captions' in ACCESS_DEFAULTS), 'captions are not a setting at all');
});

test('captions are the band: the only place a line is spoken draws it first', () => {
  // Every speaker.say in the page goes through Altar.say (or attach(), which speaks the line
  // already drawn); Altar.say draws the band before it speaks, whatever the speaker does.
  const src = (f) => readFileSync(join(XR, f), 'utf8');
  const files = ['src/play.js', 'src/effects-player.js', 'src/teahouse.js', 'src/hand.js', 'src/board.js', 'src/index.js', 'src/guard.js', 'src/sfx.js'];
  for (const f of files) assert.ok(!/speaker\??\.say\(/.test(src(f)), `${f} speaks without the band`);
  const altar = src('src/altar.js');
  const say = altar.match(/\n {2}say\(text, opts\) \{\n([\s\S]*?)\n {2}\}/);
  assert.ok(say, 'Altar.say found');
  const draw = say[1].indexOf('this.voice.draw(text'), speak = say[1].indexOf('this.speaker?.say(text');
  assert.ok(draw >= 0 && speak > draw, 'Altar.say draws the band, then speaks');
  assert.equal((altar.match(/speaker\??\.say\(/g) ?? []).length, 2, 'say() and attach() are the only speakers');
  assert.ok(/attach\(speaker\) \{[\s\S]*?if \(this\.line\) speaker\.say\(this\.line\)/.test(altar), 'attach() speaks only the line on the band');
});

test('left-handed: the deck and the castle card swap ends; the lanes and pads do not move', () => {
  const r = sides(readAccess({})), l = sides(readAccess({ search: '?hand=left' }));
  assert.equal(r.deck.x, DECK.x, 'right-handed: the deck at the altar\'s right end');
  assert.equal(r.castle.x, -DECK.x);
  assert.equal(l.deck.x, -DECK.x, 'left-handed: the deck at the left end');
  assert.equal(l.castle.x, DECK.x);
  assert.equal(l.deck.z, r.deck.z);
  const e = essentials(readAccess({ search: '?hand=left' }));
  assert.equal(e.deck.x, -DECK.x, 'the FoV budget sees the deck where it is drawn');
  for (let k = 0; k < 3; k++) assert.deepEqual(e[`pad ${k}`], padCenter(k), 'lane N is still pad N');
  assert.ok(fits(defaultHead(), readAccess({ search: '?hand=left' })), 'left-handed fits the FoV budget');
});

test('seated: the layout\'s vertical slack is derived from the budgets, not typed', () => {
  const a = readAccess({ search: '?seated=1' });
  const d = seatedDrift(a);
  const h = defaultHead();
  const ok = (dy) => { const head = { ...h, y: h.y + dy }; return fits(head, a) && reachOk(head); };
  // Up: the edge, to 1 mm, where the reach gives out.
  assert.ok(d.up > 0 && ok(d.up), `up ${d.up} holds`);
  assert.ok(!ok(d.up + 0.001), `up ${d.up} is the edge, not a guess inside it`);
  // Down: the budgets hold to the cap (they re-aim the gaze, so they cannot see a board near eye
  // level); the slack there is the cap, and the cap is said to be one.
  assert.equal(d.down, DRIFT_CAP);
  assert.ok(ok(-DRIFT_CAP));
  // The re-place drift: the tighter slack, floored at the settle band (the noise a settled head has).
  assert.equal(replaceDrift(a), Math.max(SETTLE.band, Math.min(d.up, d.down)));
  // The measured figures the source comments quote (a number in a document is not a measurement
  // unless something measured it): up 5 mm, reach headroom 4 mm.
  assert.equal(d.up, 0.005);
  const reach = Math.max(...[0, 1, 2].map((l) => { const p = padCenter(l); return Math.hypot(p.x - h.x, p.y - h.y, p.z - h.z); }));
  assert.equal(Math.round((0.51 - reach) * 1000), 4);
});

test('seated: a settled head past the drift re-places the table; standing never does', () => {
  const seated = readAccess({ search: '?seated=1' }), standing = readAccess({});
  const d = replaceDrift(seated);
  const y0 = 1.2;
  // A head that has settled (a second of samples within the settle band) at height y.
  const settled = (y) => Array.from({ length: 30 }, (_, k) => ({ t: k * 35, y: y + (k % 2) * 0.005 }));
  assert.equal(shouldReplace(seated, y0, settled(y0 - 0.45)), true, 'sat down after the first frame: place again');
  assert.equal(shouldReplace(seated, y0, settled(y0 - d - 0.01)), true, 'past the drift, down');
  assert.equal(shouldReplace(seated, y0, settled(y0 + d + 0.01)), true, 'past the drift, up');
  assert.equal(shouldReplace(seated, y0, settled(y0 - d + 0.01)), false, 'inside the drift: leave it');
  assert.equal(shouldReplace(standing, y0, settled(y0 - 0.45)), false, 'standing mode never moves the table');
  // A head still moving (leaning to reach a pad) is not a new seat.
  const moving = Array.from({ length: 30 }, (_, k) => ({ t: k * 35, y: y0 - (k / 29) * 0.2 }));
  assert.equal(shouldReplace(seated, y0, moving), false, 'not settled');
  assert.equal(shouldReplace(seated, y0, settled(y0 - 0.45).slice(0, 5)), false, 'under a second of samples');
});

test('reduced motion: an effect shows where it lands and fades, with no travel and no arc', () => {
  const off = readAccess({}), on = readAccess({ search: '?motion=reduce' });
  for (const type of Object.keys(DURATION)) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const m = motion(type, t, on);
      assert.equal(m.k, 1, `${type} at ${t}: no travel`);
      assert.equal(m.lift, 0, `${type} at ${t}: no arc`);
      assert.equal(m.swell, 0, `${type} at ${t}: no swell`);
    }
    assert.ok(motion(type, 1, on).opacity < motion(type, 0, on).opacity, `${type} still fades`);
  }
  // Full motion keeps the summon's arc and the travel (the control: the reduced checks can fail).
  assert.ok(motion('summon', 0.5, off).lift > 0.1, 'the summon arcs');
  assert.ok(motion('summon', 0.5, off).k > 0 && motion('summon', 0.5, off).k < 1, 'and travels');
  assert.ok(motion('summon', 0, off).swell > 0, 'the doors swell');
  assert.equal(motion('damage', 0.5, off).lift, 0, 'only the summon arcs');
});

// ---- 2026-09-28: gaze, voice, high contrast, large text, dwell time, the first-run offer ----------
import { validSetting } from '../src/logic/access.js';

test('the new settings default off (dwell 1 s), and the URL turns each on', () => {
  const d = readAccess({});
  assert.deepEqual([d.gaze, d.voice, d.highContrast, d.largeText, d.offered, d.dwellMs], [false, false, false, false, false, 1000]);
  const u = readAccess({ search: '?gaze=1&voice=1&contrast=high&text=large&dwell=1500' });
  assert.deepEqual([u.gaze, u.voice, u.highContrast, u.largeText, u.dwellMs], [true, true, true, true, 1500]);
});

test('a stored dwell time is read only if it is one of the choices; other settings only as booleans', () => {
  assert.equal(readAccess({ stored: JSON.stringify({ dwellMs: 2000 }) }).dwellMs, 2000);
  assert.equal(readAccess({ stored: JSON.stringify({ dwellMs: 5 }) }).dwellMs, 1000, 'a dwell nobody offered is ignored');
  assert.equal(readAccess({ stored: JSON.stringify({ dwellMs: '2000' }) }).dwellMs, 1000);
  assert.equal(readAccess({ search: '?dwell=3' }).dwellMs, 1000);
  assert.equal(readAccess({ stored: JSON.stringify({ gaze: 1 }) }).gaze, false);
  assert.equal(validSetting('dwellMs', 800), true);
  assert.equal(validSetting('highContrast', 'yes'), false);
  assert.equal(validSetting('captions', false), false, 'captions are not a setting');
});
