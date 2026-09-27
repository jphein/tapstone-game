#!/usr/bin/env python3
"""Freeze the VR competition build: one immutable, verifiable bundle from one git tag.

    tools/freeze_contest.py vr-competition-v1 --out <dir>      # build <dir>/<name>/ and <name>.tar.gz
    tools/freeze_contest.py --verify <dir>/<name>              # re-hash against MANIFEST.sha256

From a fresh clone of the repo at the ref (never the working tree), it builds the wasm arena, runs
its gate, builds the xr vite dist under the base path (/competition/v1/), stamps it with realm-sigil
(static/build.sh, with the build time taken from the commit so a rebuild is byte-identical), writes
BUILDINFO.json and MANIFEST.sha256 over every file, packs a deterministic tarball, then unpacks the
tarball and verifies it. It refuses a dirty tree, and a ref that is not a tag unless
--allow-untagged. It never deploys anything. Runbook: docs/runbooks/contest-freeze.md.
"""
import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

REPO = Path(__file__).resolve().parent.parent
MANIFEST = "MANIFEST.sha256"
BUILDINFO = "BUILDINFO.json"
DEFAULT_BASE = "/competition/v1/"
DEFAULT_SIGIL = Path(os.environ.get("REALM_SIGIL_DIR", Path.home() / "Projects" / "realm-sigil"))
SIGIL_ARGS = ["--name", "tapstone", "--description", "Tapstone VR competition build",
              "--realm", "fantasy", "--repo", "https://github.com/jphein/tapstone-game"]
WASM_REL = "wasm32-unknown-unknown/wasm/tapstone_web.wasm"  # under CARGO_TARGET_DIR
XR = Path("rust/tapstone-web/www/xr")
GATE = ["node", "tapstone-web/gate.mjs"]  # run from rust/, as rust/README.md does
FIXTURE = "tapstone-arena/web/fixtures/desk-seed11.jsonl"
MANIFEST_LINE = re.compile(r"([0-9a-f]{64})  (.+)")


class Refusal(Exception):
    """A precondition the freeze will not build past."""


# ---- the manifest ---------------------------------------------------------------------------

def _walk(root):
    """(regular files by relative posix path, problems, empty dirs) under root, without following
    links. MANIFEST.sha256 itself is not a file of the bundle."""
    files, problems, dirs = {}, [], []
    for d, dirnames, filenames in os.walk(root):
        rel_d = Path(d).relative_to(root).as_posix()
        for name in sorted(dirnames + filenames):
            p = Path(d) / name
            rel = (Path(rel_d) / name).as_posix() if rel_d != "." else name
            if p.is_symlink():
                problems.append(f"SYMLINK {rel}")
            elif p.is_dir():
                dirs.append(rel)
            elif p.is_file():
                if rel != MANIFEST:
                    files[rel] = p
            else:
                problems.append(f"NOT A REGULAR FILE {rel}")
        dirnames[:] = [n for n in dirnames if not (Path(d) / n).is_symlink()]
    empty = [d for d in dirs if not any(f.startswith(d + "/") for f in files)]
    return files, problems, empty


def _sha256(path):
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def write_manifest(root):
    """Write root/MANIFEST.sha256 (sha256sum format, sorted by path) over every file in root."""
    root = Path(root)
    files, problems, empty = _walk(root)
    problems += [f"EMPTY DIR {d}/" for d in empty]
    problems += [f"UNREPRESENTABLE NAME {p!r}" for p in files if "\n" in p or "\\" in p]
    if problems:
        raise Refusal("cannot manifest this tree: " + "; ".join(problems))
    if not files:
        raise Refusal(f"nothing to manifest in {root}")
    lines = [f"{_sha256(files[p])}  {p}\n" for p in sorted(files)]
    (root / MANIFEST).write_text("".join(lines), encoding="utf-8")
    return len(lines)


def verify(root):
    """Every problem with root against its manifest: MISMATCH, MISSING, EXTRA and the rest. Empty
    means the bundle is exactly what the manifest says, byte for byte and file for file."""
    root = Path(root)
    m = root / MANIFEST
    if not m.is_file() or m.is_symlink():
        return [f"no {MANIFEST} in {root}"]
    problems, want = [], {}
    for i, line in enumerate(m.read_text(encoding="utf-8").splitlines(), 1):
        mo = MANIFEST_LINE.fullmatch(line)
        if not mo:
            problems.append(f"malformed manifest line {i}: {line[:80]!r}")
            continue
        h, p = mo.groups()
        pp = PurePosixPath(p)
        if pp.is_absolute() or ".." in pp.parts or pp.as_posix() != p or p == MANIFEST:
            problems.append(f"unsafe manifest path on line {i}: {p!r}")
        elif p in want:
            problems.append(f"duplicate manifest entry on line {i}: {p}")
        else:
            want[p] = h
    if not want and not problems:
        problems.append("manifest is empty: it checks nothing")
    have, walk_problems, empty = _walk(root)
    problems += walk_problems
    for p in sorted(set(want) | set(have)):
        if p not in have:
            problems.append(f"MISSING {p}")
        elif p not in want:
            problems.append(f"EXTRA {p}")
        elif _sha256(have[p]) != want[p]:
            problems.append(f"MISMATCH {p}")
    problems += [f"EXTRA {d}/" for d in empty]
    return problems


# ---- the tarball ----------------------------------------------------------------------------

def make_tarball(root, dest, prefix, epoch):
    """A tar.gz of root under prefix/ whose bytes depend only on the files' contents: sorted
    entries, one mtime (epoch), owner 0:0 with no names, modes 0755/0644, GNU format (no pax
    headers), and a gzip header with no name and a fixed mtime."""
    root = Path(root)

    def info(name, kind, size=0):
        ti = tarfile.TarInfo(name)
        ti.type, ti.size, ti.mtime = kind, size, epoch
        ti.mode = 0o755 if kind == tarfile.DIRTYPE else 0o644
        ti.uid = ti.gid = 0
        ti.uname = ti.gname = ""
        return ti

    entries = sorted(p.relative_to(root).as_posix() for p in root.rglob("*"))
    with open(dest, "wb") as raw, \
            gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=epoch, compresslevel=9) as gz, \
            tarfile.open(fileobj=gz, mode="w", format=tarfile.GNU_FORMAT) as tf:
        tf.addfile(info(prefix, tarfile.DIRTYPE))
        for rel in entries:
            p = root / rel
            if p.is_symlink() or not (p.is_dir() or p.is_file()):
                raise Refusal(f"not a regular file or dir: {rel}")
            if p.is_dir():
                tf.addfile(info(f"{prefix}/{rel}", tarfile.DIRTYPE))
            else:
                with open(p, "rb") as f:
                    tf.addfile(info(f"{prefix}/{rel}", tarfile.REGTYPE, p.stat().st_size), f)


# ---- preconditions --------------------------------------------------------------------------

@dataclass
class Source:
    ref: str
    commit: str
    epoch: int  # the commit time: SOURCE_DATE_EPOCH for everything the build stamps
    tagged: bool


def _git(repo, *args, check=True):
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if check and r.returncode:
        raise Refusal(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r


def check_clean(repo):
    status = _git(repo, "status", "--porcelain", "--untracked-files=normal").stdout
    if status.strip():
        n = len(status.splitlines())
        raise Refusal(f"the tree at {repo} is dirty ({n} changed or untracked paths); a freeze "
                      "builds from a clean tree only, so commit, stash or remove them first:\n"
                      + "\n".join(status.splitlines()[:20]))


def resolve_source(repo, ref, allow_untagged):
    r = _git(repo, "rev-parse", "-q", "--verify", f"{ref}^{{commit}}", check=False)
    if r.returncode:
        raise Refusal(f"{ref!r} does not name a commit in {repo}")
    commit = r.stdout.strip()
    tagged = _git(repo, "rev-parse", "-q", "--verify", f"refs/tags/{ref}", check=False).returncode == 0
    if not tagged and not allow_untagged:
        raise Refusal(f"{ref!r} is not a tag; the competition bundle is built from a tag "
                      "(vr-competition-v1). Pass --allow-untagged for a rehearsal build.")
    epoch = int(_git(repo, "show", "-s", "--format=%ct", commit).stdout.strip())
    return Source(ref, commit, epoch, tagged)


# ---- the realm-sigil stamp ------------------------------------------------------------------

def iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def stamp(repo, html, sigil_dir, epoch):
    """Run realm-sigil's static/build.sh in repo against html, and put version.json beside html.

    build.sh takes its build time from `date -u` and its hash from `git rev-parse --short`, whose
    length grows with the repo's object count. Both would make two builds of one commit differ, so
    a `date` shim on PATH answers with the commit time and core.abbrev pins the hash at 7."""
    repo, html, sigil = Path(repo), Path(html).resolve(), Path(sigil_dir) / "static" / "build.sh"
    if not sigil.is_file():
        raise Refusal(f"realm-sigil's static/build.sh is not at {sigil}; set --sigil-dir")
    real_date = shutil.which("date")
    with tempfile.TemporaryDirectory() as shim:
        (Path(shim) / "date").write_text(f'#!/bin/sh\nexec {real_date} -d "@{epoch}" "$@"\n')
        (Path(shim) / "date").chmod(0o755)
        env = {**os.environ, "PATH": f"{shim}:{os.environ['PATH']}", "SOURCE_DATE_EPOCH": str(epoch),
               "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.abbrev", "GIT_CONFIG_VALUE_0": "7"}
        r = subprocess.run(["bash", str(sigil), *SIGIL_ARGS, "--html", str(html), "--dir", str(repo)],
                           env=env, capture_output=True, text=True)
    if r.returncode:
        raise Refusal(f"realm-sigil build.sh failed:\n{r.stdout}\n{r.stderr}")
    shutil.move(repo / "version.json", html.parent / "version.json")
    info = json.loads((html.parent / "version.json").read_text())
    want_hash = _git(repo, "rev-parse", "HEAD").stdout.strip()[:7]
    bad = [f"built {info['built']} != {iso(epoch)} (the date shim did not take)"] * (info["built"] != iso(epoch))
    bad += [f"hash {info['hash']} != {want_hash}"] * (info["hash"] != want_hash)
    bad += ["dirty is true"] * (info["dirty"] is not False)
    bad += [f"no realm-version meta in {html}"] * ('<meta name="realm-version"' not in html.read_text())
    if bad:
        raise Refusal("the sigil stamp is wrong: " + "; ".join(bad))
    return info


# ---- checks on the built bundle -------------------------------------------------------------

def check_base(index_html, base):
    """Problems with the page's root-relative src/href: each must sit under base, and at least one
    must (so a build that ignored --base, and emitted ./assets or /assets, cannot pass)."""
    refs = re.findall(r'\b(?:src|href)="([^"]*)"', index_html)
    rooted = [r for r in refs if r.startswith("/") and not r.startswith("//")]
    problems = [f"{r} is outside {base}" for r in rooted if not r.startswith(base)]
    if not any(r.startswith(base) for r in rooted):
        problems.append(f"no src/href under {base} in index.html (refs: {refs[:5]})")
    return problems


def gate_record(output):
    """The gate's lines without their timings, which differ run to run."""
    return [re.sub(r", [0-9.]+ ms\)", ")", l) for l in output.splitlines()]


def find_leaks(root, needles):
    """Files under root containing any needle (build-machine paths that must not ship)."""
    leaks = []
    for p in sorted(Path(root).rglob("*")):
        if p.is_file() and not p.is_symlink():
            data = p.read_bytes()
            if any(n in data for n in needles):
                leaks.append(p.relative_to(root).as_posix())
    return leaks


# ---- the build ------------------------------------------------------------------------------

def run(cmd, cwd, env=None, capture=False):
    print(f"+ {' '.join(map(str, cmd))}   (in {cwd})", flush=True)
    r = subprocess.run([str(c) for c in cmd], cwd=cwd, env=env, text=True,
                       capture_output=capture)
    if r.returncode:
        tail = (r.stdout or "")[-2000:] + (r.stderr or "")[-2000:] if capture else ""
        raise Refusal(f"{cmd[0]} exited {r.returncode}{': ' + tail if tail else ''}")
    return r.stdout.strip() if capture else ""


def build(args):
    repo, out = Path(args.repo).resolve(), Path(args.out).resolve()
    base = args.base if args.base.endswith("/") else args.base + "/"
    work = out.with_name(out.name + ".work")
    for p in (out, work):
        if p.exists():
            raise Refusal(f"{p} exists; a frozen bundle is never rebuilt in place (move it aside)")
    check_clean(repo)
    src = resolve_source(repo, args.ref, args.allow_untagged)
    name = re.sub(r"[^A-Za-z0-9._-]", "-", src.ref if src.tagged else f"{src.ref}-{src.commit[:7]}")
    sigil = Path(args.sigil_dir)
    if not (sigil / "static" / "build.sh").is_file():
        raise Refusal(f"realm-sigil's static/build.sh is not at {sigil}; set --sigil-dir")
    node = run(["node", "--version"], repo, capture=True)
    if int(node.lstrip("v").split(".")[0]) < 20:
        raise Refusal(f"vite needs Node 20+, and node is {node}")

    work.mkdir(parents=True)
    try:
        clone = work / "src"
        # A fresh clone at the commit: what is built is what the ref says, not the working tree.
        run(["git", "clone", "-q", "--no-checkout", "--no-hardlinks", repo, clone], work)
        run(["git", "checkout", "-q", "-B", f"freeze/{name}", src.commit], clone)
        rust = clone / "rust"

        # The wasm. Absolute paths in it (panic locations in std and in registry crates) would tie
        # its bytes to this machine's $HOME and to whether rust-src is installed; remap them to
        # what a machine without rust-src has (/rustc/<commit>) and to fixed names.
        vv = run(["rustc", "-vV"], rust, capture=True)
        rustc_commit = re.search(r"^commit-hash: (\w+)$", vv, re.M).group(1)
        sysroot = run(["rustc", "--print", "sysroot"], rust, capture=True)
        cargo_home = os.environ.get("CARGO_HOME", str(Path.home() / ".cargo"))
        env = {k: v for k, v in os.environ.items()
               if k not in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "CARGO_BUILD_RUSTFLAGS")}
        env["CARGO_TARGET_DIR"] = str(work / "target")
        env["SOURCE_DATE_EPOCH"] = str(src.epoch)
        env["RUSTFLAGS"] = " ".join([
            f"--remap-path-prefix={sysroot}/lib/rustlib/src/rust=/rustc/{rustc_commit}",
            f"--remap-path-prefix={cargo_home}=/cargo",
            f"--remap-path-prefix={clone}=/tapstone",
        ])
        run(["cargo", "build", "--locked", "-p", "tapstone-web", "--profile", "wasm",
             "--target", "wasm32-unknown-unknown"], rust, env=env)
        wasm = work / "target" / WASM_REL
        wasm_sha = _sha256(wasm)
        gate = run([*GATE, wasm, FIXTURE], rust, capture=True)
        print(gate)

        # The xr dist, under the base path, with the gated wasm in it.
        xr = clone / XR
        shutil.copyfile(wasm, xr / "public" / "tapstone_web.wasm")
        # NODE_ENV=production only for vite (no sourcemaps, vite.config.js): npm ci under it
        # would omit the devDependencies, and vite is one.
        env_js = {**os.environ, "SOURCE_DATE_EPOCH": str(src.epoch)}
        env_js.pop("NODE_ENV", None)
        run(["npm", "ci", "--no-audit", "--no-fund", "--loglevel=error"], xr, env=env_js)
        run([xr / "node_modules/.bin/vite", "build", "--base", base, "--emptyOutDir"], xr,
            env={**env_js, "NODE_ENV": "production"})
        vite = json.loads((xr / "node_modules/vite/package.json").read_text())["version"]

        # Everything is staged in the work dir and renamed to --out only once the tarball has
        # verified, so a refusal never leaves a half-checked bundle where a deploy would look.
        stage = work / "out"
        stage.mkdir()
        bundle = stage / name
        shutil.copytree(xr / "dist", bundle)
        problems = check_base((bundle / "index.html").read_text(), base)
        if not (bundle / "tapstone_web.wasm").is_file() or _sha256(bundle / "tapstone_web.wasm") != wasm_sha:
            problems.append("the bundle's tapstone_web.wasm is not the gated build")
        info = stamp(clone, bundle / "index.html", sigil, src.epoch)
        buildinfo = {
            "ref": src.ref, "tagged": src.tagged, "commit": src.commit,
            "source_date_epoch": src.epoch, "built": iso(src.epoch), "base": base,
            "sigil": info["version"],
            # The gate prints a wall-clock timing ("79 lines, 12.9 ms"); keep everything else.
            "wasm_sha256": wasm_sha, "gate": gate_record(gate),
            "toolchain": {"rustc": vv.splitlines()[0], "rustc_commit": rustc_commit,
                          "cargo": run(["cargo", "-V"], rust, capture=True), "node": node,
                          "npm": run(["npm", "-v"], xr, capture=True), "vite": vite},
            "inputs_sha256": {"realm-sigil/static/build.sh": _sha256(sigil / "static" / "build.sh"),
                              "realm-sigil/words/realms.json": _sha256(sigil / "words" / "realms.json"),
                              "tools/freeze_contest.py": _sha256(Path(__file__).resolve())},
            "generator": "tools/freeze_contest.py",
        }
        (bundle / BUILDINFO).write_text(json.dumps(buildinfo, indent=2) + "\n")

        needles = sorted({str(p).encode() for p in (Path.home(), repo, work, out, cargo_home, sysroot)})
        problems += [f"{f} contains a build-machine path" for f in find_leaks(bundle, needles)]
        if problems:
            raise Refusal("the built bundle failed its checks:\n" + "\n".join(problems))

        n = write_manifest(bundle)
        tarball = stage / f"{name}.tar.gz"
        make_tarball(bundle, tarball, name, src.epoch)
        tar_sha = _sha256(tarball)
        (stage / f"{tarball.name}.sha256").write_text(f"{tar_sha}  {tarball.name}\n")

        # Check the thing that ships: unpack the tarball and verify it against its own manifest.
        with tarfile.open(tarball) as tf:
            tf.extractall(work / "unpacked", filter="data")
        unpacked = work / "unpacked" / name
        bad = verify(unpacked) + verify(bundle)
        if bad or (unpacked / MANIFEST).read_bytes() != (bundle / MANIFEST).read_bytes():
            raise Refusal("the tarball does not verify:\n" + "\n".join(bad))
        stage.rename(out)
        bundle, tarball = out / name, out / tarball.name
    finally:
        if not args.keep_work:
            shutil.rmtree(work, ignore_errors=True)

    print(f"\nfrozen {src.ref} @ {src.commit} ({'tag' if src.tagged else 'UNTAGGED rehearsal'})")
    print(f"  sigil    {info['version']}   built {iso(src.epoch)} (the commit time)")
    print(f"  bundle   {bundle}  ({n} files, {MANIFEST})")
    print(f"  tarball  {tarball}\n  sha256   {tar_sha}")
    print("  nothing was deployed: deploying is JP's step (docs/runbooks/contest-freeze.md)")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ref", nargs="?", help="the tag to freeze (vr-competition-v1)")
    ap.add_argument("--verify", metavar="BUNDLE", help="re-hash a bundle dir against its manifest")
    ap.add_argument("--out", help="new directory for the bundle and tarball (must not exist)")
    ap.add_argument("--repo", default=str(REPO), help="the repo to freeze from (default: this one)")
    ap.add_argument("--allow-untagged", action="store_true", help="rehearse from a branch or sha")
    ap.add_argument("--base", default=DEFAULT_BASE, help=f"the served path (default {DEFAULT_BASE})")
    ap.add_argument("--sigil-dir", default=str(DEFAULT_SIGIL), help="the realm-sigil checkout")
    ap.add_argument("--keep-work", action="store_true", help="keep <out>.work (the clone and target)")
    args = ap.parse_args(argv)
    try:
        if args.verify:
            problems = verify(args.verify)
            for p in problems:
                print(p)
            if problems:
                print(f"FAIL {args.verify}: {len(problems)} problem(s)", file=sys.stderr)
                return 1
            n = len((Path(args.verify) / MANIFEST).read_text().splitlines())
            print(f"OK {args.verify}: {n} files match {MANIFEST}")
            return 0
        if not args.ref or not args.out:
            ap.error("give a ref and --out to build, or --verify BUNDLE")
        build(args)
        return 0
    except Refusal as e:
        print(f"refused: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
