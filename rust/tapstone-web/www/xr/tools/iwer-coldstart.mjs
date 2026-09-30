// iwer-coldstart.mjs: cold start (contest rule "fast cold start"), in IWSDK's managed Chromium. It
// reloads the page `runs` times and reads, per load, the ms from navigation start (performance.now's
// origin) to: the table ready (the engine, hand models and card art in), every fetch in (markLoaded,
// the voice clips last), and the first interactive frame (the first that drew a view, play.js). It also sums the
// resources the page fetched by kind, slowest first, so the waste has a name.
//
//   npx @iwsdk/cli browser run tools/iwer-forget.mjs
//   npx @iwsdk/cli browser run tools/iwer-coldstart.mjs --timeout 105000
//
// The dev figure is not the shipped one: Vite serves ~240 modules unbundled, and the IWSDK dev plugin
// injects an editor runtime whose generateAssetThumbnails held the main thread ~1 s per load in a CPU
// profile (2026-09-28); neither is in `vite build`. So when a `vite preview` of dist/ answers on
// XR_PREVIEW_PORT (default 8188), the same measurement runs on it too, then the page goes back:
//   (cd www/xr && npx vite build && npx vite preview --port 8188 --strictPort)
import { reloadAndRead } from './iwer-reload.mjs';

const firstFrameAt = async (f) => {
  await f.waitForFunction(() => { const c = globalThis.__tapstone?.coldStart(); return c?.firstFrame != null && c.loaded != null; }, null, { timeout: 30000 });
  return await f.evaluate(() => {
    const c = __tapstone.coldStart(), nav = performance.getEntriesByType('navigation')[0];
    return { ready: Math.round(c.ready), loaded: Math.round(c.loaded), firstFrame: Math.round(c.firstFrame), domReady: Math.round(nav?.domContentLoadedEventEnd ?? -1), parts: c.parts, resumed: __tapstone.journal().resumed.from };
  });
};
const median = (runs) => Object.fromEntries(['ready', 'firstFrame', 'loaded', 'domReady'].map((k) => [k, runs.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(runs.length / 2)]]));

async function production(page) {
  const url = `https://localhost:${process.env.XR_PREVIEW_PORT ?? 8188}/`, back = page.url(), runs = [];
  try {
    for (let k = 0; k < 3; k++) {
      await page.goto(url, { waitUntil: 'commit', timeout: 10000 });
      runs.push(await firstFrameAt(page.mainFrame()));
    }
    runs.resources = await resourcesOf(page.mainFrame());
  } catch (e) {
    runs.push({ error: String(e).slice(0, 200) });
  } finally {
    await page.goto(back, { waitUntil: 'commit' });
  }
  return runs[0]?.error ? { url, error: runs[0].error } : { url, runs, median: median(runs), resources: runs.resources };
}

// The resources one load fetched, summed by kind, with the last to finish.
const resourcesOf = (f) => f.evaluate(() => {
  const kinds = {};
  for (const e of performance.getEntriesByType('resource')) {
    const path = new URL(e.name, location.href).pathname;
    const kind = path.match(/\/(voice|cards|profiles|ui|scenes)\//)?.[1] ?? (path.endsWith('.wasm') ? 'wasm' : /\.(js|mjs)$|\/@|node_modules/.test(path) ? 'script' : 'other');
    const k = (kinds[kind] ??= { n: 0, kb: 0, lastEnd: 0 });
    k.n++;
    k.kb += Math.round((e.transferSize || e.encodedBodySize || 0) / 1024);
    k.lastEnd = Math.max(k.lastEnd, Math.round(e.responseEnd));
  }
  return kinds;
});

export default async function run({ page }) {
  const runs = [];
  let f;
  for (let k = 0; k < 3; k++) {
    f = (await reloadAndRead(page)).f;
    runs.push(await firstFrameAt(f));
  }
  const dev = { runs, median: median(runs), resources: await resourcesOf(f) };
  return { dev, production: await production(page) };
}
