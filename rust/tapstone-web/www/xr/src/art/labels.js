// labels.js: every in-scene label's plate, canvas and place, in one table the painters build from
// and test/art-type.test.js holds to the legibility guard (type.js). Pure (layout.js numbers only).
// `at` is the plate's centre and `normal` its facing, board-local; the guard reads each from the
// seated head (layout.js defaultHead), the view the FoV test also uses.
import { ALTAR, BOARD, CARD, CASTLE_PLAQUE, DOOR_DISTANCE, FAR_KEEP, HAND, LANE_W, PROMPT, ROW_D, defaultHead } from '../logic/layout.js';
import { capDegrees, floorPx } from './type.js';

const S45 = Math.SQRT1_2;
// The floor the doors and the room stand on, board-local (teahouse.js).
export const FLOOR_Y = -0.4;
// The card face canvas is logic/card-art.js's FACE times this (the painting's window keeps its numbers).
export const FACE_SCALE = 1.25;

export const LABELS = {
  // A unit's stats plate, over the farthest cell a unit can stand in (the other seat's back row).
  unitTag: { plate: [LANE_W * 0.7, 0.022], canvas: [256, 48], maxPx: 40, at: { x: -BOARD.w / 2 + LANE_W / 2, y: 0.03, z: -BOARD.d / 2 + ROW_D / 2 }, normal: { x: 0, y: S45, z: S45 } },
  // Life and mana on my castle plaque, tilted toward me.
  lifeMine: { plate: [0.17, 0.042], canvas: [512, 128], maxPx: 96, at: { x: 0, y: 0.035, z: CASTLE_PLAQUE.z + 0.02 }, normal: { x: 0, y: S45, z: S45 } },
  // The other seat's life, over the far keep.
  lifeTheirs: { plate: [0.12, 0.036], canvas: [384, 112], maxPx: 84, at: { x: 0, y: FAR_KEEP.h + 0.035, z: FAR_KEEP.z }, normal: { x: 0, y: 0, z: 1 } },
  // The stone's voice line: a slanted strip along the altar's front, up to two lines.
  voice: { plate: [ALTAR.w * 0.94, 0.03], canvas: [1024, 112], maxPx: 46, lines: 2, at: { x: 0, y: 0.014, z: ALTAR.z + ALTAR.d / 2 + 0.012 }, normal: { x: 0, y: S45, z: S45 } },
  // A prompt tile (a spell's target, the mulligan), one of three over the altar, tilted 30° back.
  prompt: { plate: [PROMPT.w / 3 - 0.006, PROMPT.h], canvas: [336, 240], maxPx: 64, lines: 2, at: { x: PROMPT.w / 3, y: PROMPT.y, z: PROMPT.z }, normal: { x: 0, y: 0.5, z: Math.sqrt(3) / 2 } },
  // A realm door's name, on the plaque between its lintels, at the door's distance and height.
  doorName: { plate: [0.56, 0.1], canvas: [640, 112], maxPx: 70, at: { x: 0, y: FLOOR_Y + 1.67, z: defaultHead().z - DOOR_DISTANCE }, normal: { x: 0, y: 0, z: 1 } },
  // The red door's name in full VR, where it stands in the far wall (teahouse.js RED_DOOR.vr).
  redDoorVR: { plate: [0.56, 0.1], canvas: [640, 112], maxPx: 70, at: { x: 0, y: FLOOR_Y + 1.67, z: -2.87 }, normal: { x: 0, y: 0, z: 1 } },
  // The lintel over the far wall's red door, on the frieze clear of the wall's posts, full VR only.
  lintel: { plate: [0.9, 0.16], canvas: [640, 112], maxPx: 72, at: { x: 0, y: 1.78, z: -2.855 }, normal: { x: 0, y: 0, z: 1 } },
  // A hand card's name and its rules text, in the fan (the card tilted 60° toward the head).
  cardName: { plate: [CARD.w, CARD.d], canvas: [216 * FACE_SCALE, 344 * FACE_SCALE], maxPx: 22 * FACE_SCALE, at: { x: 0, y: HAND.y, z: HAND.z }, normal: { x: 0, y: 0.5, z: Math.sqrt(3) / 2 } },
  cardText: { plate: [CARD.w, CARD.d], canvas: [216 * FACE_SCALE, 344 * FACE_SCALE], maxPx: 16 * FACE_SCALE, at: { x: 0, y: HAND.y, z: HAND.z }, normal: { x: 0, y: 0.5, z: Math.sqrt(3) / 2 } },
};

// How the seated head sees a label: its distance and obliquity.
export function seen(spec, head = defaultHead()) {
  const v = { x: head.x - spec.at.x, y: head.y - spec.at.y, z: head.z - spec.at.z };
  const dist = Math.hypot(v.x, v.y, v.z);
  const n = spec.normal, cos = (v.x * n.x + v.y * n.y + v.z * n.z) / dist;
  return { dist, oblique: (Math.acos(Math.min(1, Math.abs(cos))) * 180) / Math.PI };
}

// The label's guard input at font `fontPx`, and its floor font px.
export function specOf(name, fontPx) {
  const l = LABELS[name], s = seen(l);
  const g = { name, plateH: l.plate[1], canvasH: l.canvas[1], dist: s.dist, oblique: s.oblique };
  return { ...g, fontPx: fontPx ?? l.maxPx, floor: floorPx(g), deg: capDegrees({ ...g, fontPx: fontPx ?? l.maxPx }) };
}

// The floor font px for a label's lines: the painters never draw under it.
export const minPxOf = (name) => specOf(name).floor;
