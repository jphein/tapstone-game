// Counts every resource the page fetches after it declares itself loaded (pass-line item 2).
// PerformanceObserver sees fetch, XHR, images, fonts, scripts and wasm alike.
const state = { loadedAt: null, after: [], total: 0 };
export function netWatch() {
  // The timeline keeps 250 entries by default and a dev load makes ~350: without this, the cold-start
  // report (tools/iwer-coldstart.mjs) silently lost every late fetch (wasm, art, voice).
  performance.setResourceTimingBufferSize?.(2000);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        state.total++;
        if (state.loadedAt !== null && e.startTime > state.loadedAt) state.after.push(e.name);
      }
    }).observe({ type: 'resource', buffered: true });
  } catch (e) {
    console.warn('[spike] no PerformanceObserver', e);
  }
  globalThis.__spikeNet = state;
}
export function markLoaded() {
  state.loadedAt = performance.now();
  console.log(`[spike] loaded at ${state.loadedAt.toFixed(0)} ms after ${state.total} requests`);
}
export const netAfter = () => state.after;

// IWSDK fetches hand and controller models from a hard-coded jsdelivr path when an input source
// connects, i.e. after load (@iwsdk/xr-input DEFAULT_PROFILES_PATH, no config). The spike vendors
// them in public/profiles/, fetches every one DURING load, and answers the CDN URL from memory, so
// nothing touches the network after "loaded".
const CDN = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/';
const VENDORED = ['generic-hand', 'meta-quest-touch-plus', 'oculus-touch-v3']
    .flatMap((p) => ['left', 'right'].map((h) => `${p}/${h}.glb`));
export async function preloadProfiles(base) {
    const mem = new Map();
    await Promise.all(VENDORED.map(async (f) => {
        const r = await fetch(`${base}profiles/${f}`);
        if (r.ok) mem.set(CDN + f, await r.arrayBuffer());
    }));
    const real = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input?.url;
        const buf = url && mem.get(url);
        if (buf) return Promise.resolve(new Response(buf.slice(0), { headers: { 'content-type': 'model/gltf-binary' } }));
        if (url && url.startsWith(CDN)) console.warn(`[spike] unvendored profile asset ${url}`);
        return real(input, init);
    };
    console.log(`[spike] vendored ${mem.size}/${VENDORED.length} input-profile models`);
}
