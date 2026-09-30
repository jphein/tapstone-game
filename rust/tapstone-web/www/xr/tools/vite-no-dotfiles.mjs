// vite-no-dotfiles.mjs: keep build metadata out of the built page. Vite copies all of public/ into
// dist/, dotfiles included, and public/kws holds two the tooling needs (tools/fetch_kws.mjs):
// .gitignore (the fetched binaries) and .install (the install stamp, the pins JSON). The public deploy
// refuses any dotfile but .nojekyll (tools/pages_deploy.py, #183), and the decision is that build
// metadata doesn't ship: so after the build every dotfile in the output is removed, and the build
// fails if one is still there. Nothing the page reads at runtime is a dotfile (src/voice-input.js
// fetches a fixed list of names; kws-worker.js gets its bytes from the page).
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Dotfiles the page may ship. None today; one added here must be read by the page, and allowed by the
// deploy guard too.
export const ALLOWED_DOTFILES = new Set();

// Every dotfile or dot-directory under `dir` (not descending into a dotted directory), as paths
// relative to `dir`.
export function dotfilesIn(dir, allow = ALLOWED_DOTFILES) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.name.startsWith('.') && !allow.has(e.name)) out.push(relative(dir, p));
      else if (e.isDirectory()) walk(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

export function noDotfiles({ allow = ALLOWED_DOTFILES } = {}) {
  let outDir = null;
  return {
    name: 'tapstone-no-dotfiles',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    // After vite has written the bundle and copied public/.
    closeBundle() {
      const found = dotfilesIn(outDir, allow);
      for (const f of found) rmSync(join(outDir, f), { recursive: true, force: true });
      if (found.length) console.log(`[tapstone-no-dotfiles] kept out of ${relative(process.cwd(), outDir) || outDir}: ${found.join(', ')}`);
      const left = dotfilesIn(outDir, allow);
      if (left.length) throw new Error(`dotfiles left in the build output: ${left.join(', ')}`);
    },
  };
}
