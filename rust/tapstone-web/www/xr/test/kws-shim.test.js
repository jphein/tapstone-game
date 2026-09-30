// The keyword spotter runs in a browser worker (public/kws/kws-worker.js) on sherpa-onnx's prebuilt
// wasm, whose glue is Node-only; kws-node-shim.js gives it just enough of Node. Here the glue runs in
// a bare vm context (no require, no process: a stand-in for the worker), first without the shim
// (it must fail: the control), then with it (the spotter must build, and hear no phrase in silence).
// Needs the fetched binaries (node tools/fetch_kws.mjs); skipped without them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { KWS_CONFIG } from '../src/logic/voice-commands.js';

const K = join(dirname(fileURLToPath(import.meta.url)), '../public/kws');
const have = existsSync(join(K, 'kws.wasm')) && existsSync(join(K, 'kws-glue.js'));
const skip = have ? false : 'public/kws not fetched (node tools/fetch_kws.mjs)';

const bare = () => {
  const ctx = { console, WebAssembly, TextDecoder, TextEncoder, performance, URL, setTimeout, clearTimeout, crypto: globalThis.crypto };
  ctx.globalThis = ctx;
  return vm.createContext(ctx);
};
const run = (ctx, f) => vm.runInContext(readFileSync(join(K, f), 'utf8'), ctx, { filename: f });

test('without the shim, the prebuilt glue cannot start outside Node (the control)', { skip }, async () => {
  const ctx = bare();
  let failed = null;
  try {
    run(ctx, 'kws-glue.js');
    await ctx.Module({ wasmBinary: readFileSync(join(K, 'kws.wasm')), print: () => {}, printErr: () => {} });
  } catch (e) {
    failed = String(e?.message ?? e);
  }
  assert.match(failed ?? '', /require is not defined|NODERAWFS|process/);
});

test('with the shim, the spotter builds from memory and hears nothing in silence', { skip }, async () => {
  const ctx = bare();
  for (const f of ['kws-node-shim.js', 'kws-glue.js', 'kws-api.js']) run(ctx, f);
  const mod = { wasmBinary: readFileSync(join(K, 'kws.wasm')), print: () => {}, printErr: () => {} };
  await ctx.Module(mod);
  for (const f of ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']) ctx.KWS_SHIM.files.set(`/${f}`, new Uint8Array(readFileSync(join(K, f))));
  const kws = ctx.createKws(mod, {
    featConfig: { samplingRate: 16000, featureDim: 80 },
    modelConfig: { transducer: { encoder: '/encoder.int8.onnx', decoder: '/decoder.int8.onnx', joiner: '/joiner.int8.onnx' }, tokens: '/tokens.txt', numThreads: 1, provider: 'cpu', debug: 0 },
    ...KWS_CONFIG,
    keywords: readFileSync(join(K, 'keywords.txt'), 'utf8'),
  });
  assert.ok(kws.handle, 'the spotter was created');
  const s = kws.createStream();
  const heard = [];
  for (let i = 0; i < 20; i++) {
    s.acceptWaveform(16000, new Float32Array(1600));
    while (kws.isReady(s)) {
      kws.decode(s);
      const r = kws.getResult(s);
      if (r.keyword) heard.push(r.keyword);
    }
  }
  assert.deepEqual(heard, []);
  // Nothing outside the shim's map can be opened: a missing model is an error, not a network fetch.
  assert.throws(() => ctx.KWS_SHIM.fs.openSync('/nope.onnx', 0), /ENOENT/);
});
