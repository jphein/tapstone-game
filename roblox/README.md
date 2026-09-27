# Tapstone's Roblox place: remote seats at a real table

Roblox players take seats in a Tapstone match (decision 0038, spec
`docs/superpowers/specs/2026-09-26-roblox-remote-seat-design.md`, plan
`docs/superpowers/plans/2026-09-26-roblox-remote-seat-part-b.md`): one Roblox player against a real
shrine, or two Roblox players against each other (`tapstone-arena --desk --remote ember-neutral
--remote tide-neutral`). The arena decides everything; this place draws the arena's view and sends
each player's choice from their own seat's move menu.

Everything runs from this directory (`roblox/`). Tools come from `aftman.toml`.

```sh
aftman trust lune-org/lune && aftman install   # once: rojo, luau-lsp, lune
lune run tests/run.luau                         # the pure modules' tests, no Studio (exit 1 on a failure)
tools/typecheck.sh                              # every script, --!strict, against Roblox's API types
python3 tools/fake_arena_check.py               # the fake arena keeps the contract (exit 1 on a failure)
rojo build default.project.json -o build/Tapstone.rbxl   # the place file (HttpEnabled on); open it in Studio
rojo serve                                      # live sync into Studio through the Rojo plugin
```

**Settings** are attributes on `ServerStorage.TapstoneConfig`:
- `ArenaUrl`: the tunnel, e.g. `https://words-here.trycloudflare.com`.
- `JoinCodeA` and `JoinCodeB`: this match's join codes, one per remote seat, in any order (the
  arena prints `remote join code: …` for one slot, or `remote join code (slot k): …` for each of
  two, and the board shows them). Leave `JoinCodeB` empty for
  one remote seat.

Set them in Studio's Properties panel, or the command bar:
`game.ServerStorage.TapstoneConfig:SetAttribute("JoinCodeA", "K7Q2MX")`. The server writes its status
beside them: `Seats`, `ViewN`, `Phase`, `Seq`, `Winner`, `Proposals`, `LastError`. After a match,
set the next match's codes and the server joins again.

**Playing:** there is a gold chair at each end of the table, one per seat ("Sit here: seat 0" /
"seat 1"). The first player to sit in a chair plays that seat; their moves appear as tiles along the
bottom of the screen. Your own units stand tall with full stats; the other side's are low stone with
a short tag (0027: mine are objects, theirs are entries). Anyone not seated watches.

**The Tea House (0039):** players spawn in the Tea House, a lantern-lit hall with tea, cushions and
seven doors, and a safe zone. The **red door** leads to the Dueling Grounds, the table room above,
unchanged: walk into it, trigger its prompt, or click it (the VR laser pointer), and the screen
fades while you move. A red gate beside the table brings you back. The other six doors (the
Hearthlands, the Deep Tides, the Forge Peaks, the Wandering Courts, the Star Fields, the Dreaming)
are scenery. Tide's door (the Deep Tides) and Ember's (the Forge Peaks) glow when their faction
casts and breathe their weather when it wins: a PROPOSAL for JP, not canon
(`src/shared/TeaHouseLayout.luau`).

**A published place (players on Sober)** can't be written at runtime, and the tunnel URL changes
every run, so the place reads tonight's table from `ConfigUrl`: a secret gist that
`tools/roblox-table.sh` writes (`https://api.github.com/gists/<id>`),
set in `default.project.json` (`$attributes`, in ServerStorage, never replicated to clients).
The server fetches it at start and when the arena looks unreachable, at most once a minute, and
ignores `{}` (table stopped) or a config older than 12 h. **This repo ships `ConfigUrl` empty (unset). Set your own
gist before publishing: `python3 tools/set-config.py --config-url https://api.github.com/gists/<id>`.**

**Without the arena:** `python3 tools/fake_arena.py` serves the four `/remote/*` routes for two
seats on `127.0.0.1:7791` and replays a real recorded match, one view per proposed move. Point
`ArenaUrl` at a tunnel to it for Studio work before the real arena is running.

**Headless playtest** (Studio open on the place with StudioMCP enabled; an arena, or the fake, behind
a tunnel): `python3 tools/playtest/drive.py match --url <tunnel> --codes <A> <B>`, and the control,
`python3 tools/playtest/drive.py stall --url <tunnel> --codes <A> <B>` on a fresh match.

Layout:
- `src/shared`: pure, tested under lune. `Protocol` reads views and menus; `ArenaApi` speaks the
  remote API with retries; `TeaHouseLayout` is the Tea House and Dueling Grounds' geometry and
  light; `DoorSigns` reads casts and wins from the views.
- `src/server`: `Main`, `ArenaClient`, `TableServer`, `Stage`; `TeaHouse` (a Script of its own:
  travel triggers, the safe zone) and `TeaHouseStage` (builds both places).
- `src/client`: `Main`, `BoardView`, `HandUI`; `TeaHouse` (a LocalScript: the fade, each place's
  light, the doors stirring).
- `tests`: `run.luau`; `teahouse.luau` builds the real place under lune (`place.luau`) and measures
  it.
