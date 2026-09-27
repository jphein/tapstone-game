--!strict
-- ArenaApi with Roblox's transport plugged in. The server is the only HTTP client: HttpService
-- sends requests "from experience servers" (HttpService.yaml), and the token must never reach a
-- player, so this module lives in ServerScriptService and nothing replicates the client object.

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ArenaApi = require(ReplicatedStorage:WaitForChild("TapstoneShared"):WaitForChild("ArenaApi"))

export type Client = ArenaApi.Client

local deps: ArenaApi.Deps = {
	request = function(req: ArenaApi.Request): ArenaApi.Response
		local res = HttpService:RequestAsync(req :: any)
		return { StatusCode = res.StatusCode, StatusMessage = res.StatusMessage, Body = res.Body }
	end,
	sleep = function(sec: number)
		task.wait(sec)
	end,
	encode = function(v: any): string
		return HttpService:JSONEncode(v)
	end,
	decode = function(s: string): any
		return HttpService:JSONDecode(s)
	end,
}

local ArenaClient = {}

function ArenaClient.new(url: string): Client
	return ArenaApi.new(url, deps)
end

ArenaClient.join = ArenaApi.join
ArenaClient.pollView = ArenaApi.pollView
ArenaClient.choices = ArenaApi.choices
ArenaClient.propose = ArenaApi.propose

return ArenaClient
