--!strict
-- The Tapstone table in Roblox, server side: build the table, join the arena's remote seats (one
-- or two), poll the views, and relay each seated player's moves for their own seat. Settings and
-- status are attributes on ServerStorage.TapstoneConfig:
--
--   set at publish          ConfigUrl (string) optional: a fixed URL holding tonight's table, e.g.
--                                     https://api.github.com/gists/<id> (a SECRET gist the launcher
--                                     writes). This attribute lives only in ServerStorage, which never
--                                     replicates to clients: no player can read the URL. The server
--                                     fetches it at start and when the arena is unreachable, and
--                                     writes ArenaUrl/JoinCodeA/JoinCodeB from it (TableConfig).
--   set by the operator     ArenaUrl  (string) the tunnel, e.g. https://words-here.trycloudflare.com
--                           JoinCodeA, JoinCodeB (string) this match's codes, one per remote seat,
--                                     in any order (the arena's join reply says whose seat it is)
--                           AutoPlay  (string) "off" (default) | "first-useful": play every joined
--                                     seat automatically, through the relay when someone sits there
--                           Propose   (bool)   default true; false = relay nothing (the stall control)
--                           AutoRejoin (bool)  default true: after a match, join the next one with
--                                     the codes its lobby offers, so codes are set only once
--   written by this script  Seats ("0,1" = joined seats), ViewN, Phase, Seq, Winner (-1 none),
--                           Proposals, LastError, and two that survive a rematch: LastWinner (the
--                           winner of the last finished match, -1 before any) and Matches (finished)
--
-- A client never talks HTTP: it gets the arena's bodies verbatim over RemoteEvents (a decoded view
-- has nil holes, which a RemoteEvent may drop: "avoid nil values for any index", Roblox remote.md).

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local Protocol = require(ReplicatedStorage:WaitForChild("TapstoneShared"):WaitForChild("Protocol"))
local TableConfig = require(ReplicatedStorage:WaitForChild("TapstoneShared"):WaitForChild("TableConfig"))
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
	Seats = "",
	ViewN = 0,
	Phase = "",
	Seq = 0,
	Winner = -1,
	Proposals = 0,
	LastError = "",
	LastWinner = -1,
	Matches = 0,
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
menuEvent.Name = "Menu" -- server → a seated player: the raw /remote/choices body of their seat
menuEvent.Parent = remotes
local chooseEvent = Instance.new("RemoteEvent")
chooseEvent.Name = "Choose" -- seated player → server: (menu n, 0-based index), for their own seat
chooseEvent.Parent = remotes
local getView = Instance.new("RemoteFunction")
getView.Name = "GetView" -- a client that starts late asks for the last view body
getView.Parent = remotes
remotes:SetAttribute("Message", "")
remotes.Parent = ReplicatedStorage

local clients: { [number]: ArenaClient.Client } = {} -- by arena seat
local setSeats: () -> ()
-- Joined, but no seat known yet ("seat": null until the claim lands). Each round of menus asks
-- their `choices`, whose `seat` is the authority: a code names a slot, and the seat comes from
-- lobby claim order, so nothing in the views can say it.
local pending: { ArenaClient.Client } = {}
local lastView = ""
local menus: { [number]: { n: number?, body: string } } = {}

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

local function propose(seat: number, n: number, i: number): string
	local c = clients[seat]
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

-- The automatic player (AutoPlay = "first-useful"): the web gate's choice. A seat someone sits in
-- is played through the same relay a click uses, so the playtest exercises seating and the door.
local function autoplay(seat: number)
	local m = menus[seat]
	if attr("AutoPlay", "off") ~= "first-useful" or m == nil or m.n == nil or m.body == "" then
		return
	end
	local ok, msg = pcall(HttpService.JSONDecode, HttpService, m.body)
	if not ok or type(msg) ~= "table" or type(msg.menu) ~= "table" then
		return
	end
	local i = Protocol.firstUseful(msg.menu)
	if i == nil then
		return
	end
	local p = TableServer.playerAt(seat)
	if p then
		TableServer.relay(p, m.n, i)
	else
		propose(seat, m.n :: number, i)
	end
end

-- Fetch one seat's menu with its own token, hand it to that seat's player, then autoplay it. The
-- answer's `seat` is the authority: if it names another seat than the one this client was filed
-- under, the client moves there first, so a click is never sent with the other seat's token.
local function publishMenu(seat: number)
	local c = clients[seat]
	if c == nil then
		return
	end
	local n, body = ArenaClient.choices(c)
	if c.seat ~= nil and c.seat ~= seat then
		local now = c.seat :: number
		clients[seat] = nil
		menus[seat] = nil
		if clients[now] ~= nil then
			fail(`two clients claim seat {now}: check JoinCodeA and JoinCodeB`)
			return
		end
		clients[now] = c
		setSeats()
		seat = now
	end
	menus[seat] = { n = n, body = body }
	local p = TableServer.playerAt(seat)
	if p and body ~= "" then
		menuEvent:FireClient(p, body)
	end
	autoplay(seat)
end

local function publishMenus()
	-- Settle pending clients first: their choices answer says whose seat they are.
	for k = #pending, 1, -1 do
		local c = pending[k]
		ArenaClient.choices(c)
		local seat = c.seat
		if seat ~= nil and clients[seat] == nil then
			clients[seat] = c
			table.remove(pending, k)
			setSeats()
		end
	end
	local seats = {}
	for seat in clients do
		table.insert(seats, seat)
	end
	for _, seat in seats do
		publishMenu(seat)
	end
end

-- Switching autoplay on must act on the menus already held: when it's a seat's move no new view
-- arrives until it moves, so waiting for the next view would stall the very run it starts.
config:GetAttributeChangedSignal("AutoPlay"):Connect(function()
	for seat in clients do
		autoplay(seat)
	end
end)

-- ---- The fixed config URL (published places) ------------------------------------------------
-- Fetched at start and when the arena looks unreachable, never on a timer, and never more often
-- than `interval`: GitHub allows 60 unauthenticated API calls an hour per IP, and Roblox servers
-- share IPs. Measured 2026-09-26: the gist API showed an edit 0-5 s later (3 samples); it sends
-- cache-control max-age=60, so allow up to a minute.
local wantConfig = true
local function fetchConfig(url: string): (TableConfig.Config?, string)
	local ok, res = pcall(function()
		return HttpService:RequestAsync({
			Url = url,
			Method = "GET",
			Headers = { Accept = "application/vnd.github+json" },
		})
	end)
	if not ok then
		return nil, tostring(res)
	end
	if not res.Success then
		return nil, `HTTP {res.StatusCode} {res.StatusMessage}`
	end
	return TableConfig.read(res.Body, function(body: string): any
		return HttpService:JSONDecode(body)
	end, os.time())
end

local function applyConfig(cfg: TableConfig.Config)
	local a, b = cfg.codes[1], cfg.codes[2] or ""
	if attr("ArenaUrl", "") ~= cfg.url or attr("JoinCodeA", "") ~= a or attr("JoinCodeB", "") ~= b then
		say(`tonight's table: {cfg.url}`)
		config:SetAttribute("ArenaUrl", cfg.url)
		config:SetAttribute("JoinCodeA", a)
		config:SetAttribute("JoinCodeB", b)
	end
end

task.spawn(function()
	local interval, last = 60, -math.huge
	while true do
		local url: string = attr("ConfigUrl", "")
		if wantConfig and url ~= "" and os.clock() - last >= interval then
			last = os.clock()
			wantConfig = false
			local cfg, why = fetchConfig(url)
			if cfg then
				interval = 60
				applyConfig(cfg)
			else
				interval = math.min(600, interval * 2)
				wantConfig = true
				if attr("ArenaUrl", "") == "" then
					fail(`config: {why}; next try in {interval} s`)
				else
					-- An arena was set by hand (Studio, set-config.py): don't cover its status with
					-- "no table tonight" from an empty gist.
					print(`[Tapstone] config: {why}; next try in {interval} s`)
				end
			end
		end
		task.wait(5)
	end
end)

-- A test door into THIS server's TableServer, for the StudioMCP playtest. A chunk run through
-- StudioMCP's execute_luau gets its own copy of every ModuleScript (a separate require cache), so
-- it can't see the running server's seating or relay; it asks through this instead. ServerStorage
-- never replicates, so no client can call it.
local testDoor = Instance.new("BindableFunction")
testDoor.Name = "TapstoneTest"
testDoor.OnInvoke = function(action: string, p: Player?, n: any, i: any): (any, any)
	if action == "seatOf" then
		return TableServer.seatOf(p)
	elseif action == "relay" then
		return TableServer.relay(p, n, i)
	end
	return nil, "unknown action"
end
testDoor.Parent = ServerStorage

local chairs = Stage.build()
TableServer.init(chairs, remotes, function(seat: number, n: number, i: number): string
	local r = propose(seat, n, i)
	if r == "stale" then
		publishMenu(seat) -- the menu moved on: show the player the current one
	end
	return r
end, function(p: Player, seat: number)
	say(`{p.Name} takes seat {seat}`)
	local m = menus[seat]
	if m and m.body ~= "" then
		menuEvent:FireClient(p, m.body)
	end
	autoplay(seat)
end)

local sawOver = false -- this server saw its match end since it last joined

local function onView(body: string)
	lastView = body
	local ok, msg = pcall(HttpService.JSONDecode, HttpService, body)
	if ok and type(msg) == "table" and type(msg.view) == "table" then
		local v: Protocol.View = msg.view
		if next(clients) ~= nil and (v.phase == "over" or Protocol.winnerOf(v) ~= nil) then
			sawOver = true
		end
		local again = Protocol.rejoinCodes(v, sawOver)
		if again and attr("AutoRejoin", true) ~= false then
			-- Writing the codes is the operator's own path: the loop sees them change and rejoins.
			sawOver = false
			say(`next match: joining with {table.concat(again, ", ")}`)
			config:SetAttribute("JoinCodeA", again[1])
			config:SetAttribute("JoinCodeB", again[2] or "")
		end
		local b = Protocol.boardOf(v)
		config:SetAttribute("Phase", b.phase)
		config:SetAttribute("Seq", b.seq or 0)
		local w = Protocol.winnerOf(v)
		config:SetAttribute("Winner", w or -1)
		-- Sticky across rematches: a rematch clears Winner within seconds (B6, 2026-09-26).
		if w ~= nil and v.phase == "over" then
			config:SetAttribute("LastWinner", w)
			config:SetAttribute("Matches", attr("Matches", 0) + 1)
		end
	end
	viewEvent:FireAllClients(body)
	publishMenus()
end

local function codes(): { string }
	local out = {}
	for _, name in { "JoinCodeA", "JoinCodeB" } do
		local c = attr(name, "")
		if type(c) == "string" and c ~= "" then
			table.insert(out, c)
		end
	end
	return out
end

local function codesKey(): string
	return `{attr("ArenaUrl", "")}|{table.concat(codes(), ",")}`
end

-- Waits until the operator changes ArenaUrl or a join code.
local function waitForSettingsChange()
	local changed = Instance.new("BindableEvent")
	local conns = {}
	for _, name in { "ArenaUrl", "JoinCodeA", "JoinCodeB" } do
		table.insert(conns, config:GetAttributeChangedSignal(name):Connect(function()
			changed:Fire()
		end))
	end
	changed.Event:Wait()
	for _, c in conns do
		c:Disconnect()
	end
	changed:Destroy()
end

function setSeats()
	local joined = {}
	for seat = 0, 1 do
		if clients[seat] then
			table.insert(joined, tostring(seat))
		end
	end
	config:SetAttribute("Seats", table.concat(joined, ","))
	remotes:SetAttribute("Seats", table.concat(joined, ","))
end

-- The loop. `n` lives outside it: the arena numbers views for its whole life, so a rejoin for the
-- next match carries on from the last view seen instead of replaying the old match (and its
-- winner). A finished match's tokens still read views until the next join, so the final board
-- stays up; the operator starts the next match by setting its codes, and the loop rejoins.
local function run()
	local n = 0
	while true do
		local url: string = attr("ArenaUrl", "")
		local list = codes()
		if url == "" or #list == 0 then
			say("Set ArenaUrl and JoinCodeA (and JoinCodeB) on ServerStorage.TapstoneConfig")
			waitForSettingsChange()
			continue
		end
		local key = codesKey()
		for _, c in clients do
			c.stopped = true
		end
		for _, c in pending do
			c.stopped = true
		end
		table.clear(clients)
		table.clear(pending)
		table.clear(menus)
		sawOver = false
		local problems = {}
		for _, code in list do
			local c = ArenaClient.new(url)
			c.onRetry = function(what: string, attempt: number, wait: number, reason: string)
				fail(`{what}: {reason}; retry {attempt} in {wait} s`)
				if attempt >= 3 then
					wantConfig = true -- the arena looks gone: maybe tonight's table moved
				end
			end
			local result, message = ArenaClient.join(c, code)
			if result == "joined" and c.seat ~= nil then
				clients[c.seat :: number] = c
			elseif result == "joined" then
				table.insert(pending, c)
			else
				table.insert(problems, `{code}: {message}`)
			end
		end
		setSeats()
		if #problems > 0 then
			wantConfig = true -- a refused code may be last match's: check the config again
		end
		if next(clients) == nil and #pending == 0 then
			fail(table.concat(problems, "; "))
			waitForSettingsChange()
			continue
		end
		config:SetAttribute("LastError", table.concat(problems, "; "))
		say(`joined the arena: seat(s) {attr("Seats", "")}{if #pending > 0 then `, {#pending} pending` else ""}`)
		local poller: ArenaClient.Client? = pending[1]
		for _, c in clients do
			poller = poller or c
		end
		local refused = false
		while codesKey() == key do
			local r, newN, body = ArenaClient.pollView(poller :: ArenaClient.Client, n)
			if r == "view" then
				n = newN
				config:SetAttribute("ViewN", n)
				onView(body)
			elseif r == "unauthorized" then
				fail("the arena refused the token (a newer match was joined): set this match's codes")
				refused = true
				break
			elseif r == "error" then
				fail(body)
				task.wait(2)
			end
		end
		if refused then
			waitForSettingsChange()
		end
	end
end

task.spawn(run)
print("[Tapstone] table server ready")
