# Third-party assets in the headset build

Everything the page loads is served from its own origin (nothing is fetched after "loaded"). Tapstone's
own art, voice clips and code are not listed here. Started 2026-09-28 by the accessibility lane with its
own assets. The full license texts ship beside this file, in `licenses/`, as their licenses require.

| Asset | Where it lives | Source | License |
|---|---|---|---|
| sherpa-onnx 1.13.8: prebuilt WebAssembly (`kws.wasm`), its glue (`kws-glue.js`) and the keyword-spotter API (`kws-api.js`) | `kws/` (fetched by `tools/fetch_kws.mjs`, sha256-pinned) | https://github.com/k2-fsa/sherpa-onnx (npm `sherpa-onnx`) | Apache-2.0 (`licenses/LICENSE-Apache-2.0.txt`) |
| sherpa-onnx-streaming-zipformer-en-20M-2023-02-17: the int8 decoder, joiner and `tokens.txt` as published, and the encoder **modified** (requantized from the fp32 export by `tools/kws_quantize.py`, 2026-09-29; `licenses/NOTICE-kws-model.txt`) (since 2026-09-29; replaced a GigaSpeech-trained spotter, whose data terms are non-commercial) | `kws/` (same) | https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17 (revision d42f2d9f7ca24806fb667456a18a9f1b60f70d16), exported from https://huggingface.co/desh2608/icefall-asr-librispeech-pruned-transducer-stateless7-streaming-small (revision be162ecc09bade73063a671fad9d18220149d25b; icefall `pruned_transducer_stateless7_streaming`, k2-fsa) | Apache-2.0 (both model cards: `license: apache-2.0`; `licenses/LICENSE-Apache-2.0.txt`, and `licenses/NOTICE-kws-model.txt` for the modification) |
| Training data of that model: LibriSpeech ASR corpus (V. Panayotov, G. Chen, D. Povey, S. Khudanpur), 960 h, and MUSAN noise (D. Snyder, G. Chen, D. Povey) for augmentation, per the checkpoint's training log | not shipped (the weights were trained on them) | https://www.openslr.org/12/ and https://www.openslr.org/17/ | CC BY 4.0 both (`licenses/LICENSE-CC-BY-4.0.txt`), credited here as attribution |
| ONNX Runtime, statically linked into `kws.wasm` (its `onnxruntime::` symbols) | `kws/kws.wasm` | https://github.com/microsoft/onnxruntime | MIT, Copyright (c) Microsoft Corporation (`licenses/LICENSE-MIT-onnxruntime.txt`) |
| WebXR input-profile hand and controller models, `@webxr-input-profiles/assets` 1.0 | `profiles/` (vendored from the jsdelivr copy IWSDK requests, `src/net.js`) | https://github.com/immersive-web/webxr-input-profiles (packages/assets) | MIT, Copyright (c) 2019 Amazon (`licenses/LICENSE-MIT-webxr-input-profiles.txt`; the npm package omits the field, the repo's packages/assets/LICENSE.md states it) |

`kws/kws-node-shim.js`, `kws/kws-worker.js` and `kws/keywords.txt` are Tapstone's own. The TTS corpus used
to measure the spotter (Piper voices, on familiar) is a test input and is not shipped.

## Creatures (public/creatures/*.glb)

By **Quaternius** (quaternius.com), CC0 1.0 Universal (public domain), each confirmed CC0 on its
poly.pizza page on 2026-09-28. Baked by `tools/bake-creatures.mjs`: parts joined, colours moved to
vertex colour, clips trimmed and renamed, and a simplified LOD1 added.

| File | Model | Source | License |
|---|---|---|---|
| dragon-evolved.glb | Dragon Evolved (Ultimate Monsters) | https://poly.pizza/m/LlwD0QNUPj | CC0 1.0 |
| goleling.glb | Goleling (Ultimate Monsters) | https://poly.pizza/m/71gomWolax | CC0 1.0 |
| goleling-evolved.glb | Goleling Evolved (Ultimate Monsters) | https://poly.pizza/m/iHEuXiH6Aj | CC0 1.0 |
| squidle.glb | Squidle (Ultimate Monsters) | https://poly.pizza/m/54QyRcsogk | CC0 1.0 |
| imp.glb | Enemy Small | https://poly.pizza/m/4LjT020LQh | CC0 1.0 |
| fish.glb | Fish | https://poly.pizza/m/7V4gaDMQV8 | CC0 1.0 |
| birb.glb | Birb | https://poly.pizza/m/gZ2ExU9OAB | CC0 1.0 |
| demon.glb | Demon | https://poly.pizza/m/LnfIziKv4o | CC0 1.0 |
| skeleton.glb | Skeleton | https://poly.pizza/m/DM4QScSmbS | CC0 1.0 |
| wolf.glb | Wolf | https://poly.pizza/m/XU7oNeKShV | CC0 1.0 |
| king.glb | King (Ultimate Animated Character pack): the Ember commander | https://poly.pizza/m/I1gTjmuK2m | CC0 1.0 |
| hooded.glb | Hooded Adventurer (Ultimate Animated Character pack), with her sword: the Tide commander | https://poly.pizza/m/y9KWOVG21R | CC0 1.0 |

## The Cinder Whelp (public/creatures/drake.glb)

**"Low Poly Ice Dragon"** by **xTerryx**, https://opengameart.org/content/low-poly-ice-dragon, released
under **CC0 1.0 Universal** (public domain dedication; text in `licenses/LICENSE-CC0-1.0.txt`). The
license was read on that page at download, 2026-09-29 17:32 UTC ("CC0"; the author's words: "A basic Ice
Dragon I made with a fly and a bite animation."). CC0 needs no attribution: it is credited as a courtesy.

**Modified**:
- converted from Blender to glTF (`tools/convert-drake.py`, the missing palette relinked);
- recoloured from ice to the Forge Peaks' ember crimson and gold;
- baked to vertex colour and one skinned primitive;
- a Blender-decimated LOD1 (`tools/bake-creatures.mjs` `drake`).

| File | sha256 |
|---|---|
| dragon_model.blend (as downloaded) | 98f4a9da31ac62a9a79978084402ba338cbf443a6c205a7208b48ca396632484 |
| dragon_texture.png (as downloaded) | ff6d40e034b815e09cc3a0941a9ae1f05a1e9585fed28d4707eecf0eaf85d1d9 |
| public/creatures/drake.glb (vendored) | 5e65aa477caf9889d410eb07773dbd8092ef556a9fc0a26fbaac05780ab3b578 |

If it fails to load, the procedural wyrm stands in (below).

The Cinder Whelp's fallback dragon, the wyrm, is our own procedural geometry (src/summons/wyrm.js,
wyrm-pose.js), as are
the holographic material, the card dissolve, the wisp fallback and the spell effects (src/summons/).
