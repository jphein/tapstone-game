--!strict
-- Who plays each seat, and the only door a click comes through.
--
-- Each seat has a chair (Stage). The first player to sit in seat s's chair plays seat s for the
-- rest of the server's life, or until they leave the game; standing up doesn't give it away, and a
-- player holds at most one seat. A click (`Choose`) is relayed for the clicker's own seat only:
-- the seat comes from who clicked, never from the client, so no one can move for the other side.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Protocol = require(ReplicatedStorage:WaitForChild("TapstoneShared"):WaitForChild("Protocol"))

export type Proposer = (seat: number, n: number, i: number) -> string

local TableServer = {}

local players: { [number]: Player } = {}
local proposer: Proposer? = nil
local onSeated: ((Player, number) -> ())? = nil
local remotes: Folder? = nil

-- The seat `p` holds, or nil.
function TableServer.seatOf(p: Player?): number?
	for seat, q in players do
		if q == p then
			return seat
		end
	end
	return nil
end

function TableServer.playerAt(seat: number): Player?
	return players[seat]
end

local function setPlayer(seat: number, p: Player?)
	if p then
		players[seat] = p
	else
		players[seat] = nil
	end
	if remotes then
		remotes:SetAttribute(`Seat{seat}Name`, if p then p.Name else "")
	end
	if p and onSeated then
		onSeated(p, seat)
	end
end

-- `chairs` are Stage's, by seat; `folder` is TapstoneRemotes (its Choose event is wired here);
-- `propose` sends a seat's menu choice to the arena; `seatedHook` runs when a player takes a seat.
function TableServer.init(chairs: { [number]: Seat }, folder: Folder, propose: Proposer, seatedHook: (Player, number) -> ())
	remotes = folder
	proposer = propose
	onSeated = seatedHook
	for seat, chair in chairs do
		folder:SetAttribute(`Seat{seat}Name`, "")
		chair:GetPropertyChangedSignal("Occupant"):Connect(function()
			local hum = chair.Occupant
			if hum == nil or TableServer.playerAt(seat) then
				return
			end
			local p = Players:GetPlayerFromCharacter(hum.Parent)
			if p and TableServer.seatOf(p) == nil then
				setPlayer(seat, p)
			end
		end)
	end

	Players.PlayerRemoving:Connect(function(p)
		local seat = TableServer.seatOf(p)
		if seat ~= nil then
			setPlayer(seat, nil)
		end
	end)

	local choose = folder:WaitForChild("Choose") :: RemoteEvent
	choose.OnServerEvent:Connect(function(p: Player, n: any, i: any)
		TableServer.relay(p, n, i)
	end)
end

-- A click, from anyone: sent for the clicker's own seat, and only if both numbers are whole and
-- non-negative. Returns (sent?, why). Values arrive from a client, so they are checked, not trusted.
function TableServer.relay(p: Player?, n: any, i: any): (boolean, string)
	local seat = TableServer.seatOf(p)
	if p == nil or seat == nil then
		return false, "not a seated player"
	end
	if not Protocol.isIndex(n) or not Protocol.isIndex(i) then
		return false, "bad menu number or index"
	end
	if proposer == nil then
		return false, "no arena"
	end
	local r = proposer(seat, n, i)
	return r == "sent", r
end

return TableServer
