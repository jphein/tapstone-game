/**
 * Tapstone in the headset (VR M1b): the in-page arena (tapstone_web.wasm) played with virtual
 * cards on a virtual altar, in the Nexus Teahouse (0039). Hands first: touch or pinch.
 */
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { PlaySystem } from './play.js';
import { EffectsSystem } from './effects-player.js';
import { TeahouseSystem } from './teahouse.js';
import { AssistSystem } from './assist.js';
import { SummonsSystem } from './summons/system.js';
import { netWatch } from './net.js';
import { accessPanel, firstRunOffer } from './access.js';
import { entryPlan, supportedModes } from './logic/entry.js';
import { entryPanel } from './entry.js';

netWatch(); // before anything else loads, so every request after "loaded" is counted
accessPanel();
firstRunOffer();

// XR entry stalled on the Quest 2 (spike-day1.md: min ~4 fps in the first frames, before any play):
// shaders compiled and models uploaded on first use. So everything is built and drawn once BEFORE the
// session starts: the systems create their pooled meshes in init(), then one compile pass runs.
function prewarm(world) {
  try {
    const compile = () => world.renderer.compile(world.scene, world.camera);
    const teahouse = world.getSystem(TeahouseSystem);
    if (teahouse) teahouse.prewarm(compile); // both rooms (teahouse.js)
    else compile();
    console.log('[tapstone] prewarm: shaders compiled before XR entry');
  } catch (e) {
    console.warn('[tapstone] prewarm skipped', e);
  }
}

// Both ways in (0039): the browser offers mixed reality when it has it (the default), else full VR;
// the entry panel offers both. iwsdk.config.json keeps 'ar' as the configured default.
const plan = entryPlan(await supportedModes(navigator.xr));
globalThis.__tapstoneEntry = plan;
const options = !projectOptions.xr ? projectOptions : {
  ...projectOptions,
  xr: plan.offer ? { ...projectOptions.xr, sessionMode: plan.offer } : { ...projectOptions.xr, offer: 'none' },
};

World.create(document.getElementById('scene-container'), options).then((world) => {
  entryPanel(world, plan);
  world.registerSystem(PlaySystem);
  world.registerSystem(EffectsSystem);
  world.registerSystem(TeahouseSystem);
  world.registerSystem(AssistSystem); // gaze, voice, the settings tiles (after PlaySystem: it drives it)
  world.registerSystem(SummonsSystem);
  requestAnimationFrame(() => prewarm(world));
});
