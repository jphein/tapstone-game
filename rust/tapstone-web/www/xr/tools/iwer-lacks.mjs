// iwer-lacks.mjs: the page on a device that lacks one mode (logic/entry.js: the other must still work),
// in IWSDK's managed Chromium. IWER's Quest 3 has both, so this hides one: an init script, armed by
// sessionStorage['tapstone.lacks'] = 'immersive-ar' | 'immersive-vr', makes navigator.xr (IWER installs
// it with Object.defineProperty) answer isSessionSupported(that mode) false. The script stays in the
// context but does nothing once the key is cleared; this run clears it before returning.
//   npx @iwsdk/cli browser run tools/iwer-lacks.mjs      # lacks immersive-ar: plan, then `xr enter`
//   npx @iwsdk/cli xr enter && npx @iwsdk/cli browser run tools/iwer-room.mjs
const MODE = process.env.TAPSTONE_LACKS || 'immersive-ar';
export default async function run({ page, context }) {
  await context.addInitScript(() => {
    const lacks = sessionStorage.getItem('tapstone.lacks');
    if (!lacks) return;
    const wrap = (xr) => {
      if (!xr || xr.__lacks) return xr;
      const ask = xr.isSessionSupported.bind(xr);
      xr.isSessionSupported = async (m) => (m === lacks ? false : ask(m));
      xr.__lacks = lacks;
      return xr;
    };
    const define = Object.defineProperty;
    Object.defineProperty = function (o, k, d) {
      if (o === navigator && k === 'xr' && d) {
        if ('value' in d) d = { ...d, value: wrap(d.value) };
        else if (d.get) { const get = d.get; d = { ...d, get: () => wrap(get.call(navigator)) }; }
      }
      return define.call(Object, o, k, d);
    };
    if (navigator.xr) wrap(navigator.xr);
  });
  await page.evaluate((m) => sessionStorage.setItem('tapstone.lacks', m), MODE);
  await page.reload();
  let f = null;
  for (let k = 0; k < 120 && !f; k++) {
    await new Promise((r) => setTimeout(r, 250));
    for (const fr of page.frames()) if (await fr.evaluate(() => !!globalThis.__tapstone).catch(() => false)) f = fr;
  }
  const out = await f.evaluate(async (m) => ({ lacks: m, supported: await navigator.xr.isSessionSupported(m), plan: globalThis.__tapstoneEntry, buttons: [...document.querySelectorAll('#entry button')].map((b) => b.dataset.mode) }), MODE);
  await f.evaluate(() => sessionStorage.removeItem('tapstone.lacks')); // the next reload has both modes again
  return out;
}
