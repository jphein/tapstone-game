// The in-page arena's journal (spec 2026-09-25 §3.5 "Coming back"), in browser storage, in 0030's
// ledger shape: the match's transcript (every tap the person's seat sent) plus the chain head the
// arena's views carry. The bot's taps are not stored: the table is deterministic in (seed, taps, clock),
// so replaying the person's taps through the wasm engine rebuilds the whole match.
//
// A stored journal is never trusted. On load it is replayed from a fresh table, and it resumes only
// if the replay reproduces it exactly: every tap's key is the move at that index of the menu the engine
// offers at that moment, the engine accepts it, and the replayed match id, view seq, head and final
// head equal the stored ones. Anything else (corrupted, tampered, from another seed, seat or ruleset,
// or already over) is discarded and the page starts fresh.
export const RULES = 'tapstone-web/desk/1';
export const KEY = 'tapstone.xr.journal';
// Bounds a foreign journal can't push replay past: matches run under ten minutes (CLAUDE.md), so
// half an hour of play time and 2000 taps are far beyond any real one.
const MAX_CLOCK = 30 * 60 * 1000;
const MAX_TAPS = 2000;
const STEP = 10; // the table's clock step (table.js), in ms

export function newJournal(seed, human) {
  return { v: 1, rules: RULES, seed, human, match_id: null, clock: 0, taps: [], seq: 0, head: null, final: null, over: false };
}

// Fold one view (a JSON line from the table) into the journal.
export function observe(j, v) {
  if (typeof v.match_id === 'string') j.match_id = v.match_id;
  j.seq = v.seq ?? j.seq;
  j.head = v.head ?? null;
  if (v.phase === 'over' && j.final === null) j.final = v.head ?? null;
}

const int = (n, lo = 0, hi = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const hash = (h) => h === null || (typeof h === 'string' && /^[0-9a-f]{16}$/.test(h));

// Parse and shape-check stored text. Null for anything that isn't a well-formed journal; the shape
// check only bounds the replay, which is the real verification.
export function decode(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || j.v !== 1 || j.rules !== RULES) return null;
  if (!int(j.seed) || !(j.human === 0 || j.human === 1) || !int(j.clock, 0, MAX_CLOCK) || j.clock % STEP) return null;
  if (!(j.match_id === null || typeof j.match_id === 'string') || !int(j.seq) || !hash(j.head) || !hash(j.final) || typeof j.over !== 'boolean') return null;
  if (!Array.isArray(j.taps) || j.taps.length > MAX_TAPS) return null;
  let last = 0;
  for (const t of j.taps) {
    if (!t || typeof t.key !== 'string' || !int(t.i) || !int(t.menuAt, last) || !int(t.at, t.menuAt, j.clock)) return null;
    if (t.menuAt % STEP || t.at % STEP) return null;
    last = t.at;
  }
  return j;
}

// Replay `j` on a wasm table (`x`, its exports; `read(n)` the output buffer's text). Returns
// { ok: true, journal, view, clock } with the table left at j.clock, or { ok: false, reason }.
export function replay(x, read, j) {
  x.table_new(BigInt(j.seed), j.human);
  const got = newJournal(j.seed, j.human);
  let clock = 0, view = null;
  const stepTo = (until) => {
    for (; clock < until; clock += STEP) {
      const n = x.table_step(BigInt(clock));
      if (n) for (const line of read(n).split('\n')) observe(got, (view = JSON.parse(line)));
    }
  };
  for (const [k, t] of j.taps.entries()) {
    stepTo(t.menuAt);
    const item = JSON.parse(read(x.table_choices()))[t.i];
    if (!item || item.key !== t.key) return { ok: false, reason: `tap ${k}: ${t.key} is not item ${t.i} of the menu at ${t.menuAt} ms` };
    stepTo(t.at);
    if (!x.table_propose(t.i, BigInt(t.at))) return { ok: false, reason: `tap ${k}: the engine refused ${t.key}` };
    got.taps.push({ ...t });
  }
  stepTo(j.clock);
  got.clock = clock;
  for (const f of ['match_id', 'seq', 'head', 'final']) {
    if (got[f] !== j[f]) return { ok: false, reason: `${f}: stored ${j[f]}, replayed ${got[f]}` };
  }
  return { ok: true, journal: got, view, clock };
}

// A journal store over localStorage's surface (getItem/setItem/removeItem). localStorage because its
// write is synchronous: the tap and its record land in the same task, so a reload can never see one
// without the other. Every method swallows storage errors (private mode, quota): coming back is a
// convenience, never a reason the match can't be played.
export function journalStore(storage, key = KEY) {
  return {
    load() {
      try {
        return storage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    save(j) {
      try {
        storage?.setItem(key, JSON.stringify(j));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        storage?.removeItem(key);
      } catch {
        /* nothing to clear */
      }
    },
  };
}
