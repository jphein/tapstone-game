// palette.js: the world art's colours, per place and per faction (docs/superpowers/specs/
// 2026-09-28-xr-world-art-design.md). Pure data. The Tea House's and the planes' names are canon
// (0039); the colours are the art direction's, and the Dueling Grounds' look is a PROPOSAL.
export const PLACE_PALETTE = {
  teahouse: { cedar: 0x3a2418, cedarLight: 0x6a4428, lacquer: 0xb8322a, paper: 0xf3dfb8, lantern: 0xffb45a, gold: 0xd8b25a, stone: 0x8f9488, jade: 0x6f8a78, ink: 0x1a1210 },
  grounds: { slate: 0x161a28, indigo: 0x262c46, mist: 0x8a93b8, gilt: 0xc9a55a }, // PROPOSAL
};

// Keyed by the engine's factions, like FACTION (board.js): tide = the Deep Tides, ember = the Forge
// Peaks, neutral = the Hearthlands (0039, ruled by JP).
export const FACTION_PALETTE = {
  tide: { base: 0x0a2540, mid: 0x1f6fa8, light: 0x9fe3ff, accent: 0xe8f4f2, sigil: 'wave' },
  ember: { base: 0x231c1a, mid: 0xe0663a, light: 0xffb347, accent: 0x6b5f58, sigil: 'flame' },
  neutral: { base: 0x6e4526, mid: 0xb0703a, light: 0xf4ead2, accent: 0x6b8f4e, sigil: 'leaf' },
};

export const css = (hex, a = 1) => {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return a >= 1 ? `#${hex.toString(16).padStart(6, '0')}` : `rgba(${r},${g},${b},${a})`;
};

export const factionOf = (f) => FACTION_PALETTE[f] ?? FACTION_PALETTE.neutral;

// The colours the art actually paints its key surfaces with, by the theme's roles (logic/theme.js
// THEMES.standard is this table; test/art-contrast.test.js holds the two equal and each colour used
// in its source file).
export const ART = {
  stone: 0x6d716c, // the granite's ground (stone.js)
  eye: 0xe0a526, eyeRefuse: 0xd9342f, // the crystal eye's glow (altar.js)
  pad: 0x3d2616, // the walnut pads (stone.js)
  deckEdge: 0x9e8557, // the stack's paper leaves (card-mesh.js)
  back: PLACE_PALETTE.grounds.indigo, // the card back (card-face.js)
  cardEdge: 0xc9a55a, // a card's gilt edge (card-mesh.js)
  parchment: 0xf7eed8, ink: 0x2a1c12, // a face's ribbon and text box, and its ink (card-face.js)
  boardBase: 0x2a2c34, // the slab under the mat (board-mat.js)
  boardNear: PLACE_PALETTE.grounds.indigo, boardFar: PLACE_PALETTE.grounds.slate, // the mat's two sides
  labelBg: 0x18120e, labelFg: 0xf6e7c4, labelRefuse: 0xffb49a, // the plates (plates.js)
  doorFrame: PLACE_PALETTE.teahouse.lacquer, // the red door's torii (doors.js)
};
