// theme.js: the colour table the scene reads by ROLE, in two themes: `contrast` (the high-contrast
// mode, logic/access.js highContrast) and `standard`, the world art's colours as built, kept so the
// tests can hold contrast above them. Pure: numbers only; the registry that repaints materials on a
// switch is src/theme.js, and there "standard" is whatever the art painted.
//
// THE HOOK FOR THE ART (feat/xr-world-art and anyone after): give a material a person must find or
// read a role, `themed(material, 'pad')` (src/theme.js), or read `palette()[role]` / `themeName()`
// and repaint in `onTheme(fn)` (a painted texture: draw its high-contrast variant there). A new
// role goes in BOTH themes here; test/theme.test.js holds the contrast theme to WCAG: text at 7:1
// (AAA), and every surface a person must find against what it sits on at 3:1 (1.4.11 non-text).
//
// Colour shouldn't be the only signal (WCAG 1.4.1): unit plates carry stats and the prompt's tiles
// names; FACTION_MARK is the letter a plate can add in high contrast (the art's plates, via the hook).

export const ROLES = [
  'altar.stone', 'altar.eye', 'altar.eyeRefuse', 'pad', 'pad.focus', 'deck', 'deck.top', 'castle',
  'board.base', 'board.near', 'board.far', 'board.plinth',
  'label.bg', 'label.fg', 'label.refuse',
  'card.face', 'card.ink', 'card.edge',
  'faction.ember', 'faction.tide', 'faction.neutral',
  'door.ember', 'door.tide', 'door.neutral', 'door.frame',
  'reticle', 'dwell',
];

export const THEMES = {
  // As built: the world art's colours (src/art/palette.js ART, feat/xr-world-art #199), so the
  // standard theme changes nothing. test/art-contrast.test.js holds each equal to ART and ART's
  // colour used in the file that paints it; the units and the effects keep board.js's FACTION.
  standard: {
    'altar.stone': 0x6d716c, 'altar.eye': 0xe0a526, 'altar.eyeRefuse': 0xd9342f,
    pad: 0x3d2616, 'pad.focus': 0xe0a526, deck: 0x9e8557, 'deck.top': 0x262c46, castle: 0xe0663a,
    'board.base': 0x2a2c34, 'board.near': 0x262c46, 'board.far': 0x161a28, 'board.plinth': 0x6d7480,
    'label.bg': 0x18120e, 'label.fg': 0xf6e7c4, 'label.refuse': 0xffb49a,
    'card.face': 0xf7eed8, 'card.ink': 0x2a1c12, 'card.edge': 0xc9a55a,
    'faction.ember': 0xe0663a, 'faction.tide': 0x3a9be0, 'faction.neutral': 0x7d8793,
    'door.ember': 0xffb347, 'door.tide': 0x9fe3ff, 'door.neutral': 0xf4ead2, 'door.frame': 0xb8322a,
    reticle: 0xf0ece2, dwell: 0xe0a526,
  },
  // High contrast: near-black surfaces, white text, one yellow for "this is live" (pads, focus,
  // the dwell ring), and faction colours re-picked for luminance against black.
  contrast: {
    'altar.stone': 0x0a0a0a, 'altar.eye': 0xffd400, 'altar.eyeRefuse': 0xff5c5c,
    pad: 0xffd400, 'pad.focus': 0x1a53ff, deck: 0x5c5c5c, 'deck.top': 0xffffff, castle: 0xb8b8b8,
    'board.base': 0x000000, 'board.near': 0x5e5e5e, 'board.far': 0x4a4a4a, 'board.plinth': 0xd0d0d0,
    'label.bg': 0x000000, 'label.fg': 0xffffff, 'label.refuse': 0xffd400,
    'card.face': 0xffffff, 'card.ink': 0x000000, 'card.edge': 0x000000,
    'faction.ember': 0xff8a3d, 'faction.tide': 0x4cc3ff, 'faction.neutral': 0xe6e6e6,
    'door.ember': 0xff8a3d, 'door.tide': 0x4cc3ff, 'door.neutral': 0xe6e6e6, 'door.frame': 0xffffff,
    reticle: 0xffffff, dwell: 0xffd400,
  },
};

// A faction's letter, for every place its colour is shown.
export const FACTION_MARK = { ember: 'E', tide: 'T', neutral: 'N' };

// The pairs a person must tell apart, per theme: [role, against, minimum ratio].
export const PAIRS = [
  ['label.fg', 'label.bg', 7], ['label.refuse', 'label.bg', 7], ['card.ink', 'card.face', 7],
  ['pad', 'altar.stone', 3], ['deck.top', 'altar.stone', 3], ['castle', 'altar.stone', 3],
  ['altar.eye', 'altar.stone', 3], ['board.near', 'board.base', 3], ['board.far', 'board.base', 2.2],
  ['board.plinth', 'board.near', 3], ['faction.ember', 'board.base', 3], ['faction.tide', 'board.base', 3],
  ['faction.neutral', 'board.base', 3], ['reticle', 'board.base', 7], ['dwell', 'board.base', 7],
  ['pad.focus', 'pad', 3],
];

export const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

// WCAG 2.x relative luminance and contrast ratio.
export function luminance(hex) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((hex >> 16) & 255) + 0.7152 * lin((hex >> 8) & 255) + 0.0722 * lin(hex & 255);
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export const themeFor = (a) => (a?.highContrast ? 'contrast' : 'standard');
