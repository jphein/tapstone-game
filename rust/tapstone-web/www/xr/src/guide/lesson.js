// guide/lesson.js: what the guide should teach NOW, read from the match itself (guide v2, design note
// 2026-09-28). Pure: views, menus and hands in, facts and lessons out.
//
// JP's Quest 2 run (2026-09-28): a match resumed in round 3 while the guide restarted at "claim", then
// "draw", because the beats ran on a script clock. Here every beat has a done-fact read from the view
// (and from the person's own moves), the guide stands on the first beat not yet done, and a beat that
// teaches one of the person's moves speaks only when that move is actually on offer. contradicts() is
// the rule the IWER gates hold every spoken line to.
import { BEATS } from '../logic/first-five.js';

// The journal's tap keys (tapstone_sim::human::key_for) as the gestures first-five counts.
const KEY_KIND = { d: 'draw', c: 'charge', u: 'cast', s: 'spell', a: 'advance', p: 'pass', m: 'mulligan' };
export const kindOfKey = (key) => KEY_KIND[String(key).split('/')[0]] ?? null;

// A history: the gestures the person has made in this match, as a Set of kinds ('claim' and 'place'
// are the two that are not engine taps). From the journal on a resume, then live.
export function historyFrom(taps = [], extra = []) {
  const h = new Set(extra);
  for (const t of taps) {
    const k = kindOfKey(t.key);
    if (k) h.add(k);
  }
  return h;
}

const seatOf = (view, near) => (view && view.phase !== 'lobby' ? view.seats?.[near] ?? null : null);
const mine = (view, near) => seatOf(view, near);
const theirs = (view, near) => seatOf(view, 1 - near);
export const manaOf = (me) => (me ? Math.max(0, (me.charged ?? 0) - (me.spent ?? 0)) : 0);
const ownUnits = (me) => (me?.cells ?? []).flat().filter((u) => u && !u.commander).length;
const isOver = (view) => !!view && (view.phase === 'over' || (view.phase === 'lobby' && !!view.last_over));

// Each beat's done-fact. `placed` comes from play.js (the board placed in a session).
export function factsFrom({ view, near = 0, history = new Set(), placed = false }) {
  const me = mine(view, near), them = theirs(view, near);
  const acted = ['draw', 'charge', 'cast', 'spell', 'advance', 'pass', 'mulligan'].some((k) => history.has(k));
  const over = isOver(view);
  const claimed = history.has('claim') || acted || (view?.round ?? 0) > 1 || over;
  // Drawn once the opening hand is in; later rounds owe draws again, which is play, not the lesson.
  const drawn = over || (view?.round ?? 0) > 1 || (!!me && me.owed_draws === 0 && (history.has('draw') || (me.hand ?? 0) > 0 || acted));
  const charged = over || history.has('charge') || (me?.charged ?? 0) > 0;
  const cast = over || history.has('cast') || ownUnits(me) > 0;
  const passed = over || history.has('pass');
  const botMoved = over || (passed && ((view?.round ?? 0) >= 2 || view?.active === near));
  const chipped = over || (!!them && them.life < 20);
  return { placed: placed || over, claimed, drawn, charged, cast, passed, botMoved, chipped, over };
}

const DONE = { place: 'placed', claim: 'claimed', draw: 'drawn', flip: 'charged', cast: 'cast', pass: 'passed', bot: 'botMoved', unguided: 'chipped' };
export const doneFact = (beatId) => DONE[beatId];

// The first beat whose fact isn't true yet (BEATS.length when all are). Facts can fall back (a unit
// dies, a new round owes draws); the guide never does, so callers keep the highest index seen.
export function firstUndone(facts) {
  const i = BEATS.findIndex((b) => !facts[DONE[b.id]]);
  return i < 0 ? BEATS.length : i;
}

const say = (id) => BEATS.find((b) => b.id === id).say;
const slotOf = (hand, card) => (hand ?? []).findIndex((c) => c && c.card === card);

// The lesson for beat `beatId` now: { id, say, demo, item } where `item` is the menu item it teaches
// (guide/modes.js turns it into a head-gaze dwell or a spoken phrase), and demo is { move, from, to } (from: 'deck',
// 'castle' or { slot }; to: { pad }), or { id: 'wait' } when the beat's move isn't on offer yet (the
// other seat's turn, say). `mana` is the in-beat detour when a card can't be afforded.
export function lessonFor(beatId, { view, near = 0, menu = [], hand = [] } = {}) {
  const me = mine(view, near);
  const has = (kind) => menu.find((m) => m.kind === kind);
  const myMove = !!view && view.phase === 'playing' && view.active === near && menu.length > 0;
  switch (beatId) {
    case 'place':
      return { id: 'place', say: say('place'), demo: null };
    case 'claim':
      return { id: 'claim', say: say('claim'), demo: { move: 'claim', from: 'castle', to: { pad: 1 } } };
    case 'draw': {
      const owed = me?.owed_draws ?? 0;
      if (!owed || !has('Draw')) return { id: 'wait' };
      return { id: 'draw', item: has('Draw'), say: owed === 5 ? say('draw') : `Draw ${owed}: touch the top card of your deck to the stone.`, demo: { move: 'draw', from: 'deck', to: { pad: 1 } } };
    }
    case 'flip': {
      const c = myMove && has('Charge');
      if (!c) return { id: 'wait' };
      return { id: 'flip', item: c, say: say('flip'), demo: { move: 'charge', from: { slot: slotOf(hand, c.card) }, to: { pad: 0 } } };
    }
    case 'cast': {
      if (!myMove) return { id: 'wait' };
      const u = has('CastUnit');
      if (u) return { id: 'cast', item: u, say: say('cast'), demo: { move: 'cast', from: { slot: slotOf(hand, u.card) }, to: { pad: u.lane } } };
      // Nothing affordable: teach where mana comes from, with the engine's numbers.
      const want = (hand ?? []).filter((c) => c.kind === 'unit').sort((a, b) => a.cost - b.cost)[0];
      const c = has('Charge');
      if (want && c) {
        return { id: 'mana', card: want.card, item: c, say: `${want.name} needs ${want.cost} mana — you have ${manaOf(me)}. Charge a card: flip it face down and touch it to the stone.`, demo: { move: 'charge', from: { slot: slotOf(hand, c.card) }, to: { pad: 0 } } };
      }
      return { id: 'wait' };
    }
    case 'pass':
      if (!myMove || !has('Pass')) return { id: 'wait' };
      return { id: 'pass', item: has('Pass'), say: say('pass'), demo: { move: 'pass', from: 'castle', to: { pad: 1 } } };
    case 'bot':
      return { id: 'bot', say: say('bot'), demo: null };
    case 'unguided':
      return { id: 'unguided', say: say('unguided'), demo: null };
    default:
      return { id: 'wait' };
  }
}

// Why a lesson is wrong for this state (null if it's fine): the guide telling you to do what you've
// done, or to make a move the engine isn't offering.
export function contradicts(lesson, { view, near = 0, menu = [], hand = [], facts }) {
  if (!lesson || lesson.id === 'wait') return null;
  const f = facts ?? factsFrom({ view, near });
  const has = (kind, card) => menu.some((m) => m.kind === kind && (card === undefined || m.card === card));
  const me = mine(view, near);
  const beat = { flip: 'flip', cast: 'cast', claim: 'claim', draw: 'draw', pass: 'pass' }[lesson.id];
  if (beat && f[DONE[beat]]) return `${lesson.id}: already done (${DONE[beat]})`;
  const from = lesson.demo?.from;
  if (from && typeof from === 'object' && !(hand ?? [])[from.slot]) return `${lesson.id}: shows a card not in the hand (slot ${from.slot})`;
  switch (lesson.id) {
    case 'draw':
      return (me?.owed_draws ?? 0) > 0 && has('Draw') ? null : 'draw: no draw is owed';
    case 'flip':
      return has('Charge') ? null : 'flip: no charge on offer';
    case 'cast':
      return has('CastUnit') ? null : 'cast: no unit can be cast';
    case 'mana':
      if (!has('Charge')) return 'mana: no charge on offer';
      return has('CastUnit', lesson.card) ? 'mana: that card is affordable' : null;
    case 'pass':
      return has('Pass') ? null : 'pass: passing is not on offer';
    default:
      return null;
  }
}
