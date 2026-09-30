// card-mesh.js: a card as the headset shows it: a rounded CR80 card with a face, a back and a gilt
// edge, in ONE mesh and one draw call, and holographic (0039: cards are "3D and holographic … the art
// moves"). The shader reads the card's own orientation:
//   - face up, both sides show the painted face (the fan shows a card's underside to the seated head,
//     as the box it replaces did: its texture was on every side); the painting's window sits behind
//     the glass, so it shifts with the view (parallax) and breathes slowly; a foil sheen sweeps the
//     frame as the card turns, and its edge catches a fresnel glint;
//   - face down (its +y turned under world up, read with the same FlipDetector thresholds as
//     hand.faceOf, so what the card shows is what a touch to a pad will mean), both sides show the
//     shared back (card-face.js), its gilt catching the same foil;
//   - the edge: gilt, or paper leaves for the deck's stack.
// Unlit on purpose (a soft top light is baked in the shader), so a face reads the same in the Tea
// House's lantern light and in the player's own room.
import { Color, ExtrudeGeometry, Mesh, Quaternion, Shape, ShaderMaterial, Vector3, Vector4 } from '@iwsdk/core';
import { FlipDetector } from '../logic/gestures.js';
import { CARD } from '../logic/layout.js';
import { FACE } from '../logic/card-art.js';
import { backTexture } from './card-face.js';
import { ART } from './palette.js';
import { onArtTheme, ready } from './contrast.js';

export const CARD_RADIUS = (12 / FACE.w) * CARD.w; // the painted frame's corner, in metres
export const artTime = { value: 0 }; // shared by every card material; altar.update ticks it
// 1 while aster's guide shows a demo (its ghost and ring own the moment): the playable sparkle rests,
// so a card is never highlighted twice (teahouse.js ticks it from play.ghost).
export const sparkleQuiet = { value: 0 };

export function cardGeometry(thick = 0.002, w = CARD.w, d = CARD.d) {
  const r = CARD_RADIUS, s = new Shape();
  s.moveTo(-w / 2 + r, -d / 2);
  s.lineTo(w / 2 - r, -d / 2);
  s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  s.lineTo(w / 2, d / 2 - r);
  s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  s.lineTo(-w / 2 + r, d / 2);
  s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  s.lineTo(-w / 2, -d / 2 + r);
  s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  const g = new ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 3 });
  g.rotateX(-Math.PI / 2); // the shape's +y goes to -z (the card's top edge away), the extrusion to +y
  g.translate(0, -thick / 2, 0);
  g.computeBoundingSphere();
  return g;
}

const vertex = /* glsl */ `
uniform vec2 uSize;
varying vec2 vUv;
varying float vSide;
varying float vY;
varying vec3 vViewO;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = vec2(position.x / uSize.x + 0.5, 0.5 - position.z / uSize.y);
  vSide = normal.y;
  vY = position.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 v = normalize(cameraPosition - wp.xyz);
  vV = v;
  vViewO = normalize((vec4(v, 0.0) * modelMatrix).xyz); // the view in the card's own frame
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const fragment = /* glsl */ `
uniform sampler2D uFace;
uniform sampler2D uBack;
uniform vec4 uArt;      // the painting's window in uv: u0, v0, u1, v1
uniform float uTime;
uniform float uHolo;    // 0 none .. 1 full
uniform float uStack;   // 1 for the deck's stack: paper leaves on the edge
uniform vec3 uEdge;     // the edge: gilt, the stack's paper, or its high-contrast colour
uniform float uFlat;    // high contrast: a flat edge
uniform float uQuiet;   // 1: the guide's demo is showing; the sparkle rests
uniform float uPlayable; // 0..1: the engine's menu can cast this card now (sparkle.js)
uniform float uTwinkle;  // 1: the sparkle twinkles; 0 (reduced motion): a steady rim
uniform vec3 uMark;     // high contrast: the playable frame's colour
uniform float uFaceUp;  // 1: both sides show the face; 0: both show the back (face down, or the deck)
varying vec2 vUv;
varying float vSide;
varying float vY;
varying vec3 vViewO;
varying vec3 vN;
varying vec3 vV;
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  vec3 col;
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
  float turn = vViewO.x * 0.9 - vViewO.z * 0.7;
  float band = vUv.x * 0.7 + vUv.y * 1.1 + turn * 1.6 + uTime * 0.02;
  vec3 foil = hue(fract(band));
  float glint = pow(max(0.0, 1.0 - abs(fract(band * 0.5) - 0.5) * 5.0), 4.0);
  // Either side read the right way round from its own normal: +y as (u, v), -y as (u, 1 - v).
  vec2 sv = vSide > 0.0 ? vUv : vec2(vUv.x, 1.0 - vUv.y);
  if (abs(vSide) > 0.5 && uFaceUp > 0.5) {
    vec2 a0 = uArt.xy, a1 = uArt.zw;
    float inArt = step(a0.x, sv.x) * step(sv.x, a1.x) * step(a0.y, sv.y) * step(sv.y, a1.y);
    vec2 uv = sv;
    if (inArt > 0.5) {
      // Behind the glass: zoomed in 8% around the window's centre (so the shift never shows the
      // frame), shifted against the view, breathing a little: the art moves.
      vec2 c = (a0 + a1) * 0.5, hw = (a1 - a0) * 0.5;
      vec2 local = (sv - c) / hw;
      float breathe = 0.92 + 0.012 * sin(uTime * 0.6);
      vec2 shift = vec2(vViewO.x, vSide > 0.0 ? -vViewO.z : vViewO.z) / max(abs(vViewO.y), 0.35) * 0.05;
      local = local * breathe - shift;
      local = clamp(local, vec2(-0.995), vec2(0.995));
      uv = c + local * hw;
    }
    col = texture2D(uFace, uv).rgb;
    float frameMask = 1.0 - inArt;
    // Foil on the gilt and the frame's colour; the parchment and the painting only catch the glint.
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    float gilt = smoothstep(0.2, 0.4, col.r - col.b) * smoothstep(0.25, 0.55, col.r);
    float foilMask = frameMask * (1.0 - smoothstep(0.55, 0.8, lum)) * 0.14 + 0.4 * gilt;
    col = mix(col, col * (0.7 + foil * 0.9), uHolo * foilMask);
    col += uHolo * glint * (0.05 * frameMask * (1.0 - lum) + 0.04 * inArt + 0.22 * gilt);
    col += uHolo * fres * foil * 0.07; // held low: the fan is seen near edge-on from the seat
    // Playable now: a gilt rim that breathes and stars that twinkle across the face; in high
    // contrast a thick frame in uMark instead, and no stars (legibility first).
    if (uPlayable * (1.0 - uQuiet) > 0.001) {
      float edge = min(min(sv.x, 1.0 - sv.x), min(sv.y, 1.0 - sv.y) * 0.63);
      if (uFlat > 0.5) {
        col = mix(col, uMark, uPlayable * step(edge, 0.045));
      } else {
        float pulse = uTwinkle > 0.5 ? 0.7 + 0.3 * sin(uTime * 2.4) : 0.85;
        col += vec3(1.0, 0.78, 0.35) * uPlayable * smoothstep(0.06, 0.0, edge) * 0.85 * pulse;
        vec2 g = sv * vec2(14.0, 22.0), c = floor(g), f = fract(g) - 0.5;
        float h = fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453);
        float tw = uTwinkle > 0.5 ? pow(max(0.0, sin(uTime * (1.5 + h * 2.0) + h * 40.0)), 10.0) : 0.0;
        float star = step(0.9, h) * smoothstep(0.22, 0.0, abs(f.x) + abs(f.y)) * tw;
        col += vec3(1.0, 0.92, 0.7) * star * uPlayable * 1.1;
      }
    }
  } else if (abs(vSide) > 0.5) {
    col = texture2D(uBack, sv).rgb;
    float gilt = smoothstep(0.2, 0.4, col.r - col.b) * smoothstep(0.25, 0.55, col.r);
    col = mix(col, col * (0.7 + foil * 0.9), uHolo * 0.4 * gilt);
    col += uHolo * (glint * 0.25 * gilt + fres * foil * 0.06);
  } else {
    float leaf = uStack > 0.5 ? step(0.5, fract(vY * 1800.0)) : 1.0;
    col = uFlat > 0.5 ? uEdge : uEdge * mix(0.6, 1.12, leaf * (0.6 + 0.4 * fres));
  }
  col *= 0.86 + 0.18 * clamp(vN.y, 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// A card material over `face` (a slot's CanvasTexture), or the back alone (face null).
// High contrast (contrast.js): no foil, a flat edge in card.edge (the stack's in deck).
export function cardMaterial(face, { holo = 1, stack = false } = {}) {
  const a = FACE.art;
  const m = new ShaderMaterial({
    uniforms: {
      uFace: { value: face ?? backTexture() },
      uBack: { value: backTexture() },
      uArt: { value: new Vector4(a.x / FACE.w, 1 - (a.y + a.h) / FACE.h, (a.x + a.w) / FACE.w, 1 - a.y / FACE.h) },
      uTime: artTime,
      uHolo: { value: holo },
      uStack: { value: stack ? 1 : 0 },
      uFaceUp: { value: face ? 1 : 0 },
      uSize: { value: [CARD.w, CARD.d] },
      uEdge: { value: new Color(stack ? ART.deckEdge : ART.cardEdge) },
      uPlayable: { value: 0 },
      uQuiet: sparkleQuiet,
      uTwinkle: { value: 1 },
      uMark: { value: new Color(0xffd400) },
      uFlat: { value: 0 },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
  });
  onArtTheme((on, T) => {
    m.uniforms.uHolo.value = on ? 0 : holo;
    m.uniforms.uFlat.value = on ? 1 : 0;
    m.uniforms.uEdge.value.setHex(on ? T[stack ? 'deck' : 'card.edge'] : stack ? ART.deckEdge : ART.cardEdge);
  });
  return ready(m);
}

const flat = cardGeometry();
const q = new Quaternion(), up = new Vector3();
// A card lying flat, face up (+y): `face` its texture, or null for a card showing its back both ways.
// A card with a face shows its back once it is turned face down, and its face again once turned back.
export function card3d(face, opts) {
  const mesh = new Mesh(flat, cardMaterial(face, opts));
  if (face) {
    const flip = new FlipDetector(), u = mesh.material.uniforms.uFaceUp;
    mesh.onBeforeRender = () => {
      up.set(0, 1, 0).applyQuaternion(mesh.getWorldQuaternion(q));
      u.value = flip.update(up.y) === 'up' ? 1 : 0;
    };
  }
  return mesh;
}

// The deck's stack under its top card: `h` tall, backs and paper leaves.
export function stack3d(h) {
  return new Mesh(cardGeometry(h), cardMaterial(null, { stack: true, holo: 0.5 }));
}
