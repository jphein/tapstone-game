--!strict
-- The pure modules' tests, run with lune (no Studio): `lune run tests/run.luau` from roblox/.
-- Exits 1 on any failure and prints the count, so the exit code is the verdict.
local fs = require("@lune/fs")
local process = require("@lune/process")
local serde = require("@lune/serde")

local ArenaApi = require("../src/shared/ArenaApi")
local TableConfig = require("../src/shared/TableConfig")
local Layout = require("../src/shared/Layout")
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

-- The Tea House and the Dueling Grounds (0039), which build the real place: tests/teahouse.luau.
require("./teahouse")(test, eq)

-- Real views from a real desk match (79 lines: 77 playing, 1 over, 1 lobby with last_over).
local views: { Protocol.View } = {}
local raw = fs.readFile(FIXTURE)
for line in string.gmatch(raw, "[^\n]+") do
	table.insert(views, serde.decode("json", line) :: any)
end

test("the fixture is the real one", function()
	eq(#views, 79, "views")
end)

-- Effects (the headset's effects.js, ported): tests/effects.luau, on the same 79 views.
require("./effects")(test, eq, views)

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

test("join accepts a seat of null: the claim hasn't landed yet", function()
	local c = fake({ { status = 200, body = '{"token":"ab","seat":null}' } })
	local r = ArenaApi.join(c, "AAAAAA")
	eq(r, "joined", "joined without a seat")
	eq(c.seat, nil, "the seat is resolved later, from the views")
	eq(c.code, "AAAAAA", "the code is kept for that")
end)

test("choices carries the token's arena seat: it is the authority, and null leaves it unknown", function()
	-- A code names a slot, not a seat: the seat comes from lobby claim order, so only the arena
	-- can say it. choices answers "seat" once this token's claim has landed.
	local c = fake({
		{ status = 200, body = '{"token":"ab","seat":null}' },
		{ status = 200, body = '{"n":1,"seat":null,"menu":[]}' },
		{ status = 200, body = '{"n":2,"seat":1,"menu":[]}' },
	})
	ArenaApi.join(c, "AAAAAA")
	eq(c.seat, nil, "unknown after a null join")
	ArenaApi.choices(c)
	eq(c.seat, nil, "still unknown while choices says null")
	ArenaApi.choices(c)
	eq(c.seat, 1, "the claim landed in seat 1, whatever slot the code was")
end)

-- The arena throttles a source past ten wrong codes with 429 (0038, amended 2026-09-27), and only
-- that source; 423 was the old table-wide lock, kept for an older arena. Either way, a seat whose
-- source shares the throttle waits it out and joins: it is never locked out.
test("a throttled join (429) waits and joins", function()
	local c, sent, slept = fake({
		{ status = 429 },
		{ status = 429 },
		{ status = 200, body = '{"token":"ab","seat":1}' },
	})
	eq(ArenaApi.join(c, "AAAAAA"), "joined", "result")
	eq(#sent, 3, "three attempts")
	eq(#slept, 2, "two waits")
	eq(c.token, "ab", "token")
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

-- ---- two remote seats: whose units are objects, and the join codes in a view ----------------

test("styleFor: mine are objects, theirs are entries; a spectator sees objects (0027)", function()
	eq(Protocol.styleFor(0, 0), "object", "my unit")
	eq(Protocol.styleFor(1, 0), "entry", "their unit")
	eq(Protocol.styleFor(1, 1), "object", "seat 1's own unit")
	eq(Protocol.styleFor(0, nil), "object", "spectator, seat 0")
	eq(Protocol.styleFor(1, nil), "object", "spectator, seat 1")
end)

test("remoteCodes reads remote_codes by seat, with holes and without the key", function()
	local v = table.clone(views[2])
	local codes = {}
	codes[2] = "GHJKLM" -- seat 0 already joined: its entry is null, so a hole
	v.remote_codes = codes
	local got = Protocol.remoteCodes(v)
	eq(got[0], nil, "seat 0 joined")
	eq(got[1], "GHJKLM", "seat 1 still open")
	v.remote_codes = nil
	local none = Protocol.remoteCodes(v)
	eq(none[0], nil, "no key: nothing open")
	eq(none[1], nil, "no key: nothing open")
	v.remote_codes = { "ABCDEF", "GHJKLM" }
	local both = Protocol.remoteCodes(v)
	eq(both[0], "ABCDEF", "seat 0")
	eq(both[1], "GHJKLM", "seat 1")
end)

test("remoteCodes also reads the one-slot shape: remote_code is seat 1's", function()
	local v = table.clone(views[2])
	v.remote_codes = nil
	v.remote_code = "K7Q2MX"
	local got = Protocol.remoteCodes(v)
	eq(got[1], "K7Q2MX", "the one remote seat is seat 1")
	eq(got[0], nil, "seat 0 is the table's")
end)

test("rejoinCodes: after a match ends, the next lobby's open codes (either shape)", function()
	local last = views[#views] -- the lobby after the match, with last_over
	local v = table.clone(last)
	v.remote_codes = { "ABCDEF", "GHJKLM" }
	eq(Protocol.rejoinCodes(v, false), nil, "no rejoin unless this client saw its match end")
	local both = Protocol.rejoinCodes(v, true)
	assert(both ~= nil, "codes after the end")
	eq(#both, 2, "both slots")
	eq(both[1], "ABCDEF", "slot 0 first")
	local one = table.clone(last)
	one.remote_code = "K7Q2MX"
	local single = Protocol.rejoinCodes(one, true)
	assert(single ~= nil and #single == 1 and single[1] == "K7Q2MX", "the one-slot shape")
	eq(Protocol.rejoinCodes(last, true), nil, "no code offered yet: wait")
	local playing = table.clone(views[5])
	playing.remote_code = "K7Q2MX"
	eq(Protocol.rejoinCodes(playing, true), nil, "only from a lobby frame")
end)

-- ---- TableConfig: the table's URL and codes, from a fixed config URL (a secret gist) ----------

local function decode(str: string): any
	return serde.decode("json", str)
end
local NOW = 1790465400 + 600 -- ten minutes after 2026-09-26T23:30:00Z
local INNER = '{"url":"https://t.example/","codes":["k7q2mx"," pq3rst "],"written":"2026-09-26T23:30:00Z"}'

test("isoSeconds reads UTC ISO 8601, leap days included", function()
	eq(TableConfig.isoSeconds("2026-09-26T23:30:00Z"), 1790465400, "tonight")
	eq(TableConfig.isoSeconds("2000-02-29T12:00:00Z"), 951825600, "a leap day")
	eq(TableConfig.isoSeconds("2026-09-26T23:30:00.123Z"), 1790465400, "fractional seconds")
	eq(TableConfig.isoSeconds("yesterday"), nil, "not a time")
end)

test("read: the gist API's shape, whatever the file is called", function()
	local api = serde.encode("json", { public = false, files = { ["anything.json"] = { content = INNER } } })
	local cfg, why = TableConfig.read(api, decode, NOW)
	assert(cfg ~= nil, `read failed: {why}`)
	eq(cfg.url, "https://t.example", "url, trailing / dropped")
	eq(#cfg.codes, 2, "two codes")
	eq(cfg.codes[1], "K7Q2MX", "uppercased")
	eq(cfg.codes[2], "PQ3RST", "trimmed")
end)

test("read: the plain shape (the config JSON itself)", function()
	local cfg = TableConfig.read(INNER, decode, NOW)
	assert(cfg ~= nil and cfg.codes[1] == "K7Q2MX", "plain JSON")
end)

test("read refuses a config older than 12 h, an empty one ({} after --stop), and junk", function()
	local _, stale = TableConfig.read(INNER, decode, 1790465400 + 12 * 3600 + 1)
	assert(stale ~= nil and string.find(stale, "12 h") ~= nil, `stale: {stale}`)
	local fresh = TableConfig.read(INNER, decode, 1790465400 + 12 * 3600)
	assert(fresh ~= nil, "exactly 12 h old is still fresh")
	local _, empty = TableConfig.read("{}", decode, NOW)
	assert(empty ~= nil and string.find(empty, "no table") ~= nil, `empty: {empty}`)
	local _, junk = TableConfig.read("<html>", decode, NOW)
	assert(junk ~= nil, "junk is refused")
	local _, nocodes = TableConfig.read('{"url":"https://t.example","codes":[],"written":"2026-09-26T23:30:00Z"}', decode, NOW)
	assert(nocodes ~= nil, "no codes is refused")
	local _, notime = TableConfig.read('{"url":"https://t.example","codes":["AAAAAA"]}', decode, NOW)
	assert(notime ~= nil, "no written time is refused")
	local _, http = TableConfig.read('{"url":"http://t.example","codes":["AAAAAA"],"written":"2026-09-26T23:30:00Z"}', decode, NOW)
	assert(http ~= nil, "only https (Roblox sends HTTPS only)")
end)

-- ---- Layout: the table's geometry, shared by Stage, BoardView and the VR panel ---------------

test("cells keep BoardView's layout: 3 lanes x 6 rows, a gap at the front line", function()
	local a = Layout.cellCenter(0, 0)
	local b = Layout.cellCenter(2, 5)
	eq(a.x, -Layout.CELL, "lane 1 is at -X")
	eq(b.x, Layout.CELL, "lane 3 is at +X")
	eq(a.z, 2.5 * Layout.CELL + Layout.GAP / 2, "row 0 is nearest +Z")
	eq(b.z, -2.5 * Layout.CELL - Layout.GAP / 2, "row 5 is nearest -Z")
	local r2, r3 = Layout.cellCenter(1, 2), Layout.cellCenter(1, 3)
	eq(r2.z - r3.z, Layout.CELL + Layout.GAP, "the front-line gap")
end)

test("each chair faces the table centre from its own end", function()
	eq(Layout.chair(1).z, Layout.CHAIR_Z, "seat 1 at +Z")
	eq(Layout.chair(0).z, -Layout.CHAIR_Z, "seat 0 at -Z")
	eq(Layout.forwardZ(1), -1, "seat 1 looks toward -Z")
	eq(Layout.forwardZ(0), 1, "seat 0 looks toward +Z")
end)

-- The VR brief: nothing essential outside about ±35° of a seated player's forward view. Checked
-- from both chairs, from the same numbers the client draws with.
test("VR: every cell, the far castle's line, the banner and the hand panel sit within ±35° of the seat's forward view", function()
	for seat = 0, 1 do
		local function inView(p: Layout.Point, what: string)
			local yaw, pitch = Layout.angles(p, seat)
			assert(math.abs(yaw) <= 35 and math.abs(pitch) <= 35, `seat {seat}: {what} at yaw {yaw}, pitch {pitch}`)
		end
		for col = 0, 2 do
			for row = 0, 5 do
				inView(Layout.cellCenter(col, row), `cell {col},{row}`)
			end
		end
		inView(Layout.castleLabel(1 - seat), "the other seat's castle line")
		inView(Layout.banner(seat), "the banner")
		local panel = Layout.panel(seat)
		for _, dx in { -1, 1 } do
			for _, dy in { -1, 1 } do
				inView({ x = panel.center.x + dx * panel.width / 2, y = panel.center.y + dy * panel.height / 2, z = panel.center.z }, `panel corner {dx},{dy}`)
			end
		end
	end
end)

test("VR: the hand panel is between the chair and the board, facing the player", function()
	for seat = 0, 1 do
		local p = Layout.panel(seat)
		local chairZ, rowZ = Layout.chair(seat).z, Layout.cellCenter(1, if seat == 1 then 0 else 5).z
		assert((p.center.z - chairZ) * (p.center.z - rowZ) < 0, `seat {seat}: panel z {p.center.z} not between {chairZ} and {rowZ}`)
		local head = Layout.head(seat)
		local toHead = head.z - p.center.z
		assert(toHead * Layout.forwardZ(seat) < 0, `seat {seat}: the panel's face points at the head`)
	end
end)

-- The Studio playtest (2026-09-27, the head measured at y 5.16 in Stage's chair) showed the
-- angles test is not enough: from a seated head the viewer's own castle, 2.4 tall at the near end,
-- walled off the whole board, and the hand panel sat in front of it. This checks sight lines.
test("VR: from the seated head, neither the own castle nor the hand panel hides a cell", function()
	for seat = 0, 1 do
		local head = Layout.head(seat)
		-- Positive control: the flat castle does block the near rows, so the instrument can see.
		local flat = Layout.castleBox(seat, Layout.castleHeight(seat, seat, false))
		local nearRow = if seat == 1 then 0 else 5
		assert(Layout.blocks(head, Layout.cellCenter(1, nearRow), flat), `seat {seat}: control: the flat castle should hide the near row`)
		local own = Layout.castleBox(seat, Layout.castleHeight(seat, seat, true))
		local panel = Layout.panelBox(seat)
		for col = 0, 2 do
			for row = 0, 5 do
				local cell = Layout.cellCenter(col, row)
				assert(not Layout.blocks(head, cell, own), `seat {seat}: the own castle hides cell {col},{row}`)
				assert(not Layout.blocks(head, cell, panel), `seat {seat}: the hand panel hides cell {col},{row}`)
			end
		end
	end
end)

test("VR: only the viewer's own castle is lowered, and only in VR", function()
	eq(Layout.castleHeight(1, 1, false), Layout.CASTLE_HEIGHT, "flat, own castle")
	eq(Layout.castleHeight(0, 1, true), Layout.CASTLE_HEIGHT, "VR, the other castle")
	eq(Layout.castleHeight(0, nil, true), Layout.CASTLE_HEIGHT, "VR, not seated")
	assert(Layout.castleHeight(1, 1, true) < Layout.CASTLE_HEIGHT, "VR, own castle is lower")
end)

print(`{passed} passed, {failed} failed`)
process.exit(if failed == 0 then 0 else 1)
