// iwer-fan-modes.mjs: after tools/iwer-fan.mjs moved the fan: a reload keeps the spot, the left-handed
// layout keeps its own (home until moved; the grip on the left end), and switching back restores the
// right hand's spot. The access panel's own checkbox is clicked (access.js setAccess).
//   npx @iwsdk/cli browser run tools/iwer-fan-modes.mjs --timeout 60000
async function appFrame(page) {
  for (const until = Date.now() + 30000; Date.now() < until; await new Promise((r) => setTimeout(r, 250))) {
    for (const f of page.frames()) if (await f.evaluate(() => !!globalThis.__tapstone).catch(() => false)) return f;
  }
  throw new Error('no __tapstone');
}
const read = (f) => f.evaluate(() => ({ fan: { ...__tapstone.play.hand.origin }, gripX: __tapstone.play.hand.grip.position.x, left: __tapstone.access().leftHanded }));

export default async function run({ page }) {
  let f = await appFrame(page);
  const before = await read(f);
  await page.reload();
  f = await appFrame(page);
  const afterReload = await read(f);
  const toggle = async () => {
    await f.evaluate(() => { const b = document.querySelector('#access input[name=leftHanded]'); b.click(); });
    await new Promise((r) => setTimeout(r, 300));
    return read(f);
  };
  const left = await toggle();
  const right = await toggle();
  return { before, afterReload, left, right };
}
