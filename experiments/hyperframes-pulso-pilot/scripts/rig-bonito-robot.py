#!/usr/bin/env python3
"""Add a mechanical skeleton and native visor controls to the Hunyuan candidate.

The original GLB is immutable. UVs and embedded textures are retained. Positions
and normals are rotated into Y-up; plate regions use rigid weights, with blends
restricted to joint bands. The visor gets its own material and LED mesh controls.
"""
import copy
import hashlib
import io
import json
from pathlib import Path
import struct
import argparse
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'variants/robo-bonito/assets/robo-bonito-hunyuan.glb'
parser = argparse.ArgumentParser()
parser.add_argument('--variant', default='robo-bonito-animado')
args = parser.parse_args()
if args.variant not in ['robo-bonito-animado', 'robo-bonito-temas']:
    parser.error('Unknown variant')
out = root / 'variants' / args.variant
(out / 'assets').mkdir(parents=True, exist_ok=True)
raw = source.read_bytes()
jlen, _ = struct.unpack_from('<II', raw, 12)
doc = json.loads(raw[20:20+jlen])
blen, _ = struct.unpack_from('<II', raw, 20+jlen)
binary = bytearray(raw[28+jlen:28+jlen+blen])
types = {5126: '<f4', 5125: '<u4', 5123: '<u2'}
sizes = {'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'SCALAR': 1, 'MAT4': 16}

def read(index):
    a = doc['accessors'][index]
    v = doc['bufferViews'][a['bufferView']]
    dt, cols = np.dtype(types[a['componentType']]), sizes[a['type']]
    return np.ndarray((a['count'], cols), dtype=dt, buffer=binary,
        offset=v.get('byteOffset', 0)+a.get('byteOffset', 0),
        strides=(v.get('byteStride', cols*dt.itemsize), dt.itemsize)).copy()

def append(data, component=5126, kind='VEC3', target=34962, bounds=False):
    data = np.asarray(data, dtype=types[component]).reshape(-1, sizes[kind])
    binary.extend(b'\0' * ((-len(binary)) % 4))
    view = {'buffer': 0, 'byteOffset': len(binary), 'byteLength': data.nbytes}
    if target:
        view['target'] = target
    doc['bufferViews'].append(view)
    binary.extend(data.tobytes())
    a = {'bufferView': len(doc['bufferViews'])-1, 'componentType': component,
         'count': len(data), 'type': kind}
    if bounds:
        a.update(min=data.min(axis=0).tolist(), max=data.max(axis=0).tolist())
    doc['accessors'].append(a)
    return len(doc['accessors'])-1

primitive = doc['meshes'][0]['primitives'][0]
original = read(primitive['attributes']['POSITION'])
pos = np.stack((original[:, 0], -original[:, 2], original[:, 1]), axis=1)
h = float(pos[:, 1].max())
normal = read(primitive['attributes']['NORMAL'])
normal = np.stack((normal[:, 0], -normal[:, 2], normal[:, 1]), axis=1)
indices = read(primitive['indices']).reshape(-1, 3)
x, y, z = pos[:, 0]/h, pos[:, 1]/h, pos[:, 2]/h

# Bind pivots are measured in the candidate's coordinate frame, not copied from
# another character. Bone axes stay world-aligned in rest; arm rotations operate
# at shoulder/elbow/wrist and keep the ceramic plate interiors rigid.
definition = [
    ('Root', None, [0, 0, 0]),
    ('Hips', 'Root', [0, .32, 0]),
    ('Chest', 'Hips', [0, .57, 0]),
    ('Neck', 'Chest', [0, .663, -.01]),
    ('Head', 'Neck', [0, .69, -.01]),
    ('UpperArm_L', 'Chest', [.205, .615, -.012]),
    ('Forearm_L', 'UpperArm_L', [.288, .515, .012]),
    ('Hand_L', 'Forearm_L', [.360, .385, .025]),
    ('UpperArm_R', 'Chest', [-.205, .615, -.012]),
    ('Forearm_R', 'UpperArm_R', [-.288, .515, .012]),
    ('Hand_R', 'Forearm_R', [-.360, .385, .025]),
    ('Thigh_L', 'Hips', [.112, .31, -.01]),
    ('Shin_L', 'Thigh_L', [.127, .215, -.005]),
    ('Foot_L', 'Shin_L', [.131, .067, .028]),
    ('Thigh_R', 'Hips', [-.112, .31, -.01]),
    ('Shin_R', 'Thigh_R', [-.127, .215, -.005]),
    ('Foot_R', 'Shin_R', [-.131, .067, .028])
]
if args.variant == 'robo-bonito-temas':
    # Measured from the black joint bands in the source UV/geometry projection.
    pivots = {'UpperArm': [.184, .605, -.012], 'Forearm': [.242, .493, -.015],
              'Hand': [.308, .361, .035]}
    definition = [(name, parent, [pivots[name.split('_')[0]][0] * (1 if name.endswith('_L') else -1),
                                 *pivots[name.split('_')[0]][1:]])
                  if name.split('_')[0] in pivots else (name, parent, point)
                  for name, parent, point in definition]
lookup = {name: i for i, (name, _, _) in enumerate(definition)}
absolute = {name: np.array(point)*h for name, _, point in definition}
joint_ids = np.zeros((len(pos), 4), dtype=np.uint16)
weights = np.zeros((len(pos), 4), dtype=np.float32)
joint_ids[:, 0] = lookup['Chest']
weights[:, 0] = 1

def rigid(mask, name):
    joint_ids[mask, 0] = lookup[name]
    joint_ids[mask, 1:] = 0
    weights[mask] = [1, 0, 0, 0]

def joint_band(mask, lo, hi, low_bone, high_bone):
    mask = mask & (y >= lo) & (y <= hi)
    a = np.clip((y[mask]-lo)/(hi-lo), 0, 1)
    a = a*a*(3-2*a)
    joint_ids[mask, 0], joint_ids[mask, 1] = lookup[low_bone], lookup[high_bone]
    weights[mask, 0], weights[mask, 1] = 1-a, a

rigid(y > .682, 'Head')
rigid((y > .644) & (y <= .682), 'Neck')
joint_band(y > .64, .672, .687, 'Neck', 'Head')
arm_edge = np.interp(y, [.20, .38, .50, .61, .66], [.235, .245, .210, .168, .190])
if args.variant == 'robo-bonito-temas':
    # The old boundary left the inner surface of both forearms attached to the
    # chest. During the wave it stretched into a long white triangular sheet.
    arm_edge = np.interp(y, [.20, .335, .38, .45, .50, .55, .61, .66],
                           [.235, .22, .19, .18, .165, .14, .147, .175])
arm = (np.abs(x) > arm_edge) & (y > .18) & (y < .655)
for suffix, sign in [('L', 1), ('R', -1)]:
    side = x*sign > 0
    arm_side = arm & side
    rigid(arm_side & (y >= .512), 'UpperArm_'+suffix)
    rigid(arm_side & (y < .512) & (y >= .377), 'Forearm_'+suffix)
    rigid(arm_side & (y < .377), 'Hand_'+suffix)
    joint_band(arm_side, .503, .523, 'Forearm_'+suffix, 'UpperArm_'+suffix)
    joint_band(arm_side, .368, .388, 'Hand_'+suffix, 'Forearm_'+suffix)
    if args.variant == 'robo-bonito-temas':
        # Cuts follow the sloped black elbow/wrist bands, instead of horizontal
        # planes that sliced through the white plates in the original rig.
        forearm = y < .493 + .65 * (np.abs(x) - .242)
        hand = y < .361 + .45 * (np.abs(x) - .308)
        rigid(arm_side & ~forearm, 'UpperArm_'+suffix)
        rigid(arm_side & forearm & ~hand, 'Forearm_'+suffix)
        rigid(arm_side & hand, 'Hand_'+suffix)
    leg = side & ~arm & (y < .335)
    rigid(leg & (y >= .218), 'Thigh_'+suffix)
    rigid(leg & (y < .218) & (y >= .075), 'Shin_'+suffix)
    rigid(leg & (y < .075), 'Foot_'+suffix)
    joint_band(leg, .207, .229, 'Shin_'+suffix, 'Thigh_'+suffix)
    joint_band(leg, .060, .083, 'Foot_'+suffix, 'Shin_'+suffix)

attrs = copy.deepcopy(primitive['attributes'])
attrs.update(POSITION=append(pos, bounds=True), NORMAL=append(normal),
             JOINTS_0=append(joint_ids, 5123, 'VEC4'), WEIGHTS_0=append(weights, 5126, 'VEC4'))
doc['nodes'][0] = {'name': 'PulsoBody', 'mesh': 0, 'skin': 0}
bone_nodes = {}
for name, parent, point in definition:
    world = absolute[name]
    local = world-absolute[parent] if parent else world
    bone_nodes[name] = len(doc['nodes'])
    doc['nodes'].append({'name': name, 'translation': local.tolist(), 'children': []})
    if parent:
        doc['nodes'][bone_nodes[parent]]['children'].append(bone_nodes[name])
inverse = []
for name, _, _ in definition:
    m = np.eye(4, dtype=np.float32)
    m[:3, 3] = -absolute[name]
    inverse.append(m.flatten(order='F'))
doc['skins'] = [{'name': 'PulsoMechanicalRig', 'joints': list(bone_nodes.values()),
                 'skeleton': bone_nodes['Root'],
                 'inverseBindMatrices': append(inverse, 5126, 'MAT4', target=None)}]
doc['scenes'][doc.get('scene', 0)]['nodes'] = [0, bone_nodes['Root']]

# Split only index sets; geometry, UVs, source textures and winding are preserved.
# A rounded inner visor mask replaces baked eyes/mouth with a dark display surface.
centres = pos[indices].mean(axis=1)/h
cx, cy, cz = centres.T
q = np.stack((np.abs(cx)-(.170-.020), np.abs(cy-.832)-(.104-.020)), axis=1)
sdf = np.linalg.norm(np.maximum(q, 0), axis=1)+np.minimum(q.max(axis=1), 0)-.020
texture_index = doc['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']
image_index = doc['textures'][texture_index]['source']
image_view = doc['bufferViews'][doc['images'][image_index]['bufferView']]
image_data = bytes(binary[image_view['byteOffset']:image_view['byteOffset']+image_view['byteLength']])
colors = np.asarray(Image.open(io.BytesIO(image_data)).convert('RGB')) / 255
uv = read(primitive['attributes']['TEXCOORD_0'])[indices].mean(axis=1)
texels = colors[np.clip((uv[:, 1]*(colors.shape[0]-1)).astype(int), 0, colors.shape[0]-1),
                np.clip((uv[:, 0]*(colors.shape[1]-1)).astype(int), 0, colors.shape[1]-1)]
dark_display = (texels.mean(axis=1) < .46) | (texels.max(axis=1)-texels.min(axis=1) > .25)
old_eye = (np.abs(cx) > .028) & (np.abs(cx) < .127) & (cy > .790) & (cy < .870)
old_mouth = (np.abs(cx) < .060) & (cy > .756) & (cy < .820)
visor = (sdf < 0) & (cz > .095) & (dark_display | old_eye | old_mouth)
source_vertex_count = len(pos)
source_triangle_count = len(indices)
source_vertex_accessor = None
if args.variant == 'robo-bonito-temas':
    # A robot's plates are rigid pieces. Duplicate seam vertices per part and
    # bind every triangle wholly to one bone. This retains every source triangle,
    # UV and texture, while preventing any sheet joining differently moving
    # bones from stretching. The cuts are at the mechanical joint bands.
    dominant = joint_ids[np.arange(len(pos)), weights.argmax(axis=1)]
    tri = dominant[indices]
    triangle_bone = np.where(tri[:, 0] == tri[:, 1], tri[:, 0],
                            np.where(tri[:, 0] == tri[:, 2], tri[:, 0], tri[:, 1]))
    pairs = np.stack((indices.ravel(), np.repeat(triangle_bone, 3)), axis=1)
    unique, remap = np.unique(pairs, axis=0, return_inverse=True)
    source_vertex = unique[:, 0]
    indices = remap.reshape(-1, 3)
    pos, normal = pos[source_vertex], normal[source_vertex]
    joint_ids = np.zeros((len(pos), 4), dtype=np.uint16)
    joint_ids[:, 0] = unique[:, 1]
    weights = np.zeros((len(pos), 4), dtype=np.float32)
    weights[:, 0] = 1
    attrs = {name: append(read(index)[source_vertex],
             doc['accessors'][index]['componentType'], doc['accessors'][index]['type'])
             for name, index in primitive['attributes'].items() if name not in ['POSITION', 'NORMAL']}
    attrs.update(POSITION=append(pos, bounds=True), NORMAL=append(normal),
                 JOINTS_0=append(joint_ids, 5123, 'VEC4'), WEIGHTS_0=append(weights, 5126, 'VEC4'))
    source_vertex_accessor = append(source_vertex, 5125, 'SCALAR', target=None)
dominant = joint_ids[np.arange(len(pos)), weights.argmax(axis=1)]
triangle_joints = dominant[indices]
arm_leg_bridges = int(np.count_nonzero(((triangle_joints >= 5) & (triangle_joints <= 10)).any(axis=1)
                                      & (triangle_joints >= 11).any(axis=1)))
if arm_leg_bridges:
    raise ValueError(f'{arm_leg_bridges} triangles bridge arm and leg weights')
screen_material = len(doc['materials'])
doc['materials'].append({'name': 'AnimatedVisorBlack', 'doubleSided': True,
    'pbrMetallicRoughness': {'baseColorFactor': [.002, .006, .012, 1], 'metallicFactor': 0,
                           'roughnessFactor': .40},
    'extensions': {'KHR_materials_specular': {'specularFactor': .12}}})
body_part = {'attributes': attrs, 'indices': append(indices[~visor], 5125, 'SCALAR', 34963), 'material': 0}
visor_part = {'attributes': attrs, 'indices': append(indices[visor], 5125, 'SCALAR', 34963), 'material': screen_material}
doc['meshes'][0]['primitives'] = [body_part, visor_part]
led_material = len(doc['materials'])
doc['materials'].append({'name': 'VisorCyanLED', 'doubleSided': True,
    'pbrMetallicRoughness': {'baseColorFactor': [.015, .42, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 1},
    'emissiveFactor': [.03, .72, 1], 'extensions': {'KHR_materials_unlit': {}}})
doc.setdefault('extensionsUsed', []).append('KHR_materials_unlit')

def face_mesh(name, vertices, faces, center, scale=None):
    vertices = np.asarray(vertices, dtype=np.float32)*h
    center = np.asarray(center)*h
    gx, gy = vertices[:, 0]+center[0], vertices[:, 1]+center[1]
    surface = h*(.160-1.20*(gx/h)**2-.50*(gy/h-.837)**2)
    vertices[:, 2] = surface-center[2]
    normals = np.tile([0, 0, 1], (len(vertices), 1))
    mesh = {'name': name, 'primitives': [{'attributes': {'POSITION': append(vertices, bounds=True),
        'NORMAL': append(normals)}, 'indices': append(faces, 5125, 'SCALAR', 34963), 'material': led_material}]}
    doc['meshes'].append(mesh)
    node = {'name': name, 'mesh': len(doc['meshes'])-1, 'translation': (center-absolute['Head']).tolist()}
    if scale:
        node['scale'] = scale
    index = len(doc['nodes'])
    doc['nodes'].append(node)
    doc['nodes'][bone_nodes['Head']]['children'].append(index)

def arc(name, center, rx, ry, width, angles):
    vertices, faces = [], []
    for angle in np.linspace(*angles, 33):
        for border in [-width/2, width/2]:
            vertices.append([(rx+border)*np.cos(angle), (ry+border)*np.sin(angle), 0])
    for i in range(32):
        a = i*2
        faces.extend([[a, a+1, a+2], [a+1, a+3, a+2]])
    face_mesh(name, vertices, faces, center)

arc('FaceEye_L', [-.074, .844, .160], .050, .031, .009, [.08*np.pi, .92*np.pi])
arc('FaceEye_R', [.074, .844, .160], .050, .031, .009, [.08*np.pi, .92*np.pi])
arc('FaceSmile', [0, .801, .160], .041, .017, .009, [np.pi, 2*np.pi])
verts = [[0, 0, 0]] + [[.037*np.cos(a), .035*np.sin(a), 0] for a in np.linspace(0, 2*np.pi, 33)]
faces = [[0, i+1, i+2] for i in range(32)]
face_mesh('FaceMouth', verts, faces, [0, .797, .160], [1, .01, 1])

for n in doc['nodes']:
    if n.get('children') == []:
        del n['children']
doc['asset'].setdefault('extras', {}).update({
    'sourceHash': hashlib.sha256(raw).hexdigest(), 'rigType': 'mechanical-plate skeleton',
    'facialControls': ['FaceEye_L', 'FaceEye_R', 'FaceSmile', 'FaceMouth'],
    'animationContract': 'Absolute-time pose in HyperFrames; no accumulated bone rotation.',
    'lipSync': 'Audio-envelope opening, not phoneme-aligned human visemes.'})
if source_vertex_accessor is not None:
    doc['asset']['extras'].update(sourceVertexAccessor=source_vertex_accessor,
        articulation='Rigid triangles, vertices duplicated at mechanical seams; no plate blending.')
doc['buffers'][0]['byteLength'] = len(binary)
json_bytes = json.dumps(doc, separators=(',', ':')).encode()
json_bytes += b' ' * ((-len(json_bytes)) % 4)
binary.extend(b'\0' * ((-len(binary)) % 4))
glb = struct.pack('<4sII', b'glTF', 2, 12+8+len(json_bytes)+8+len(binary))
glb += struct.pack('<II', len(json_bytes), 0x4E4F534A)+json_bytes
glb += struct.pack('<II', len(binary), 0x004E4942)+binary
target = out / 'assets/robo-bonito-rigged.glb'
target.write_bytes(glb)
counts = {name: int(np.count_nonzero((joint_ids == index) & (weights > .01)))
          for name, index in lookup.items()}
report = {'source': str(source.relative_to(root)), 'sourceHash': hashlib.sha256(raw).hexdigest(),
    'output': str(target.relative_to(root)), 'bytes': len(glb), 'bodyVertices': len(pos),
    'bodyTriangles': len(indices), 'sourceBodyVertices': source_vertex_count,
    'sourceBodyTriangles': source_triangle_count,
    'sourceVertexAccessor': source_vertex_accessor,
    'visorTriangles': int(visor.sum()), 'bones': len(definition),
    'rigHeight': h, 'pivots': {name: list(point) for name, _, point in definition},
    'weightCoverage': counts, 'weightsNormalized': bool(np.allclose(weights.sum(axis=1), 1)),
    'maxInfluences': int(np.count_nonzero(weights, axis=1).max()), 'armLegBridgeTriangles': arm_leg_bridges,
    'faceControls': ['FaceEye_L', 'FaceEye_R', 'FaceSmile', 'FaceMouth'],
    'limitations': ['Finger joints not separately articulated.', 'Articulation requires visual amplitude QA.']}
(out / 'rig-audit.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps({'file': str(target), 'bones': len(definition), 'visorTriangles': int(visor.sum()), 'coverage': counts}))
