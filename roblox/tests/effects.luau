--!strict
-- Effects (the headset's effects.js, ported): replay the real desk match and check every effect
-- against the record that caused it, the same assertions as rust/tapstone-web/www/xr/test/logic.test.js.
local Effects = require("../src/shared/Effects")

return function(test: (string, () -> ()) -> (), eq: (any, any, string) -> (), views: { any })
	local all = {}
	for i = 2, #views do
		table.insert(all, { i = i, v = views[i], fx = Effects.diff(views[i - 1], views[i], 0) })
	end
	local function count(kind: string): number
		local n = 0
		for _, x in all do
			for _, e in x.fx do
				if e.type == kind then
					n += 1
				end
			end
		end
		return n
	end
	local function records(kind: string): number
		local n = 0
		for _, v in views do
			if v.last and v.last.kind == kind then
				n += 1
			end
		end
		return n
	end
	local final = views[#views].last_over or views[#views]

	test("effects: every castle life lost is a keep chip, exactly", function()
		local lost = { 0, 0 }
		for _, x in all do
			for _, e in x.fx do
				if e.type == "keepChip" then
					lost[(e.seat :: number) + 1] += e.amount :: number
				end
			end
		end
		eq(lost[1], 20 - final.seats[1].life, "seat 0 life lost")
		eq(lost[2], 20 - final.seats[2].life, "seat 1 life lost")
		assert(lost[1] + lost[2] > 0, "some keep was chipped")
	end)

	test("effects: every charge record lights exactly one gem", function()
		local charges = records("Charge")
		assert(charges > 0, "the match charges")
		eq(count("chargeGem"), charges, "gems")
	end)

	test("effects: every draw flips exactly one card; only the drawer sees its name", function()
		local draws = records("Draw")
		assert(draws > 0, "the match draws")
		eq(count("drawFlip"), draws, "flips")
		for _, x in all do
			for _, e in x.fx do
				if e.type == "drawFlip" then
					eq(e.card ~= nil, e.seat == 0, `view {x.i}: card name shown`)
				end
			end
		end
	end)

	test("effects: every unit cast summons exactly once, and both commanders arrive", function()
		local casts, commanders = 0, 0
		for _, x in all do
			local plain = 0
			for _, e in x.fx do
				if e.type == "summon" then
					if e.commander then
						commanders += 1
					else
						plain += 1
					end
				end
			end
			if x.v.last and x.v.last.kind == "CastUnit" then
				casts += 1
				eq(plain, 1, `view {x.i}: a cast summons one`)
			end
		end
		eq(casts, records("CastUnit"), "casts")
		assert(commanders >= 2, "both commanders")
	end)

	test("effects: an advance is a move, never a death plus a summon", function()
		for _, x in all do
			if x.v.last and x.v.last.kind == "Advance" then
				for _, e in x.fx do
					assert(e.type ~= "summon", `view {x.i}: an advance summoned`)
				end
			end
		end
		assert(count("advance") > 0, "the match advances")
	end)

	test("effects: deaths crumble and clashes land, on the real match", function()
		assert(count("death") > 0, "someone dies")
		assert(count("damage") > 0, "someone is struck")
		for _, x in all do
			for _, e in x.fx do
				if e.type == "clash" then
					assert(e.lane ~= nil and e.lane >= 0 and e.lane <= 2, "a clash names a lane")
				end
			end
		end
	end)

	test("effects: the match ends with one result, naming the winner", function()
		local results = {}
		for _, x in all do
			for _, e in x.fx do
				if e.type == "result" then
					table.insert(results, e)
				end
			end
		end
		eq(#results, 1, "results")
		eq(results[1].winner, final.winner, "winner")
	end)

	test("effects: a clash is both front cells struck in one lane", function()
		local function seat(cells: any): any
			return { castle = "C", faction = "ember", life = 20, charged = 0, spent = 0, hand = 0, deck_left = 0, owed_draws = 0, cells = cells, commander_returns = 0, commander_lane = 1 }
		end
		local function u(name: string, dmg: number): any
			return { name = name, faction = "ember", attack = 1, toughness = 3, damage = dmg, entered_round = 0, commander = false }
		end
		local before = { phase = "playing", seats = { seat({ {}, { nil, nil, u("A", 0) }, {} }), seat({ {}, { nil, nil, u("B", 0) }, {} }) }, lobby = {} }
		local after = { phase = "playing", seats = { seat({ {}, { nil, nil, u("A", 1) }, {} }), seat({ {}, { nil, nil, u("B", 2) }, {} }) }, lobby = {} }
		local fx = Effects.diff(before, after, nil)
		local kinds = {}
		for _, e in fx do
			table.insert(kinds, e.type)
		end
		eq(table.concat(kinds, ","), "damage,damage,clash", "effects")
		eq(fx[3].lane, 1, "clash lane")
		eq(fx[2].amount, 2, "damage amount")
	end)

	test("effects: the queue plays one at a time and compresses a backlog, keeping the result", function()
		local q = Effects.queue(3)
		q:push({ { type = "damage" }, { type = "death" }, { type = "keepChip" }, { type = "chargeGem" }, { type = "result", winner = 0 } })
		eq(#q.items, 3, "kept")
		eq((q:next(0) :: any).type, "keepChip", "the oldest were dropped")
		eq(q:next(0.1), nil, "still playing")
		eq((q:next(0.3) :: any).type, "chargeGem", "next")
		eq((q:next(0.6) :: any).type, "result", "the result survives")
		eq(q:next(10), nil, "empty")
		-- the result first in line: compressing must drop the motion behind it, never the result
		local r = Effects.queue(2)
		r:push({ { type = "result", winner = 1 } })
		r:push({ { type = "damage" }, { type = "death" } })
		eq((r:next(0) :: any).type, "result", "an old result is kept")
		eq((r:next(5) :: any).type, "death", "the motion was dropped instead")
	end)
end
