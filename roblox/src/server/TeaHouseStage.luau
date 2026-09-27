--!strict
-- Builds the Tea House and the Dueling Grounds' dressing (0039) from TeaHouseLayout, with parts,
-- lights and particles only: no meshes, decals or other assets. Stage still builds the table room;
-- this adds the rooms around it and never touches the table, its chairs or the board.
--
-- The Tea House: a hall of dark wood and pale paper screens on a stone base carved with a stepped
-- fret, vermilion pillars, a vault that steps in under a flat roof, paper lanterns, a low table
-- with a steaming kettle and cups, cushions and benches, and the seven doors. The Dueling Grounds:
-- stepped stone pillars with floating lanterns along the table's two long sides, and the red gate
-- back to the Tea House.
--
-- Only the red door and the gate carry a way through: a glowing portal to walk into, a
-- ProximityPrompt, and a ClickDetector for the VR laser pointer. The TeaHouse script wires them.
-- Every door has a "Glow" light and a "Weather" emitter, both idle until a client stirs them
-- (DoorSigns).

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local TeaHouseLayout = require(ReplicatedStorage:WaitForChild("TapstoneShared"):WaitForChild("TeaHouseLayout"))

type Point = TeaHouseLayout.Point
type Frame = TeaHouseLayout.Frame

local TeaHouseStage = {}

local VERMILION = Color3.fromRGB(196, 58, 38)
local DARK_WOOD = Color3.fromRGB(62, 40, 28)
local WOOD = Color3.fromRGB(122, 84, 52)
local PAPER = Color3.fromRGB(236, 222, 190)
local STONE = Color3.fromRGB(168, 150, 118) -- warm limestone, for the carved base and the vault
local LANTERN = Color3.fromRGB(255, 168, 84)
local LAMP_LIGHT = Color3.fromRGB(255, 176, 104)
local MAT = Color3.fromRGB(184, 176, 112) -- tatami

local function v3(p: Point): Vector3
	return Vector3.new(p.x, p.y, p.z)
end

local function rgb(c: { number }): Color3
	return Color3.fromRGB(c[1], c[2], c[3])
end

local function part(parent: Instance, name: string, size: Vector3, cf: CFrame, color: Color3, material: Enum.Material): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Size = size
	p.CFrame = cf
	p.Color = color
	p.Material = material
	p.Parent = parent
	return p
end

local function model(parent: Instance, name: string): Model
	local m = Instance.new("Model")
	m.Name = name
	m.Parent = parent
	return m
end

local function light(parent: Instance, name: string, color: Color3, brightness: number, range: number): PointLight
	local l = Instance.new("PointLight")
	l.Name = name
	l.Color = color
	l.Brightness = brightness
	l.Range = range
	l.Shadows = false
	l.Parent = parent
	return l
end

-- A frame's CFrame: at its floor point, looking into the room it faces.
local function frameCFrame(f: Frame): CFrame
	local at = v3(f.at)
	return CFrame.lookAt(at, at + v3(f.inward))
end

-- Soft steam off a cup or the kettle: pale, slow, rising, fading.
local function steam(parent: Instance, rate: number, size: number, up: Enum.NormalId)
	local e = Instance.new("ParticleEmitter")
	e.Name = "Steam"
	e.Color = ColorSequence.new(Color3.fromRGB(250, 246, 238), Color3.fromRGB(200, 236, 232))
	e.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.55), NumberSequenceKeypoint.new(1, 1) })
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, size * 0.3), NumberSequenceKeypoint.new(1, size) })
	e.Lifetime = NumberRange.new(1.8, 3)
	e.Rate = rate
	e.Speed = NumberRange.new(0.6, 1.4)
	e.SpreadAngle = Vector2.new(12, 12)
	e.Acceleration = Vector3.new(0, 0.5, 0)
	e.LightEmission = 0.2
	e.EmissionDirection = up -- the parent part's own axis that points up
	e.Parent = parent
end

-- ---- The hall --------------------------------------------------------------------------------

-- One wall: its solid spans (TeaHouseLayout.wallSpans), a lintel over each door, and on the
-- inner face a stone base carved with a stepped fret, dark battens and rails over the paper.
local function buildWall(hall: Model, wall: string)
	local L = TeaHouseLayout
	local axes = L.doorFrame({ id = "", realm = "", wall = wall, along = 0, color = {}, weather = {}, canon = {}, proposal = true })
	local inward, across = v3(axes.inward), v3(axes.across)
	local face = v3(L.ORIGIN) - inward * L.HALF -- the inner face, at floor level, on the centre line
	-- `inset`: the piece's centre, measured from the inner face into the room (negative: in the wall).
	local function piece(name: string, from: number, to: number, y0: number, y1: number, depth: number, inset: number, color: Color3, material: Enum.Material)
		if to - from <= 0.01 then
			return
		end
		local c = face + inward * inset + across * ((from + to) / 2) + Vector3.new(0, (y0 + y1) / 2, 0)
		local size = if math.abs(across.X) > 0.5 then Vector3.new(to - from, y1 - y0, depth) else Vector3.new(depth, y1 - y0, to - from)
		part(hall, name, size, CFrame.new(c), color, material)
	end
	for _, span in L.wallSpans(wall) do
		piece("Wall", span.from, span.to, 0, L.WALL_HEIGHT, L.WALL, -L.WALL / 2, PAPER, Enum.Material.SmoothPlastic)
		-- The decoration stays inside the room: a span's ends in the corners belong to the walls either side.
		local from, to = math.max(span.from, -L.HALF), math.min(span.to, L.HALF)
		piece("Base", from, to, 0, 3, 0.6, 0.3, STONE, Enum.Material.Limestone)
		local k, at = 0, from + 0.5
		while at + 2 <= to - 0.5 do
			local tall = if k % 4 == 0 then 2.6 elseif k % 4 == 2 then 1.4 else 2.0
			piece("Fret", at, at + 1.6, 0.4, tall, 0.5, 0.85, STONE, Enum.Material.Limestone)
			at += 2
			k += 1
		end
		local b = math.ceil((from + 0.5) / 4) * 4
		while b <= to - 0.5 do
			piece("Batten", b - 0.2, b + 0.2, 3, L.WALL_HEIGHT, 0.3, 0.15, DARK_WOOD, Enum.Material.Wood)
			b += 4
		end
		for _, y in { 8, 16 } do
			piece("Rail", from, to, y - 0.2, y + 0.2, 0.35, 0.18, DARK_WOOD, Enum.Material.Wood)
		end
	end
	for _, d in L.doorsIn(wall) do
		piece("Lintel", d.along - L.DOOR_WIDTH / 2, d.along + L.DOOR_WIDTH / 2, L.DOOR_HEIGHT, L.WALL_HEIGHT, L.WALL, -L.WALL / 2, PAPER, Enum.Material.SmoothPlastic)
	end
end

local function buildHall(house: Model): BasePart
	local L = TeaHouseLayout
	local o = v3(L.ORIGIN)
	local hall = model(house, "Hall")
	local outer = (L.HALF + L.WALL) * 2
	part(hall, "Floor", Vector3.new(outer, 1, outer), CFrame.new(o + Vector3.new(0, -0.5, 0)), WOOD, Enum.Material.WoodPlanks)
	-- Tatami round the tea, in a dark wood border.
	part(hall, "MatBorder", Vector3.new(26, 0.1, 26), CFrame.new(o + Vector3.new(0, 0.05, 0)), DARK_WOOD, Enum.Material.Wood)
	for _, dx in { -6, 6 } do
		for _, dz in { -6, 6 } do
			part(hall, "Tatami", Vector3.new(11.6, 0.12, 11.6), CFrame.new(o + Vector3.new(dx, 0.06, dz)), MAT, Enum.Material.Fabric)
		end
	end
	for _, wall in L.WALL_NAMES do
		buildWall(hall, wall)
	end
	-- The vault: rings stepping in, each resting on the one below, a vermilion beam under each lip.
	for k = 1, L.VAULT_STEPS do
		local rIn = L.HALF - k * L.VAULT_IN
		local rOut = L.HALF - (k - 1) * L.VAULT_IN + (if k == 1 then L.WALL else 0)
		local y0 = L.WALL_HEIGHT + (k - 1) * L.VAULT_UP
		local mid, depth = (rIn + rOut) / 2, rOut - rIn
		for _, side in { -1, 1 } do
			part(hall, "Vault", Vector3.new(2 * rOut, L.VAULT_UP, depth), CFrame.new(o + Vector3.new(0, y0 + L.VAULT_UP / 2, side * mid)), STONE, Enum.Material.Limestone)
			part(hall, "Vault", Vector3.new(depth, L.VAULT_UP, 2 * rOut), CFrame.new(o + Vector3.new(side * mid, y0 + L.VAULT_UP / 2, 0)), STONE, Enum.Material.Limestone)
			part(hall, "Beam", Vector3.new(2 * rIn, 0.6, 0.6), CFrame.new(o + Vector3.new(0, y0 - 0.3, side * (rIn + 0.3))), VERMILION, Enum.Material.Wood)
			part(hall, "Beam", Vector3.new(0.6, 0.6, 2 * rIn), CFrame.new(o + Vector3.new(side * (rIn + 0.3), y0 - 0.3, 0)), VERMILION, Enum.Material.Wood)
		end
	end
	local roofSpan = (L.HALF - L.VAULT_STEPS * L.VAULT_IN) * 2 + 2
	part(hall, "Roof", Vector3.new(roofSpan, 1, roofSpan), CFrame.new(o + Vector3.new(0, L.ROOF_Y + 0.5, 0)), DARK_WOOD, Enum.Material.Wood)
	-- Vermilion pillars in the corners.
	for _, sx in { -1, 1 } do
		for _, sz in { -1, 1 } do
			local at = o + Vector3.new(sx * (L.HALF - 1), L.WALL_HEIGHT / 2, sz * (L.HALF - 1))
			part(hall, "Pillar", Vector3.new(2, L.WALL_HEIGHT, 2), CFrame.new(at), VERMILION, Enum.Material.Wood)
		end
	end
	-- Paper lanterns: one large over the tea, a ring of smaller ones, each on a cord.
	local lamps = model(hall, "Lanterns")
	local function lantern(at: Vector3, size: number, brightness: number, range: number)
		local shade = part(lamps, "Lantern", Vector3.new(size * 1.3, size, size), CFrame.new(at) * CFrame.Angles(0, 0, math.rad(90)), LANTERN, Enum.Material.SmoothPlastic)
		shade.Shape = Enum.PartType.Cylinder
		shade.CanCollide = false
		shade.CastShadow = false
		part(lamps, "Cap", Vector3.new(size * 0.5, 0.25, size * 0.5), CFrame.new(at + Vector3.new(0, size * 0.65 + 0.12, 0)), DARK_WOOD, Enum.Material.Wood).CanCollide = false
		local top = L.ROOF_Y
		local cordLen = top - (at.Y + size * 0.65)
		local cord = part(lamps, "Cord", Vector3.new(0.12, cordLen, 0.12), CFrame.new(at + Vector3.new(0, size * 0.65 + cordLen / 2, 0)), DARK_WOOD, Enum.Material.Fabric)
		cord.CanCollide = false
		light(shade, "Light", LAMP_LIGHT, brightness, range)
	end
	lantern(o + Vector3.new(0, 15, 0), 3, 1.6, 26)
	for _, a in { 45, 135, 225, 315 } do
		local rad = math.rad(a)
		lantern(o + Vector3.new(math.cos(rad) * 20, 14, math.sin(rad) * 20), 2, 1.2, 22)
	end
	return hall:FindFirstChild("Floor") :: BasePart
end

-- ---- The tea and the seats -------------------------------------------------------------------

local function buildTea(house: Model)
	local L = TeaHouseLayout
	local o = v3(L.ORIGIN)
	local tea = model(house, "Tea")
	local t = L.TEA_TABLE
	part(tea, "TableTop", Vector3.new(t.size, 0.4, t.size), CFrame.new(o + Vector3.new(0, t.top - 0.2, 0)), DARK_WOOD, Enum.Material.Wood)
	for _, sx in { -1, 1 } do
		for _, sz in { -1, 1 } do
			part(tea, "TableLeg", Vector3.new(0.8, t.top - 0.4, 0.8), CFrame.new(o + Vector3.new(sx * (t.size / 2 - 0.8), (t.top - 0.4) / 2, sz * (t.size / 2 - 0.8))), DARK_WOOD, Enum.Material.Wood)
		end
	end
	-- A small stone brazier, glowing, under an iron kettle.
	local brazier = part(tea, "Brazier", Vector3.new(2.2, 0.6, 2.2), CFrame.new(o + Vector3.new(0, t.top + 0.3, 0)), STONE, Enum.Material.Slate)
	local coals = part(tea, "Coals", Vector3.new(1.6, 0.15, 1.6), CFrame.new(o + Vector3.new(0, t.top + 0.66, 0)), Color3.fromRGB(255, 110, 40), Enum.Material.Neon)
	coals.CanCollide = false
	light(brazier, "Embers", Color3.fromRGB(255, 130, 60), 0.8, 8)
	local k = v3(L.KETTLE)
	local body = part(tea, "Kettle", Vector3.new(1.6, 1.6, 1.6), CFrame.new(k), Color3.fromRGB(38, 36, 40), Enum.Material.Metal)
	body.Shape = Enum.PartType.Ball
	part(tea, "Spout", Vector3.new(0.3, 0.3, 1.1), CFrame.new(k + Vector3.new(0, 0.1, -0.95)) * CFrame.Angles(math.rad(-30), 0, 0), Color3.fromRGB(38, 36, 40), Enum.Material.Metal)
	part(tea, "Handle", Vector3.new(1.3, 0.15, 0.15), CFrame.new(k + Vector3.new(0, 1.0, 0)), DARK_WOOD, Enum.Material.Wood)
	local lid = part(tea, "Lid", Vector3.new(0.7, 0.2, 0.7), CFrame.new(k + Vector3.new(0, 0.82, 0)), Color3.fromRGB(150, 118, 60), Enum.Material.Metal)
	-- The tea is magical: its steam carries a slow drift of gold and jade sparks.
	local mouth = Instance.new("Attachment")
	mouth.Name = "Mouth"
	mouth.Position = Vector3.new(0, 0.1, 0)
	mouth.Parent = lid
	steam(mouth, 5, 1.6, Enum.NormalId.Top)
	local sparks = Instance.new("ParticleEmitter")
	sparks.Name = "Magic"
	sparks.Color = ColorSequence.new(Color3.fromRGB(255, 214, 120), Color3.fromRGB(120, 230, 190))
	sparks.LightEmission = 1
	sparks.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.2), NumberSequenceKeypoint.new(1, 1) })
	sparks.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.12), NumberSequenceKeypoint.new(1, 0.02) })
	sparks.Lifetime = NumberRange.new(2.5, 4)
	sparks.Rate = 2
	sparks.Speed = NumberRange.new(0.3, 0.8)
	sparks.SpreadAngle = Vector2.new(35, 35)
	sparks.Acceleration = Vector3.new(0, 0.25, 0)
	sparks.Parent = mouth
	light(lid, "Glow", Color3.fromRGB(150, 235, 200), 0.6, 6)
	-- A cup at each cushion, steaming.
	for _, c in L.cushions() do
		local at = v3(c.at)
		local toward = Vector3.new(c.facing.x, 0, c.facing.z)
		local cupAt = Vector3.new(at.X, t.top + 0.35, at.Z) + toward * 4.2
		local cup = part(tea, "Cup", Vector3.new(0.7, 0.6, 0.6), CFrame.new(cupAt) * CFrame.Angles(0, 0, math.rad(90)), Color3.fromRGB(214, 206, 188), Enum.Material.Glass)
		cup.Shape = Enum.PartType.Cylinder
		cup.CanCollide = false
		local top = Instance.new("Attachment")
		top.Name = "Top"
		top.Position = Vector3.new(0.3, 0, 0) -- the cylinder's axis is its X: this is the rim
		top.Parent = cup
		steam(top, 1.5, 0.6, Enum.NormalId.Right) -- the cylinder lies on its side, turned up: its +X is up
	end
end

local function buildSeating(house: Model)
	local L = TeaHouseLayout
	local seating = model(house, "Seating")
	for i, c in L.cushions() do
		local at = v3(c.at)
		local seat = Instance.new("Seat")
		seat.Name = `Cushion{i}`
		seat.Anchored = true
		seat.Size = Vector3.new(2.6, L.CUSHION_TOP, 2.6)
		seat.CFrame = CFrame.lookAt(at - Vector3.new(0, L.CUSHION_TOP / 2, 0), at - Vector3.new(0, L.CUSHION_TOP / 2, 0) + v3(c.facing))
		seat.Color = Color3.fromRGB(150, 44, 40)
		seat.Material = Enum.Material.Fabric
		seat.TopSurface = Enum.SurfaceType.Smooth
		seat.Parent = seating
	end
	for i, b in L.benches() do
		local at = v3(b.at)
		local seat = Instance.new("Seat")
		seat.Name = `Bench{i}`
		seat.Anchored = true
		seat.Size = Vector3.new(8, 0.6, 2.4)
		seat.CFrame = CFrame.lookAt(at, at + v3(b.facing))
		seat.Color = WOOD
		seat.Material = Enum.Material.Wood
		seat.TopSurface = Enum.SurfaceType.Smooth
		seat.Parent = seating
		local cf = seat.CFrame
		part(seating, "BenchBase", Vector3.new(8, at.Y - 0.3, 2), cf * CFrame.new(0, -(at.Y - 0.3) / 2 - 0.3, 0), DARK_WOOD, Enum.Material.Wood)
		part(seating, "BenchBack", Vector3.new(8, 3, 0.4), cf * CFrame.new(0, 1.8, 1.2), DARK_WOOD, Enum.Material.Wood)
	end
end

-- ---- Doors -----------------------------------------------------------------------------------

-- A torii-like frame (two posts, a tie beam and a top beam) with a name plate, a door slab or a
-- walk-through portal, a Glow light and a Weather emitter. `through`: this door is a way through.
local function buildDoor(parent: Instance, name: string, f: Frame, title: string, color: Color3, weather: Color3, through: boolean): Model
	local L = TeaHouseLayout
	local m = model(parent, name)
	local cf = frameCFrame(f) -- local -Z points into the room, +X along the wall (right, facing in)
	local w, h = L.DOOR_WIDTH, L.DOOR_HEIGHT
	local top = L.PLATE_Y + L.PLATE_HEIGHT / 2 -- where the top beam sits
	for _, side in { -1, 1 } do
		part(m, "Post", Vector3.new(1.2, top, 1.2), cf * CFrame.new(side * (w / 2 + 0.6), top / 2, -0.6), VERMILION, Enum.Material.Wood)
	end
	part(m, "TieBeam", Vector3.new(w + 2.4, 0.8, 0.9), cf * CFrame.new(0, h + 0.4, -0.6), VERMILION, Enum.Material.Wood)
	part(m, "TopBeam", Vector3.new(L.FRAME_WIDTH, 0.7, 1.4), cf * CFrame.new(0, top + 0.35, -0.6), DARK_WOOD, Enum.Material.Wood)
	-- The name plate, between the tie beam and the top beam, facing the room.
	local plate = part(m, "Plate", Vector3.new(L.PLATE_WIDTH, L.PLATE_HEIGHT, 0.2), cf * CFrame.new(0, L.PLATE_Y, -1.2), DARK_WOOD, Enum.Material.Wood)
	local gui = Instance.new("SurfaceGui")
	gui.Name = "Name"
	gui.Face = Enum.NormalId.Front
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = L.PLATE_PPS
	gui.LightInfluence = 0
	gui.Parent = plate
	local label = Instance.new("TextLabel")
	label.Name = "Text"
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.TextColor3 = Color3.fromRGB(246, 226, 170)
	label.TextScaled = true
	label.Font = Enum.Font.Garamond
	label.Text = title
	local limit = Instance.new("UITextSizeConstraint")
	limit.MinTextSize = L.PLATE_MIN_PX
	limit.MaxTextSize = L.PLATE_MAX_PX
	limit.Parent = label
	label.Parent = gui
	-- The leaf: a closed slab for scenery, a glowing portal for a way through.
	local leaf: Part
	if through then
		leaf = part(m, "Portal", Vector3.new(w, h, 0.4), cf * CFrame.new(0, h / 2, L.WALL / 2), color, Enum.Material.Neon)
		leaf.Transparency = 0.35
		leaf.CanCollide = false
		leaf.CastShadow = false
		-- Behind the portal, a dark stone back, so no one walks out of the room.
		part(m, "Back", Vector3.new(w + 1, h + 1, 0.6), cf * CFrame.new(0, (h + 1) / 2, L.WALL + 0.5), Color3.fromRGB(20, 12, 14), Enum.Material.Slate)
	else
		leaf = part(m, "Leaf", Vector3.new(w, h, 0.6), cf * CFrame.new(0, h / 2, L.WALL / 2), color, Enum.Material.Wood)
		for _, y in { h * 0.3, h * 0.7 } do
			part(m, "Panel", Vector3.new(w - 1.6, h * 0.3, 0.2), cf * CFrame.new(0, y, L.WALL / 2 - 0.4), color:Lerp(Color3.new(1, 1, 1), 0.15), Enum.Material.Wood)
		end
		local disc = part(m, "Crest", Vector3.new(0.2, 1.6, 1.6), cf * CFrame.new(0, h * 0.5, L.WALL / 2 - 0.75) * CFrame.Angles(0, math.rad(90), 0), weather, Enum.Material.SmoothPlastic)
		disc.Shape = Enum.PartType.Cylinder
	end
	light(leaf, "Glow", weather, 0, 16)
	local e = Instance.new("ParticleEmitter")
	e.Name = "Weather"
	e.Enabled = false
	e.Rate = 0
	e.Color = ColorSequence.new(weather)
	e.LightEmission = 0.7
	e.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.2), NumberSequenceKeypoint.new(1, 1) })
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.5), NumberSequenceKeypoint.new(1, 0.1) })
	e.Lifetime = NumberRange.new(1.5, 2.5)
	e.Speed = NumberRange.new(3, 6)
	e.SpreadAngle = Vector2.new(30, 30)
	e.EmissionDirection = Enum.NormalId.Front -- into the room
	e.Parent = leaf
	return m
end

-- The way through a door: the prompt (keyboard, gamepad, touch, a VR button) and a click
-- detector (the VR laser pointer, a mouse). The TeaHouse script connects both.
local function wayThrough(m: Model, action: string, object: string)
	local portal = m:FindFirstChild("Portal") :: Part
	local prompt = Instance.new("ProximityPrompt")
	prompt.Name = "Travel"
	prompt.ActionText = action
	prompt.ObjectText = object
	prompt.MaxActivationDistance = 12
	prompt.RequiresLineOfSight = false
	prompt.ClickablePrompt = true
	prompt.HoldDuration = 0
	prompt.Parent = portal
	local click = Instance.new("ClickDetector")
	click.Name = "Travel"
	click.MaxActivationDistance = 32
	click.Parent = portal
end

-- ---- The Dueling Grounds' dressing -----------------------------------------------------------

local function buildGrounds(): Model
	local L = TeaHouseLayout
	local existing = workspace:FindFirstChild("DuelingGrounds")
	if existing then
		existing:Destroy()
	end
	local grounds = Instance.new("Model")
	grounds.Name = "DuelingGrounds"
	local rim = model(grounds, "Rim")
	for _, at in L.PILLARS do
		local y = 0
		for _, s in L.PILLAR_STEPS do
			part(rim, "Step", Vector3.new(s.size, s.height, s.size), CFrame.new(at.x, y + s.height / 2, at.z), STONE:Lerp(Color3.fromRGB(60, 56, 80), 0.35), Enum.Material.Limestone)
			y += s.height
		end
		local lamp = part(rim, "Lantern", Vector3.new(1.4, 1.4, 1.4), CFrame.new(at.x, y + L.LANTERN_ABOVE, at.z) * CFrame.Angles(0, math.rad(45), 0), Color3.fromRGB(255, 200, 130), Enum.Material.Neon)
		lamp.CanCollide = false
		light(lamp, "Light", Color3.fromRGB(190, 170, 255), 1.4, 30)
		local motes = Instance.new("ParticleEmitter")
		motes.Name = "Motes"
		motes.Color = ColorSequence.new(Color3.fromRGB(200, 180, 255), Color3.fromRGB(255, 220, 150))
		motes.LightEmission = 1
		motes.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.3), NumberSequenceKeypoint.new(1, 1) })
		motes.Size = NumberSequence.new(0.15)
		motes.Lifetime = NumberRange.new(3, 5)
		motes.Rate = 1.5
		motes.Speed = NumberRange.new(0.2, 0.6)
		motes.SpreadAngle = Vector2.new(180, 180)
		motes.Parent = lamp
	end
	local gate = buildDoor(grounds, "Gate", L.GATE, "Tea House", Color3.fromRGB(168, 26, 30), Color3.fromRGB(255, 214, 140), true)
	wayThrough(gate, "Return to the Tea House", "The red gate")
	grounds.Parent = workspace
	return grounds
end

-- ---- Everything ------------------------------------------------------------------------------

export type Built = { house: Model, grounds: Model, spawn: SpawnLocation, redDoor: Model, gate: Model }

-- Builds workspace.TeaHouse and workspace.DuelingGrounds once (again replaces both).
function TeaHouseStage.build(): Built
	local L = TeaHouseLayout
	local existing = workspace:FindFirstChild("TeaHouse")
	if existing then
		existing:Destroy()
	end
	local house = Instance.new("Model")
	house.Name = "TeaHouse"
	house.PrimaryPart = buildHall(house)
	buildTea(house)
	buildSeating(house)
	local doors = model(house, "Doors")
	for _, d in L.DOORS do
		local f = L.doorFrame(d)
		local m = buildDoor(doors, d.id, f, L.signOf(d.realm), rgb(d.color), rgb(d.weather), d.id == "red")
		m:SetAttribute("Realm", d.realm)
		m:SetAttribute("Proposal", d.proposal)
	end
	local red = doors:FindFirstChild("red") :: Model
	wayThrough(red, "Enter the Dueling Grounds", "The red door")
	-- Stone lanterns (tōrō) either side of the red door.
	local rf = L.doorFrame(L.door("red") :: TeaHouseLayout.Door)
	local rcf = frameCFrame(rf)
	for _, side in { -1, 1 } do
		local base = rcf * CFrame.new(side * (L.DOOR_WIDTH / 2 + 3), 0, -2.5)
		part(house, "Toro", Vector3.new(1.6, 3, 1.6), base * CFrame.new(0, 1.5, 0), STONE, Enum.Material.Slate)
		local box = part(house, "ToroLamp", Vector3.new(1.8, 1.4, 1.8), base * CFrame.new(0, 3.7, 0), Color3.fromRGB(255, 190, 110), Enum.Material.Neon)
		light(box, "Light", LAMP_LIGHT, 1, 14)
		part(house, "ToroRoof", Vector3.new(2.6, 0.5, 2.6), base * CFrame.new(0, 4.65, 0), STONE, Enum.Material.Slate)
	end
	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "Spawn"
	spawn.Anchored = true
	spawn.Neutral = true
	spawn.Duration = 0 -- the Tea House itself keeps you safe (the TeaHouse script)
	spawn.Size = Vector3.new(8, 1, 8)
	local sp = v3(L.SPAWN.at)
	spawn.CFrame = CFrame.lookAt(sp, sp + v3(L.SPAWN.facing))
	spawn.Color = WOOD
	spawn.Material = Enum.Material.WoodPlanks
	spawn.Transparency = 0
	spawn.Parent = house
	house.Parent = workspace
	local grounds = buildGrounds()
	return { house = house, grounds = grounds, spawn = spawn, redDoor = red, gate = grounds:FindFirstChild("Gate") :: Model }
end

return TeaHouseStage
