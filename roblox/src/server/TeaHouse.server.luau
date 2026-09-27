--!strict
-- The Tea House, server side (0039): build it and the Dueling Grounds' dressing, send a player
-- through the red door or the gate when they walk into its portal, trigger its prompt or click it
-- (the VR laser pointer), and keep the Tea House a safe zone. Its own Script, apart from Main: it
-- touches none of the table's seats, relay, tokens or rejoining.
--
-- The client moves its own character (TeaHouse.client: fade, move, the place's light, fade back),
-- because a character's physics belong to its client; this script only decides who goes where,
-- from events Roblox raises on the server, and sends `TapstoneTravel` (destination) to that client.

local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local TeaHouseLayout = require(ReplicatedStorage:WaitForChild("TapstoneShared"):WaitForChild("TeaHouseLayout"))
local TeaHouseStage = require(script.Parent.TeaHouseStage)

local COOLDOWN = 2 -- seconds between two trips for one player: a portal is touched many times at once
local SAFE = "TeaHouseSafe" -- the ForceField's name

local travel = Instance.new("RemoteEvent")
travel.Name = "TapstoneTravel" -- server → one client: the destination, a TeaHouseLayout.TRAVEL key
travel.Parent = ReplicatedStorage

-- The Tea House's light is the place's default: everyone spawns there. A client sets each place's
-- light as it arrives.
local light = TeaHouseLayout.LIGHT.TeaHouse
Lighting.ClockTime = light.ClockTime
Lighting.Brightness = light.Brightness
Lighting.Ambient = Color3.fromRGB(light.Ambient[1], light.Ambient[2], light.Ambient[3])
Lighting.OutdoorAmbient = Color3.fromRGB(light.OutdoorAmbient[1], light.OutdoorAmbient[2], light.OutdoorAmbient[3])
Lighting.FogColor = Color3.fromRGB(light.FogColor[1], light.FogColor[2], light.FogColor[3])
Lighting.FogStart = light.FogStart
Lighting.FogEnd = light.FogEnd

local built = TeaHouseStage.build()

local lastTrip: { [Player]: number } = {}

local function send(p: Player?, destination: string)
	if p == nil then
		return
	end
	local now = os.clock()
	if now - (lastTrip[p] or -math.huge) < COOLDOWN then
		return
	end
	lastTrip[p] = now
	travel:FireClient(p, destination)
end

-- A way through: its portal (walking in), its prompt and its click detector all send a player on.
local function wire(door: Model, destination: string)
	local portal = door:WaitForChild("Portal") :: Part
	portal.Touched:Connect(function(hit: BasePart)
		local character = hit.Parent
		if character and character:FindFirstChildOfClass("Humanoid") then
			send(Players:GetPlayerFromCharacter(character), destination)
		end
	end)
	local prompt = portal:WaitForChild("Travel") :: ProximityPrompt
	prompt.Triggered:Connect(function(p: Player)
		send(p, destination)
	end)
	local click = portal:FindFirstChildOfClass("ClickDetector") :: ClickDetector
	click.MouseClick:Connect(function(p: Player)
		send(p, destination)
	end)
end

wire(built.redDoor, "DuelingGrounds")
wire(built.gate, "TeaHouse")

Players.PlayerRemoving:Connect(function(p: Player)
	lastTrip[p] = nil
end)

-- The safe zone: while a character stands in the Tea House it wears an invisible ForceField, so
-- nothing can harm it there; leaving takes the field away.
task.spawn(function()
	local box = TeaHouseLayout.hallBox()
	while true do
		for _, p in Players:GetPlayers() do
			local character = p.Character
			local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
			if character and root then
				local at = root.Position
				local inside = TeaHouseLayout.inside({ x = at.X, y = at.Y, z = at.Z }, box)
				local field = character:FindFirstChild(SAFE)
				if inside and field == nil then
					local f = Instance.new("ForceField")
					f.Name = SAFE
					f.Visible = false
					f.Parent = character
				elseif not inside and field then
					field:Destroy()
				end
			end
		end
		task.wait(0.5)
	end
end)

print("[Tapstone] the Tea House is open")
