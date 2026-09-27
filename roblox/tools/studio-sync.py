#!/usr/bin/env python3
"""Push this repo's scripts into the place open in Studio, through StudioMCP (no Rojo plugin, no
clicks): each file's text becomes its Script's Source in the Edit datamodel, at the path
default.project.json gives it. A missing instance is created with the right class.

    python3 tools/studio-sync.py          # every script under src/
Exit 0 synced, 1 a script failed, 2 no Studio with a place open.
"""
import os, pathlib, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from studio_mcp import NoStudio, Studio  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
TREES = [  # (folder, instance path of its container) — as default.project.json maps them
    ("src/server", 'game:GetService("ServerScriptService"):WaitForChild("Tapstone")'),
    ("src/client", 'game:GetService("StarterPlayer"):WaitForChild("StarterPlayerScripts"):WaitForChild("Tapstone")'),
    ("src/shared", 'game:GetService("ReplicatedStorage"):WaitForChild("TapstoneShared")'),
]


def long_string(text):
    level = 0
    while f"]{'=' * level}]" in text:
        level += 1
    eq = "=" * level
    return f"[{eq}[\n{text}]{eq}]"


def chunk(container, name, cls, source):
    return f'''local parent = {container}
local s = parent:FindFirstChild("{name}")
if s and s.ClassName ~= "{cls}" then s:Destroy() s = nil end
if not s then s = Instance.new("{cls}") s.Name = "{name}" s.Parent = parent end
s.Source = {long_string(source)}
return "synced " .. s:GetFullName()'''


try:
    studio = Studio()
except NoStudio as e:
    print(f"SETUP: {e}")
    sys.exit(2)
if not studio.attach():
    print("SETUP: no Studio with a place open")
    studio.close()
    sys.exit(2)
bad = 0
for folder, container in TREES:
    for f in sorted((ROOT / folder).glob("*.luau")):
        stem = f.name[: -len(".luau")]
        cls = "Script" if stem.endswith(".server") else "LocalScript" if stem.endswith(".client") else "ModuleScript"
        name = stem.split(".")[0]
        ok, text = studio.luau(chunk(container, name, cls, f.read_text()), "Edit")
        print(("ok   " if ok else "FAIL ") + (text.strip() or f.name))
        bad += 0 if ok else 1
studio.close()
sys.exit(1 if bad else 0)
