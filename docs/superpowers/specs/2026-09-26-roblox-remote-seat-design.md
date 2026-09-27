# Tapstone on Roblox: a remote seat at a real table, design

Date: 2026-09-26 · Author: the lead, from a brainstorm with JP · Status: **approved** (JP: "go ahead
and do all you can on your own") · Decision: 0038 · Plan: `docs/superpowers/plans/2026-09-26-roblox-remote-seat.md`

JP's answers:
- The purpose is **cross-play with a real table**.
- The Roblox player **plays a seat remotely**. One seat is a real shrine with paper cards; the other is
  a Roblox player anywhere.

## 1. Shape

```
 real shrine ──ESP-NOW──▶ gateway ──USB──▶ ┌──────────── arena (katana/laptop) ─────────────┐
                                           │ ArenaCore  ◀── RemoteLink ──▶ SerialLink        │
                                           │                  └─ remote DeskShrine (manual)  │
                                           │ board listener :7790   (/, /events, /dev/*)     │
                                           │ remote listener :7791  (/remote/* only)         │
                                           └──────────────────────────▲──────────────────────┘
                                                                      │ cloudflared tunnel
 Roblox client ──RemoteEvent──▶ Roblox server ──HttpService (HTTPS)───┘
```

- **The remote seat lives in the arena.** `RemoteLink` wraps any `Link` (the gateway's `SerialLink`,
  or `DeskLink` for testing without hardware) and adds one in-process `DeskShrine`, set manual, on node 165. The arena's
  sends reach both the inner link and the remote shrine; `poll` merges what both queued.
  - The remote shrine claims its seat like any shrine.
  - It holds a deck list (a stem from `decks/`) as virtual copies; draws are taps (0036).
  - Its taps come only from `propose(i)` over the move menu (`legal_choices`, the same menu tapstone-web uses).
- **The Roblox server is the only HTTP client.** Roblox allows HttpService only on the server. It holds
  the token; players never see it. It accepts a move only from the player seated at the table.
- **One source of truth (0037).** Roblox renders the arena's view JSON and proposes. The engine refuses
  whatever it would refuse from a shrine.

## 2. The remote API (listener :7791, tunnelled)

| Route | Body / query | Answer |
|---|---|---|
| `POST /remote/join` | `{"code":"K7Q2MX"}` | `200 {"token":"<32 hex>","seat":1}`; `403` for a wrong code; `429` with `Retry-After` for a source past 10 wrong codes, that source only (0038, amended 2026-09-27; it was `423` for the whole table); `409` if the seat is already joined |
| `GET /remote/view?after=N` | bearer token | `200 {"n":N+k,"view":{…}}`, the next view after number `N`. Waits up to 10 s, then `204` |
| `GET /remote/choices` | bearer token | `200 {"n":N,"menu":[{"key","label","kind","useful"}…]}`; an empty menu when it isn't this seat's move |
| `POST /remote/propose` | bearer token, `{"n":N,"i":3}` | `202` sent; `409` if `n` isn't the current menu (stale); `400` for a bad index |

- **Views are numbered**, counting from each view the core publishes, so a poller never misses one or
  gets one twice.
- **Menus are numbered** for the same reason, so a click on an old menu can't play a different move.
- **No other route exists on :7791.** A test asserts that `/dev/tap`, `/events` and `/` return 404 there.
- **The join code** is 6 characters from an unambiguous alphabet (no 0/O/1/I), fresh per match. It's
  printed on stdout and carried in the view (`remote_code`, shown by the board). The token dies with the match.

## 3. The arena's CLI

`tapstone-arena [--desk] --remote <deck-stem> [--remote-bind 127.0.0.1:7791]`
- **With `--desk`:** the remote seat plays against a desk bot, with no hardware and no shrine. It's the
  Roblox side's test table.
- **Without `--desk`:** the remote seat plays against the real shrine on the gateway.
- **The tunnel is a separate process**, started by the operator:
  `cloudflared tunnel --url http://127.0.0.1:7791`. For the prototype that's a quick tunnel on
  trycloudflare.com: no account, and a fresh URL each run, which the Roblox place reads from a
  server-side setting. A named tunnel on `remote.tapstone.realm.watch` comes later.

## 4. The Roblox place (`roblox/` in this repo)

- **Toolchain:** Rojo 7.7 via aftman, the same pins as `~/Projects/roblox`; Studio through Vinegar; the
  Sober player; StudioMCP for headless playtests.
- **Server** (`ServerScriptService/Tapstone`):
  - `ArenaClient`: join, the view long-poll loop, choices and propose, with HttpService retries and backoff.
  - `TableServer`: seats the first player who reaches the table, and relays their clicks.
  - The arena URL and the join code come from a place-level setting (an attribute on a
    `ServerStorage.TapstoneConfig` object) for the prototype.
- **Client** (`StarterPlayerScripts`):
  - `BoardView` draws the view JSON as parts: a 3 × 6 board of cells, unit blocks with power and
    health billboards, two castles with life, and whose turn it is.
  - `HandUI` shows the menu as clickable tiles, labelled with `label`, useful items first.
  - The view JSON reaches clients as-is through a RemoteEvent. A client never talks HTTP.
- **Look:** it's a prototype. There's no art pipeline: parts and billboards in the realm colours (Ember
  and Tide), so it reads the same as the browser board.

## 5. Testing

- **Rust, test-first on familiar:**
  - `RemoteLink` with a remote seat finishes a match against a desk shrine.
  - The same seat left alone stalls (the control).
  - Views are numbered with no gaps or repeats.
  - A stale menu number is refused.
  - Join: a wrong code gives 403; ten wrong codes throttle their source only (429), never another
    source; a second join gives 409; a token from the previous match is refused.
  - The remote router answers 404 on `/dev/tap`, `/events` and `/`.
  - The existing fixture and every existing test stay green.
- **Roblox:**
  - A StudioMCP playtest script (`roblox/tools/playtest/remote-match.luau`) plays a whole match against
    `tapstone-arena --desk --remote ember` through a quick tunnel, choosing the first useful non-mulligan
    item, as the web gate does, until the view shows a winner.
  - Its control: the same run with proposals switched off stalls.
- **Once, by hand:** JP on Sober against a real shrine.

## 6. Out of scope for the prototype

- Two remote seats.
- Roblox against Roblox (nothing is at the table).
- Matchmaking.
- Persistence or ledger for a remote player: they play as a guest, and the shrine player's ledger records the match as usual.
- Publishing the place publicly.
- Shrine firmware changes: the code shows on the board and on stdout.

## 7. Risks

| Risk | Answer |
|---|---|
| **Roblox policy** on off-platform links and physical products | The place stays private or invite-only. Check Roblox's terms before any public release. |
| The tunnel exposes the arena | A listener of its own with `/remote/*` only; match-scoped tokens; a join lock; tests prove `/dev` is unreachable |
| Latency: HTTP adds about 100–300 ms per tap, and a long-poll per view | It's a turn-based game, and numbered views mean nothing is lost |
| HttpService limits (500 requests/min per server) | One long-poll open at a time, plus a choices call per view: well under the limit |
| Quick-tunnel URLs change every run | A setting on the place; a named tunnel later |
| Whether Studio reaches `localhost` | Not assumed: tests go through the tunnel URL |
