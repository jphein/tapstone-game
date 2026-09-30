// contrast.js: the world art under the high-contrast theme (logic/theme.js, the theme hook in
// src/theme.js). theme.js repaints a material's plain colour by role; the art is mostly painted
// (canvases), baked (vertex colours) or shaded, which a colour swap can't reach. So each such part
// says here how it goes high contrast:
//   flatWhenContrast(mesh, role, make)   a flat material in the role's contrast colour replaces the
//                                        painted or baked one while the theme is on (made up front,
//                                        so the switch allocates nothing);
//   onArtTheme(fn)                       fn(contrast?, THEMES.contrast) now and on every switch: a
//                                        canvas redraws its high-contrast variant, a shader flattens;
//   ready(x)                             marks a material or texture as handled here, for the audit.
// audit() is the instrument: with high contrast on, every mesh a person must find or read is either
// a plain colour from the contrast theme or marked ready; anything else is named (tools/iwer-art.mjs
// runs it in the page; test/art-contrast.test.js holds its rules). Imports no three.js, so node tests it.
import { onTheme, themeName } from '../theme.js';
import { THEMES } from '../logic/theme.js';

const swaps = [];
const painters = [];
export const isContrast = () => themeName() === 'contrast';

export function ready(x) {
  if (x) x.userData = { ...(x.userData ?? {}), contrastReady: true };
  return x;
}

export function flatWhenContrast(mesh, role, make) {
  const flat = ready(make(THEMES.contrast[role]));
  const s = { mesh, standard: mesh.material, flat };
  swaps.push(s);
  mesh.material = isContrast() ? flat : s.standard;
  return mesh;
}

export function onArtTheme(fn) {
  painters.push(fn);
  if (isContrast()) fn(true, THEMES.contrast);
}

onTheme(() => {
  const on = isContrast();
  for (const s of swaps) s.mesh.material = on ? s.flat : s.standard;
  for (const fn of painters) fn(on, THEMES.contrast);
});

// The contrast theme's colours: a plain material showing one of these is themed.
const CONTRAST = new Set(Object.values(THEMES.contrast));

// One mesh's look, as the audit reads it: { name, shader, map, mapReady, vertexColors, ready, color }.
export function lookProblem(n) {
  if (n.ready) return null;
  if (n.shader) return `${n.name}: a shader material not handled in high contrast`;
  if (n.map && !n.mapReady) return `${n.name}: a painted texture with no high-contrast variant`;
  if (n.vertexColors) return `${n.name}: baked vertex colours with no high-contrast variant`;
  if (n.map) return null;
  if (n.color != null && !CONTRAST.has(n.color)) return `${n.name}: plain colour #${n.color.toString(16).padStart(6, '0')} is not from the contrast theme`;
  return null;
}

// Reads three.js meshes into looks and returns every problem.
export function audit(meshes) {
  const out = [];
  for (const [name, m] of meshes) {
    const mat = m.material;
    if (!mat) continue;
    const p = lookProblem({
      name,
      ready: !!mat.userData?.contrastReady,
      shader: !!mat.isShaderMaterial,
      map: !!mat.map,
      mapReady: !!mat.map?.userData?.contrastReady,
      vertexColors: !!mat.vertexColors,
      color: mat.color?.getHex?.() ?? null,
    });
    if (p) out.push(p);
  }
  return out;
}

// The page's own instrument (tools/iwer-art.mjs): the audit over what a person must find or read.
if (globalThis.document) globalThis.__tapstoneArt = { audit, isContrast };
