#!/usr/bin/env python3
"""tools/pages_deploy.py: stage tapstone.realm.watch for Cloudflare Pages, and (only when told) deploy it.

Public hosting decision (the lead, 2026-09-28, under JP's standing rule): **Cloudflare Pages**.
It's static and free, realm.watch's DNS is already on Cloudflare, every deploy is immutable (it
gets its own URL, which suits the contest freeze), and the home network stays closed.
docs/runbooks/public-hosting.md has the steps; the ACCOUNT step (creating the Pages project and
the custom domain on JP's Cloudflare account) is JP's.

    tools/pages_deploy.py [--bundle <frozen competition bundle dir>] [--out <staging dir>]
    tools/pages_deploy.py ... --deploy        # only with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID

- The staging dir is `site/` minus git-ignored media, plus the frozen contest bundle at
  `competition/v1/` when --bundle is given. The bundle is verified against its MANIFEST.sha256
  first (freeze_contest.verify), so a tampered or partial bundle is never staged.
- The default is a DRY RUN: it stages and prints the exact wrangler command. --deploy runs it,
  and refuses without both Cloudflare variables. Nothing here creates projects or DNS records.
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROJECT = "tapstone"
CONTEST_PATH = "competition/v1"
ENV = ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID")

sys.path.insert(0, str(REPO / "tools"))
import freeze_contest  # noqa: E402


class Refusal(SystemExit):
    pass


def stage(out, site=REPO / "site", bundle=None):
    """Build the Pages directory at `out` (it must not exist). Returns the file count."""
    out = Path(out)
    if out.exists():
        raise Refusal(f"{out} exists; stage into a new directory")
    shutil.copytree(site, out, ignore=shutil.ignore_patterns("media", ".git*", "README.md"))
    if bundle is not None:
        problems = freeze_contest.verify(Path(bundle))
        if problems:
            shutil.rmtree(out)
            raise Refusal(f"the contest bundle fails its manifest: {problems[:3]}")
        shutil.copytree(bundle, out / CONTEST_PATH)
    return sum(1 for p in out.rglob("*") if p.is_file())


def command(out):
    return ["npx", "--yes", "wrangler", "pages", "deploy", str(out), "--project-name", PROJECT,
            "--branch", "main", "--commit-dirty=true"]


def deploy(out, env=os.environ, run=subprocess.run):
    missing = [k for k in ENV if not env.get(k)]
    if missing:
        raise Refusal(f"--deploy needs {', '.join(missing)} (the Cloudflare account step is JP's)")
    return run(command(out), check=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--bundle", help="a frozen contest bundle dir (tools/freeze_contest.py output)")
    ap.add_argument("--out", default=str(REPO / "scratch" / "pages-staging"))
    ap.add_argument("--deploy", action="store_true", help="run wrangler (default: dry run)")
    a = ap.parse_args(argv)
    n = stage(a.out, bundle=a.bundle)
    print(f"staged {n} files in {a.out}")
    if a.deploy:
        deploy(a.out)
    else:
        print("dry run; to deploy:", " ".join(command(a.out)))


if __name__ == "__main__":
    main()
