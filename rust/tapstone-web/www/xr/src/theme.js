// theme.js: repaints the scene by role when the high-contrast setting changes (logic/theme.js holds
// the contrast colours; logic/access.js the setting).
//
// The hook, for any file that builds something a person must find or read (the world art included):
//   themed(material, 'pad')                 in high contrast its .color becomes the role's contrast
//                                           colour; back in standard, the colour it had when themed
//   themed(material, 'pad', 'emissive')     another colour property
//   palette()[role], themeName(), onTheme(fn)   read the theme, and be told when it changes
// "Standard" is whatever the art painted: a material's own colour is kept when it is themed, so
// theming a material changes nothing until someone turns high contrast on. assist.js themes the
// altar and the board by their known parts (pads, deck, castle card, unit figures); a new
// interactive thing should be themed where it is built.
import { THEMES, themeFor } from './logic/theme.js';
import { access, onAccess } from './access.js';

const materials = new Map(); // material -> [{ role, prop, own }]
const listeners = [];
let current = themeFor(access);

export const palette = () => THEMES[current];
export const themeName = () => current;

function paint(m, { role, prop, own }) {
  m[prop].setHex(current === 'contrast' ? THEMES.contrast[role] : own);
}

// Theming a material again only changes its role (a pooled unit slot changes faction); after the
// scene sets a new colour, repaint() records it.
export function themed(material, role, prop = 'color') {
  if (!material?.[prop] || !(role in THEMES.contrast)) return material;
  const list = materials.get(material) ?? [];
  const had = list.find((x) => x.prop === prop);
  if (had) {
    had.role = role;
    return material;
  }
  const e = { role, prop, own: material[prop].getHex() };
  list.push(e);
  materials.set(material, list);
  paint(material, e);
  return material;
}

// A themed material whose colour the scene just set again (a unit's faction, per view): that colour
// is its standard now, even if set while high contrast is on, and in high contrast the role's
// colour goes back on over it.
export function repaint(material, prop = 'color') {
  const e = materials.get(material)?.find((x) => x.prop === prop);
  if (!e) return;
  e.own = material[prop].getHex();
  paint(material, e);
}

export function onTheme(fn) {
  listeners.push(fn);
}

onAccess((a, key) => {
  if (key !== 'highContrast') return;
  const was = current;
  current = themeFor(a);
  if (was === current) return;
  for (const [m, list] of materials) for (const e of list) paint(m, e);
  for (const fn of listeners) fn(THEMES[current], current);
});
