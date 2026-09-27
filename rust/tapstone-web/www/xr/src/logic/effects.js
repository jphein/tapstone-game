// effects.js: what to animate, computed from two consecutive view models (0027's amendment: state
// only the view needs is computed by the view, never sent). Pure; tested against the real desk
// fixture. The scene plays these in order; the board itself always shows the newest view.
//
// Effect types (spec 2026-09-25 §3.2 / experience.md §3.2):
//   summon {seat, lane, cell, faction, commander}   a unit arrived: the arc from the altar, the rise
//   advance {seat, lane, from, to}                  a unit stepped forward
//   damage {seat, lane, cell, amount}               a unit was struck: stagger + rim flash
//   death {seat, lane, cell, faction}               a unit is gone: the crumble
//   clash {lane}                                    both front cells of a lane were hit at once
//   keepChip {seat, amount}                         a castle lost life: a chip flies off the keep
//   chargeGem {seat}                                a mana gem lit
//   drawFlip {seat, card}                           a card was drawn (card name: the person's own draws only)
//   commanderFall {seat, lane}, commanderReturn {seat, lane}
//   result {winner}                                 the match ended (winner null: void)

const board = (v) => (v && v.phase === 'lobby' && !v.lobby.length && v.last_over ? v.last_over : v);
const unitAt = (v, s, l, c) => (v && v.seats && v.seats[s] ? v.seats[s].cells[l][c] : null);

export function diffViews(prev, next, mySeat = null) {
  const a = board(prev), b = board(next);
  const out = [];
  if (!b || !b.seats || !b.seats.length) return out;
  const hadBoard = a && a.seats && a.seats.length;
  const last = next.last || {};
  const moved = new Set(); // "s:l:c" keys consumed by an advance pairing
  // Advances: the acting seat's units in one lane shift forward; pair each vanished unit with an
  // appeared one of the same name further forward in the same lane.
  if (hadBoard && last.kind === 'Advance') {
    const s = last.seat;
    for (let l = 0; l < 3; l++) {
      for (let c = 2; c >= 0; c--) {
        const was = unitAt(a, s, l, c);
        if (!was || (unitAt(b, s, l, c) && unitAt(b, s, l, c).name === was.name)) continue;
        for (let d = c + 1; d <= 2; d++) {
          const now = unitAt(b, s, l, d);
          if (now && now.name === was.name && !moved.has(`${s}:${l}:${d}`) && !(unitAt(a, s, l, d) && unitAt(a, s, l, d).name === now.name)) {
            out.push({ type: 'advance', seat: s, lane: l, from: c, to: d });
            moved.add(`${s}:${l}:${c}`);
            moved.add(`${s}:${l}:${d}`);
            break;
          }
        }
      }
    }
  }
  const hit = [[false, false, false], [false, false, false]]; // front-cell hits per seat per lane
  for (let s = 0; s < 2; s++) {
    for (let l = 0; l < 3; l++) {
      for (let c = 0; c < 3; c++) {
        const key = `${s}:${l}:${c}`;
        const was = hadBoard ? unitAt(a, s, l, c) : null;
        const now = unitAt(b, s, l, c);
        if (moved.has(key)) {
          if (was && now && now.name === was.name && now.damage > was.damage) {
            out.push({ type: 'damage', seat: s, lane: l, cell: c, amount: now.damage - was.damage });
          }
          continue;
        }
        if (now && (!was || was.name !== now.name)) {
          if (was) out.push({ type: 'death', seat: s, lane: l, cell: c, faction: was.faction });
          out.push({ type: 'summon', seat: s, lane: l, cell: c, faction: now.faction, commander: !!now.commander });
        } else if (was && !now) {
          out.push({ type: 'death', seat: s, lane: l, cell: c, faction: was.faction });
          if (c === 2) hit[s][l] = true;
        } else if (was && now && now.damage > was.damage) {
          out.push({ type: 'damage', seat: s, lane: l, cell: c, amount: now.damage - was.damage });
          if (c === 2) hit[s][l] = true;
        }
      }
    }
  }
  for (let l = 0; l < 3; l++) if (hit[0][l] && hit[1][l]) out.push({ type: 'clash', lane: l });
  if (hadBoard) {
    for (let s = 0; s < 2; s++) {
      const was = a.seats[s], now = b.seats[s];
      if (now.life < was.life) out.push({ type: 'keepChip', seat: s, amount: was.life - now.life });
      if (now.charged > was.charged) out.push({ type: 'chargeGem', seat: s });
      if (was.commander_returns === 0 && now.commander_returns > 0) out.push({ type: 'commanderFall', seat: s, lane: now.commander_lane });
      if (was.commander_returns > 0 && now.commander_returns === 0) out.push({ type: 'commanderReturn', seat: s, lane: now.commander_lane });
    }
    if (last.kind === 'Draw' && b.seats[last.seat] && b.seats[last.seat].hand > a.seats[last.seat].hand) {
      out.push({ type: 'drawFlip', seat: last.seat, card: last.seat === mySeat ? last.card : null });
    }
  }
  if (b.phase === 'over' && (!a || a.phase !== 'over')) out.push({ type: 'result', winner: b.winner ?? null });
  return out;
}

// How long each effect plays, in ms. One big effect at a time, in record order.
export const DURATION = {
  summon: 600, advance: 250, damage: 250, death: 400, clash: 350, keepChip: 300,
  chargeGem: 250, drawFlip: 250, commanderFall: 500, commanderReturn: 600, result: 2000,
};

// The queue the scene drains. If records arrive faster than effects play, it compresses: past
// `maxPending` effects it drops the oldest (the board already shows the newest state, so nothing
// is lost but motion), always keeping a `result`. The view is never behind the chain.
export class EffectQueue {
  constructor({ maxPending = 8 } = {}) {
    this.maxPending = maxPending;
    this.items = [];
    this.playing = null;
  }
  push(effects) {
    this.items.push(...effects);
    while (this.items.length > this.maxPending) {
      const drop = this.items.findIndex((e) => e.type !== 'result');
      if (drop < 0) break;
      this.items.splice(drop, 1);
    }
  }
  // The effect to start now, or null while one is still playing or the queue is empty.
  next(now) {
    if (this.playing && now < this.playing.until) return null;
    this.playing = null;
    const e = this.items.shift();
    if (!e) return null;
    this.playing = { effect: e, until: now + (DURATION[e.type] ?? 300) };
    return e;
  }
  get length() {
    return this.items.length;
  }
}
