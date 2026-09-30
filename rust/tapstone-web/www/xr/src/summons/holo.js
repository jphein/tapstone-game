// holo.js: the creatures' holographic material (0039: cards are "3D and holographic"). One
// MeshBasicMaterial patched in onBeforeCompile, so three's skinning chunks stay; its light is baked
// into the shader (look.js: warm in the lantern-lit Tea House, neutral in mixed reality), so no
// scene light changes it and no shadow is cast. Every creature shares one program
// (customProgramCacheKey); each has its own uniforms:
//   uTint   the faction's colour, mixed into the baked part colours and lighting the fresnel rim
//   uForm   0 → 1: the creature forms from its feet up, a bright band at the edge (the summon)
//   uFade   0 → 1: a noise dissolve (the death)
//   uBase, uH  the world height of its feet and its world height, for uForm
//   uAlpha  the whole hologram's opacity (reduced motion fades instead of forming)
// uTime is one shared uniform object, ticked once per frame (tick()).
import { AddEquation, Color, CustomBlending, DoubleSide, MeshBasicMaterial, OneFactor, SrcAlphaFactor, ZeroFactor } from '@iwsdk/core';
import { LIGHT } from './look.js';

const time = { value: 0 };
export const tick = (seconds) => (time.value = seconds % 1000);

// The look every creature shares (look.js lookFor): one set of uniform objects, so a room change or
// the contrast theme is one write, not one per creature.
const look = {
  uKey: { value: new Color(0xf4f1ea) }, uKeyMix: { value: 0.55 }, uTintMix: { value: 0.18 },
  uScan: { value: 0.07 }, uFlicker: { value: 0.03 }, uBodyAlpha: { value: 0.93 },
  uRim: { value: new Color(0xffffff) }, uRimWhite: { value: 0 },
};
export function setLook(l) {
  look.uKey.value.setHex(l.key);
  look.uKeyMix.value = l.keyMix;
  look.uTintMix.value = l.tintMix;
  look.uScan.value = l.scan;
  look.uFlicker.value = l.flicker;
  look.uBodyAlpha.value = l.alpha;
  look.uRimWhite.value = l.rim === null ? 0 : 1;
  if (l.rim !== null) look.uRim.value.setHex(l.rim);
}

const VERT_HEAD = /* glsl */ `
varying vec3 vHoloWorld;
varying vec3 vHoloNormal;
varying vec3 vHoloWorldNormal;
varying vec3 vHoloView;
`;
const VERT_BODY = /* glsl */ `
#ifdef USE_SKINNING
  vHoloNormal = normalize(transformedNormal);
  vHoloWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
#else
  vHoloNormal = normalize(normalMatrix * normal);
  vHoloWorldNormal = normalize(mat3(modelMatrix) * normal);
#endif
  vHoloWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vHoloView = -mvPosition.xyz;
`;
const FRAG_HEAD = /* glsl */ `
uniform vec3 uTint;
uniform float uForm;
uniform float uFade;
uniform float uBase;
uniform float uH;
uniform float uAlpha;
uniform float uTime;
uniform vec3 uKey;
uniform float uKeyMix;
uniform float uTintMix;
uniform float uScan;
uniform float uFlicker;
uniform float uBodyAlpha;
uniform vec3 uRim;
uniform float uRimWhite;
varying vec3 vHoloWorld;
varying vec3 vHoloNormal;
varying vec3 vHoloWorldNormal;
varying vec3 vHoloView;
float holoHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
`;
// The body: the model's own part colours, shaped by a baked key light from above and ahead (a
// hemisphere term plus a soft wrap, never a real light: nothing in either room lights it, and no
// shadow is cast), a touch of the faction's colour, and the faction's (or white) fresnel rim.
const FRAG_BODY = /* glsl */ `
  {
    float h = (vHoloWorld.y - uBase) / max(uH, 1e-4);
    float edge = uForm * 1.3 - 0.15;
    if (uForm < 0.999 && h > edge) discard; // formed: no mask (uBase/uH are stale then)
    float n = holoHash(floor(vHoloWorld * 420.0));
    if (n < uFade) discard;
    vec3 N = normalize(vHoloNormal);
    vec3 V = normalize(vHoloView);
    vec3 W = normalize(vHoloWorldNormal);
    float fres = pow(1.0 - abs(dot(N, V)), 3.2); // a rim at the silhouette, not a wash over the body
    vec3 L = normalize(vec3(0.35, 1.0, 0.55));
    float hemi = 0.5 + 0.5 * W.y;
    float wrap = clamp((dot(W, L) + 0.35) / 1.35, 0.0, 1.0);
    // Capped near 1: shaping without washing the colour out.
    vec3 light = mix(vec3(1.0), uKey * (0.32 + 0.38 * hemi + 0.42 * wrap), uKeyMix);
    vec3 body = mix(gl_FragColor.rgb, uTint, uTintMix) * light;
    float scan = 1.0 - uScan + uScan * sin(vHoloWorld.y * 1250.0 - uTime * 5.0);
    float flicker = 1.0 - uFlicker + uFlicker * sin(uTime * 37.0 + vHoloWorld.x * 60.0);
    vec3 rim = mix(uTint * 1.25, uRim, uRimWhite);
    vec3 col = body * scan + rim * fres * 0.9;
#ifdef HOLO_VEINS
    // The veins: ember light running along the bones, pulsing as it travels.
    float pulse = 0.65 + 0.35 * sin(uTime * 3.2 - vHoloWorld.y * 90.0 - vHoloWorld.z * 60.0);
    col += (uTint * 1.3 + vec3(0.35, 0.18, 0.05)) * vHoloVein * pulse * (1.0 - 0.6 * uRimWhite);
#endif
    float band = smoothstep(edge - 0.12, edge, h) * step(uForm, 0.999);
    col += (uTint * 1.6 + 0.5) * band;
    float ember = smoothstep(uFade + 0.12, uFade, n) * step(0.001, uFade);
    col += (uTint * 2.0 + 0.3) * ember;
    gl_FragColor = vec4(col, mix(uBodyAlpha, 1.0, fres) * flicker * uAlpha);
  }
`;

// `veins`: the geometry carries a `vein` attribute (0..1) that glows in the faction's light, pulsing
// slowly along the body (wyrm.js: the wing bones, the spine's ridge, the eyes).
export function holoMaterial(faction, { vertexColors = true, veins = false } = {}) {
  const m = new MeshBasicMaterial({ vertexColors, transparent: true, depthWrite: true });
  m.userData.holo = {
    uTint: { value: new Color(faction) },
    uForm: { value: 1 },
    uFade: { value: 0 },
    uBase: { value: 0 },
    uH: { value: 0.08 },
    uAlpha: { value: 1 },
  };
  // The tint as a material colour, so theme.js can theme it (themed(m, 'faction.ember', 'holoTint')).
  m.holoTint = m.userData.holo.uTint.value;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, m.userData.holo, look, { uTime: time });
    const vh = veins ? 'attribute float vein;\nvarying float vHoloVein;\n' : '';
    const vb = veins ? '\n  vHoloVein = vein;' : '';
    shader.vertexShader = VERT_HEAD + vh + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}${vb}`);
    // MeshBasic computes transformedNormal only with an envmap or skinning: a wisp needs its own.
    const fh = veins ? '#define HOLO_VEINS\nvarying float vHoloVein;\n' : '';
    shader.fragmentShader = fh + FRAG_HEAD + shader.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${FRAG_BODY}`);
  };
  m.customProgramCacheKey = () => `tapstone-holo2-${vertexColors}-${veins}`;
  return m;
}

// The card's hologram as it lifts and dissolves: its face as a texture, burning away from the edges
// in the faction's light (uDissolve 0 → 1).
export function ghostMaterial(map) {
  const m = new MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: DoubleSide });
  m.userData.ghost = { uTint: { value: new Color(0xffffff) }, uDissolve: { value: 0 } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, m.userData.ghost, { uTime: time });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vGhostUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvGhostUv = uv;');
    shader.fragmentShader = `uniform vec3 uTint;\nuniform float uDissolve;\nuniform float uTime;\nvarying vec2 vGhostUv;\nfloat ghostHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\n` +
      shader.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
  {
    vec2 c = vGhostUv - 0.5;
    float r = max(abs(c.x) * 1.6, abs(c.y));            // 0 at the centre, 0.5 at the edge
    float n = ghostHash(floor(vGhostUv * vec2(36.0, 58.0)));
    float k = (0.5 - r) * 1.6 + n * 0.35;                // the edges burn first
    float edge = uDissolve * 1.15;
    if (k < edge) discard;
    float glow = smoothstep(edge + 0.12, edge, k) * step(0.001, uDissolve);
    float scan = 0.9 + 0.1 * sin(vGhostUv.y * 220.0 - uTime * 8.0);
    gl_FragColor.rgb = gl_FragColor.rgb * scan + uTint * (0.25 + glow * 2.2);
    gl_FragColor.a *= 0.92;
  }`);
  };
  m.customProgramCacheKey = () => 'tapstone-ghost';
  return m;
}

// Light that adds to what is behind it, safe in mixed reality: the colour adds, but the framebuffer's
// alpha is left alone. three's AdditiveBlending adds to alpha too, and in passthrough the alpha is
// what hides the room, so a dim spark became an opaque dark blob over it (caught in IWER, 2026-09-29).
const FACTOR = { srcAlpha: SrcAlphaFactor, one: OneFactor, zero: ZeroFactor };
export const LIGHT_BLEND = {
  blending: CustomBlending, blendEquation: AddEquation,
  blendSrc: FACTOR[LIGHT.rgb.src], blendDst: FACTOR[LIGHT.rgb.dst], blendSrcAlpha: FACTOR[LIGHT.alpha.src], blendDstAlpha: FACTOR[LIGHT.alpha.dst],
};

// Additive glow for the spell effects and the flight's light (no depth write: it never hides a unit).
export function glowMaterial(color, opacity = 1) {
  return new MeshBasicMaterial({ color, transparent: true, opacity, ...LIGHT_BLEND, depthWrite: false, side: DoubleSide });
}
