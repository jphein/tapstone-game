--!strict
-- The place's real scripts, run under lune: a DataModel from @lune/roblox, each file of src/ as the
-- ModuleScript Rojo makes of it (default.project.json: shared → ReplicatedStorage.TapstoneShared,
-- server → ServerScriptService.Tapstone, client → StarterPlayerScripts.Tapstone), and `require`
-- resolved through those instances. So a test can call Stage.build() or TeaHouseStage.build() and
-- measure the parts they actually make, instead of a second description of them.
--
-- Lune's Instances have no WaitForChild; here it is FindFirstChild that fails loudly, since
-- nothing is ever loading in the background.
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local roblox = require("@lune/roblox")

roblox.implementMethod("Instance", "WaitForChild", function(self: any, name: string): any
	local child = self:FindFirstChild(name)
	if child == nil then
		error(`{self:GetFullName()} has no child {name}`, 2)
	end
	return child
end)

local Place = {}

-- Two places where lune 0.10.5 differs from Roblox, both found by a chair that faced away from
-- the table under lune (tests/teahouse.luau keeps a control for each):
-- 1. `CFrame.lookAt(at, target)` and `CFrame.new(at, target)` face AWAY from the target (lune's
--    `c * Vector3.new(0, 0, -1)` moves away from it). Scripts here get a CFrame whose lookAt is
--    Roblox's: LookVector toward the target, RightVector = LookVector × up.
-- 2. Writing a part's `Position` is stored but never moves its CFrame. `Place.settle` applies it.
local CFrame = roblox.CFrame
local function lookAt(at: any, target: any, up: any?): any
	local look = (target - at).Unit
	local right = look:Cross(up or roblox.Vector3.new(0, 1, 0)).Unit
	return CFrame.fromMatrix(at, right, right:Cross(look), -look)
end
Place.CFrame = setmetatable({
	lookAt = lookAt,
	new = function(...: any): any
		local a, b = ...
		if select("#", ...) == 2 and typeof(a) == "Vector3" and typeof(b) == "Vector3" then
			return lookAt(a, b)
		end
		return CFrame.new(...)
	end,
}, { __index = CFrame })

-- Moves every part whose script wrote `Position` to that position (see 2 above). A part with a
-- `Position` AND a CFrame moved elsewhere is ambiguous under lune, so it fails rather than guess.
function Place.settle(root: any)
	for _, d in root:GetDescendants() do
		if d:IsA("BasePart") then
			local ok, pos = pcall(function()
				return d.Position
			end)
			if ok and pos ~= d.CFrame.Position then
				if d.CFrame.Position.Magnitude > 1e-6 then
					error(`{d:GetFullName()}: both Position and CFrame were set; lune can't tell which came last`)
				end
				d.CFrame = CFrame.new(pos) * (d.CFrame - d.CFrame.Position)
			end
		end
	end
end

export type Place = { game: any, workspace: any, require: (path: string) -> any }

local DIRS = {
	{ dir = "src/shared", parent = { "ReplicatedStorage" }, folder = "TapstoneShared" },
	{ dir = "src/server", parent = { "ServerScriptService" }, folder = "Tapstone" },
	{ dir = "src/client", parent = { "StarterPlayer", "StarterPlayerScripts" }, folder = "Tapstone" },
}

local DATATYPES = {
	"Vector3", "Vector2", "CFrame", "Color3", "UDim", "UDim2", "Enum", "BrickColor", "NumberRange",
	"NumberSequence", "NumberSequenceKeypoint", "ColorSequence", "ColorSequenceKeypoint", "Instance",
}

-- A fresh DataModel with every script of src/ in it (run from roblox/).
function Place.new(): Place
	local game = roblox.Instance.new("DataModel")
	local workspace = game:GetService("Workspace")
	local files: { [string]: string } = {} -- instance full name → file
	local byPath: { [string]: any } = {} -- "server/Stage" → instance
	for _, spec in DIRS do
		local parent = game:GetService(spec.parent[1])
		for k = 2, #spec.parent do
			local child = parent:FindFirstChild(spec.parent[k])
			if child == nil then
				child = roblox.Instance.new(spec.parent[k])
				child.Parent = parent
			end
			parent = child
		end
		local folder = roblox.Instance.new("Folder")
		folder.Name = spec.folder
		folder.Parent = parent
		for _, file in fs.readDir(spec.dir) do
			local name = string.match(file, "^([%w_]+)%.luau$")
			if name then
				local m = roblox.Instance.new("ModuleScript")
				m.Name = name
				m.Parent = folder
				files[m:GetFullName()] = `{spec.dir}/{file}`
				byPath[`{string.match(spec.dir, "[^/]+$")}/{name}`] = m
			end
		end
	end

	local loaded: { [string]: any } = {}
	local function load(m: any): any
		local key = m:GetFullName()
		if loaded[key] ~= nil then
			return loaded[key]
		end
		local path = files[key]
		if path == nil then
			error(`require: {key} is not a module of src/`, 2)
		end
		local env: { [string]: any } = { game = game, workspace = workspace, script = m, require = load }
		for _, name in DATATYPES do
			env[name] = (roblox :: any)[name]
		end
		env.CFrame = Place.CFrame
		local result = luau.load(fs.readFile(path), { debugName = path, environment = env })()
		loaded[key] = result
		return result
	end

	return {
		game = game,
		workspace = workspace,
		require = function(path: string): any
			local m = byPath[path]
			if m == nil then
				error(`no module {path}`)
			end
			return load(m)
		end,
	}
end

-- Every BasePart under `root`, with its world-space corners (8 Vector3s).
function Place.parts(root: any): { { part: any, corners: { any } } }
	local out = {}
	local all = root:GetDescendants()
	if root:IsA("BasePart") then
		table.insert(all, root)
	end
	for _, d in all do
		if d:IsA("BasePart") then
			local h = d.Size / 2
			local corners = {}
			for _, sx in { -1, 1 } do
				for _, sy in { -1, 1 } do
					for _, sz in { -1, 1 } do
						table.insert(corners, d.CFrame * roblox.Vector3.new(sx * h.X, sy * h.Y, sz * h.Z))
					end
				end
			end
			table.insert(out, { part = d, corners = corners })
		end
	end
	return out
end

return Place
