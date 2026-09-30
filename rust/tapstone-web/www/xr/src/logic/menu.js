// menu.js: a hand gesture becomes a menu index. Pure (no IWSDK, no DOM), tested under Node.
//
// The menu is tapstone-web's `table_choices()`: the engine's own legal moves for the person's seat
// (tapstone_sim::human::legal_choices), each item {key, label, kind, useful, card, lane, target,
// aux}. A gesture never invents a move: it picks one of these or is refused locally, so there is
// still one source of truth (0037). A refused gesture costs nothing: the card goes back to the hand.
//
// Gestures (spec 2026-09-25 §3.2):
//   { source: 'deck' }                                      draw: the deck's top card on any pad
//   { source: 'castle', action: 'pass' | 'mulligan' }       the castle card on a pad (gestures.js decides which)
//   { source: 'lane', pad: 0|1|2 }                          advance: a bare fingertip on a lane's pad (rules-v0:
//                                                           "Advance: touch a lane"; the spec's gesture table omits it)
//   { source: 'hand', card, face: 'down' }                  charge: a card turned face down, on any pad
//   { source: 'hand', card, face: 'up', pad: 0|1|2 }        cast: a unit goes to the pad's lane
//   { source: 'hand', card, face: 'up', target?, aux? }     a spell; `target` is the raw target byte
//                                                           (seat << 4 | lane << 2 | cell, or 0xFF = castle)
// Answers: { index } | { need: 'target', options: [{ index, target, aux, label }] } | { refused: text }
//
// With `ctx` ({ hand, view, near }: table.hand() and the latest view), a refusal says why and what to
// do, from the engine's own numbers (explainRefusal). JP's Quest 2 run, 2026-09-28: with 0 mana every
// card answered "You can't play that card now.", and he never learned to charge.

export const CASTLE_TARGET = 0xff;

// The raw target byte for a unit at (seat, lane, cell), as the rules pack it.
export function targetOf(seat, lane, cell) {
  return (seat << 4) | (lane << 2) | cell;
}

export function matchGesture(menu, g, ctx) {
  const r = matchRaw(menu, g);
  if (r.refused && ctx) r.refused = explainRefusal(menu, g, ctx) ?? r.refused;
  return r;
}

const LANE = ['left', 'middle', 'right'];

// Why a gesture was refused, and what to do, in words (null: the plain refusal says it already).
// Mana is the rules' available_mana(): charged - spent; the costs are the hand's (the card designs').
// Every fixed sentence the headset says has a rendered clip (test/voice.test.js), so a refusal that
// needs no numbers or names keeps its plain, voiced text; the ones composed here carry a card's name,
// a cost, a count or a lane, so they are drawn on the band and not spoken (0033: the band is the truth).
// `mode` (#200: 'hands', 'gaze' or 'voice'): the way to charge is said as that mode does it.
export function explainRefusal(menu, g, { hand = [], view = null, near = 0, mode = 'hands' } = {}) {
  const me = view && view.phase !== 'lobby' ? view.seats?.[near] ?? null : null;
  const mana = me ? Math.max(0, (me.charged ?? 0) - (me.spent ?? 0)) : 0;
  const canCharge = menu.some((m) => m.kind === 'Charge');
  if (!menu.length) return view && (view.phase === 'over' || view.last_over) ? 'The match is over.' : null;
  const owed = me?.owed_draws ?? 0;
  if (menu.every((m) => m.kind === 'Draw') && g.source !== 'deck') {
    return `Draw ${owed > 1 ? `${owed} cards` : 'a card'} first: touch the top card of your deck to the stone.`;
  }
  if (g.source === 'deck') return null;
  if (g.source === 'lane') return `The ${LANE[g.pad] ?? 'that'} lane has already advanced this turn.`;
  if (g.source === 'castle') return null;
  const card = hand.find((c) => c && c.card === g.card);
  if (!card) return null;
  // The card is castable somewhere and the refusal already names the lane or the missing target.
  if (menu.some((m) => (m.kind === 'CastUnit' || m.kind === 'CastSpell') && m.card === g.card)) return null;
  if (g.face === 'down') return canCharge ? null : `${card.name} stays in your hand: you've charged a card this round already, so charge again next round.`;
  if (card.cost > mana) {
    if (!canCharge) return `${card.name} needs ${card.cost} mana — you have ${mana}. You can charge a card again next round.`;
    const charge = hand.find((c) => c && c.card === menu.find((m) => m.kind === 'Charge').card)?.name ?? card.name;
    const how = mode === 'voice' ? `say “charge ${charge}”.` : mode === 'gaze' ? 'look at it twice, then at a pad.' : 'flip it face down and touch it to the stone.';
    return `${card.name} needs ${card.cost} mana — you have ${mana}. Charge a card: ${how}`;
  }
  if (card.kind === 'unit') return `${card.name} needs an open entry cell, and that lane's is taken: try another pad.`;
  if (card.kind === 'spell') return `${card.name} has nothing it can reach now.`;
  return null;
}

function matchRaw(menu, g) {
  if (!menu.length) return { refused: "It isn't your move." };
  const draws = menu.filter((m) => m.kind === 'Draw');
  // 0036: while draws are owed the engine offers nothing else.
  if (draws.length === menu.length && g.source !== 'deck') {
    return { refused: 'Draw first: touch the top card of your deck to the stone.' };
  }
  const at = (pred) => menu.findIndex(pred);
  let i = -1;
  if (g.source === 'deck') {
    i = at((m) => m.kind === 'Draw');
    return i >= 0 ? { index: i } : { refused: 'No draw is owed.' };
  }
  if (g.source === 'lane') {
    i = at((m) => m.kind === 'Advance' && m.lane === g.pad);
    return i >= 0 ? { index: i } : { refused: "That lane can't advance now." };
  }
  if (g.source === 'castle') {
    const kind = g.action === 'mulligan' ? 'Mulligan' : 'Pass';
    i = at((m) => m.kind === kind);
    return i >= 0 ? { index: i } : { refused: kind === 'Mulligan' ? 'The mulligan window is closed.' : "You can't pass now." };
  }
  if (g.face === 'down') {
    i = at((m) => m.kind === 'Charge' && m.card === g.card);
    return i >= 0 ? { index: i } : { refused: "That card can't be charged now." };
  }
  const unit = at((m) => m.kind === 'CastUnit' && m.card === g.card);
  if (unit >= 0) {
    if (g.pad === undefined || g.pad === null) return { refused: 'Touch the pad under the lane you want.' };
    i = at((m) => m.kind === 'CastUnit' && m.card === g.card && m.lane === g.pad);
    return i >= 0 ? { index: i } : { refused: "That lane's entry cell is taken." };
  }
  const spells = menu.map((m, index) => ({ m, index })).filter(({ m }) => m.kind === 'CastSpell' && m.card === g.card);
  if (spells.length) {
    const fits = spells.filter(({ m }) => (g.target === undefined || m.target === g.target) && (g.aux === undefined || m.aux === g.aux));
    if (fits.length === 1) return { index: fits[0].index };
    if (fits.length === 0) return { refused: "That spell can't reach there." };
    return { need: 'target', options: fits.map(({ m, index }) => ({ index, target: m.target, aux: m.aux, label: m.label })) };
  }
  return { refused: "You can't play that card now." };
}

// The inverse, for tests and the IWER driver: the gesture that picks menu item `m`. Every kind the
// engine offers has one, which is what "hands can play every move" means.
export function gestureForItem(m) {
  switch (m.kind) {
    case 'Draw':
      return { source: 'deck' };
    case 'Charge':
      return { source: 'hand', card: m.card, face: 'down', pad: 0 };
    case 'CastUnit':
      return { source: 'hand', card: m.card, face: 'up', pad: m.lane };
    case 'CastSpell':
      return { source: 'hand', card: m.card, face: 'up', pad: 1, target: m.target, aux: m.aux };
    case 'Advance':
      return { source: 'lane', pad: m.lane };
    case 'Pass':
      return { source: 'castle', action: 'pass' };
    case 'Mulligan':
      return { source: 'castle', action: 'mulligan' };
    default:
      return null;
  }
}
