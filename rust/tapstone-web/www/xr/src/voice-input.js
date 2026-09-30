// voice-input.js: the microphone and the on-device keyword spotter (voice commands; design note
// docs/superpowers/specs/2026-09-28-xr-accessibility-design.md). It knows no game: it reports the
// phrases it spots (logic/voice-commands.js is the grammar, assist.js plays them).
//
// Measured on JP's Quest 2 (Quest Browser 152): no SpeechRecognition, no speechSynthesis, but
// getUserMedia. So the spotting runs here, in WASM (sherpa-onnx, public/kws/), in a Worker:
//   mic -> AudioWorklet (resampled to 16 kHz, 100 ms chunks, and a level for the indicator)
//       -> MessagePort -> Worker (the spotter) -> { keyword } -> the main thread.
// The render loop pays nothing per audio frame: the worklet posts straight to the worker.
//
// The mic opens only on start(), which only an explicit opt-in calls (the page's first-run offer,
// the settings panel by hand, gaze or voice), and stop() closes it: the track is stopped, so the
// browser's own mic indicator goes out too.
//
// Every byte is fetched DURING load (preloadKws): the page makes no request after "loaded" (net.js),
// even when voice is first turned on mid-match.
import { KWS_CONFIG } from './logic/voice-commands.js';

const FILES = ['kws.wasm', 'kws-node-shim.js', 'kws-glue.js', 'kws-api.js', 'kws-worker.js', 'encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt', 'keywords.txt'];

// The bytes, or null if any file is missing (a clone that hasn't run tools/fetch_kws.mjs): voice
// is then offered as unavailable, and nothing else changes.
export async function preloadKws(base) {
  try {
    const got = await Promise.all(FILES.map(async (f) => {
      const r = await fetch(`${base}kws/${f}`);
      if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
      return [f, await r.arrayBuffer()];
    }));
    const b = Object.fromEntries(got);
    const bytes = got.reduce((n, [, v]) => n + v.byteLength, 0);
    console.log(`[voice-input] keyword spotter preloaded: ${(bytes / 1e6).toFixed(1)} MB`);
    return { ...b, bytes };
  } catch (e) {
    console.warn('[voice-input] keyword spotter not available', e?.message ?? e);
    return null;
  }
}

// The worklet: resample whatever the context runs at down to 16 kHz, post 100 ms chunks to the
// worker, and a level (RMS) every chunk for the listening indicator. The resampler averages every
// input sample that falls in an output sample's span (a box filter): plain point-sampling 48 kHz down
// to 16 kHz folds everything above 8 kHz back into the speech band.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.out = null; // the worker's port, transferred in the first message
    this.step = sampleRate / 16000;
    this.pos = 0;
    this.acc = 0;
    this.cnt = 0;
    this.buf = new Float32Array(1600);
    this.n = 0;
    this.sq = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.stopped = true;
      else if (e.data && e.data.port) this.out = e.data.port;
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (this.stopped) return false;
    if (!ch || !this.out) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.cnt++;
      if (++this.pos < this.step) continue;
      this.pos -= this.step;
      const v = this.acc / this.cnt;
      this.acc = 0;
      this.cnt = 0;
      this.buf[this.n++] = v;
      this.sq += v * v;
      if (this.n === this.buf.length) {
        this.out.postMessage(this.buf, [this.buf.buffer]);
        this.port.postMessage(Math.sqrt(this.sq / this.n));
        this.buf = new Float32Array(1600);
        this.n = 0;
        this.sq = 0;
      }
    }
    return true;
  }
}
registerProcessor('tapstone-kws-tap', Tap);
`;

const text = (buf) => new TextDecoder().decode(buf);

export class VoiceInput {
  // The browser's voice processing on the mic (measured on the TTS WAV through Chromium's fake mic,
  // scratch/issues/selene.md): the lead's Quest 2 run decides the default for a real room.
  static processing = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  constructor(bundle) {
    this.bundle = bundle;
    this.state = bundle ? 'off' : 'unavailable'; // off | starting | listening | error | unavailable
    this.error = null;
    this.level = 0; // the mic's RMS, 0..1, for the indicator
    this.stats = { loadMs: null, keywords: 0, rtf: null, audioS: 0, rms: null, starts: 0 };
    this.listeners = [];
    this.stateListeners = [];
    this.worker = null;
  }

  onKeyword(fn) {
    this.listeners.push(fn);
  }

  onState(fn) {
    this.stateListeners.push(fn);
  }

  set(state, error = null) {
    this.state = state;
    this.error = error;
    for (const fn of this.stateListeners) fn(state, error);
  }

  // The worker, built once from the preloaded bytes: the model's compile and init happen here (the
  // loadMs this reports), not at page load, so a person who never turns voice on never pays it.
  async ensureWorker(port) {
    const b = this.bundle;
    const url = URL.createObjectURL(new Blob([b['kws-worker.js']], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    const ready = new Promise((resolve, reject) => {
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') {
          this.stats.loadMs = m.ms;
          resolve();
        } else if (m.type === 'error') reject(new Error(m.message));
        else if (m.type === 'keyword') {
          this.stats.keywords++;
          for (const fn of this.listeners) fn(m.tag);
        } else if (m.type === 'stats') Object.assign(this.stats, { rtf: m.rtf, audioS: m.audioS, rms: m.rms });
      };
    });
    // Copies, so a second start (after a stop) can build again from the same bundle.
    const files = { 'encoder.int8.onnx': b['encoder.int8.onnx'].slice(0), 'decoder.int8.onnx': b['decoder.int8.onnx'].slice(0), 'joiner.int8.onnx': b['joiner.int8.onnx'].slice(0), 'tokens.txt': b['tokens.txt'].slice(0) };
    w.postMessage({ type: 'init', shim: text(b['kws-node-shim.js']), glue: text(b['kws-glue.js']), api: text(b['kws-api.js']), wasm: b['kws.wasm'].slice(0), files, keywords: text(b['keywords.txt']), config: KWS_CONFIG, port }, [port]);
    await ready;
    return w;
  }

  // Open the mic and start spotting. `source` (optional) replaces the mic, for tests: any
  // MediaStream (IWER's Chromium can feed a file as its fake mic).
  async start(source = null) {
    if (this.state === 'listening' || this.state === 'starting') return;
    if (!this.bundle) return this.set('unavailable');
    this.set('starting');
    this.stats.starts++;
    try {
      this.stream = source ?? (await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, ...VoiceInput.processing } }));
      this.ctx = new AudioContext();
      await this.ctx.resume();
      const code = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      await this.ctx.audioWorklet.addModule(code);
      URL.revokeObjectURL(code);
      const chan = new MessageChannel();
      this.node = new AudioWorkletNode(this.ctx, 'tapstone-kws-tap', { numberOfOutputs: 0 });
      this.node.port.postMessage({ port: chan.port1 }, [chan.port1]); // chunks go worklet -> worker
      this.node.port.onmessage = (e) => (this.level = e.data);
      this.worker = await this.ensureWorker(chan.port2);
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.src.connect(this.node);
      this.set('listening');
    } catch (e) {
      console.warn('[voice-input] could not start', e);
      this.teardown();
      this.set('error', e?.name === 'NotAllowedError' ? 'The microphone was not allowed.' : String(e?.message ?? e));
    }
  }

  teardown() {
    try {
      this.node?.port.postMessage('stop');
      this.src?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      this.ctx?.close();
      this.worker?.terminate();
    } catch {
      // already gone
    }
    this.node = this.src = this.stream = this.ctx = this.worker = null;
    this.level = 0;
  }

  stop() {
    if (this.state === 'off' || this.state === 'unavailable') return;
    this.teardown();
    this.set('off');
  }
}
