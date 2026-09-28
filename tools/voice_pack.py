"""tools/voice_pack.py: render the shrine's fixed voice lines (0033 "Speaking") into an SD data pack with Piper.

    python3 tools/voice_pack.py            render clips whose text (or voice) changed, write the manifest
    python3 tools/voice_pack.py --dry-run  say what would be rendered, render nothing
    python3 tools/voice_pack.py --check    verify the pack against the source, its files and the budget

Source: game/voice/clips.tsv, rows of kind `clip` only (`streamed` lines are the arena's, `silent`
has no audio). Output: scratch/voice-pack/SET1/ by default, copied to the SD card as
/TAPSTONE/VOICE/SET1/. The rendered audio stays out of git, like the Veo clips.

Piper runs locally (no network, no cloud): /opt/wyoming-piper on familiar, the same install the
Wyoming service uses. A clip is rendered again only when its text or the voice changed, or its file
no longer matches the manifest.

# The pack, and why it looks like this

- **IMA-ADPCM, 4-bit mono, 22,050 Hz WAV** (format tag 0x11, 256-byte blocks of 505 samples). The
  rate is the floor, not a choice: the codec's BCLK-derived mode refuses anything slower (BOARD.md
  landmine L5), so 16 kHz would need resampling on the chip, and Piper's medium and high voices are
  22,050 Hz natively, so nothing is resampled anywhere. 4-bit ADPCM is 11.2 KB/s against 22 KB/s for
  8-bit PCM and 44 KB/s for 16-bit; it is also the format 0033 names for *streamed* speech (~88
  kbit/s), so the shrine carries one decoder for both. Decoding is a table lookup, a multiply,
  a shift and a clamp per sample, which at 22,050 Hz is well under 1% of one S3 core, and
  every block restarts from its own header, so a clip can be read from the card one 256-byte block
  at a time with no state beyond the block.
- **8.3 file names** (`1A2B3C4D.WAV`, the first 32 bits of the id's sha256): FatFS works without
  long-name support, and a name that depends only on the id stays put when clips are added. A
  collision is an error at build time, never a silent overwrite.
- **MANIFEST.TSV**, not JSON: one clip per line, tab-separated, sorted by id, so a `no_std` reader
  (`shrine_render::pack`) can find a clip with a line scan and no allocator. Columns: id, file,
  bytes, sha256 (of the file), text_sha256, text. Lines starting `#` carry the pack's version,
  voice and format.

The size budget is derived, not typed: the pack's own texts read at SLOW_CPS characters a second,
in this format, with HEADROOM to spare (docs/verification.md: a budget asserts headroom).
"""
import argparse
import hashlib
import json
import math
import struct
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / "game" / "voice" / "clips.tsv"
OUT = REPO / "scratch" / "voice-pack" / "SET1"
PIPER = Path("/opt/wyoming-piper/venv/bin/piper")
MODEL = Path("/opt/wyoming-piper/data/en_US-ryan-high.onnx")
MANIFEST = "MANIFEST.TSV"
VERSION = "# tapstone voice pack v1"
COLUMNS = "id\tfile\tbytes\tsha256\ttext_sha256\ttext"

RATE = 22_050  # BOARD.md L5: the codec's floor
BLOCK = 256
SAMPLES_PER_BLOCK = (BLOCK - 4) * 2 + 1  # a 4-byte header holding one sample, then two per byte
BYTE_RATE = RATE * BLOCK // SAMPLES_PER_BLOCK
HEADER_BYTES = 12 + (8 + 20) + (8 + 4) + 8  # RIFF/WAVE, fmt (IMA), fact, data
FORMAT = f"ima-adpcm\t{RATE}\t{BLOCK}"
SLOW_CPS = 10  # a deliberately slow reading; Piper's voices here speak ~17 characters a second
HEADROOM = 0.25

STEPS = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
    80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
    544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499,
    2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
    12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
]
INDEX = [-1, -1, -1, -1, 2, 4, 6, 8]


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def file_name(clip_id):
    return sha256(clip_id.encode())[:8].upper() + ".WAV"


def load_clips(source):
    """The table's fixed clips, as [{id, text}] in table order; malformed rows are errors."""
    rows = [r for r in Path(source).read_text().splitlines() if r and not r.startswith("#")]
    if not rows or rows[0].split("\t") != ["key", "kind", "variant", "text"]:
        raise ValueError(f"{source}: missing the key/kind/variant/text header")
    clips, ids, names = [], set(), {}
    for r in rows[1:]:
        f = r.split("\t")
        if len(f) < 3 or len(f) > 4:
            raise ValueError(f"malformed row (a tab in the text?): {r!r}")
        if f[1] != "clip":
            continue
        if len(f) != 4 or not f[0] or not f[3].strip():
            raise ValueError(f"clip without id or text: {r!r}")
        if f[0] in ids:
            raise ValueError(f"duplicate id {f[0]!r}")
        n = file_name(f[0])
        if n in names:
            raise ValueError(f"file name {n} collides: {names[n]!r} and {f[0]!r}")
        ids.add(f[0])
        names[n] = f[0]
        clips.append({"id": f[0], "text": f[3]})
    return clips


def _delta(nib, idx):
    """The step a nibble moves the predictor by: ((2m + 1) * step) >> 3, m the nibble's magnitude.

    This is the exact form (ffmpeg's `adpcm_ima_wav` decoder), not the reference's three
    conditional shift-and-adds, which truncate each term separately and land up to a few LSB lower.
    One multiply and a shift per sample on the S3, and an independent decoder to test against."""
    return ((2 * (nib & 7) + 1) * STEPS[idx]) >> 3


def _next(nib, pred, idx):
    d = _delta(nib, idx)
    pred = pred - d if nib & 8 else pred + d
    return max(-32768, min(32767, pred)), max(0, min(88, idx + INDEX[nib & 7]))


def _step(sample, pred, idx):
    """One encoder step: (nibble, new predictor, new index), tracking the decoder's arithmetic exactly."""
    diff = sample - pred
    nib = min(7, (abs(diff) * 4) // STEPS[idx]) | (8 if diff < 0 else 0)
    return (nib, *_next(nib, pred, idx))


def encode_wav(pcm16):
    """16-bit little-endian mono PCM at RATE -> an IMA-ADPCM WAV; the last block is padded with silence."""
    n = len(pcm16) // 2
    samples = list(struct.unpack(f"<{n}h", pcm16[: n * 2]))
    blocks = math.ceil(n / SAMPLES_PER_BLOCK)
    samples += [0] * (blocks * SAMPLES_PER_BLOCK - n)
    data, idx = bytearray(), 0
    for b in range(blocks):
        chunk = samples[b * SAMPLES_PER_BLOCK:(b + 1) * SAMPLES_PER_BLOCK]
        pred = chunk[0]
        data += struct.pack("<hBB", pred, idx, 0)
        nibs = []
        for s in chunk[1:]:
            nib, pred, idx = _step(s, pred, idx)
            nibs.append(nib)
        data += bytes(nibs[i] | (nibs[i + 1] << 4) for i in range(0, len(nibs), 2))
    fmt = struct.pack("<HHIIHHHH", 0x11, 1, RATE, BYTE_RATE, BLOCK, 4, 2, SAMPLES_PER_BLOCK)
    body = (b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"fact" + struct.pack("<II", 4, n)
            + b"data" + struct.pack("<I", len(data)) + bytes(data))
    return b"RIFF" + struct.pack("<I", len(body)) + body


def wav_info(wav):
    """The pack's WAV header, parsed and checked against the file's length; ValueError if it is not one."""
    if len(wav) < HEADER_BYTES or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE" or wav[12:16] != b"fmt ":
        raise ValueError("not a RIFF/WAVE file")
    riff, = struct.unpack_from("<I", wav, 4)
    tag, ch, rate, _, align, bits, cb, spb = struct.unpack_from("<HHIIHHHH", wav, 20)
    if wav[40:44] != b"fact" or wav[52:56] != b"data":
        raise ValueError("chunks are not fmt, fact, data")
    samples, = struct.unpack_from("<I", wav, 48)
    size, = struct.unpack_from("<I", wav, 56)
    if riff != len(wav) - 8 or size != len(wav) - HEADER_BYTES or size % BLOCK or cb != 2:
        raise ValueError("truncated or padded")
    if samples > size // BLOCK * spb:
        raise ValueError("more samples than blocks")
    return {"format_tag": tag, "channels": ch, "rate": rate, "bits": bits, "block_align": align,
            "samples_per_block": spb, "samples": samples}


def decode_wav(wav):
    """The reference decoder: an IMA-ADPCM WAV -> its samples. What the shrine does, block by block."""
    info = wav_info(wav)
    data = wav[HEADER_BYTES:]
    out = []
    for b in range(0, len(data), BLOCK):
        pred, idx, _ = struct.unpack_from("<hBB", data, b)
        out.append(pred)
        for byte in data[b + 4:b + BLOCK]:
            for nib in (byte & 15, byte >> 4):
                pred, idx = _next(nib, pred, idx)
                out.append(pred)
    return out[: info["samples"]]


class piper_synth:
    """synth(text) -> 16-bit mono PCM at RATE, from the local Piper CLI. Refuses a voice at another rate."""

    def __init__(self, model=MODEL, piper=PIPER, run=subprocess.run):
        self.model, self.piper, self._run = Path(model), Path(piper), run
        self.voice = self.model.stem
        self.rate = json.loads(Path(f"{model}.json").read_text())["audio"]["sample_rate"]
        if self.rate != RATE:
            raise ValueError(f"{self.voice} speaks at {self.rate} Hz; the pack is {RATE} Hz and never resamples")

    def __call__(self, text):
        r = self._run([str(self.piper), "-m", str(self.model), "--output-raw"], input=text.encode(),
                      capture_output=True, check=True)
        return r.stdout


def read_manifest(out):
    """{voice, format, clips: [{id, file, bytes, sha256, text_sha256, text}]}; empty if there is none."""
    p = Path(out) / MANIFEST
    m = {"voice": None, "format": None, "clips": []}
    if not p.exists():
        return m
    lines = p.read_text().splitlines()
    if not lines or lines[0] != VERSION:
        raise ValueError(f"{p}: not a v1 pack manifest")
    rows = [l for l in lines if not l.startswith("#")]
    for l in lines:
        if l.startswith("# voice\t"):
            m["voice"] = l.split("\t", 1)[1]
        elif l.startswith("# format\t"):
            m["format"] = l.split("\t", 1)[1]
    if not rows or rows[0] != COLUMNS:
        raise ValueError(f"{p}: missing the column header")
    for r in rows[1:]:
        i, file, n, s, ts, text = r.split("\t")
        m["clips"].append({"id": i, "file": file, "bytes": int(n), "sha256": s, "text_sha256": ts, "text": text})
    return m


def _write_manifest(out, voice, entries):
    total = sum(e["bytes"] for e in entries)
    lines = [VERSION, f"# voice\t{voice}", f"# format\t{FORMAT}", f"# clips\t{len(entries)}\t{total}", COLUMNS]
    for e in sorted(entries, key=lambda e: e["id"]):
        lines.append("\t".join([e["id"], e["file"], str(e["bytes"]), e["sha256"], e["text_sha256"], e["text"]]))
    (Path(out) / MANIFEST).write_text("\n".join(lines) + "\n")


def _intact(out, e):
    p = Path(out) / e["file"]
    return p.exists() and p.stat().st_size == e["bytes"] and sha256(p.read_bytes()) == e["sha256"]


def build(clips, out, synth, dry_run=False):
    """Render what changed into `out`; returns {rendered, skipped, removed, bytes, seconds}."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    m = read_manifest(out)
    same_pack = m["voice"] == synth.voice and m["format"] == FORMAT
    old = {e["id"]: e for e in m["clips"]} if same_pack else {}
    entries, stats = [], {"rendered": 0, "skipped": 0, "removed": 0, "bytes": 0, "seconds": 0.0}
    for c in clips:
        tsha = sha256(c["text"].encode())
        file = file_name(c["id"])
        e = old.get(c["id"])
        if e and e["text_sha256"] == tsha and e["text"] == c["text"] and e["file"] == file and _intact(out, e):
            entries.append(e)
            stats["skipped"] += 1
            stats["bytes"] += e["bytes"]
            continue
        if dry_run:
            print(f"would render {c['id']}: {c['text']!r}")
            continue
        pcm = synth(c["text"])
        if len(pcm) < 2:
            raise RuntimeError(f"empty audio for {c['id']}")
        wav = encode_wav(pcm)
        wav_info(wav)
        (out / file).write_bytes(wav)
        entries.append({"id": c["id"], "file": file, "bytes": len(wav), "sha256": sha256(wav),
                        "text_sha256": tsha, "text": c["text"]})
        stats["rendered"] += 1
        stats["bytes"] += len(wav)
        stats["seconds"] += len(pcm) / 2 / RATE
        print(f"rendered {c['id']}: {len(c['text'])} chars -> {len(wav)} B")
        # After every clip, so a killed run keeps what it finished; clips not reached yet keep
        # their old rows, and are checked when the run (or the next one) gets to them.
        done = {e["id"] for e in entries}
        _write_manifest(out, synth.voice, entries + [e for i, e in old.items() if i not in done])
    if dry_run:
        print(f"dry run: {len(clips) - stats['skipped']} clips would be rendered")
        return stats
    keep = {e["file"] for e in entries} | {MANIFEST}
    for p in sorted(out.iterdir()):
        if p.is_file() and p.name not in keep:
            p.unlink()
            stats["removed"] += 1
            print(f"removed {p.name}")
    _write_manifest(out, synth.voice, entries)
    print(f"{stats['rendered']} rendered, {stats['skipped']} unchanged, {stats['removed']} removed; "
          f"pack is {len(entries)} clips, {stats['bytes']} B of {budget_bytes(entries)} B budget")
    return stats


def budget_bytes(clips):
    """What these texts cost read at SLOW_CPS in this format: the ceiling, before headroom."""
    return sum(HEADER_BYTES + math.ceil(len(c["text"]) / SLOW_CPS * BYTE_RATE) for c in clips)


def budget_problems(out):
    m = read_manifest(out)
    total, ceiling = sum(e["bytes"] for e in m["clips"]), budget_bytes(m["clips"])
    if total > (1 - HEADROOM) * ceiling:
        return [f"pack is {total} B, over {int((1 - HEADROOM) * ceiling)} B "
                f"({ceiling} B at {SLOW_CPS} chars/s less {HEADROOM:.0%} headroom)"]
    return []


def check(out, clips, voice):
    """Problems with the pack in `out` against the source clips; [] when it is exact."""
    out = Path(out)
    m = read_manifest(out)
    problems = []
    if m["voice"] != voice or m["format"] != FORMAT:
        problems.append(f"pack is {m['voice']} / {m['format']}, want {voice} / {FORMAT}")
    have = {e["id"]: e for e in m["clips"]}
    want = {c["id"]: c for c in clips}
    for i in sorted(want.keys() - have.keys()):
        problems.append(f"{i}: in the source, not rendered")
    for i in sorted(have.keys() - want.keys()):
        problems.append(f"{i}: rendered, not in the source")
    for i in sorted(want.keys() & have.keys()):
        e, c = have[i], want[i]
        if e["text"] != c["text"] or e["text_sha256"] != sha256(c["text"].encode()):
            problems.append(f"{i}: text changed since render")
        if e["file"] != file_name(i):
            problems.append(f"{i}: file {e['file']} is not {file_name(i)}")
        p = out / e["file"]
        if not p.exists():
            problems.append(f"{i}: {e['file']} missing")
            continue
        b = p.read_bytes()
        if sha256(b) != e["sha256"] or len(b) != e["bytes"]:
            problems.append(f"{i}: {e['file']} does not match the manifest")
            continue
        try:
            info = wav_info(b)
            if (info["format_tag"], info["rate"], info["channels"]) != (0x11, RATE, 1):
                problems.append(f"{i}: {e['file']} is not {FORMAT}")
        except ValueError as err:
            problems.append(f"{i}: {e['file']}: {err}")
    files = {e["file"] for e in m["clips"]} | {MANIFEST}
    for p in sorted(out.iterdir()) if out.exists() else []:
        if p.name not in files:
            problems.append(f"{p.name}: stray file")
    return problems + budget_problems(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--model", type=Path, default=MODEL)
    ap.add_argument("--piper", type=Path, default=PIPER)
    args = ap.parse_args(argv)
    clips = load_clips(SOURCE)
    if args.check:
        problems = check(args.out, clips, args.model.stem)
        for p in problems:
            print(p)
        m = read_manifest(args.out)
        print(f"{len(m['clips'])} clips, {sum(e['bytes'] for e in m['clips'])} B, {len(problems)} problems")
        return 1 if problems else 0
    build(clips, args.out, piper_synth(args.model, args.piper), dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
