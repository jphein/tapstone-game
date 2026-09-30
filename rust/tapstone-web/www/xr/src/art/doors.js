// doors.js: the Tea House's doors (0039: "doors appear to different planes") as torii on a stepped
// stone threshold, the design note's Shinto/Mayan PROPOSAL, each a window into its plane. The frame
// is merged, colour and light baked (one draw call); the portal is one shader that ray-casts through
// the doorway into a painted world with parallax, so it reads as a place behind the door, not a
// picture on it:
//   - the Deep Tides (bible: a water world, floating islands and coral kingdoms): sea light, shafts
//     from the surface, coral and islands, kelp, rising bubbles;
//   - the Forge Peaks (bible: volcanic mountains and crystalline caves): a smoke-red sky, volcanoes,
//     a basalt ridge with glowing cracks, a lava river, embers and crystal glints;
//   - the Hearthlands (bible: gentle forests and mild weather): dusk, a low sun, hills, a treeline,
//     fireflies;
//   - the Dueling Grounds, behind the red door (0039: the duel is fought there): a starlit plain ruled
//     in gilt, the pocket dimension the board comes from.
// Each view is a PROPOSAL; the planes and their bible lines are canon (logic/lore.js).
import { BoxGeometry, CylinderGeometry, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, Vector3, Color } from '@iwsdk/core';
import { merge, bake, shade } from './geo.js';
import { slab } from './stone.js';
import { ART, PLACE_PALETTE, factionOf } from './palette.js';
import { canvasTexture } from './plates.js';
import { onArtTheme, ready } from './contrast.js';

export const FRAME_H = 1.9;
export const PORTAL = { w: 0.6, y0: 0.085, y1: 1.54 };
export const KIND = { tide: 0, ember: 1, neutral: 2, grounds: 3 };

// The frame: pillars, kasagi (the upturned top lintel) and its black cap, shimaki, nuki (the tie
// beam), the plaque's lacquer board, black pillar feet, and the two-step stone threshold.
export function frameGeometry(wood) {
  const cap = 0x16100e, stone = PLACE_PALETTE.teahouse.stone, px = 0.34, top = FRAME_H;
  const w = wood, parts = [
    { geo: slab(0.98, 0.34, 0, 0.042, { r: 0.01, bevel: 0.006, segments: 1 }), color: shade(stone, 0.85) },
    { geo: slab(0.84, 0.25, 0.042, 0.084, { r: 0.008, bevel: 0.006, segments: 1 }), color: stone },
    ...[-px, px].flatMap((x) => [
      { geo: new CylinderGeometry(0.04, 0.047, top - 0.2, 12), at: [x, 0.084 + (top - 0.2) / 2, 0], color: w },
      { geo: new BoxGeometry(0.11, 0.07, 0.11), at: [x, 0.084 + 0.035, 0], color: cap },
    ]),
    { geo: new BoxGeometry(0.66, 0.065, 0.11), at: [0, top - 0.05, 0], color: w }, // kasagi, centre
    { geo: new BoxGeometry(0.13, 0.06, 0.11), at: [-0.385, top - 0.035, 0], rot: [0, 0, -0.18], color: w },
    { geo: new BoxGeometry(0.13, 0.06, 0.11), at: [0.385, top - 0.035, 0], rot: [0, 0, 0.18], color: w },
    { geo: new BoxGeometry(0.66, 0.022, 0.125), at: [0, top - 0.006, 0], color: cap },
    { geo: new BoxGeometry(0.13, 0.022, 0.125), at: [-0.385, top + 0.012, 0], rot: [0, 0, -0.18], color: cap },
    { geo: new BoxGeometry(0.13, 0.022, 0.125), at: [0.385, top + 0.012, 0], rot: [0, 0, 0.18], color: cap },
    { geo: new BoxGeometry(0.8, 0.04, 0.09), at: [0, top - 0.105, 0], color: shade(w, 0.85) }, // shimaki
    { geo: new BoxGeometry(0.86, 0.05, 0.06), at: [0, PORTAL.y1 + 0.03, 0], color: w }, // nuki
    { geo: new BoxGeometry(0.62, 0.13, 0.02), at: [0, 1.67, -0.012], color: cap }, // the plaque's board
    { geo: new BoxGeometry(0.64, 0.008, 0.024), at: [0, 1.67 + 0.069, -0.012], color: 0xc9a55a },
    { geo: new BoxGeometry(0.64, 0.008, 0.024), at: [0, 1.67 - 0.069, -0.012], color: 0xc9a55a },
  ];
  const g = merge(parts);
  // Baked light: a soft key from above and in front, a warm bounce; the threshold's top catches it.
  return bake(g, {
    ambient: 0x5a5048,
    lights: [
      { at: [0.6, 3.2, 2.2], color: 0xfff0dc, intensity: 1.9, falloff: 4 },
      { at: [0, 0.6, 1.4], color: 0xffc080, intensity: 0.35, falloff: 1.5 },
    ],
  });
}

const vertex = /* glsl */ `
varying vec3 vP;
void main() {
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragment = /* glsl */ `
uniform float uKind;
uniform float uTime;
uniform float uGlow;
uniform vec3 uCam;
uniform vec3 uRim;
uniform float uHc;     // high contrast: a black doorway with a broad rim in its door colour
uniform vec3 uHcRim;
varying vec3 vP;
float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 layer(vec3 d, float D) { return vP.xy + d.xy * (D / max(-d.z, 0.08)); }
// Points drifting in a grid of cells (bubbles, embers, fireflies): a soft dot, rising at rise m/s.
float motes(vec2 q, float scale, float rise, float size) {
  vec2 p = vec2(q.x * scale, q.y * scale - uTime * rise * scale);
  vec2 c = floor(p), f = fract(p) - 0.5;
  float r = h2(c);
  vec2 o = vec2(h2(c + 3.1) - 0.5, h2(c + 7.7) - 0.5) * 0.6;
  float on = step(0.55, r);
  return on * smoothstep(size, 0.0, length(f - o));
}
vec3 tides(vec3 d) {
  vec3 abyss = vec3(0.02, 0.08, 0.18), sea = vec3(0.06, 0.36, 0.58), foam = vec3(0.62, 0.9, 1.0);
  vec3 col = mix(abyss, sea, smoothstep(-0.5, 0.7, d.y));
  vec2 q9 = layer(d, 9.0);
  float shafts = pow(0.5 + 0.5 * sin(q9.x * 2.2 + sin(q9.x * 0.7 + uTime * 0.15) * 2.0), 6.0) * smoothstep(0.0, 1.2, d.y + 0.3);
  col += foam * shafts * 0.22;
  vec2 q7 = layer(d, 7.0);
  float isl = length((q7 - vec2(-1.2, 3.2)) * vec2(0.8, 2.6)) - 0.9;
  float isl2 = length((q7 - vec2(2.4, 4.0)) * vec2(0.9, 3.0)) - 0.7;
  col = mix(col, vec3(0.08, 0.2, 0.3), smoothstep(0.04, 0.0, min(isl, isl2)) * 0.7);
  vec2 q4 = layer(d, 4.0);
  float coral = 0.35 + 0.18 * sin(q4.x * 1.4) + 0.08 * sin(q4.x * 4.1 + 1.0) + 0.05 * sin(q4.x * 9.0);
  vec3 reef = vec3(0.05, 0.16, 0.24) + vec3(0.22, 0.07, 0.1) * (0.5 + 0.5 * sin(q4.x * 2.3 + q4.y * 3.0));
  col = mix(col, reef, smoothstep(0.02, 0.0, q4.y - coral) * 0.85);
  vec2 q1 = layer(d, 1.3);
  float sway = sin(q1.y * 2.6 + uTime * 0.9 + floor(q1.x * 2.2) * 1.7) * 0.06;
  float kelp = smoothstep(0.035, 0.0, abs(fract(q1.x * 2.2 + sway) - 0.5) - 0.02) * step(q1.y, 0.9 + 0.3 * h1(floor(q1.x * 2.2)));
  col = mix(col, vec3(0.03, 0.22, 0.2), kelp * 0.9);
  col += foam * motes(layer(d, 0.8), 7.0, 0.25, 0.13) * 0.8;
  float caust = pow(abs(sin(q4.x * 6.0 + uTime * 0.7) * sin(q4.y * 5.0 - uTime * 0.5)), 3.0);
  col += foam * caust * 0.05;
  return col;
}
vec3 forge(vec3 d) {
  vec3 smoke = vec3(0.12, 0.06, 0.06), glow = vec3(1.0, 0.45, 0.16), magma = vec3(1.0, 0.72, 0.3);
  vec3 col = mix(glow * 0.9, smoke, smoothstep(-0.05, 0.55, d.y));
  vec2 q10 = layer(d, 10.0);
  float peak = 0.9 + 0.7 * abs(sin(q10.x * 0.33)) + 0.25 * sin(q10.x * 1.9);
  float crater = smoothstep(0.25, 0.0, abs(fract(q10.x * 0.105) - 0.5)) * smoothstep(-0.3, 0.0, q10.y - peak);
  col = mix(col, vec3(0.1, 0.05, 0.06), smoothstep(0.03, 0.0, q10.y - peak));
  col += magma * crater * 0.6 * step(q10.y, peak + 0.05);
  vec2 q3 = layer(d, 3.0);
  float ridge = 0.42 + 0.2 * sin(q3.x * 1.1 + 2.0) + 0.06 * sin(q3.x * 5.0);
  float inRidge = smoothstep(0.02, 0.0, q3.y - ridge);
  float crack = smoothstep(0.03, 0.0, abs(sin(q3.x * 7.0 + sin(q3.y * 9.0) * 1.3) * 0.5 - 0.25 + q3.y * 0.1) - 0.01);
  vec3 basalt = vec3(0.07, 0.05, 0.05) + glow * crack * (0.7 + 0.3 * sin(uTime * 1.3 + q3.x * 3.0));
  vec2 gc = floor(q3 * 14.0);
  float glint = step(0.985, h2(gc)) * smoothstep(0.35, 0.0, length(fract(q3 * 14.0) - 0.5)) * (0.5 + 0.5 * sin(uTime * 3.0 + h2(gc) * 30.0));
  basalt += vec3(0.5, 0.9, 1.0) * glint;
  col = mix(col, basalt, inRidge);
  vec2 q2 = layer(d, 2.0);
  float lava = smoothstep(0.16, 0.1, q2.y) * (0.75 + 0.25 * sin(q2.x * 5.0 - uTime * 1.2 + sin(q2.x * 13.0)));
  col = mix(col, magma, lava);
  col += magma * motes(layer(d, 0.7), 8.0, 0.35, 0.1) * 1.2;
  return col;
}
vec3 hearth(vec3 d) {
  vec3 peach = vec3(0.98, 0.66, 0.42), lav = vec3(0.4, 0.34, 0.62);
  vec3 col = mix(peach, lav, smoothstep(0.02, 0.75, d.y));
  vec2 sun = vec2(0.25, 0.1);
  float s = length(d.xy - sun);
  col += vec3(1.0, 0.85, 0.55) * (smoothstep(0.06, 0.04, s) + 0.35 * smoothstep(0.5, 0.0, s));
  vec2 q9 = layer(d, 9.0);
  float far = 0.55 + 0.25 * sin(q9.x * 0.4) + 0.1 * sin(q9.x * 1.3);
  col = mix(col, vec3(0.36, 0.42, 0.52), smoothstep(0.03, 0.0, q9.y - far));
  vec2 q3 = layer(d, 3.2);
  float near = 0.28 + 0.12 * sin(q3.x * 0.9 + 1.0);
  col = mix(col, vec3(0.26, 0.36, 0.2), smoothstep(0.02, 0.0, q3.y - near));
  vec2 q2 = layer(d, 2.0);
  float t = fract(q2.x * 2.6), hgt = 0.34 + 0.22 * h1(floor(q2.x * 2.6));
  float tree = step(q2.y, 0.12 + hgt * (1.0 - abs(t - 0.5) * 2.0));
  col = mix(col, vec3(0.1, 0.16, 0.1), tree * 0.95);
  float ff = motes(layer(d, 0.9), 6.0, 0.05, 0.1) * (0.5 + 0.5 * sin(uTime * 2.0 + vP.x * 20.0));
  col += vec3(1.0, 0.9, 0.4) * ff;
  return col;
}
vec3 grounds(vec3 d) {
  vec3 col = mix(vec3(0.16, 0.12, 0.3), vec3(0.03, 0.03, 0.08), smoothstep(-0.05, 0.6, d.y));
  vec2 sp = d.xy / max(-d.z, 0.3) * 40.0, sd = floor(sp);
  float star = step(0.975, h2(sd)) * smoothstep(0.18, 0.0, length(fract(sp) - 0.5));
  col += vec3(0.9, 0.88, 1.0) * star * smoothstep(0.0, 0.2, d.y);
  if (d.y < -0.01) {
    float t = -(uCam.y + 0.35) / d.y;
    vec2 g = uCam.xz + vec2(d.x, d.z) * t;
    vec2 f = abs(fract(g * 0.8 + 0.5) - 0.5); // no line straight down the view: it aliases to dashes
    float line = smoothstep(0.03, 0.0, min(f.x, f.y) - 0.005);
    float fade = exp(-t * 0.35) * smoothstep(-0.02, -0.12, d.y);
    col = mix(col, vec3(0.08, 0.08, 0.16), 0.8 * fade);
    col += vec3(0.95, 0.75, 0.35) * line * fade;
  }
  col += vec3(0.55, 0.35, 0.8) * exp(-abs(d.y) * 12.0) * 0.4;
  return col;
}
void main() {
  vec3 d = normalize(vP - uCam);
  d.z = -abs(d.z);
  // The Forge Peaks' heat shimmer: the view wavers, most near the door's foot (PROPOSAL).
  if (uKind > 0.5 && uKind < 1.5) {
    float lo = 1.0 - clamp((vP.y - ${PORTAL.y0.toFixed(3)}) / ${(PORTAL.y1 - PORTAL.y0).toFixed(3)}, 0.0, 1.0);
    d.x += sin(vP.y * 38.0 - uTime * 5.0 + sin(vP.x * 20.0)) * 0.006 * (0.3 + lo);
  }
  vec3 col = uKind < 0.5 ? tides(d) : uKind < 1.5 ? forge(d) : uKind < 2.5 ? hearth(d) : grounds(d);
  float ex = abs(vP.x) / (${PORTAL.w / 2});
  float ey = (vP.y - ${PORTAL.y0.toFixed(3)}) / ${(PORTAL.y1 - PORTAL.y0).toFixed(3)};
  float rim = max(smoothstep(0.7, 1.0, ex), smoothstep(0.85, 1.0, ey));
  float mist = smoothstep(0.25, 0.0, ey) * (0.5 + 0.5 * sin(vP.x * 9.0 + uTime * 0.8));
  col = col * (1.0 + 0.55 * uGlow) + uRim * (rim * (0.35 + 0.8 * uGlow) + mist * 0.18);
  float a = (1.0 - smoothstep(0.95, 1.0, ex)) * (1.0 - smoothstep(0.97, 1.0, ey)) * smoothstep(0.0, 0.03, ey);
  if (uHc > 0.5) {
    float band = max(step(0.82, ex), step(0.9, ey));
    col = mix(vec3(0.0), pow(uHcRim, vec3(1.0 / 2.2)), band);
    a = 1.0;
  }
  gl_FragColor = vec4(pow(max(col, 0.0), vec3(2.2)), a); // painted in sRGB terms; the output converts back
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// `role` is the door's theme role (door.ember, door.tide, door.neutral; door.frame for the red door).
export function portalMaterial(kind, rim, role) {
  const m = new ShaderMaterial({
    uniforms: { uKind: { value: kind }, uTime: { value: 0 }, uGlow: { value: 0 }, uCam: { value: new Vector3(0, 1.2, 2) }, uRim: { value: new Color(rim) }, uHc: { value: 0 }, uHcRim: { value: new Color(0xffffff) } },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    side: DoubleSide,
  });
  onArtTheme((on, T) => {
    m.uniforms.uHc.value = on ? 1 : 0;
    m.uniforms.uHcRim.value.setHex(T[role] ?? 0xffffff);
  });
  return ready(m);
}

export function portalMesh(kind, rim, role) {
  const g = new PlaneGeometry(PORTAL.w, PORTAL.y1 - PORTAL.y0, 1, 1);
  g.translate(0, (PORTAL.y0 + PORTAL.y1) / 2, 0);
  return new Mesh(g, portalMaterial(kind, rim, role));
}

// A door's colours: its frame wood (lore.js) and the rim light of its plane.
export function doorLook(faction, frame) {
  if (faction === 'grounds') return { wood: ART.doorFrame, rim: 0xb89cff, kind: KIND.grounds, role: 'door.frame' };
  const f = KIND[faction] === undefined ? 'neutral' : faction;
  return { wood: frame, rim: factionOf(f).light, kind: KIND[f], role: `door.${f}` };
}

// The doors' contact shadows, one mesh for all: a soft ellipse under each door's foot, so it stands
// on the floor (a real floor, in mixed reality). `feet`: [{ x, z, ry }] in the room's frame.
export function shadowsMesh(feet, y) {
  const { c, tex } = canvasTexture(128, 64);
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 0.5, 0, 0); // a circle in a 2:1 canvas, stretched back by the 2:1 plane
  const r = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  r.addColorStop(0, 'rgba(0,0,0,0.55)');
  r.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  tex.needsUpdate = true;
  const geo = merge(feet.map((f) => {
    const m = new PlaneGeometry(1.35, 0.7);
    m.rotateX(-Math.PI / 2);
    m.rotateY(f.ry);
    m.translate(f.x, y, f.z);
    return { geo: m, color: 0xffffff };
  }));
  ready(tex); // a shadow is black in either theme
  return new Mesh(geo, new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xffffff }));
}
