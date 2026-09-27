--!strict
-- The physical scene: a floor, a spawn, the table and a chair for each seat. The board itself is drawn by
-- each client on top of `TapstoneTable.Top` (BoardView), so the server only builds what everyone
-- shares and what the chairs need.
--
-- Geometry, in studs, from the table top's centre: the board runs along Z. Seat 1's chair is on the
-- +Z end facing -Z, seat 0's on the -Z end facing +Z: each player sits behind their own side of the
-- board, as at a real table (BoardView draws seat 1's track nearest +Z for everyone).

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Layout = require(ReplicatedStorage:WaitForChild("TapstoneShared"):WaitForChild("Layout"))

local Stage = {}

Stage.TOP_SIZE = Vector3.new(18, 1, 34)
Stage.TOP_POSITION = Vector3.new(0, Layout.TOP_Y, 0)
Stage.CHAIR_Z = Layout.CHAIR_Z -- seat 1 at +21, seat 0 at -21

local function part(props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for k, v in props do
		(p :: any)[k] = v
	end
	return p
end

-- Builds workspace.TapstoneTable once and returns its two chairs, by seat.
function Stage.build(): { [number]: Seat }
	local existing = workspace:FindFirstChild("TapstoneTable")
	if existing then
		existing:Destroy()
	end
	local model = Instance.new("Model")
	model.Name = "TapstoneTable"

	part({
		Name = "Floor",
		Size = Vector3.new(240, 1, 240),
		Position = Vector3.new(0, -0.5, 0),
		Color = Color3.fromRGB(46, 52, 64),
		Material = Enum.Material.Slate,
	}).Parent = model

	-- No spawn here: players spawn in the Tea House and come through the red door (TeaHouseStage, 0039).

	part({
		Name = "Top",
		Size = Stage.TOP_SIZE,
		Position = Stage.TOP_POSITION,
		Color = Color3.fromRGB(94, 67, 44),
		Material = Enum.Material.Wood,
	}).Parent = model

	for _, x in { -7, 7 } do
		for _, z in { -14, 14 } do
			part({
				Name = "Leg",
				Size = Vector3.new(1.5, 3, 1.5),
				Position = Vector3.new(x, 1.5, z),
				Color = Color3.fromRGB(70, 50, 33),
				Material = Enum.Material.Wood,
			}).Parent = model
		end
	end

	local chairs: { [number]: Seat } = {}
	for seat = 0, 1 do
		local z = if seat == 1 then Stage.CHAIR_Z else -Stage.CHAIR_Z
		local at = Vector3.new(0, 1.5, z)
		local chair = Instance.new("Seat")
		chair.Name = `Chair{seat}`
		chair.Anchored = true
		chair.Size = Vector3.new(4, 1, 4)
		chair.CFrame = CFrame.lookAt(at, Vector3.new(0, 1.5, 0))
		chair.Color = Color3.fromRGB(224, 165, 38)
		chair:SetAttribute("TapstoneSeat", seat)
		chair.Parent = model
		local sign = Instance.new("BillboardGui")
		sign.Size = UDim2.fromOffset(160, 40)
		sign.StudsOffset = Vector3.new(0, 4, 0)
		sign.Parent = chair
		local text = Instance.new("TextLabel")
		text.Size = UDim2.fromScale(1, 1)
		text.BackgroundTransparency = 0.3
		text.BackgroundColor3 = Color3.fromRGB(22, 27, 34)
		text.TextColor3 = Color3.fromRGB(240, 236, 226)
		text.TextScaled = true
		text.Font = Enum.Font.GothamBold
		text.Text = `Sit here: seat {seat}`
		text.Parent = sign
		chairs[seat] = chair
	end

	model.PrimaryPart = model:FindFirstChild("Top") :: BasePart
	model.Parent = workspace
	return chairs
end

return Stage
