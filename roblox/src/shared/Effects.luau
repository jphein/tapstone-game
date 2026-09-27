--!strict
-- What to animate, computed from two consecutive views: a port of the headset's
-- rust/tapstone-web/www/xr/src/logic/effects.js (spec 2026-09-25 §3.2), so the table and the headset
-- animate the same match the same way. Pure: no Roblox APIs, tested under lune against the real desk
-- fixture (tests/effects.luau). The board always shows the newest view; these only add motion.
--
-- Seats, lanes and cells in an effect are 0-based, as in effects.js (the arena's numbering);
-- Protocol's 1-based lanes and cells are only used to index the decoded JSON.
--
--   summon {seat, lane, cell, faction, commander}   a unit arrived: the arc from the altar, the rise
--   advance {seat, lane, from, to}                  a unit stepped forward
--   damage {seat, lane, cell, amount}               a unit was struck: stagger + rim flash
--   death {seat, lane, cell, faction}               a unit is gone: the crumble
--   clash {lane}                                    both front cells of a lane were hit at once
--   keepChip {seat, amount}                         a castle lost life: a chip flies off the keep
--   chargeGem {seat}                                a mana gem lit
--   drawFlip {seat, card}                           a card was drawn (name: the viewer's own draws only)
--   commanderFall {seat, lane}, commanderReturn {seat, lane}
--   result {winner}                                 the match ended (winner nil: void)

local Effects = {}

export type Effect = {
	type: string,
	seat: number?,
	lane: number?,
	cell: number?,
	from: number?,
	to: number?,
	amount: number?,
	faction: string?,
	commander: boolean?,
	card: string?,
	winner: number?,
}

local function board(v: any): any
	if v and v.phase == "lobby" and (v.lobby == nil or #v.lobby == 0) and v.last_over ~= nil then
		return v.last_over
	end
	return v
end

-- The unit at 0-based seat s, lane l, cell c, or nil (JSON null decodes to a hole).
local function unitAt(v: any, s: number, l: number, c: number): any
	local seat = v and v.seats and v.seats[s + 1]
	local track = seat and seat.cells and seat.cells[l + 1]
	return track and track[c + 1]
end

function Effects.diff(prev: any, next: any, mySeat: number?): { Effect }
	local a, b = board(prev), board(next)
	local out: { Effect } = {}
	if not b or not b.seats or #b.seats == 0 then
		return out
	end
	local hadBoard = a ~= nil and a.seats ~= nil and #a.seats > 0
	local last = (next and next.last) or {}
	local moved: { [string]: boolean } = {}
	-- Advances: the acting seat's units in one lane shift forward; pair each vanished unit with an
	-- appeared one of the same name further forward in the same lane.
	if hadBoard and last.kind == "Advance" then
		local s = last.seat
		for l = 0, 2 do
			for c = 2, 0, -1 do
				local was = unitAt(a, s, l, c)
				local here = unitAt(b, s, l, c)
				if was and not (here and here.name == was.name) then
					for d = c + 1, 2 do
						local now = unitAt(b, s, l, d)
						local before = unitAt(a, s, l, d)
						if now and now.name == was.name and not moved[`{s}:{l}:{d}`] and not (before and before.name == now.name) then
							table.insert(out, { type = "advance", seat = s, lane = l, from = c, to = d })
							moved[`{s}:{l}:{c}`] = true
							moved[`{s}:{l}:{d}`] = true
							break
						end
					end
				end
			end
		end
	end
	local hit = { { false, false, false }, { false, false, false } } -- front-cell hits, [seat+1][lane+1]
	for s = 0, 1 do
		for l = 0, 2 do
			for c = 0, 2 do
				local was = if hadBoard then unitAt(a, s, l, c) else nil
				local now = unitAt(b, s, l, c)
				if moved[`{s}:{l}:{c}`] then
					if was and now and now.name == was.name and now.damage > was.damage then
						table.insert(out, { type = "damage", seat = s, lane = l, cell = c, amount = now.damage - was.damage })
					end
				elseif now and (not was or was.name ~= now.name) then
					if was then
						table.insert(out, { type = "death", seat = s, lane = l, cell = c, faction = was.faction })
					end
					table.insert(out, { type = "summon", seat = s, lane = l, cell = c, faction = now.faction, commander = now.commander == true })
				elseif was and not now then
					table.insert(out, { type = "death", seat = s, lane = l, cell = c, faction = was.faction })
					if c == 2 then
						hit[s + 1][l + 1] = true
					end
				elseif was and now and now.damage > was.damage then
					table.insert(out, { type = "damage", seat = s, lane = l, cell = c, amount = now.damage - was.damage })
					if c == 2 then
						hit[s + 1][l + 1] = true
					end
				end
			end
		end
	end
	for l = 0, 2 do
		if hit[1][l + 1] and hit[2][l + 1] then
			table.insert(out, { type = "clash", lane = l })
		end
	end
	if hadBoard then
		for s = 0, 1 do
			local was, now = a.seats[s + 1], b.seats[s + 1]
			if now.life < was.life then
				table.insert(out, { type = "keepChip", seat = s, amount = was.life - now.life })
			end
			if now.charged > was.charged then
				table.insert(out, { type = "chargeGem", seat = s })
			end
			if was.commander_returns == 0 and now.commander_returns > 0 then
				table.insert(out, { type = "commanderFall", seat = s, lane = now.commander_lane })
			end
			if was.commander_returns > 0 and now.commander_returns == 0 then
				table.insert(out, { type = "commanderReturn", seat = s, lane = now.commander_lane })
			end
		end
		local ls = last.seat
		if last.kind == "Draw" and type(ls) == "number" and b.seats[ls + 1] and b.seats[ls + 1].hand > a.seats[ls + 1].hand then
			table.insert(out, { type = "drawFlip", seat = ls, card = if ls == mySeat then last.card else nil })
		end
	end
	if b.phase == "over" and (not a or a.phase ~= "over") then
		table.insert(out, { type = "result", winner = b.winner })
	end
	return out
end

-- How long each effect plays, in seconds (effects.js DURATION, ms / 1000). One big effect at a time.
Effects.DURATION = {
	summon = 0.6, advance = 0.25, damage = 0.25, death = 0.4, clash = 0.35, keepChip = 0.3,
	chargeGem = 0.25, drawFlip = 0.25, commanderFall = 0.5, commanderReturn = 0.6, result = 2.0,
} :: { [string]: number }
local DEFAULT = 0.3

-- The queue the client drains. Past `maxPending` it drops the oldest non-result effect: the board
-- already shows the newest state, so only motion is lost, never a result. Never behind the chain.
export type Queue = {
	maxPending: number,
	items: { Effect },
	busyUntil: number?,
	push: (self: Queue, effects: { Effect }) -> (),
	next: (self: Queue, now: number) -> Effect?,
}

local Queue = {}
Queue.__index = Queue

function Queue.push(self: Queue, effects: { Effect })
	for _, e in effects do
		table.insert(self.items, e)
	end
	while #self.items > self.maxPending do
		local drop = nil
		for i, e in self.items do
			if e.type ~= "result" then
				drop = i
				break
			end
		end
		if not drop then
			break
		end
		table.remove(self.items, drop)
	end
end

-- The effect to start now, or nil while one is still playing or the queue is empty.
function Queue.next(self: Queue, now: number): Effect?
	if self.busyUntil and now < self.busyUntil then
		return nil
	end
	self.busyUntil = nil
	local e = table.remove(self.items, 1)
	if not e then
		return nil
	end
	self.busyUntil = now + (Effects.DURATION[e.type] or DEFAULT)
	return e
end

function Effects.queue(maxPending: number?): Queue
	return setmetatable({ maxPending = maxPending or 8, items = {}, busyUntil = nil }, Queue) :: any
end

return Effects
