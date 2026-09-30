# Public hosting: tapstone.realm.watch on Cloudflare Pages, and the contest link on GitHub Pages

**Decision (the lead, 2026-09-28, under JP's standing rule "JP is never the bottleneck"): Cloudflare
Pages.**
- It's static and free.
- realm.watch's DNS is already on Cloudflare.
- Every deploy is immutable and gets its own URL, which suits the frozen contest build (VR spec: never redeployed after Nov 18).
- The home network stays closed. The other option, a Cloudflare Tunnel to ubox0's Caddy, would make a homelab service internet-facing and tie the contest build to ubox0 staying up through judging.

The LAN copy on ubox0 (site/README.md) stays as it is.

## What's ready (agent side)
- `tools/pages_deploy.py` stages `site/` (without the git-ignored media or ops notes) and, with
  `--bundle`, the frozen contest bundle at `competition/v1/`. The bundle is checked against its
  MANIFEST.sha256 first, so a tampered bundle is never staged.
  - The default is a **dry run** that prints the exact `wrangler pages deploy` command.
  - `--deploy` runs it, and refuses without both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- Tests: `python3 -m unittest tools/test_pages_deploy.py`.

## The account step (JP, once, about 5 minutes)
1. In the Cloudflare dashboard: Workers & Pages → Create → Pages → "Direct Upload", project name
   **tapstone**. That gives `tapstone.pages.dev`.
2. The project → Custom domains → add **tapstone.realm.watch** (Cloudflare adds the DNS record).
   - A LAN-only DNS override, if you have one, keeps LAN clients on the LAN copy. Remove it if the LAN should see the public copy too.
3. Create an API token with the "Cloudflare Pages: Edit" permission for the account. Store it in Vaultwarden as
   `cloudflare-pages-tapstone`, with the account id beside it.

After that, agents deploy with:

```sh
CLOUDFLARE_API_TOKEN=$(bw get password cloudflare-pages-tapstone) CLOUDFLARE_ACCOUNT_ID=<id> \
  python3 tools/pages_deploy.py --bundle <frozen bundle dir> --deploy
```

## GitHub Pages (the contest link): jphein.github.io/tapstone-game
The contest rules name GitHub Pages as an accepted host, and tapstone-game is public, so this path
needs no account setup beyond enabling Pages once. `--target github` differs from Cloudflare in three ways:
- **The base.** Pages serves a project repo under `/tapstone-game/`, so the bundle must be frozen
  with `--base /tapstone-game/competition/v1/`. Staging reads the bundle's BUILDINFO and refuses a
  bundle built for the other host, before anything is copied.
- **Only scrubbed content.** It publishes to a public repo, so run it from a **tapstone-game
  checkout** (the publication snapshot), never this repo. This repo's `site/` carries the
  unpublished repo URL and a third-party card demo. Staging scans every text file for those
  markers and refuses (leaving nothing staged) on a hit.
- **The push.** `--deploy` builds a fresh one-commit `gh-pages` branch in the staging dir and
  force-pushes it to `jphein/tapstone-game`. It uses the `gh` credential helper, so no Cloudflare
  variables are needed. Enable Pages once:
  `gh api repos/jphein/tapstone-game/pages -f "source[branch]=gh-pages" -f "source[path]=/"`.

```sh
# in ~/Projects/tapstone-game, at the snapshot of the frozen commit
tools/freeze_contest.py <ref> --base /tapstone-game/competition/v1/ --out ~/freeze-gh
tools/freeze_contest.py --verify ~/freeze-gh/<name>
tools/pages_deploy.py --target github --bundle ~/freeze-gh/<name> --out ~/pages-gh   # dry run
tools/pages_deploy.py --target github --bundle ~/freeze-gh/<name> --out ~/pages-gh2 --deploy
```

Rehearsed 2026-09-28 on familiar (untagged; nothing deployed):
- **From this repo (main f177cb9):** the bundle verified (105 files), and its assets resolve under
  `/tapstone-game/competition/v1/`. A Cloudflare stage refused it for the base. A GitHub stage was
  refused for private content, both for this repo's `site/` and for the bundle itself (its sigil
  names the unpublished repo).
- **From tapstone-game (9908a7b), the real path:** the bundle verified (105 files) and staged clean
  (152 files). The publication detector and gitleaks found nothing beyond the known false positives.

The deploy runs each git step as its own argv in the staging dir, with no shell. It refuses a
directory that already holds a `.git`, and it re-runs the content guard before pushing. The guard
reads every file as bytes, ignores case, and refuses dotfiles. The commit takes the public repo's
existing author, so a deploy publishes no new identity.

Unlike a Cloudflare deploy, a force-push replaces the previous deploy, so there is no immutable
per-deploy URL. Record the gh-pages commit sha in the submission notes instead.

## Freeze day
`docs/runbooks/contest-freeze.md` §4 now deploys through this path. Build and verify the bundle, stage it
with `--bundle`, and deploy. Record the deployment's own immutable URL (`<hash>.tapstone.pages.dev`)
in the submission alongside `tapstone.realm.watch/competition/v1/`.
