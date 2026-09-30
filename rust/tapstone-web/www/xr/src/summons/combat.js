// combat.js: who attacks whom at a turn's end, read from the view before the Pass (pure). Combat is
// the rules crate's (tapstone-rules rules.rs `combat` and `target_in_lane`), recomputed here only to
// animate it; the board still shows what the engine said.
//
//   A unit attacks from the front cell (cell 2), or from any cell if it is Ranged.
//   A Taunt anywhere in the enemy lane draws every attacker (the nearest, front to back).
//   Otherwise Ranged hits the nearest enemy (front to back), melee only the enemy front cell.
//   No target: the castle.
// test/summons.test.js holds the castle damage this predicts to the record's `combat_damage`.

const FRONT = 2;
const ORDER = [2, 1, 0];

export const boardOf = (v) => (v && v.phase === 'lobby' && !v.lobby.length && v.last_over ? v.last_over : v);

export function targetInLane(enemy, ranged) {
  const taunt = ORDER.find((c) => enemy[c] && enemy[c].keyword === 'Taunt');
  if (taunt !== undefined) return taunt;
  if (ranged) {
    const t = ORDER.find((c) => enemy[c]);
    return t === undefined ? null : t;
  }
  return enemy[FRONT] ? FRONT : null;
}

// Every attack of a turn's end, or [] if `next` is not one. Each: {seat, lane, cell, ranged, amount,
// target: {seat, lane, cell} | {castle: seat}}.
export function strikesOf(prev, next) {
  const last = next && next.last;
  if (!last || last.kind !== 'Pass' || !/^(TurnEnded|GameEnded)/.test(last.applied || '')) return [];
  const a = boardOf(prev);
  if (!a || !a.seats || !a.seats.length || a.phase !== 'playing') return [];
  const out = [];
  for (let me = 0; me < 2; me++) {
    const opp = 1 - me;
    for (let lane = 0; lane < 3; lane++) {
      for (let cell = 0; cell < 3; cell++) {
        const u = a.seats[me].cells[lane][cell];
        if (!u || !u.attack) continue;
        const ranged = u.keyword === 'Ranged';
        if (cell !== FRONT && !ranged) continue;
        const t = targetInLane(a.seats[opp].cells[lane], ranged);
        out.push({ seat: me, lane, cell, ranged, amount: u.attack, name: u.name, target: t === null ? { castle: opp } : { seat: opp, lane, cell: t } });
      }
    }
  }
  return out;
}
