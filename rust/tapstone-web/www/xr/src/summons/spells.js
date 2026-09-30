// spells.js: set 1's spells as short 3D effects at their target (pure). The record names the card,
// not the target, so the target is read from the diff: the unit that took damage, healed, died or
// changed lanes, or the castle whose life fell. The look is PROPOSAL (art direction).
import { boardOf } from './combat.js';

// kind: bolt (flies from the caster's side and bursts), vortex (a whirlpool that pulls down), wave
// (sweeps across the lanes), motes (rise in a ring). `faction` picks the colour (board.js FACTION),
// `effect` is the card's (game/cards/set1).
export const SPELLS = {
  Flare: { kind: 'bolt', faction: 'ember', effect: 'damage' },
  'Magma Burst': { kind: 'bolt', faction: 'ember', effect: 'damage', big: true },
  'Tidal Lash': { kind: 'bolt', faction: 'tide', effect: 'damage' },
  Riptide: { kind: 'vortex', faction: 'tide', effect: 'destroy' },
  Undertow: { kind: 'wave', faction: 'tide', effect: 'shift' },
  Mend: { kind: 'motes', faction: 'neutral', effect: 'heal' },
  'Deep Breath': { kind: 'motes', faction: 'neutral', effect: 'draw' },
};

const units = (b, fn) => {
  const out = [];
  if (!b || !b.seats) return out;
  for (let s = 0; s < 2; s++) for (let l = 0; l < 3; l++) for (let c = 0; c < 3; c++) out.push(fn(s, l, c, b.seats[s].cells[l][c]));
  return out.filter(Boolean);
};

// The spell effect of `next`, or null: {type: 'spell', card, seat, kind, faction, big, target} with
// target {seat, lane, cell} | {castle: seat} | {deck: seat} | null (nothing visible changed).
export function spellOf(prev, next) {
  const last = next && next.last;
  if (!last || last.kind !== 'CastSpell' || !last.card) return null;
  const spec = SPELLS[last.card] ?? { kind: 'motes', faction: 'neutral', effect: 'unknown' };
  const a = boardOf(prev), b = boardOf(next);
  const seat = last.seat;
  const at = (v, s, l, c) => (v && v.seats && v.seats[s] ? v.seats[s].cells[l][c] : null);
  let target = null;
  if (spec.effect === 'draw') target = { deck: seat };
  else if (spec.effect === 'shift') {
    // The unit that left (s, l, c) for (s, l±1, c).
    for (const t of units(a, (s, l, c, u) => u && !at(b, s, l, c) && { s, l, c, u })) {
      for (const nl of [t.l - 1, t.l + 1]) {
        const v = nl >= 0 && nl < 3 ? at(b, t.s, nl, t.c) : null;
        if (v && v.name === t.u.name && !at(a, t.s, nl, t.c)) target = { seat: t.s, lane: t.l, cell: t.c, toLane: nl };
      }
    }
  } else {
    const hit = units(a, (s, l, c, u) => {
      if (!u) return null;
      const v = at(b, s, l, c);
      const gone = !v || v.name !== u.name;
      if (spec.effect === 'heal') return !gone && v.damage < u.damage && { seat: s, lane: l, cell: c };
      return (gone || v.damage > u.damage) && { seat: s, lane: l, cell: c };
    });
    if (hit.length) target = hit[0];
    else if (spec.effect === 'damage' && a && b && a.seats && b.seats) {
      for (let s = 0; s < 2; s++) if (b.seats[s].life < a.seats[s].life) target = { castle: s };
    }
  }
  return { type: 'spell', card: last.card, seat, kind: spec.kind, faction: spec.faction, big: !!spec.big, target };
}
