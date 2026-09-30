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
| king.glb | King (Ultimate Animated Character pack): the Ember commander | https://poly.pizza/m/I1gTjmuK2m | CC0 1.0 |
| hooded.glb | Hooded Adventurer (Ultimate Animated Character pack), with her sword: the Tide commander | https://poly.pizza/m/y9KWOVG21R | CC0 1.0 |
| slag-brute.glb | Giant (Ultimate Monsters), **modified**: recoloured to basalt and ember | https://poly.pizza/m/BldaiPtyJa | CC0 1.0 |
| trench-crab.glb | Crab Enemy, **modified**: recoloured to the trench's blue and pearl | https://poly.pizza/m/Gs3yfsV5lB | CC0 1.0 |

## Set 1's people (public/creatures/*.glb: the units fidelity pass, 2026-09-29)

Eight units are assembled by `tools/assemble-units.py`: Ashen Vanguard, Hearth Warden, Pearl
Shieldbearer, Reef Archer, Tidecaller, Brine Skimmer, Forge Runner and Bellows Raider. Each is built
from the parts below, all **CC0 1.0 Universal** (text in `licenses/LICENSE-CC0-1.0.txt`).

Every file is **modified**:
- parts joined on one rig; the base body cut to its head (and hands);
- props bound to hand and head bones;
- decimated (a Blender-decimated LOD1 besides);
- baked to vertex colour, recoloured for its faction (0039);
- only five clips kept.

Downloaded 2026-09-29 without an account. The itch.io packs came through each page's own free
download ("Name your own price", minimum 0); only the free tiers were taken, never the paid ones.
Each license was read on its page and in the pack's own license file.

| Source | Page | License as stated there | Download sha256 |
|---|---|---|---|
| Modular Character Outfits - Fantasy [Standard], Quaternius: the Ranger and Peasant outfits | https://quaternius.itch.io/modular-character-outfits-fantasy | "Creative Commons Zero v1.0 Universal"; License_Standard.txt: "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication" | c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70 |
| Universal Base Characters [Standard], Quaternius: the heads, hair and beard | https://quaternius.itch.io/universal-base-characters | "Creative Commons Zero v1.0 Universal" | fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40 |
| Universal Animation Library [Standard], Quaternius: the rig and the clips | https://quaternius.itch.io/universal-animation-library | "Creative Commons Zero v1.0 Universal"; License.txt: "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication" | cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724 |
| KayKit Adventurers 2.0 [Free], Kay Lousberg (www.kaylousberg.com): props only (the knight's helm and visor, swords, shields, a staff, a bow, an axe) | https://kaylousberg.itch.io/kaykit-adventurers | "Creative Commons Zero v1.0 Universal"; License.txt: "License: (Creative Commons Zero, CC0)" | abe48f4763fba0896bab486ee9e6d08ca6b5b3884b9601f235c8847ae94dc479 |
| Giant, Quaternius (poly.pizza) | https://poly.pizza/m/BldaiPtyJa | "CC0 1.0" | 09f2fc7a7d8e9504bea781df0730de0f9e479d04be10af134ae618a158f7abb1 |
| Crab Enemy, Quaternius (poly.pizza) | https://poly.pizza/m/Gs3yfsV5lB | "CC0 1.0" | b5487be2c83059cf5b834d4d90cccc69346af36427a8d9ee4509f96af0c148f6 |

| Vendored file | sha256 |
|---|---|
| ashen-vanguard.glb | 024d5bf6ca54b45c847b6fc4ab24785a4460153a2faff0a0be145a7209e3e978 |
| hearth-warden.glb | 43c7fdf2eba418b52e0fdda9ae89e397d66bd2dc52800752eccd04243fcd1670 |
| pearl-shieldbearer.glb | 309ad45543087140779d12becdc6b409f1f40943e1bb7ecb2e4b15434ea4ddd3 |
| reef-archer.glb | f458052af479fda5d8fcbaebd1825896e982c3990e9edae52d57e9d148234c9a |
| tidecaller.glb | aa662955abf29a88eb7438f1e0afdac6e45eeb94b4aab963504a1f82eecb5173 |
| brine-skimmer.glb | 4404c0de339e6ae5c2314d5ee1bec45d5cd0d6fd9e2b36d3146497c2b1b96be1 |
| forge-runner.glb | 1fc1a30ec10ad8dfabe0e987551121fceaa805dffd95fd3c68effb29ab9beb3a |
| bellows-raider.glb | e68f921601b70879a4be2c8af88fcdc10e5da37f87375fde42d06883cc5e6df7 |
| slag-brute.glb | cd7fa2f0177e67fa7c1a35ccb6c131a6f3f350fbcc500f6246a259a6261df3a8 |
| trench-crab.glb | 145f314ce79dcae7bff2a641b66d9728c1e677d97f9359d22083ca2838249b28 |

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
