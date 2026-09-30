// iwer-reload.mjs: a page reload mid-match resumes the same match (spec §3.5, logic/journal.js), in
// IWSDK's managed Chromium. It plays into a fresh match, reads the journal the page stored, reloads
// the page (a new wasm instance: nothing survives but localStorage), and checks the page replayed it:
// the same taps, clock, head and match. Then it writes a copy of that journal
// with its head rewritten, reloads again, and checks the page refused it and started fresh.
// It leaves the good journal resumed on a reloaded page: finish that match with iwer-match.mjs and
// check the journal it returns with tools/journal-check.mjs.
//
//   npx @iwsdk/cli browser run tools/iwer-forget.mjs && npx @iwsdk/cli browser reload
//   npx @iwsdk/cli browser run tools/iwer-reload.mjs --timeout 105000      # plays, reloads, checks
//   npx @iwsdk/cli xr enter && npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
//   npx @iwsdk/cli browser run tools/iwer-match.mjs --timeout 105000     # finishes it, returns the journal
const KEY = 'tapstone.xr.journal';

export async function reloadAndRead(page) {
  await page.reload();
  // The app's frame is a new one after a reload: find whichever frame sets __tapstone.
  for (const until = Date.now() + 30000; Date.now() < until; await new Promise((r) => setTimeout(r, 250))) {
    for (const f of page.frames()) {
      const j = await f.evaluate(() => globalThis.__tapstone?.journal() ?? null).catch(() => null);
      if (j) return { f, j };
    }
  }
  throw new Error('no frame set __tapstone within 30 s of the reload');
}

export default async function run({ page, frame }) {
  let f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone, null, { timeout: 30000 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let n = 0; n < 60 && (await f.evaluate(() => __tapstone.journal().taps.length)) < 8; n++) {
    await f.evaluate(() => __tapstone.gestureStep());
    await sleep(300);
  }
  const stored = await f.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const r1 = await reloadAndRead(page);
  f = r1.f;
  const back = r1.j;
  const resume = {
    from: back.resumed.from,
    refused: back.resumed.refused ?? null,
    taps: [stored.taps.length, back.resumed.taps],
    clock: [stored.clock, back.resumed.clock],
    head: [stored.head, back.head],
    match: [stored.match_id, back.match_id],
  };
  const resumed = resume.from === 'journal' && resume.taps[0] === resume.taps[1] && resume.taps[0] >= 8
    && resume.clock[0] === resume.clock[1] && resume.head[0] === resume.head[1] && resume.match[0] === resume.match[1];
  // The tampered copy: every field the stored one had, and the head rewritten.
  const bad = { ...stored, head: stored.head === '0123456789abcdef' ? 'fedcba9876543210' : '0123456789abcdef' };
  await f.evaluate(([k, v]) => {
    __tapstone.forget(); // stop this page saving over the copy before the reload
    localStorage.setItem(k, v);
  }, [KEY, JSON.stringify(bad)]);
  const r2 = await reloadAndRead(page);
  f = r2.f;
  const after = r2.j;
  const tamper = { from: after.resumed.from, refused: after.resumed.refused ?? null, taps: after.taps.length, clock: after.clock };
  const refused = tamper.from === 'fresh' && !!tamper.refused && tamper.taps === 0;
  // Put the good journal back and reload once more, so iwer-match plays the resumed match on.
  await f.evaluate(([k, v]) => {
    __tapstone.forget();
    localStorage.setItem(k, v);
  }, [KEY, JSON.stringify(stored)]);
  const r3 = await reloadAndRead(page);
  const again = { from: r3.j.resumed.from, taps: r3.j.resumed.taps, head: r3.j.head };
  return { resume, resumed, tamper, refused, again, ok: resumed && refused && again.from === 'journal' };
}
