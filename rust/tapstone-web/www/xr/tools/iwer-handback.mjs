// iwer-handback.mjs: an unanswered first-five beat hands the voice back (logic/first-five.js
// holding()), in IWSDK's managed Chromium. On a fresh page (tools/iwer-forget.mjs, browser reload, xr enter, hand mode): it
// answers nothing, so the claim beat waits; inside the beat's window the band shows the beat's
// sentence, and once the window ends it shows the line the beat held (voiceFor the current view).
//   npx @iwsdk/cli browser run tools/iwer-handback.mjs --timeout 105000
export default async function run({ page, frame }) {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone, null, { timeout: 30000 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const read = () => f.evaluate(() => ({ t: Math.round(performance.now()), beat: __tapstone.beats().beat, line: __tapstone.play.altar.line, holding: __tapstone.play.beats.holding(performance.now()) }));
  await f.waitForFunction(() => __tapstone.beats().beat === 'claim', null, { timeout: 30000 });
  const trail = [await read()];
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    await sleep(1000);
    const r = await read();
    if (r.line !== trail[trail.length - 1].line || r.holding !== trail[trail.length - 1].holding) trail.push(r);
  }
  trail.push(await read());
  return { trail };
}
