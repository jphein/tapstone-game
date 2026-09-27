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
	seat: number?, -- the arena seat: from join if non-null, then from choices (the authority)
	code: string?, -- the code this client joined with (a slot's code, for messages only)
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
		code = nil,
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

-- POST /remote/join {"code"} → 200 {"token","seat"} | 403 wrong code | 409 taken | 429 this source sent
-- too many wrong codes: retried by `send`, so a seat waits it out (0038, amended 2026-09-27; an
-- older arena answered 423, locked for everyone until the next match).
-- The arena compares the code exactly, in capitals (Part A's contract), so a code typed in lower
-- case is sent upper case; spaces around it are dropped.
function ArenaApi.join(c: Client, code: string): (JoinResult, string)
	local clean = string.upper((string.gsub(code, "^%s*(.-)%s*$", "%1")))
	local r = ArenaApi.send(c, "join", "POST", "/remote/join", c.deps.encode({ code = clean }))
	if r.status == 200 then
		local msg = decodeTable(c, r.body)
		if msg and type(msg.token) == "string" and (msg.seat == nil or type(msg.seat) == "number") then
			c.token = msg.token
			c.seat = msg.seat
			c.code = clean
			return "joined", if msg.seat ~= nil then `seat {msg.seat}` else "seat pending"
		end
		return "error", "join: the reply wasn't {token, seat}"
	elseif r.status == 403 then
		return "wrong code", "the join code was refused"
	elseif r.status == 423 then
		return "locked", "joining is locked for this match (an arena from before 2026-09-27: 10 wrong codes)"
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

-- GET /remote/choices → 200 {"n","seat","menu"}: the menu number and the raw body, or nil and "".
-- The menu is empty when it isn't this seat's move or a tap is pending; a finished match's token
-- gets 401 here at once. `seat` is this token's ARENA seat once its claim has landed (null
-- before): the authority for which seat this client plays. A join code names a slot, and the seat
-- comes from lobby claim order, so no view can say it (the lead, 2026-09-26).
function ArenaApi.choices(c: Client): (number?, string)
	local r = ArenaApi.send(c, "choices", "GET", "/remote/choices", nil)
	if r.status == 200 then
		local msg = decodeTable(c, r.body)
		if msg and type(msg.n) == "number" and type(msg.menu) == "table" then
			if type(msg.seat) == "number" then
				c.seat = msg.seat
			end
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
