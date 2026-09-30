// ambience.js: the Tea House's sound bed (design note 2026-09-29-xr-atmosphere-design.md), synthesized
// in WebAudio: nothing to download (0 MB, no licence), nothing on the network after load. Each voice
// is placed where it lives, through an HRTF panner (logic/atmosphere.js BED):
//   room tone (a low hush of air), a lantern's crackle, wind chimes (a pentatonic cluster every 6-14 s),
//   water at the Deep Tides door, a forge rumble at the Forge Peaks door, crickets at the Hearthlands
//   door, a low two-note hum at the red door (the Dueling Grounds). Every sound is a PROPOSAL.
// In mixed reality only the doors sound (bedFor). It never autoplays: start() is called inside an XR
// session (a gesture opened it), and a context the browser holds suspended is resumed on the next
// select (a pinch) or press; until it runs nothing plays, and the stats say so.
// The volume is the access setting `ambience` (off, low, medium, high).
import { bedFor, nextChime } from '../logic/atmosphere.js';

const BASE = 0.9; // the bed's level at 'high', under the effects and the voice (about -41 dB mean in a capture)

export function createAmbience() {
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const stats = { state: 'idle', room: null, voices: 0, chimes: 0, crackles: 0, plops: 0, blocked: 0 };
  let ctx = null, master = null, noise = null, timer = null, level = 0.7;
  const panners = new Map(); // where -> PannerNode
  let nextChimeAt = 0, nextCrackleAt = 0, nextPlopAt = 0, nextChirpAt = 0, nextWhoompAt = 0;

  const rand = Math.random;
  function panner(where) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.8;
    p.rolloffFactor = 1.1;
    p.connect(master);
    panners.set(where, p);
    return p;
  }
  function loopNoise(out) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.loopStart = rand();
    s.start(ctx.currentTime, rand() * 1.5);
    s.connect(out);
    return s;
  }
  function filter(type, f, q = 0.7) {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }
  function gain(v) {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  }
  function lfo(param, rate, depth) {
    const o = ctx.createOscillator(), g = gain(depth);
    o.frequency.value = rate;
    o.connect(g).connect(param);
    o.start();
  }
  // One sustained voice per BED entry; the struck ones (chimes, crackle, plops, chirps) are scheduled.
  const build = {
    tone(out) {
      const lp = filter('lowpass', 320), g = gain(0.06);
      loopNoise(lp);
      lp.connect(g).connect(out);
      lfo(g.gain, 0.07, 0.02);
    },
    crackle(out) {
      const bp = filter('bandpass', 700, 0.5), g = gain(0.012);
      loopNoise(bp);
      bp.connect(g).connect(out);
    },
    chimes() {},
    water(out) {
      const bp = filter('bandpass', 900, 0.8), lp = filter('lowpass', 1800), g = gain(0.16);
      loopNoise(bp);
      bp.connect(lp).connect(g).connect(out);
      lfo(bp.frequency, 0.18, 380);
      lfo(g.gain, 0.11, 0.05);
    },
    rumble(out) {
      const lp = filter('lowpass', 95), g = gain(0.5), o = ctx.createOscillator(), og = gain(0.05);
      loopNoise(lp);
      lp.connect(g).connect(out);
      o.frequency.value = 41;
      o.connect(og).connect(out);
      o.start();
      lfo(g.gain, 0.09, 0.18);
    },
    crickets() {},
    hum(out) {
      for (const [f, v] of [[55, 0.035], [82.5, 0.022], [110.4, 0.012]]) {
        const o = ctx.createOscillator(), g = gain(v);
        o.frequency.value = f;
        o.connect(g).connect(out);
        o.start();
        lfo(g.gain, 0.05 + f / 4000, v * 0.5);
      }
    },
  };
  function strike(out, f, at, g0) {
    // A chime: three inharmonic partials, each ringing down.
    for (const [m, v, d] of [[1, 1, 3.6], [2.76, 0.45, 1.6], [5.4, 0.22, 0.7]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f * m;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.05 * g0 * v, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + d);
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + d + 0.05);
    }
  }
  function burst(out, at, dur, type, f, v) {
    const s = ctx.createBufferSource(), b = filter(type, f, 1.2), g = ctx.createGain();
    s.buffer = noise;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(v, at + Math.min(0.004, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(b).connect(g).connect(out);
    s.start(at, rand() * 1.5);
    s.stop(at + dur + 0.02);
  }
  function sweep(out, at, f0, f1, dur, v) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(v, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.02);
  }
  // The scheduler: 150 ms ticks, 400 ms lookahead.
  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime, ahead = now + 0.4;
    const out = (w) => panners.get(w);
    if (out('room') && nextChimeAt < ahead) {
      const c = nextChime(rand);
      for (const n of c.notes) strike(out('room'), n.f, Math.max(now, nextChimeAt) + n.at, n.gain);
      nextChimeAt = Math.max(now, nextChimeAt) + c.wait;
      stats.chimes++;
    }
    if (out('lantern') && nextCrackleAt < ahead) {
      burst(out('lantern'), Math.max(now, nextCrackleAt), 0.012 + rand() * 0.03, 'highpass', 1800 + rand() * 2500, 0.03 + rand() * 0.07);
      nextCrackleAt = Math.max(now, nextCrackleAt) + (rand() < 0.2 ? 0.04 : 0.15 + rand() * 0.9);
      stats.crackles++;
    }
    if (out('tide') && nextPlopAt < ahead) {
      sweep(out('tide'), Math.max(now, nextPlopAt), 380 + rand() * 300, 1100 + rand() * 600, 0.05, 0.05);
      nextPlopAt = Math.max(now, nextPlopAt) + 0.4 + rand() * 2.5;
      stats.plops++;
    }
    if (out('neutral') && nextChirpAt < ahead) {
      const t0 = Math.max(now, nextChirpAt);
      for (let k = 0; k < 3; k++) sweep(out('neutral'), t0 + k * 0.045, 4300, 4500, 0.03, 0.012);
      nextChirpAt = t0 + 0.7 + rand() * 1.6;
    }
    if (out('ember') && nextWhoompAt < ahead) {
      burst(out('ember'), Math.max(now, nextWhoompAt), 1.4, 'lowpass', 160, 0.25);
      nextWhoompAt = Math.max(now, nextWhoompAt) + 5 + rand() * 9;
    }
  }

  const api = {
    stats,
    // Builds the bed for a room ('vr' | 'mr') once per session; a new room rebuilds it.
    start(room, vol) {
      if (!AC) return (stats.state = 'unavailable');
      level = vol;
      if (!ctx) {
        ctx = new AC();
        master = ctx.createGain();
        master.connect(ctx.destination);
        noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        timer = setInterval(tick, 150);
      }
      if (stats.room !== room) {
        for (const p of panners.values()) p.disconnect();
        panners.clear();
        const bed = bedFor(room);
        for (const v of bed) {
          const out = panners.get(v.where) ?? panner(v.where);
          build[v.kind](out);
        }
        stats.room = room;
        stats.voices = bed.length;
      }
      master.gain.value = BASE * level;
      api.resume();
    },
    resume() {
      if (!ctx) return;
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      stats.state = ctx.state;
      if (ctx.state !== 'running') stats.blocked++;
    },
    stop() {
      if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
      if (ctx) stats.state = 'suspended';
    },
    volume(v) {
      level = v;
      if (master) master.gain.setTargetAtTime(BASE * v, ctx.currentTime, 0.1);
    },
    // Per frame: where each voice is (world metres) and where the head is, facing where.
    place(where, p) {
      const n = panners.get(where);
      if (!n) return;
      if (n.positionX) n.positionX.value = p.x, n.positionY.value = p.y, n.positionZ.value = p.z;
      else n.setPosition(p.x, p.y, p.z);
    },
    listen(p, fwd, up) {
      const L = ctx?.listener;
      if (!L) return;
      if (L.positionX) {
        L.positionX.value = p.x, L.positionY.value = p.y, L.positionZ.value = p.z;
        L.forwardX.value = fwd.x, L.forwardY.value = fwd.y, L.forwardZ.value = fwd.z;
        L.upX.value = up.x, L.upY.value = up.y, L.upZ.value = up.z;
      } else {
        L.setPosition(p.x, p.y, p.z);
        L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
      }
      stats.state = ctx.state;
    },
    dispose() {
      clearInterval(timer);
      ctx?.close();
    },
  };
  return api;
}
