/**
 * Tapstone in the headset (VR M1b): the in-page arena (tapstone_web.wasm) played with virtual
 * cards on a virtual altar, in the Nexus Teahouse (0039). Hands first: touch or pinch.
 */
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { PlaySystem } from './play.js';
import { EffectsSystem } from './effects-player.js';
import { TeahouseSystem } from './teahouse.js';
import { netWatch } from './net.js';
import { accessPanel } from './access.js';

netWatch(); // before anything else loads, so every request after "loaded" is counted
accessPanel();

// XR entry stalled on the Quest 2 (spike-day1.md: min ~4 fps in the first frames, before any play):
// shaders compiled and models uploaded on first use. So everything is built and drawn once BEFORE the
// session starts: the systems create their pooled meshes in init(), then one compile pass runs.
function prewarm(world) {
  try {
    world.renderer.compile(world.scene, world.camera);
    console.log('[tapstone] prewarm: shaders compiled before XR entry');
  } catch (e) {
    console.warn('[tapstone] prewarm skipped', e);
  }
}

World.create(document.getElementById('scene-container'), projectOptions).then((world) => {
  world.registerSystem(PlaySystem);
  world.registerSystem(EffectsSystem);
  world.registerSystem(TeahouseSystem);
  requestAnimationFrame(() => prewarm(world));
});
