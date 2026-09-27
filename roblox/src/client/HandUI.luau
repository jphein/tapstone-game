--!strict
-- A seated player's hand: their own seat's move menu as tiles along the bottom of the screen, useful
-- moves first (Protocol.orderMenu), each labelled with the arena's own `label`. A click sends
-- (menu n, arena index) to the server, which relays it for the clicker's own seat only. The tiles
-- lock after a click: the menu is spent, and the next view brings the next one.
--
-- Everyone sees the status line: who holds each seat, and anything the server says.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local shared = ReplicatedStorage:WaitForChild("TapstoneShared")
local Layout = require(shared:WaitForChild("Layout"))
local Protocol = require(shared:WaitForChild("Protocol"))

local HandUI = {}

local INK = Color3.fromRGB(240, 236, 226)
local PANEL = Color3.fromRGB(22, 27, 34)
local DIM = Color3.fromRGB(70, 78, 90)

local tiles: GuiObject
local status: TextLabel
local remotes: Folder
local vr = false
local panelSeat: number? = nil -- the seat whose VR panel is built
local panelPart: Part? = nil
local bandLabel: TextLabel? = nil
local lastMenu: string? = nil -- the last menu body, re-shown when the VR panel is (re)built
local lastView: Protocol.View? = nil -- the last view, for the panel's castle line (same reason)

-- The seat the local player holds, from the server's Seat0Name / Seat1Name attributes, or nil.
function HandUI.mySeat(): number?
	local me = Players.LocalPlayer.Name
	for seat = 0, 1 do
		if remotes:GetAttribute(`Seat{seat}Name`) == me then
			return seat
		end
	end
	return nil
end

local function nameAt(seat: number): string
	local raw = remotes:GetAttribute(`Seat{seat}Name`)
	return if type(raw) == "string" then raw else ""
end

local function refreshStatus()
	local mine = HandUI.mySeat()
	local rawMessage = remotes:GetAttribute("Message")
	local message = if type(rawMessage) == "string" then rawMessage else ""
	local line
	if mine ~= nil then
		local other = nameAt(1 - mine)
		line = `You play seat {mine}` .. (if other ~= "" then ` against {other}` else " · waiting for seat " .. (1 - mine))
	else
		local a, b = nameAt(0), nameAt(1)
		if a == "" or b == "" then
			line = "Sit in a gold chair to play (one per seat)"
		else
			line = `Watching: {a} (seat 0) against {b} (seat 1)`
		end
	end
	status.Text = if message ~= "" then `{line} · {message}` else line
end

local function clear()
	for _, child in tiles:GetChildren() do
		if child:IsA("TextButton") then
			child:Destroy()
		end
	end
end

-- Shows a raw /remote/choices body ({"n","menu"}).
function HandUI.show(body: string)
	local ok, msg = pcall(HttpService.JSONDecode, HttpService, body)
	if not ok or type(msg) ~= "table" or type(msg.n) ~= "number" or type(msg.menu) ~= "table" then
		return
	end
	lastMenu = body
	-- In VR the tiles live on the panel, built when the seat attribute arrives. The server sets
	-- that attribute and then fires the menu, but the two replicate separately: a menu that lands
	-- first is kept and shown when the panel is built.
	if vr and panelPart == nil then
		return
	end
	clear()
	local n: number = msg.n
	local choose = remotes:WaitForChild("Choose") :: RemoteEvent
	for order, entry in Protocol.orderMenu(msg.menu) do
		local button = Instance.new("TextButton")
		button.Name = `Move{entry.index}`
		button.LayoutOrder = order
		button.Size = UDim2.fromOffset(170, 64) -- flat; a UIGridLayout sizes it in VR
		button.AutoButtonColor = true
		button.BackgroundColor3 = if entry.item.useful then Color3.fromRGB(Protocol.factionRGB("gold")) else DIM
		button.TextColor3 = if entry.item.useful then PANEL else INK
		button.TextScaled = true
		button.TextWrapped = true
		button.Font = Enum.Font.GothamBold
		button.Text = entry.item.label
		local limit = Instance.new("UITextSizeConstraint")
		limit.MinTextSize = 14
		limit.MaxTextSize = 24
		limit.Parent = button
		button.Activated:Connect(function()
			for _, other in tiles:GetChildren() do
				if other:IsA("TextButton") then
					other.Active = false
					other.AutoButtonColor = false
					other.BackgroundTransparency = 0.6
				end
			end
			choose:FireServer(n, entry.index)
		end)
		button.Parent = tiles
	end
end

-- The VR hand panel for `seat`: a small lectern between the chair and the table (Layout.panel),
-- turned to face the seated head, carrying the seat's castle line, the status and the move tiles.
-- It's client-local; its SurfaceGui lives in PlayerGui with Adornee set to the panel, and the
-- panel has CanQuery on, which is what lets the VR laser pointer press its buttons (Roblox
-- SurfaceGui: interactive elements "receive user input if they are parented to the PlayerGui",
-- via Adornee, and "the part's CanQuery property must be true"; creator-docs@0b817b5).
local function buildPanel(seat: number)
	if panelPart then
		panelPart:Destroy()
	end
	local gui = Players.LocalPlayer:WaitForChild("PlayerGui")
	local old = gui:FindFirstChild("TapstonePanel")
	if old then
		old:Destroy()
	end
	local spec = Layout.panel(seat)
	local head = Layout.head(seat)
	local top = workspace:WaitForChild("TapstoneTable"):WaitForChild("Top") :: BasePart
	local origin = top.Position - Vector3.new(0, Layout.TOP_Y, 0) -- Layout's (0, 0, 0)
	local centre = origin + Vector3.new(spec.center.x, spec.center.y, spec.center.z)
	local part = Instance.new("Part")
	part.Name = `TapstoneHandPanel{seat}`
	part.Anchored = true
	part.CanCollide = false
	part.CanTouch = false
	part.CanQuery = true
	part.Size = Vector3.new(spec.width, spec.height, 0.1)
	part.CFrame = CFrame.lookAt(centre, origin + Vector3.new(head.x, head.y, head.z))
	part.Color = PANEL
	part.Material = Enum.Material.SmoothPlastic
	part.Parent = workspace
	panelPart = part

	local surface = Instance.new("SurfaceGui")
	surface.Name = "TapstonePanel"
	surface.Adornee = part
	surface.Face = Enum.NormalId.Front -- CFrame.lookAt points Front at the head
	surface.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	surface.PixelsPerStud = 60
	surface.LightInfluence = 0
	surface.ResetOnSpawn = false
	surface.Parent = gui

	local band = Instance.new("TextLabel")
	band.Name = "Band"
	band.Size = UDim2.new(1, 0, 0.16, 0)
	band.BackgroundTransparency = 1
	band.TextColor3 = INK
	band.TextScaled = true
	band.Font = Enum.Font.GothamBold
	band.Text = `seat {seat}`
	band.Parent = surface
	bandLabel = band

	status = Instance.new("TextLabel")
	status.Name = "Status"
	status.Size = UDim2.new(1, 0, 0.14, 0)
	status.Position = UDim2.new(0, 0, 0.16, 0)
	status.BackgroundTransparency = 1
	status.TextColor3 = INK
	status.TextScaled = true
	status.Font = Enum.Font.GothamMedium
	status.Parent = surface

	local scroll = Instance.new("ScrollingFrame")
	scroll.Name = "Tiles"
	scroll.Size = UDim2.new(1, 0, 0.7, 0)
	scroll.Position = UDim2.new(0, 0, 0.3, 0)
	scroll.BackgroundTransparency = 1
	scroll.ScrollBarThickness = 8
	scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
	scroll.CanvasSize = UDim2.new(0, 0, 0, 0)
	scroll.Parent = surface
	local grid = Instance.new("UIGridLayout")
	grid.CellSize = UDim2.new(1 / 3, -6, 0, 34)
	grid.CellPadding = UDim2.fromOffset(6, 6)
	grid.SortOrder = Enum.SortOrder.LayoutOrder
	grid.Parent = scroll
	tiles = scroll
	panelSeat = seat
	refreshStatus()
	if lastMenu then
		HandUI.show(lastMenu :: string)
	end
	-- Main's redraw and this panel both follow the seat attributes, in no promised order: a
	-- redraw that ran first found no panel, so the castle line it carried is applied here.
	HandUI.showView(lastView)
end

-- In VR, keep the panel on the local player's own seat: built when they sit, rebuilt if the seat
-- changes. A player not seated has no panel (the chairs' signs say where to sit).
local function followSeat()
	if not vr then
		return
	end
	local seat = HandUI.mySeat()
	if seat ~= nil and seat ~= panelSeat then
		buildPanel(seat)
	end
end

-- The seat's own castle line, for the VR panel (flat play shows it above the castle instead).
function HandUI.showView(v: Protocol.View?)
	if v ~= nil then
		lastView = v
	end
	local seat = HandUI.mySeat()
	if not vr or v == nil or seat == nil or bandLabel == nil then
		return
	end
	local b = Protocol.boardOf(v)
	local s = b.seats[seat + 1]
	if s then
		(bandLabel :: TextLabel).Text = `seat {seat} (you): {Protocol.bandText(s, b.round)}`
	end
end

-- `inVR` is the local player's VRService.VREnabled. Flat: tiles along the bottom of the screen.
-- VR: tiles on the hand panel in front of the chair; the relay is the same Choose event either way.
function HandUI.create(inVR: boolean)
	vr = inVR
	remotes = ReplicatedStorage:WaitForChild("TapstoneRemotes") :: Folder
	if not vr then
		local gui = Instance.new("ScreenGui")
		gui.Name = "TapstoneHand"
		gui.ResetOnSpawn = false
		gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

		status = Instance.new("TextLabel")
		status.Name = "Status"
		status.Size = UDim2.new(1, 0, 0, 30)
		status.Position = UDim2.new(0, 0, 1, -116)
		status.BackgroundColor3 = PANEL
		status.BackgroundTransparency = 0.2
		status.TextColor3 = INK
		status.TextScaled = true
		status.Font = Enum.Font.GothamMedium
		status.Parent = gui

		local row = Instance.new("Frame")
		row.Name = "Tiles"
		row.Size = UDim2.new(1, 0, 0, 84)
		row.Position = UDim2.new(0, 0, 1, -86)
		row.BackgroundTransparency = 1
		row.Parent = gui
		local layout = Instance.new("UIListLayout")
		layout.FillDirection = Enum.FillDirection.Horizontal
		layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
		layout.Padding = UDim.new(0, 8)
		layout.SortOrder = Enum.SortOrder.LayoutOrder
		layout.Parent = row
		tiles = row
	else
		-- Until the player sits there is no panel: a label nobody sees keeps refreshStatus safe.
		status = Instance.new("TextLabel")
	end

	for _, name in { "Seat0Name", "Seat1Name", "Message" } do
		remotes:GetAttributeChangedSignal(name):Connect(function()
			followSeat()
			refreshStatus()
		end)
	end
	followSeat()
	refreshStatus()
	local menuEvent = remotes:WaitForChild("Menu") :: RemoteEvent
	menuEvent.OnClientEvent:Connect(HandUI.show)
end

return HandUI
