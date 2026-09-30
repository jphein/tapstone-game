# assemble-units.py: set 1's human units, built from CC0 parts on one rig (design note
# 2026-09-29-xr-units-fidelity-design.md). Headless Blender 4.2 LTS (a build tool; nothing of it ships):
#
#   blender -b --python tools/assemble-units.py -- <sources dir> <out dir> [unit ...]
#
# Sources (public/CREDITS.md has each download's sha256), all CC0:
#   outfits/  Quaternius, Modular Character Outfits - Fantasy [Standard]
#   ubc/      Quaternius, Universal Base Characters [Standard]  (the head, hair, beard)
#   ual/      Quaternius, Universal Animation Library [Standard]  (the rig and the clips)
#   kaykit/   Kay Lousberg, KayKit Adventurers 2.0 [Free]  (props only: helm, swords, shields, staff, bow)
#
# Per unit: the Universal Animation Library's armature is the one rig. The outfit's meshes move onto it
# (the same 65 bones by name). Only the base body's head, and optionally its hands (where the clothes
# don't cover), is kept, so nothing clips through a holographic body. Hair, the helm and weapons are bound
# rigidly to their bones. The chosen clips are renamed to the summons' roles (idle, attack, hit, death,
# move) and the rest are dropped. Everything is joined into one mesh and decimated to `tris`. A second
# export, decimated to ~40%, is LOD1. tools/bake-creatures.mjs then bakes both (colour into vertices,
# one primitive each).
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
ONLY = set(args[2:])

OUTFITS = 'outfits/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits'
UBC = 'universal-base-characters/Universal Base Characters[Standard]'
BODY = UBC + '/Base Characters/Godot - UE'
HAIR = UBC + '/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)'
UAL = 'universal-animation-library/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb'
KAY = 'kaykit-adventurers/KayKit_Adventurers_2.0_FREE'

# The KayKit knight's helm and visor (its character file; only these two meshes are kept), fitted onto a
# realistic head: scale, then an offset from the head bone (m, in the bone's rest frame).
HELM = {'file': KAY + '/Characters/gltf/Knight.glb', 'meshes': ['Knight_Helmet', 'Knight_HelmetVisor']}

# Props: file, bone, offset (m) and rotation (deg, XYZ) in the bone's rest frame, and scale.
def prop(name, bone, at=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    return {'file': f'{KAY}/Assets/gltf/{name}.gltf', 'bone': bone, 'at': at, 'rot': rot, 'scale': scale}

SWORD_R = dict(bone='hand_r', at=(0.0, 0.07, 0.02), rot=(0, 0, 90), scale=0.55)
SHIELD_L = dict(bone='lowerarm_l', at=(0.0, 0.16, -0.06), rot=(0, 90, 0), scale=0.42)

# UAL clips per role (the Universal Animation Library's names).
FIGHT = {'idle': 'Sword_Idle', 'attack': 'Sword_Attack', 'hit': 'Hit_Chest', 'death': 'Death01', 'move': 'Jog_Fwd_Loop'}
CAST = {'idle': 'Spell_Simple_Idle_Loop', 'attack': 'Spell_Simple_Shoot', 'hit': 'Hit_Chest', 'death': 'Death01', 'move': 'Walk_Loop'}
RUN = {'idle': 'Idle_Loop', 'attack': 'Punch_Cross', 'hit': 'Hit_Head', 'death': 'Death01', 'move': 'Sprint_Loop'}

# The recipes (PROPOSAL, art direction: the bible names none of these figures; each follows its card's
# painting in public/cards).
UNITS = {
    'ashen-vanguard': {'outfit': 'Male_Ranger', 'body': 'Superhero_Male_FullBody', 'drop': ['Hood'], 'helm': True,
                       'props': [prop('sword_2handed', **{**SWORD_R, 'scale': 0.6})], 'clips': FIGHT},
    'hearth-warden': {'outfit': 'Male_Ranger', 'body': 'Superhero_Male_FullBody', 'drop': ['Hood'], 'helm': True,
                      'props': [prop('sword_1handed', **SWORD_R), prop('shield_badge', **{**SHIELD_L, 'scale': 0.5})], 'clips': FIGHT},
    'pearl-shieldbearer': {'outfit': 'Male_Ranger', 'body': 'Superhero_Male_FullBody', 'drop': ['Hood'], 'helm': True,
                           'props': [prop('sword_1handed', **SWORD_R), prop('shield_round', **SHIELD_L)], 'clips': FIGHT},
    'reef-archer': {'outfit': 'Male_Ranger', 'body': 'Superhero_Male_FullBody',
                    'props': [prop('bow_withString', 'hand_l', (0.0, 0.06, 0.0), (0, 0, 90), 0.55)], 'clips': CAST},
    'tidecaller': {'outfit': 'Female_Ranger', 'body': 'Superhero_Female_FullBody', 'hair': ['Hair_Long'],
                   'props': [prop('staff', 'hand_r', (0.0, 0.06, 0.02), (0, 0, 90), 0.6)], 'clips': CAST},
    'brine-skimmer': {'outfit': 'Female_Ranger', 'body': 'Superhero_Female_FullBody',
                      # Her shell board (a round shield, flat under her feet) and a staff for the harpoon.
                      'props': [prop('staff', 'hand_r', (0.0, 0.06, 0.02), (0, 0, 90), 0.5),
                                prop('shield_round', 'root', (0.0, 0.0, 0.03), (90, 0, 0), 1.1)], 'clips': RUN},
    'forge-runner': {'outfit': 'Male_Peasant', 'body': 'Superhero_Male_FullBody', 'hair': ['Hair_SimpleParted'], 'hands': True, 'clips': RUN},
    'bellows-raider': {'outfit': 'Male_Peasant', 'body': 'Superhero_Male_FullBody', 'hair': ['Hair_Long', 'Hair_Beard'], 'hands': True,
                       'props': [prop('axe_1handed', **SWORD_R)], 'clips': FIGHT},
}

KEEP_HEAD = ('Head', 'neck')
KEEP_HANDS = ('hand', 'thumb', 'index', 'middle', 'ring', 'pinky')


def imported(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, path))
    return [o for o in bpy.data.objects if o not in before]


def rebind(mesh, rig):
    """Move a skinned mesh onto `rig` (the same bone names), keeping where it is."""
    mw = mesh.matrix_world.copy()
    mesh.parent = rig
    mesh.matrix_world = mw
    for m in mesh.modifiers:
        if m.type == 'ARMATURE':
            m.object = rig
    if not any(m.type == 'ARMATURE' for m in mesh.modifiers):
        mesh.modifiers.new('rig', 'ARMATURE').object = rig


def keep_by_bone(mesh, prefixes):
    """Delete the vertices whose strongest bone is not one of `prefixes` (the body under the clothes)."""
    names = {g.index: g.name for g in mesh.vertex_groups}
    drop = []
    for v in mesh.data.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        bone = names.get(best.group, '') if best else ''
        if not any(bone.startswith(p) or p in bone for p in prefixes):
            drop.append(v.index)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in drop], context='VERTS')
    bm.to_mesh(mesh.data)
    bm.free()


def bind_rigid(obj, rig, bone, at, rot, scale):
    """Place a static prop in `bone`'s rest frame and skin it to that bone alone (weight 1)."""
    b = rig.data.bones[bone]
    frame = rig.matrix_world @ b.matrix_local
    local = Matrix.Translation(Vector(at)) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4() @ Matrix.Scale(scale, 4)
    obj.parent = None
    obj.matrix_world = frame @ local
    bpy.context.view_layer.update()
    # Apply the transform into the mesh so the vertices carry it, then skin.
    with bpy.context.temp_override(selected_editable_objects=[obj], active_object=obj, object=obj):
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    obj.parent = rig
    obj.modifiers.new('rig', 'ARMATURE').object = rig


def meshes_of(objs):
    return [o for o in objs if o.type == 'MESH' and not o.name.startswith('Icosphere')]


def delete(objs):
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def build(name, r):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # The rig and the clips: the Universal Animation Library's armature; its mannequin goes.
    ual = imported(UAL)
    rig = next(o for o in ual if o.type == 'ARMATURE')
    delete([o for o in ual if o.type == 'MESH'])
    rig.name = 'Rig'
    parts = []
    # The outfit (minus any part dropped: the knights lose the ranger's hood for the helm).
    out = imported(f"{OUTFITS}/{r['outfit']}.gltf")
    for m in meshes_of(out):
        if any(d in m.name for d in r.get('drop', [])):
            continue
        rebind(m, rig)
        parts.append(m)
    delete([o for o in out if o not in parts])
    # The head (and the hands, where the outfit leaves them bare) of the base body, its eyes and brows.
    body = imported(f"{BODY}/{r['body']}.gltf")
    keep = KEEP_HEAD + (KEEP_HANDS if r.get('hands') else ())
    for m in meshes_of(body):
        if m.name.startswith('SuperHero') or m.name.startswith('Superhero'):
            keep_by_bone(m, keep)
        rebind(m, rig)
        parts.append(m)
    delete([o for o in body if o not in parts])
    for h in r.get('hair', []):
        hair = imported(f'{HAIR}/{h}.gltf')
        for m in meshes_of(hair):
            rebind(m, rig)
            parts.append(m)
        delete([o for o in hair if o not in parts])
    if r.get('helm'):
        kn = imported(HELM['file'])
        head = rig.data.bones['Head']
        for m in [o for o in kn if o.type == 'MESH' and o.name.split('.')[0] in HELM['meshes']]:
            # The chibi helm sits around a head ~2x a real one: scale it about the head bone.
            m.modifiers.clear()
            m.parent = None
            bpy.context.view_layer.update()
            with bpy.context.temp_override(selected_editable_objects=[m], active_object=m, object=m):
                bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            m.vertex_groups.clear()
            bb = [m.matrix_world @ Vector(c) for c in m.bound_box]
            lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
            hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
            size = (hi - lo)
            centre = (hi + lo) / 2
            k = 0.3 / max(size.x, size.y)  # a helm ~30 cm across
            headpos = rig.matrix_world @ head.head_local
            m.matrix_world = Matrix.Translation(headpos + Vector((0, -0.005, 0.1))) @ Matrix.Scale(k, 4) @ Matrix.Translation(-centre)
            bpy.context.view_layer.update()
            with bpy.context.temp_override(selected_editable_objects=[m], active_object=m, object=m):
                bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            vg = m.vertex_groups.new(name='Head')
            vg.add(list(range(len(m.data.vertices))), 1.0, 'REPLACE')
            m.parent = rig
            m.modifiers.new('rig', 'ARMATURE').object = rig
            parts.append(m)
        delete([o for o in kn if o not in parts])
    for p in r.get('props', []):
        got = imported(p['file'])
        ms = meshes_of(got)
        for m in ms:
            bind_rigid(m, rig, p['bone'], p['at'], p['rot'], p['scale'])
            parts.append(m)
        delete([o for o in got if o not in parts])
    # One mesh.
    for o in bpy.data.objects:
        if o is not None and o.name in bpy.context.view_layer.objects:
            o.select_set(False)
    for m in parts:
        m.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    with bpy.context.temp_override(selected_editable_objects=parts, active_object=parts[0], object=parts[0]):
        bpy.ops.object.join()
    mesh = parts[0]
    mesh.name = name
    # Keep only the roles' clips, renamed.
    keepers = {}
    for role, clip in r['clips'].items():
        # Blender names an imported clip after its armature: `Sword_Idle_Armature`.
        a = bpy.data.actions.get(clip) or next((x for x in bpy.data.actions if x.name.startswith(clip + '_Armature')), None)
        if a is None:
            raise SystemExit(f'{name}: no clip {clip}')
        keepers[a.name] = role
    for a in list(bpy.data.actions):
        if a.name not in keepers:
            bpy.data.actions.remove(a)
    for a in bpy.data.actions:
        a.use_fake_user = True  # the exporter names them by their clips (Sword_Idle...): the bake maps roles
    full = tris(mesh)
    for tag, target in (('src', r.get('tris', 7000)), ('lod1-src', r.get('lod1', 2800))):
        d = mesh.modifiers.new('decimate', 'DECIMATE')
        d.ratio = min(1.0, target / full)
        d.use_collapse_triangulate = True
        mesh.modifiers.move(len(mesh.modifiers) - 1, 0)  # before the armature
        path = os.path.join(OUT, f'{name}-{tag}.glb')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_animations=True,
                                  export_animation_mode='ACTIONS', export_apply=True, export_yup=True)
        mesh.modifiers.remove(d)
        print(f'{name}: {tag} from {full} triangles at ratio {min(1.0, target / full):.3f} -> {path}')


for name, recipe in UNITS.items():
    if ONLY and name not in ONLY:
        continue
    build(name, recipe)
