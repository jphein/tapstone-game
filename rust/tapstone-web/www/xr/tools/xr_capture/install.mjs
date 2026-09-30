// install.mjs (called by capture.mjs with its page): once per capture. Sets a 1920x1080 viewport (the
// renderer canvas follows it on reload), registers the audio taps as an init script and reloads, so the taps are in
// the app's frame before the page makes its first sound. It must be page.reload(): an init script
// does not survive `iwsdk browser reload` (tried: absent in both frames afterwards).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installTaps } from './page.js';
import { KEY } from '../../src/logic/journal.js';

// The stored settings a capture starts with. `contrast` turns high contrast on. `returning` is a
// player who has already answered the first-run offer ("hands, head gaze or voice", assist.js) with
// their hands, so the guide speaks from the first frame instead of waiting on the offer.
export function accessFor(control) {
  return { highContrast: !!control.contrast, ...(control.returning ? { offered: true } : {}) };
}

export default async function run({ page, frame, workspaceRoot }) {
  const control = JSON.parse(await readFile(join(workspaceRoot, '.iwsdk/xr-capture/control.json'), 'utf8'));
  await page.setViewportSize({ width: 1920, height: 1080 });
  // A capture starts a fresh match: the table's journal (localStorage, "coming back") would otherwise
  // resume the previous capture's match on reload (caught: a "whole match" that began mid-game).
  const journal = control.resume ? 'kept' : await page.evaluate((k) => (localStorage.getItem(k) ? (localStorage.removeItem(k), 'cleared') : 'none'), KEY);
  // The theme: high contrast when asked (--contrast), else standard, stored as the page reads it.
  const stored = accessFor(control);
  await page.evaluate((a) => localStorage.setItem('tapstone.access', JSON.stringify(a)), stored);
  await page.addInitScript({ content: `(${installTaps})();` }); // repeat registrations are no-ops
  await page.reload({ waitUntil: 'load' });
  // The app's frame is new after the reload (the old one detaches), so look for it until it answers.
  for (const end = Date.now() + 30000; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) {
    for (const f of page.frames()) {
      const r = await f.evaluate(() => (globalThis.__tapstone ? { taps: !!globalThis.__xrTaps } : null)).catch(() => null);
      if (r) return { viewport: page.viewportSize(), journal, access: stored, ...r };
    }
  }
  throw new Error('no Tapstone frame within 30 s of the reload');
}
