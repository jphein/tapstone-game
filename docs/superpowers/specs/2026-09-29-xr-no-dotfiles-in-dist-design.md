# No dotfiles in the built page (design note)

Date: 2026-09-29 · Lane: Selene · Branch `fix/xr-kws-no-dotfiles-in-dist` · From the lead's freeze
rehearsal from the public repo (tapstone-game 586d232).

## The bug

`tools/pages_deploy.py --target github` refuses the frozen bundle: "private content in a public
deploy: ['competition/v1/kws/.gitignore', 'competition/v1/kws/.install']". Its guard (#183) refuses
every dotfile except `.nojekyll`. Vite copies all of `public/`, dotfiles included, and since #209
`public/kws` holds `.gitignore` (the list of fetched binaries) and `.install` (the install stamp: the
pins JSON). The decision: the guard stays as it is. Build metadata must not ship.

## Goals

1. Keep `.install` and `.gitignore` in `public/kws`, since the tooling needs them. Keep them, and any
   dotfile under `public/`, out of vite's output.
2. Nothing the page reads at runtime is a dotfile. Checked: `voice-input.js` fetches a fixed list of
   ten names, none of them a dotfile, and `kws-worker.js` gets its bytes from the page.
3. A test that a built `dist/` holds no dotfile except those explicitly allowed (none today), and a
   red perturbation.
4. A rehearsal:
   - run `freeze_contest.py HEAD --allow-untagged --base /tapstone-game/competition/v1/` from this branch;
   - then `pages_deploy.py --target github --bundle <it> --out <new dir>`, which must stage;
   - report the file count and the bundle sha.

## Approach

`tools/vite-no-dotfiles.mjs`, a small vite plugin, used in `vite.config.js`:
- It runs in `closeBundle`, after vite has copied `public/`.
- It removes every file or directory in the output whose name starts with a dot and isn't in
  `ALLOWED_DOTFILES` (empty today). It logs what it removed.
- It then walks the output again and **throws** if any dotfile is left, so a removal that silently
  failed can't pass.

The same list and walk are exported for the test.

Why remove after the copy, not filter the copy: vite has no filter for `publicDir`. Moving the files out
of `public/` would break the tooling's layout; `installAtomic` and `check()` expect them there.

## Tests

- `test/no-dotfiles.test.js` runs **real vite** (`build()`) on a tiny project: a `public/` with
  `.gitignore`, `.install`, a dotted directory and ordinary files, using the plugin as
  `vite.config.js` does. The output must hold the ordinary files and no dotfile.
- It also checks the plugin is wired into `vite.config.js`.
- If a real `dist/` exists, it gets the same check.
- Perturbation: without the plugin, the tiny build ships the dotfiles (the test turns red).

## Budget

No change to the shipped page, apart from two small files no longer shipped.

## Files

`tools/vite-no-dotfiles.mjs` (new), `vite.config.js` (one plugin), `test/no-dotfiles.test.js` (new).
