--!strict
-- The Tea House, client side (0039): travel with a fade, each place's light, and the doors that stir
-- when a faction casts or wins. Its own LocalScript, apart from Main, BoardView and HandUI.
--
-- Travel (the server sends `TapstoneTravel` when you walk into a portal, trigger its prompt or click
-- it): fade to black, stand up if seated, move the character to the leg's arrival point, set the
-- place's light, fade back. Comfort, for VR and flat alike: the fade hides the move, and the move
-- only translates, never turns (TeaHouseLayout lays out the doors so the way you walk is the way
-- you face). Nothing here touches the camera: Roblox's own camera (and in VR, each player's
-- comfort settings) follows the character as always. The fade is a ColorCorrectionEffect, which
-- colours the whole rendered view, a headset's included, rather than a 2D panel.
--
-- The doors: every view body the server forwards (the same ones BoardView draws) goes through
-- DoorSigns, and a cast lights the caster's door, a win breathes its weather. The gate on the
-- Dueling Grounds glows after a win: the way back, after a match.

local HttpService = game:GetService("HttpService")
local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local shared = ReplicatedStorage:WaitForChild("TapstoneShared")
local DoorSigns = require(shared:WaitForChild("DoorSigns"))
local TeaHouseLayout = require(shared:WaitForChild("TeaHouseLayout"))

local FADE_OUT, HOLD, FADE_IN = 0.3, 0.15, 0.4 -- seconds

local player = Players.LocalPlayer
local travel = ReplicatedStorage:WaitForChild("TapstoneTravel") :: RemoteEvent
local remotes = ReplicatedStorage:WaitForChild("TapstoneRemotes") :: Folder
local viewEvent = remotes:WaitForChild("View") :: RemoteEvent

local fade = Instance.new("ColorCorrectionEffect")
fade.Name = "TeaHouseFade"
fade.TintColor = Color3.new(1, 1, 1)
fade.Parent = Lighting

local function rgb(c: { number }): Color3
	return Color3.fromRGB(c[1], c[2], c[3])
end

local function applyLight(zone: string)
	local l = TeaHouseLayout.LIGHT[zone]
	if l == nil then
		return
	end
	Lighting.ClockTime = l.ClockTime
	Lighting.Brightness = l.Brightness
	Lighting.Ambient = rgb(l.Ambient)
	Lighting.OutdoorAmbient = rgb(l.OutdoorAmbient)
	Lighting.FogColor = rgb(l.FogColor)
	Lighting.FogStart = l.FogStart
	Lighting.FogEnd = l.FogEnd
end

local function tweenTint(to: Color3, seconds: number)
	local t = TweenService:Create(fade, TweenInfo.new(seconds, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut), { TintColor = to })
	t:Play()
	t.Completed:Wait()
end

local busy = false
local function go(destination: string)
	local leg = TeaHouseLayout.TRAVEL[destination]
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if busy or leg == nil or character == nil or humanoid == nil then
		return
	end
	busy = true
	tweenTint(Color3.new(0, 0, 0), FADE_OUT)
	if humanoid.SeatPart then
		humanoid.Sit = false
		task.wait()
	end
	local target = Vector3.new(leg.arrive.x, leg.arrive.y, leg.arrive.z)
	pcall(function()
		player:RequestStreamAroundAsync(target, 2) -- in case the place streams; a no-op cost otherwise
	end)
	local pivot = character:GetPivot()
	character:PivotTo(CFrame.new(target) * pivot.Rotation) -- translate only: your facing is yours
	applyLight(leg.zone)
	task.wait(HOLD)
	tweenTint(Color3.new(1, 1, 1), FADE_IN)
	busy = false
end

travel.OnClientEvent:Connect(go)

-- A new character spawns in the Tea House: its light, and no fade left over from a trip cut short.
player.CharacterAdded:Connect(function()
	fade.TintColor = Color3.new(1, 1, 1)
	busy = false
	applyLight("TeaHouse")
end)

-- ---- The doors stir ----------------------------------------------------------------------------

local function pulse(door: Instance?, peak: number, hold: number, burst: number)
	if door == nil then
		return
	end
	local leaf = door:FindFirstChild("Leaf") or door:FindFirstChild("Portal")
	local glow = leaf and leaf:FindFirstChild("Glow") :: PointLight?
	local weather = leaf and leaf:FindFirstChild("Weather") :: ParticleEmitter?
	if glow then
		local up = TweenService:Create(glow, TweenInfo.new(0.3), { Brightness = peak })
		local down = TweenService:Create(glow, TweenInfo.new(hold, Enum.EasingStyle.Sine), { Brightness = 0 })
		up.Completed:Once(function()
			down:Play()
		end)
		up:Play()
	end
	if weather and burst > 0 then
		weather:Emit(burst)
	end
end

local state = DoorSigns.new()
viewEvent.OnClientEvent:Connect(function(body: string)
	local ok, msg = pcall(HttpService.JSONDecode, HttpService, body)
	if not ok or type(msg) ~= "table" or type(msg.view) ~= "table" then
		return
	end
	local house = workspace:FindFirstChild("TeaHouse")
	local doors = house and house:FindFirstChild("Doors")
	for _, stir in DoorSigns.step(state, msg.view) do
		local id = TeaHouseLayout.FACTION_DOOR[stir.faction]
		local door = if doors and id then doors:FindFirstChild(id) else nil
		if stir.kind == "cast" then
			pulse(door, 2.5, 1.6, 0) -- a glow
		else
			pulse(door, 4, 4, 40) -- a win: a longer glow, and a breath of its weather
			local grounds = workspace:FindFirstChild("DuelingGrounds")
			pulse(grounds and grounds:FindFirstChild("Gate"), 3, 6, 20) -- the way back
		end
	end
end)
