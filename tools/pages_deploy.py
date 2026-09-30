#!/usr/bin/env python3
"""tools/pages_deploy.py: stage tapstone.realm.watch for Cloudflare or GitHub Pages, and (only when told) deploy it.

Public hosting decision (the lead, 2026-09-28, under JP's standing rule): **Cloudflare Pages**.
It's static and free, realm.watch's DNS is already on Cloudflare, every deploy is immutable (it
gets its own URL, which suits the contest freeze), and the home network stays closed.
docs/runbooks/public-hosting.md has the steps; the ACCOUNT step (creating the Pages project and
the custom domain on JP's Cloudflare account) is JP's.

    tools/pages_deploy.py [--bundle <frozen competition bundle dir>] [--out <staging dir>]
    tools/pages_deploy.py ... --deploy        # cloudflare: only with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
    tools/pages_deploy.py --target github ... # from a tapstone-game checkout; runbook "GitHub Pages"

- The staging dir is `site/` minus git-ignored media, plus the frozen contest bundle at
  `competition/v1/` when --bundle is given. The bundle is verified against its MANIFEST.sha256
  first (freeze_contest.verify), so a tampered or partial bundle is never staged.
- The default is a DRY RUN: it stages and prints the exact wrangler command. --deploy runs it,
  and refuses without both Cloudflare variables. Nothing here creates projects or DNS records.
"""
import argparse
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROJECT = "tapstone"
CONTEST_PATH = "competition/v1"
ENV = ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID")
# Where each host serves the contest bundle. GitHub Pages serves a project repo under /<repo>/, so a
# bundle must be BUILT for that base (freeze_contest.py --base), or every asset 404s.
PUBLIC_REPO = "jphein/tapstone-game"
BASES = {"cloudflare": "/" + CONTEST_PATH + "/", "github": "/tapstone-game/" + CONTEST_PATH + "/"}
# The github target publishes to a public repo, so it stages only scrubbed content: run it from a
# tapstone-game checkout (the publication snapshot), never the working repo, whose site/ carries the
# unpublished repo's URL and a third-party card demo; the snapshot scrubs both. The markers are built
# from fragments so this file passes the publication detector itself.
_ME = "jphein/" + "tapstone"
# Every file is scanned as bytes, case-insensitively (the bundle carries .mjs, .map and .wasm too).
PRIVATE = re.compile(rb"github\.com\\?/" + _ME.encode().replace(b"/", b"\\\\?/") + rb"(?![-\w])|" + b"pri" + b"vate tapstone repo|"
                     rb"wizards of the coast|scryfall", re.I)
ALLOWED_DOTFILES = {".nojekyll"}

sys.path.insert(0, str(REPO / "tools"))
import freeze_contest  # noqa: E402


class Refusal(SystemExit):
    pass


def bundle_base(bundle):
    import json
    info = Path(bundle) / freeze_contest.BUILDINFO
    return json.loads(info.read_text()).get("base") if info.exists() else None


def private_hits(out):
    """Files under `out` that must not reach a public repo: a private marker anywhere in the bytes, or
    a dotfile (.env and the like) other than .nojekyll."""
    out, hits = Path(out), []
    for p in sorted(out.rglob("*")):
        rel = p.relative_to(out)
        if any(part.startswith(".") and part not in ALLOWED_DOTFILES for part in rel.parts):
            hits.append(str(rel))
        elif p.is_file() and PRIVATE.search(p.read_bytes()):
            hits.append(str(rel))
    return hits


def stage(out, site=REPO / "site", bundle=None, target="cloudflare"):
    """Build the Pages directory at `out` (it must not exist). Returns the file count."""
    out = Path(out)
    if target not in BASES:
        raise Refusal(f"unknown target {target!r} (one of {', '.join(BASES)})")
    if out.exists():
        raise Refusal(f"{out} exists; stage into a new directory")
    if bundle is not None:
        want, got = BASES[target], bundle_base(bundle)
        if got != want:
            raise Refusal(f"the bundle was built for base {got!r}; {target} serves it at {want!r} "
                          f"(rebuild with freeze_contest.py --base {want})")
    try:
        shutil.copytree(site, out, ignore=shutil.ignore_patterns("media", ".git*", "README.md"))
        if bundle is not None:
            problems = freeze_contest.verify(Path(bundle))
            if problems:
                raise Refusal(f"the contest bundle fails its manifest: {problems[:3]}")
            shutil.copytree(bundle, out / CONTEST_PATH)
        if target == "github":
            hits = private_hits(out)
            if hits:
                raise Refusal(f"private content in a public deploy: {hits[:3]} (stage from a "
                              f"tapstone-game checkout, the scrubbed snapshot)")
            (out / ".nojekyll").write_text("")  # serve _-prefixed paths as they are
    except BaseException:
        shutil.rmtree(out, ignore_errors=True)  # a refusal or a crash mid-copy leaves nothing staged
        raise
    return sum(1 for p in out.rglob("*") if p.is_file())


def public_identity(repo=REPO):
    """The author already on the public repo's commits, so a deploy publishes no new identity."""
    r = subprocess.run(["git", "-C", str(repo), "log", "-1", "--format=%an%n%ae"],
                       capture_output=True, text=True, check=True)
    return r.stdout.split("\n")[:2]


def command(out, target="cloudflare", identity=("<name>", "<email>")):
    """The deploy as a list of argv lists, each run with cwd=out and no shell."""
    if target == "github":
        # A fresh one-commit gh-pages branch in the staging dir, force-pushed to tapstone-game. Pages is
        # enabled once with: gh api repos/<repo>/pages -f "source[branch]=gh-pages" -f "source[path]=/".
        # --git-dir/--work-tree pin every step to out/.git, whatever the caller's GIT_* say.
        name, email = identity
        g = ["git", f"--git-dir={Path(out) / '.git'}", f"--work-tree={out}"]
        return [["git", "init", "-q", "-b", "gh-pages", str(out)],
                g + ["add", "--all", "."],
                g + ["-c", f"user.name={name}", "-c", f"user.email={email}",
                     "commit", "-q", "-m", "Pages deploy"],
                g + ["push", "-f", f"https://github.com/{PUBLIC_REPO}.git", "gh-pages"]]
    return [["npx", "--yes", "wrangler", "pages", "deploy", str(out), "--project-name", PROJECT,
             "--branch", "main", "--commit-dirty=true"]]


def deploy(out, env=os.environ, run=subprocess.run, target="cloudflare", identity=None):
    out = Path(out)
    if target == "cloudflare":
        missing = [k for k in ENV if not env.get(k)]
        if missing:
            raise Refusal(f"--deploy needs {', '.join(missing)} (the Cloudflare account step is JP's)")
    else:
        # Re-checked here, not trusted from stage(): deploy pushes whatever `out` holds.
        if not (out / ".nojekyll").is_file():
            raise Refusal(f"{out} was not staged for github (no .nojekyll)")
        if (out / ".git").exists():
            raise Refusal(f"{out} already holds a .git; stage into a new directory")
        hits = private_hits(out)
        if hits:
            raise Refusal(f"private content in a public deploy: {hits[:3]}")
        identity = identity or public_identity()
    # An inherited GIT_DIR (a git hook, a wrapper) would otherwise beat cwd and commit to the parent.
    clean = {k: v for k, v in env.items() if not k.startswith("GIT_")}
    for cmd in command(out, target, identity or ("", "")):
        run(cmd, check=True, cwd=out, env=clean)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--bundle", help="a frozen contest bundle dir (tools/freeze_contest.py output)")
    ap.add_argument("--out", default=str(REPO / "scratch" / "pages-staging"))
    ap.add_argument("--target", choices=sorted(BASES), default="cloudflare",
                    help="cloudflare (tapstone.realm.watch) or github (jphein.github.io/tapstone-game)")
    ap.add_argument("--deploy", action="store_true", help="deploy (default: dry run)")
    a = ap.parse_args(argv)
    n = stage(a.out, bundle=a.bundle, target=a.target)
    print(f"staged {n} files in {a.out} for {a.target}")
    if a.deploy:
        deploy(a.out, target=a.target)
    else:
        print(f"dry run; to deploy (in {a.out}):", " && ".join(map(shlex.join, command(a.out, a.target))))


if __name__ == "__main__":
    main()
