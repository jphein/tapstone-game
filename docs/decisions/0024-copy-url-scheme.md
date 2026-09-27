# 0024 — A copy's URL is `/c/<uid>?k=<hmac12>`, rendered as bare hex, served static for now
Date: 2026-09-21 · Ruled while inscribing the first physical card

The card-data-format doc already said a copy's tag carries
`https://tapstone.realm.watch/c/<uid>?k=<hmac12>`. This decision fixes the two things the doc left
open and records that the first card (a Hullbreaker Horror demo, UID `04:77:C8:BD:CC:2A:81`) was
briefly inscribed with a design slug (`/c/hullbreaker-horror`) and re-inscribed to comply.

- **`<uid>` in the path is the 7-byte UID as 14 lowercase hex characters, no separators**
  (`0477c8bdcc2a81`). Colons in a path work but are hostile to shells, QR codes and directory
  names; the registry keeps the colon form (scry's convention), the URL does not.
- **`k = HMAC-SHA256(secret, "copy:" + uid_with_colons)[:12]`**, secret in
  `~/.config/tapstone/secret` (mode 600, never in the repo). Same shape as scry's tokens.
- **Static tier (now):** tapstone.realm.watch is a Caddy `file_server`; `/c/<hex>/` is a generated
  per-copy page and `k` is carried but not verified. It is on the tag so no card needs rewriting
  when a backend that checks `k` (and later the 424 DNA SUN, decision 0003) arrives.
- **Design pages** stay at `/c/<design-slug>/` and copy pages link to them. A design slug never
  looks like 14 hex characters, so the two namespaces cannot collide.
- **Binding is the scry imbue rite with a foreign URL** (scry-glass `POST /imbue/arm {host, url}`,
  2026-09-21): the copy is logged on the glass, never added to its sigil map, so a tap on a shrine
  station never summons anything. `realm scry inscribe <label> <url>` is the CLI form (realmwatch, 2026-09-21).
