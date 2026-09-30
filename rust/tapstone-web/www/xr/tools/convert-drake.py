# convert-drake.py: the Cinder Whelp's source model to glTF, once (design note
# 2026-09-29-xr-whelp-drake-design.md). "Low Poly Ice Dragon" by xTerryx, CC0 1.0
# (https://opengameart.org/content/low-poly-ice-dragon; public/CREDITS.md has the files' sha256).
# Its .blend links a palette image by a path that isn't in the download: this relinks the
# download's dragon_texture.png, packs it, and exports GLB with the Flying action and the mirror
# modifier applied. tools/bake-creatures.mjs `drake` then bakes it like the other creatures.
#
#   blender -b dragon_model.blend --python tools/convert-drake.py -- <dragon_texture.png> <out.glb> [<lod1.glb>]
#
# With a third path it also writes a LOD1: the same rig and action, the mesh decimated to ~45% by
# Blender's Decimate (collapse), which handles this model's flat-shaded, non-manifold shells where
# meshoptimizer's simplifier (the bake's usual LOD1) removes nothing.
#
# Blender (4.2 LTS) is a build tool here: nothing of it ships.
import sys
import bpy

args = sys.argv[sys.argv.index('--') + 1:]
texture, out = args[:2]
lod1 = args[2] if len(args) > 2 else None
for im in bpy.data.images:
    if im.source == 'FILE' and im.size[0] == 0:
        im.filepath = texture
        im.reload()
        im.pack()
        print('relinked', im.name, tuple(im.size))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True,
                          export_animation_mode='ACTIONS', export_apply=True, export_yup=True)
if lod1:
    for o in bpy.data.objects:
        if o.type == 'MESH':
            d = o.modifiers.new('lod1', 'DECIMATE')
            d.ratio = 0.45
            d.use_collapse_triangulate = True
            # After the mirror, before the armature: the rig still deforms the decimated mesh.
            names = [m.type for m in o.modifiers]
            at = names.index('ARMATURE') if 'ARMATURE' in names else len(names) - 1
            o.modifiers.move(len(o.modifiers) - 1, at)
            print('lod1 modifiers', o.name, [m.type for m in o.modifiers])
    bpy.ops.export_scene.gltf(filepath=lod1, export_format='GLB', export_animations=True,
                              export_animation_mode='ACTIONS', export_apply=True, export_yup=True)
