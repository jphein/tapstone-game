// doors.js: when a teahouse door stirs (0039: "a door reacts to play"), read from the arena's views.
// The same rules as the Roblox tea house (roblox/src/shared/DoorSigns.luau), so both rooms answer
// the same match the same way:
//   - a cast (CastUnit or CastSpell, the view's own `last` record) stirs the door of the CARD's
//     faction, so a neutral card stirs the Hearthlands door (lead decision 2026-09-28);
//   - a win stirs the winning seat's door (there is no neutral seat, so wins stay per faction);
//   - the first view only primes, so joining mid-match never replays an old cast.
// Pure; test/doors.test.js plays it the desk fixture and a fresh match from the in-page arena.

// Every set 1 card's faction, by the name the view's `last.card` carries. game/cards/set1/*.toml is
// the source: the test fails if a card is missing, extra or has another faction.
export const CARD_FACTION = {
  'Ember Castle': 'ember', 'Tide Castle': 'tide',
  'Cinder Whelp': 'ember', 'Ashen Vanguard': 'ember', 'Hearth Warden': 'ember', 'Flare': 'ember',
  'Forge Runner': 'ember', 'Bellows Raider': 'ember', 'Slag Brute': 'ember', 'Magma Burst': 'ember',
  'Reef Archer': 'tide', 'Tidecaller': 'tide', 'Pearl Shieldbearer': 'tide', 'Tidal Lash': 'tide',
  'Undertow': 'tide', 'Riptide': 'tide', 'Brine Skimmer': 'tide', 'Trench Leviathan': 'tide',
  'Deep Breath': 'neutral', 'Mend': 'neutral',
};

const CASTS = new Set(['CastUnit', 'CastSpell']);
const board = (v) => (v.phase === 'lobby' && !v.lobby.length && v.last_over ? v.last_over : v);

export function doorSigns() {
  return { primed: false, match: null, seq: -1, won: false };
}

// Reads one view; returns what stirred since the last one: [{kind: 'cast' | 'win', faction, seat}].
export function doorStep(state, v) {
  const b = board(v);
  const out = [];
  if (b.match_id != null && b.match_id !== state.match) {
    // A new match: its events are all new (a lobby frame keeps the finished board, same id).
    state.match = b.match_id;
    state.seq = -1;
    state.won = false;
  }
  const last = b.last;
  const seq = last && typeof last.seq === 'number' ? last.seq : null;
  const winner = b.phase === 'over' ? b.winner ?? null : null;
  const seatFaction = (s) => (typeof s === 'number' ? b.seats?.[s]?.faction : undefined);
  if (!state.primed) {
    state.primed = true;
    state.seq = seq ?? -1;
    state.won = winner !== null;
    return out;
  }
  if (seq !== null && seq > state.seq) {
    state.seq = seq;
    // The card's own faction; a card this list doesn't know falls back to the seat that cast it.
    const faction = CARD_FACTION[last.card] ?? seatFaction(last.seat);
    if (CASTS.has(last.kind) && faction) out.push({ kind: 'cast', faction, seat: last.seat });
  }
  if (winner !== null && !state.won) {
    state.won = true;
    const faction = seatFaction(winner);
    if (faction) out.push({ kind: 'win', faction, seat: winner });
  }
  return out;
}
