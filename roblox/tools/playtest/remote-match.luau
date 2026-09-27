--!strict
-- Runs once in the SERVER datamodel of a StudioMCP playtest (tools/playtest/drive.py). It seats the
-- Studio player in seat 1's chair, proves the relay's door refuses anyone unseated or with a bad
-- number, and switches on the automatic player (seat 1 through the relay, seat 0 directly, since a
-- solo playtest has one player). The driver then watches ServerStorage.TapstoneConfig.
--
-- It talks to the RUNNING server through ServerStorage.TapstoneTest (a BindableFunction Main
-- creates): a chunk run by execute_luau gets its own copy of every ModuleScript, so require()
-- here would see an empty TableServer (the first B6 run failed exactly that way, 2026-09-26).
-- Returns one line per check; a line starting "FAIL" fails the driver.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local config = ServerStorage:WaitForChild("TapstoneConfig")
local door = ServerStorage:WaitForChild("TapstoneTest") :: BindableFunction
local remotes = ReplicatedStorage:WaitForChild("TapstoneRemotes")

local out = {}
local function log(ok: boolean, what: string)
	table.insert(out, (if ok then "ok   " else "FAIL ") .. what)
end

local player = Players:GetPlayers()[1]
if player == nil then
	return "FAIL no player in the playtest"
end
local character = player.Character or player.CharacterAdded:Wait()
local humanoid = character:WaitForChild("Humanoid") :: Humanoid
local chair = workspace:WaitForChild("TapstoneTable"):WaitForChild("Chair1") :: Seat

chair:Sit(humanoid)
local deadline = os.clock() + 5
while door:Invoke("seatOf", player) ~= 1 and os.clock() < deadline do
	task.wait(0.1)
end
log(door:Invoke("seatOf", player) == 1, `sitting in Chair1 takes seat 1 ({player.Name})`)
log(remotes:GetAttribute("Seat1Name") == player.Name, "clients are told who holds seat 1")

local sent, why = door:Invoke("relay", nil, 0, 0)
log(not sent and why == "not a seated player", `an unseated caller is refused before HTTP ({why})`)
local sent2, why2 = door:Invoke("relay", player, 1.5, 0)
log(not sent2 and why2 == "bad menu number or index", `a fractional menu number is refused ({why2})`)

config:SetAttribute("AutoPlay", "first-useful")
log(true, `autoplay on; Propose = {tostring(config:GetAttribute("Propose"))}; seats joined: {tostring(config:GetAttribute("Seats"))}`)
return table.concat(out, "\n")
