// direct.js: the creatures' director (pure). It turns the effect queue, in the order it plays, into
// what each creature does, and keeps one creature per occupied cell. The scene (system.js) only
// carries out its ops. Whenever the queue is settled it reconciles to the newest view, because the queue
// may drop effects in a backlog (logic/effects.js): motion can be lost, but once no placing effect
// is queued (settled()) the creatures on the board are the units in the view.
//
// A creature's state: forming → idle; idle → attack | hit | moving → idle; any → dying → gone.
import { boardOf } from './combat.js';

// How long each state lasts, in ms (`reduced`: with reduced motion, logic/access.js).
export const STATE_MS = {
  // forming: the whelp's summon is the longest (its card, then look.js SOAR: 900 + 3600 ms).
  forming: 4600, attack: 700, hit: 450, moving: 500, dying: 1000,
  reduced: { forming: 400, attack: 250, hit: 200, moving: 1, dying: 300 },
};
const msFor = (state, reduced) => (reduced ? STATE_MS.reduced[state] : STATE_MS[state]);

export const keyOf = (seat, lane, cell) => `${seat}:${lane}:${cell}`;

// The effects that change which unit stands where. While none is still queued, the director has
// applied every one that will ever reach it, so the creatures can be reconciled to the newest view:
// the damage, chips, strikes and spells still waiting are motion only.
const PLACING = new Set(['summon', 'death', 'advance', 'shift']);
export const settled = (queued) => !queued.some((e) => PLACING.has(e.type));

export class Director {
  constructor({ reduced = false } = {}) {
    this.reduced = reduced;
    this.slots = new Map(); // key → creature
    this.dying = []; // creatures leaving the board
  }

  set(state, c, now) {
    c.state = state;
    c.since = now;
    c.until = now + msFor(state, this.reduced);
  }

  spawn(e, now, origin, ops) {
    const key = keyOf(e.seat, e.lane, e.cell);
    const old = this.slots.get(key);
    if (old) ops.push({ op: 'remove', key, id: old.id });
    const c = { id: `${key}#${now}#${e.name}`, key, name: e.name, faction: e.faction, commander: !!e.commander, keyword: e.keyword ?? null, seat: e.seat, lane: e.lane, cell: e.cell };
    this.set('forming', c, now);
    this.slots.set(key, c);
    ops.push({ op: 'spawn', key, id: c.id, unit: { name: c.name, faction: c.faction, commander: c.commander, keyword: c.keyword }, seat: c.seat, lane: c.lane, cell: c.cell, origin });
  }

  move(fromKey, seat, lane, cell, now, ops) {
    const c = this.slots.get(fromKey);
    if (!c) return;
    const to = keyOf(seat, lane, cell);
    this.slots.delete(fromKey);
    const old = this.slots.get(to);
    if (old) ops.push({ op: 'remove', key: to, id: old.id });
    Object.assign(c, { key: to, seat, lane, cell });
    this.slots.set(to, c);
    this.set('moving', c, now);
    ops.push({ op: 'move', id: c.id, from: fromKey, key: to, seat, lane, cell });
  }

  // One effect as it starts playing (EffectsSystem.onEffect); `near` is the person's seat.
  apply(e, now, near) {
    const ops = [];
    if (e.type === 'summon') {
      // A commander, or the first board, rises where it stands; a card flies from my pad, or from the far keep.
      const origin = e.commander || e.initial ? 'here' : e.seat === near ? 'pad' : 'keep';
      this.spawn(e, now, origin, ops);
    } else if (e.type === 'death') {
      const key = keyOf(e.seat, e.lane, e.cell);
      const c = this.slots.get(key);
      if (c) {
        this.slots.delete(key);
        this.set('dying', c, now);
        this.dying.push(c);
        ops.push({ op: 'die', key, id: c.id });
      }
    } else if (e.type === 'advance') {
      this.move(keyOf(e.seat, e.lane, e.from), e.seat, e.lane, e.to, now, ops);
    } else if (e.type === 'shift') {
      this.move(keyOf(e.seat, e.lane, e.cell), e.seat, e.toLane, e.cell, now, ops);
    } else if (e.type === 'damage') {
      const c = this.slots.get(keyOf(e.seat, e.lane, e.cell));
      if (c && c.state !== 'forming') {
        this.set('hit', c, now);
        ops.push({ op: 'hit', key: c.key, id: c.id });
      }
    } else if (e.type === 'strike') {
      for (const a of e.attacks) {
        const c = this.slots.get(keyOf(a.seat, a.lane, a.cell));
        if (!c) continue;
        this.set('attack', c, now);
        ops.push({ op: 'attack', key: c.key, id: c.id, ranged: a.ranged, target: a.target });
      }
    } else if (e.type === 'spell') {
      ops.push({ op: 'spell', spell: e });
    }
    return ops;
  }

  // Time passing: finished states fall back to idle, and finished deaths leave.
  tick(now) {
    const ops = [];
    for (const c of this.slots.values()) {
      if (c.state === 'idle' || now < c.until) continue;
      c.state = 'idle';
      c.since = now;
      c.until = Infinity;
    }
    this.dying = this.dying.filter((c) => {
      if (now < c.until) return true;
      ops.push({ op: 'remove', key: c.key, id: c.id });
      return false;
    });
    return ops;
  }

  // Make the creatures the view's units (call when the queue is settled()). A missing
  // creature appears where it stands; a creature with no unit fades.
  reconcile(view, now) {
    const ops = [];
    const b = boardOf(view);
    const want = new Map();
    if (b && b.seats && b.seats.length) {
      for (let s = 0; s < 2; s++) for (let l = 0; l < 3; l++) for (let c = 0; c < 3; c++) {
        const u = b.seats[s].cells[l][c];
        if (u) want.set(keyOf(s, l, c), { seat: s, lane: l, cell: c, ...u, commander: !!u.commander });
      }
    }
    for (const [key, c] of [...this.slots]) {
      const u = want.get(key);
      if (!u || u.name !== c.name) {
        this.slots.delete(key);
        this.set('dying', c, now);
        this.dying.push(c);
        ops.push({ op: 'die', key, id: c.id });
      }
    }
    for (const [key, u] of want) {
      if (!this.slots.has(key)) this.spawn(u, now, 'here', ops);
    }
    return ops;
  }

  stateOf(key) {
    return this.slots.get(key)?.state ?? null;
  }

  // Slots and their creature's name, for the tests and __tapstone.summons.
  census() {
    return Object.fromEntries([...this.slots].map(([k, c]) => [k, c.name]));
  }
}

// The view's units, in census() form.
export function unitsOf(view) {
  const b = boardOf(view);
  const out = {};
  if (!b || !b.seats || !b.seats.length) return out;
  for (let s = 0; s < 2; s++) for (let l = 0; l < 3; l++) for (let c = 0; c < 3; c++) {
    const u = b.seats[s].cells[l][c];
    if (u) out[keyOf(s, l, c)] = u.name;
  }
  return out;
}
