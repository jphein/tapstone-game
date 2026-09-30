"""tools/voice_keywords.py: write public/kws/keywords.txt, the keyword spotter's phrase list.

    python3 tools/voice_keywords.py           rewrite it from the grammar
    python3 tools/voice_keywords.py --check   exit 1 if it differs from what the grammar gives

The grammar is src/logic/voice-commands.js (phrases()); this tool only turns each phrase into the
model's word pieces (sentencepiece BPE, tools/.kws/bpe.model from tools/fetch_kws.mjs), one line per
phrase: "<pieces> [:<boost> #<threshold>] @<TAG>", where TAG is the phrase with underscores
(voice-commands.js tagOf).
One segmentation per phrase: extra sampled segmentations measured no better on the TTS corpus
(scratch/issues/selene.md, 2026-09-28).

Needs: node (20+) on PATH and `pip install sentencepiece` (a venv is fine).
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

XR = Path(__file__).resolve().parent.parent
OUT = XR / "public" / "kws" / "keywords.txt"
BPE = XR / "tools" / ".kws" / "bpe.model"
NSEG = 1  # segmentations per phrase (measured per model: scratch/issues/selene.md)
# A phrase of one or two words gets its own boost and threshold (" :<boost> #<threshold>" before the
# tag): the LibriSpeech model misses short commands most, and this took the TTS corpus from 126 to
# 128 of 150 with 1 false alarm in 24 non-commands, against 3 without it (2026-09-29).
SHORT = (2, "3.0", "0.02")  # (at most this many words, boost, threshold)


def phrases():
    js = "import('./src/logic/voice-commands.js').then((m) => console.log(JSON.stringify(m.phrases().map((p) => p.text))))"
    return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", js], cwd=XR))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--bpe", default=str(BPE), help="the model's sentencepiece BPE (default: tools/.kws/bpe.model)")
    ap.add_argument("--out", default=str(OUT), help="where to write (default: public/kws/keywords.txt)")
    ap.add_argument("--nseg", type=int, default=NSEG, help="segmentations per phrase (the canonical one, plus sampled ones)")
    args = ap.parse_args()
    out = Path(args.out)
    import sentencepiece as spm

    sp = spm.SentencePieceProcessor(model_file=args.bpe)
    lines = []
    for t in phrases():
        segs = [" ".join(sp.encode(t, out_type=str))]
        # Sampled segmentations, seeded so the file is reproducible: a spotter matches word pieces
        # exactly, and a model may decode a word along a different split than the canonical one.
        spm.set_random_generator_seed(sum(map(ord, t)))
        for _ in range(args.nseg * 8):
            if len(segs) >= args.nseg:
                break
            seg = " ".join(sp.encode(t, out_type=str, enable_sampling=True, alpha=0.1, nbest_size=-1))
            if seg not in segs:
                segs.append(seg)
        extra = f" :{SHORT[1]} #{SHORT[2]}" if len(t.split()) <= SHORT[0] else ""
        lines += [seg + extra + " @" + t.replace(" ", "_") for seg in segs]
    text = "\n".join(lines) + "\n"
    if args.check:
        same = out.exists() and out.read_text() == text
        print("keywords.txt is current" if same else "keywords.txt is stale: run tools/voice_keywords.py")
        sys.exit(0 if same else 1)
    out.write_text(text)
    print(f"wrote {out}: {len(lines)} phrases")


if __name__ == "__main__":
    main()
