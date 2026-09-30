// access.js: the page's accessibility settings (logic/access.js says what each does). Read once at
// load from the URL (?seated=1, ?hand=left, ?motion=reduce), what was stored, and the system's
// prefers-reduced-motion; the panel in index.html changes them before (or between) sessions, and
// every change is stored and heard by the systems that apply it.
import { ACCESS_DEFAULTS, readAccess, validSetting } from './logic/access.js';

const KEY = 'tapstone.access';
const listeners = [];

function stored() {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export const access = readAccess({
  search: globalThis.location?.search ?? '',
  stored: stored(),
  prefersReducedMotion: !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
});

export function onAccess(fn) {
  listeners.push(fn);
}

export function setAccess(key, value) {
  if (!validSetting(key, value) || access[key] === value) return;
  access[key] = value;
  try {
    const keep = Object.fromEntries(Object.keys(ACCESS_DEFAULTS).map((k) => [k, access[k]]));
    globalThis.localStorage?.setItem(KEY, JSON.stringify(keep));
  } catch {
    // private mode: the setting still holds for this page
  }
  for (const fn of listeners) fn(access, key);
}

// The panel: one checkbox per setting (and a select for the dwell time), over the page until the
// session starts. A change made in the world (the settings tiles, a spoken "high contrast on") shows
// here too.
export function accessPanel(doc = globalThis.document) {
  const form = doc?.getElementById('access');
  if (!form) return;
  const boxes = [...form.querySelectorAll('input[type=checkbox][name]')];
  for (const box of boxes) {
    box.checked = !!access[box.name];
    box.addEventListener('change', () => setAccess(box.name, box.checked));
  }
  // The selects: the dwell time and the ambience's volume, numbers both.
  const selects = [...form.querySelectorAll('select[name]')];
  for (const sel of selects) {
    sel.value = String(access[sel.name]);
    sel.addEventListener('change', () => setAccess(sel.name, Number(sel.value)));
  }
  onAccess((a, key) => {
    for (const box of boxes) if (box.name === key) box.checked = !!a[key];
    for (const sel of selects) if (sel.name === key) sel.value = String(a[key]);
  });
}

// The first-run offer on the page, before entry: hands, head gaze or voice. Voice asks for the mic
// here, outside the headset session, and lets it go at once: the mic opens again (with its listening
// indicator) when the session starts. Answered once; the settings change it any time after.
export function firstRunOffer(doc = globalThis.document) {
  const box = doc?.getElementById('first-run');
  if (!box) return;
  box.hidden = !!access.offered;
  for (const b of box.querySelectorAll('button[data-way]')) {
    b.addEventListener('click', async () => {
      const way = b.dataset.way;
      if (way === 'voice') {
        try {
          const s = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach((t) => t.stop());
        } catch (e) {
          box.querySelector('.why').textContent = `The microphone was not allowed (${e?.name ?? e}). Hands and head gaze still play everything.`;
          return;
        }
      }
      setAccess('offered', true);
      if (way === 'gaze') setAccess('gaze', true);
      if (way === 'voice') setAccess('voice', true);
      box.hidden = true;
    });
  }
}
