"""tools/kws_quantize.py: Tapstone's int8 build of the LibriSpeech 20M streaming encoder.

    python3 tools/kws_quantize.py <fp32 encoder.onnx> <out.onnx> [--recipe NAME]

Our derived build of sherpa-onnx-streaming-zipformer-en-20M-2023-02-17 (Apache-2.0; see
public/licenses/NOTICE-kws-model.txt): MODIFIED from the upstream fp32 export by the steps below.
tools/fetch_kws.mjs runs it in a venv pinned by tools/kws-quantize-requirements.txt (exact versions
and wheel hashes) and checks the output's sha256 against its pin, so the bytes are the same on every
run (proved by running twice: scratch/issues/selene.md, 2026-09-29).

Recipes, measured on the TTS corpus (design note docs/superpowers/specs/2026-09-29-xr-kws-slim-design.md;
the floor is 128/150 right, 115/125 on the unaccented voices). The largest cut that holds ships:
  matmul             onnxruntime quantize_dynamic, MatMul only, int8 weights (upstream's recipe): 43.1 MB, holds
  matmul-table       matmul, plus the relative-position table (a 10 MB float constant only Slice
                     reads) stored as int8 behind one DequantizeLinear: 35.4 MB, holds  <- SHIPPED
  matmul-pw-table    matmul-table, plus the 1x1 convolutions as uint8 (ConvInteger): 23.7 MB, 127/150
  matmul-pwpc-table, matmulpc-pwpc-table, matmul-conv, full, full-pc: 23-31 MB, 126-127/150
Every recipe is deterministic: no calibration data, no randomness, fixed per-tensor ranges.
"""
import argparse
import os
import sys
import tempfile

import numpy as np
import onnx
from onnx import helper, numpy_helper
from onnxruntime.quantization import QuantType, quantize_dynamic

RECIPES = {
    "matmul": dict(ops=["MatMul"], table=False, per_channel=False),
    "matmul-table": dict(ops=["MatMul"], table=True, per_channel=False),
    "matmul-pw-table": dict(ops=["MatMul"], pointwise=True, table=True, per_channel=False),
    "matmul-pwpc-table": dict(ops=["MatMul"], pointwise=True, pw_per_channel=True, table=True, per_channel=False),
    "matmulpc-pwpc-table": dict(ops=["MatMul"], pointwise=True, pw_per_channel=True, table=True, per_channel=True),
    "matmul-conv": dict(ops=["MatMul", "Conv"], table=False, per_channel=False),
    "full": dict(ops=["MatMul", "Conv"], table=True, per_channel=False),
    "full-pc": dict(ops=["MatMul", "Conv"], table=True, per_channel=True),
}


def int8_table(model, min_bytes=1_000_000):
    """Store each large float Constant/initializer read only by Slice as int8 + DequantizeLinear."""
    g = model.graph
    consumers = {}
    for n in g.node:
        for i in n.input:
            consumers.setdefault(i, []).append(n.op_type)
    done = 0
    new_nodes = []
    for n in list(g.node):
        if n.op_type != "Constant" or not n.attribute or not n.attribute[0].t.dims:
            new_nodes.append(n)
            continue
        t = n.attribute[0].t
        a = numpy_helper.to_array(t)
        out = n.output[0]
        if a.dtype != np.float32 or a.nbytes < min_bytes or set(consumers.get(out, [])) != {"Slice"}:
            new_nodes.append(n)
            continue
        scale = np.float32(np.abs(a).max() / 127.0)
        q = np.clip(np.rint(a / scale), -127, 127).astype(np.int8)
        g.initializer.extend([
            numpy_helper.from_array(q, f"{out}_q"),
            numpy_helper.from_array(np.array(scale, dtype=np.float32), f"{out}_scale"),
            numpy_helper.from_array(np.array(0, dtype=np.int8), f"{out}_zero"),
        ])
        new_nodes.append(helper.make_node("DequantizeLinear", [f"{out}_q", f"{out}_scale", f"{out}_zero"], [out], name=f"{out}_dequant"))
        done += 1
    del g.node[:]
    g.node.extend(new_nodes)
    return done


def build(src, dst, recipe):
    r = RECIPES[recipe]
    with tempfile.TemporaryDirectory() as tmp:
        mid = os.path.join(tmp, "q.onnx")
        quantize_dynamic(src, mid, weight_type=QuantType.QInt8 if "Conv" not in r["ops"] else QuantType.QUInt8,
                         op_types_to_quantize=r["ops"], per_channel=r["per_channel"])
        if r.get("pointwise"):
            # A second pass: only the pointwise (1x1) convolutions, which hold nearly all the conv
            # bytes; ConvInteger takes unsigned weights, and the depthwise ones stay float.
            m0 = onnx.load(mid)
            inits = {t.name: t for t in m0.graph.initializer}
            pw = [n.name for n in m0.graph.node if n.op_type == "Conv" and len(n.input) > 1 and n.input[1] in inits
                  and list(inits[n.input[1]].dims)[2:] == [1]]
            mid2 = os.path.join(tmp, "q2.onnx")
            quantize_dynamic(mid, mid2, weight_type=QuantType.QUInt8, op_types_to_quantize=["Conv"], nodes_to_quantize=pw,
                             per_channel=r.get("pw_per_channel", False))
            mid = mid2
        m = onnx.load(mid)
        if r["table"]:
            n = int8_table(m)
            if n != 1:
                sys.exit(f"expected one position table, found {n}")
        # The model's metadata (sherpa-onnx reads it) is kept; the producer says what made it.
        m.producer_name = "tapstone tools/kws_quantize.py"
        m.producer_version = recipe
        onnx.save(m, dst)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--recipe", default="matmul-table", choices=sorted(RECIPES))
    a = ap.parse_args()
    build(a.src, a.dst, a.recipe)
