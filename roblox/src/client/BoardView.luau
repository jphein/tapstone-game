--!strict
-- The arena's board, drawn as parts on the table (spec §4): 3 lanes × 6 cells, a block per unit
-- with a billboard (crest and name, attack / health, keyword), both castles with their line of
-- state, and a banner saying whose turn it is. Client-local: every player draws their own copy
-- from the same view bodies, so nothing here replicates or holds game state.
--
-- The board is fixed in the world: seat 1's track runs from the +Z chair, seat 0's from the -Z
-- chair (Stage), so each player sits behind their own side. What differs per viewer is 0027's
-- rule: the viewer's own units are objects (tall blocks, full billboard), the other side's are
-- entries (low stone, one short tag). Someone not seated sees both sides as objects.
--
-- Geometry comes from Layout, the same numbers the VR field-of-view test checks. In VR
-- (BoardView.create(true)) billboards are sized in studs rather than pixels, so text keeps a
-- physical size in the headset; the banner hangs at the far end from the viewer; and the
-- viewer's own castle line moves onto their hand panel (HandUI), next to their hands.

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local shared = ReplicatedStorage:WaitForChild("TapstoneShared")
local Layout = require(shared:WaitForChild("Layout"))
local Protocol = require(shared:WaitForChild("Protocol"))
local Effects = require(shared:WaitForChild("Effects"))

local BoardView = {}

local UNIT = Vector3.new(3.4, 2, 3.4)
local COMMANDER = Vector3.new(3.4, 3.2, 3.4)
local ENTRY = Vector3.new(3.0, 0.8, 3.0)
local WORLD_NEAR = 1 -- the seat whose track starts at the +Z chair
local INK = Color3.fromRGB(240, 236, 226)
local SHADOW = Color3.fromRGB(16, 20, 26)

local vr = false

local function rgb(faction: string): Color3
	local r, g, b = Protocol.factionRGB(faction)
	return Color3.fromRGB(r, g, b)
end

-- A Layout point, relative to the table top, as a Vector3 on the top's surface plane (y = 0).
local function onTop(p: Layout.Point): Vector3
	return Vector3.new(p.x, 0, p.z)
end

-- `px` is the flat size in pixels; `studs` the VR size in studs (width, height).
local function billboard(parent: BasePart, height: number, px: Vector2, studs: Vector2, text: string, name: string): TextLabel
	local gui = Instance.new("BillboardGui")
	gui.Name = name
	gui.Size = if vr then UDim2.fromScale(studs.X, studs.Y) else UDim2.fromOffset(px.X, px.Y)
	gui.StudsOffset = Vector3.new(0, height, 0)
	gui.MaxDistance = 120
	gui.Parent = parent
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundColor3 = SHADOW
	label.BackgroundTransparency = 0.25
	label.TextColor3 = INK
	label.TextStrokeTransparency = 0.4
	label.TextScaled = true
	label.Font = Enum.Font.GothamMedium
	label.Text = text
	label.Parent = gui
	local limit = Instance.new("UITextSizeConstraint")
	limit.MinTextSize = 12
	limit.MaxTextSize = if vr then 48 else 22
	limit.Parent = label
	return label
end

local root: Folder
local unitsFolder: Folder
local top: BasePart
local castleParts: { [number]: Part } = {} -- by seat
local castleLabels: { [number]: TextLabel } = {} -- by seat
local mast: Part
local bannerLabel: TextLabel
local unitParts: { [string]: Part } = {} -- "seat:lane:cell" (0-based, as in Effects) -> the drawn unit
local fxFolder: Folder

local function block(name: string, size: Vector3, offset: Vector3, color: Color3, parent: Instance): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Anchored = true
	p.CanCollide = false
	p.CanTouch = false
	p.CanQuery = false
	p.Size = size
	p.Color = color
	p.Material = Enum.Material.SmoothPlastic
	p.CFrame = top.CFrame * CFrame.new(offset + Vector3.new(0, top.Size.Y / 2 + size.Y / 2, 0))
	p.Parent = parent
	return p
end

-- Builds the static board once: the 18 cells, the castles and the banner. `inVR` is the local
-- player's VRService.VREnabled (only a LocalScript can read it).
function BoardView.create(inVR: boolean)
	vr = inVR
	top = workspace:WaitForChild("TapstoneTable"):WaitForChild("Top") :: BasePart
	root = Instance.new("Folder")
	root.Name = "TapstoneBoard"
	root.Parent = workspace
	unitsFolder = Instance.new("Folder")
	unitsFolder.Name = "Units"
	unitsFolder.Parent = root
	fxFolder = Instance.new("Folder")
	fxFolder.Name = "Effects"
	fxFolder.Parent = root

	for col = 0, 2 do
		for row = 0, 5 do
			local tile = block(`Cell{col}{row}`, Vector3.new(Layout.CELL - 0.4, 0.2, Layout.CELL - 0.4), onTop(Layout.cellCenter(col, row)), Color3.fromRGB(60, 68, 82), root)
			tile.Material = Enum.Material.Slate
		end
	end
	for seat = 0, 1 do
		local c = Layout.castleCenter(seat)
		-- Named by world end, as before: CastleNear is seat 1's (+Z), CastleFar seat 0's (-Z).
		local name = if seat == WORLD_NEAR then "CastleNear" else "CastleFar"
		castleParts[seat] = block(name, Vector3.new(Layout.CASTLE_WIDTH, Layout.CASTLE_HEIGHT, Layout.CASTLE_DEPTH), onTop(c), rgb("neutral"), root)
		castleLabels[seat] = billboard(castleParts[seat], Layout.CASTLE_LABEL_ABOVE, Vector2.new(420, 64), Vector2.new(11, 1.3), "", "Band")
	end
	mast = block("Banner", Vector3.new(0.4, 0.4, 0.4), onTop(Layout.banner(WORLD_NEAR)) + Vector3.new(0, Layout.BANNER_ABOVE, 0), rgb("gold"), root)
	mast.Transparency = 1
	bannerLabel = billboard(mast, 0, Vector2.new(520, 64), Vector2.new(12, 1.6), "Waiting for the arena…", "Banner")
end

local function drawUnit(u: Protocol.Unit, col: number, row: number, style: Protocol.Style): Part
	local a, b, c = Protocol.unitLines(u)
	local at = onTop(Layout.cellCenter(col, row)) + Vector3.new(0, 0.2, 0)
	if style == "entry" then
		-- theirs: low carved stone, faction-coloured, with one tag no louder than mine
		local p = block(u.name, ENTRY, at, rgb(u.faction), unitsFolder)
		p.Material = Enum.Material.Slate
		local crest = if u.commander then "♛ " else ""
		billboard(p, 1.4, Vector2.new(90, 30), Vector2.new(2.4, 0.8), `{crest}{b}{if c ~= "" then " " .. string.sub(c, 1, 2) else ""}`, "Stats")
		return p
	end
	local size = if u.commander then COMMANDER else UNIT
	local p = block(u.name, size, at, rgb(u.faction), unitsFolder)
	if u.commander then
		p.Material = Enum.Material.Neon -- the crest, in 3D: one of the three ownership cues
	end
	billboard(p, size.Y / 2 + 1.6, Vector2.new(150, 64), Vector2.new(3.6, 1.8), `{a}\n{b}{if c ~= "" then "\n" .. c else ""}`, "Stats")
	return p
end

-- Draws one view (the decoded `view` object) for a viewer in seat `mySeat` (nil: not seated).
function BoardView.render(v: Protocol.View, mySeat: number?)
	local b = Protocol.boardOf(v)
	unitsFolder:ClearAllChildren()
	-- The banner hangs ahead of the viewer: past the other seat's castle.
	local viewer = mySeat or WORLD_NEAR
	mast.CFrame = top.CFrame * CFrame.new(onTop(Layout.banner(viewer)) + Vector3.new(0, Layout.BANNER_ABOVE, 0))
	table.clear(unitParts)
	bannerLabel.Text = Protocol.banner(v) or `Round {b.round} · seat {b.active} to act`
	if #b.seats < 2 then
		for _, label in castleLabels do
			label.Text = ""
		end
		return
	end
	for seat = 0, 1 do
		local s = b.seats[seat + 1]
		local castle = castleParts[seat]
		-- In VR the viewer's own castle is a low plinth: full height, it walls off the board
		-- from a seated head (Layout.castleHeight).
		local h = Layout.castleHeight(seat, mySeat, vr)
		if math.abs(castle.Size.Y - h) > 1e-3 then
			castle.Size = Vector3.new(Layout.CASTLE_WIDTH, h, Layout.CASTLE_DEPTH)
			castle.CFrame = top.CFrame * CFrame.new(onTop(Layout.castleCenter(seat)) + Vector3.new(0, top.Size.Y / 2 + h / 2, 0))
		end
		castle.Color = rgb(s.faction)
		castle.Material = if b.active == seat and b.phase == "playing" then Enum.Material.Neon else Enum.Material.SmoothPlastic
		local you = if seat == mySeat then " (you)" else ""
		castleLabels[seat].Text = `seat {seat}{you}: {Protocol.bandText(s, b.round)}`
		-- In VR the viewer's own line is on their hand panel; above their castle it would sit
		-- right behind the panel.
		(castleLabels[seat].Parent :: BillboardGui).Enabled = not (vr and seat == mySeat)
	end
	for _, x in Protocol.units(b, WORLD_NEAR) do
		local p = drawUnit(x.unit, x.col, x.row, Protocol.styleFor(x.seat, mySeat))
		unitParts[`{x.seat}:{x.lane - 1}:{x.cell - 1}`] = p
	end
end

-- ---- Card animations (Effects: the headset's effects.js, ported) -------------------------------
-- The board above always shows the newest view; these only add motion, one effect at a time, in
-- record order, from Effects.diff of consecutive views. A part a later redraw replaced just stops.

local queue = Effects.queue(8)
local lastView: any = nil
local lastBody = ""

local function castleOf(seat: number): Part
	return castleParts[seat]
end

-- A cell's world CFrame on the table top (0-based seat, lane, cell).
local function cellCFrame(seat: number, lane: number, cell: number): CFrame
	local col, row = Protocol.gridOf(seat, lane + 1, cell + 1, WORLD_NEAR)
	return top.CFrame * CFrame.new(onTop(Layout.cellCenter(col, row)) + Vector3.new(0, top.Size.Y / 2, 0))
end

local function tween(inst: Instance, seconds: number, goal: { [string]: any }, style: Enum.EasingStyle?)
	local t = TweenService:Create(inst, TweenInfo.new(seconds, style or Enum.EasingStyle.Quad, Enum.EasingDirection.Out), goal)
	t:Play()
	return t
end

-- A short-lived part in the effects folder, gone after `life` seconds.
local function spark(name: string, size: Vector3, at: CFrame, color: Color3, life: number): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Anchored, p.CanCollide, p.CanTouch, p.CanQuery = true, false, false, false
	p.Size, p.CFrame, p.Color = size, at, color
	p.Material = Enum.Material.Neon
	p.Parent = fxFolder
	task.delay(life, function()
		p:Destroy()
	end)
	return p
end

local PLAY: { [string]: (e: Effects.Effect, d: number) -> () } = {}

-- summon: the arc from the altar (the seat's castle) and the rise into its cell.
PLAY.summon = function(e, d)
	local p = unitParts[`{e.seat}:{e.lane}:{e.cell}`]
	if not p then
		return
	end
	local goal, size = p.CFrame, p.Size
	local from = castleOf(e.seat :: number).CFrame
	p.CFrame = from:Lerp(goal, 0.5) * CFrame.new(0, 6, 0)
	p.Size = size * 0.2
	tween(p, d, { CFrame = goal, Size = size }, Enum.EasingStyle.Back)
end

PLAY.advance = function(e, d)
	local p = unitParts[`{e.seat}:{e.lane}:{e.to}`]
	if not p then
		return
	end
	local goal = p.CFrame
	p.CFrame = cellCFrame(e.seat :: number, e.lane :: number, e.from :: number) * CFrame.new(0, p.Size.Y / 2 + 0.2, 0)
	tween(p, d, { CFrame = goal })
end

-- damage: the stagger and the rim flash.
PLAY.damage = function(e, d)
	local p = unitParts[`{e.seat}:{e.lane}:{e.cell}`]
	if not p then
		return
	end
	local rim = Instance.new("Highlight")
	rim.FillColor = Color3.fromRGB(255, 70, 50)
	rim.OutlineColor = Color3.fromRGB(255, 220, 200)
	rim.FillTransparency = 0.2
	rim.Parent = p
	local home = p.CFrame
	p.CFrame = home * CFrame.Angles(0, 0, math.rad(12))
	tween(p, d, { CFrame = home }, Enum.EasingStyle.Elastic)
	tween(rim, d, { FillTransparency = 1, OutlineTransparency = 1 })
	task.delay(d, function()
		rim:Destroy()
	end)
end

-- death: the crumble, four shards of the faction's stone sinking into the cell.
PLAY.death = function(e, d)
	local at = cellCFrame(e.seat :: number, e.lane :: number, e.cell :: number)
	for i = 0, 3 do
		local off = Vector3.new((i % 2 - 0.5) * 1.4, 1 + i * 0.3, (i // 2 - 0.5) * 1.4)
		local shard = spark("Shard", Vector3.new(1.3, 1.1, 1.3), at * CFrame.new(off), rgb(e.faction or "neutral"), d)
		shard.Material = Enum.Material.Slate
		tween(shard, d, { CFrame = at * CFrame.new(off.X * 1.6, -0.4, off.Z * 1.6) * CFrame.Angles(math.rad(40 * i), 0, math.rad(25)), Transparency = 1, Size = Vector3.new(0.4, 0.4, 0.4) })
	end
end

-- clash: a flash across the front line of the lane.
PLAY.clash = function(e, d)
	local near = cellCFrame(0, e.lane :: number, 2)
	local far = cellCFrame(1, e.lane :: number, 2)
	local flash = spark("Clash", Vector3.new(Layout.CELL, 0.3, Layout.GAP), near:Lerp(far, 0.5) * CFrame.new(0, 1, 0), Color3.fromRGB(255, 236, 170), d)
	tween(flash, d, { Size = Vector3.new(Layout.CELL * 1.6, 3, Layout.GAP * 2), Transparency = 1 })
end

-- keepChip: a chip of the keep flies off and falls away.
PLAY.keepChip = function(e, d)
	local c = castleOf(e.seat :: number)
	local chip = spark("Chip", Vector3.new(1, 0.8, 0.8), c.CFrame * CFrame.new(0, c.Size.Y / 2, 0), c.Color, d)
	chip.Material = c.Material
	local out = if e.seat == WORLD_NEAR then 1 else -1
	tween(chip, d, { CFrame = c.CFrame * CFrame.new(2.5, -1, 3 * out) * CFrame.Angles(math.rad(90), 0, math.rad(60)), Transparency = 1 })
end

-- chargeGem: a mana gem lights above the keep.
PLAY.chargeGem = function(e, d)
	local c = castleOf(e.seat :: number)
	local gem = spark("Gem", Vector3.new(0.3, 0.3, 0.3), c.CFrame * CFrame.new(0, c.Size.Y / 2 + 1.2, 0), Color3.fromRGB(110, 200, 255), d)
	gem.Shape = Enum.PartType.Ball
	tween(gem, d, { Size = Vector3.new(1.2, 1.2, 1.2), Transparency = 0.8 }, Enum.EasingStyle.Back)
end

-- drawFlip: the draw arriving, a card that flips over the keep (face shown to its drawer only).
PLAY.drawFlip = function(e, d)
	local c = castleOf(e.seat :: number)
	local at = c.CFrame * CFrame.new(0, c.Size.Y / 2 + 2, 0)
	local card = spark("Card", Vector3.new(1.6, 2.2, 0.1), at * CFrame.new(0, -1.5, 0), Color3.fromRGB(236, 226, 200), d + 0.2)
	card.Material = Enum.Material.SmoothPlastic
	if e.card then
		billboard(card, 1.6, Vector2.new(120, 26), Vector2.new(3, 0.7), e.card, "Drawn")
	end
	tween(card, d, { CFrame = at * CFrame.Angles(0, math.rad(180), 0) }, Enum.EasingStyle.Back)
end

-- commanderFall / commanderReturn: the crumble or the summon, at the commander's lane.
PLAY.commanderFall = function(e, d)
	PLAY.death({ type = "death", seat = e.seat, lane = (e.lane or 1) - 1, cell = 0, faction = "gold" }, d)
end
PLAY.commanderReturn = function(e, d)
	local c = castleOf(e.seat :: number)
	local ring = spark("Return", Vector3.new(0.4, 6, 6), c.CFrame * CFrame.Angles(0, 0, math.rad(90)), rgb("gold"), d)
	ring.Shape = Enum.PartType.Cylinder
	tween(ring, d, { Size = Vector3.new(0.4, 12, 12), Transparency = 1 })
end

-- result: the winner's keep pulses.
PLAY.result = function(e, d)
	if e.winner == nil then
		return
	end
	local c = castleOf(e.winner :: number)
	local glow = spark("Win", c.Size * 1.1, c.CFrame, rgb("gold"), d)
	glow.Transparency = 0.3
	tween(glow, d, { Size = c.Size * 1.8, Transparency = 1 })
end

-- The frame loop: start the next effect when the one playing is done.
local started = false
local function startLoop()
	if started then
		return
	end
	started = true
	RunService.Heartbeat:Connect(function()
		local e = queue:next(os.clock())
		if e then
			local play = PLAY[e.type]
			if play then
				play(e, Effects.DURATION[e.type] or 0.3)
			end
		end
	end)
end

-- Decodes a raw /remote/view body ({"n","view"}), draws it, and returns the decoded view (nil for
-- a bad body, which is ignored).
function BoardView.renderBody(body: string, mySeat: number?): Protocol.View?
	if body == "" then
		return nil
	end
	local ok, msg = pcall(HttpService.JSONDecode, HttpService, body)
	if ok and type(msg) == "table" and type(msg.view) == "table" then
		BoardView.render(msg.view, mySeat)
		-- a redraw for a seating change is the same body: no new motion
		if body ~= lastBody then
			lastBody = body
			if lastView ~= nil then
				queue:push(Effects.diff(lastView, msg.view, mySeat))
			end
			lastView = msg.view
			startLoop()
		end
		return msg.view
	end
	return nil
end

return BoardView
