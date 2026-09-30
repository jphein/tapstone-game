// access.js: the accessibility settings (VR spec 2026-09-25 §3.2 "Voice and contrast", §5 MVP 9).
// Pure: what the settings are, and what each one changes. The page reads and stores them
// (src/access.js); the scene applies them.
//
//   seated        the table follows a seated head: once the head settles past the drift the layout
//                 can take (replaceDrift), the board is placed again, so sitting down (or standing up)
//                 after the first frame never leaves the stone out of reach or out of view.
//   leftHanded    the deck and the castle card swap ends of the altar. Lanes never mirror: lane N is
//                 always pad N, left to right, as the board shows it.
//   reducedMotion effects show where they land and fade: no travel, no arc, no swell. It defaults
//                 to the system's prefers-reduced-motion.
//   captions      always on, and not a setting: the voice band IS the caption (0033: the band is the
//                 source of truth, the game is playable muted), so nothing can turn it off.
//
// Added 2026-09-28 (design note 2026-09-28-xr-accessibility-design.md):
//   gaze          head-gaze dwell plays every move with no hand (logic/gaze.js, src/assist.js).
//   dwellMs       how long a look takes to select: one of DWELL_CHOICES (default 1 s).
//   voice         spoken commands (logic/voice-commands.js). The preference only: the mic opens on an
//                 explicit opt-in (a button, a dwell, a pinch), and whenever it is open the listening
//                 indicator shows.
//   highContrast  the contrast theme (logic/theme.js): near-black surfaces, white text, yellow pads.
//   largeText     the caption band and the settings tiles drawn half as large again.
//   offered       the first-run offer (hands, head gaze or voice) was answered: it isn't shown again.
//
// Added 2026-09-29 (design note 2026-09-29-xr-atmosphere-design.md):
//   ambience      the ambient bed's volume: one of AMBIENCE_LEVELS (off, low, medium, high).
import { DECK, defaultHead, essentials, offGaze, padCenter } from './layout.js';
import { DWELL_CHOICES, DWELL_DEFAULT } from './gaze.js';
import { AMBIENCE_DEFAULT, AMBIENCE_LEVELS } from './atmosphere.js';

export const ACCESS_DEFAULTS = {
  seated: false, leftHanded: false, reducedMotion: false,
  gaze: false, dwellMs: DWELL_DEFAULT, voice: false, highContrast: false, largeText: false, offered: false,
  ambience: AMBIENCE_DEFAULT,
};

// Whether a value is one the setting `key` can take.
export function validSetting(key, v) {
  if (!(key in ACCESS_DEFAULTS)) return false;
  if (key === 'dwellMs') return DWELL_CHOICES.includes(v);
  if (key === 'ambience') return AMBIENCE_LEVELS.includes(v);
  return typeof v === 'boolean';
}

// The layout's budgets (test/layout.test.js): every essential within ±32° yaw and ±30° pitch, and
// every pad within the reach the spike's touches worked at.
const BUDGET = { yaw: 32, pitch: 30, reach: 0.51 };

// `search` (location.search) beats `stored` (localStorage JSON), which beats the system preference,
// which beats the defaults. A corrupt store is ignored.
export function readAccess({ search = '', stored = null, prefersReducedMotion = false } = {}) {
  const out = { ...ACCESS_DEFAULTS, reducedMotion: !!prefersReducedMotion };
  let s = null;
  try {
    s = stored ? JSON.parse(stored) : null;
  } catch {
    s = null;
  }
  for (const k of Object.keys(ACCESS_DEFAULTS)) if (s && validSetting(k, s[k])) out[k] = s[k];
  const q = new URLSearchParams(search);
  if (q.has('seated')) out.seated = q.get('seated') === '1';
  if (q.has('hand')) out.leftHanded = q.get('hand') === 'left';
  if (q.has('motion')) out.reducedMotion = q.get('motion') === 'reduce';
  if (q.has('gaze')) out.gaze = q.get('gaze') === '1';
  if (q.has('voice')) out.voice = q.get('voice') === '1';
  if (q.has('contrast')) out.highContrast = q.get('contrast') === 'high';
  if (q.has('text')) out.largeText = q.get('text') === 'large';
  if (q.has('dwell') && validSetting('dwellMs', Number(q.get('dwell')))) out.dwellMs = Number(q.get('dwell'));
  if (q.has('ambience') && validSetting('ambience', Number(q.get('ambience')))) out.ambience = Number(q.get('ambience'));
  out.captions = true;
  return out;
}

// Where the deck and the castle card rest on the altar (board-local x, z).
export function sides(a) {
  const x = a?.leftHanded ? -DECK.x : DECK.x;
  return { deck: { x, z: DECK.z }, castle: { x: -x, z: DECK.z } };
}

function holds(head, a) {
  for (const p of Object.values(essentials(a))) {
    const g = offGaze(p, head);
    if (Math.abs(g.yaw) > BUDGET.yaw || Math.abs(g.pitch) > BUDGET.pitch) return false;
  }
  for (let l = 0; l < 3; l++) {
    const p = padCenter(l);
    if (Math.hypot(p.x - head.x, p.y - head.y, p.z - head.z) > BUDGET.reach) return false;
  }
  return true;
}

// The layout's vertical slack: the largest head offset (m, to 1 mm, capped at DRIFT_CAP) above
// (`up`) and below (`down`) the placed head at which both budgets still hold. Measured 2026-09-27:
// up 0.005 (the reach binds: the pads sit 0.506 m from the head against 0.51, so the layout has
// 4 mm of reach headroom) and down at the cap, because the FoV budget re-aims the gaze at the board
// and so cannot see a board that has risen toward eye level: that side is bounded by nothing here.
export const DRIFT_CAP = 0.3;
export function seatedDrift(a) {
  const h = defaultHead();
  const side = (sign) => {
    let d = 0;
    for (let mm = 1; mm <= DRIFT_CAP * 1000; mm++) {
      if (!holds({ ...h, y: h.y + (sign * mm) / 1000 }, a)) break;
      d = mm / 1000;
    }
    return d;
  };
  return { up: side(1), down: side(-1) };
}

export const SETTLE = { ms: 1000, band: 0.02 }; // a head is settled when a second of it spans 2 cm

// The drift that places a seated table again: the layout's tighter slack, but never finer than a
// settled head can be told apart (the settle band), or the table would chase noise.
export function replaceDrift(a) {
  const d = seatedDrift(a);
  return Math.max(SETTLE.band, Math.min(d.up, d.down));
}

// `samples`: recent head heights [{ t (ms), y (m) }], oldest first. True when the table should be
// placed again for a seated person whose settled head is past the drift from `placedY`.
export function shouldReplace(a, placedY, samples) {
  if (!a?.seated || !samples?.length) return false;
  const last = samples[samples.length - 1].t;
  if (last - samples[0].t < SETTLE.ms) return false;
  const win = samples.filter((s) => last - s.t <= SETTLE.ms).map((s) => s.y);
  if (Math.max(...win) - Math.min(...win) > SETTLE.band) return false;
  const mid = win.slice().sort((x, y) => x - y)[win.length >> 1];
  return Math.abs(mid - placedY) > replaceDrift(a);
}

const ease = (t) => t * t * (3 - 2 * t);

// How an effect's marker moves at `t` (0..1 through its duration): `k` along from→to, `lift` (m)
// of the summon's arc, `swell` (the teahouse door's scale factor, 0 = none), and `opacity`.
export function motion(type, t, a) {
  const opacity = 1 - t * 0.6;
  if (a?.reducedMotion) return { k: 1, lift: 0, swell: 0, opacity };
  return { k: ease(t), lift: type === 'summon' ? Math.sin(Math.PI * t) * 0.12 : 0, swell: 1, opacity };
}
