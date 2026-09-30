// voice-commands.js: spoken commands for every move a hand can make (accessibility, design note
// 2026-09-28-xr-accessibility-design.md). Pure: no audio, no DOM, tested under Node.
//
// The Quest Browser has no SpeechRecognition (measured on JP's Quest 2, Quest Browser 152), so the
// page spots phrases itself (src/voice-input.js, a WASM keyword spotter in a Worker). A keyword
// spotter only reports phrases from a fixed list, and this file IS that list: phrases() is what
// tools/voice_keywords.py tokenises into public/kws/keywords.txt, and parse() reads a phrase back
// into an intent. Typed text (tests, the IWER driver's __tapstone.hear()) goes through the same
// table, so there is one grammar.
//
// An intent never picks a move itself: resolve() turns it into the SAME gesture object a hand makes
// (logic/menu.js), and play.js's matchGesture decides against the engine's own menu. So a spoken
// move is legal or refused exactly as the hand move would be (0037: one source of truth).
//
// Lanes are spoken as a person counts them, from the left: "lane one" is the left lane (pad 0).
// "Pass" is spoken "pass turn" or "end turn": measured on the TTS corpus (scratch/issues/selene.md),
// a bare "pass" fired inside "cast …" and on "can you pass me the tea", and a false pass ends the turn.
import { CASTLE_TARGET } from './menu.js';

// The spotter's search settings, measured on the TTS corpus (tools/voice_eval.mjs; 6 Piper voices
// x 25 commands and 24 non-command sentences, scratch/issues/selene.md 2026-09-29) for the
// LibriSpeech-trained 20M transducer (tools/fetch_kws.mjs): the GigaSpeech spotter's settings (12
// paths, score 2.0, threshold 0.05) found 107 of 150; 20 paths, score 4.0 and threshold 0.02, with
// keywords.txt's own boost on short phrases, find 128. Shared by the Worker (public/kws/kws-worker.js,
// sent at init) and the eval, so what is measured is what runs.
export const KWS_CONFIG = { maxActivePaths: 20, numTrailingBlanks: 2, keywordsScore: 4.0, keywordsThreshold: 0.02 };

// Set 1's playable designs (test/voice-commands.test.js checks this against game/cards/set1).
// `untargeted`: a spell that takes no target (Deep Breath draws), so it is said bare.
export const CARDS = [
  ['Cinder Whelp', 'unit'], ['Ashen Vanguard', 'unit'], ['Hearth Warden', 'unit'], ['Flare', 'spell'],
  ['Reef Archer', 'unit'], ['Tidecaller', 'unit'], ['Pearl Shieldbearer', 'unit'], ['Tidal Lash', 'spell'],
  ['Undertow', 'spell'], ['Deep Breath', 'spell', true], ['Mend', 'spell'], ['Riptide', 'spell'],
  ['Forge Runner', 'unit'], ['Bellows Raider', 'unit'], ['Slag Brute', 'unit'], ['Magma Burst', 'spell'],
  ['Brine Skimmer', 'unit'], ['Trench Leviathan', 'unit'],
].map(([name, kind, untargeted = false]) => ({ name, kind, untargeted }));

// How a name is also heard. The spotter matches the model's word pieces exactly, and a compound
// word it never saw whole ("Tidecaller") comes out as two words.
const ALIASES = { TIDECALLER: ['TIDE CALLER'], SHIELDBEARER: ['SHIELD BEARER'] };

const NUM = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'];
const LANE_WORDS = [
  ['LANE ONE', 'THE LEFT LANE', 'LEFT LANE'],
  ['LANE TWO', 'THE MIDDLE LANE', 'MIDDLE LANE'],
  ['LANE THREE', 'THE RIGHT LANE', 'RIGHT LANE'],
];
export const LANE_NAMES = ['left', 'middle', 'right'];

// Settings a voice can change (keys of logic/access.js ACCESS_DEFAULTS), and how they are named.
const SETTING_WORDS = {
  gaze: ['HEAD GAZE', 'GAZE'],
  highContrast: ['HIGH CONTRAST', 'CONTRAST'],
  largeText: ['LARGE CAPTIONS', 'LARGE TEXT'],
  seated: ['SEATED MODE', 'SEATED'],
  leftHanded: ['LEFT HANDED'],
  reducedMotion: ['REDUCED MOTION'],
};

const up = (s) => s.toUpperCase();

function build() {
  const table = new Map();
  const add = (text, intent) => {
    for (const t of expand(text)) if (!table.has(t)) table.set(t, intent);
  };
  const expand = (text) => {
    const out = [text];
    for (const [k, vs] of Object.entries(ALIASES)) {
      if (text.includes(k)) for (const v of vs) out.push(text.replace(k, v));
    }
    return out;
  };
  add('DRAW', { verb: 'draw' });
  for (const t of ['PASS TURN', 'PASS MY TURN', 'END TURN', 'END MY TURN']) add(t, { verb: 'pass' });
  add('MULLIGAN', { verb: 'mulligan' });
  add('CLAIM', { verb: 'claim' });
  add('CANCEL', { verb: 'cancel' });
  for (const t of ['WHAT CAN I SAY', 'VOICE HELP']) add(t, { verb: 'help' });
  for (const t of ['STOP LISTENING', 'VOICE OFF']) add(t, { verb: 'mic', on: false });
  for (const t of ['OPEN SETTINGS', 'SETTINGS']) add(t, { verb: 'panel', open: true });
  add('CLOSE SETTINGS', { verb: 'panel', open: false });
  for (const [key, words] of Object.entries(SETTING_WORDS)) {
    for (const w of words) {
      add(`${w} ON`, { verb: 'set', key, value: true });
      add(`${w} OFF`, { verb: 'set', key, value: false });
    }
  }
  LANE_WORDS.forEach((ws, lane) => {
    for (const w of ws) add(`ADVANCE ${w}`, { verb: 'advance', lane });
  });
  NUM.slice(0, 6).forEach((n, k) => {
    for (const v of ['TARGET', 'OPTION', 'CHOICE']) add(`${v} ${n}`, { verb: 'pick', option: k });
  });
  NUM.forEach((n, slot) => add(`CHARGE CARD ${n}`, { verb: 'charge', slot }));
  for (const c of CARDS) {
    const N = up(c.name);
    add(`CHARGE ${N}`, { verb: 'charge', card: c.name });
    if (c.kind === 'unit') {
      LANE_WORDS.forEach((ws, lane) => {
        for (const w of ws) {
          for (const v of ['SUMMON', 'PLAY', 'CAST']) {
            for (const f of ['', 'IN ', 'INTO ', 'TO ']) add(`${v} ${N} ${f}${w}`, { verb: 'summon', card: c.name, lane });
          }
        }
      });
    } else {
      // A spell with a target is never spoken bare: "cast flare" is a prefix of "cast flare at …",
      // and a spotter reports the prefix first. The spells that take no target are said bare.
      if (c.untargeted) {
        add(`CAST ${N}`, { verb: 'cast', card: c.name, at: null });
        continue;
      }
      for (const t of ['THE CASTLE', 'THE ENEMY CASTLE', 'CASTLE']) add(`CAST ${N} AT ${t}`, { verb: 'cast', card: c.name, at: { castle: true } });
      LANE_WORDS.forEach((ws, lane) => {
        for (const w of ws) add(`CAST ${N} AT ${w}`, { verb: 'cast', card: c.name, at: { lane } });
      });
      for (const u of CARDS.filter((x) => x.kind === 'unit')) add(`CAST ${N} AT ${up(u.name)}`, { verb: 'cast', card: c.name, at: { unit: u.name } });
    }
  }
  return table;
}

let TABLE = null;
const table = () => (TABLE ??= build());

// Every phrase, for the keyword file: [{ text, intent }], in a stable order.
export function phrases() {
  return [...table()].map(([text, intent]) => ({ text, intent }));
}

// The spotter's tag for a phrase (a keyword's "@tag" can't hold spaces) and back.
export const tagOf = (text) => text.replace(/ /g, '_');

// A heard phrase (a spotter tag, or typed text) to its intent, or null. Case, punctuation and a
// "please" either side don't matter.
export function parse(heard) {
  if (typeof heard !== 'string') return null;
  const t = up(heard).replace(/_/g, ' ').replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^PLEASE /, '').replace(/ PLEASE$/, '');
  return table().get(t) ?? null;
}

// The target byte's lane and seat (menu.js targetOf packs seat << 4 | lane << 2 | cell).
const laneOf = (target) => (target >> 2) & 3;

// What an intent does now. `menu` is the engine's menu (table_choices), `hand` the shown hand
// ([{ card, name }]). Answers one of:
//   { gesture }            play it through play.play(), exactly as a hand's gesture
//   { choose: options }    a spell whose spoken target fits several: offer these ({ index, target,
//                          aux, label }, menu.js's shape) and let "target <n>" pick
//   { pick: option }       the n-th tile of the open prompt
//   { refused: text }      nothing to do (the caption says why)
//   { claim | cancel | help: true }, { setting: { key, value } }, { panel: bool }, { mic: bool }
export function resolve(intent, { menu = [], hand = [] } = {}) {
  if (!intent) return { refused: "I didn't catch a command." };
  const cardIn = (name) => hand.find((c) => c.name === name);
  switch (intent.verb) {
    case 'draw':
      return { gesture: { source: 'deck' } };
    case 'pass':
      return { gesture: { source: 'castle', action: 'pass' } };
    case 'mulligan':
      return { gesture: { source: 'castle', action: 'mulligan' } };
    case 'advance':
      return { gesture: { source: 'lane', pad: intent.lane } };
    case 'claim':
      return { claim: true };
    case 'cancel':
      return { cancel: true };
    case 'help':
      return { help: true };
    case 'pick':
      return { pick: intent.option };
    case 'mic':
      return { mic: intent.on };
    case 'panel':
      return { panel: intent.open };
    case 'set':
      return { setting: { key: intent.key, value: intent.value } };
    case 'charge': {
      const c = intent.slot !== undefined ? hand[intent.slot] : cardIn(intent.card);
      if (!c) return { refused: intent.slot !== undefined ? `You hold no card ${intent.slot + 1}.` : `No ${intent.card} in your hand.` };
      return { gesture: { source: 'hand', card: c.card, face: 'down', pad: 0 } };
    }
    case 'summon': {
      const c = cardIn(intent.card);
      if (!c) return { refused: `No ${intent.card} in your hand.` };
      return { gesture: { source: 'hand', card: c.card, face: 'up', pad: intent.lane } };
    }
    case 'cast': {
      const c = cardIn(intent.card);
      if (!c) return { refused: `No ${intent.card} in your hand.` };
      const g = { source: 'hand', card: c.card, face: 'up', pad: 1 };
      if (!intent.at) return { gesture: g };
      const all = menu.map((m, index) => ({ m, index })).filter(({ m }) => m.kind === 'CastSpell' && m.card === c.card);
      // No spell item for this card at all: let matchGesture say why, as it would for a hand.
      if (!all.length) return { gesture: g };
      const fits = all.filter(({ m }) => {
        if (intent.at.castle) return m.target === CASTLE_TARGET;
        if (m.target === CASTLE_TARGET) return false;
        if (intent.at.lane !== undefined) return laneOf(m.target) === intent.at.lane;
        return m.label.endsWith(`(${intent.at.unit})`);
      });
      if (!fits.length) return { refused: `${intent.card} can't reach there.` };
      if (fits.length === 1) return { gesture: { ...g, target: fits[0].m.target, aux: fits[0].m.aux } };
      return { choose: fits.map(({ m, index }) => ({ index, target: m.target, aux: m.aux, label: m.label })) };
    }
    default:
      return { refused: "I didn't catch a command." };
  }
}

// The caption for what was heard: the person sees what the page understood before (and whatever)
// the engine answers. Lanes are named as spoken, with their side.
export function heardText(intent) {
  if (!intent) return '';
  const lane = (l) => `lane ${l + 1} (${LANE_NAMES[l]})`;
  switch (intent.verb) {
    case 'summon':
      return `Heard: summon ${intent.card} in ${lane(intent.lane)}.`;
    case 'advance':
      return `Heard: advance ${lane(intent.lane)}.`;
    case 'charge':
      return `Heard: charge ${intent.card ?? `card ${intent.slot + 1}`}.`;
    case 'cast': {
      const at = intent.at;
      const where = !at ? '' : at.castle ? ' at the castle' : at.lane !== undefined ? ` at ${lane(at.lane)}` : ` at ${at.unit}`;
      return `Heard: cast ${intent.card}${where}.`;
    }
    case 'pick':
      return `Heard: target ${intent.option + 1}.`;
    case 'set':
      return `Heard: ${intent.key} ${intent.value ? 'on' : 'off'}.`;
    case 'panel':
      return `Heard: ${intent.open ? 'open' : 'close'} settings.`;
    case 'mic':
      return 'Heard: stop listening.';
    default:
      return `Heard: ${intent.verb}.`;
  }
}

// The one-line help ("what can I say").
export const HELP = 'Say: draw · summon <card> in lane 1–3 · cast <spell> at <target> · charge <card> · advance lane 1–3 · end turn · mulligan · target 1–3 · open settings.';

// The inverse, for tests and the IWER driver: the phrases that play menu item `m`, in order (a
// spell whose spoken target fits several ends with "target <n>"). `hand` is the shown hand.
export function voiceForItem(m, menu, hand) {
  const name = (id) => hand.find((c) => c.card === id)?.name;
  switch (m.kind) {
    case 'Draw':
      return ['draw'];
    case 'Pass':
      return ['end turn'];
    case 'Mulligan':
      return ['mulligan'];
    case 'Advance':
      return [`advance ${LANE_WORDS[m.lane][0].toLowerCase()}`];
    case 'Charge':
      return [`charge ${name(m.card)}`];
    case 'CastUnit':
      return [`summon ${name(m.card)} in ${LANE_WORDS[m.lane][0].toLowerCase()}`];
    case 'CastSpell': {
      if (CARDS.find((c) => c.name === name(m.card))?.untargeted) return [`cast ${name(m.card)}`];
      const say = m.target === CASTLE_TARGET ? `cast ${name(m.card)} at the castle` : `cast ${name(m.card)} at ${LANE_WORDS[laneOf(m.target)][0].toLowerCase()}`;
      const r = resolve(parse(say), { menu, hand });
      if (r.choose) {
        const k = r.choose.findIndex((o) => o.target === m.target && o.aux === m.aux);
        return [say, `target ${NUM[k].toLowerCase()}`];
      }
      return [say];
    }
    default:
      return null;
  }
}
