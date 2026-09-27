"""StudioMCP from Python: connect to Roblox Studio and run Luau in a datamodel.

The JSON-RPC plumbing follows ~/Projects/roblox/tools/playtest/mcp_drive.py (StudioMCP through
~/.local/bin/roblox-studio-mcp). Studio must be open with "Enable Studio as MCP server" on, and
nothing else holding port 13469.
"""
import json, os, subprocess, threading, time

WRAPPER = os.path.expanduser("~/.local/bin/roblox-studio-mcp")


class NoStudio(Exception):
    """StudioMCP didn't answer: Studio isn't running, or MCP isn't enabled in it."""


class Studio:
    def __init__(self):
        self.proc = subprocess.Popen([WRAPPER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, bufsize=0)
        self.pending, self.lock, self.nid = {}, threading.Lock(), [0]
        threading.Thread(target=self._reader, daemon=True).start()
        try:
            self.rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                                    "clientInfo": {"name": "tapstone", "version": "1"}}, 10)
        except TimeoutError:
            # The wrapper exits at once when Studio isn't running (roblox-studio-mcp checks).
            self.proc.terminate()
            raise NoStudio("StudioMCP didn't answer: is Studio open with the MCP server enabled?")
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

    def _reader(self):
        for raw in self.proc.stdout:
            try:
                msg = json.loads(raw.decode(errors="replace").strip())
            except Exception:
                continue
            if msg.get("id") in self.pending:
                self.pending[msg["id"]]["res"] = msg
                self.pending[msg["id"]]["ev"].set()

    def _send(self, obj):
        self.proc.stdin.write((json.dumps(obj) + "\n").encode())
        self.proc.stdin.flush()

    def rpc(self, method, params=None, timeout=30):
        with self.lock:
            self.nid[0] += 1
            mid = self.nid[0]
        ev = threading.Event()
        self.pending[mid] = {"ev": ev, "res": None}
        self._send({"jsonrpc": "2.0", "id": mid, "method": method, "params": params or {}})
        if not ev.wait(timeout):
            self.pending.pop(mid, None)
            raise TimeoutError(method)
        msg = self.pending.pop(mid)["res"]
        if "error" in msg:
            raise RuntimeError(msg["error"])
        return msg.get("result", {})

    def call(self, name, arguments=None, timeout=60):
        # StudioMCP (Studio 740, 2026-09-26) wants `studio_id` on every tool call except the listing;
        # set_active_studio is gone. attach() records the id; it's added here.
        args = dict(arguments or {})
        if name != "list_roblox_studios" and getattr(self, "sid", None) and "studio_id" not in args:
            args["studio_id"] = self.sid
        res = self.rpc("tools/call", {"name": name, "arguments": args}, timeout)
        text = "\n".join(c.get("text", "") for c in res.get("content", []) if c.get("type") == "text")
        return res.get("isError", False), text

    def attach(self, wait=90):
        """Wait for a Studio with a place OPEN to register (it lags the transport by a few seconds;
        Studio at its start page lists nothing), and remember its id. True when one did."""
        deadline = time.time() + wait
        studios = []
        while time.time() < deadline and not studios:
            try:
                studios = json.loads(self.call("list_roblox_studios", {}, 10)[1]).get("studios", [])
            except Exception:
                pass
            if not studios:
                time.sleep(1.5)
        if not studios:
            return False
        self.sid = next((s for s in studios if s.get("active")), studios[0]).get("id")
        return True

    def luau(self, code, dm, timeout=60):
        """Run Luau in a datamodel ("Edit", "Server" or "Client"); returns (ok, text)."""
        is_err, text = self.call("execute_luau", {"code": code, "datamodel_type": dm}, timeout)
        return (not is_err), text

    def close(self):
        self.proc.terminate()


def set_config_luau(settings):
    """Luau that sets attributes on ServerStorage.TapstoneConfig and returns "set"."""
    lines = "\n".join(f'c:SetAttribute("{k}", {json.dumps(v)})' for k, v in settings.items())
    return f'local c = game:GetService("ServerStorage").TapstoneConfig\n{lines}\nreturn "set"'
