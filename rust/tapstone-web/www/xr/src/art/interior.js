// interior.js: the Tea House in full VR (0039: "lantern light, magical tea, comfortable seating and a
// Shinto/Mayan design influence"). Everything static is ONE merged mesh, its lantern light baked into
// vertex colours (no real-time light reaches it), and every glow (the lantern halos, the steam off the
// magical tea, dust in the lantern light) is ONE point cloud: two draw calls for the room.
//   - a plank floor with four tatami under the low table, zabuton cushions for both seats;
//   - four walls of cedar posts and shoji, lit from behind, over a wooden wainscot, under a stone
//     frieze of stepped frets (the Mayan influence); a beamed ceiling;
//   - a low lacquered table with a vermilion edge, and on its corner an iron teapot and two celadon
//     cups whose tea glows jade (the magical tea: its look is a PROPOSAL);
//   - four hanging paper lanterns and two floor andon.
// Room: board-local, 6 x 6 m, the floor FLOOR_Y under the table top, walls at +-3 m.
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Mesh, MeshBasicMaterial, Points, ShaderMaterial, SphereGeometry, PlaneGeometry } from '@iwsdk/core';
import { bake, hash, merge, mix, shade } from './geo.js';
import { ADD } from './air.js';
import { ANDON_AT, FULL, LANTERN_AT, MOOD, TEA_AT, WRAP, moodLights } from '../logic/atmosphere.js';
import { slab } from './stone.js';
import { PLACE_PALETTE } from './palette.js';
import { FLOOR_Y } from './labels.js';

const T = PLACE_PALETTE.teahouse;
const F = FLOOR_Y, H = 2.4, HALF = 3;
// Where the lights hang and the tea sits: the mood's (logic/atmosphere.js), which its test checks.
export const LANTERNS = LANTERN_AT;
export const ANDON = ANDON_AT;
const TEA = TEA_AT;
// The censer (PROPOSAL), on the floor past the table's far-left corner, in the seated view.
export const CENSER = [-0.62, F, -0.9];

// One wall's parts in wall-local coordinates (x along it, y up from the floor, +z into the room).
function wallParts() {
  const p = [], post = T.cedar, wood = T.cedarLight;
  for (let x = -HALF; x <= HALF + 1e-6; x += 1.5) p.push({ geo: new BoxGeometry(0.13, H, 0.13), at: [x, H / 2, 0.065], color: post });
  for (let x0 = -HALF; x0 < HALF - 1e-6; x0 += 1.5) {
    const cx = x0 + 0.75, pw = 1.37;
    p.push({ geo: new BoxGeometry(pw, 0.45, 0.03, 4, 1, 1), at: [cx, 0.225, 0.02], color: (x) => mix(wood, shade(wood, 0.8), hash(Math.floor(x * 12))) });
    p.push({ geo: new PlaneGeometry(pw, 1.5, 4, 6), at: [cx, 0.45 + 0.75, 0.005], color: T.paper, paper: true });
    for (let k = 1; k < 4; k++) p.push({ geo: new BoxGeometry(0.018, 1.5, 0.02), at: [x0 + 0.065 + (k * pw) / 4, 1.2, 0.02], color: post });
    for (let k = 1; k < 5; k++) p.push({ geo: new BoxGeometry(pw, 0.018, 0.02), at: [cx, 0.45 + (k * 1.5) / 5, 0.02], color: post });
    p.push({ geo: new BoxGeometry(pw, 0.05, 0.05), at: [cx, 0.45, 0.03], color: post });
    p.push({ geo: new BoxGeometry(pw, 0.05, 0.05), at: [cx, 1.95, 0.03], color: post });
  }
  // The frieze: stone with a row of stepped frets in relief.
  p.push({ geo: new BoxGeometry(2 * HALF, 0.45, 0.04, 12, 1, 1), at: [0, 1.95 + 0.225, 0.02], color: T.stone });
  for (let x = -HALF + 0.15; x < HALF - 0.1; x += 0.3) {
    const flip = Math.round((x + HALF) / 0.3) % 2 ? -1 : 1, y = 2.175;
    p.push({ geo: new BoxGeometry(0.26, 0.04, 0.03), at: [x, y - flip * 0.1, 0.05], color: T.jade });
    p.push({ geo: new BoxGeometry(0.16, 0.05, 0.03), at: [x, y - flip * 0.055, 0.05], color: T.jade });
    p.push({ geo: new BoxGeometry(0.06, 0.05, 0.03), at: [x, y - flip * 0.005, 0.05], color: T.jade });
  }
  return p;
}

function roomParts() {
  const lit = [], glow = [], paper = [];
  // The floor: planks along z, each its own tone.
  for (let k = 0; k < 20; k++) {
    const x = -HALF + 0.15 + k * 0.3, tone = mix(0x5e3c22, 0x7c5232, hash(k, 3));
    lit.push({ geo: new BoxGeometry(0.29, 0.02, 2 * HALF, 1, 1, 8), at: [x, F - 0.01, 0], color: tone });
  }
  // Tatami under the table, with their dark borders.
  for (const [x, z, w, d] of [[-0.45, 0.1, 0.9, 1.8], [0.45, 0.1, 0.9, 1.8]]) {
    lit.push({ geo: new BoxGeometry(w - 0.02, 0.012, d - 0.02, 3, 1, 6), at: [x, F + 0.006, z], color: (px, py, pz) => mix(0x7c7040, 0x8e8250, 0.5 + 0.5 * Math.sin(px * 90)) });
    for (const [bx, bz, bw, bd] of [[x, z - d / 2 + 0.015, w, 0.03], [x, z + d / 2 - 0.015, w, 0.03], [x - w / 2 + 0.015, z, 0.03, d], [x + w / 2 - 0.015, z, 0.03, d]]) {
      lit.push({ geo: new BoxGeometry(bw, 0.014, bd), at: [bx, F + 0.007, bz], color: 0x2a2418 });
    }
  }
  // Four walls.
  for (const [x, z, ry] of [[0, -HALF, 0], [0, HALF, Math.PI], [-HALF, 0, Math.PI / 2], [HALF, 0, -Math.PI / 2]]) {
    for (const part of wallParts()) {
      const g = (part.geo.index ? part.geo.toNonIndexed() : part.geo);
      g.translate(...part.at);
      g.rotateY(ry);
      g.translate(x, F, z);
      (part.paper ? paper : part.glow ? glow : lit).push({ geo: g, color: part.color, glow: part.glow });
    }
  }
  // The ceiling and its beams.
  lit.push({ geo: new PlaneGeometry(2 * HALF, 2 * HALF, 6, 6), rot: [Math.PI / 2, 0, 0], at: [0, F + H, 0], color: 0x2a1a10 });
  for (let x = -2.5; x <= 2.5; x += 1) lit.push({ geo: new BoxGeometry(0.14, 0.16, 2 * HALF, 1, 1, 6), at: [x, F + H - 0.08, 0], color: T.cedar });
  // The low table: a lacquered top with a vermilion edge, four legs.
  const top = -0.015, tw = 1.0, td = 0.9, tz = 0.1;
  lit.push({ geo: slab(tw, td, top - 0.045, top, { r: 0.03, bevel: 0.008 }), at: [0, 0, tz], color: 0x241612 });
  lit.push({ geo: new BoxGeometry(tw - 0.01, 0.012, 0.012), at: [0, top - 0.03, tz + td / 2 - 0.004], color: T.lacquer });
  lit.push({ geo: new BoxGeometry(tw - 0.01, 0.012, 0.012), at: [0, top - 0.03, tz - td / 2 + 0.004], color: T.lacquer });
  lit.push({ geo: new BoxGeometry(0.012, 0.012, td - 0.01), at: [tw / 2 - 0.004, top - 0.03, tz], color: T.lacquer });
  lit.push({ geo: new BoxGeometry(0.012, 0.012, td - 0.01), at: [-tw / 2 + 0.004, top - 0.03, tz], color: T.lacquer });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) lit.push({ geo: new BoxGeometry(0.07, top - 0.045 - F, 0.07), at: [sx * (tw / 2 - 0.08), (F + top - 0.045) / 2, tz + sz * (td / 2 - 0.08)], color: 0x1c110c });
  // Cushions for both seats.
  lit.push({ geo: slab(0.62, 0.62, F, F + 0.09, { r: 0.08, bevel: 0.03, segments: 2 }), at: [0, 0, 0.95], color: 0x2e3468 });
  lit.push({ geo: slab(0.62, 0.62, F, F + 0.09, { r: 0.08, bevel: 0.03, segments: 2 }), at: [0, 0, -0.75], color: 0x7a2430 });
  // The tea: an iron pot and two celadon cups, their tea glowing jade.
  lit.push({ geo: new SphereGeometry(0.045, 12, 8), at: [-0.4, top + 0.035, -0.22], scale: [1, 0.78, 1], color: 0x2c2a2e });
  lit.push({ geo: new CylinderGeometry(0.008, 0.012, 0.06, 6), at: [-0.35, top + 0.05, -0.2], rot: [0, 0, -0.9], color: 0x2c2a2e });
  lit.push({ geo: new CylinderGeometry(0.018, 0.022, 0.012, 10), at: [-0.4, top + 0.068, -0.22], color: 0x3a383c });
  for (const [x, , z] of TEA) {
    lit.push({ geo: new CylinderGeometry(0.022, 0.017, 0.036, 12, 1, true), at: [x, top + 0.018, z], color: 0x8fb3a0 });
    lit.push({ geo: new CylinderGeometry(0.017, 0.017, 0.002, 12), at: [x, top + 0.001, z], color: 0x8fb3a0 });
    glow.push({ geo: new CylinderGeometry(0.0205, 0.0205, 0.002, 12), at: [x, top + 0.031, z], color: 0x7ff0c0, glow: 1 });
  }
  // Lanterns: paper bodies (glowing), black caps, cords to the ceiling; andon on the floor.
  for (const [x, y, z] of LANTERNS) {
    glow.push({ geo: new SphereGeometry(0.15, 14, 10), at: [x, y, z], scale: [1, 1.3, 1], color: 0xffc070, glow: 1 });
    for (const dy of [-0.2, 0.2]) lit.push({ geo: new CylinderGeometry(0.085, 0.085, 0.035, 12), at: [x, y + dy, z], color: 0x121010 });
    lit.push({ geo: new BoxGeometry(0.01, F + H - y - 0.22, 0.01), at: [x, (F + H + y + 0.22) / 2, z], color: 0x121010 });
  }
  for (const [x, y, z] of ANDON) {
    glow.push({ geo: new BoxGeometry(0.26, 0.5, 0.26), at: [x, y + 0.06, z], color: 0xffd08a, glow: 0.85 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) lit.push({ geo: new BoxGeometry(0.03, 0.72, 0.03), at: [x + sx * 0.14, F + 0.36, z + sz * 0.14], color: T.cedar });
    lit.push({ geo: new BoxGeometry(0.32, 0.03, 0.32), at: [x, F + 0.72, z], color: T.cedar });
  }
  // The censer (PROPOSAL): a bronze bowl on three feet beside the table, its incense glowing.
  const [cx, cy, cz] = CENSER;
  lit.push({ geo: new CylinderGeometry(0.1, 0.07, 0.09, 12), at: [cx, cy + 0.155, cz], color: 0x6a4a24 });
  lit.push({ geo: new CylinderGeometry(0.105, 0.105, 0.012, 12), at: [cx, cy + 0.2, cz], color: 0x8a6a34 });
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3;
    lit.push({ geo: new BoxGeometry(0.02, 0.12, 0.02), at: [cx + Math.cos(a) * 0.06, cy + 0.06, cz + Math.sin(a) * 0.06], color: 0x4a3218 });
  }
  glow.push({ geo: new CylinderGeometry(0.003, 0.003, 0.14, 4), at: [cx, cy + 0.27, cz], color: 0x7a5a3a, glow: 0.3 });
  glow.push({ geo: new SphereGeometry(0.006, 6, 4), at: [cx, cy + 0.34, cz], color: 0xff7a30, glow: 1 });
  return { lit, glow, paper };
}

export const LIGHTS = moodLights();

// Contact darkening: into the floor's corners and edges, and under the table.
function occlude(p) {
  const up = p.y - F, edge = HALF - Math.max(Math.abs(p.x), Math.abs(p.z));
  let ao = 1 - 0.45 * Math.exp(-edge * 3) * Math.exp(-up * 1.5);
  if (Math.abs(p.x) < 0.5 && p.z > -0.35 && p.z < 0.55 && p.y < -0.06) ao *= 0.45 + 0.55 * Math.min(1, up / 0.3);
  if (up > H - 0.5) ao *= 0.75;
  return ao;
}

// The room's static mesh (one draw), at dusk (logic/atmosphere.js MOOD): lit parts baked in pools of
// lantern light over a deep blue-violet dimness; the glowing parts (lanterns, andon, the tea) at their
// own brightness; the shoji paper lit from OUTSIDE by the dusk (violet above, a rose band low), with
// the lanterns warming the paper near them from inside.
export function buildRoomMesh() {
  const { lit, glow, paper } = roomParts();
  const litGeo = bake(merge(lit), { lights: LIGHTS, ambient: MOOD.ambient, occlude, wrap: WRAP });
  const glowGeo = merge(glow);
  const paperGeo = merge(paper);
  const inside = bake(merge(paper), { lights: LIGHTS.slice(0, LANTERNS.length + ANDON.length), ambient: 0x000000, wrap: 1 });
  const col = paperGeo.getAttribute('color'), pos = paperGeo.getAttribute('position'), warm = inside.getAttribute('color');
  const hi = new Color(MOOD.duskHigh), lo = new Color(MOOD.duskLow), c = new Color();
  for (let i = 0; i < col.count; i++) {
    const h = Math.min(1, Math.max(0, (pos.getY(i) - (F + 0.45)) / 1.5)); // 0 at the paper's foot, 1 at its top
    c.copy(lo).lerp(hi, Math.min(1, h * 1.6)).multiplyScalar(MOOD.duskGain);
    col.setXYZ(i, Math.min(1, c.r + warm.getX(i) * 0.35), Math.min(1, c.g + warm.getY(i) * 0.3), Math.min(1, c.b + warm.getZ(i) * 0.22));
  }
  inside.dispose();
  const geo = merge([{ geo: litGeo }, { geo: glowGeo }, { geo: paperGeo }]);
  return new Mesh(geo, new MeshBasicMaterial({ vertexColors: true }));
}

// Glows as one point cloud (one draw call): a halo per lantern and andon that flickers with its
// flame, dust motes drifting up through the lantern light, embers rising round the lanterns, incense
// curling up from the censer, and steam off the teapot and the magical tea (logic/atmosphere.js
// FULL.room sizes each; aKeep marks the half that stays with reduced motion).
// aKind: 0 halo, 1 dust, 2 steam, 3 ember, 4 incense.
const SPOUT = [-0.35, -0.015 + 0.075, -0.2];
const vertex = /* glsl */ `
attribute float aSize;
attribute float aKind;
attribute float aPhase;
attribute float aKeep;
attribute vec3 aColor;
uniform float uTime;
uniform float uSpeed;
uniform float uCalm;
uniform float uFlick;
uniform float uScale;
varying vec3 vColor;
varying float vFade;
float flicker(float t, float s) {
  return 1.0 + uFlick * 0.08 * (0.5 * sin(t * 7.3 + s * 1.7) + 0.3 * sin(t * 13.1 + s * 4.1) + 0.2 * sin(t * 2.3 + s));
}
void main() {
  vec3 p = position;
  float T = uTime * uSpeed, size = aSize;
  vFade = 1.0;
  if (aKind > 3.5) {
    // Incense: rising, widening and curling, then gone.
    float t = fract(T * 0.035 + aPhase);
    p.y += t * 1.5;
    p.x += sin(t * 6.0 + aPhase * 12.0) * 0.12 * t + t * 0.1;
    p.z += cos(t * 5.0 + aPhase * 9.0) * 0.1 * t;
    size *= 0.5 + 2.2 * t;
    vFade = smoothstep(0.0, 0.08, t) * pow(1.0 - t, 1.5) * 0.55;
  } else if (aKind > 2.5) {
    // Embers: rising slowly round a lantern, swaying, winking out.
    float t = fract(T * (0.06 + fract(aPhase * 7.0) * 0.05) + aPhase);
    p.y += t * 0.9 - 0.25;
    p.x += sin(T * 0.7 + aPhase * 30.0) * 0.18;
    p.z += cos(T * 0.5 + aPhase * 21.0) * 0.18;
    vFade = smoothstep(0.0, 0.1, t) * (1.0 - t) * (0.55 + 0.45 * sin(T * 6.0 + aPhase * 80.0));
  } else if (aKind > 1.5) {
    float t = fract(T * 0.18 + aPhase);
    p.y += t * 0.22;
    p.x += sin(t * 9.0 + aPhase * 20.0) * 0.012 * t;
    size *= 1.0 + t * 1.5;
    vFade = smoothstep(0.0, 0.15, t) * (1.0 - t);
  } else if (aKind > 0.5) {
    float t = fract(T * 0.012 + aPhase);
    p.y += t * 0.8;
    p.x += sin(T * 0.3 + aPhase * 40.0) * 0.12;
    p.z += cos(T * 0.23 + aPhase * 31.0) * 0.12;
    vFade = smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.8, t) * (0.5 + 0.5 * sin(T * 1.3 + aPhase * 50.0));
  } else {
    float f = flicker(uTime, aPhase * 10.0);
    size *= f;
    vFade = f;
  }
  if (uCalm > 0.5 && aKeep < 0.5) vFade = 0.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = vFade > 0.0 ? size * uScale * projectionMatrix[1][1] / -mv.z : 0.0;
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}`;
const fragment = /* glsl */ `
uniform float uDim;
varying vec3 vColor;
varying float vFade;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - r), 2.2) * vFade * uDim;
  gl_FragColor = vec4(pow(vColor, vec3(2.2)) * a, a);
  #include <colorspace_fragment>
}`;

export function buildGlows(counts = FULL.room) {
  const pts = [];
  const keep = (k) => (k % 2 === 0 ? 1 : 0);
  // Halos: a wide soft glow and a tight hot core per lantern and andon (the dusk makes them read).
  LANTERNS.forEach((at, k) => {
    pts.push({ at, size: 2.1, kind: 0, phase: k / 7, keep: 1, color: [0.85, 0.46, 0.16] });
    pts.push({ at, size: 0.6, kind: 0, phase: k / 7, keep: 1, color: [1.0, 0.75, 0.42] });
  });
  ANDON.forEach((at, k) => {
    pts.push({ at: [at[0], at[1] + 0.06, at[2]], size: 1.3, kind: 0, phase: 0.5 + k / 7, keep: 1, color: [0.55, 0.32, 0.12] });
    pts.push({ at: [at[0], at[1] + 0.06, at[2]], size: 0.45, kind: 0, phase: 0.5 + k / 7, keep: 1, color: [0.85, 0.58, 0.3] });
  });
  // Motes through the whole room at a seated eye's height (the head is ~0.8 m over the floor).
  for (let k = 0; k < counts.dust; k++) pts.push({ at: [(hash(k, 1) - 0.5) * 5.2, F + 0.35 + hash(k, 2) * 0.9, (hash(k, 3) - 0.5) * 5.2], size: 0.03, kind: 1, phase: hash(k, 4), keep: keep(k), color: [1.0, 0.78, 0.48] });
  for (let k = 0; k < counts.embers; k++) {
    const l = LANTERNS[k % LANTERNS.length];
    pts.push({ at: [l[0] + (hash(k, 5) - 0.5) * 0.5, l[1] - 0.3, l[2] + (hash(k, 6) - 0.5) * 0.5], size: 0.012, kind: 3, phase: hash(k, 7), keep: keep(k), color: [1.0, 0.55, 0.2] });
  }
  for (let k = 0; k < counts.incense; k++) pts.push({ at: [CENSER[0], CENSER[1] + 0.3, CENSER[2]], size: 0.07, kind: 4, phase: k / counts.incense, keep: keep(k), color: [0.32, 0.28, 0.4] });
  const cups = Math.round((counts.steam * 2) / 3);
  for (let k = 0; k < counts.steam; k++) {
    const at = k < cups ? [TEA[k % 2][0], TEA[k % 2][1] + 0.035, TEA[k % 2][2]] : SPOUT;
    pts.push({ at, size: 0.025, kind: 2, phase: (k * 0.618) % 1, keep: keep(k), color: k < cups ? [0.45, 0.9, 0.7] : [0.55, 0.55, 0.6] });
  }
  const n = pts.length, geo = new BufferGeometry();
  const f = (k, fn) => {
    const a = new Float32Array(n * k);
    pts.forEach((p, i) => a.set([fn(p)].flat(), i * k));
    return new BufferAttribute(a, k);
  };
  geo.setAttribute('position', f(3, (p) => p.at));
  geo.setAttribute('aSize', f(1, (p) => p.size));
  geo.setAttribute('aKind', f(1, (p) => p.kind));
  geo.setAttribute('aPhase', f(1, (p) => p.phase ?? 0));
  geo.setAttribute('aKeep', f(1, (p) => p.keep));
  geo.setAttribute('aColor', f(3, (p) => p.color));
  geo.computeBoundingSphere();
  const mat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 540 }, uSpeed: { value: 1 }, uCalm: { value: 0 }, uFlick: { value: 1 }, uDim: { value: 1 } },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    ...ADD,
  });
  const points = new Points(geo, mat);
  points.frustumCulled = false; // the motes move in the shader
  points.userData.particles = n - 2 * (LANTERNS.length + ANDON.length); // halos are not particles
  return points;
}
