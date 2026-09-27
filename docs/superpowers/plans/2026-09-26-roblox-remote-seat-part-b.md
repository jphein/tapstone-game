# Roblox remote seat, Part B: the Roblox place, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a Roblox place in which the first player to sit at the table plays the arena's remote seat: it draws the arena's view and sends that player's choice from the arena's own move menu.

**Architecture:**
- **The Roblox server is the only HTTP client.** It joins with the table's code, long-polls numbered views, fetches the numbered menu, and relays moves from the seated player only.
- **Clients never talk HTTP.** They receive the arena's response bodies verbatim over RemoteEvents, then draw the board as parts and the menu as tiles.
- **Every rule the place needs lives in two pure modules** (`Protocol`, `ArenaApi`), tested under lune without Studio. The Studio-only code is statically checked with luau-lsp and proven end to end by a StudioMCP playtest, plus its stall control.

**Tech stack:** Luau (`--!strict`), Rojo 7.7.0, luau-lsp 1.69.0, lune 0.10.5 (aftman), Roblox Studio via Vinegar, StudioMCP, the Sober player, cloudflared (quick tunnel), Python 3 stdlib (the playtest driver).

**Sources:**
- Spec: `docs/superpowers/specs/2026-09-26-roblox-remote-seat-design.md`.
- Decision: `docs/decisions/0038-remote-seat.md`.
- Part A (the arena), by nebula-xr: `docs/superpowers/plans/2026-09-26-roblox-remote-seat.md`.
- **The API contract is Part A's "API contract" table.** This plan codes to it and restates only what it uses.
- Toolchain reference (read only, not modified): `~/Projects/roblox` (`aftman.toml`, `default.project.json`, `tools/playtest/{README.md,mcp_drive.py}`, `docs/PLAY-WITH-YOUR-KID.md`).

**Everything in this plan was run before it was written.**
- Every Luau file below was run under lune 0.10.5 (the pure modules and their 20 tests) or statically checked by luau-lsp 1.69.0 against Roblox's API types. `tools/typecheck.sh`, the server and client scripts, and the playtest script are all clean, and a planted error was caught.
- The staged test file goes red and then green, exactly as Tasks B2 and B3 say.
- Every perturbation below was run, and its red output is quoted.
- What was **not** run: anything that needs Studio open (Tasks B6 and B7). Those tasks are the first real run of the server, client and playtest code.

---

## Standing rules for every Part B task

- **Where things run:**
  - **Luau work and Studio run on katana.** lune, rojo and luau-lsp are not cargo, and Studio runs under Vinegar there.
  - **The arena runs on familiar**, the repo's rule for cargo. Its clone is `familiar:/var/tmp/fwork/<lane>`, with `CARGO_TARGET_DIR=/var/tmp/ftarget/<lane>`. Delete only your own named subdirs there.
- **Tools come from `roblox/aftman.toml`.** Put `~/.aftman/bin` on `PATH`.
- **Perturb every new check once, then restore it** (`docs/verification.md`). Record the red result and the restore in `scratch/roblox/part-b.md`.
  - **Wrap every lune run during a perturbation in `timeout 30`.** A perturbation that makes the client retry what it shouldn't used to loop forever (see Task B3).
  - **A perturbation is undone when the re-run is green**, not when the diff is empty.
- **Branch `feat/roblox-place`, one PR for Part B.** Stage files by name (never `git add -A`). Before pushing, send the lead "pushing #N <sha>". The lead merges.
- **The place is private.** Don't publish it publicly (spec §7: Roblox policy on off-platform links).

## Roblox facts this plan rests on (Roblox/creator-docs@0b817b5, read from source, 2026-09-26)

- **Server only.** `HttpService` "allows HTTP requests to be sent from experience servers" (`HttpService.yaml`). So `ArenaClient` lives in `ServerScriptService`, and the token never leaves the server.
- **`RequestAsync`:**
  - It "raises an error if the response times out or if the target server rejects the request", and the docs advise wrapping it in `pcall()`.
  - Its reply has `Success`, which is true "if and only if the `StatusCode` lies within the range `200`-`299`", plus `StatusCode`, `StatusMessage`, `Headers` and `Body`.
  - It "does not detect the format of body content", so JSON bodies set `Content-Type`. That matters here, because axum refuses a POST without `Content-Type: application/json` with `415`.
  - `User-Agent` and `Roblox-Id` "are locked by Roblox". `Authorization` is an ordinary header.
  - Its optional `Timeout` must be "no greater than the default request timeout". This plan never sets it. The arena holds a long-poll for 10 s, far inside any default.
- **The limit is 500 external requests per minute per server**, and "Requests over these thresholds will fail". This place keeps one long-poll open and fetches the menu once per view: about 2 requests per view.
- **Backoff for recoverable errors:** "wait for two seconds, then four, eights, etc. between attempts" (`cloud-services/http-service.md`).
- **`HttpEnabled`** "must be toggled on for **unpublished** experiences by setting this property to `true` using the Command Bar". Its write security is `LocalUserSecurity`. The place file built by Rojo carries it (`default.project.json`), and the playtest driver checks it.
- **Published places** need "Allow HTTP Requests under File ⟩ Experience Settings ⟩ Security".
- **RemoteEvents:** "avoid `nil` values for any index" in tables passed through a RemoteEvent (`scripting/events/remote.md`, "Argument limitations"). A decoded view has `nil` holes where the JSON has `null` (empty cells). So the server forwards the arena's body **as a string**, and each client decodes it with `HttpService:JSONDecode`, which works on clients; only requests are server-only.
- **StudioMCP's `execute_luau`** takes `code` and `datamodel_type` (`"Edit"`, `"Server"` or `"Client"`), after `set_active_studio`. From the palace, `roblox/references`: "realm-forge-control-panel.md".

## The contract Part B uses (from Part A's table; Part A is the authority if they ever differ)

| Call | Part B sends | Part B handles |
|---|---|---|
| `POST /remote/join` | `{"code":"K7Q2MX"}`, uppercased and trimmed (the arena compares exactly) | `200 {"token","seat"}` → keep both · `403` wrong code · `423` locked · `409` taken |
| `GET /remote/view?after=N` | `Authorization: Bearer <token>` | `200 {"n","view"}`, the **next** view above N · `204` after 10 s · `401` |
| `GET /remote/choices` | bearer | `200 {"n","menu":[{"key","label","kind","useful"}]}`; empty when it isn't seat 1's move · `401` once the match is over |
| `POST /remote/propose` | bearer, `{"n":K,"i":idx}`, where `idx` indexes the **full** menu | `202` sent · `409` stale or spent · `400` bad index · `401` |

What Part B relies on beyond the table:
- **`n` counts views for the arena process's life.** Keep the last `n` across rejoins; start at `0` once.
- **A finished match's token still reads views** until the next join, so the final board stays up.
- **The remote seat is always seat 1.**
- **Lobby views have `seats: []`.**
- **`remote_code` is a top-level key while joining is open**, and absent otherwise. It's also printed on stdout as `remote join code: XXXXXX`. The CLI deck stem is exact: `--remote ember-neutral`.

## File structure (all new, under `roblox/`)

| File | Responsibility |
|---|---|
| `roblox/aftman.toml` | Tool pins: rojo and luau-lsp as `~/Projects/roblox`, plus lune for tests |
| `roblox/default.project.json` | The place: `HttpEnabled`, the three script trees, `ServerStorage.TapstoneConfig` |
| `roblox/.gitignore` | `build/` (place file, sourcemap, fetched type definitions) |
| `roblox/README.md` | Build, test, typecheck, settings, playtest |
| `roblox/src/shared/Protocol.luau` | Pure: reading views and menus (board to draw, banner, grid slots, band text, menu order, the automatic choice, input checks, colours) |
| `roblox/src/shared/ArenaApi.luau` | Pure: the remote API with retries and backoff, over an injected transport |
| `roblox/src/server/ArenaClient.luau` | `ArenaApi` with `HttpService` plugged in |
| `roblox/src/server/TableServer.luau` | Seating (first to sit), and the only door a click comes through |
| `roblox/src/server/Stage.luau` | The floor, spawn, table and chair |
| `roblox/src/server/Main.server.luau` | The loop: join, poll, forward, menus, autoplay, status attributes |
| `roblox/src/client/BoardView.luau` | The board as parts: 18 cells, unit blocks with billboards, castles, banner |
| `roblox/src/client/HandUI.luau` | The seated player's menu as tiles; everyone's status line |
| `roblox/src/client/Main.client.luau` | Client bootstrap |
| `roblox/tests/run.luau` | lune tests for the two pure modules, against the real desk fixture |
| `roblox/tools/typecheck.sh` | luau-lsp strict analysis against pinned Roblox types |
| `roblox/tools/playtest/remote-match.luau` | Server-datamodel checks for the playtest (seat, door, autoplay on) |
| `roblox/tools/playtest/drive.py` | The StudioMCP driver: a whole match, or the stall control |

Why two pure modules, and not more:
- **`Protocol`** is shared by the server (status, autoplay) and the clients (drawing).
- **`ArenaApi`** holds every HTTP decision (status mapping, retries, headers), so none of it depends on Studio to test.
- **Neither requires anything,** so the same file loads under lune by path and in Roblox by instance.

---

### Task B1: the toolchain and the Rojo project

**Files:**
- Create: `roblox/aftman.toml`, `roblox/default.project.json`, `roblox/.gitignore`, `roblox/README.md`

- [ ] **Step 1: Pin the tools.** `roblox/aftman.toml`:

```toml
# Tools for the Tapstone Roblox place. rojo and luau-lsp are ~/Projects/roblox's pins; lune runs
# the pure modules' tests without Studio (tests/run.luau).
[tools]
rojo = "rojo-rbx/rojo@7.7.0"
luau-lsp = "JohnnyMorganz/luau-lsp@1.69.0"
lune = "lune-org/lune@0.10.5"
```

- [ ] **Step 2: Declare the place.** `roblox/default.project.json`:
  - `HttpService.HttpEnabled` is set here, so a place file built by Rojo can make requests. The Roblox docs require the command bar or Experience Settings otherwise.
  - The settings object is an empty `Configuration`. Its attributes are set per match (the tunnel URL changes every run), so Rojo must not own them.

```json
{
  "name": "TapstoneRemoteSeat",
  "tree": {
    "$className": "DataModel",
    "HttpService": {
      "$className": "HttpService",
      "$properties": {
        "HttpEnabled": true
      }
    },
    "ReplicatedStorage": {
      "$className": "ReplicatedStorage",
      "TapstoneShared": {
        "$path": "src/shared"
      }
    },
    "ServerScriptService": {
      "$className": "ServerScriptService",
      "Tapstone": {
        "$path": "src/server"
      }
    },
    "ServerStorage": {
      "$className": "ServerStorage",
      "TapstoneConfig": {
        "$className": "Configuration"
      }
    },
    "StarterPlayer": {
      "$className": "StarterPlayer",
      "StarterPlayerScripts": {
        "$className": "StarterPlayerScripts",
        "Tapstone": {
          "$path": "src/client"
        }
      }
    }
  }
}
```

- [ ] **Step 3: Ignore build output.** `roblox/.gitignore`:

```gitignore
build/
```

- [ ] **Step 4: Write the README.** `roblox/README.md`:

```markdown
# Tapstone's Roblox place: a remote seat at a real table

A Roblox player takes one seat of a Tapstone match against a real shrine (decision 0038, spec
`docs/superpowers/specs/2026-09-26-roblox-remote-seat-design.md`). The arena decides everything; this
place draws the arena's view and sends the player's choice from the arena's own move menu.

Everything runs from this directory (`roblox/`). Tools come from `aftman.toml`.

```sh
aftman trust lune-org/lune && aftman install   # once: rojo, luau-lsp, lune
lune run tests/run.luau                         # the pure modules' tests, no Studio (exit 1 on a failure)
tools/typecheck.sh                              # every script, --!strict, against Roblox's API types
rojo build default.project.json -o build/Tapstone.rbxl   # the place file (HttpEnabled on); open it in Studio
rojo serve                                      # live sync into Studio through the Rojo plugin
```

**Settings** are attributes on `ServerStorage.TapstoneConfig`: `ArenaUrl` (the tunnel, e.g.
`https://words-here.trycloudflare.com`) and `JoinCode` (the arena prints it, and the board shows it,
for each match). Set them in Studio's Properties panel, or the command bar:
`game.ServerStorage.TapstoneConfig:SetAttribute("JoinCode", "K7Q2MX")`. The server writes its status
beside them: `Seat`, `ViewN`, `Phase`, `Seq`, `Winner`, `Proposals`, `LastError`.

**Playing:** the first player to sit in the gold chair holds the remote seat. Their moves appear as
tiles along the bottom of the screen; everyone else watches.

**Headless playtest** (Studio open on the place, StudioMCP enabled; an arena and a tunnel running):
`python3 tools/playtest/drive.py match --url <tunnel> --code <code>`, and the control,
`python3 tools/playtest/drive.py stall --url <tunnel> --code <code>` on a fresh match.

Layout: `src/shared` (pure, tested under lune: `Protocol` reads views and menus, `ArenaApi` speaks the
remote API with retries), `src/server` (`Main`, `ArenaClient`, `TableServer`, `Stage`), `src/client`
(`Main`, `BoardView`, `HandUI`).
```

- [ ] **Step 5: Install the tools and build the empty place.** Rojo refuses a `$path` that doesn't exist, so create the directories first (git keeps none of them until later tasks add files):

```sh
cd roblox
export PATH=$HOME/.aftman/bin:$PATH
aftman trust lune-org/lune && aftman install
mkdir -p src/shared src/server src/client tests tools/playtest
rojo build default.project.json -o build/Tapstone.rbxl
```
Expected: `Built project to Tapstone.rbxl`, and `lune --version` prints `lune 0.10.5`.

- [ ] **Step 6: Commit.**

```sh
git add roblox/aftman.toml roblox/default.project.json roblox/.gitignore roblox/README.md
git commit -m "feat(roblox): the place's toolchain and Rojo project"
```

---

### Task B2: `Protocol`, reading views and menus (test-driven, under lune)

**Files:**
- Create: `roblox/tests/run.luau`, `roblox/src/shared/Protocol.luau`

- [ ] **Step 1: Write the tests first.** `roblox/tests/run.luau`:
  - It reads the real desk fixture (`rust/tapstone-arena/web/fixtures/desk-seed11.jsonl`, 79 views: 77 playing, 1 over, 1 lobby with `last_over`) and checks `Protocol` against the browser board's rules.
  - The "unit behind two holes" test is the control for the rule "index 1..3, never `#`". lune's decoder happens to give `#` = 3 for `[null,null,{…}]`, so the fixture test alone can't catch a `#` walk. A perturbation proved that.

```lua
--!strict
-- The pure modules' tests, run with lune (no Studio): `lune run tests/run.luau` from roblox/.
-- Exits 1 on any failure and prints the count, so the exit code is the verdict.
local fs = require("@lune/fs")
local process = require("@lune/process")
local serde = require("@lune/serde")

local Protocol = require("../src/shared/Protocol")

local FIXTURE = "../rust/tapstone-arena/web/fixtures/desk-seed11.jsonl"

local passed, failed = 0, 0
local function test(name: string, fn: () -> ())
	local ok, err = pcall(fn)
	if ok then
		passed += 1
	else
		failed += 1
		print(`FAIL {name}: {err}`)
	end
end
local function eq(a: any, b: any, what: string)
	if a ~= b then
		error(`{what}: expected {tostring(b)}, got {tostring(a)}`, 2)
	end
end

-- Real views from a real desk match (79 lines: 77 playing, 1 over, 1 lobby with last_over).
local views: { Protocol.View } = {}
local raw = fs.readFile(FIXTURE)
for line in string.gmatch(raw, "[^\n]+") do
	table.insert(views, serde.decode("json", line) :: any)
end

test("the fixture is the real one", function()
	eq(#views, 79, "views")
end)

-- The holes: every unit in the raw JSON must come out of Protocol.units, and no two may share a
-- grid slot, from either seat's side, on any of the 79 real boards.
test("units walks the null holes and never stacks two units", function()
	local lines = {}
	for line in string.gmatch(raw, "[^\n]+") do
		table.insert(lines, line)
	end
	local total = 0
	for i, v in views do
		local b = Protocol.boardOf(v)
		local inRaw = 0
		if b == v then
			for _ in string.gmatch(lines[i], '"attack":') do
				inRaw += 1
			end
		end
		for near = 0, 1 do
			local slots = {}
			local us = Protocol.units(b, near)
			for _, u in us do
				local key = `{u.col},{u.row}`
				if slots[key] then
					error(`view {i} near {near}: two units at {key}`)
				end
				slots[key] = true
				assert(u.col >= 0 and u.col <= 2 and u.row >= 0 and u.row <= 5, "slot on the board")
			end
			if b == v then
				eq(#us, inRaw, `view {i} near {near}: units vs "attack" in the JSON`)
			end
		end
		total += #Protocol.units(b, 0)
	end
	assert(total > 100, `the fixture has units to check ({total})`)
end)

-- `#` on a table with holes returns any border, and a decoder decides which: lune's happens to
-- give 3 for [null,null,{…}], so the fixture test above can't catch a `#` walk. This lane is built
-- with only key 3 set, where `#` is 0, which is what the rule "index 1..3, never #" guards.
test("a unit behind two holes is still found", function()
	local u: Protocol.Unit = {
		name = "Imp", faction = "ember", attack = 2, toughness = 1, damage = 0,
		keyword = nil, entered_round = 1, commander = false,
	}
	local lane: { Protocol.Unit? } = {}
	lane[3] = u
	eq(#lane, 0, "the control: # sees nothing in this lane")
	local v = table.clone(views[2])
	local seat = table.clone(v.seats[1])
	seat.cells = { {}, {}, lane }
	v.seats = { seat, v.seats[2] }
	local found = 0
	for _, x in Protocol.units(v, 0) do
		if x.seat == 0 and x.lane == 3 and x.cell == 3 then
			found += 1
		end
	end
	eq(found, 1, "the unit in lane 3, cell 3")
end)

test("each seat's back cell is on its own side", function()
	local c, r = Protocol.gridOf(1, 1, 1, 1)
	eq(c, 0, "lane 1 col")
	eq(r, 0, "near seat's back cell is row 0")
	c, r = Protocol.gridOf(0, 3, 1, 1)
	eq(c, 2, "lane 3 col")
	eq(r, 5, "far seat's back cell is row 5")
	local _, front = Protocol.gridOf(0, 2, 3, 1)
	eq(front, 3, "far seat's front cell meets the near front (row 2) in the middle")
end)

test("the finished board stays up in the lobby, and names the winner", function()
	local last = views[#views]
	eq(last.phase, "lobby", "last line")
	local b = Protocol.boardOf(last)
	eq(b.phase, "over", "board shown")
	local w = Protocol.winnerOf(last)
	assert(w == 0 or w == 1, "a seat won")
	eq(Protocol.banner(last), `Seat {w} wins`, "banner")
	eq(Protocol.winnerOf(views[2]), nil, "mid-match: no winner")
	eq(Protocol.banner(views[2]), nil, "mid-match: no banner")
end)

test("band text matches the browser board's", function()
	local s = views[2].seats[1]
	eq(Protocol.bandText(s, views[2].round), "Ember Castle  ♥ 20   mana 0/0   hand 0   deck 25   drawing 5", "seat 0, round 1")
end)

local MENU: { Protocol.MenuItem } = {
	{ key = "m", label = "mulligan", kind = "Mulligan", useful = true },
	{ key = "p", label = "pass", kind = "Pass", useful = false },
	{ key = "c", label = "charge Mend", kind = "Charge", useful = true },
	{ key = "u", label = "cast Imp", kind = "CastUnit", useful = true },
}

test("firstUseful skips the mulligan, as the web gate does", function()
	eq(Protocol.firstUseful(MENU), 2, "0-based index of charge")
	eq(Protocol.firstUseful({ MENU[1], MENU[2] }), nil, "only a mulligan and a useless pass")
	eq(Protocol.firstUseful({}), nil, "not our move")
end)

test("orderMenu puts useful first, keeps order and the arena's index", function()
	local o = Protocol.orderMenu(MENU)
	eq(#o, 4, "all items")
	eq(o[1].index, 0, "mulligan (useful) first")
	eq(o[2].index, 2, "then charge")
	eq(o[3].index, 3, "then cast")
	eq(o[4].index, 1, "useless pass last")
end)

test("every faction on the fixture's boards has its own colour", function()
	local seen = {}
	for _, v in views do
		for _, u in Protocol.units(Protocol.boardOf(v), 0) do
			seen[u.unit.faction] = true
		end
		for _, s in Protocol.boardOf(v).seats do
			seen[s.faction] = true
		end
	end
	local n = 0
	for f in seen do
		n += 1
		assert(Protocol.RGB[f] ~= nil, `no colour for faction {f}`)
	end
	assert(n >= 2, "ember and tide at least")
	local r, g, b = Protocol.factionRGB("nonsense")
	eq(r * 65536 + g * 256 + b, 125 * 65536 + 135 * 256 + 147, "unknown draws neutral")
end)

test("isIndex accepts only whole non-negative numbers", function()
	for _, ok in { 0, 1, 7, 2 ^ 31 - 1 } do
		eq(Protocol.isIndex(ok), true, `accepts {ok}`)
	end
	for _, bad in { -1, 1.5, 2 ^ 31, math.huge, 0 / 0, "3", true } do
		eq(Protocol.isIndex(bad), false, `refuses {tostring(bad)}`)
	end
	eq(Protocol.isIndex(nil), false, "refuses nil")
end)

print(`{passed} passed, {failed} failed`)
process.exit(if failed == 0 then 0 else 1)
```

- [ ] **Step 2: Run them and see them fail.**

```sh
cd roblox && lune run tests/run.luau; echo "exit $?"
```
Expected: `error requiring module "../src/shared/Protocol": could not resolve child component "Protocol"`, then `exit 1`.

- [ ] **Step 3: Write `Protocol`.** `roblox/src/shared/Protocol.luau`:

```lua
--!strict
-- Reading the arena's view JSON and move menu, shared by the server and the clients.
--
-- The shapes are rust/tapstone-arena/src/view.rs (`ViewModel`, `SeatView`, `UnitView`) and the
-- menu items of spec §2 (`key`, `label`, `kind`, `useful`); the reading rules copy the browser
-- board, rust/tapstone-arena/web/app.js, so both boards say the same thing. Pure: no Roblox APIs.
--
-- JSON null decodes to nil, so `cells[lane]` is a table with holes. Always index lanes 1..3 and
-- cells 1..3 explicitly; never use `#` or ipairs on them.

local Protocol = {}

Protocol.LANES = 3
Protocol.CELLS = 3 -- per seat per lane; cell 1 is the back cell, next to that seat's castle

export type Unit = {
	name: string,
	faction: string,
	attack: number,
	toughness: number,
	damage: number,
	keyword: string?,
	entered_round: number,
	commander: boolean,
}

export type Seat = {
	castle: string,
	faction: string,
	life: number,
	charged: number,
	spent: number,
	hand: number,
	deck_left: number,
	owed_draws: number,
	cells: { { Unit? } },
	commander_returns: number,
	commander_lane: number,
}

export type View = {
	phase: string,
	match_id: string?,
	round: number,
	active: number,
	seq: number,
	seats: { Seat },
	lobby: { any },
	winner: number?,
	last_over: View?,
	remote_code: string?,
}

export type MenuItem = { key: string, label: string, kind: string, useful: boolean }

-- The board to draw. After a result the arena is back in the lobby with the finished board kept
-- in `last_over`; it stays up until someone claims for the next match (app.js `draw`).
function Protocol.boardOf(v: View): View
	if v.phase == "lobby" and #v.lobby == 0 and v.last_over ~= nil then
		return v.last_over
	end
	return v
end

-- The seat that won, or nil: only a finished board has one.
function Protocol.winnerOf(v: View): number?
	local b = Protocol.boardOf(v)
	if b.phase == "over" then
		return b.winner
	end
	return nil
end

-- The one line above the board (app.js `show`), or nil when there is nothing to announce.
function Protocol.banner(v: View): string?
	local b = Protocol.boardOf(v)
	if #b.seats == 0 then
		return `Lobby: {#v.lobby} of 2 castles set on their stones`
	end
	if b.phase == "paused" then
		return "Link lost: the match is paused"
	elseif b.phase == "resuming" then
		return "The arena is back: catching up…"
	elseif b.phase == "over" then
		if b.winner ~= nil then
			return `Seat {b.winner} wins`
		end
		return "Desync: the match is void"
	end
	return nil
end

-- "♛ returns in N" for a fallen commander (app.js `returnsText`, 0029).
function Protocol.returnsText(s: Seat, round: number): string?
	if s.commander_returns == 0 then
		return nil
	end
	local n = s.commander_returns - round
	if n > 0 then
		return `♛ returns in {n}`
	elseif n == 0 then
		return "♛ returns now"
	end
	return "♛ waiting"
end

-- A seat's castle line (app.js castle band): life, mana, hand, deck, owed draws, commander.
function Protocol.bandText(s: Seat, round: number): string
	local parts = {
		`{s.castle}  ♥ {s.life}`,
		`mana {s.charged - s.spent}/{s.charged}`,
		`hand {s.hand}`,
		`deck {s.deck_left}`,
	}
	if s.owed_draws > 0 then
		table.insert(parts, `drawing {s.owed_draws}`)
	end
	local r = Protocol.returnsText(s, round)
	if r then
		table.insert(parts, r)
	end
	return table.concat(parts, "   ")
end

-- A unit's three lines: crest and name, attack / remaining health, keyword.
function Protocol.unitLines(u: Unit): (string, string, string)
	local crest = if u.commander then "♛ " else ""
	return crest .. u.name, `{u.attack} / {u.toughness - u.damage}`, u.keyword or ""
end

-- Where a cell sits on the Roblox board, seen by the player in seat `near`: row 0 is the row
-- closest to them, row 5 the farthest. Their own track runs away from them (cell 1 = their back
-- cell = row 0); the other seat's track runs toward them. Lanes keep 1..3 left to right for
-- both seats (spec §9 of the arena design), so the column is the lane.
function Protocol.gridOf(seat: number, lane: number, cell: number, near: number): (number, number)
	local row = if seat == near then cell - 1 else 6 - cell
	return lane - 1, row
end

-- Every unit on the board with its grid slot, walking the holes safely.
function Protocol.units(v: View, near: number): { { seat: number, lane: number, cell: number, col: number, row: number, unit: Unit } }
	local out = {}
	for s = 0, #v.seats - 1 do
		local seat = v.seats[s + 1]
		for lane = 1, Protocol.LANES do
			local track = seat.cells[lane]
			for cell = 1, Protocol.CELLS do
				local u = track and track[cell]
				if u then
					local col, row = Protocol.gridOf(s, lane, cell, near)
					table.insert(out, { seat = s, lane = lane, cell = cell, col = col, row = row, unit = u })
				end
			end
		end
	end
	return out
end

-- The menu as the hand shows it: useful moves first, each group in the arena's order. `index` is
-- the arena's 0-based index, the number `propose` needs.
function Protocol.orderMenu(menu: { MenuItem }): { { index: number, item: MenuItem } }
	local useful, rest = {}, {}
	for i, item in menu do
		table.insert(if item.useful then useful else rest, { index = i - 1, item = item })
	end
	table.move(rest, 1, #rest, #useful + 1, useful)
	return useful
end

-- The move an automatic player makes: the first useful item that isn't a mulligan, exactly as
-- rust/tapstone-web/gate.mjs chooses. A 0-based arena index, or nil for "nothing to do".
function Protocol.firstUseful(menu: { MenuItem }): number?
	for i, item in menu do
		if item.useful and item.kind ~= "Mulligan" then
			return i - 1
		end
	end
	return nil
end

-- True for a whole, non-negative number below 2^31: a menu number or index as a client may send
-- it. Everything from a client is checked, never trusted (a string, a fraction, NaN, inf, nil).
function Protocol.isIndex(x: any): boolean
	return type(x) == "number" and x >= 0 and x < 2 ^ 31 and x % 1 == 0
end

-- The realm colours, the browser board's dark theme (rust/tapstone-arena/web/style.css:
-- --ember, --tide, --neutral, --gold), so both boards read alike. RGB 0..255.
Protocol.RGB = {
	ember = { 224, 102, 58 },
	tide = { 58, 155, 224 },
	neutral = { 125, 135, 147 },
	gold = { 224, 165, 38 },
}

-- A faction's colour; anything unknown draws as neutral rather than failing the frame.
function Protocol.factionRGB(faction: string): (number, number, number)
	local c = Protocol.RGB[faction] or Protocol.RGB.neutral
	return c[1], c[2], c[3]
end

return Protocol
```

- [ ] **Step 4: Run the tests.**

```sh
lune run tests/run.luau; echo "exit $?"
```
Expected: `10 passed, 0 failed`, then `exit 0`.

- [ ] **Step 5: Perturb three checks, one at a time, and restore each.** Run each with `timeout 30 lune run tests/run.luau` and record the reds in `scratch/roblox/part-b.md`:

| Change in `Protocol.luau` | Expected red |
|---|---|
| `firstUseful`: `if item.useful and item.kind ~= "Mulligan" then` → `if item.useful then` | `FAIL firstUseful skips the mulligan, as the web gate does: … 0-based index of charge: expected 2, got 0` |
| `gridOf`: `else 6 - cell` → `else cell + 2` | `FAIL each seat's back cell is on its own side: … far seat's back cell is row 5: expected 5, got 3` |
| `units`: `for cell = 1, Protocol.CELLS do` → `for cell = 1, #track do` | `FAIL a unit behind two holes is still found: … the unit in lane 3, cell 3: expected 1, got 0` |

Restore each, and see `10 passed, 0 failed` again.

- [ ] **Step 6: Commit.**

```sh
git add roblox/tests/run.luau roblox/src/shared/Protocol.luau
git commit -m "feat(roblox): Protocol reads the arena's views and menus, tested under lune"
```

---

### Task B3: `ArenaApi`, the remote API with retries (test-driven, under lune)

**Files:**
- Create: `roblox/src/shared/ArenaApi.luau`
- Modify: `roblox/tests/run.luau`

- [ ] **Step 1: Add the tests first.** In `roblox/tests/run.luau`, make two edits.

(a) Directly above the line `local Protocol = require("../src/shared/Protocol")`, insert:

```lua
local ArenaApi = require("../src/shared/ArenaApi")
```

(b) Directly above the line ``print(`{passed} passed, {failed} failed`)``, insert this block:
  - The fake transport serves scripted replies and raises in order, and records every request and every sleep.
  - A request past the last step stops the client before raising. Without that, perturbing `classify` to retry every 4xx made the suite loop forever: the fake's "no more steps" error looked like a transport error, so it was retried.

```lua
test("backoff follows Roblox's 2, 4, 8 and caps", function()
	eq(ArenaApi.delay(1), 2, "1st")
	eq(ArenaApi.delay(2), 4, "2nd")
	eq(ArenaApi.delay(3), 8, "3rd")
	eq(ArenaApi.delay(4), 16, "4th")
	eq(ArenaApi.delay(5), 30, "5th (cap)")
	eq(ArenaApi.delay(40), 30, "40th (cap)")
end)

test("a raise, 408, 429 and 5xx retry; 2xx is done; other 4xx is fatal", function()
	eq(ArenaApi.classify(true, nil), "retry", "raised")
	eq(ArenaApi.classify(false, 200), "ok", "200")
	eq(ArenaApi.classify(false, 204), "ok", "204 long-poll timeout")
	eq(ArenaApi.classify(false, 202), "ok", "202 sent")
	eq(ArenaApi.classify(false, 408), "retry", "408")
	eq(ArenaApi.classify(false, 429), "retry", "429")
	eq(ArenaApi.classify(false, 502), "retry", "502 tunnel, arena down")
	eq(ArenaApi.classify(false, 530), "retry", "530 tunnel origin error")
	eq(ArenaApi.classify(false, 400), "fatal", "400")
	eq(ArenaApi.classify(false, 401), "fatal", "401")
	eq(ArenaApi.classify(false, 403), "fatal", "403")
	eq(ArenaApi.classify(false, 409), "fatal", "409")
	eq(ArenaApi.classify(false, 423), "fatal", "423")
end)

-- ---- ArenaApi against a scripted transport ------------------------------------------------
-- Each step is a reply ({ status, body }) or a raise ({ raise = "HttpError: Timedout" }), served
-- in order. Every request and every sleep is recorded, so a test can assert what was sent and
-- how long the client waited. A request past the last step stops the client before raising: the
-- client retries raises, so without the stop an unexpected retry loops forever instead of failing
-- the test (found by perturbing `classify` to retry every 4xx).
type Step = { status: number?, body: string?, raise: string? }
local function fake(steps: { Step })
	local sent: { ArenaApi.Request } = {}
	local slept: { number } = {}
	local client: ArenaApi.Client
	local deps: ArenaApi.Deps = {
		request = function(req: ArenaApi.Request): ArenaApi.Response
			table.insert(sent, req)
			local step = steps[#sent]
			if step == nil then
				client.stopped = true
				error(`fake: unexpected request #{#sent}: {req.Method} {req.Url}`)
			end
			if step.raise then
				error(step.raise)
			end
			return { StatusCode = step.status :: number, StatusMessage = "", Body = step.body or "" }
		end,
		sleep = function(sec: number)
			table.insert(slept, sec)
		end,
		encode = function(v: any): string
			return serde.encode("json", v)
		end,
		decode = function(str: string): any
			return serde.decode("json", str)
		end,
	}
	client = ArenaApi.new("https://t.example/", deps)
	return client, sent, slept
end

test("join stores the token and seat, and later calls carry the bearer", function()
	local c, sent = fake({
		{ status = 200, body = '{"token":"00ff00ff00ff00ff00ff00ff00ff00ff","seat":1}' },
		{ status = 204 },
	})
	local r, _ = ArenaApi.join(c, "K7Q2MX")
	eq(r, "joined", "result")
	eq(c.seat, 1, "seat")
	eq(sent[1].Url, "https://t.example/remote/join", "join URL (trailing / dropped)")
	eq(sent[1].Method, "POST", "join method")
	eq(sent[1].Headers["Content-Type"], "application/json", "join content type")
	eq(serde.decode("json", sent[1].Body :: string).code, "K7Q2MX", "join body")
	eq(sent[1].Headers["Authorization"], nil, "no bearer before join")
	ArenaApi.pollView(c, 0)
	eq(sent[2].Url, "https://t.example/remote/view?after=0", "view URL")
	eq(sent[2].Headers["Authorization"], "Bearer 00ff00ff00ff00ff00ff00ff00ff00ff", "bearer")
	eq(sent[2].Body, nil, "a GET has no body")
end)

test("join sends the code in capitals, as the arena compares it", function()
	local c, sent = fake({ { status = 403 } })
	ArenaApi.join(c, "  k7q2mx ")
	eq(serde.decode("json", sent[1].Body :: string).code, "K7Q2MX", "uppercased and trimmed")
end)

test("join maps 403, 423 and 409 without retrying", function()
	for status, want in { [403] = "wrong code", [423] = "locked", [409] = "seat taken" } do
		local c, sent, slept = fake({ { status = status } })
		eq(ArenaApi.join(c, "AAAAAA"), want, `HTTP {status}`)
		eq(#sent, 1, `HTTP {status}: one request`)
		eq(#slept, 0, `HTTP {status}: no wait`)
	end
end)

test("a raise and a tunnel 502 are retried after 2 s then 4 s", function()
	local c, sent, slept = fake({
		{ raise = "HttpError: Timedout" },
		{ status = 502 },
		{ status = 200, body = '{"token":"ab","seat":0}' },
	})
	local retries = {}
	c.onRetry = function(what: string, attempt: number, wait: number, reason: string)
		table.insert(retries, `{what} {attempt} {wait} {reason}`)
	end
	eq(ArenaApi.join(c, "AAAAAA"), "joined", "result")
	eq(#sent, 3, "three attempts")
	eq(#slept, 2, "two waits")
	eq(slept[1], 2, "first wait")
	eq(slept[2], 4, "second wait")
	eq(retries[2], "join 2 4 HTTP 502", "the retry is reported")
end)

test("a stopped client gives up instead of retrying", function()
	local c, sent = fake({ { status = 530 } })
	c.stopped = true
	local r = ArenaApi.pollView(c, 7)
	eq(r, "error", "result")
	eq(#sent, 1, "no retry once stopped")
end)

test("pollView returns the number and the body verbatim; 204 and 401 are their own answers", function()
	local body = views[5] and '{"n":12,"view":' .. serde.encode("json", views[5]) .. "}"
	local c = fake({ { status = 200, body = body }, { status = 204 }, { status = 401 } })
	local r, n, raw = ArenaApi.pollView(c, 11)
	eq(r, "view", "result")
	eq(n, 12, "number")
	eq(raw, body, "the body goes to clients untouched")
	local r2, n2 = ArenaApi.pollView(c, 12)
	eq(r2, "none", "204")
	eq(n2, 12, "the number stays on 204")
	eq((ArenaApi.pollView(c, 12)), "unauthorized", "401")
end)

test("propose sends {n,i}: 202 sent, 409 stale, 400 bad index, never retried", function()
	local c, sent, slept = fake({ { status = 202 }, { status = 409 }, { status = 400 } })
	eq(ArenaApi.propose(c, 5, 3), "sent", "202")
	local b = serde.decode("json", sent[1].Body :: string)
	eq(b.n, 5, "menu number")
	eq(b.i, 3, "index")
	eq(ArenaApi.propose(c, 5, 3), "stale", "409")
	eq(ArenaApi.propose(c, 6, 99), "bad index", "400")
	eq(#sent, 3, "one request each")
	eq(#slept, 0, "no waits")
end)

test("choices returns the menu number and body; a bad body is nothing", function()
	local c = fake({ { status = 200, body = '{"n":4,"menu":[]}' }, { status = 200, body = "not json" } })
	local n, raw = ArenaApi.choices(c)
	eq(n, 4, "number")
	eq(raw, '{"n":4,"menu":[]}', "body")
	local n2, raw2 = ArenaApi.choices(c)
	eq(n2, nil, "bad JSON")
	eq(raw2, "", "no body")
end)
```

- [ ] **Step 2: Run them and see them fail.**

```sh
lune run tests/run.luau; echo "exit $?"
```
Expected: `error requiring module "../src/shared/ArenaApi": could not resolve child component "ArenaApi"`, then `exit 1`.

- [ ] **Step 3: Write `ArenaApi`.** `roblox/src/shared/ArenaApi.luau`:

```lua
--!strict
-- The arena's remote API (spec §2, listener :7791 behind a tunnel): requests, replies and
-- retries. Pure: the transport, the sleep and the JSON codec are passed in, so tests/run.luau
-- drives it with a scripted fake under lune, and src/server/ArenaClient.luau plugs in HttpService.
--
-- Every call goes through `send`, which retries what can recover (`classify`) with Roblox's
-- 2 s, 4 s, 8 s backoff and hands the caller everything else. Nothing retries a 4xx: a wrong code,
-- a stale menu or a spent token is an answer, not an outage.
--
-- The contract is Part A's "API contract" table (docs/superpowers/plans/2026-09-26-roblox-remote-seat.md).
-- Roblox's rules this follows (creator-docs@0b817b5, HttpService.yaml):
--   RequestAsync "raises an error if the response times out or if the target server rejects the
--   request": `once` wraps it in pcall. Success is true "if and only if the StatusCode lies within
--   200-299". RequestAsync "does not detect the format of body content": JSON bodies set
--   Content-Type. External requests are limited to 500 per minute per server: one long-poll open
--   at a time (the arena holds it up to 10 s) plus one menu fetch per view stays far below.

export type Request = { Url: string, Method: string, Headers: { [string]: string }, Body: string? }
export type Response = { StatusCode: number, StatusMessage: string, Body: string }
export type Deps = {
	request: (Request) -> Response, -- may raise, like RequestAsync
	sleep: (number) -> (),
	encode: (any) -> string,
	decode: (string) -> any, -- may raise on bad JSON
}
export type Reply = { threw: boolean, status: number, body: string, err: string }
export type Client = {
	url: string,
	deps: Deps,
	token: string?,
	seat: number?,
	stopped: boolean,
	onRetry: ((what: string, attempt: number, wait: number, reason: string) -> ())?,
}

local ArenaApi = {}

-- ---- Backoff: when to retry, and how long to wait first -----------------------------------

ArenaApi.BASE = 2 -- seconds before the first retry ("wait for two seconds, then four, eights")
ArenaApi.CAP = 30 -- no single wait longer than this: a tunnel that comes back is used within 30 s

export type Outcome = "ok" | "retry" | "fatal"

-- The wait before retry number `attempt` (1-based): 2, 4, 8, 16, then 30, 30, …
function ArenaApi.delay(attempt: number): number
	return math.min(ArenaApi.CAP, ArenaApi.BASE * 2 ^ (math.max(1, attempt) - 1))
end

-- `threw`: RequestAsync raised (a timeout, a refused connection, DNS, TLS). 200-299 is done.
-- 408, 429 and every 5xx are worth retrying: cloudflared answers 502/530 while the arena is down
-- or restarting. Any other 4xx means this request is wrong as sent, so the caller decides.
function ArenaApi.classify(threw: boolean, status: number?): Outcome
	if threw or status == nil then
		return "retry"
	end
	if status >= 200 and status <= 299 then
		return "ok"
	end
	if status == 408 or status == 429 or status >= 500 then
		return "retry"
	end
	return "fatal"
end

-- ---- Requests ----------------------------------------------------------------------------

-- `url` is the tunnel's base, e.g. "https://words-here.trycloudflare.com"; a trailing / is dropped.
function ArenaApi.new(url: string, deps: Deps): Client
	return {
		url = (string.gsub(url, "/+$", "")),
		deps = deps,
		token = nil,
		seat = nil,
		stopped = false,
		onRetry = nil,
	}
end

local function once(c: Client, method: string, path: string, body: string?): Reply
	local headers: { [string]: string } = {}
	if body ~= nil then
		headers["Content-Type"] = "application/json"
	end
	if c.token ~= nil then
		headers["Authorization"] = "Bearer " .. c.token
	end
	local ok, res = pcall(c.deps.request, { Url = c.url .. path, Method = method, Headers = headers, Body = body })
	if not ok then
		return { threw = true, status = 0, body = "", err = tostring(res) }
	end
	return { threw = false, status = res.StatusCode, body = res.Body, err = res.StatusMessage }
end

-- A retried propose can't play a move twice: the first delivery spends the menu number in its
-- body, so a duplicate is answered 409 (stale).
function ArenaApi.send(c: Client, what: string, method: string, path: string, body: string?): Reply
	local attempt = 0
	while true do
		local r = once(c, method, path, body)
		local outcome = ArenaApi.classify(r.threw, if r.threw then nil else r.status)
		if outcome ~= "retry" or c.stopped then
			return r
		end
		attempt += 1
		local wait = ArenaApi.delay(attempt)
		if c.onRetry then
			c.onRetry(what, attempt, wait, if r.threw then r.err else `HTTP {r.status}`)
		end
		c.deps.sleep(wait)
	end
end

local function decodeTable(c: Client, body: string): { [string]: any }?
	local ok, msg = pcall(c.deps.decode, body)
	if ok and type(msg) == "table" then
		return msg
	end
	return nil
end

export type JoinResult = "joined" | "wrong code" | "locked" | "seat taken" | "error"

-- POST /remote/join {"code"} → 200 {"token","seat"} | 403 wrong code | 423 locked | 409 taken.
-- The arena compares the code exactly, in capitals (Part A's contract), so a code typed in lower
-- case is sent upper case; spaces around it are dropped.
function ArenaApi.join(c: Client, code: string): (JoinResult, string)
	local clean = string.upper((string.gsub(code, "^%s*(.-)%s*$", "%1")))
	local r = ArenaApi.send(c, "join", "POST", "/remote/join", c.deps.encode({ code = clean }))
	if r.status == 200 then
		local msg = decodeTable(c, r.body)
		if msg and type(msg.token) == "string" and type(msg.seat) == "number" then
			c.token = msg.token
			c.seat = msg.seat
			return "joined", `seat {msg.seat}`
		end
		return "error", "join: the reply wasn't {token, seat}"
	elseif r.status == 403 then
		return "wrong code", "the join code was refused"
	elseif r.status == 423 then
		return "locked", "joining is locked for this match (10 wrong codes)"
	elseif r.status == 409 then
		return "seat taken", "the remote seat is already joined"
	end
	return "error", if r.threw then `join: {r.err}` else `join: HTTP {r.status} {r.err}`
end

export type PollResult = "view" | "none" | "unauthorized" | "error"

-- GET /remote/view?after=N → 200 {"n","view"}, the NEXT view above N (not the latest) | 204
-- nothing within 10 s | 401 token refused. `n` counts views for the arena process's whole life
-- (Part A's contract): keep the last one across matches and rejoins, never reset it to 0. A
-- finished match's token may still read views until the next join, so the final board shows.
-- Returns the result, the number to poll after next, and the raw body (verbatim: it goes to
-- clients as-is) or, on "error", the reason.
function ArenaApi.pollView(c: Client, after: number): (PollResult, number, string)
	local r = ArenaApi.send(c, "view", "GET", `/remote/view?after={after}`, nil)
	if r.status == 200 then
		local msg = decodeTable(c, r.body)
		if msg and type(msg.n) == "number" and type(msg.view) == "table" then
			return "view", msg.n, r.body
		end
		return "error", after, "view: the reply wasn't {n, view}"
	elseif r.status == 204 then
		return "none", after, ""
	elseif r.status == 401 then
		return "unauthorized", after, ""
	end
	return "error", after, if r.threw then `view: {r.err}` else `view: HTTP {r.status} {r.err}`
end

-- GET /remote/choices → 200 {"n","menu"}: the menu number and the raw body, or nil and "". The
-- menu is empty when it isn't this seat's move or a tap is pending; a finished match's token gets
-- 401 here at once.
function ArenaApi.choices(c: Client): (number?, string)
	local r = ArenaApi.send(c, "choices", "GET", "/remote/choices", nil)
	if r.status == 200 then
		local msg = decodeTable(c, r.body)
		if msg and type(msg.n) == "number" and type(msg.menu) == "table" then
			return msg.n, r.body
		end
	end
	return nil, ""
end

export type ProposeResult = "sent" | "stale" | "bad index" | "unauthorized" | "error"

-- POST /remote/propose {"n","i"} → 202 sent | 409 stale or spent menu | 400 bad index | 401.
-- `i` indexes the FULL menu as returned (Protocol.orderMenu keeps that index).
function ArenaApi.propose(c: Client, n: number, i: number): ProposeResult
	local r = ArenaApi.send(c, "propose", "POST", "/remote/propose", c.deps.encode({ n = n, i = i }))
	if r.status == 202 then
		return "sent"
	elseif r.status == 409 then
		return "stale"
	elseif r.status == 400 then
		return "bad index"
	elseif r.status == 401 then
		return "unauthorized"
	end
	return "error"
end

return ArenaApi
```

- [ ] **Step 4: Run the tests.**

```sh
lune run tests/run.luau; echo "exit $?"
```
Expected: `20 passed, 0 failed`, then `exit 0`.

- [ ] **Step 5: Perturb four checks, one at a time, with `timeout 30`, and restore each.**

| Change in `ArenaApi.luau` | Expected red |
|---|---|
| `classify`: `if status == 408 or status == 429 or status >= 500 then` → `if status >= 400 then` | 4 FAILs within a second, among them `a raise, 408, 429 and 5xx retry; … 400: expected fatal, got retry` and `join maps 403, 423 and 409 without retrying` (it doesn't hang: the fake stops the client) |
| `once`: `headers["Authorization"] = "Bearer " .. c.token` → `headers["X-Token"] = c.token` | `FAIL join stores the token and seat, and later calls carry the bearer: … bearer: expected Bearer 00ff…` |
| `delay`: the `math.min(…)` line → `return ArenaApi.BASE` | `FAIL backoff follows Roblox's 2, 4, 8 and caps: … 2nd: expected 4, got 2`, and `FAIL a raise and a tunnel 502 are retried after 2 s then 4 s: … second wait: expected 4, got 2` |
| `join`: the `local clean = …` line → `local clean = code` | `FAIL join sends the code in capitals, as the arena compares it: … uppercased and trimmed` |

Restore each, and see `20 passed, 0 failed` again.

- [ ] **Step 6: Commit.**

```sh
git add roblox/tests/run.luau roblox/src/shared/ArenaApi.luau
git commit -m "feat(roblox): ArenaApi speaks the remote API with Roblox's backoff, tested under lune"
```

---

### Task B4: the server (`Stage`, `TableServer`, `ArenaClient`, `Main`), statically checked

The server needs Studio to run. What can be checked without it is checked here: every script type-checks in `--!strict` against Roblox's API types, and a planted error proves the checker sees. The first run is Task B6's playtest.

**Files:**
- Create: `roblox/tools/typecheck.sh`, `roblox/src/server/Stage.luau`, `roblox/src/server/TableServer.luau`, `roblox/src/server/ArenaClient.luau`, `roblox/src/server/Main.server.luau`

- [ ] **Step 1: Write the checker.** `roblox/tools/typecheck.sh`:
  - The types are luau-lsp's `globalTypes.None.d.luau`, pinned to a commit and a sha256. They're fetched into `build/` and re-fetched if the file doesn't match.

```bash
#!/usr/bin/env bash
# Static check of every script in --!strict against Roblox's API types, without Studio.
# Types: luau-lsp's globalTypes.None.d.luau pinned to a commit and a sha256, fetched into build/.
set -euo pipefail
cd "$(dirname "$0")/.."
DEFS_SHA=578437db0819644efd1cb97ab64551c12fabc192
DEFS_SUM=9ad75109b8dc9197f6d1726208bfa0b12de47c3a43672a4fa43227f0cec609ee
DEFS=build/globalTypes.None.d.luau
mkdir -p build
if ! echo "$DEFS_SUM  $DEFS" | sha256sum --check --status >/dev/null 2>&1; then
  curl -fsSL -o "$DEFS" "https://raw.githubusercontent.com/JohnnyMorganz/luau-lsp/$DEFS_SHA/scripts/globalTypes.None.d.luau"
  echo "$DEFS_SUM  $DEFS" | sha256sum --check --quiet
fi
rojo sourcemap default.project.json -o build/sourcemap.json
# The playtest script is checked too, once it exists (Task B6 adds it).
FILES=(src)
[ -f tools/playtest/remote-match.luau ] && FILES+=(tools/playtest/remote-match.luau)
luau-lsp analyze --platform=roblox --definitions="$DEFS" --sourcemap=build/sourcemap.json "${FILES[@]}"
```

Then `chmod +x roblox/tools/typecheck.sh`.

- [ ] **Step 2: Write the stage.** `roblox/src/server/Stage.luau`:

```lua
--!strict
-- The physical scene: a floor, a spawn, the table and the one chair. The board itself is drawn by
-- each client on top of `TapstoneTable.Top` (BoardView), so the server only builds what everyone
-- shares and what the chair needs.
--
-- Geometry, in studs, from the table top's centre: the board runs along Z, the remote seat's chair
-- is on the +Z side facing -Z, so the player looks down the board with lane 1 on their left (-X).

local Stage = {}

Stage.TOP_SIZE = Vector3.new(18, 1, 34)
Stage.TOP_POSITION = Vector3.new(0, 3.5, 0)
Stage.CHAIR_POSITION = Vector3.new(0, 1.5, 21)

local function part(props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for k, v in props do
		(p :: any)[k] = v
	end
	return p
end

-- Builds workspace.TapstoneTable once and returns its chair.
function Stage.build(): Seat
	local existing = workspace:FindFirstChild("TapstoneTable")
	if existing then
		existing:Destroy()
	end
	local model = Instance.new("Model")
	model.Name = "TapstoneTable"

	part({
		Name = "Floor",
		Size = Vector3.new(240, 1, 240),
		Position = Vector3.new(0, -0.5, 0),
		Color = Color3.fromRGB(46, 52, 64),
		Material = Enum.Material.Slate,
	}).Parent = model

	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "Spawn"
	spawn.Anchored = true
	spawn.Size = Vector3.new(8, 1, 8)
	spawn.Position = Vector3.new(0, 0.5, 44)
	spawn.Neutral = true
	spawn.Parent = model

	part({
		Name = "Top",
		Size = Stage.TOP_SIZE,
		Position = Stage.TOP_POSITION,
		Color = Color3.fromRGB(94, 67, 44),
		Material = Enum.Material.Wood,
	}).Parent = model

	for _, x in { -7, 7 } do
		for _, z in { -14, 14 } do
			part({
				Name = "Leg",
				Size = Vector3.new(1.5, 3, 1.5),
				Position = Vector3.new(x, 1.5, z),
				Color = Color3.fromRGB(70, 50, 33),
				Material = Enum.Material.Wood,
			}).Parent = model
		end
	end

	local chair = Instance.new("Seat")
	chair.Name = "Chair"
	chair.Anchored = true
	chair.Size = Vector3.new(4, 1, 4)
	chair.CFrame = CFrame.lookAt(Stage.CHAIR_POSITION, Stage.CHAIR_POSITION + Vector3.new(0, 0, -1))
	chair.Color = Color3.fromRGB(224, 165, 38)
	chair.Parent = model

	model.PrimaryPart = model:FindFirstChild("Top") :: BasePart
	model.Parent = workspace
	return chair
end

return Stage
```

- [ ] **Step 3: Write the table's door.** `roblox/src/server/TableServer.luau`:

```lua
--!strict
-- Who plays the remote seat, and the only door a click comes through.
--
-- The first player to sit in the chair becomes the remote seat's player for the rest of the
-- server's life, or until they leave the game. Standing up doesn't give the seat away: another
-- player sitting down later is only a spectator. A click (`Choose`) is relayed to the arena only if
-- it comes from that player; everyone else is refused here, before any HTTP.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Protocol = require(ReplicatedStorage:WaitForChild("TapstoneShared"):WaitForChild("Protocol"))

export type Proposer = (n: number, i: number) -> string

local TableServer = {}

local seated: Player? = nil
local proposer: Proposer? = nil
local onSeated: ((Player) -> ())? = nil
local remotes: Folder? = nil

local function setSeated(p: Player?)
	seated = p
	if remotes then
		remotes:SetAttribute("SeatedName", if p then p.Name else "")
	end
	if p and onSeated then
		onSeated(p)
	end
end

-- `chair` is Stage's Seat, `folder` the TapstoneRemotes folder (its Choose event is wired here),
-- `propose` sends a menu choice to the arena, `seatedHook` runs when the player is first seated.
function TableServer.init(chair: Seat, folder: Folder, propose: Proposer, seatedHook: (Player) -> ())
	remotes = folder
	proposer = propose
	onSeated = seatedHook
	folder:SetAttribute("SeatedName", "")

	chair:GetPropertyChangedSignal("Occupant"):Connect(function()
		local hum = chair.Occupant
		if hum == nil or seated ~= nil then
			return
		end
		local p = Players:GetPlayerFromCharacter(hum.Parent)
		if p then
			setSeated(p)
		end
	end)

	Players.PlayerRemoving:Connect(function(p)
		if p == seated then
			setSeated(nil)
		end
	end)

	local choose = folder:WaitForChild("Choose") :: RemoteEvent
	choose.OnServerEvent:Connect(function(p: Player, n: any, i: any)
		TableServer.relay(p, n, i)
	end)
end

function TableServer.seated(): Player?
	return seated
end

-- A click, from anyone: sent only if `p` is the seated player and both numbers are whole and
-- non-negative. Returns (sent?, why). Values arrive from a client, so they are checked, not trusted.
function TableServer.relay(p: Player?, n: any, i: any): (boolean, string)
	if p == nil or p ~= seated then
		return false, "not the seated player"
	end
	if not Protocol.isIndex(n) or not Protocol.isIndex(i) then
		return false, "bad menu number or index"
	end
	if proposer == nil then
		return false, "no arena"
	end
	local r = proposer(n, i)
	return r == "sent", r
end

return TableServer
```

- [ ] **Step 4: Plug in HttpService.** `roblox/src/server/ArenaClient.luau`:

```lua
--!strict
-- ArenaApi with Roblox's transport plugged in. The server is the only HTTP client: HttpService
-- sends requests "from experience servers" (HttpService.yaml), and the token must never reach a
-- player, so this module lives in ServerScriptService and nothing replicates the client object.

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ArenaApi = require(ReplicatedStorage:WaitForChild("TapstoneShared"):WaitForChild("ArenaApi"))

export type Client = ArenaApi.Client

local deps: ArenaApi.Deps = {
	request = function(req: ArenaApi.Request): ArenaApi.Response
		local res = HttpService:RequestAsync(req :: any)
		return { StatusCode = res.StatusCode, StatusMessage = res.StatusMessage, Body = res.Body }
	end,
	sleep = function(sec: number)
		task.wait(sec)
	end,
	encode = function(v: any): string
		return HttpService:JSONEncode(v)
	end,
	decode = function(s: string): any
		return HttpService:JSONDecode(s)
	end,
}

local ArenaClient = {}

function ArenaClient.new(url: string): Client
	return ArenaApi.new(url, deps)
end

ArenaClient.join = ArenaApi.join
ArenaClient.pollView = ArenaApi.pollView
ArenaClient.choices = ArenaApi.choices
ArenaClient.propose = ArenaApi.propose

return ArenaClient
```

- [ ] **Step 5: Write the loop.** `roblox/src/server/Main.server.luau`:

```lua
--!strict
-- The Tapstone remote seat, server side: build the table, join the arena, poll its views, relay
-- the seated player's moves. Settings and status live as attributes on ServerStorage.TapstoneConfig:
--
--   set by the operator     ArenaUrl  (string) the tunnel, e.g. https://words-here.trycloudflare.com
--                           JoinCode  (string) the 6 characters the arena printed for this match
--                           AutoPlay  (string) "off" (default) | "first-useful" (the playtest)
--                           Propose   (bool)   default true; false = relay nothing (the stall control)
--   written by this script  Seat, ViewN, Phase, Seq, Winner (-1 none), Proposals, LastError
--
-- A client never talks HTTP: it gets the arena's bodies verbatim over RemoteEvents (a decoded view
-- has nil holes, which a RemoteEvent may drop: "avoid nil values for any index", Roblox remote.md).

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local Protocol = require(ReplicatedStorage:WaitForChild("TapstoneShared"):WaitForChild("Protocol"))
local ArenaClient = require(script.Parent.ArenaClient)
local Stage = require(script.Parent.Stage)
local TableServer = require(script.Parent.TableServer)

local config = ServerStorage:WaitForChild("TapstoneConfig") :: Configuration

local function attr(name: string, default: any): any
	local v = config:GetAttribute(name)
	if v == nil then
		return default
	end
	return v
end

local STATUS: { [string]: number | string } = {
	Seat = -1,
	ViewN = 0,
	Phase = "",
	Seq = 0,
	Winner = -1,
	Proposals = 0,
	LastError = "",
}
for name, value in STATUS do
	config:SetAttribute(name, value)
end

-- Remotes, created here so the place file needs nothing but the scripts.
local remotes = Instance.new("Folder")
remotes.Name = "TapstoneRemotes"
local viewEvent = Instance.new("RemoteEvent")
viewEvent.Name = "View" -- server → all clients: the raw /remote/view body
viewEvent.Parent = remotes
local menuEvent = Instance.new("RemoteEvent")
menuEvent.Name = "Menu" -- server → the seated player: the raw /remote/choices body
menuEvent.Parent = remotes
local chooseEvent = Instance.new("RemoteEvent")
chooseEvent.Name = "Choose" -- seated player → server: (menu n, 0-based index)
chooseEvent.Parent = remotes
local getView = Instance.new("RemoteFunction")
getView.Name = "GetView" -- a client that starts late asks for the last view body
getView.Parent = remotes
remotes:SetAttribute("Seat", -1)
remotes:SetAttribute("Message", "")
remotes.Parent = ReplicatedStorage

local client: ArenaClient.Client? = nil
local lastView = ""
local menuN: number? = nil
local menuBody = ""

getView.OnServerInvoke = function(_p: Player): string
	return lastView
end

local function say(message: string)
	remotes:SetAttribute("Message", message)
	if message ~= "" then
		print(`[Tapstone] {message}`)
	end
end

local function fail(message: string)
	config:SetAttribute("LastError", message)
	say(message)
end

local function propose(n: number, i: number): string
	local c = client
	if c == nil then
		return "no arena"
	end
	if attr("Propose", true) == false then
		return "proposals are off"
	end
	local r = ArenaClient.propose(c, n, i)
	if r == "sent" then
		config:SetAttribute("Proposals", attr("Proposals", 0) + 1)
	end
	return r
end

-- The automatic player (AutoPlay = "first-useful"): the web gate's choice, through the same relay
-- a click uses, so the playtest exercises seating and the relay too.
local function autoplay()
	local p = TableServer.seated()
	if attr("AutoPlay", "off") ~= "first-useful" or p == nil or menuN == nil or menuBody == "" then
		return
	end
	local ok, msg = pcall(HttpService.JSONDecode, HttpService, menuBody)
	if not ok or type(msg) ~= "table" or type(msg.menu) ~= "table" then
		return
	end
	local i = Protocol.firstUseful(msg.menu)
	if i ~= nil then
		TableServer.relay(p, menuN, i)
	end
end

-- Fetch the menu (once per new view) and hand it to the seated player.
local function publishMenu()
	local c = client
	if c == nil then
		return
	end
	local n, body = ArenaClient.choices(c)
	menuN, menuBody = n, body
	local p = TableServer.seated()
	if p and body ~= "" then
		menuEvent:FireClient(p, body)
	end
	autoplay()
end

-- Switching autoplay on must act on the menu already held: when it's this seat's move no new view
-- arrives until it moves, so waiting for the next view would stall the very run it starts.
config:GetAttributeChangedSignal("AutoPlay"):Connect(autoplay)

local chair = Stage.build()
TableServer.init(chair, remotes, function(n: number, i: number): string
	local r = propose(n, i)
	if r == "stale" then
		publishMenu() -- the menu moved on: show the player the current one
	end
	return r
end, function(p: Player)
	say(`{p.Name} takes the remote seat`)
	if menuBody ~= "" then
		menuEvent:FireClient(p, menuBody)
	end
	autoplay()
end)

local function onView(body: string)
	lastView = body
	local ok, msg = pcall(HttpService.JSONDecode, HttpService, body)
	if ok and type(msg) == "table" and type(msg.view) == "table" then
		local v: Protocol.View = msg.view
		local b = Protocol.boardOf(v)
		config:SetAttribute("Phase", b.phase)
		config:SetAttribute("Seq", b.seq or 0)
		config:SetAttribute("Winner", Protocol.winnerOf(v) or -1)
	end
	viewEvent:FireAllClients(body)
	publishMenu()
end

-- Waits until the operator changes ArenaUrl or JoinCode.
local function waitForSettingsChange()
	local changed = Instance.new("BindableEvent")
	local a = config:GetAttributeChangedSignal("ArenaUrl"):Connect(function()
		changed:Fire()
	end)
	local b = config:GetAttributeChangedSignal("JoinCode"):Connect(function()
		changed:Fire()
	end)
	changed.Event:Wait()
	a:Disconnect()
	b:Disconnect()
	changed:Destroy()
end

-- The loop. `n` lives outside it: the arena numbers views for its whole life, so a rejoin for the
-- next match carries on from the last view seen instead of replaying the old match (and its
-- winner). A finished match's token still reads views until the next join, so the final board
-- stays up; the operator starts the next match by setting its JoinCode, and the loop rejoins.
local function run()
	local n = 0
	while true do
		local url: string = attr("ArenaUrl", "")
		local code: string = attr("JoinCode", "")
		if url == "" or code == "" then
			say("Set ArenaUrl and JoinCode on ServerStorage.TapstoneConfig")
			waitForSettingsChange()
			continue
		end
		local c = ArenaClient.new(url)
		c.onRetry = function(what: string, attempt: number, wait: number, reason: string)
			fail(`{what}: {reason}; retry {attempt} in {wait} s`)
		end
		client = c
		local result, message = ArenaClient.join(c, code)
		if result ~= "joined" then
			fail(message)
			waitForSettingsChange()
			continue
		end
		config:SetAttribute("Seat", c.seat)
		remotes:SetAttribute("Seat", c.seat)
		config:SetAttribute("LastError", "")
		say(`joined the arena as seat {c.seat}`)
		local refused = false
		while attr("JoinCode", "") == code and attr("ArenaUrl", "") == url do
			local r, newN, body = ArenaClient.pollView(c, n)
			if r == "view" then
				n = newN
				config:SetAttribute("ViewN", n)
				onView(body)
			elseif r == "unauthorized" then
				fail("the arena refused the token (a newer match was joined): set this match's JoinCode")
				refused = true
				break
			elseif r == "error" then
				fail(body)
				task.wait(2)
			end
		end
		c.stopped = true
		client = nil
		if refused then
			waitForSettingsChange()
		end
	end
end

task.spawn(run)
print("[Tapstone] remote seat server ready")
```

- [ ] **Step 6: Type-check.**

```sh
cd roblox && tools/typecheck.sh 2>&1 | grep -v "INFO\|WARN"; echo "exit ${PIPESTATUS[0]}"
```
Expected: `Created sourcemap at build/sourcemap.json` and `exit 0`, with no `TypeError` lines.
- The first draft of this plan had 9 errors, all attributes read as `string` or `number` when `GetAttribute` returns `unknown`. The code above reads each attribute through a type check.

- [ ] **Step 7: Perturb the checker, then restore.** In `TableServer.relay`, change `return r == "sent", r` to `return r == "sent", 42`, and run Step 6 again. Expected: 2 `TypeError` lines and a non-zero exit. Restore it, and see `exit 0` again.

- [ ] **Step 8: Commit.**

```sh
git add roblox/tools/typecheck.sh roblox/src/server/Stage.luau roblox/src/server/TableServer.luau roblox/src/server/ArenaClient.luau roblox/src/server/Main.server.luau
git commit -m "feat(roblox): the server joins, polls, forwards and relays the seated player's moves"
```

---

### Task B5: the client (`BoardView`, `HandUI`, `Main`), statically checked

**Files:**
- Create: `roblox/src/client/BoardView.luau`, `roblox/src/client/HandUI.luau`, `roblox/src/client/Main.client.luau`

- [ ] **Step 1: Draw the board.** `roblox/src/client/BoardView.luau`:
  - Seat 1, the remote seat, is drawn nearest the chair.
  - Each unit shows its crest and name, attack / remaining health, and keyword, on a billboard (spec §4).
  - A commander is taller and neon, which is the crest as a shape.
  - The active castle glows.

```lua
--!strict
-- The arena's board, drawn as parts on the table (spec §4): 3 lanes × 6 cells, a block per unit
-- with a billboard (crest and name, attack / health, keyword), both castles with their line of
-- state, and a banner saying whose turn it is. Client-local: every player draws their own copy
-- from the same view bodies, so nothing here replicates or holds game state.
--
-- The remote seat is drawn nearest the chair (Protocol.gridOf with near = that seat), which is
-- 0027's "your side is the side you sit on".

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Protocol = require(ReplicatedStorage:WaitForChild("TapstoneShared"):WaitForChild("Protocol"))

local BoardView = {}

local CELL = 4.4 -- studs between cell centres across a lane and along it
local GAP = 1.2 -- the gutter between the two seats' tracks: the front line
local UNIT = Vector3.new(3.4, 2, 3.4)
local COMMANDER = Vector3.new(3.4, 3.2, 3.4)
local INK = Color3.fromRGB(240, 236, 226)
local SHADOW = Color3.fromRGB(16, 20, 26)

local function rgb(faction: string): Color3
	local r, g, b = Protocol.factionRGB(faction)
	return Color3.fromRGB(r, g, b)
end

-- A cell's centre on the table top, in the top's space: +Z is the chair's side.
local function cellOffset(col: number, row: number): Vector3
	local x = (col - 1) * CELL
	local z = (2.5 - row) * CELL + (if row >= 3 then -GAP / 2 else GAP / 2)
	return Vector3.new(x, 0, z)
end

local function billboard(parent: BasePart, height: number, width: number, text: string, name: string): TextLabel
	local gui = Instance.new("BillboardGui")
	gui.Name = name
	gui.Size = UDim2.fromOffset(width, 64)
	gui.StudsOffset = Vector3.new(0, height, 0)
	gui.MaxDistance = 120
	gui.Parent = parent
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundColor3 = SHADOW
	label.BackgroundTransparency = 0.25
	label.TextColor3 = INK
	label.TextStrokeTransparency = 0.4
	label.TextScaled = true
	label.Font = Enum.Font.GothamMedium
	label.Text = text
	label.Parent = gui
	local limit = Instance.new("UITextSizeConstraint")
	limit.MinTextSize = 12
	limit.MaxTextSize = 22
	limit.Parent = label
	return label
end

local root: Folder
local unitsFolder: Folder
local top: BasePart
local castles: { near: Part, far: Part }
local castleLabels: { near: TextLabel, far: TextLabel }
local bannerLabel: TextLabel

local function block(name: string, size: Vector3, offset: Vector3, color: Color3, parent: Instance): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Anchored = true
	p.CanCollide = false
	p.CanTouch = false
	p.CanQuery = false
	p.Size = size
	p.Color = color
	p.Material = Enum.Material.SmoothPlastic
	p.CFrame = top.CFrame * CFrame.new(offset + Vector3.new(0, top.Size.Y / 2 + size.Y / 2, 0))
	p.Parent = parent
	return p
end

-- Builds the static board once: the 18 cells, the castles and the banner.
function BoardView.create()
	top = workspace:WaitForChild("TapstoneTable"):WaitForChild("Top") :: BasePart
	root = Instance.new("Folder")
	root.Name = "TapstoneBoard"
	root.Parent = workspace
	unitsFolder = Instance.new("Folder")
	unitsFolder.Name = "Units"
	unitsFolder.Parent = root

	for col = 0, 2 do
		for row = 0, 5 do
			local tile = block(`Cell{col}{row}`, Vector3.new(CELL - 0.4, 0.2, CELL - 0.4), cellOffset(col, row), Color3.fromRGB(60, 68, 82), root)
			tile.Material = Enum.Material.Slate
		end
	end
	local nearZ = cellOffset(1, 0).Z + CELL
	local farZ = cellOffset(1, 5).Z - CELL
	castles = {
		near = block("CastleNear", Vector3.new(12, 2.4, 2.4), Vector3.new(0, 0, nearZ), rgb("neutral"), root),
		far = block("CastleFar", Vector3.new(12, 2.4, 2.4), Vector3.new(0, 0, farZ), rgb("neutral"), root),
	}
	castleLabels = {
		near = billboard(castles.near, 2.6, 420, "", "Band"),
		far = billboard(castles.far, 2.6, 420, "", "Band"),
	}
	local mast = block("Banner", Vector3.new(0.4, 0.4, 0.4), Vector3.new(0, 7, farZ - 2), rgb("gold"), root)
	mast.Transparency = 1
	bannerLabel = billboard(mast, 0, 520, "Waiting for the arena…", "Banner")
end

local function drawUnit(u: Protocol.Unit, col: number, row: number)
	local size = if u.commander then COMMANDER else UNIT
	local p = block(u.name, size, cellOffset(col, row) + Vector3.new(0, 0.2, 0), rgb(u.faction), unitsFolder)
	if u.commander then
		p.Material = Enum.Material.Neon -- the crest, in 3D: one of the three ownership cues
	end
	local a, b, c = Protocol.unitLines(u)
	billboard(p, size.Y / 2 + 1.6, 150, `{a}\n{b}{if c ~= "" then "\n" .. c else ""}`, "Stats")
end

-- Draws one view (the decoded `view` object) with seat `near` at the chair.
function BoardView.render(v: Protocol.View, near: number)
	local b = Protocol.boardOf(v)
	unitsFolder:ClearAllChildren()
	bannerLabel.Text = Protocol.banner(v) or `Round {b.round} · seat {b.active} to act`
	if #b.seats < 2 then
		castleLabels.near.Text = ""
		castleLabels.far.Text = ""
		return
	end
	local function drawCastle(castle: Part, label: TextLabel, seatIndex: number)
		local s = b.seats[seatIndex + 1]
		castle.Color = rgb(s.faction)
		castle.Material = if b.active == seatIndex and b.phase == "playing" then Enum.Material.Neon else Enum.Material.SmoothPlastic
		label.Text = `seat {seatIndex}: {Protocol.bandText(s, b.round)}`
	end
	drawCastle(castles.near, castleLabels.near, near)
	drawCastle(castles.far, castleLabels.far, 1 - near)
	for _, x in Protocol.units(b, near) do
		drawUnit(x.unit, x.col, x.row)
	end
end

-- Decodes a raw /remote/view body ({"n","view"}) and draws it. Bad bodies are ignored.
function BoardView.renderBody(body: string, near: number)
	if body == "" then
		return
	end
	local ok, msg = pcall(HttpService.JSONDecode, HttpService, body)
	if ok and type(msg) == "table" and type(msg.view) == "table" then
		BoardView.render(msg.view, near)
	end
end

return BoardView
```

- [ ] **Step 2: Show the hand.** `roblox/src/client/HandUI.luau`:

```lua
--!strict
-- The seated player's hand: the arena's move menu as tiles along the bottom of the screen, useful
-- moves first (Protocol.orderMenu), each labelled with the arena's own `label`. A click sends
-- (menu n, arena index) to the server, which relays it only from the seated player. The tiles
-- lock after a click: the menu is spent, and the next view brings the next one.
--
-- Everyone sees the status line: who holds the remote seat, and anything the server says.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Protocol = require(ReplicatedStorage:WaitForChild("TapstoneShared"):WaitForChild("Protocol"))

local HandUI = {}

local INK = Color3.fromRGB(240, 236, 226)
local PANEL = Color3.fromRGB(22, 27, 34)
local DIM = Color3.fromRGB(70, 78, 90)

local tiles: Frame
local status: TextLabel
local remotes: Folder

local function refreshStatus()
	local me = Players.LocalPlayer.Name
	-- Attributes arrive typed `unknown`: read each through a type check, never a cast.
	local rawWho, rawSeat, rawMessage = remotes:GetAttribute("SeatedName"), remotes:GetAttribute("Seat"), remotes:GetAttribute("Message")
	local who = if type(rawWho) == "string" then rawWho else ""
	local seat = if type(rawSeat) == "number" then rawSeat else -1
	local message = if type(rawMessage) == "string" then rawMessage else ""
	local line
	if who == "" then
		line = "Sit in the gold chair to play the remote seat"
	elseif who == me then
		line = `You play seat {seat}`
	else
		line = `Watching: {who} plays seat {seat}`
	end
	status.Text = if message ~= "" then `{line} · {message}` else line
end

local function clear()
	for _, child in tiles:GetChildren() do
		if child:IsA("TextButton") then
			child:Destroy()
		end
	end
end

-- Shows a raw /remote/choices body ({"n","menu"}).
function HandUI.show(body: string)
	local ok, msg = pcall(HttpService.JSONDecode, HttpService, body)
	if not ok or type(msg) ~= "table" or type(msg.n) ~= "number" or type(msg.menu) ~= "table" then
		return
	end
	clear()
	local n: number = msg.n
	local choose = remotes:WaitForChild("Choose") :: RemoteEvent
	for order, entry in Protocol.orderMenu(msg.menu) do
		local button = Instance.new("TextButton")
		button.Name = `Move{entry.index}`
		button.LayoutOrder = order
		button.Size = UDim2.fromOffset(170, 64)
		button.AutoButtonColor = true
		button.BackgroundColor3 = if entry.item.useful then Color3.fromRGB(Protocol.factionRGB("gold")) else DIM
		button.TextColor3 = if entry.item.useful then PANEL else INK
		button.TextScaled = true
		button.TextWrapped = true
		button.Font = Enum.Font.GothamBold
		button.Text = entry.item.label
		local limit = Instance.new("UITextSizeConstraint")
		limit.MinTextSize = 14
		limit.MaxTextSize = 24
		limit.Parent = button
		button.Activated:Connect(function()
			for _, other in tiles:GetChildren() do
				if other:IsA("TextButton") then
					other.Active = false
					other.AutoButtonColor = false
					other.BackgroundTransparency = 0.6
				end
			end
			choose:FireServer(n, entry.index)
		end)
		button.Parent = tiles
	end
end

function HandUI.create()
	remotes = ReplicatedStorage:WaitForChild("TapstoneRemotes") :: Folder
	local gui = Instance.new("ScreenGui")
	gui.Name = "TapstoneHand"
	gui.ResetOnSpawn = false
	gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

	status = Instance.new("TextLabel")
	status.Name = "Status"
	status.Size = UDim2.new(1, 0, 0, 30)
	status.Position = UDim2.new(0, 0, 1, -116)
	status.BackgroundColor3 = PANEL
	status.BackgroundTransparency = 0.2
	status.TextColor3 = INK
	status.TextScaled = true
	status.Font = Enum.Font.GothamMedium
	status.Parent = gui

	tiles = Instance.new("Frame")
	tiles.Name = "Tiles"
	tiles.Size = UDim2.new(1, 0, 0, 84)
	tiles.Position = UDim2.new(0, 0, 1, -86)
	tiles.BackgroundTransparency = 1
	tiles.Parent = gui
	local layout = Instance.new("UIListLayout")
	layout.FillDirection = Enum.FillDirection.Horizontal
	layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
	layout.Padding = UDim.new(0, 8)
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Parent = tiles

	for _, name in { "SeatedName", "Seat", "Message" } do
		remotes:GetAttributeChangedSignal(name):Connect(refreshStatus)
	end
	refreshStatus()
	local menuEvent = remotes:WaitForChild("Menu") :: RemoteEvent
	menuEvent.OnClientEvent:Connect(HandUI.show)
end

return HandUI
```

- [ ] **Step 3: Boot the client.** `roblox/src/client/Main.client.luau`:

```lua
--!strict
-- Client bootstrap: draw the board, show the hand, and redraw on every view the server forwards.
-- The client holds nothing but pictures: the arena decides, the server relays.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local BoardView = require(script.Parent.BoardView)
local HandUI = require(script.Parent.HandUI)

local remotes = ReplicatedStorage:WaitForChild("TapstoneRemotes") :: Folder
local viewEvent = remotes:WaitForChild("View") :: RemoteEvent
local getView = remotes:WaitForChild("GetView") :: RemoteFunction

local function near(): number
	return if remotes:GetAttribute("Seat") == 1 then 1 else 0
end

BoardView.create()
HandUI.create()
viewEvent.OnClientEvent:Connect(function(body: string)
	BoardView.renderBody(body, near())
end)
-- A client that joins mid-match draws the current board straight away.
BoardView.renderBody(getView:InvokeServer(), near())
print("[Tapstone] board ready")
```

- [ ] **Step 4: Type-check and build.**

```sh
tools/typecheck.sh 2>&1 | grep -v "INFO\|WARN"; echo "exit ${PIPESTATUS[0]}"
rojo build default.project.json -o build/Tapstone.rbxl
```
Expected: `exit 0` with no `TypeError`, then `Built project to Tapstone.rbxl`.

- [ ] **Step 5: Commit.**

```sh
git add roblox/src/client/BoardView.luau roblox/src/client/HandUI.luau roblox/src/client/Main.client.luau
git commit -m "feat(roblox): the board as parts and the hand as tiles"
```

---

### Task B6: the StudioMCP playtest, a whole match through a quick tunnel, and its stall control

This task is the first run of the server and client code. It needs Part A's arena (`--desk --remote`, Part A Task A7) on main, and a person to open Studio once.

**Files:**
- Create: `roblox/tools/playtest/remote-match.luau`, `roblox/tools/playtest/drive.py`
- Record: `scratch/roblox/part-b.md`

- [ ] **Step 1: Write the server-datamodel checks.** `roblox/tools/playtest/remote-match.luau`:

```lua
--!strict
-- Runs once in the SERVER datamodel of a StudioMCP playtest (tools/playtest/drive.py). It seats
-- the Studio player in the chair, proves the relay's door refuses anyone else, and switches on the
-- automatic player. The driver then watches ServerStorage.TapstoneConfig until the match ends.
-- Returns one line per check; a line starting "FAIL" fails the driver.
local Players = game:GetService("Players")
local ServerScriptService = game:GetService("ServerScriptService")
local ServerStorage = game:GetService("ServerStorage")

local TableServer = require(ServerScriptService:WaitForChild("Tapstone"):WaitForChild("TableServer"))
local config = ServerStorage:WaitForChild("TapstoneConfig")

local out = {}
local function log(ok: boolean, what: string)
	table.insert(out, (if ok then "ok   " else "FAIL ") .. what)
end

local player = Players:GetPlayers()[1]
if player == nil then
	return "FAIL no player in the playtest"
end
local character = player.Character or player.CharacterAdded:Wait()
local humanoid = character:WaitForChild("Humanoid") :: Humanoid
local chair = workspace:WaitForChild("TapstoneTable"):WaitForChild("Chair") :: Seat

chair:Sit(humanoid)
local deadline = os.clock() + 5
while TableServer.seated() ~= player and os.clock() < deadline do
	task.wait(0.1)
end
log(TableServer.seated() == player, `the first player to sit is seated ({player.Name})`)

local sent, why = TableServer.relay(nil, 0, 0)
log(not sent and why == "not the seated player", `an unseated caller is refused before HTTP ({why})`)
local sent2, why2 = TableServer.relay(player, 1.5, 0)
log(not sent2 and why2 == "bad menu number or index", `a fractional menu number is refused ({why2})`)

config:SetAttribute("AutoPlay", "first-useful")
log(true, `autoplay on; Propose = {tostring(config:GetAttribute("Propose"))}`)
return table.concat(out, "\n")
```

- [ ] **Step 2: Write the driver.** `roblox/tools/playtest/drive.py`:

```python
#!/usr/bin/env python3
"""Play a whole remote-seat match in Roblox Studio through StudioMCP, or prove it stalls.

    python3 tools/playtest/drive.py match --url https://x.trycloudflare.com --code K7Q2MX
    python3 tools/playtest/drive.py stall --url https://x.trycloudflare.com --code K7Q2MX

`match`: autoplay on, proposals on. Passes when the view shows a winner and the seat proposed at
least 5 times (the web gate's floor). Restart the arena before each run: its views are numbered
for the life of the process, so a fresh process holds only this run's match. `stall`, the control: autoplay on, proposals OFF. Passes when,
90 s in, there is no winner, no proposal was sent and the view number has not moved for 60 s.
Exit 0 pass, 1 fail, 2 setup error (no Studio, HTTP off, never joined).

The JSON-RPC plumbing follows ~/Projects/roblox/tools/playtest/mcp_drive.py (StudioMCP through
~/.local/bin/roblox-studio-mcp). Needs Studio open on the Tapstone place with "Enable Studio as MCP
server" on, and nothing else holding port 13469.
"""
import argparse, json, os, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
WRAPPER = os.path.expanduser("~/.local/bin/roblox-studio-mcp")

ap = argparse.ArgumentParser()
ap.add_argument("mode", choices=["match", "stall"])
ap.add_argument("--url", required=True, help="the tunnel base URL")
ap.add_argument("--code", required=True, help="the arena's join code for this match")
ap.add_argument("--minutes", type=float, default=15.0, help="match mode: give up after this long")
args = ap.parse_args()

proc = subprocess.Popen([WRAPPER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL, bufsize=0)
pending, lock, nid = {}, threading.Lock(), [0]


def reader():
    for raw in proc.stdout:
        try:
            msg = json.loads(raw.decode(errors="replace").strip())
        except Exception:
            continue
        if msg.get("id") in pending:
            pending[msg["id"]]["res"] = msg
            pending[msg["id"]]["ev"].set()


threading.Thread(target=reader, daemon=True).start()


def send(obj):
    proc.stdin.write((json.dumps(obj) + "\n").encode())
    proc.stdin.flush()


def rpc(method, params=None, timeout=30):
    with lock:
        nid[0] += 1
        mid = nid[0]
    ev = threading.Event()
    pending[mid] = {"ev": ev, "res": None}
    send({"jsonrpc": "2.0", "id": mid, "method": method, "params": params or {}})
    if not ev.wait(timeout):
        pending.pop(mid, None)
        raise TimeoutError(method)
    msg = pending.pop(mid)["res"]
    if "error" in msg:
        raise RuntimeError(msg["error"])
    return msg.get("result", {})


def call(name, arguments=None, timeout=60):
    res = rpc("tools/call", {"name": name, "arguments": arguments or {}}, timeout)
    text = "\n".join(c.get("text", "") for c in res.get("content", []) if c.get("type") == "text")
    return res.get("isError", False), text


def luau(code, dm, timeout=60):
    """Run Luau in a datamodel ("Edit", "Server" or "Client"); returns (ok, text)."""
    is_err, text = call("execute_luau", {"code": code, "datamodel_type": dm}, timeout)
    return (not is_err), text


def done(code, line):
    print(line, flush=True)
    try:
        call("start_stop_play", {"is_start": False}, 60)
    except Exception:
        pass
    proc.terminate()
    sys.exit(code)


STATUS = """local c = game:GetService("ServerStorage").TapstoneConfig
return game:GetService("HttpService"):JSONEncode({
  seat = c:GetAttribute("Seat"), n = c:GetAttribute("ViewN"), phase = c:GetAttribute("Phase"),
  seq = c:GetAttribute("Seq"), winner = c:GetAttribute("Winner"),
  proposals = c:GetAttribute("Proposals"), err = c:GetAttribute("LastError") })"""


def status():
    ok, text = luau(STATUS, "Server", 30)
    if not ok:
        return None
    try:
        return json.loads(text.strip().splitlines()[-1])
    except Exception:
        return None


rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                   "clientInfo": {"name": "tapstone-drive", "version": "1"}}, 10)
send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

# Studio registers a little after the transport connects: poll for it (mcp_drive.py does too).
deadline = time.time() + 90
studios = []
while time.time() < deadline and not studios:
    try:
        studios = json.loads(call("list_roblox_studios", {}, 10)[1]).get("studios", [])
    except Exception:
        pass
    if not studios:
        time.sleep(1.5)
if not studios:
    print("SETUP: no Studio registered with StudioMCP within 90 s", flush=True)
    proc.terminate()
    sys.exit(2)
sid = next((s for s in studios if s.get("active")), studios[0]).get("id")
call("set_active_studio", {"studio_id": sid}, 10)

# HttpEnabled comes from default.project.json. A place opened another way may not carry it, and
# only the command bar can set it (Roblox: HttpEnabled "must be toggled on for unpublished
# experiences ... using the Command Bar"), so check and stop with the instruction.
ok, text = luau('return tostring(game:GetService("HttpService").HttpEnabled)', "Edit")
if not ok or "true" not in text:
    print("SETUP: HttpService.HttpEnabled is off. Open roblox/build/Tapstone.rbxl (built by rojo),"
          " or run in Studio's command bar: game:GetService(\"HttpService\").HttpEnabled = true",
          flush=True)
    proc.terminate()
    sys.exit(2)

settings = {"ArenaUrl": args.url, "JoinCode": args.code, "AutoPlay": "off",
            "Propose": args.mode == "match"}
lines = "\n".join(f'c:SetAttribute("{k}", {json.dumps(v)})' for k, v in settings.items())
ok, text = luau(f'local c = game:GetService("ServerStorage").TapstoneConfig\n{lines}\nreturn "set"',
                "Edit")
print(f"settings: {settings} -> {text.strip()}", flush=True)

call("start_stop_play", {"is_start": True}, 60)
# Joined means the server's Seat attribute is 0 or 1. A LastError without a seat is a join failure.
deadline = time.time() + 60
st = None
while time.time() < deadline:
    time.sleep(2)
    st = status()
    if st and isinstance(st.get("seat"), (int, float)) and st["seat"] >= 0:
        break
if not st or not isinstance(st.get("seat"), (int, float)) or st["seat"] < 0:
    done(2, f"SETUP: never joined the arena: {st}")
print(f"joined: {st}", flush=True)

ok, text = luau(open(os.path.join(HERE, "remote-match.luau")).read(), "Server", 60)
print(text, flush=True)
if not ok or "FAIL" in text:
    done(1, "FAIL: remote-match.luau")

if args.mode == "match":
    deadline = time.time() + args.minutes * 60
    last_print = 0.0
    while time.time() < deadline:
        time.sleep(3)
        st = status()
        if st is None:
            continue
        if time.time() - last_print > 20:
            print(f"  {st}", flush=True)
            last_print = time.time()
        # A winner only counts with the seat's own proposals behind it (the web gate's floor of
        # 5): the arena keeps views for its whole life, so a stale "over" could pass by alone.
        if isinstance(st.get("winner"), (int, float)) and st["winner"] >= 0 and st["proposals"] >= 5:
            # The board is drawn client-side: count the unit blocks a client drew for the last view.
            ok, board = luau('local b = workspace:FindFirstChild("TapstoneBoard")\n'
                             'return b and #b.Units:GetChildren() or -1', "Client", 30)
            print(f"client board units: {board.strip() if ok else 'Client datamodel not available'}",
                  flush=True)
            done(0, f"PASS: seat {st['winner']} won after {st['proposals']} proposals: {st}")
    done(1, f"FAIL: no winner within {args.minutes} min: {st}")
else:
    time.sleep(30)
    first = status()
    time.sleep(60)
    last = status()
    print(f"  at 30 s: {first}\n  at 90 s: {last}", flush=True)
    if not first or not last:
        done(2, "SETUP: status unreadable")
    stalled = (last["winner"] == -1 and last["proposals"] == 0 and last["n"] == first["n"])
    done(0 if stalled else 1, ("PASS: " if stalled else "FAIL: ") +
         f"proposals off: winner {last['winner']}, proposals {last['proposals']},"
         f" view number {first['n']} -> {last['n']}")
```

Then run `python3 -m py_compile roblox/tools/playtest/drive.py && tools/typecheck.sh`. Expected: no output from py_compile, and `exit 0` from the typecheck, which now also checks `remote-match.luau`.

- [ ] **Step 3: Start the arena on familiar, against the desk bot.** The arena's remote listener stays on familiar's loopback:

```sh
ssh familiar 'export PATH=$HOME/.cargo/bin:$PATH CARGO_TARGET_DIR=/var/tmp/ftarget/luna-roblox
  mkdir -p /var/tmp/fwork && cd /var/tmp/fwork && (test -d luna-roblox || git clone -q https://github.com/jphein/tapstone-game luna-roblox)
  cd luna-roblox && git fetch -q && git checkout -q --detach origin/main && cd rust
  cargo build --release -p tapstone-arena
  tmux kill-session -t tapstone-arena 2>/dev/null
  tmux new-session -d -s tapstone-arena -c /var/tmp/fwork/luna-roblox/rust "$CARGO_TARGET_DIR/release/tapstone-arena --desk --remote ember-neutral"'
sleep 3; ssh familiar 'tmux capture-pane -p -t tapstone-arena | grep -oE "remote join code: [A-Z0-9]{6}" | tail -1'
```
Expected: `remote join code: XXXXXX`. Keep the 6 characters as `CODE`.

- [ ] **Step 4: Forward the port to katana, and prove the forward reaches only the remote listener.**

```sh
tmux kill-session -t tapstone-fwd 2>/dev/null
tmux new-session -d -s tapstone-fwd 'ssh -N -L 127.0.0.1:7791:127.0.0.1:7791 familiar'
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7791/remote/choices   # expect 401 (no token)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7791/dev/tap          # expect 404 (0038)
```
Both numbers are required. A `000` means the forward or the arena is down, and nothing after this step can be trusted.

- [ ] **Step 5: Open the quick tunnel on katana.** Mind Part A's tunnel trap: resolve the URL only after cloudflared logs `Registered tunnel connection`. An earlier lookup is cached as not-found by the homelab resolver, and **Studio's playtest server runs on katana and uses that same resolver.**

```sh
mkdir -p ../scratch/roblox
tmux kill-session -t tapstone-tunnel 2>/dev/null
tmux new-session -d -s tapstone-tunnel "mise exec cloudflared@2026.9.3 -- cloudflared tunnel --url http://127.0.0.1:7791 2>&1 | tee ../scratch/roblox/tunnel.log"
until grep -q "Registered tunnel connection" ../scratch/roblox/tunnel.log; do sleep 1; done
URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" ../scratch/roblox/tunnel.log | head -1); echo "$URL"
curl --doh-url https://1.1.1.1/dns-query -s -o /dev/null -w "%{http_code}\n" "$URL/remote/choices"   # expect 401
```
Expected: the URL, then `401`.

- [ ] **Step 6: Open the place in Studio, once, by hand.**
  1. Run `rojo build default.project.json -o build/Tapstone.rbxl`, then `xdg-open build/Tapstone.rbxl` (Vinegar opens `.rbxl`; otherwise use File ⟩ Open in Studio).
  2. In Studio, turn on Assistant ⟩ Manage MCP Servers ⟩ **Enable Studio as MCP server**.
  3. Make sure nothing else holds port 13469. The Realm Forge control panel from `~/Projects/roblox` must not be running.

- [ ] **Step 7: Play a whole match.**

```sh
python3 tools/playtest/drive.py match --url "$URL" --code "$CODE"; echo "exit $?"
```
Expected, in order:
- `joined: {… "seat": 1 …}`;
- three `ok` lines from `remote-match.luau` (the player is seated, an unseated caller is refused, a fractional menu number is refused);
- status lines every 20 s;
- `client board units: N`, where N ≥ 1 (or `Client datamodel not available`, which leaves the board to Task B7);
- `PASS: seat S won after P proposals`, with P ≥ 5, then `exit 0`.

- [ ] **Step 8: The control: the same run with proposals off stalls.**
  - Restart the arena, so that the view history holds only the new match (views are numbered for the process's life).
  - Take the new code.
  - Run the stall mode. The tunnel and the forward stay up.

```sh
ssh familiar 'tmux kill-session -t tapstone-arena; tmux new-session -d -s tapstone-arena -c /var/tmp/fwork/luna-roblox/rust "/var/tmp/ftarget/luna-roblox/release/tapstone-arena --desk --remote ember-neutral"'
sleep 3; CODE=$(ssh familiar 'tmux capture-pane -p -t tapstone-arena | grep -oE "remote join code: [A-Z0-9]{6}" | tail -1 | cut -d" " -f4'); echo "$CODE"
python3 tools/playtest/drive.py stall --url "$URL" --code "$CODE"; echo "exit $?"
```
Expected: `PASS: proposals off: winner -1, proposals 0, view number A -> A`, then `exit 0`. An `exit 1` here means the seat moved without proposals, so the match run proves nothing.

- [ ] **Step 9: Record the evidence and tear down.**
  - Paste both drivers' output into `scratch/roblox/part-b.md`.
  - Then run:

```sh
tmux kill-session -t tapstone-tunnel; tmux kill-session -t tapstone-fwd
ssh familiar 'tmux kill-session -t tapstone-arena; rm -rf /var/tmp/fwork/luna-roblox /var/tmp/ftarget/luna-roblox'
```

- [ ] **Step 10: Commit.**

```sh
git add roblox/tools/playtest/remote-match.luau roblox/tools/playtest/drive.py
git commit -m "test(roblox): a whole remote-seat match through StudioMCP, and its stall control"
```

---

### Task B7: once, by hand: JP on Sober against a real shrine

This is spec §5's hand check. Nothing here is automated. It checks what no script sees: a person, the Roblox player's machine, and a real shrine.

- [ ] **Step 1: The table.** On the machine with the gateway on USB (spec §1: katana or the laptop), with Part A's build:
  - run `tapstone-arena --remote ember-neutral` (no `--desk`: the other seat is the real shrine);
  - start the quick tunnel on `127.0.0.1:7791` as in Task B6, Step 5, including its wait for `Registered tunnel connection`.
  - Note the URL and the printed `remote join code:`.
- [ ] **Step 2: The place.** In Studio:
  1. Open `build/Tapstone.rbxl`.
  2. On `ServerStorage.TapstoneConfig`, set `ArenaUrl` and `JoinCode` in the Properties panel.
  3. **File ⟩ Publish to Roblox As…**, as a new, **Private** experience.
  4. In **File ⟩ Experience Settings ⟩ Security**, turn on **Allow HTTP Requests**, which a published place needs.
  - Every later match needs its new code set and the place republished. The spec keeps the code a place setting for the prototype.
- [ ] **Step 3: Play.** JP opens the experience in Sober (profile ⟩ Creations ⟩ the place ⟩ Play), sits in the gold chair, and plays a whole match against someone tapping cards on the shrine.
- [ ] **Step 4: Record what was seen,** with the date from `date`, in `scratch/roblox/sober-check.md`. Mark each line yes or no, with a note:
  1. The board appears on the table with both castles and their lines of state.
  2. After sitting, the status reads `You play seat 1`, and move tiles appear, useful ones in gold first.
  3. A tile click shows on the Roblox board within about a second, and on the shrine's station and the arena's board.
  4. A paper card tapped on the shrine appears on the Roblox board.
  5. The unit billboards and castle lines are readable at the chair.
  6. The match finishes, and the banner reads `Seat N wins`.
  7. A second Roblox player who didn't sit sees the board and `Watching: … plays seat 1`, and has no tiles.
- [ ] **Step 5: Report the sheet to the lead.** A "no" on 1–6 is a bug against this plan. File it with the line number.

---

### Task B8: open the Part B PR

- [ ] **Step 1: The gate, on katana, from `roblox/`.**

```sh
lune run tests/run.luau; echo "exit $?"
tools/typecheck.sh 2>&1 | grep -v "INFO\|WARN"; echo "exit ${PIPESTATUS[0]}"
rojo build default.project.json -o build/Tapstone.rbxl
python3 -m py_compile tools/playtest/drive.py
```
Expected:
- `20 passed, 0 failed` and `exit 0`;
- `exit 0` with no `TypeError`;
- `Built project to Tapstone.rbxl`;
- nothing from py_compile;
- plus Task B6's two `PASS` lines, quoted in the PR.

- [ ] **Step 2: Push and open the PR.** Send the lead "pushing #N <sha>" first. Then push `feat/roblox-place` and open the PR against `main`. Its body gives the gate output, both playtest results, and the Sober sheet or "B7 pending". The lead merges.

---

## Part B self-review (against spec §4, §5 and §7, and Part A's contract)

- **Spec §4, toolchain:** Rojo 7.7 through aftman, with the same rojo and luau-lsp pins as `~/Projects/roblox`, plus lune for tests (B1). Studio through Vinegar (B6, B7). Sober (B7). StudioMCP (B6).
- **Spec §4, server:**
  - `ArenaClient` covers join, the long-poll, choices and propose, with retries and backoff (B3, B4).
  - `TableServer` seats the first player to sit and relays only their clicks (B4, and proven in B6 Step 7).
  - The settings are attributes on `ServerStorage.TapstoneConfig` (B1, B4).
- **Spec §4, client:**
  - `BoardView` draws the 3 × 6 cells, unit blocks with power and health billboards, both castles with life, and whose turn it is (B5).
  - `HandUI` shows the `label` tiles, useful items first (B5).
  - The view JSON reaches clients as-is over a RemoteEvent (B4, B5), sent as the body string because of Roblox's nil-in-tables rule.
- **Spec §4, look:** parts and billboards in the realm colours, taken from the browser board's CSS (`Protocol.RGB`).
- **Spec §5, Roblox tests:**
  - The StudioMCP playtest plays a whole match against `--desk --remote`, choosing the first useful non-mulligan item as the web gate does (B6 Step 7).
  - Its control stalls with proposals off (B6 Step 8).
  - Once, by hand, on Sober against a real shrine (B7).
- **Spec §7:**
  - HttpService limits: about 2 requests per view against 500 a minute.
  - Quick-tunnel URLs are a place setting.
  - Studio reaching `localhost` is never assumed: the playtest goes through the tunnel URL.
  - The place stays private.
- **Part A's contract:**
  - uppercase codes (tested);
  - the next view, with `n` kept for the process's life and never reset on rejoin;
  - `401` on choices and propose after a match while views remain readable;
  - `Content-Type: application/json` on POSTs (axum's `415`);
  - `i` indexes the full menu (`orderMenu` keeps the arena's index, tested).
- **Placeholder scan:** none. Every file is given whole. Tasks B6 and B7 are the first runs of the Studio-side code and say so.
- **Types and names across tasks:**
  - `ArenaApi.{new, send, join, pollView, choices, propose, delay, classify}`;
  - `ArenaClient.{new, join, pollView, choices, propose}`;
  - `Protocol.{boardOf, winnerOf, banner, returnsText, bandText, unitLines, gridOf, units, orderMenu, firstUseful, isIndex, RGB, factionRGB}`;
  - `TableServer.{init, seated, relay}`;
  - `Stage.build`;
  - `BoardView.{create, render, renderBody}`;
  - `HandUI.{create, show}`.
  - The config attributes `ArenaUrl, JoinCode, AutoPlay, Propose, Seat, ViewN, Phase, Seq, Winner, Proposals, LastError` are the same in `Main`, `remote-match.luau` and `drive.py`.

---

## Amendment 2026-09-26: two remote seats (Roblox against Roblox), for tonight

**What changed:** JP wants to play a second player with both of them in Roblox, so the arena gets two remote seats: `tapstone-arena --desk --remote ember-neutral --remote tide-neutral`, with no bot. Each seat has its own join code, and the view's `remote_code` becomes `remote_codes` (by seat). The arena side belongs to nebula-xr and morpheus.

**Where the code is:** it's built on `feat/roblox-place` (PR #118) and is the source of truth for everything below. The tasks above remain the method (test-first under lune, strict typecheck, the StudioMCP playtest), but the file contents in Tasks B2–B6 are the one-seat version.

**What differs from Tasks B2–B6:**

| Part | One seat (above) | Two seats (#118) |
|---|---|---|
| Settings | `JoinCode` | `JoinCodeA`, `JoinCodeB`, in any order: the join reply names the seat. Status `Seat` becomes `Seats` (`"0,1"`) |
| `Stage` | one chair | a chair at each end: `Chair0` at −Z facing +Z, `Chair1` at +Z facing −Z, each with a "Sit here: seat N" sign |
| `TableServer` | `seated()`, `relay(p, n, i)` | `seatOf(p)`, `playerAt(seat)`, `relay(p, n, i)`. The seat comes from **who clicked**, never from the client, and a player holds at most one seat |
| `Main.server` | one client | one `ArenaClient` per joined code, by seat. Views are polled with one token, and each seat's menu is fetched with **its own** token and sent to that seat's player. Autoplay plays every joined seat: through the relay when someone sits there, directly otherwise (a solo playtest has one player) |
| `BoardView` | the remote seat nearest the chair | world-fixed (seat 1 at +Z), so each player sits behind their own side. Styling is per viewer: `Protocol.styleFor(unitSeat, mySeat)` makes yours objects (tall, full stats) and theirs entries (low stone, short tag); anyone not seated sees objects |
| `HandUI` | the one seated player's menu | your own seat's menu. The status reads "You play seat N against X" or "Watching: A (seat 0) against B (seat 1)" |
| `Protocol` | — | adds `styleFor` and `remoteCodes` (holes and a missing key handled), with tests and perturbations. lune now runs 22 tests |
| Playtest | `--code X` | `--codes A B`. The Studio player sits in `Chair1`; seat 0 is autoplayed directly |
| New | — | `tools/fake_arena.py`: the four routes for two seats, replaying the real desk fixture one view per proposed move, for Studio work before the two-seat arena exists. `tools/fake_arena_check.py` holds it to the contract (12 checks; a perturbed stale-menu check goes red) |

**Contract assumptions for two seats**, sent to nebula-xr; to reconcile when the arena lands:
- Each code redeems for its own seat.
- `remote_codes` is an array by seat, with a null entry once that seat has joined.
- Either token reads the same views.
- Choices and propose are per token, with a menu `n` per seat.
- After a match, both tokens get 401 on choices and propose, and two new codes are printed.

**Two-slot stdout** (main d8584a5): the arena prints `remote join code (slot 0): X` and `remote join code (slot 1): Y`, not `remote join code: X`. For Task B6's code capture with two slots, use `grep -oE 'remote join code( \(slot [01]\))?: [A-Z0-9]{6}' | grep -oE '[A-Z0-9]{6}$'`, which matches both forms.

**Tunnel probes from an agent shell:** the sandbox's `https_proxy` (`127.0.0.1:3456`) answers `502` for trycloudflare, so a working tunnel shows `000`. Probe with `curl --noproxy '*' --doh-url https://1.1.1.1/dns-query <url>/remote/choices` (expect `401`). Studio runs outside the sandbox and isn't affected.

## Amendment 2026-09-26: VR (JP's Quest 2), additive behind `VRService.VREnabled`

**What:** JP asked for the game to be playable in VR: a Quest 2 runs the Roblox app, and 0037 makes cross-play the ethos. It's built on `feat/roblox-vr`, stacked on #118. Flat play is unchanged: every VR path is behind `VRService.VREnabled`, which only a LocalScript can read.

**Roblox facts** (creator-docs@0b817b5, read from source):
- **The laser pointer** is how a VR player "point[s] at and interact[s] with the user interface". It defaults to on (`VRService.LaserPointer`, default `Pointer`).
- **SurfaceGui input:** interactive elements "receive user input if they are parented to the `PlayerGui`" (with `Adornee` targeting the part), and "the part's `CanQuery` property must be `true`".
- **Camera:** Roblox provides default VR cameras with comfort settings (vignette, stepped rotation, fixed third-person). A custom camera "opts your game out of future script updates", so this place adds no camera script.
- **Studio can emulate VR:** "use Device Simulator to choose a **Headset** device such as **Meta Quest 2**". It's checked by eye, since no script can drive it.
- **"Playable devices"** is an experience setting: the activity history logs "Playable devices changed". The docs source doesn't say where it's set. As remembered (unverified): Game Settings ⟩ Basic Info ⟩ Playable Devices ⟩ tick VR.

**What changed:**
- **`src/shared/Layout.luau` (new, pure)** holds the table's geometry, now shared by `Stage`, `BoardView` and the VR panel. A lune test checks, **from both chairs**, that every cell, the other castle's line, the banner and the hand panel's corners sit within **±35°** of a seated player's forward view. It uses the same numbers the client draws with.
  - Found while writing it: the banner was fixed at the −Z end, about 65° overhead for seat 0. It now hangs past the other seat's castle, and a perturbation back to the old placement fails the test.
- **The hand, in VR,** is a small lectern panel between the chair and the table. It's client-local, with `CanQuery` on, faces the seated head, and holds a SurfaceGui in PlayerGui with the player's castle line, the status and the move tiles, which scroll. The relay is the same `Choose` event, for the clicker's own seat only.
- **Billboards, in VR,** are sized in studs instead of pixels, so text keeps a physical size in the headset. The viewer's own castle line moves to their panel.
- **No camera script:** seated, the default VR camera shows the board from the chair.

**Checks:**
- lune 34 passed. The FoV test perturbed red twice (the old banner, and a panel too wide).
- typecheck 0, and the rojo build is OK.

**Not checked:** anything in a headset or the Studio emulator. Those are manual, below.

**Add to the B7 sheet:**
8. **Studio VR emulation:** Test ⟩ Device Simulator ⟩ Headset ⟩ Meta Quest 2, then Play. Sit in a chair: the hand panel appears in front of it, the pointer presses a tile, and the board is readable.
9. **Quest 2:** Roblox app ⟩ Tapstone Table (after publishing with VR among the playable devices). Sit, play a move with the pointer, and read both castle lines.

**Add to JP's publish click-list:** Game Settings ⟩ Basic Info ⟩ Playable Devices ⟩ tick **VR** ⟩ Save. The location is unverified: if it isn't there, look for "Playable Devices" in the game settings.

**Studio playtest, 2026-09-27 (rigel, katana, StudioMCP):**
- Device Simulator can't be driven from a script, and `VRService.VREnabled` is read-only. So the VR path ran as a fresh `require` of `HandUI` and `BoardView` with `create(true)` in the Client datamodel, against `tools/fake_arena.py`.
- **Verified:**
  - the panel builds on sitting, and its SurfaceGui is in PlayerGui with the Adornee set and CanQuery on;
  - a mouse click on a panel tile, through the same SurfaceGui input path the laser uses, reached the arena (`POST /remote/propose -> 202`);
  - flat play is unchanged: `drive.py match` PASS, and `stall` PASS.
- **Found and fixed:**
  1. From the measured seated head (y 5.16, not the estimated 4.8), the viewer's own 2.4-tall castle walled off the whole board, and the panel sat at eye height in front of it. The ±35° test checks angles, not occlusion. A sight-line test now covers both seats: in VR the own castle is a 0.4 plinth, and the panel is 3.4 ahead with its top at 4.7.
  2. A menu or view that arrived before the panel existed was lost: a nil `tiles` for the menu, and no castle line on the band. Both are now kept and applied when the panel is built.
- **Still only in a headset (item 9):**
  - the laser pointer itself;
  - comfort;
  - the player's real head height. At the character's eye height (1.2 above the table), the near units hide the far units, and a real player sits taller or leans in;
  - whether the Device Simulator adds anything to this.
