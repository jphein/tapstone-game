// table.js: the in-page arena (tapstone_web.wasm, plan M1a) behind a small JS face. Each frame the
// page advances the simulated clock in 10 ms steps; views arrive as JSON lines. choices() is the
// engine's own menu for the person's seat, hand() their cards (private to this page), seat() the
// seat their shrine holds (null until the claim lands).
export async function openTable(url, seed, human) {
  const { instance } = await WebAssembly.instantiateStreaming(fetch(url), {});
  const x = instance.exports;
  const read = (n) => new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.out_ptr(), n));
  x.table_new(BigInt(seed), human);
  let clock = 0n;
  return {
    advance(ms, onView) {
      const until = clock + BigInt(Math.floor(ms));
      for (; clock < until; clock += 10n) {
        const n = x.table_step(clock);
        if (n) for (const line of read(n).split('\n')) onView(JSON.parse(line));
      }
    },
    choices: () => JSON.parse(read(x.table_choices())),
    hand: () => JSON.parse(read(x.table_hand())),
    seat: () => {
      const s = x.table_seat();
      return s === 255 ? null : s;
    },
    propose: (i) => !!x.table_propose(i, clock),
    done: () => !!x.table_done(),
    now: () => Number(clock),
  };
}
