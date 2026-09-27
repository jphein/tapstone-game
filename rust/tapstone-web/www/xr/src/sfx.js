// sfx.js: plays logic/sfx.js's recipes with WebAudio. Everything is synthesized when it plays, so
// there is nothing to preload and nothing crosses the network (net.js counts that). The context is
// made on the first sound and resumed on every one: the autoplay policy may hold it until a gesture
// (entering the headset is one), and until then a sound is counted as blocked, never queued.
import { SOUNDS } from './logic/sfx.js';

const MASTER = 0.6;

export function createSfx() {
  const stats = { played: 0, blocked: 0, byName: {} };
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  let ctx = null, master = null, noise = null;

  function init() {
    if (ctx || !AC) return ctx;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = MASTER;
    master.connect(ctx.destination);
    // One second of white noise, shared by every noise voice.
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function voice(x, t0) {
    const at = t0 + x.at, end = at + x.dur;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(x.peak, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    let src;
    if (x.wave === 'noise') {
      src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = x.f0;
      bp.Q.value = 1.2;
      src.connect(bp).connect(g);
    } else {
      src = ctx.createOscillator();
      src.type = x.wave;
      src.frequency.setValueAtTime(x.f0, at);
      if (x.f1 !== x.f0) src.frequency.exponentialRampToValueAtTime(x.f1, end);
      src.connect(g);
    }
    g.connect(master);
    src.start(at);
    src.stop(end + 0.02);
  }

  return {
    stats,
    play(name) {
      const s = SOUNDS[name];
      if (!s || !init()) return;
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      if (ctx.state !== 'running') return void stats.blocked++;
      const t0 = ctx.currentTime + 0.01;
      for (const x of s.voices) voice(x, t0);
      stats.played++;
      stats.byName[name] = (stats.byName[name] ?? 0) + 1;
    },
  };
}
