// atmosphere.js: the Tea House's air, light and sound, as numbers (design note
// 2026-09-29-xr-atmosphere-design.md). Pure, so node checks the plans the scene builds from:
//   - how many particles of each kind, per room and per setting (reduced motion: half, and slower);
//   - the lanterns' flicker (none with reduced motion);
//   - which hand cards the player can play right now, read from the engine's own menu;
//   - the wind chimes' scale and schedule, and the ambient bed's volume levels.
// Every look and sound here is a PROPOSAL (the bible is silent); 0039's canon is "lantern light,
// magical tea" and the planes behind the doors.

// The volume setting (logic/access.js `ambience`): off, low, medium, high.
export const AMBIENCE_LEVELS = [0, 0.35, 0.7, 1];
export const AMBIENCE_DEFAULT = 0.7;
export const ambienceName = (v) => ['off', 'low', 'medium', 'high'][AMBIENCE_LEVELS.indexOf(v)] ?? 'medium';
export const nextAmbience = (v) => AMBIENCE_LEVELS[(AMBIENCE_LEVELS.indexOf(v) + 1) % AMBIENCE_LEVELS.length];

// Particles per kind at full motion. Room kinds exist only in full VR (the interior); door kinds in
// both rooms (in mixed reality the doors are the Tea House's only presence).
export const FULL = {
  room: { dust: 140, embers: 36, incense: 28, steam: 21 },
  door: { sparks: 34, bubbles: 30, fireflies: 22, wisps: 18 },
  table: { motes: 44 }, // mixed reality only: motes round the table (the room's own dust is VR's)
};
// Which door breathes what: the Forge Peaks sparks, the Deep Tides bubbles, the Hearthlands
// fireflies, the red door (the Dueling Grounds) violet wisps.
export const DOOR_AIR = { ember: 'sparks', tide: 'bubbles', neutral: 'fireflies', grounds: 'wisps' };

// The plan for a room ('vr' | 'mr') under the access settings: { counts, speed, twinkle, flicker, dim }.
export function airPlan(room, a = {}) {
  const calm = !!a.reducedMotion;
  const k = calm ? 0.5 : 1;
  const scale = (o) => Object.fromEntries(Object.entries(o).map(([key, n]) => [key, Math.ceil(n * k)]));
  return {
    counts: { ...(room === 'vr' ? scale(FULL.room) : scale(FULL.table)), ...scale(FULL.door) },
    speed: calm ? 0.45 : 1, // how fast the air moves
    twinkle: !calm, // the playable sparkle twinkles, or holds as a steady rim
    flicker: calm ? 0 : 1, // the lanterns' flicker depth
    dim: a.highContrast ? 0.45 : 1, // the air and rays under high contrast: never over what a person reads
  };
}

export const total = (counts) => Object.values(counts).reduce((s, n) => s + n, 0);

// A lantern's brightness at time t (s): three incommensurate sines, never below 0.88 or over 1.08.
export function flicker(t, seed = 0, depth = 1) {
  if (!depth) return 1;
  const n = 0.5 * Math.sin(t * 7.3 + seed * 1.7) + 0.3 * Math.sin(t * 13.1 + seed * 4.1) + 0.2 * Math.sin(t * 2.3 + seed);
  return 1 + depth * 0.08 * n - depth * 0.02 * Math.max(0, Math.sin(t * 0.7 + seed * 2.9)) ** 8;
}

// The hand slots whose card has a useful cast in the menu right now (the engine's legal moves, not a
// guess). `hand` is table.hand()'s array (by slot), `menu` table.choices().
const CASTS = new Set(['CastUnit', 'CastSpell']);
export function playableSlots(hand, menu) {
  const ids = new Set((menu ?? []).filter((m) => m.useful && CASTS.has(m.kind)).map((m) => m.card));
  const out = new Set();
  (hand ?? []).forEach((c, slot) => c && ids.has(c.card) && out.add(slot));
  return out;
}

// Wind chimes: a D major pentatonic an octave up (Hz), struck in small clusters every 6-14 s.
export const CHIME_SCALE = [587.33, 659.25, 739.99, 880, 987.77, 1174.66];
export function nextChime(rand = Math.random) {
  const n = 2 + Math.floor(rand() * 4); // 2..5 strikes
  const notes = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    notes.push({ at, f: CHIME_SCALE[Math.floor(rand() * CHIME_SCALE.length)], gain: 0.5 + rand() * 0.5 });
    at += 0.12 + rand() * 0.5;
  }
  return { wait: 6 + rand() * 8, notes };
}

// The ambient bed's voices, per room: what sounds where. 'room' voices only in full VR.
export const BED = [
  { id: 'tone', where: 'room', kind: 'tone' }, // room tone: a low hush of air
  { id: 'crackle', where: 'lantern', kind: 'crackle' }, // a lantern's crackle and hush
  { id: 'chimes', where: 'room', kind: 'chimes' },
  { id: 'water', where: 'tide', kind: 'water' }, // the Deep Tides door
  { id: 'rumble', where: 'ember', kind: 'rumble' }, // the Forge Peaks door
  { id: 'crickets', where: 'neutral', kind: 'crickets' }, // the Hearthlands door at night
  { id: 'hum', where: 'grounds', kind: 'hum' }, // the red door: the Dueling Grounds
];
export const bedFor = (room) => BED.filter((v) => room === 'vr' || !['room', 'lantern'].includes(v.where));

// ---- The mood: dusk, lantern-lit (full VR). The room lives in pools of warm lantern light with a deep
// blue-violet dimness between them; the table has its own soft key, so the board and cards are the
// brightest things; the shoji glow cool from outside, as at dusk. Board-local metres, floor at y -0.4.
// Every number here is a PROPOSAL (the bible: "lantern light"). interior.js bakes it; the fog and the
// drift are teahouse.js's. test/atmosphere.test.js holds the pools, the dimness and the table's key.
const FY = -0.4;
export const LANTERN_AT = [[-1.25, 1.0, -1.15], [1.25, 1.0, -1.15], [-1.25, 1.0, 1.35], [1.25, 1.0, 1.35]]; // hung low, so each throws a pool
export const ANDON_AT = [[-2.45, FY + 0.32, -2.45], [2.45, FY + 0.32, -2.45]];
export const TEA_AT = [[-0.405, -0.015, -0.075], [-0.335, -0.015, -0.12]];
export const TABLE_KEY = [0, 1.05, 0.12]; // a soft warm key over the board (no fixture: the room's gift)
export const MOOD = {
  ambient: 0x121236, // the dimness between the pools: deep blue-violet
  lanterns: { color: 0xffa84a, intensity: 4.2, falloff: 0.4, capped: true }, // bright near, gone by 2 m; black-capped
  andon: { color: 0xffb870, intensity: 1.2, falloff: 0.6 },
  key: { color: 0xffe6c4, intensity: 3.4, falloff: 0.6, cone: 0.9 }, // a spot, ~26°: the table's pool only
  tea: { color: 0x7ff0c0, intensity: 0.25, falloff: 0.12 },
  // Dusk outside the shoji: violet above, a last rose band low (the paper's own glow, not a light).
  duskHigh: 0x5a5498, duskLow: 0x9a6a78, duskGain: 0.62,
  fog: { color: 0x120f22, near: 1.4, far: 8.5 },
};

export function moodLights() {
  return [
    ...LANTERN_AT.map((at) => ({ at, ...MOOD.lanterns })),
    ...ANDON_AT.map((at) => ({ at, ...MOOD.andon })),
    { at: TABLE_KEY, ...MOOD.key },
    ...TEA_AT.map((at) => ({ at: [at[0], at[1] + 0.06, at[2]], ...MOOD.tea })),
  ];
}

// The light a surface facing `n` at `p` gets from the mood (the same terms geo.js bake uses, without
// the albedo): a number to compare pools and dimness, per channel summed.
export const WRAP = 0.1; // little light wraps round to faces turned away: the dark sides stay dark
export function lightAt(p, n = [0, 1, 0], wrap = WRAP) {
  const lum = (hex) => (((hex >> 16) & 255) + ((hex >> 8) & 255) + (hex & 255)) / 765;
  let e = lum(MOOD.ambient);
  for (const l of moodLights()) {
    const d = [l.at[0] - p[0], l.at[1] - p[1], l.at[2] - p[2]], dist = Math.hypot(...d);
    const lam = Math.max(0, ((n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / dist + wrap) / (1 + wrap));
    let k = (lum(l.color) * l.intensity * lam) / (1 + (dist / l.falloff) ** 2);
    if (l.cone) k *= Math.min(1, Math.max(0, (d[1] / dist - l.cone) / (1 - l.cone)) * 4); // geo.js bake's spot
    if (l.capped && p[1] > l.at[1] + 0.15) k *= 0.3;
    e += k;
  }
  return e;
}

// The ambient's slow hue drift: a multiplier per channel, within 3%, over about 70 s; none when calm.
export function hueDrift(t, calm = false) {
  if (calm) return [1, 1, 1];
  const w = Math.sin((t * 2 * Math.PI) / 71);
  return [1 + 0.02 * w, 1, 1 - 0.03 * w];
}
