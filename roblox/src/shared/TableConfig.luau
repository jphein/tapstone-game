--!strict
-- The table's arena URL and join codes, read from a fixed config URL (a secret gist the launcher
-- writes: tools/roblox-table.sh). This is how a PUBLISHED place (players on Sober) learns tonight's
-- tunnel and codes: its attributes are fixed at publish, and the quick-tunnel URL changes every
-- run. The content is {"url": "https://…", "codes": ["…"], "written": "<ISO 8601 UTC>"}.
-- Pure: the JSON decoder and the clock are passed in, so tests/run.luau runs it under lune.
--
-- The config URL itself lives only in ServerStorage (Main reads it there), which never replicates
-- to clients. This module holds no URL.

local TableConfig = {}

TableConfig.MAX_AGE = 12 * 3600 -- a config older than this is last night's: ignore it

export type Config = { url: string, codes: { string }, written: number }

-- Days from 1970-01-01 to a civil date (Howard Hinnant's algorithm), for UTC without os.time.
local function daysFromCivil(y: number, m: number, d: number): number
	y = if m <= 2 then y - 1 else y
	local era = (if y >= 0 then y else y - 399) // 400
	local yoe = y - era * 400
	local mp = (m + 9) % 12
	local doy = (153 * mp + 2) // 5 + d - 1
	local doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
	return era * 146097 + doe - 719468
end

-- Seconds since the epoch for "YYYY-MM-DDTHH:MM:SS[.fff]Z", or nil.
function TableConfig.isoSeconds(s: string): number?
	local y, mo, d, h, mi, se = string.match(s, "^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)[%.%d]*Z$")
	if not y then
		return nil
	end
	return daysFromCivil(tonumber(y) :: number, tonumber(mo) :: number, tonumber(d) :: number) * 86400
		+ (tonumber(h) :: number) * 3600
		+ (tonumber(mi) :: number) * 60
		+ (tonumber(se) :: number)
end

-- Reads a config body: either the gist API's answer (api.github.com/gists/<id>, whose `files`
-- holds the config as a string, under whatever name the file has) or the config JSON itself.
-- Returns the config, or nil and why. `decode` may raise; `now` is Unix seconds.
function TableConfig.read(body: string, decode: (string) -> any, now: number): (Config?, string)
	local ok, outer = pcall(decode, body)
	if not ok or type(outer) ~= "table" then
		return nil, "the config isn't JSON"
	end
	local inner: any = outer
	if type(outer.files) == "table" then
		inner = nil
		for _, file in outer.files do
			if type(file) == "table" and type(file.content) == "string" then
				local ok2, parsed = pcall(decode, file.content)
				if ok2 and type(parsed) == "table" then
					inner = parsed
					break
				end
			end
		end
		if inner == nil then
			return nil, "the gist holds no JSON file"
		end
	end
	if inner.url == nil and inner.codes == nil then
		return nil, "no table tonight (the config is empty)"
	end
	if type(inner.url) ~= "string" or string.sub(inner.url, 1, 8) ~= "https://" then
		return nil, "the config's url isn't https:// (Roblox sends HTTPS only)"
	end
	local codes = {}
	if type(inner.codes) == "table" then
		for i = 1, 2 do
			local c = inner.codes[i]
			if type(c) == "string" then
				local clean = string.upper((string.gsub(c, "^%s*(.-)%s*$", "%1")))
				if clean ~= "" then
					table.insert(codes, clean)
				end
			end
		end
	end
	if #codes == 0 then
		return nil, "the config has no join codes"
	end
	local written = if type(inner.written) == "string" then TableConfig.isoSeconds(inner.written) else nil
	if written == nil then
		return nil, "the config has no written time"
	end
	if now - written > TableConfig.MAX_AGE then
		return nil, `the config is older than 12 h (written {inner.written}): start the table again`
	end
	return { url = (string.gsub(inner.url, "/+$", "")), codes = codes, written = written }, "ok"
end

return TableConfig
