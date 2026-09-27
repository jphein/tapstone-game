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
	remote_codes: { string? }?,
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

-- How to draw a unit for this viewer (0027: "mine are objects, theirs are entries"). `mySeat` is
-- the viewer's seat, or nil for someone not seated, who sees both sides as objects.
export type Style = "object" | "entry"
function Protocol.styleFor(unitSeat: number, mySeat: number?): Style
	if mySeat == nil or unitSeat == mySeat then
		return "object"
	end
	return "entry"
end

-- The join codes still open, by seat (0 or 1). Two shapes, both read: `remote_codes`, one entry
-- per slot (null once that slot has joined, the key absent when nothing is open); and the one-slot
-- `remote_code`, which is always seat 1's (the remote shrine claims after the table's shrine).
-- Holes are read by index.
function Protocol.remoteCodes(v: View): { [number]: string }
	local out: { [number]: string } = {}
	local codes = v.remote_codes
	if codes == nil and type(v.remote_code) == "string" then
		out[1] = v.remote_code
		return out
	end
	if codes then
		for seat = 0, 1 do
			local c = codes[seat + 1]
			if type(c) == "string" then
				out[seat] = c
			end
		end
	end
	return out
end

-- The codes to rejoin with once a match is over: the open codes of the next match's lobby, slot
-- order, in either shape. `sawOver` is whether this client saw its match end; before that, or
-- outside a lobby frame, or while nothing is offered yet, the answer is nil (keep waiting). The
-- codes come only from the table's own view, to a player already seated at it.
function Protocol.rejoinCodes(v: View, sawOver: boolean): { string }?
	if not sawOver or v.phase ~= "lobby" then
		return nil
	end
	local open = Protocol.remoteCodes(v)
	local out = {}
	for seat = 0, 1 do
		if open[seat] then
			table.insert(out, open[seat])
		end
	end
	return if #out > 0 then out else nil
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
