// journal-check.mjs: replay a journal the headset produced (an IWER run's output) through the wasm
// engine, the same verification a reload runs (logic/journal.js replay()), and check its final head.
// Exit 0 only if it replays exactly and the replayed match reached the journal's final head.
//   node tools/journal-check.mjs <run-output.json> [tapstone_web.wasm]
// The output may be the journal itself or any JSON holding one under "journal" (at any depth).
import { readFileSync } from 'node:fs';
import { decode, replay } from '../src/logic/journal.js';

const [file, wasm = new URL('../public/tapstone_web.wasm', import.meta.url)] = process.argv.slice(2);
const find = (o) => (!o || typeof o !== 'object' ? null : Array.isArray(o.taps) && 'head' in o ? o : Object.values(o).map(find).find(Boolean) ?? null);
const text = readFileSync(file, 'utf8');
const j = find(JSON.parse(text.slice(text.indexOf('{'))));
const d = j && decode(JSON.stringify({ ...j, over: false }));
if (!d) {
  console.log(JSON.stringify({ ok: false, reason: 'no well-formed journal in the output' }));
  process.exit(1);
}
const x = (await WebAssembly.instantiate(readFileSync(wasm), {})).instance.exports;
const read = (n) => new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.out_ptr(), n));
const r = replay(x, read, d);
const ok = r.ok && !!d.final && r.journal.final === d.final && !!x.table_done();
console.log(JSON.stringify({ ok, taps: d.taps.length, final: d.final, replayed: r.ok ? r.journal.final : null, done: !!x.table_done(), reason: r.reason ?? null }));
process.exit(ok ? 0 : 1);
