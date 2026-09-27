--!strict
-- The Tea House and the Dueling Grounds (0039): tests/run.luau calls this with its `test` and `eq`.
-- Most checks build the real place under lune (tests/place.luau): Stage.build(), BoardView.create()
-- and TeaHouseStage.build(), then measure the parts they made, so the checked thing and the
-- checking thing are one object. Each check was seen red once, by a perturbation of the thing it
-- guards (the lane log and the PR list them).
local fs = require("@lune/fs")
local roblox = require("@lune/roblox")
local serde = require("@lune/serde")

local Place = require("./place")
local L = require("../src/shared/TeaHouseLayout")

type Point = { x: number, y: number, z: number }

local FIXTURE = "../rust/tapstone-arena/web/fixtures/desk-seed11.jsonl"

local function pt(v: any): Point
	return { x = v.X, y = v.Y, z = v.Z }
end

-- A world with the table room, the board (flat) and the Tea House, all from the real scripts.
local function world()
	local p = Place.new()
	local chairs = p.require("server/Stage").build()
	Place.settle(p.workspace) -- before BoardView, which draws on the table top's CFrame
	p.require("client/BoardView").create(false)
	local built = p.require("server/TeaHouseStage").build()
	return p, chairs, built
end

-- Does any part's box (axis-aligned around its corners) contain `q`?
local function aabb(entry: { corners: { any } }): (Point, Point)
	local lo = { x = math.huge, y = math.huge, z = math.huge }
	local hi = { x = -math.huge, y = -math.huge, z = -math.huge }
	for _, c in entry.corners do
		lo.x, lo.y, lo.z = math.min(lo.x, c.X), math.min(lo.y, c.Y), math.min(lo.z, c.Z)
		hi.x, hi.y, hi.z = math.max(hi.x, c.X), math.max(hi.y, c.Y), math.max(hi.z, c.Z)
	end
	return lo, hi
end

local function overlaps(alo: Point, ahi: Point, blo: Point, bhi: Point): boolean
	return alo.x < bhi.x and ahi.x > blo.x and alo.y < bhi.y and ahi.y > blo.y and alo.z < bhi.z and ahi.z > blo.z
end

return function(test: (string, () -> ()) -> (), eq: (any, any, string) -> ())
	-- The instrument first: the harness must see the place as Roblox would, or every geometric
	-- check below measures lune's quirks instead (tests/place.luau).
	test("harness: a chair faces the table, and a Position write moves its part, as in Roblox", function()
		local p, chairs = world()
		eq(chairs[1].CFrame.LookVector.Z < -0.99, true, "seat 1's chair (at +Z) looks toward -Z")
		eq(chairs[0].CFrame.LookVector.Z > 0.99, true, "seat 0's chair (at -Z) looks toward +Z")
		local top = p.workspace.TapstoneTable.Top
		eq(top.CFrame.Position.Y, 3.5, "Stage wrote the top's Position; the part is there")
		eq(p.workspace.TapstoneTable.Floor.CFrame.Position.Y, -0.5, "and the floor's")
		local cell = p.workspace.TapstoneBoard:FindFirstChild("Cell10")
		assert(cell.CFrame.Position.Y > 4, `BoardView drew on the settled top ({cell.CFrame.Position.Y})`)
	end)

	test("tea house: seven doors, the red door and the six realms of 0039, each in a wall, facing in, apart", function()
		local want = {
			red = "The Dueling Grounds", hearthlands = "The Hearthlands", deeptides = "The Deep Tides",
			forgepeaks = "The Forge Peaks", wanderingcourts = "The Wandering Courts", starfields = "The Star Fields",
			dreaming = "The Dreaming",
		}
		local n = 0
		for _, d in L.DOORS do
			n += 1
			eq(want[d.id], d.realm, `door {d.id}'s realm`)
			local f = L.doorFrame(d)
			local o = L.ORIGIN
			local onWall = math.abs(math.abs(f.at.x - o.x) - L.HALF) < 1e-9 or math.abs(math.abs(f.at.z - o.z) - L.HALF) < 1e-9
			assert(onWall, `{d.id}: not on a wall's inner face`)
			assert(f.inward.x * (o.x - f.at.x) + f.inward.z * (o.z - f.at.z) > 0, `{d.id}: faces out of the hall`)
			-- Clear of the corner pillars (2 studs square in each corner).
			assert(math.abs(d.along) + L.FRAME_WIDTH / 2 <= L.HALF - 2, `{d.id}: its frame runs into a corner`)
		end
		eq(n, 7, "doors")
		for _, wall in L.WALL_NAMES do
			local ds = L.doorsIn(wall)
			for k = 2, #ds do
				assert(ds[k].along - ds[k - 1].along >= L.FRAME_WIDTH + 1, `{wall}: {ds[k - 1].id} and {ds[k].id} overlap`)
			end
		end
		eq((L.door("deeptides") :: any).color[3] > 150, true, "canon: the Deep Tides' door is blue")
		local red = L.door("red") :: any
		assert(red.color[1] > 150 and red.color[2] < 60 and red.color[3] < 60, "canon: the red door is red")
		for faction, id in L.FACTION_DOOR do
			assert(L.door(id) ~= nil and id ~= "red", `{faction}'s door {id} is a realm door`)
		end
		eq(L.FACTION_DOOR.tide, "deeptides", "RULED (0039): Tide ↔ Deep Tides")
		eq(L.FACTION_DOOR.ember, "forgepeaks", "RULED (0039): Ember ↔ Forge Peaks")
	end)

	test("lore: the canon realm names, and every look the bible doesn't state marked PROPOSAL", function()
		-- bible Part II: The Realms, all six, in its order; each has exactly one door, and the red one
		-- leads to the Dueling Grounds.
		local realms = { "The Hearthlands", "The Deep Tides", "The Forge Peaks", "The Wandering Courts", "The Star Fields", "The Dreaming" }
		eq(#L.CANON_REALMS, #realms, "canon realms")
		for k, r in realms do
			eq(L.CANON_REALMS[k], r, `canon realm {k}`)
			local doors = 0
			for _, d in L.DOORS do
				doors += if d.realm == r then 1 else 0
			end
			eq(doors, 1, `{r}: doors`)
		end
		eq((L.door("red") :: any).realm, "The Dueling Grounds", "the red door's realm")
		-- What the bible states about a door's look, and nothing more: the red door is deep red (Ch 22),
		-- the blue door is blue (Ch 35). This list is the test's own reading, not the module's.
		local stated = { ["red.color"] = true, ["deeptides.color"] = true }
		local seen, proposed = 0, 0
		for _, d in L.DOORS do
			for field, source in d.canon do
				assert(table.find(L.LOOK_FIELDS, field) ~= nil, `{d.id}: canon for {field}, which isn't a look field`)
				assert(string.find(source, "^bible ") ~= nil, `{d.id}.{field}: canon without a bible citation`)
				assert(stated[`{d.id}.{field}`], `{d.id}.{field}: marked canon, but the bible doesn't state it`)
				seen += 1
			end
			for _, field in L.LOOK_FIELDS do
				if d.canon[field] == nil then
					proposed += 1
					eq(d.proposal, true, `{d.id}.{field}: not canon, so the door must carry PROPOSAL`)
				end
			end
		end
		eq(seen, 2, "canon look fields (both of the bible's)")
		eq(proposed, #L.DOORS * #L.LOOK_FIELDS - 2, "proposed look fields: every other one")
	end)

	test("tea house: each wall's spans and door openings tile it exactly, never overlapping", function()
		local reach = L.HALF + L.WALL
		for _, wall in L.WALL_NAMES do
			local spans = L.wallSpans(wall)
			local ds = L.doorsIn(wall)
			eq(#spans, #ds + 1, `{wall}: one span more than doors`)
			eq(spans[1].from, -reach, `{wall}: starts in the corner`)
			eq(spans[#spans].to, reach, `{wall}: ends in the corner`)
			for k, d in ds do
				eq(spans[k].to, d.along - L.DOOR_WIDTH / 2, `{wall}: span {k} stops at {d.id}'s opening`)
				eq(spans[k + 1].from, d.along + L.DOOR_WIDTH / 2, `{wall}: span {k + 1} starts after it`)
			end
			for _, s in spans do
				assert(s.to > s.from, `{wall}: an empty or inverted span`)
			end
		end
	end)

	test("tea house: the built doors match the layout, and only the red door and the gate are ways through", function()
		local p, _, built = world()
		local doors = built.house:FindFirstChild("Doors")
		local function count(m: any, class: string): number
			local k = 0
			for _, d in m:GetDescendants() do
				if d:IsA(class) then
					k += 1
				end
			end
			return k
		end
		for _, d in L.DOORS do
			local m = doors:FindFirstChild(d.id)
			assert(m ~= nil, `door {d.id} was built`)
			local through = d.id == "red"
			eq(count(m, "ProximityPrompt"), if through then 1 else 0, `{d.id}: prompts`)
			eq(count(m, "ClickDetector"), if through then 1 else 0, `{d.id}: click detectors`)
			eq(m:FindFirstChild("Portal") ~= nil, through, `{d.id}: a portal`)
			local leaf = m:FindFirstChild(if through then "Portal" else "Leaf")
			assert(leaf ~= nil and leaf:FindFirstChild("Glow") and leaf:FindFirstChild("Weather"), `{d.id}: a Glow and a Weather for DoorSigns`)
			-- The leaf fills the opening in the wall, where the layout says the door is.
			local box = L.portalBox(L.doorFrame(d))
			for _, c in Place.parts(leaf)[1].corners do
				assert(L.inside(pt(c), { min = { x = box.min.x - 1e-6, y = box.min.y - 1e-6, z = box.min.z - 1e-6 }, max = { x = box.max.x + 1e-6, y = box.max.y + 1e-6, z = box.max.z + 1e-6 } }), `{d.id}: its leaf sits outside its doorway`)
			end
			eq(m:GetAttribute("Proposal"), d.proposal, `{d.id}: its look is marked canon or proposal`)
		end
		eq(count(built.gate, "ProximityPrompt"), 1, "the gate: a prompt")
		eq(count(built.gate, "ClickDetector"), 1, "the gate: a click detector (the VR laser pointer)")
		local portal = built.gate:FindFirstChild("Portal")
		eq(portal.CanCollide, false, "the gate's portal is walked into")
		-- Nothing else in either place offers a way anywhere.
		eq(count(built.house, "ProximityPrompt") + count(built.grounds, "ProximityPrompt"), 2, "prompts in both places")
		eq(count(built.house, "ClickDetector") + count(built.grounds, "ClickDetector"), 2, "click detectors in both places")
		local _ = p
	end)

	test("travel: each leg lands on a floor in its own place, clear of every portal, facing where it walked", function()
		local p = world()
		local solids = {}
		for _, entry in Place.parts(p.workspace) do
			if entry.part.CanCollide then
				local lo, hi = aabb(entry)
				table.insert(solids, { lo = lo, hi = hi, name = entry.part:GetFullName() })
			end
		end
		local portals = { L.portalBox(L.GATE), L.portalBox(L.doorFrame(L.door("red") :: any)) }
		local legs = 0
		for name, leg in L.TRAVEL do
			legs += 1
			local a = leg.arrive
			eq(L.zoneAt(a), leg.zone, `{name}: arrives in its place`)
			local floorY = a.y - L.ROOT_ABOVE_FLOOR
			for _, b in portals do
				local margin = 4 -- a character's reach, so arriving never touches a portal
				local near = a.x > b.min.x - margin and a.x < b.max.x + margin and a.z > b.min.z - margin and a.z < b.max.z + margin
				assert(not near, `{name}: arrives within {margin} studs of a portal`)
			end
			local ground, blocked = false, nil
			for _, s in solids do
				if a.x >= s.lo.x and a.x <= s.hi.x and a.z >= s.lo.z and a.z <= s.hi.z and math.abs(s.hi.y - floorY) < 0.6 then
					ground = true
				end
				if overlaps(s.lo, s.hi, { x = a.x - 2, y = floorY + 0.2, z = a.z - 2 }, { x = a.x + 2, y = floorY + 6, z = a.z + 2 }) then
					blocked = s.name
				end
			end
			assert(ground, `{name}: no floor under the arrival`)
			assert(blocked == nil, `{name}: the arrival is inside {blocked}`)
			-- Travel keeps your facing, so the way you walked through must face what you came for.
			local walk = L.walkThrough(L.frameOf(leg.from))
			local yaw = L.angles(leg.focus, { x = a.x, y = leg.focus.y, z = a.z }, walk)
			assert(math.abs(yaw) <= L.VIEW_DEG, `{name}: arriving, the focus is {yaw}° off the way you walked`)
		end
		eq(legs, 2, "two legs")
		eq(L.TRAVEL.DuelingGrounds.from, "red", "the red door leads to the Dueling Grounds")
		eq(L.TRAVEL.TeaHouse.from, "gate", "the gate leads back")
	end)

	test("dueling grounds: they contain the whole table room, and the table room is unchanged", function()
		local p, chairs = world()
		local function within(root: any, box: any, what: string)
			local n = 0
			for _, entry in Place.parts(root) do
				n += 1
				for _, c in entry.corners do
					assert(L.inside(pt(c), box), `{what}: {entry.part:GetFullName()} reaches {c}`)
				end
			end
			assert(n > 0, `{what}: parts to check`)
			return n
		end
		local tableParts = within(p.workspace.TapstoneTable, L.GROUNDS, "the table room")
		local boardParts = within(p.workspace.TapstoneBoard, L.GROUNDS, "the board")
		assert(tableParts >= 8 and boardParts >= 18, "the floor, the top, four legs and two chairs; 18 cells")
		within(p.workspace.DuelingGrounds, L.GROUNDS, "the pocket dimension's dressing")
		-- The two gold chairs are still the only seats that play, where they were.
		local tagged = {}
		for _, d in p.workspace:GetDescendants() do
			if d:GetAttribute("TapstoneSeat") ~= nil then
				table.insert(tagged, d)
			end
		end
		eq(#tagged, 2, "instances tagged TapstoneSeat")
		for seat = 0, 1 do
			local chair = chairs[seat]
			eq(chair:GetAttribute("TapstoneSeat"), seat, `chair {seat}'s tag`)
			eq(chair.CFrame.Position.Z, if seat == 1 then 21 else -21, `chair {seat} stands where it did`)
		end
		-- The dressing never touches the table room.
		for _, dress in Place.parts(p.workspace.DuelingGrounds) do
			local dlo, dhi = aabb(dress)
			for _, t in Place.parts(p.workspace.TapstoneTable) do
				if t.part.Name ~= "Floor" then
					local tlo, thi = aabb(t)
					assert(not overlaps(dlo, dhi, tlo, thi), `{dress.part:GetFullName()} runs into {t.part.Name}`)
				end
			end
		end
	end)

	test("tea house: one spawn, in the Tea House, facing the tea and the red door", function()
		local p = world()
		local spawns = {}
		for _, d in p.workspace:GetDescendants() do
			if d:IsA("SpawnLocation") and d.Enabled then
				table.insert(spawns, d)
			end
		end
		eq(#spawns, 1, "enabled spawns")
		local s = spawns[1]
		eq(L.zoneAt(pt(s.CFrame.Position)), "TeaHouse", "the spawn is in the Tea House")
		local look = s.CFrame.LookVector
		local red = L.doorFrame(L.door("red") :: any).at
		local yaw = L.angles(red, pt(s.CFrame.Position), pt(look))
		assert(math.abs(yaw) <= L.VIEW_DEG, `from the spawn the red door is {yaw}° off`)
		local tea = L.angles(L.KETTLE, pt(s.CFrame.Position), pt(look))
		assert(math.abs(tea) <= L.VIEW_DEG, `from the spawn the tea is {tea}° off`)
	end)

	test("tea house: a safe zone that holds the spawn, the seats and the arrival, and nothing of the Dueling Grounds", function()
		local box = L.hallBox()
		assert(L.inside(L.SPAWN.at, box), "the spawn")
		assert(L.inside(L.TRAVEL.TeaHouse.arrive, box), "the arrival from the gate")
		for i, c in L.cushions() do
			assert(L.inside(c.at, box), `cushion {i}`)
		end
		assert(not L.inside(L.TRAVEL.DuelingGrounds.arrive, box), "the Dueling Grounds' arrival is outside")
		local g = L.GROUNDS
		local apart = box.min.x > g.max.x or box.max.x < g.min.x or box.min.z > g.max.z or box.max.z < g.min.z
		assert(apart, "the safe zone and the Dueling Grounds don't overlap")
	end)

	test("dueling grounds: the fog ends before the Tea House begins", function()
		local box, g = L.hallBox(), L.GROUNDS
		local gap = math.max(box.min.x - g.max.x, g.min.x - box.max.x, box.min.z - g.max.z, g.min.z - box.max.z)
		assert(L.LIGHT.DuelingGrounds.FogEnd < gap, `fog ends at {L.LIGHT.DuelingGrounds.FogEnd}, the Tea House is {gap} away`)
	end)

	-- The VR brief (spec §3.1, luna-vr's Layout test): nothing essential outside ±35° of a seated
	-- player's forward view, and 0039: the doors live at the edge of view, never behind the board.
	test("VR, at each gold chair: the board within ±35°; the pocket dimension's dressing and gate outside it", function()
		local p, chairs = world()
		for seat = 0, 1 do
			local chair = chairs[seat]
			local eye = pt(chair.CFrame.Position + roblox.Vector3.new(0, chair.Size.Y / 2 + L.SEATED_EYE, 0))
			local fwd = pt(chair.CFrame.LookVector)
			local cells = 0
			for _, d in p.workspace.TapstoneBoard:GetChildren() do
				local name = d.Name
				local other = if seat == 1 then "CastleFar" else "CastleNear"
				if string.sub(name, 1, 4) == "Cell" or name == other then
					local yaw, pitch = L.angles(pt(d.CFrame.Position), eye, fwd)
					assert(math.abs(yaw) <= L.VIEW_DEG and math.abs(pitch) <= L.VIEW_DEG, `seat {seat}: {name} at yaw {yaw}, pitch {pitch}`)
					cells += 1
				end
			end
			eq(cells, 19, `seat {seat}: 18 cells and the other castle checked`)
			local dressing = 0
			for _, entry in Place.parts(p.workspace.DuelingGrounds) do
				for _, c in entry.corners do
					local yaw, pitch = L.angles(pt(c), eye, fwd)
					assert(math.abs(yaw) > L.VIEW_DEG or math.abs(pitch) > L.VIEW_DEG, `seat {seat}: {entry.part:GetFullName()} in view at yaw {yaw}, pitch {pitch}`)
				end
				dressing += 1
			end
			assert(dressing >= 20, `seat {seat}: the dressing and gate checked ({dressing})`)
		end
	end)

	test("VR, at each cushion: facing the tea table, the kettle within ±35°", function()
		local _, _, built = world()
		local k = 0
		for _, seat in built.house.Seating:GetChildren() do
			if seat:IsA("Seat") and string.sub(seat.Name, 1, 7) == "Cushion" then
				k += 1
				local eye = pt(seat.CFrame.Position + roblox.Vector3.new(0, seat.Size.Y / 2 + L.SEATED_EYE, 0))
				local yaw, pitch = L.angles(L.KETTLE, eye, pt(seat.CFrame.LookVector))
				assert(math.abs(yaw) <= L.VIEW_DEG and math.abs(pitch) <= L.VIEW_DEG, `{seat.Name}: the kettle at yaw {yaw}, pitch {pitch}`)
			end
		end
		eq(k, #L.cushions(), "every cushion checked")
		assert(k >= 8, "eight cushions")
	end)

	test("VR: every name plate reads at ≥ LEGIBLE_DEG from the spawn and every cushion; the gate's from both chairs", function()
		local p, chairs, built = world()
		local function angle(plate: any, eye: Point): number
			local gui = plate:FindFirstChildOfClass("SurfaceGui")
			local label = gui:FindFirstChildOfClass("TextLabel")
			local limit = label:FindFirstChildOfClass("UITextSizeConstraint")
			eq(gui.SizingMode, roblox.Enum.SurfaceGuiSizingMode.PixelsPerStud, "a plate is sized in studs")
			local px = if label.TextScaled then limit.MinTextSize else label.TextSize
			local cap = L.CAP_HEIGHT * px / gui.PixelsPerStud
			local d = L.distance(pt(plate.CFrame.Position), eye)
			return math.deg(2 * math.atan(cap / 2 / d))
		end
		local eyes = { { name = "the spawn", at = { x = L.SPAWN.at.x, y = L.STANDING_EYE, z = L.SPAWN.at.z } } }
		for i, c in L.cushions() do
			table.insert(eyes, { name = `cushion {i}`, at = { x = c.at.x, y = c.at.y + L.SEATED_EYE, z = c.at.z } })
		end
		local plates = 0
		for _, door in built.house.Doors:GetChildren() do
			local plate = door:FindFirstChild("Plate")
			plates += 1
			for _, e in eyes do
				local a = angle(plate, e.at)
				assert(a >= L.LEGIBLE_DEG, `{door.Name}'s plate from {e.name}: {a}°`)
			end
		end
		eq(plates, 7, "plates")
		local gatePlate = built.gate:FindFirstChild("Plate")
		for seat = 0, 1 do
			local chair = chairs[seat]
			local a = angle(gatePlate, pt(chair.CFrame.Position + roblox.Vector3.new(0, chair.Size.Y / 2 + L.SEATED_EYE, 0)))
			assert(a >= L.LEGIBLE_DEG, `the gate's plate from chair {seat}: {a}°`)
		end
		local _ = p
	end)

	-- ---- DoorSigns, on a real match -----------------------------------------------------------

	local views = {}
	for line in string.gmatch(fs.readFile(FIXTURE), "[^\n]+") do
		table.insert(views, serde.decode("json", line))
	end
	local DoorSigns = Place.new().require("shared/DoorSigns")

	local function play(state: any, list: { any }): { [string]: number }
		local counts: { [string]: number } = {}
		for _, v in list do
			for _, stir in DoorSigns.step(state, v) do
				local key = `{stir.kind} {stir.faction}`
				counts[key] = (counts[key] or 0) + 1
			end
		end
		return counts
	end

	-- The fixture's own record (view.last): ember casts at views 22, 34, 46, 62, 75 (CastUnit);
	-- tide at 29 (CastSpell), 40, 53, 54 (CastUnit), 70, 71 (CastSpell); seat 0 (ember) wins at 78.
	test("door signs: a real match stirs Ember's door 5 times and Tide's 6, and Ember wins once", function()
		local c = play(DoorSigns.new(), views)
		eq(c["cast ember"], 5, "ember casts")
		eq(c["cast tide"], 6, "tide casts (units and spells)")
		eq(c["win ember"], 1, "ember's win")
		eq(c["win tide"], nil, "no tide win")
	end)

	test("door signs: a repeated view stirs nothing, and joining mid-match replays nothing", function()
		local s = DoorSigns.new()
		local c = play(s, { views[1], views[2], views[22], views[22], views[22] })
		eq(c["cast ember"], 1, "view 22's cast, once")
		local late = DoorSigns.new()
		eq(#DoorSigns.step(late, views[22]), 0, "the first view only primes, even a cast")
		eq(#DoorSigns.step(late, views[22]), 0, "and again")
		eq(#DoorSigns.step(late, views[23]), 0, "a charge is not a cast")
		local over = DoorSigns.new()
		play(over, { views[1] })
		local w = play(over, { views[78], views[79], views[79] })
		eq(w["win ember"], 1, "the win, once: the lobby frame keeps the same finished board")
	end)

	test("door signs: the second match stirs its doors again (test the second of anything)", function()
		local second = {}
		for _, v in views do
			local copy = table.clone(v)
			if copy.match_id then
				copy.match_id = "second"
			end
			if copy.last_over then
				copy.last_over = table.clone(copy.last_over)
				copy.last_over.match_id = "second"
			end
			table.insert(second, copy)
		end
		local s = DoorSigns.new()
		play(s, views)
		local c = play(s, second)
		eq(c["cast ember"], 5, "ember casts, match 2")
		eq(c["cast tide"], 6, "tide casts, match 2")
		eq(c["win ember"], 1, "the win, match 2")
	end)
end
