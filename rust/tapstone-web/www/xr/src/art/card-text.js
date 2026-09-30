// card-text.js: a hand card's words for its face, from table.hand()'s JSON (tapstone-web's HandCard:
// `keyword` and `effect` are the rules crate's Debug names, e.g. "Shield1", "Damage { amount: 3,
// castle_ok: true }"). Pure. It says only what the rules crate's own fields say; no invented text.
const KEYWORD = { Ranged: 'Ranged', Shield1: 'Shield', Haste: 'Haste', Rush: 'Rush', Taunt: 'Taunt' };

export const keywordText = (k) => (k ? KEYWORD[k] ?? String(k) : '');

export function effectText(e) {
  if (!e) return '';
  const n = (key) => Number(new RegExp(`${key}:\\s*(\\d+)`).exec(e)?.[1]);
  if (/^Damage/.test(e)) return `Deal ${n('amount')} damage to a unit${/castle_ok:\s*true/.test(e) ? ' or a castle' : ''}.`;
  if (/^Heal/.test(e)) return `Heal ${n('amount')}.`;
  if (/^Destroy/.test(e)) return `Destroy a unit with toughness ${n('max_toughness')} or less.`;
  if (/^Shift/.test(e)) return 'Move a unit one lane.';
  if (/^Draw/.test(e)) return `Draw ${n('count') === 1 ? 'a card' : `${n('count')} cards`}.`;
  return String(e);
}

// The face's text box: a unit's keyword, a spell's effect, a castle's role.
export function rulesText(card) {
  if (card.kind === 'unit') return keywordText(card.keyword);
  if (card.kind === 'spell') return effectText(card.effect);
  if (card.kind === 'castle') return 'Your castle';
  return '';
}
