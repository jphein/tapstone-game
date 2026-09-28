--!strict
-- The Tea House and the Dueling Grounds (0039), in studs: where the hall, its doors, its seats and
-- its tea stand, where the two ways through lead, and each place's light. The one source that
-- TeaHouseStage (the server's build), the TeaHouse scripts (travel, the safe zone, the fade) and
-- tests/run.luau all read. Pure: plain tables, no Vector3, so it runs under lune.
--
-- Two places, far apart:
-- - **The Dueling Grounds** are the table room Stage has always built, around the origin: the
--   table, the two gold chairs, the board. Nothing of it moves or changes. This module only adds
--   the pocket dimension's dressing around it, and the gate back.
-- - **The Tea House** is a closed hall far out along +X (ORIGIN), where players spawn: lantern
--   light, tea on a low table, cushions and benches, and seven doors in its walls. The red door
--   leads to the Dueling Grounds; the other six are scenery (0039: a door never carries rules or
--   offers a choice).
--
-- Travel only translates a character, never turns it (no forced camera move, comfort), so the
-- geometry is laid out for that: walking west through the red door, you arrive on the Dueling
-- Grounds facing west, at the table's side; walking east through the gate back, you arrive just
-- inside the red door facing east, into the hall.
--
-- Canon (0039, from the *Inner Authority* bible): the Tea House is a safe zone with lantern light,
-- magical tea, comfortable seating and a Shinto/Mayan influence; the red door; the Deep Tides' blue
-- door; the six realms' names. Each door's `canon` cites the bible for the look fields it states;
-- every field it doesn't is a PROPOSAL for JP, and the door carries `proposal = true`.

local TeaHouseLayout = {}

export type Point = { x: number, y: number, z: number }
export type Box = { min: Point, max: Point }
export type RGB = { number }

-- ---- The Tea House hall ----------------------------------------------------------------------

TeaHouseLayout.ORIGIN = { x = 3000, y = 0, z = 0 } :: Point -- the hall's floor centre
TeaHouseLayout.HALF = 36 -- the hall's inside half-width: a 72 x 72 room
TeaHouseLayout.WALL = 2 -- wall thickness
TeaHouseLayout.WALL_HEIGHT = 22
-- The ceiling steps in like a corbelled Mayan vault: each step is a ring VAULT_IN narrower and
-- VAULT_UP higher, then a flat roof.
TeaHouseLayout.VAULT_STEPS = 3
TeaHouseLayout.VAULT_IN = 4
TeaHouseLayout.VAULT_UP = 3
TeaHouseLayout.ROOF_Y = TeaHouseLayout.WALL_HEIGHT + TeaHouseLayout.VAULT_STEPS * TeaHouseLayout.VAULT_UP

TeaHouseLayout.DOOR_WIDTH = 7 -- the opening
TeaHouseLayout.DOOR_HEIGHT = 11
-- A door's frame: posts either side of the opening, a tie beam over it, the name plate above that,
-- and a top beam over all, FRAME_WIDTH across (so doors in one wall must stand that far apart).
TeaHouseLayout.FRAME_WIDTH = TeaHouseLayout.DOOR_WIDTH + 5
TeaHouseLayout.PLATE_WIDTH = TeaHouseLayout.FRAME_WIDTH
TeaHouseLayout.PLATE_HEIGHT = 2
TeaHouseLayout.PLATE_Y = TeaHouseLayout.DOOR_HEIGHT + 0.8 + TeaHouseLayout.PLATE_HEIGHT / 2 -- its centre

-- A character's pivot (its HumanoidRootPart) stands this far above the floor; where travel puts it.
TeaHouseLayout.ROOT_ABOVE_FLOOR = 3
-- Eyes, above a seat's top surface, for a seated player: luna-vr's Layout estimate (head 4.8 over
-- a seat top at 2.0), which the Quest checks by eye (B7). Standing eyes, above the floor.
TeaHouseLayout.SEATED_EYE = 2.8
TeaHouseLayout.STANDING_EYE = 5

-- VR: nothing essential outside ±35° of a seated player's forward view (luna-vr's Layout test,
-- spec §3.1); readable text subtends at least LEGIBLE_DEG where it's read. About 1° is a design
-- target, not a measurement: the Quest checks it by eye (B7).
TeaHouseLayout.VIEW_DEG = 35
TeaHouseLayout.LEGIBLE_DEG = 1.0
-- Name plates: a SurfaceGui at PLATE_PPS pixels per stud; the text scales to fit, never below
-- PLATE_MIN_PX (the size the legibility check uses: the worst case) nor above PLATE_MAX_PX. A
-- capital is about CAP_HEIGHT of the text size.
TeaHouseLayout.PLATE_PPS = 40
TeaHouseLayout.PLATE_MIN_PX = 60
TeaHouseLayout.PLATE_MAX_PX = 72
TeaHouseLayout.CAP_HEIGHT = 0.7

-- ---- The doors -------------------------------------------------------------------------------

-- bible Part II: The Realms, all six, in its order.
TeaHouseLayout.CANON_REALMS = { "The Hearthlands", "The Deep Tides", "The Forge Peaks", "The Wandering Courts", "The Star Fields", "The Dreaming" }

-- A door's look: its wood's colour, and the colour of the weather that breathes out of it.
TeaHouseLayout.LOOK_FIELDS = { "color", "weather" }

-- `wall` is the hall wall a door stands in ("west" is -X); `along` is its offset along that wall
-- (z for west and east, x for north and south), from the hall's centre line.
export type Door = {
	id: string,
	realm: string,
	wall: string,
	along: number,
	color: RGB,
	weather: RGB,
	canon: { [string]: string }, -- look field -> the bible section that states it
	proposal: boolean, -- derived below: true when any look field isn't canon (a PROPOSAL for JP)
}

TeaHouseLayout.DOORS = {
	-- bible Book 1 Ch 22: the red door, deep red, opens on the Dueling Grounds. Its weather is a
	-- PROPOSAL: the pale glint of the crystalline arena beyond it (also Ch 22).
	{ id = "red", realm = "The Dueling Grounds", wall = "west", along = 0, color = { 168, 26, 30 }, weather = { 220, 232, 255 }, canon = { color = "bible Book 1 Ch 22" }, proposal = true },
	-- bible Part II: The Realms: the starting realm, gentle forests and mild weather. Look: PROPOSAL.
	{ id = "hearthlands", realm = "The Hearthlands", wall = "north", along = -16, color = { 176, 112, 58 }, weather = { 255, 176, 96 }, canon = {}, proposal = true },
	-- bible Book 1 Ch 35: the Deep Tides' door is blue. Its mist is a PROPOSAL, after the water world
	-- of Part II: The Realms.
	{ id = "deeptides", realm = "The Deep Tides", wall = "north", along = 16, color = { 34, 84, 168 }, weather = { 150, 205, 255 }, canon = { color = "bible Book 1 Ch 35" }, proposal = true },
	-- bible Part II: The Realms: volcanic mountains and crystalline caves. Look: PROPOSAL (dark
	-- stone, ember light).
	{ id = "forgepeaks", realm = "The Forge Peaks", wall = "east", along = -16, color = { 72, 60, 58 }, weather = { 255, 120, 40 }, canon = {}, proposal = true },
	-- The rest, bible Part II: The Realms; every look a PROPOSAL.
	{ id = "wanderingcourts", realm = "The Wandering Courts", wall = "east", along = 16, color = { 46, 118, 88 }, weather = { 200, 235, 140 }, canon = {}, proposal = true },
	{ id = "starfields", realm = "The Star Fields", wall = "south", along = 16, color = { 30, 32, 74 }, weather = { 235, 240, 255 }, canon = {}, proposal = true },
	{ id = "dreaming", realm = "The Dreaming", wall = "south", along = -16, color = { 120, 96, 170 }, weather = { 214, 190, 255 }, canon = {}, proposal = true },
} :: { Door }
-- `proposal` from `canon`, so the mark can't drift from the citations.
for _, d in TeaHouseLayout.DOORS do
	d.proposal = false
	for _, field in TeaHouseLayout.LOOK_FIELDS do
		if d.canon[field] == nil then
			d.proposal = true
		end
	end
end

-- RULED by JP (0039): Tide's cards come from the Deep Tides, Ember's from the Forge Peaks, and
-- neutral cards from the Hearthlands (JP, 2026-09-27). A cast stirs its card's door (DoorSigns), so
-- a neutral card stirs the Hearthlands door (lead decision 2026-09-28); a win stirs the winning
-- seat's door, and no seat is neutral. The other three realm doors are scenery and stir for nothing.
TeaHouseLayout.FACTION_DOOR = {
	tide = "deeptides", -- RULED: Tide ↔ Deep Tides
	ember = "forgepeaks", -- RULED: Ember ↔ Forge Peaks
	neutral = "hearthlands", -- RULED: neutral ↔ the Hearthlands
} :: { [string]: string }

-- What a door's plate says: the realm's name, without its article ("Deep Tides").
function TeaHouseLayout.signOf(realm: string): string
	return (string.gsub(realm, "^The ", ""))
end

function TeaHouseLayout.door(id: string): Door?
	for _, d in TeaHouseLayout.DOORS do
		if d.id == id then
			return d
		end
	end
	return nil
end

-- Unit vectors for each wall: `inward` points into the hall, `across` runs along the wall.
local WALLS: { [string]: { inward: Point, across: Point } } = {
	west = { inward = { x = 1, y = 0, z = 0 }, across = { x = 0, y = 0, z = 1 } },
	east = { inward = { x = -1, y = 0, z = 0 }, across = { x = 0, y = 0, z = 1 } },
	north = { inward = { x = 0, y = 0, z = 1 }, across = { x = 1, y = 0, z = 0 } },
	south = { inward = { x = 0, y = 0, z = -1 }, across = { x = 1, y = 0, z = 0 } },
}
TeaHouseLayout.WALL_NAMES = { "west", "east", "north", "south" }

-- Where a door stands: `at` is the middle of its opening at floor level, on the wall's inner face.
export type Frame = { at: Point, inward: Point, across: Point }
function TeaHouseLayout.doorFrame(d: Door): Frame
	local w = WALLS[d.wall]
	local o, h = TeaHouseLayout.ORIGIN, TeaHouseLayout.HALF
	return {
		at = {
			x = o.x - w.inward.x * h + w.across.x * d.along,
			y = o.y,
			z = o.z - w.inward.z * h + w.across.z * d.along,
		},
		inward = w.inward,
		across = w.across,
	}
end

-- The doors in one wall, by `along`.
function TeaHouseLayout.doorsIn(wall: string): { Door }
	local out = {}
	for _, d in TeaHouseLayout.DOORS do
		if d.wall == wall then
			table.insert(out, d)
		end
	end
	table.sort(out, function(a: Door, b: Door): boolean
		return a.along < b.along
	end)
	return out
end

-- A wall's solid spans along its length (corners included), with a gap for each door's opening.
-- Above each opening a lintel closes the wall; TeaHouseStage builds both.
function TeaHouseLayout.wallSpans(wall: string): { { from: number, to: number } }
	local reach = TeaHouseLayout.HALF + TeaHouseLayout.WALL
	local spans = {}
	local from = -reach
	for _, d in TeaHouseLayout.doorsIn(wall) do
		table.insert(spans, { from = from, to = d.along - TeaHouseLayout.DOOR_WIDTH / 2 })
		from = d.along + TeaHouseLayout.DOOR_WIDTH / 2
	end
	table.insert(spans, { from = from, to = reach })
	return spans
end

-- Walking through a door means walking against its `inward`, out of the room it faces.
function TeaHouseLayout.walkThrough(f: Frame): Point
	return { x = -f.inward.x, y = 0, z = -f.inward.z }
end

-- The volume a character walks into to go through: the doorway, a little deeper than the wall.
function TeaHouseLayout.portalBox(f: Frame): Box
	local depth = TeaHouseLayout.WALL + 0.5
	local c = { x = f.at.x - f.inward.x * depth / 2, z = f.at.z - f.inward.z * depth / 2 }
	local hx = math.abs(f.across.x) * TeaHouseLayout.DOOR_WIDTH / 2 + math.abs(f.inward.x) * depth / 2
	local hz = math.abs(f.across.z) * TeaHouseLayout.DOOR_WIDTH / 2 + math.abs(f.inward.z) * depth / 2
	return {
		min = { x = c.x - hx, y = f.at.y, z = c.z - hz },
		max = { x = c.x + hx, y = f.at.y + TeaHouseLayout.DOOR_HEIGHT, z = c.z + hz },
	}
end

-- ---- The Dueling Grounds (a pocket dimension around Stage's table) ----------------------------

-- The table stands at the origin (Stage). The pocket dimension is Stage's floor and the void
-- around it: everything of the table room must stay inside this box (tests/run.luau builds the
-- real Stage and checks).
TeaHouseLayout.GROUNDS = { min = { x = -120, y = -2, z = -120 }, max = { x = 120, y = 60, z = 120 } } :: Box
TeaHouseLayout.TABLE_CENTRE = { x = 0, y = 0, z = 0 } :: Point

-- The gate back to the Tea House: a freestanding red frame at the table's +X side, facing it.
-- Beside the table rather than past an end, so from either chair it sits at the edge of view,
-- never behind the board.
TeaHouseLayout.GATE = { at = { x = 40, y = 0, z = 0 }, inward = { x = -1, y = 0, z = 0 }, across = { x = 0, y = 0, z = 1 } } :: Frame

-- The pocket dimension's dressing: stepped stone pillars with a floating lantern on each, along the
-- two long sides, clear of both chairs' view (tests/run.luau).
TeaHouseLayout.PILLARS = {
	{ x = 48, z = -30 }, { x = 48, z = 30 }, { x = -48, z = -30 }, { x = -48, z = 30 },
	{ x = -48, z = -10 }, { x = -48, z = 10 },
} :: { { x: number, z: number } }
TeaHouseLayout.PILLAR_STEPS = { { size = 6, height = 3 }, { size = 4.5, height = 5 }, { size = 3, height = 7 } }
TeaHouseLayout.LANTERN_ABOVE = 2.5 -- the lantern floats this far above the pillar's top

-- ---- Travel ----------------------------------------------------------------------------------

export type Leg = { from: string, arrive: Point, zone: string, focus: Point }
TeaHouseLayout.TRAVEL = {
	-- Through the red door (west): arrive at the table's side, facing west, toward it.
	DuelingGrounds = { from = "red", arrive = { x = 30, y = TeaHouseLayout.ROOT_ABOVE_FLOOR, z = 0 }, zone = "DuelingGrounds", focus = TeaHouseLayout.TABLE_CENTRE },
	-- Through the gate (east): arrive just inside the red door, facing east, into the hall.
	TeaHouse = {
		from = "gate",
		arrive = { x = TeaHouseLayout.ORIGIN.x - TeaHouseLayout.HALF + 8, y = TeaHouseLayout.ROOT_ABOVE_FLOOR, z = TeaHouseLayout.ORIGIN.z },
		zone = "TeaHouse",
		focus = TeaHouseLayout.ORIGIN,
	},
} :: { [string]: Leg }

-- The frame a leg leaves through.
function TeaHouseLayout.frameOf(from: string): Frame
	if from == "gate" then
		return TeaHouseLayout.GATE
	end
	return TeaHouseLayout.doorFrame(TeaHouseLayout.door(from) :: Door)
end

-- ---- Inside the hall: the tea, the seats, the spawn ------------------------------------------

TeaHouseLayout.TEA_TABLE = { size = 10, top = 2.2 } -- a low square table at the hall's centre
TeaHouseLayout.KETTLE = { x = TeaHouseLayout.ORIGIN.x, y = 3.6, z = TeaHouseLayout.ORIGIN.z } :: Point
TeaHouseLayout.CUSHION_TOP = 0.8 -- a cushion's top, above the floor

-- The cushions round the tea table, two a side, each facing the kettle.
export type Place = { at: Point, facing: Point }
function TeaHouseLayout.cushions(): { Place }
	local out = {}
	local o = TeaHouseLayout.ORIGIN
	for _, side in { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } } do
		for _, offset in { -2.5, 2.5 } do
			local sx, sz = side[1], side[2]
			table.insert(out, {
				at = { x = o.x + sx * 8 + sz * offset, y = o.y + TeaHouseLayout.CUSHION_TOP, z = o.z + sz * 8 + sx * offset },
				facing = { x = -sx, y = 0, z = -sz },
			})
		end
	end
	return out
end

-- Low benches with backs along the walls, between the doors, facing into the hall.
function TeaHouseLayout.benches(): { Place }
	local o, h = TeaHouseLayout.ORIGIN, TeaHouseLayout.HALF
	local out = {}
	for _, spot in { { wall = "north", along = 0 }, { wall = "south", along = 0 }, { wall = "east", along = 0 } } do
		local w = WALLS[spot.wall]
		local along = spot.along
		table.insert(out, {
			at = {
				x = o.x - w.inward.x * (h - 2.5) + w.across.x * along,
				y = o.y + 1.4,
				z = o.z - w.inward.z * (h - 2.5) + w.across.z * along,
			},
			facing = w.inward,
		})
	end
	return out
end

-- Where players appear: east of the tea, facing west, so they see the tea and the red door beyond.
TeaHouseLayout.SPAWN = { at = { x = TeaHouseLayout.ORIGIN.x + 22, y = 0.5, z = TeaHouseLayout.ORIGIN.z }, facing = { x = -1, y = 0, z = 0 } } :: Place

-- ---- Zones: the safe zone, and each place's light ---------------------------------------------

-- The Tea House is a safe zone (0039): anyone inside this box is kept from harm.
function TeaHouseLayout.hallBox(): Box
	local o, r = TeaHouseLayout.ORIGIN, TeaHouseLayout.HALF + TeaHouseLayout.WALL + 4
	return {
		min = { x = o.x - r, y = o.y - 4, z = o.z - r },
		max = { x = o.x + r, y = o.y + TeaHouseLayout.ROOF_Y + 6, z = o.z + r },
	}
end

function TeaHouseLayout.inside(p: Point, b: Box): boolean
	return p.x >= b.min.x and p.x <= b.max.x and p.y >= b.min.y and p.y <= b.max.y and p.z >= b.min.z and p.z <= b.max.z
end

-- Which place a point is in: "TeaHouse", "DuelingGrounds" or nil (the void between).
function TeaHouseLayout.zoneAt(p: Point): string?
	if TeaHouseLayout.inside(p, TeaHouseLayout.hallBox()) then
		return "TeaHouse"
	elseif TeaHouseLayout.inside(p, TeaHouseLayout.GROUNDS) then
		return "DuelingGrounds"
	end
	return nil
end

-- Each place's light, applied by the client when it arrives (Lighting is per client). The Tea
-- House: evening, warm. The Dueling Grounds: night under stars, cool, bright enough to read the
-- board, and fog that hides everything beyond the pocket dimension (tests/run.luau checks the fog
-- ends before the Tea House begins).
export type Light = {
	ClockTime: number,
	Brightness: number,
	Ambient: RGB,
	OutdoorAmbient: RGB,
	FogColor: RGB,
	FogStart: number,
	FogEnd: number,
}
TeaHouseLayout.LIGHT = {
	TeaHouse = { ClockTime = 19.5, Brightness = 1, Ambient = { 96, 68, 44 }, OutdoorAmbient = { 110, 82, 56 }, FogColor = { 40, 28, 20 }, FogStart = 0, FogEnd = 100000 },
	DuelingGrounds = { ClockTime = 0, Brightness = 1.2, Ambient = { 78, 72, 112 }, OutdoorAmbient = { 104, 98, 148 }, FogColor = { 18, 14, 36 }, FogStart = 180, FogEnd = 700 },
} :: { [string]: Light }

-- ---- Angles, for the VR checks ---------------------------------------------------------------

-- A point's yaw and pitch in degrees from `eye`, relative to a level forward direction `fwd`
-- (x, z). A point at or behind the eye reports a yaw of 180.
function TeaHouseLayout.angles(p: Point, eye: Point, fwd: Point): (number, number)
	local len = math.sqrt(fwd.x * fwd.x + fwd.z * fwd.z)
	local fx, fz = fwd.x / len, fwd.z / len
	local dx, dy, dz = p.x - eye.x, p.y - eye.y, p.z - eye.z
	local ahead = dx * fx + dz * fz
	local side = dx * fz - dz * fx
	if ahead <= 0 then
		return 180, 0
	end
	local yaw = math.deg(math.atan2(side, ahead))
	local pitch = math.deg(math.atan2(dy, math.sqrt(side * side + ahead * ahead)))
	return yaw, pitch
end

function TeaHouseLayout.distance(a: Point, b: Point): number
	local dx, dy, dz = a.x - b.x, a.y - b.y, a.z - b.z
	return math.sqrt(dx * dx + dy * dy + dz * dz)
end

return TeaHouseLayout
