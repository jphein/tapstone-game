// voice_eval.mjs: how well the shipped keyword spotter hears the grammar, measured on a corpus of
// recorded commands. It runs exactly what the page runs (public/kws: the shim, the prebuilt glue,
// the model, keywords.txt, and logic/voice-commands.js KWS_CONFIG) in a bare vm context, as the
// worker does, and scores the FIRST phrase spotted in each clip against the clip's transcript.
//
//   node tools/voice_eval.mjs <index.txt>...     index lines: <wav path>|<transcript> (16 kHz mono
//                                                s16 WAV); a transcript of "-" is a non-command, where
//                                                any phrase spotted is a false alarm
//
// The corpus used on 2026-09-28 was synthesised with Piper voices on familiar (6 voices x 25
// commands, 3 voices x 8 non-command sentences): TTS, not people in a room. The Quest 2 run is the
// lead's. Prints JSON: right, wrong (a different command: the costly error), missed, false alarms,
// the real-time factor, and the init time and heap.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KWS_CONFIG, parse } from '../src/logic/voice-commands.js';

// KWS_DIR: another model laid out as public/kws (to compare weights); KWS_CONFIG_JSON: settings over
// logic/voice-commands.js KWS_CONFIG (to tune them). Both default to what ships.
const K = process.env.KWS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '../public/kws');
const CONFIG = { ...KWS_CONFIG, ...JSON.parse(process.env.KWS_CONFIG_JSON ?? '{}') };
const ctx = { console, WebAssembly, TextDecoder, TextEncoder, performance, URL, setTimeout, clearTimeout, crypto: globalThis.crypto };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['kws-node-shim.js', 'kws-glue.js', 'kws-api.js']) vm.runInContext(readFileSync(join(K, f), 'utf8'), ctx, { filename: f });
const rss0 = process.memoryUsage().rss;
const t0 = performance.now();
const mod = { wasmBinary: readFileSync(join(K, 'kws.wasm')), print: () => {}, printErr: () => {} };
await ctx.Module(mod);
for (const f of ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']) ctx.KWS_SHIM.files.set(`/${f}`, new Uint8Array(readFileSync(join(K, f))));
const kws = ctx.createKws(mod, {
  featConfig: { samplingRate: 16000, featureDim: 80 },
  modelConfig: { transducer: { encoder: '/encoder.int8.onnx', decoder: '/decoder.int8.onnx', joiner: '/joiner.int8.onnx' }, tokens: '/tokens.txt', numThreads: 1, provider: 'cpu', debug: 0 },
  ...CONFIG,
  keywords: readFileSync(join(K, 'keywords.txt'), 'utf8'),
});
const init = { ms: Math.round(performance.now() - t0), wasmHeapMB: +((mod.HEAP8 ?? mod.HEAPU8)?.length / 1e6 || (mod.wasmMemory?.buffer.byteLength ?? 0) / 1e6).toFixed(1), rssDeltaMB: +((process.memoryUsage().rss - rss0) / 1e6).toFixed(1) };

const wavF32 = (p) => {
  const b = readFileSync(p);
  let o = 12;
  while (o < b.length && b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4);
  const pcm = new Int16Array(b.buffer.slice(b.byteOffset + o + 8, b.byteOffset + o + 8 + b.readUInt32LE(o + 4)));
  return Float32Array.from(pcm, (v) => v / 32768);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const out = { model: K, config: CONFIG, right: 0, wrong: 0, missed: 0, commands: 0, falseAlarms: 0, nonCommands: 0, rtf: 0, init, errors: [] };
let busy = 0, audio = 0;
for (const idx of process.argv.slice(2)) {
  for (const line of readFileSync(idx, 'utf8').trim().split('\n')) {
    const [wav, text] = line.split('|');
    const f32 = wavF32(wav);
    const pad = new Float32Array(8000);
    const s = kws.createStream();
    const heard = [];
    const t = performance.now();
    for (const chunk of [pad, f32, pad, pad, pad]) {
      for (let i = 0; i < chunk.length; i += 1600) {
        s.acceptWaveform(16000, chunk.slice(i, i + 1600));
        while (kws.isReady(s)) {
          kws.decode(s);
          const r = kws.getResult(s);
          if (r.keyword) {
            heard.push(r.keyword);
            kws.reset(s);
          }
        }
      }
    }
    busy += performance.now() - t;
    audio += (f32.length + 4 * 8000) / 16;
    s.free();
    if (text === '-') {
      out.nonCommands++;
      if (heard.length) (out.falseAlarms++, out.errors.push(`false alarm: ${heard[0]} in ${wav}`));
      continue;
    }
    out.commands++;
    if (!heard.length) (out.missed++, out.errors.push(`missed: "${text}" (${wav})`));
    else if (same(parse(heard[0]), parse(text))) out.right++;
    else (out.wrong++, out.errors.push(`wrong: "${text}" heard ${heard[0]} (${wav})`));
  }
}
out.rtf = +(busy / audio).toFixed(3);
console.log(JSON.stringify(out, null, 2));
