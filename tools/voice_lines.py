"""tools/voice_lines.py: render the headset's fixed voice lines (0033 "Speaking") with Azure Speech.

    python3 tools/voice_lines.py            render lines whose text (or voice) changed, write manifest
    python3 tools/voice_lines.py --dry-run  say what would be sent, send nothing
    python3 tools/voice_lines.py --check    verify the manifest against the source and the files

Source: game/voice/headset.toml. Output: rust/tapstone-web/www/xr/public/voice/<id>.<ext> and
manifest.json (id, text, sha256 of text, sha256 of audio, bytes, voice). A line is sent again only
when its text, voice or format changed, or its file no longer matches the manifest; every run prints
the characters it sent, which is what Azure bills.

The key and region come from ~/.config/speech-to-cli/config.json ("key", "tts_region"). The key is
read into the request header and nowhere else: never printed, logged or written.

This is the headset's clip set; the shrine's Piper pack (game/voice/clips.tsv) is separate.
"""
import argparse
import hashlib
import json
import sys
import tomllib
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / "game" / "voice" / "headset.toml"
OUT = REPO / "rust" / "tapstone-web" / "www" / "xr" / "public" / "voice"
CONFIG = Path.home() / ".config" / "speech-to-cli" / "config.json"
BUDGET_BYTES = 4_000_000  # the whole set, preloaded on the headset before "loaded"
MANIFEST = "manifest.json"


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def slug(name):
    return "-".join("".join(c if c.isalnum() else " " for c in name.lower()).split())


def _expand(t, repo):
    if "n" in t:
        return [{"id": t["id"].format(n=n), "text": t["text"].format(n=n)} for n in t["n"]]
    if "cards" in t:
        out = []
        for p in sorted((repo / t["cards"]).glob("*.toml")):
            card = tomllib.loads(p.read_text())
            if card["type"] != "castle":
                out.append({"id": t["id"].format(slug=slug(card["name"])), "text": t["text"].format(name=card["name"])})
        return out
    if "levels_from" in t:
        levels = []
        for row in (repo / t["levels_from"]).read_text().splitlines():
            f = row.split("\t")
            if len(f) >= 4 and f[2] == "level_up":
                levels.append(int(f[0].split(".")[-1]))  # key level_up.N
        return [{"id": t["id"].format(n=n), "text": t["text"].format(n=n)} for n in sorted(levels)]
    raise ValueError(f"template {t['id']!r} has nothing to expand")


def load_lines(source, repo=REPO):
    """(config, lines): the source's voice settings and its lines, templates expanded."""
    data = tomllib.loads(Path(source).read_text())
    config = {k: data[k] for k in ("voice", "format", "ext")}
    lines = [{"id": l["id"], "text": l["text"]} for l in data.get("line", [])]
    for t in data.get("template", []):
        lines.extend(_expand(t, repo))
    ids, texts = set(), set()
    for l in lines:
        if not l["id"] or not l["text"]:
            raise ValueError(f"empty id or text: {l}")
        if l["id"] in ids:
            raise ValueError(f"duplicate id {l['id']!r}")
        if l["text"] in texts:
            raise ValueError(f"duplicate text {l['text']!r}")
        ids.add(l["id"])
        texts.add(l["text"])
    return config, lines


def ssml(text, voice):
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">'
        f'<voice name="{escape(voice, {chr(34): "&quot;"})}">{escape(text)}</voice></speak>'
    )


class azure_synth:
    """synth(ssml, fmt) -> audio bytes, over Azure Speech's REST TTS endpoint."""

    def __init__(self, key, region, urlopen=urllib.request.urlopen):
        self._key = key
        self._urlopen = urlopen
        self.url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"

    def __repr__(self):
        return f"azure_synth({self.url})"

    def __call__(self, body, fmt):
        req = urllib.request.Request(self.url, data=body.encode(), method="POST", headers={
            "Ocp-Apim-Subscription-Key": self._key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": fmt,
            "User-Agent": "tapstone-voice-lines",
        })
        with self._urlopen(req, timeout=60) as r:
            return r.read()


def _read_manifest(out):
    p = Path(out) / MANIFEST
    return json.loads(p.read_text()) if p.exists() else {"lines": []}


def _intact(out, e):
    p = Path(out) / e["file"]
    return p.exists() and sha256(p.read_bytes()) == e["audio_sha256"]


def render(lines, config, out, synth, dry_run=False):
    """Render what changed into `out`; returns {rendered, skipped, removed, chars, bytes}."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    old = {e["id"]: e for e in _read_manifest(out)["lines"]}
    entries, stats = [], {"rendered": 0, "skipped": 0, "removed": 0, "chars": 0, "bytes": 0}
    for l in lines:
        tsha = sha256(l["text"].encode())
        file = f"{l['id']}.{config['ext']}"
        e = old.get(l["id"])
        if (e and e["text_sha256"] == tsha and e["voice"] == config["voice"] and e.get("format") == config["format"]
                and e["file"] == file and _intact(out, e)):
            entries.append(e)
            stats["skipped"] += 1
            stats["bytes"] += e["bytes"]
            continue
        stats["chars"] += len(l["text"])
        if dry_run:
            print(f"would render {l['id']}: {l['text']!r}")
            continue
        audio = synth(ssml(l["text"], config["voice"]), config["format"])
        if not audio:
            raise RuntimeError(f"empty audio for {l['id']}")
        (out / file).write_bytes(audio)
        entries.append({"id": l["id"], "text": l["text"], "text_sha256": tsha, "audio_sha256": sha256(audio),
                        "bytes": len(audio), "file": file, "voice": config["voice"], "format": config["format"]})
        stats["rendered"] += 1
        stats["bytes"] += len(audio)
        print(f"rendered {l['id']}: {len(l['text'])} chars -> {len(audio)} B")
    if dry_run:
        print(f"dry run: {stats['chars']} characters would be sent")
        return stats
    keep = {e["file"] for e in entries} | {MANIFEST}
    for p in sorted(out.iterdir()):
        if p.is_file() and p.name not in keep:
            p.unlink()
            stats["removed"] += 1
            print(f"removed {p.name}")
    manifest = {"voice": config["voice"], "format": config["format"], "lines": entries}
    (out / MANIFEST).write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    print(f"{stats['rendered']} rendered, {stats['skipped']} unchanged, {stats['removed']} removed; "
          f"{stats['chars']} characters sent; set is {stats['bytes']} B of {BUDGET_BYTES} B budget")
    return stats


def check(out, lines, config):
    """Problems with the manifest in `out` against the source lines; [] when it is exact."""
    out = Path(out)
    problems = []
    m = _read_manifest(out)
    have = {e["id"]: e for e in m["lines"]}
    want = {l["id"]: l for l in lines}
    for i in want.keys() - have.keys():
        problems.append(f"{i}: in the source, not rendered")
    for i in have.keys() - want.keys():
        problems.append(f"{i}: rendered, not in the source")
    for i in want.keys() & have.keys():
        e, l = have[i], want[i]
        if e["text"] != l["text"] or e["text_sha256"] != sha256(l["text"].encode()):
            problems.append(f"{i}: text changed since render")
        if e["voice"] != config["voice"] or e.get("format") != config["format"]:
            problems.append(f"{i}: rendered with another voice or format")
        p = out / e["file"]
        if not p.exists():
            problems.append(f"{i}: {e['file']} missing")
        elif sha256(p.read_bytes()) != e["audio_sha256"] or p.stat().st_size != e["bytes"]:
            problems.append(f"{i}: {e['file']} does not match the manifest")
    files = {e["file"] for e in m["lines"]} | {MANIFEST}
    for p in out.iterdir() if out.exists() else []:
        if p.name not in files:
            problems.append(f"{p.name}: stray file")
    if sum(e["bytes"] for e in m["lines"]) > BUDGET_BYTES:
        problems.append("set exceeds the budget")
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    config, lines = load_lines(SOURCE)
    if args.check:
        problems = check(OUT, lines, config)
        for p in problems:
            print(p)
        print(f"{len(lines)} lines, {len(problems)} problems")
        return 1 if problems else 0
    synth = None
    if not args.dry_run:
        c = json.loads(CONFIG.read_text())
        synth = azure_synth(c["key"], c["tts_region"])
    render(lines, config, OUT, synth, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
