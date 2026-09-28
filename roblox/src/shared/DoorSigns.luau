--!strict
-- When a door in the Tea House stirs: a card is cast (a unit or a spell) or a seat wins, read from
-- the arena's views, the same bodies the board draws. A cast stirs the door of the CARD's faction,
-- so a neutral card stirs the Hearthlands door (lead decision 2026-09-28, under 0039); a win stirs
-- the winning seat's. The headset's teahouse reads the same rules (xr/src/logic/doors.js). The door answers with a glow for a cast and a
-- breath of its weather for a win (the client draws that). Spectacle only: a door never carries
-- rules or offers a choice (0039), and nothing here holds game state beyond "what have I already
-- shown".
--
-- The view's `last` is the arena's own record of the latest move ({seq, seat, kind, card}, view.rs
-- `LastEvent`); a cast is kind CastUnit or CastSpell. A win is the board's winner appearing. The
-- first view a client sees only primes the state, so joining mid-match (or a respawned script)
-- never replays an old cast. Pure: no Roblox APIs; tests/run.luau loads it through tests/place.luau
-- (which resolves `script.Parent` as Rojo lays the place out) and plays it a real match.

local Protocol = require(script.Parent.Protocol)

local DoorSigns = {}

export type State = { primed: boolean, match: string?, seq: number, won: boolean }
export type Stir = { kind: string, faction: string, seat: number } -- kind: "cast" | "win"

type LastEvent = { seq: number?, seat: number?, kind: string?, card: string? }

DoorSigns.CASTS = { CastUnit = true, CastSpell = true } :: { [string]: boolean }

-- Every set 1 card's faction, by the name the view's `last.card` carries. game/cards/set1/*.toml is
-- the source: tests/teahouse.luau fails if a card is missing, extra or has another faction.
DoorSigns.CARD_FACTION = {
	["Ember Castle"] = "ember",
	["Tide Castle"] = "tide",
	["Cinder Whelp"] = "ember",
	["Ashen Vanguard"] = "ember",
	["Hearth Warden"] = "ember",
	["Flare"] = "ember",
	["Forge Runner"] = "ember",
	["Bellows Raider"] = "ember",
	["Slag Brute"] = "ember",
	["Magma Burst"] = "ember",
	["Reef Archer"] = "tide",
	["Tidecaller"] = "tide",
	["Pearl Shieldbearer"] = "tide",
	["Tidal Lash"] = "tide",
	["Undertow"] = "tide",
	["Riptide"] = "tide",
	["Brine Skimmer"] = "tide",
	["Trench Leviathan"] = "tide",
	["Deep Breath"] = "neutral",
	["Mend"] = "neutral",
} :: { [string]: string }

function DoorSigns.new(): State
	return { primed = false, match = nil, seq = -1, won = false }
end

local function factionOf(b: Protocol.View, seat: number?): string?
	if type(seat) ~= "number" then
		return nil
	end
	local s = b.seats[seat + 1]
	return if s then s.faction else nil
end

-- Reads one view and returns what stirred since the last one (usually nothing).
function DoorSigns.step(state: State, v: Protocol.View): { Stir }
	local b = Protocol.boardOf(v)
	local out: { Stir } = {}
	if b.match_id ~= nil and b.match_id ~= state.match then
		-- A new match: its events are all new. (A lobby frame keeps the finished board, with the
		-- same match id, so the old win isn't read twice.)
		state.match = b.match_id
		state.seq = -1
		state.won = false
	end
	local last = (b :: any).last :: LastEvent?
	local seq = if last and type(last.seq) == "number" then last.seq else nil
	local winner = Protocol.winnerOf(v)
	if not state.primed then
		state.primed = true
		state.seq = seq or -1
		state.won = winner ~= nil
		return out
	end
	if last and seq ~= nil and seq > state.seq then
		state.seq = seq
		-- The card's own faction; a card the list doesn't know falls back to the seat that cast it.
		local faction = DoorSigns.CARD_FACTION[last.card or ""] or factionOf(b, last.seat)
		if DoorSigns.CASTS[last.kind or ""] and faction then
			table.insert(out, { kind = "cast", faction = faction, seat = last.seat :: number })
		end
	end
	if winner ~= nil and not state.won then
		state.won = true
		local faction = factionOf(b, winner)
		if faction then
			table.insert(out, { kind = "win", faction = faction, seat = winner })
		end
	end
	return out
end

return DoorSigns
