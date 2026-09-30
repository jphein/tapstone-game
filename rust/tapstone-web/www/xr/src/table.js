// table.js: the in-page arena (tapstone_web.wasm, plan M1a) behind a small JS face. Each frame the
// page advances the simulated clock in 10 ms steps; views arrive as JSON lines. choices() is the
// engine's own menu for the person's seat, hand() their cards (private to this page), seat() the
// seat their shrine holds (null until the claim lands).
//
// Coming back (spec §3.5, logic/journal.js): with a store, every tap the engine accepts and every
// view is folded into the journal and saved before the call returns, and a stored journal is replayed
// on open. `resumed` says what happened: { from: 'journal', taps, clock, view } or
// { from: 'fresh', refused? }. A resumed table hands the replay's last view to the first advance().
import { decode, journalStore, newJournal, observe, replay } from './logic/journal.js';

export async function openTable(url, seed, human, store = journalStore(globalThis.localStorage)) {
  const { instance } = await WebAssembly.instantiateStreaming(fetch(url), {});
  return tableFrom(instance.exports, seed, human, store);
}

export function tableFrom(x, seed, human, store = null) {
  const read = (n) => new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.out_ptr(), n));
  let clock = 0, menu = [], menuAt = 0, journal = newJournal(seed, human), pending = null;
  let resumed = { from: 'fresh' };
  const text = store?.load();
  if (text != null) {
    const j = decode(text);
    const r = !j ? { ok: false, reason: 'unreadable' }
      : j.seed !== seed || j.human !== human ? { ok: false, reason: `foreign (seed ${j.seed}, seat ${j.human})` }
      : j.over ? { ok: false, reason: 'over' }
      : replay(x, read, j);
    if (r.ok && !x.table_done()) {
      journal = r.journal;
      clock = r.clock;
      pending = r.view;
      resumed = { from: 'journal', taps: journal.taps.length, clock, view: r.view };
    } else {
      store.clear();
      resumed = { from: 'fresh', refused: r.ok ? 'over' : r.reason };
    }
  }
  if (resumed.from === 'fresh') x.table_new(BigInt(seed), human);
  const save = () => store?.save(journal);
  return {
    get journal() {
      return journal;
    },
    resumed,
    advance(ms, onView) {
      if (pending) {
        const v = pending;
        pending = null;
        onView(v);
      }
      const until = clock + Math.floor(ms);
      let seen = false;
      for (; clock < until; clock += 10) {
        const n = x.table_step(BigInt(clock));
        if (n) for (const line of read(n).split('\n')) {
          const v = JSON.parse(line);
          observe(journal, v);
          seen = true;
          onView(v);
        }
      }
      journal.clock = clock;
      if (x.table_done()) journal.over = true;
      if (seen) save();
    },
    choices: () => {
      menu = JSON.parse(read(x.table_choices()));
      menuAt = clock;
      return menu;
    },
    hand: () => JSON.parse(read(x.table_hand())),
    seat: () => {
      const s = x.table_seat();
      return s === 255 ? null : s;
    },
    propose: (i) => {
      const item = menu[i];
      menu = [];
      if (!x.table_propose(i, BigInt(clock))) return false;
      journal.taps.push({ at: clock, menuAt, i, key: item.key });
      journal.clock = clock;
      save();
      return true;
    },
    done: () => !!x.table_done(),
    now: () => clock,
    // Drop the stored journal and stop saving (the IWER tools' fresh start, before a reload); this
    // page's match plays on, unrecorded.
    forget: () => {
      store?.clear();
      store = null;
    },
  };
}
