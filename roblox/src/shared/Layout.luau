--!strict
-- The table's geometry, in studs, from the table top's centre: the one source Stage (the chairs),
-- BoardView (cells, castles, banner) and the VR hand panel draw from, so tests/run.luau can check
-- the VR field of view against the numbers the client actually uses. Pure: plain tables, no
-- Vector3, so it runs under lune.
--
-- The board runs along Z. Seat 1's chair is at +Z facing -Z, seat 0's at -Z facing +Z; lane 1
-- is at -X. Seat 1's track starts at the +Z end (BoardView's WORLD_NEAR).

local Layout = {}

export type Point = { x: number, y: number, z: number }

Layout.CELL = 4.4 -- between cell centres, across and along a lane
Layout.GAP = 1.2 -- the gutter at the front line
Layout.TOP_Y = 3.5 -- the table top part's centre
Layout.TOP_THICK = 1
Layout.SURFACE_Y = Layout.TOP_Y + Layout.TOP_THICK / 2 -- 4.0: what cells stand on
Layout.CHAIR_Z = 21
Layout.CHAIR_Y = 1.5
-- Where a seated player's eyes are: an R15 character's Head in Stage's chair (seat top at 2.0),
-- measured at y 5.16 in the Studio playtest (2026-09-27; it was estimated at 4.8 before). It
-- drives the VR view and sight-line tests; a real headset adds the player's own posture (B7).
Layout.HEAD_Y = 5.2
Layout.CASTLE_DEPTH = 2.4
Layout.CASTLE_HEIGHT = 2.4
Layout.CASTLE_LABEL_ABOVE = 2.6 -- the castle band billboard, above the castle part's centre
Layout.BANNER_ABOVE = 7.2 -- the banner, above the table surface
Layout.BANNER_BEYOND = 2 -- past the far castle

-- A cell's centre on the table surface. col 0..2 = lanes 1..3, row 0..5 from the +Z end.
function Layout.cellCenter(col: number, row: number): Point
	local z = (2.5 - row) * Layout.CELL + (if row >= 3 then -Layout.GAP / 2 else Layout.GAP / 2)
	return { x = (col - 1) * Layout.CELL, y = Layout.SURFACE_Y, z = z }
end

-- +1 when seat's end of the table is +Z (seat 1), -1 for seat 0.
local function endSign(seat: number): number
	return if seat == 1 then 1 else -1
end

-- The direction a seated player faces along Z: toward the other end.
function Layout.forwardZ(seat: number): number
	return -endSign(seat)
end

function Layout.chair(seat: number): Point
	return { x = 0, y = Layout.CHAIR_Y, z = endSign(seat) * Layout.CHAIR_Z }
end

function Layout.head(seat: number): Point
	return { x = 0, y = Layout.HEAD_Y, z = endSign(seat) * Layout.CHAIR_Z }
end

-- The centre of a seat's castle block, just past its back row.
function Layout.castleCenter(seat: number): Point
	local backRow = Layout.cellCenter(1, if seat == 1 then 0 else 5).z
	return { x = 0, y = Layout.SURFACE_Y + Layout.CASTLE_HEIGHT / 2, z = backRow + endSign(seat) * Layout.CELL }
end

function Layout.castleLabel(seat: number): Point
	local c = Layout.castleCenter(seat)
	return { x = 0, y = c.y + Layout.CASTLE_LABEL_ABOVE, z = c.z }
end

-- The banner hangs past the castle at the far end from the viewer, so it's ahead of them.
function Layout.banner(viewerSeat: number): Point
	local far = Layout.castleCenter(1 - viewerSeat)
	return { x = 0, y = Layout.SURFACE_Y + Layout.BANNER_ABOVE, z = far.z - endSign(viewerSeat) * Layout.BANNER_BEYOND }
end

-- The VR hand panel: a small lectern between the chair and the table's end (the top runs to
-- z ±17, Stage.TOP_SIZE), low enough that its top edge stays under the sight line from the head
-- to the nearest cells, close enough to point at, and inside the ±35° view. At eye height (y 5.0,
-- as first built) it hid the board: tests/run.luau checks the sight lines.
Layout.PANEL_TOP_Y = 4.7
export type Panel = { center: Point, width: number, height: number }
function Layout.panel(seat: number): Panel
	local chair = Layout.chair(seat)
	local height = 1.5
	return {
		center = { x = 0, y = Layout.PANEL_TOP_Y - height / 2, z = chair.z + Layout.forwardZ(seat) * 3.4 },
		width = 3.8,
		height = height,
	}
end

-- The castle's width across the table (BoardView draws it 12 wide).
Layout.CASTLE_WIDTH = 12
-- In VR the viewer's own castle is drawn this tall instead (see castleHeight).
Layout.VR_OWN_CASTLE_HEIGHT = 0.4

-- How tall `seat`'s castle is drawn for a viewer in `viewerSeat` (nil: not seated). In VR the
-- viewer's own castle is a low plinth: at full height it stands between a seated head and the
-- board and hides it (seen in the Studio playtest, 2026-09-27). Everyone else sees it full size.
function Layout.castleHeight(seat: number, viewerSeat: number?, inVR: boolean): number
	return if inVR and seat == viewerSeat then Layout.VR_OWN_CASTLE_HEIGHT else Layout.CASTLE_HEIGHT
end

-- An axis-aligned box: its centre and full size.
export type Box = { center: Point, size: Point }

-- The castle block of `seat`, drawn `height` tall on the table surface.
function Layout.castleBox(seat: number, height: number): Box
	local c = Layout.castleCenter(seat)
	return {
		center = { x = c.x, y = Layout.SURFACE_Y + height / 2, z = c.z },
		size = { x = Layout.CASTLE_WIDTH, y = height, z = Layout.CASTLE_DEPTH },
	}
end

-- The hand panel as a box, for sight-line checks. It's drawn 0.1 thick and turned to face the
-- head, so it tilts; ±0.3 in depth covers that tilt.
function Layout.panelBox(seat: number): Box
	local p = Layout.panel(seat)
	return { center = p.center, size = { x = p.width, y = p.height, z = 0.6 } }
end

-- Whether the straight segment from `a` to `b` passes through `box` (the slab method).
function Layout.blocks(a: Point, b: Point, box: Box): boolean
	local lo, hi = 0, 1
	for _, k in { "x", "y", "z" } do
		local p0 = (a :: any)[k] :: number
		local d = ((b :: any)[k] :: number) - p0
		local mn = ((box.center :: any)[k] :: number) - ((box.size :: any)[k] :: number) / 2
		local mx = mn + ((box.size :: any)[k] :: number)
		if math.abs(d) < 1e-9 then
			if p0 < mn or p0 > mx then
				return false
			end
		else
			local t1, t2 = (mn - p0) / d, (mx - p0) / d
			if t1 > t2 then
				t1, t2 = t2, t1
			end
			lo, hi = math.max(lo, t1), math.min(hi, t2)
			if lo > hi then
				return false
			end
		end
	end
	return true
end

-- A point's yaw and pitch, in degrees, from a seated player's eyes, relative to their forward
-- view along the table (level). A point behind them reports a yaw of 180.
function Layout.angles(p: Point, seat: number): (number, number)
	local head = Layout.head(seat)
	local ahead = (p.z - head.z) * Layout.forwardZ(seat)
	local side = p.x - head.x
	local up = p.y - head.y
	if ahead <= 0 then
		return 180, 0
	end
	local yaw = math.deg(math.atan2(side, ahead))
	local pitch = math.deg(math.atan2(up, math.sqrt(side * side + ahead * ahead)))
	return math.round(yaw * 10) / 10, math.round(pitch * 10) / 10
end

return Layout
