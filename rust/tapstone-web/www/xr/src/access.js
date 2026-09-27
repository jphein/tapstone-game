// access.js: the page's accessibility settings (logic/access.js says what each does). Read once at
// load from the URL (?seated=1, ?hand=left, ?motion=reduce), what was stored, and the system's
// prefers-reduced-motion; the panel in index.html changes them before (or between) sessions, and
// every change is stored and heard by the systems that apply it.
import { ACCESS_DEFAULTS, readAccess } from './logic/access.js';

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
  if (!(key in ACCESS_DEFAULTS) || typeof value !== 'boolean' || access[key] === value) return;
  access[key] = value;
  try {
    const keep = Object.fromEntries(Object.keys(ACCESS_DEFAULTS).map((k) => [k, access[k]]));
    globalThis.localStorage?.setItem(KEY, JSON.stringify(keep));
  } catch {
    // private mode: the setting still holds for this page
  }
  for (const fn of listeners) fn(access, key);
}

// The panel: one checkbox per setting, over the page until the session starts.
export function accessPanel(doc = globalThis.document) {
  const form = doc?.getElementById('access');
  if (!form) return;
  for (const box of form.querySelectorAll('input[type=checkbox][name]')) {
    box.checked = !!access[box.name];
    box.addEventListener('change', () => setAccess(box.name, box.checked));
  }
}
