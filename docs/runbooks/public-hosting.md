# Public hosting: tapstone.realm.watch on Cloudflare Pages

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

## Freeze day
`docs/runbooks/contest-freeze.md` §4 now deploys through this path. Build and verify the bundle, stage it
with `--bundle`, and deploy. Record the deployment's own immutable URL (`<hash>.tapstone.pages.dev`)
in the submission alongside `tapstone.realm.watch/competition/v1/`.
