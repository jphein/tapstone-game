// promo_page_check.mjs: the promo page's video block in a real browser (Playwright's Chromium), served
// from site/ by a local static server, twice: without site/media (the frame must fall back to its
// description panel) and with a media directory (the player must stay, its captions must load). Both
// runs must make no request off the local origin.
//   node tools/promo_page_check.mjs [media dir] [port]      (media dir: where promo*.mp4 and the poster are)
// Needs playwright: it is resolved from rust/tapstone-web/www/xr/node_modules. Exit 1 on any failure.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(root, 'rust/tapstone-web/www/xr/package.json'))('playwright');
const [mediaDir, portArg] = process.argv.slice(2);
const PORT = Number(portArg || 8097);
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.vtt': 'text/vtt', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.json': 'application/json' };

function serve(withMedia) {
  return createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = url.startsWith('/media/') ? (withMedia ? join(mediaDir, url.slice(7)) : null) : join(root, 'site', normalize(url));
    if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file || !existsSync(file)) return res.writeHead(404).end();
    const size = statSync(file).size, range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    const head = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'accept-ranges': 'bytes' };
    if (range) {
      const a = Number(range[1] || 0), z = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { ...head, 'content-range': `bytes ${a}-${z}/${size}`, 'content-length': z - a + 1 });
      return createReadStream(file, { start: a, end: z }).pipe(res);
    }
    res.writeHead(200, { ...head, 'content-length': size });
    createReadStream(file).pipe(res);
  }).listen(PORT, '127.0.0.1');
}

async function run(browser, withMedia, width = 1280) {
  const server = serve(withMedia);
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const offsite = [];
  page.on('request', (r) => { if (!r.url().startsWith(`http://127.0.0.1:${PORT}/`)) offsite.push(r.url()); });
  await page.goto(`http://127.0.0.1:${PORT}/promo/`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(async () => {
    const v = document.querySelector('.film-frame video'), fig = v.closest('.film-frame');
    const t = v.textTracks[0];
    if (t) t.mode = 'hidden'; // loads the captions without showing them
    await new Promise((ok) => setTimeout(ok, 1500));
    return {
      missing: fig.classList.contains('missing'),
      panel: getComputedStyle(fig, '::after').content,
      videoShown: getComputedStyle(v).display !== 'none',
      cues: t && t.cues ? t.cues.length : 0,
      h264: v.canPlayType('video/mp4; codecs="avc1.640028, mp4a.40.2"'),
      played: await (async () => {
        if (fig.classList.contains('missing')) return null;
        v.muted = true; // a script may start muted playback; a person presses play
        // play() may never settle when every source fails (seen: no media and no fallback), so it races a timeout.
        const r = await Promise.race([v.play().then(() => 'ok', (e) => `play() failed: ${e.name}`), new Promise((ok) => setTimeout(() => ok('play() did not settle in 5 s'), 5000))]);
        if (r !== 'ok') return r;
        await new Promise((ok) => setTimeout(ok, 2000));
        const at = v.currentTime; v.pause();
        return { currentTime: +at.toFixed(2), src: v.currentSrc.replace(location.origin, ''), size: [v.videoWidth, v.videoHeight] };
      })(),
    };
  });
  await page.close();
  server.close();
  return { ...r, offsite };
}

const browser = await chromium.launch({ headless: true });
const problems = [];
const bare = await run(browser, false);
if (!bare.missing) problems.push('without media the frame did not fall back to its panel');
if (!/promo video/.test(bare.panel)) problems.push(`without media the panel text is ${bare.panel}`);
if (bare.videoShown) problems.push('without media the empty player is still shown');
if (bare.played !== null) problems.push(`without media the page offered a player: ${JSON.stringify(bare.played)}`);
if (bare.offsite.length) problems.push(`requests off the site without media: ${bare.offsite.join(' ')}`);
let full = null;
if (mediaDir) {
  full = await run(browser, true);
  if (full.missing) problems.push('with media the frame fell back to its panel');
  if (!full.videoShown) problems.push('with media the player is hidden');
  if (full.cues < 1) problems.push('the captions track loaded no cues');
  if (full.h264 && !(full.played?.currentTime > 0.5)) problems.push(`the video did not play: ${JSON.stringify(full.played)}`);
  if (full.offsite.length) problems.push(`requests off the site with media: ${full.offsite.join(' ')}`);
  if (full.h264 && full.played?.src !== '/media/promo.mp4') problems.push(`a wide screen played ${full.played?.src}`);
  const narrow = await run(browser, true, 800);
  if (narrow.h264 && narrow.played?.src !== '/media/promo-720.mp4') problems.push(`a narrow screen played ${narrow.played?.src}`);
  full.narrow = narrow.played;
}
await browser.close();
console.log(JSON.stringify({ bare, full, problems }, null, 1));
process.exit(problems.length ? 1 : 0);
