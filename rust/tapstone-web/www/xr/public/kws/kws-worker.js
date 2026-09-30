// kws-worker.js: the on-device keyword spotter, off the main thread (voice commands; src/voice-input.js
// starts it). A classic worker, because the sherpa-onnx glue is a classic script.
//
// Nothing here touches the network: the page fetched every byte during load (voice-input.js
// preloadKws) and sends them in 'init'; the shim, the glue and the API are run from blob URLs, the
// wasm is passed as wasmBinary, and the model's files are served from memory by the shim
// (kws-node-shim.js: the prebuilt glue is Node-only, and its file calls go to the shim's `fs`).
//
//   main -> { type: 'init', shim, glue, api (script text), wasm (ArrayBuffer), files: { name: ArrayBuffer },
//             keywords (text), config (logic/voice-commands.js KWS_CONFIG), port (from the worklet) }
//   worklet -> (port) Float32Array chunks at 16 kHz
//   worker -> { type: 'ready', ms } | { type: 'keyword', tag, at } | { type: 'stats', rtf, audioS, rms } |
//             { type: 'error', message }
let kws = null, stream = null, busyMs = 0, audioS = 0, lastStats = 0, sq = 0, n = 0;

function run(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  importScripts(url);
  URL.revokeObjectURL(url);
}

async function init(msg) {
  const t0 = performance.now();
  run(msg.shim); // defines process, require, KWS_SHIM
  run(msg.glue); // defines Module (a factory)
  run(msg.api); // defines createKws
  const mod = {
    wasmBinary: msg.wasm,
    print: () => {},
    printErr: (s) => console.warn('[kws]', s),
  };
  await Module(mod);
  for (const [name, buf] of Object.entries(msg.files)) KWS_SHIM.files.set(`/${name}`, new Uint8Array(buf));
  kws = createKws(mod, {
    featConfig: { samplingRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: '/encoder.int8.onnx', decoder: '/decoder.int8.onnx', joiner: '/joiner.int8.onnx' },
      tokens: '/tokens.txt',
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
    },
    ...msg.config,
    keywords: msg.keywords,
  });
  stream = kws.createStream();
  msg.port.onmessage = (e) => feed(e.data);
  postMessage({ type: 'ready', ms: Math.round(performance.now() - t0) });
}

function feed(samples) {
  if (!kws) return;
  const t = performance.now();
  stream.acceptWaveform(16000, samples);
  while (kws.isReady(stream)) {
    kws.decode(stream);
    const r = kws.getResult(stream);
    if (r.keyword) {
      postMessage({ type: 'keyword', tag: r.keyword, at: Date.now() });
      kws.reset(stream);
    }
  }
  busyMs += performance.now() - t;
  audioS += samples.length / 16000;
  for (let i = 0; i < samples.length; i++) sq += samples[i] * samples[i];
  n += samples.length;
  if (audioS - lastStats >= 5) {
    // rms: the audio that reached the spotter (0 = silence arrived, not the mic's fault upstream).
    postMessage({ type: 'stats', rtf: busyMs / 1000 / audioS, audioS, rms: Math.sqrt(sq / Math.max(1, n)) });
    lastStats = audioS;
    sq = n = 0;
  }
}

onmessage = (e) => {
  if (e.data?.type === 'init') init(e.data).catch((err) => postMessage({ type: 'error', message: String(err?.message ?? err) }));
};
