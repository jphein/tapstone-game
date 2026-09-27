// The tapstone-web gate, run against the built .wasm (no CI here: judge it by its exit status).
//   node tapstone-web/gate.mjs <tapstone_web.wasm> tapstone-arena/web/fixtures/desk-seed11.jsonl
// 1. Nobody seated reproduces the committed desk fixture byte for byte (the arena's own core, in wasm).
// 2. A perturbed fixture is caught (the check can see).
// 3. A person in seat 0, choosing from the engine's menu, finishes the match.
// 4. The same seat with nobody choosing stalls (3 finishes because of the person's taps).
import fs from "node:fs";

const [wasmPath, fixturePath] = process.argv.slice(2);
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
const x = instance.exports;
const read = (n) => new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.out_ptr(), n));
let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failed++;
};

function record(seed) {
  x.table_new(BigInt(seed), 255);
  const lines = [];
  for (let s = 0n; s < 20000n; s++) {
    const n = x.table_step(s * 10n);
    if (n) lines.push(read(n));
    if (x.table_done()) break;
  }
  return lines.join("\n");
}

function play(person) {
  x.table_new(11n, 0);
  let taps = 0;
  for (let s = 0n; s < 40000n; s++) {
    x.table_step(s * 10n);
    if (x.table_done()) return { done: true, taps };
    if (!person) continue;
    const menu = JSON.parse(read(x.table_choices()));
    const i = menu.findIndex((c) => c.useful && c.kind !== "Mulligan");
    if (i >= 0) {
      if (!x.table_propose(i, s * 10n)) throw new Error(`menu item ${i} was not sent`);
      taps++;
    }
  }
  return { done: false, taps };
}

const fixture = fs.readFileSync(fixturePath, "utf8").trim();
const t0 = performance.now();
const fresh = record(11);
const ms = (performance.now() - t0).toFixed(1);
check(fresh === fixture, `nobody seated equals the fixture (${fresh.split("\n").length} lines, ${ms} ms)`);

const bent = fixture.split("\n");
bent[39] = bent[39].replace("1", "2");
check(bent.join("\n") !== fixture && fresh !== bent.join("\n"), "a perturbed fixture is caught");

const p = play(true);
check(p.done && p.taps >= 5, `a person in seat 0 finishes (${p.taps} taps)`);
const alone = play(false);
check(!alone.done && alone.taps === 0, "the same seat left alone stalls");

process.exitCode = failed ? 1 : 0;
