// xr_capture's GPU choice and its instruments (tools/xr_capture/gpu.mjs, cpu.mjs, screencast.mjs):
// the renderer check that refuses a capture on the wrong GPU, the /proc/<pid>/stat reading behind
// Chromium's CPU%, and the frame-pacing summary of the screencast's swap times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GPUS, rendererProblem, launchOptions, defaultGpu } from '../tools/xr_capture/gpu.mjs';
import { parseStat, cpuPercent } from '../tools/xr_capture/cpu.mjs';
import { pacing } from '../tools/xr_capture/screencast.mjs';

// The strings WebGL reported on familiar, 2026-09-28 (UNMASKED_RENDERER_WEBGL).
const B60 = 'ANGLE (Intel, Vulkan 1.4.354 (Intel(R) Arc(tm) Pro B60 Graphics (BMG G21) (0x0000E211)), Intel open-source Mesa driver)';
const P102 = 'ANGLE (NVIDIA, Vulkan 1.4.312 (NVIDIA NVIDIA P102-100 (0x00001B07)), NVIDIA)';
const RTX = 'ANGLE (NVIDIA, Vulkan 1.4.312 (NVIDIA NVIDIA GeForce RTX 2080 Ti (0x00001E07)), NVIDIA)';
const SWIFT = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';

test('the default GPU is the B60, and only the B60 renderer passes it', () => {
  assert.equal(GPUS.default, 'b60');
  assert.equal(rendererProblem('b60', B60), null);
  assert.match(rendererProblem('b60', SWIFT), /SwiftShader/);
  assert.match(rendererProblem('b60', P102), /P102/);
  assert.match(rendererProblem('b60', null), /no WebGL renderer/);
});

test('each comparison profile accepts its own renderer and no other', () => {
  const all = { b60: B60, p102: P102, rtx2080: RTX, swiftshader: SWIFT };
  for (const [gpu, own] of Object.entries(all)) {
    assert.equal(rendererProblem(gpu, own), null, gpu);
    for (const [other, s] of Object.entries(all)) if (other !== gpu) assert.notEqual(rendererProblem(gpu, s), null, `${gpu} accepted ${other}`);
  }
});

test('each host keeps the guard with its own GPU: katana the 2080 Ti, elsewhere the B60', () => {
  assert.equal(defaultGpu('katana'), 'rtx2080');
  assert.equal(defaultGpu('katana.jphe.in'), 'rtx2080');
  assert.equal(defaultGpu('familiar'), 'b60');
  assert.equal(defaultGpu('anything-else'), 'b60');
  assert.match(rendererProblem(defaultGpu('katana'), SWIFT), /SwiftShader/);
  assert.equal(launchOptions('rtx2080', {}).env.VK_ICD_FILENAMES, '/usr/share/vulkan/icd.d/nvidia_icd.json');
});

test('the B60 launch selects the Intel Vulkan driver and ANGLE on Vulkan', () => {
  const o = launchOptions('b60', { HOME: '/h' });
  assert.equal(o.env.VK_ICD_FILENAMES, '/usr/share/vulkan/icd.d/intel_icd.json');
  assert.equal(o.env.HOME, '/h');
  for (const a of ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu']) assert.ok(o.args.includes(a), a);
  assert.ok(launchOptions('swiftshader', {}).args.includes('--use-angle=swiftshader'));
  assert.throws(() => launchOptions('rtx', {}), /unknown GPU/);
});

test('a stat line parses around a command name with spaces and parentheses', () => {
  const line = '4242 (chrome (gpu) x) S 4200 4242 4200 0 -1 4194560 100 0 0 0 1500 250 3 4 20 0 12 0 99 0 0';
  assert.deepEqual(parseStat(line), { pid: 4242, ppid: 4200, ticks: 1750 });
  assert.equal(cpuPercent({ ticks: 1000 }, { ticks: 1600 }, 3, 100), 200); // 600 ticks over 3 s at 100 Hz: two cores
});

test('pacing reports the frame intervals in the window, in ms', () => {
  const frames = [0, 0.033, 0.066, 0.1, 0.2, 0.233].map((ts) => ({ ts: 100 + ts }));
  const p = pacing(frames, 100, 0.25);
  assert.equal(p.frames, 6);
  assert.equal(p.max, 100);
  assert.ok(Math.abs(p.p50 - 33.3) < 1, `p50 ${p.p50}`);
  assert.ok(p.p95 >= 33 && p.p95 <= 100);
  assert.deepEqual(p.stalls, []); // 100 ms is the threshold, and a stall must exceed it
  const q = pacing([...frames, { ts: 100.6 }], 100, 1);
  assert.deepEqual(q.stalls, [{ t: 0.233, ms: 367 }]); // where the picture froze, and for how long
  assert.equal(pacing(frames, 100.15, 0.08).frames, 1); // one frame: no interval to report
});
