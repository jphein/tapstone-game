// enrich.js: what the summons add to logic/effects.js's list for one pair of views (pure).
//   strike {attacks}         the turn's end: every attack at once, before the damage it causes
//   spell {card, seat, kind, faction, target}   a spell's 3D effect, before what it does
//   shift {seat, lane, toLane, cell, name}      Undertow: one unit changed lanes (diffViews sees
//                                               it as a death and a summon; this pair replaces both)
// Summons and deaths also get the unit's `name`, so the creature is the card's; a summon on the
// first board is `initial` (no card flies for it).
import { boardOf, strikesOf } from './combat.js';
import { spellOf } from './spells.js';

const at = (v, s, l, c) => (v && v.seats && v.seats[s] ? v.seats[s].cells[l][c] : null);

export function enrich(prev, next, effects) {
  const a = boardOf(prev), b = boardOf(next);
  // The first board (a fresh match, or a resumed one) is already there: it forms where it stands.
  const initial = !(a && a.seats && a.seats.length);
  let rest = effects.map((e) => {
    if (e.type === 'summon') {
      const u = at(b, e.seat, e.lane, e.cell);
      return u ? { ...e, name: u.name, keyword: u.keyword ?? null, initial } : e;
    }
    if (e.type === 'death') {
      const u = at(a, e.seat, e.lane, e.cell);
      return u ? { ...e, name: u.name, commander: !!u.commander } : e;
    }
    return e;
  });
  const out = [];
  const attacks = strikesOf(prev, next);
  if (attacks.length) out.push({ type: 'strike', attacks });
  const spell = spellOf(prev, next);
  if (spell) {
    out.push(spell);
    const t = spell.target;
    if (t && t.toLane !== undefined) {
      const isFrom = (e) => e.type === 'death' && e.seat === t.seat && e.lane === t.lane && e.cell === t.cell;
      const isTo = (e) => e.type === 'summon' && e.seat === t.seat && e.lane === t.toLane && e.cell === t.cell;
      const from = rest.find(isFrom), to = rest.find(isTo);
      if (from && to) {
        rest = rest.filter((e) => e !== from && e !== to);
        out.push({ type: 'shift', seat: t.seat, lane: t.lane, toLane: t.toLane, cell: t.cell, name: to.name });
      }
    }
  }
  return [...out, ...rest];
}
