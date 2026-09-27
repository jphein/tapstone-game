# Runbook — freezing the VR competition build

Part of tapstone#129 (item 8). The VR spec's delivery (`docs/superpowers/specs/2026-09-25-tapstone-vr-design.md`,
"Delivery" and week 7): a static site built from tag `vr-competition-v1`, served at the immutable path
`https://tapstone.realm.watch/competition/v1/` with realm-sigil and a status.realm.watch check, and
**never redeployed after Nov 18**. Freeze by Nov 13, which leaves five days of slack.

`tools/freeze_contest.py` builds the bundle and verifies it. It never deploys anything.

> **Deploying is JP's step.** Sections 1–3 build and check files on a build host and touch nothing
> outside `--out`. Sections 4–6 (the tag push, the copy to ubox0, the status check) are JP's, by hand.
> No agent runs them.

## What the tool does

From a **fresh clone of the repo at the ref** (never the working tree):

1. refuses a dirty tree (modified or untracked files), a ref that is not a tag (unless
   `--allow-untagged`), and an `--out` that already exists;
2. builds `tapstone_web.wasm` (`--profile wasm`, `--locked`, a fresh target dir) and runs
   `rust/tapstone-web/gate.mjs` against it, so the bundle only ever holds a gated wasm;
3. `npm ci`, then `vite build --base /competition/v1/` with `NODE_ENV=production` (no sourcemaps);
4. copies `dist/` to `<out>/<tag>/`, checks every root-relative `src`/`href` in `index.html` sits under
   the base, and checks the bundle's wasm is the gated one;
5. stamps it through realm-sigil's own `static/build.sh`: `version.json` beside `index.html` and the
   `<meta name="realm-version">` tag in it, with the build time taken from the commit;
6. writes `BUILDINFO.json` (ref, commit, commit time, toolchain versions, the wasm's sha256, the gate's
   lines, the sha256 of the realm-sigil inputs and of the tool itself);
7. refuses if any file contains a build-machine path (`$HOME`, the repo, the work dir, the cargo home or
   the rustc sysroot);
8. writes `MANIFEST.sha256` over every file (the `sha256sum` format, so coreutils can check it with no
   Python), packs `<tag>.tar.gz` and its `.sha256`, then **unpacks the tarball and verifies it**.

Output, with `--out ~/freeze`:

```
~/freeze/vr-competition-v1/            the site root to serve at /competition/v1/
~/freeze/vr-competition-v1.tar.gz      the same files under vr-competition-v1/
~/freeze/vr-competition-v1.tar.gz.sha256
```

## Reproducibility — what is and is not byte-identical

Two freezes of one commit on one machine give **the same manifest and the same tarball** (the
`Reproducible` test builds twice and compares). What made that true, and what it still depends on:

- **realm-sigil's build time.** `build.sh` stamps `date -u`. The tool puts a `date` shim on its PATH that
  answers with the commit time (`SOURCE_DATE_EPOCH`), and checks the stamp afterwards. It also pins
  `core.abbrev=7`, because `git rev-parse --short` grows with the repo's object count, so a
  bigger clone could stamp an 8-character hash.
- **Absolute paths in the wasm.** Panic locations embed paths: 21 of them on familiar, all under `$HOME`
  (the rustup sysroot's `rust-src` and `~/.cargo/registry`). Workspace paths are already relative: two
  checkouts at different paths gave the same wasm before any remap. The tool remaps
  `<sysroot>/lib/rustlib/src/rust` to `/rustc/<rustc commit-hash>`, which is what a machine *without*
  `rust-src` embeds, and the cargo home to `/cargo`, so neither `$HOME` nor the `rust-src` component
  changes the bytes. The leak check enforces it.
- **The gate prints a wall-clock timing** (`79 lines, 12.9 ms`). `BUILDINFO.json` drops it. This was the
  only difference between the first two full builds.
- **Vite** gave identical output from two checkouts at different paths, with no paths in it.
- **Still an input, and recorded rather than pinned:** the Rust toolchain. `rust/rust-toolchain.toml` says
  `stable`, so a rebuild after the next stable release will very likely give a different wasm.
  `BUILDINFO.json` records `rustc -vV`; to rebuild the frozen bytes, install that exact version
  (`rustup toolchain install 1.97.1`) and run with `RUSTUP_TOOLCHAIN=1.97.1`. Node, npm and vite are
  recorded too. The npm tree comes from `package-lock.json` via `npm ci`.
- **The tarball's bytes also depend on the zlib build** (gzip level 9). The manifest is the contract.
  The tarball is reproducible on one machine, and a different zlib may compress differently.

## 1. Rehearse (any time, from main)

On familiar (the build host; nothing here needs katana):

```sh
export PATH=$HOME/.cargo/bin:/var/tmp/fwork/nebula-xr-node/bin:$PATH   # cargo + Node 20+
export npm_config_cache=/var/tmp/ftarget/<you>/.npm TMPDIR=/var/tmp/ftarget/<you>/tmp
git clone https://github.com/jphein/tapstone-game /var/tmp/ftarget/<you>/tapstone && cd $_
tools/freeze_contest.py HEAD --allow-untagged --out /var/tmp/ftarget/<you>/rehearsal
tools/freeze_contest.py --verify /var/tmp/ftarget/<you>/rehearsal/HEAD-<sha7>
```

It takes one to six minutes (cargo about 10 s, `npm ci` 20–40 s with a warm cache, vite 15 s).
`--keep-work` keeps `<out>.work/` (the clone, target dir and node_modules) for debugging. To try a
rehearsal in IWER, or on the headset over the LAN, serve it under its real base path. Its URLs are
rooted at `/competition/v1/`, so `vite preview` or any file server must serve the bundle there.

## 2. Freeze day: tag and build (JP tags; the build is safe to run)

1. Everything for the entry is merged to main, and the rust gates (`rust/README.md`) and the xr tests
   (`node --test` in `rust/tapstone-web/www/xr`) are green on main.
2. **JP** creates the tag on the merge commit: `git tag -a vr-competition-v1 -m "…"`. Push it only
   when the build below is good. A tag that has been pushed is never moved.
3. Build from the tag in a fresh clone:

   ```sh
   tools/freeze_contest.py vr-competition-v1 --out ~/freeze
   ```

   It exits 0 and ends with `frozen vr-competition-v1 @ <sha> (tag)`, the sigil, the file count and the
   tarball's sha256. Exit 2 is a refusal, and it says why. Nothing is half-built: everything is staged in
   `<out>.work/` and renamed to `--out` only after every check has passed, including unpacking the
   tarball and verifying it. After a refusal, `--out` does not exist (`--keep-work` keeps the staged
   files for debugging).
4. Build it **a second time** into another dir and compare. The manifests must match byte for byte:

   ```sh
   tools/freeze_contest.py vr-competition-v1 --out ~/freeze-2
   cmp ~/freeze/vr-competition-v1/MANIFEST.sha256 ~/freeze-2/vr-competition-v1/MANIFEST.sha256
   ```

## 3. Check it before it leaves the build host

```sh
tools/freeze_contest.py --verify ~/freeze/vr-competition-v1          # OK … N files
(cd ~/freeze/vr-competition-v1 && sha256sum --strict -c MANIFEST.sha256 | grep -vc ': OK$')   # 0
jq -r '.ref, .commit, .sigil, .toolchain.rustc' ~/freeze/vr-competition-v1/BUILDINFO.json
```

Then play one match to the end from the bundle, served at `/competition/v1/`, in IWER or on the
Quest, and confirm it makes zero network requests after load (the spec's day-1 bar).

## 4. Deploy — JP only

The card site is Caddy on **ubox0** serving `/srv/tapstone.realm.watch` (see `site/README.md`). The
bundle goes to `/srv/tapstone.realm.watch/competition/v1/`.

> ✅ **The card-site deploy no longer deletes it** (2026-09-27). Both rsyncs in `site/README.md` now carry
> `--exclude /competition/`. Without it, `--delete` would wipe the frozen build on the next card-page
> deploy, because `site/` has no `competition/`. A local rsync showed both sides: with the exclude the
> frozen `index.html` survives and a stale page is still removed; without it, `competition/` is gone.
> Where `/competition/` is finally served from is still open (public hosting is on hold, JP 2026-09-27).

One way, with the checks at both ends (JP runs it):

```sh
scp ~/freeze/vr-competition-v1.tar.gz{,.sha256} ubox0:~/
ssh ubox0 'set -e; sha256sum -c vr-competition-v1.tar.gz.sha256
  sudo test ! -e /srv/tapstone.realm.watch/competition/v1
  sudo mkdir -p /srv/tapstone.realm.watch/competition
  sudo tar -xzf vr-competition-v1.tar.gz --no-same-owner -C /srv/tapstone.realm.watch/competition
  sudo mv /srv/tapstone.realm.watch/competition/vr-competition-v1 /srv/tapstone.realm.watch/competition/v1
  cd /srv/tapstone.realm.watch/competition/v1 && sha256sum --strict --quiet -c MANIFEST.sha256
  sudo chmod -R a+rX,a-w /srv/tapstone.realm.watch/competition/v1'
```

`set -e` stops at the first failure. The `test ! -e` refuses to overwrite an existing v1.
`--quiet` prints only the files that fail, so silence and exit 0 mean every file checks. `a-w`
makes the tree read-only. `sudo chattr -R +i` would make it immutable even to root, and that is
JP's call. Then push the tag: `git push origin vr-competition-v1`.

## 5. Check it live — JP or anyone, read-only

```sh
curl -fsS https://tapstone.realm.watch/competition/v1/version.json | jq -r .version,.hash,.built
curl -fsS https://tapstone.realm.watch/competition/v1/MANIFEST.sha256 | cmp - ~/freeze/vr-competition-v1/MANIFEST.sha256
curl -sI https://tapstone.realm.watch/competition/v1/tapstone_web.wasm | grep -i '^content-type'   # application/wasm
```

Then load it from a clean headset (not the one used for development) and from IWER, as week 7 says.
The hash in `version.json` must equal the tag's commit, and the sigil name must match `BUILDINFO.json`.

## 6. The status check — JP only

Register `https://tapstone.realm.watch/competition/v1/version.json` in status.realm.watch's
`checks.json` (it lists only `https://tapstone.realm.watch` today). That repo is not touched from here.

## After Nov 18

Never redeploy `/competition/v1/`. A later build is `vr-competition-v2` at `/competition/v2/`
(`--base /competition/v2/`). To prove v1 has not changed, compare its live `MANIFEST.sha256` with the
archived tarball's, or run `--verify` on a fresh copy.
