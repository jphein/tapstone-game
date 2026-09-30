// dwell-ring.js: the head-gaze dwell ring's look, shared by assist.js (the live ring under the reticle)
// and the guide's gaze demo (guide/ghost.js), so the ring a lesson shows is the ring the person will
// see. Moved here from assist.js (#200) unchanged.
import { ShaderMaterial, Vector3 } from '@iwsdk/core';

// The dwell ring: an arc that fills clockwise from the top (one quad, one draw call).
export function ringMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { progress: { value: 0 }, color: { value: new Vector3(1, 0.83, 0) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float progress; uniform vec3 color;
      void main() {
        vec2 p = vUv - 0.5; float r = length(p);
        if (r > 0.5 || r < 0.36) discard;
        float a = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
        float on = a <= progress ? 1.0 : 0.0;
        gl_FragColor = vec4(mix(vec3(0.0), color, on), on > 0.5 ? 0.95 : 0.35);
      }`,
  });
}


export const hexVec = (hex, v) => v.set(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
