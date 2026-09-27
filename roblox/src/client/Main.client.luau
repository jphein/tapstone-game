--!strict
-- Client bootstrap: draw the board, show the hand, and redraw on every view the server forwards,
-- and whenever the seating changes (a unit's style depends on whose seat the viewer holds).
-- The client holds nothing but pictures: the arena decides, the server relays.
--
-- VR: VRService.VREnabled (readable only from a LocalScript) switches the hand to a panel on the
-- table and the billboards to stud sizes. There is deliberately no camera script: Roblox's
-- default VR cameras honour each player's comfort settings (vignette, stepped rotation, fixed
-- third-person), and a custom camera "opts your game out of future script updates" (Roblox VR
-- guidelines, creator-docs@0b817b5). Seated, the player looks at the board from their chair and
-- nothing moves the camera for them.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local VRService = game:GetService("VRService")

local BoardView = require(script.Parent.BoardView)
local HandUI = require(script.Parent.HandUI)

local remotes = ReplicatedStorage:WaitForChild("TapstoneRemotes") :: Folder
local viewEvent = remotes:WaitForChild("View") :: RemoteEvent
local getView = remotes:WaitForChild("GetView") :: RemoteFunction

local inVR = VRService.VREnabled
BoardView.create(inVR)
HandUI.create(inVR)
local last = ""
local function redraw()
	local v = BoardView.renderBody(last, HandUI.mySeat())
	HandUI.showView(v)
end
viewEvent.OnClientEvent:Connect(function(body: string)
	last = body
	redraw()
end)
for _, name in { "Seat0Name", "Seat1Name" } do
	remotes:GetAttributeChangedSignal(name):Connect(redraw)
end
-- A client that joins mid-match draws the current board straight away.
last = getView:InvokeServer()
redraw()
print(`[Tapstone] board ready{if inVR then " (VR)" else ""}`)
