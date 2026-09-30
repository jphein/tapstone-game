// gpu.mjs: which GPU xr_capture's Chromium renders on, and the check that it really did.
//
// The capture launches its own Chromium (capture.mjs), because IWSDK's managed browser offers only
// `--use-angle=gl` (which headless Chromium silently drops to SwiftShader) or SwiftShader itself, and
// has no hook for other flags (@iwsdk/vite-plugin-dev resolveGpuBackend / openManagedChromium).
// The default is the Intel Arc Pro B60: the P102-100 is the inference GPU the llama-servers share
// (jp-ab, 2026-09-28). The Vulkan loader picks the device from VK_ICD_FILENAMES.
//
// The renderer string is the instrument: the flags and IWSDK's own log line can both say "GPU"
// while WebGL runs on SwiftShader, so a capture reads UNMASKED_RENDERER_WEBGL and refuses a mismatch.
import { hostname } from 'node:os';

const VULKAN = ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'];
export const GPUS = {
  default: 'b60',
  b60: { icd: '/usr/share/vulkan/icd.d/intel_icd.json', args: VULKAN, renderer: /Intel\(R\) Arc\(tm\) Pro B60/ },
  // A comparison only: the P102 is shared with inference (one short run, 2026-09-28).
  p102: { icd: '/usr/share/vulkan/icd.d/nvidia_icd.json', args: VULKAN, renderer: /NVIDIA P102-100/ },
  // katana's workstation GPU; desktop and GPU work are allowed there (jp-ab, 2026-09-28).
  rtx2080: { icd: '/usr/share/vulkan/icd.d/nvidia_icd.json', args: VULKAN, renderer: /NVIDIA GeForce RTX 2080 Ti/ },
  // What IWSDK's managed browser renders with by default on familiar.
  swiftshader: { args: ['--use-gl=angle', '--use-angle=swiftshader'], renderer: /SwiftShader/ },
};
// Each host's default: the guard is kept, and only what it expects differs per host.
export const HOST_DEFAULT = { katana: 'rtx2080' };
export const defaultGpu = (host = hostname()) => HOST_DEFAULT[host.split('.')[0]] ?? GPUS.default;

// chromium.launch() options for `gpu` over the environment `env`.
export function launchOptions(gpu, env = process.env) {
  const g = GPUS[gpu];
  if (!g || typeof g !== 'object') throw new Error(`unknown GPU "${gpu}" (b60, p102, rtx2080, swiftshader)`);
  return {
    channel: 'chromium', // full Chromium in new headless mode, as IWSDK launches it
    headless: true,
    env: { ...env, ...(g.icd ? { VK_ICD_FILENAMES: g.icd } : {}) },
    args: [...g.args, '--ignore-certificate-errors', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  };
}

// null when the WebGL renderer string is the one `gpu` promises, else why not.
export function rendererProblem(gpu, renderer) {
  if (!renderer) return `no WebGL renderer string (wanted ${gpu})`;
  if (GPUS[gpu].renderer.test(renderer)) return null;
  const on = /SwiftShader/.test(renderer) ? 'SwiftShader' : /P102/.test(renderer) ? 'the P102' : /B60/.test(renderer) ? 'the B60' : 'another device';
  return `WebGL renders on ${on}, not ${gpu}: "${renderer}"`;
}
