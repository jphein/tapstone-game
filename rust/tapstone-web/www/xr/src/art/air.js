// air.js: the Tea House's moving air and living light (design note 2026-09-29-xr-atmosphere-design.md),
// all of it on the GPU: the particles move in their shaders, so a frame costs uniforms only.
//   - doorAir: each door breathes its realm (logic/atmosphere.js DOOR_AIR): the Forge Peaks' sparks,
//     the Deep Tides' bubbles, the Hearthlands' fireflies, the red door's violet wisps. ONE point cloud
//     for every door, in each door's own frame (a matrix per door), so a door that swells or moves
//     (the red door, per room) carries its air with it. Both rooms.
//   - floorLight: each door's light thrown on the floor in front of it: caustics, heat, dappled leaf
//     light, a violet pulse. ONE mesh, additive. Both rooms (in mixed reality, the player's own floor).
//   - rays: moonlight falling through the shoji (full VR only). ONE additive mesh.
// Reduced motion keeps half of every kind (aKeep) and slows it; high contrast dims it (never over what a
// person must read). Every look here is a PROPOSAL.
import { AddEquation, BufferAttribute, BufferGeometry, CustomBlending, DoubleSide, Matrix4, Mesh, OneFactor, Points, ShaderMaterial } from '@iwsdk/core';
import { hash } from './geo.js';
import { ready } from './contrast.js';
import { FULL } from '../logic/atmosphere.js';

export const DOOR_KIND = { sparks: 0, bubbles: 1, fireflies: 2, wisps: 3, lamp: 4 };
export const LIGHT_KIND = { ember: 0, tide: 1, neutral: 2, grounds: 3 };
const MAX_DOORS = 4;

// True additive light for premultiplied output (every shader here writes rgb * a, a): three's
// AdditiveBlending scales by alpha again (a squared: a faint layer vanished), and in mixed reality
// the alpha must add too, so the compositor blends the glow over passthrough as light, not paint.
export const ADD = { blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor, blendSrcAlpha: OneFactor, blendDstAlpha: OneFactor };

// The uniforms every air material shares: time, speed, calm (reduced motion), dim, the doors' matrices.
export function airUniforms() {
  return {
    uTime: { value: 0 },
    uSpeed: { value: 1 },
    uCalm: { value: 0 },
    uDim: { value: 1 },
    uScale: { value: 540 },
    uDoor: { value: Array.from({ length: MAX_DOORS }, () => new Matrix4()) },
  };
}

function attrs(geo, n, fields) {
  for (const [name, size, fn] of fields) {
    const a = new Float32Array(n * size);
    for (let i = 0; i < n; i++) a.set([fn(i)].flat(), i * size);
    geo.setAttribute(name, new BufferAttribute(a, size));
  }
}

const doorVertex = /* glsl */ `
attribute float aKind;
attribute float aDoor;
attribute float aPhase;
attribute float aKeep;
attribute vec3 aSeed;
uniform float uTime;
uniform float uSpeed;
uniform float uCalm;
uniform float uScale;
uniform mat4 uDoor[${MAX_DOORS}];
varying float vKind;
varying float vFade;
varying vec3 vColor;
void main() {
  float T = uTime * uSpeed;
  vec3 p;
  float size;
  vKind = aKind;
  if (aKind < 0.5) {
    // Sparks: out of the portal's lower half, up and toward the room, gone in a second or two.
    float t = fract(T * (0.45 + aSeed.x * 0.4) + aPhase);
    p = vec3((aSeed.y - 0.5) * 0.5 + sin(t * 9.0 + aSeed.z * 6.0) * 0.03, 0.15 + aSeed.z * 0.6 + t * (0.7 + aSeed.x * 0.5), 0.02 + t * (0.45 + aSeed.y * 0.3));
    vFade = smoothstep(0.0, 0.08, t) * (1.0 - t) * (0.6 + 0.4 * sin(T * 40.0 + aPhase * 90.0));
    vColor = mix(vec3(1.0, 0.75, 0.3), vec3(1.0, 0.3, 0.08), t);
    size = 0.011;
  } else if (aKind < 1.5) {
    // Bubbles: rising in front of the portal with a wobble, drifting out a little.
    float t = fract(T * (0.12 + aSeed.x * 0.08) + aPhase);
    p = vec3((aSeed.y - 0.5) * 0.6 + sin(t * 12.0 + aSeed.z * 9.0) * 0.025, 0.1 + t * 1.5, 0.04 + aSeed.z * 0.35 + t * 0.12);
    vFade = smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.8, t);
    vColor = vec3(0.6, 0.9, 1.0);
    size = 0.012 + aSeed.x * 0.018;
  } else if (aKind < 2.5) {
    // Fireflies: slow loops in a volume before the door, blinking.
    float w = T * (0.18 + aSeed.x * 0.12) + aPhase * 6.283;
    p = vec3(sin(w) * 0.45 * aSeed.y + (aSeed.z - 0.5) * 0.3, 0.25 + aSeed.z * 1.1 + sin(w * 1.7) * 0.12, 0.25 + cos(w * 0.8) * 0.3 * aSeed.x + aSeed.y * 0.3);
    vFade = pow(max(0.0, sin(T * (0.7 + aSeed.x) + aPhase * 30.0)), 3.0);
    vColor = vec3(0.95, 1.0, 0.45);
    size = 0.016;
  } else if (aKind > 3.5) {
    // Lamps: a warm glow hung at each end of the torii's lintel, breathing like a flame (PROPOSAL).
    p = vec3(aSeed.x > 0.5 ? 0.43 : -0.43, 1.74, 0.06);
    float f = 1.0 + 0.08 * (0.5 * sin(uTime * 7.3 + aPhase * 17.0) + 0.3 * sin(uTime * 13.1 + aPhase * 41.0)) * (1.0 - uCalm);
    vFade = 0.9 * f;
    vColor = aSeed.y > 0.5 ? vec3(1.0, 0.62, 0.25) : vec3(1.0, 0.85, 0.55);
    size = aSeed.y > 0.5 ? 0.42 : 0.1; // a soft halo and its hot core
  } else {
    // Wisps: slow violet spirals climbing out of the red door.
    float t = fract(T * 0.05 + aPhase);
    float w = t * 12.0 + aSeed.x * 6.283;
    p = vec3(sin(w) * (0.12 + t * 0.3), 0.2 + t * 1.3, 0.05 + cos(w) * 0.1 + t * 0.25);
    vFade = smoothstep(0.0, 0.15, t) * smoothstep(1.0, 0.6, t) * 0.7;
    vColor = vec3(0.7, 0.5, 1.0);
    size = 0.05 + aSeed.y * 0.04;
  }
  if (uCalm > 0.5 && aKeep < 0.5 && aKind < 3.5) vFade = 0.0;
  vec4 mv = modelViewMatrix * (uDoor[int(aDoor)] * vec4(p, 1.0));
  gl_PointSize = vFade > 0.0 ? size * uScale * projectionMatrix[1][1] / -mv.z : 0.0;
  gl_Position = projectionMatrix * mv;
}`;

const pointFragment = /* glsl */ `
uniform float uDim;
varying float vKind;
varying float vFade;
varying vec3 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = vKind > 0.5 && vKind < 1.5
    ? smoothstep(1.0, 0.8, r) * (0.25 + 0.75 * smoothstep(0.55, 0.9, r)) // a bubble: a ring
    : pow(max(0.0, 1.0 - r), 2.0);
  a *= vFade * uDim;
  gl_FragColor = vec4(pow(vColor, vec3(2.2)) * a, a);
  #include <colorspace_fragment>
}`;

// `doors`: [{ air: 'sparks' | ..., index }] in uDoor order. `plan.counts` (airPlan) sizes each kind.
export function doorAir(doors, uniforms) {
  const pts = [];
  doors.forEach((d, index) => {
    const n = FULL.door[d.air];
    for (let k = 0; k < n; k++) pts.push({ kind: DOOR_KIND[d.air], door: index, phase: hash(k, index, 1), keep: k % 2 === 0 ? 1 : 0, seed: [hash(k, index, 2), hash(k, index, 3), hash(k, index, 4)] });
    // Two lamps per door, each a halo and a core (seed.x: left or right, seed.y: halo or core).
    for (const side of [0, 1]) for (const halo of [0, 1]) pts.push({ kind: DOOR_KIND.lamp, door: index, phase: hash(side, index, 7), keep: 1, seed: [side, halo, 0] });
  });
  const geo = new BufferGeometry(), n = pts.length;
  attrs(geo, n, [
    ['position', 3, () => [0, 0, 0]],
    ['aKind', 1, (i) => pts[i].kind],
    ['aDoor', 1, (i) => pts[i].door],
    ['aPhase', 1, (i) => pts[i].phase],
    ['aKeep', 1, (i) => pts[i].keep],
    ['aSeed', 3, (i) => pts[i].seed],
  ]);
  const mat = new ShaderMaterial({ uniforms, vertexShader: doorVertex, fragmentShader: pointFragment, transparent: true, depthWrite: false, ...ADD });
  const cloud = new Points(geo, ready(mat));
  cloud.frustumCulled = false; // they move in the shader
  cloud.userData.particles = pts.filter((p) => p.kind !== DOOR_KIND.lamp).length; // lamps are halos, not particles
  return cloud;
}

const lightVertex = /* glsl */ `
attribute float aKind;
attribute float aDoor;
uniform mat4 uDoor[${MAX_DOORS}];
varying vec2 vUv;
varying float vKind;
void main() {
  vUv = uv;
  vKind = aKind;
  gl_Position = projectionMatrix * modelViewMatrix * (uDoor[int(aDoor)] * vec4(position, 1.0));
}`;

const lightFragment = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uDim;
varying vec2 vUv;
varying float vKind;
void main() {
  float T = uTime * uSpeed;
  // uv: x across the doorway (0..1), y out from the door (0 at its foot, 1 at the far end).
  float across = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
  float fall = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.06, vUv.y);
  vec2 q = vec2(vUv.x * 1.2, vUv.y * 1.6);
  vec3 col;
  float k;
  if (vKind < 0.5) {
    k = 0.75 + 0.25 * sin(T * 3.1 + sin(T * 7.3)) ; // heat, breathing
    col = vec3(1.0, 0.42, 0.12) * k;
  } else if (vKind < 1.5) {
    float c = abs(sin(q.x * 13.0 + sin(q.y * 9.0 + T * 1.1) * 1.6 + T * 0.6) * sin(q.y * 11.0 - T * 0.8 + sin(q.x * 7.0)));
    col = vec3(0.35, 0.8, 1.0) * (0.35 + 1.6 * pow(c, 5.0));
  } else if (vKind < 2.5) {
    float leaf = 0.5 + 0.5 * sin(q.x * 17.0 + sin(T * 0.4 + q.y * 5.0) * 2.0) * sin(q.y * 15.0 + T * 0.3);
    col = vec3(1.0, 0.8, 0.45) * (0.35 + 0.6 * smoothstep(0.55, 0.9, leaf));
  } else {
    col = vec3(0.55, 0.35, 1.0) * (0.6 + 0.4 * sin(T * 0.8));
  }
  float a = across * fall * 0.3 * uDim;
  gl_FragColor = vec4(pow(col, vec3(2.2)) * a, a);
  #include <colorspace_fragment>
}`;

// `doors`: [{ light: 'ember' | ..., index }]. A quad per door on the floor in front of it, door-local.
export function floorLight(doors, uniforms, { w = 1.2, d = 1.5, y = 0.004 } = {}) {
  const pos = [], uv = [], kind = [], door = [];
  for (const dd of doors) {
    const quad = [[-w / 2, 0], [w / 2, d], [w / 2, 0], [-w / 2, 0], [-w / 2, d], [w / 2, d]]; // wound to face up
    for (const [x, z] of quad) {
      pos.push(x, y, z + 0.1);
      uv.push(x / w + 0.5, z / d);
      kind.push(LIGHT_KIND[dd.light]);
      door.push(dd.index);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setAttribute('aKind', new BufferAttribute(new Float32Array(kind), 1));
  geo.setAttribute('aDoor', new BufferAttribute(new Float32Array(door), 1));
  const mat = new ShaderMaterial({ uniforms, vertexShader: lightVertex, fragmentShader: lightFragment, transparent: true, depthWrite: false, ...ADD });
  const mesh = new Mesh(geo, ready(mat));
  mesh.frustumCulled = false; // placed by the door matrices
  return mesh;
}

const rayVertex = /* glsl */ `
varying vec2 vUv;
varying float vSeed;
attribute float aSeed;
void main() {
  vUv = uv;
  vSeed = aSeed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const rayFragment = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uDim;
varying vec2 vUv;
varying float vSeed;
void main() {
  // v: 0 at the shoji, 1 where the shaft fades on the floor. u across it.
  float across = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
  float along = smoothstep(0.0, 0.12, vUv.y) * pow(1.0 - vUv.y, 1.3);
  float drift = 0.75 + 0.25 * sin(vUv.x * 23.0 + vUv.y * 7.0 - uTime * uSpeed * 0.25 + vSeed * 20.0);
  float breathe = 0.8 + 0.2 * sin(uTime * uSpeed * 0.21 + vSeed * 6.0);
  float a = across * along * drift * breathe * 0.11 * uDim;
  gl_FragColor = vec4(pow(vec3(0.78, 0.86, 1.0), vec3(2.2)) * a, a);
  #include <colorspace_fragment>
}`;

// Moonlight through the shoji: shafts from the side walls' upper panels, slanting down toward the
// middle of the room. `shafts`: [{ from: [x,y,z], to: [x,y,z], w }] in room coordinates.
export function rays(shafts, uniforms) {
  const pos = [], uv = [], seed = [];
  shafts.forEach((s, k) => {
    const [fx, fy, fz] = s.from, [tx, ty, tz] = s.to;
    // A ribbon across z (the shafts run in x toward the middle), widening as it falls.
    const a = [fx, fy, fz - s.w / 2], b = [fx, fy, fz + s.w / 2], c = [tx, ty, tz + s.w * 0.8], d = [tx, ty, tz - s.w * 0.8];
    for (const [p, u, v] of [[a, 0, 0], [b, 1, 0], [c, 1, 1], [a, 0, 0], [c, 1, 1], [d, 0, 1]]) {
      pos.push(...p);
      uv.push(u, v);
      seed.push(hash(k, 9));
    }
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setAttribute('aSeed', new BufferAttribute(new Float32Array(seed), 1));
  const mat = new ShaderMaterial({ uniforms: { uTime: uniforms.uTime, uSpeed: uniforms.uSpeed, uDim: uniforms.uDim }, vertexShader: rayVertex, fragmentShader: rayFragment, transparent: true, depthWrite: false, ...ADD, side: DoubleSide });
  return new Mesh(geo, ready(mat));
}

const poolVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const poolFragment = /* glsl */ `
uniform float uFlick;
uniform float uDim;
varying vec2 vUv;
void main() {
  float r = length((vUv - 0.5) * vec2(2.0, 2.0));
  float a = pow(max(0.0, 1.0 - r), 1.8) * 0.34 * uFlick * uDim;
  gl_FragColor = vec4(pow(vec3(1.0, 0.8, 0.55), vec3(2.2)) * a, a);
  #include <colorspace_fragment>
}`;

// The lamplight pool on the table (full VR): a soft warm ellipse under the board, so the board sits
// in the room's brightest light (PROPOSAL). ONE additive quad, just above the table top.
export function tablePool({ w = 1.1, d = 0.95, at = [0, -0.013, 0.08] } = {}) {
  const geo = new BufferGeometry();
  const x = w / 2, z = d / 2;
  const P = [[-x, z], [x, z], [x, -z], [-x, z], [x, -z], [-x, -z]];
  geo.setAttribute('position', new BufferAttribute(new Float32Array(P.flatMap(([px, pz]) => [px + at[0], at[1], pz + at[2]])), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(P.flatMap(([px, pz]) => [px / w + 0.5, pz / d + 0.5])), 2));
  const mat = new ShaderMaterial({ uniforms: { uFlick: { value: 1 }, uDim: { value: 1 } }, vertexShader: poolVertex, fragmentShader: poolFragment, transparent: true, depthWrite: false, ...ADD });
  return new Mesh(geo, ready(mat));
}

const moteVertex = /* glsl */ `
attribute float aPhase;
attribute float aKeep;
attribute vec3 aSeed;
uniform float uTime;
uniform float uSpeed;
uniform float uCalm;
uniform float uScale;
varying float vFade;
varying float vKind;
varying vec3 vColor;
void main() {
  float T = uTime * uSpeed;
  float t = fract(T * (0.02 + aSeed.x * 0.02) + aPhase);
  float a = aSeed.y * 6.283 + T * 0.05, r = 0.25 + aSeed.z * 0.65;
  vec3 p = vec3(cos(a) * r, 0.03 + t * 0.55, sin(a) * r * 0.8 + 0.1);
  vFade = smoothstep(0.0, 0.15, t) * smoothstep(1.0, 0.7, t) * (0.55 + 0.45 * sin(T * 1.7 + aPhase * 60.0));
  if (uCalm > 0.5 && aKeep < 0.5) vFade = 0.0;
  vKind = 9.0;
  vColor = vec3(1.0, 0.82, 0.5);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = vFade > 0.0 ? 0.014 * uScale * projectionMatrix[1][1] / -mv.z : 0.0;
  gl_Position = projectionMatrix * mv;
}`;

// Mixed reality: motes drifting round the table (the board-local origin), rising slowly, as in the
// Tea House's lantern light, and nothing more over the player's room (full VR has the room's dust).
export function tableMotes(n, uniforms) {
  const geo = new BufferGeometry();
  attrs(geo, n, [
    ['position', 3, () => [0, 0, 0]],
    ['aPhase', 1, (i) => hash(i, 11)],
    ['aKeep', 1, (i) => (i % 2 === 0 ? 1 : 0)],
    ['aSeed', 3, (i) => [hash(i, 12), hash(i, 13), hash(i, 14)]],
  ]);
  const mat = new ShaderMaterial({ uniforms, vertexShader: moteVertex, fragmentShader: pointFragment, transparent: true, depthWrite: false, ...ADD });
  const cloud = new Points(geo, ready(mat));
  cloud.frustumCulled = false;
  cloud.userData.particles = n;
  return cloud;
}
