#!/usr/bin/env python3
"""Verify the serialized candidate's skin, binds and source geometry/assets."""
import json
from pathlib import Path
import struct
import argparse
import numpy as np

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--variant', default='robo-bonito-animado', choices=['robo-bonito-animado', 'robo-bonito-temas'])
variant = root/'variants'/parser.parse_args().variant

def load(path):
    b = path.read_bytes()
    size = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20+size]), b[28+size:]

def array(d, b, index):
    a = d['accessors'][index]
    v = d['bufferViews'][a['bufferView']]
    dt = np.dtype({5126: '<f4', 5125: '<u4', 5123: '<u2'}[a['componentType']])
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    return np.ndarray((a['count'], width), dtype=dt, buffer=b,
        offset=v.get('byteOffset', 0)+a.get('byteOffset', 0),
        strides=(v.get('byteStride', width*dt.itemsize), dt.itemsize))

old, old_bin = load(root/'variants/robo-bonito/assets/robo-bonito-hunyuan.glb')
d, b = load(variant/'assets/robo-bonito-rigged.glb')
primitive = d['meshes'][0]['primitives'][0]
weights = array(d, b, primitive['attributes']['WEIGHTS_0'])
joints = array(d, b, primitive['attributes']['JOINTS_0'])
skin = d['skins'][0]
assert np.isfinite(weights).all() and np.allclose(weights.sum(axis=1), 1)
assert (joints < len(skin['joints'])).all()
parents = {child: i for i, n in enumerate(d['nodes']) for child in n.get('children', [])}
cache = {}

def world(index):
    if index in cache:
        return cache[index]
    n = d['nodes'][index]
    assert 'rotation' not in n and 'scale' not in n, 'Joint TRS contract changed'
    m = np.eye(4)
    m[:3, 3] = n.get('translation', [0, 0, 0])
    if index in parents:
        m = world(parents[index]) @ m
    cache[index] = m
    return m

ibm = array(d, b, skin['inverseBindMatrices'])
bind_error = max(float(np.abs(world(i) @ matrix.reshape(4, 4, order='F')-np.eye(4)).max())
                 for i, matrix in zip(skin['joints'], ibm))
assert bind_error < 1e-6
old_primitive = old['meshes'][0]['primitives'][0]
source_pos = array(old, old_bin, old_primitive['attributes']['POSITION'])
expected = np.stack([source_pos[:, 0], -source_pos[:, 2], source_pos[:, 1]], axis=1)
mapping_index = d['asset'].get('extras', {}).get('sourceVertexAccessor')
mapping = array(d, b, mapping_index).ravel() if mapping_index is not None else np.arange(len(expected))
source_preserved = np.array_equal(expected[mapping], array(d, b, primitive['attributes']['POSITION']))
uv_preserved = np.array_equal(array(old, old_bin, old_primitive['attributes']['TEXCOORD_0'])[mapping],
                              array(d, b, primitive['attributes']['TEXCOORD_0']))
def canonical(faces):
    return faces[np.lexsort((faces[:, 2], faces[:, 1], faces[:, 0]))]
source_faces = array(old, old_bin, old_primitive['indices']).reshape(-1, 3)
new_faces = np.concatenate([array(d, b, p['indices']).reshape(-1, 3) for p in d['meshes'][0]['primitives']])
faces_preserved = np.array_equal(canonical(source_faces), canonical(mapping[new_faces]))
rigid_triangles = bool((joints[new_faces, 0] == joints[new_faces[:, :1], 0]).all()) and bool((weights[:, 0] == 1).all())
if mapping_index is not None:
    assert rigid_triangles, 'A rigid plate triangle crosses bones'
def images(doc, binary):
    result = []
    for image in doc['images']:
        view = doc['bufferViews'][image['bufferView']]
        result.append(binary[view['byteOffset']:view['byteOffset']+view['byteLength']])
    return result
textures_preserved = images(old, old_bin) == images(d, b)
rig = json.loads((variant/'rig-audit.json').read_text())
assert source_preserved and uv_preserved and faces_preserved and textures_preserved
assert rig['armLegBridgeTriangles'] == 0
report = {'skins': len(d['skins']), 'joints': len(skin['joints']), 'weightsNormalized': True,
          'jointIndicesValid': True, 'inverseBindRestMaxError': bind_error,
          'sourcePositionsPreservedAfterYUpRotation': source_preserved,
          'sourceUVsPreserved': uv_preserved, 'sourceTriangleWindingPreserved': faces_preserved,
          'embeddedTexturesByteIdentical': textures_preserved,
          'sourceVerticesCovered': int(len(np.unique(mapping))),
          'sourceTrianglesCovered': len(new_faces),
          'everyBodyTriangleRigidToOneBone': rigid_triangles,
          'armLegBridgeTriangles': rig['armLegBridgeTriangles'],
          'facialNodes': [n['name'] for n in d['nodes'] if n.get('name', '').startswith('Face')],
          'limits': ['Finger phalanges not independently rigged.', 'Self-intersections require visual inspection.']}
(variant/'serialized-rig-audit.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report))
