#!/usr/bin/env python3
"""Inspect embedded generated GLBs without modifying geometry or materials."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import numpy as np

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('glb', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
raw = args.glb.read_bytes()
magic, version, length = struct.unpack_from('<4sII', raw)
if magic != b'glTF' or version != 2 or length != len(raw):
    raise ValueError('Invalid GLB header')
offset, document, binary = 12, None, None
while offset < len(raw):
    size, kind = struct.unpack_from('<II', raw, offset)
    chunk = raw[offset + 8:offset + 8 + size]
    if len(chunk) != size:
        raise ValueError('Truncated GLB chunk')
    if kind == 0x4E4F534A:
        document = json.loads(chunk)
    elif kind == 0x004E4942:
        binary = chunk
    offset += 8 + size
if document is None or binary is None:
    raise ValueError('Missing JSON or binary chunk')

dtypes = {5120: 'i1', 5121: 'u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
widths = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def accessor(index):
    a = document['accessors'][index]
    if 'sparse' in a:
        raise ValueError('Sparse accessor needs a separate inspector')
    view = document['bufferViews'][a['bufferView']]
    if view.get('buffer', 0) != 0:
        raise ValueError('Unsupported external buffer')
    dtype, width = np.dtype(dtypes[a['componentType']]), widths[a['type']]
    stride = view.get('byteStride', dtype.itemsize * width)
    start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    end = start + (a['count'] - 1) * stride + dtype.itemsize * width
    if end > view.get('byteOffset', 0) + view['byteLength'] or end > len(binary):
        raise ValueError('Accessor outside buffer view')
    return np.ndarray((a['count'], width), dtype=dtype, buffer=binary,
                      offset=start, strides=(stride, dtype.itemsize))

report = {
    'valid_glb_header': True, 'bytes': len(raw),
    'sha256': hashlib.sha256(raw).hexdigest(),
    'meshes': len(document.get('meshes', [])),
    'skins': len(document.get('skins', [])),
    'animations': len(document.get('animations', [])),
    'materials': len(document.get('materials', [])),
    'images': len(document.get('images', [])),
    'external_uris': [item['uri'] for section in ('buffers', 'images')
                      for item in document.get(section, [])
                      if 'uri' in item and not item['uri'].startswith('data:')],
    'primitives': [],
    'limitations': ['No self-intersection or deformation certification; no rig animation performed.']
}
for mesh in document.get('meshes', []):
    for primitive in mesh['primitives']:
        if primitive.get('mode', 4) != 4:
            raise ValueError('Expected triangle primitive')
        pos = accessor(primitive['attributes']['POSITION'])
        indices = accessor(primitive['indices']).reshape(-1) if 'indices' in primitive else np.arange(len(pos))
        faces = indices.reshape(-1, 3)
        invalid = int(np.count_nonzero(indices >= len(pos)))
        entry = {'positions': len(pos), 'triangles': len(faces),
                 'attributes': sorted(primitive['attributes']),
                 'nonfinite_positions': int(np.count_nonzero(~np.isfinite(pos))),
                 'invalid_indices': invalid,
                 'bounds_min': pos.min(axis=0).tolist(), 'bounds_max': pos.max(axis=0).tolist(),
                 'repeated_index_triangles': int(np.count_nonzero(
                     (faces[:, 0] == faces[:, 1]) | (faces[:, 1] == faces[:, 2]) | (faces[:, 0] == faces[:, 2])))}
        if not invalid and not entry['nonfinite_positions']:
            xyz = pos[faces].astype(np.float64)
            area2 = np.linalg.norm(np.cross(xyz[:, 1] - xyz[:, 0], xyz[:, 2] - xyz[:, 0]), axis=1)
            entry['zero_area_triangles'] = int(np.count_nonzero(area2 == 0))
            entry['duplicate_index_triangles'] = len(faces) - len(np.unique(np.sort(faces, axis=1), axis=0))
        for attr in ('NORMAL', 'TEXCOORD_0'):
            if attr in primitive['attributes']:
                entry['nonfinite_' + attr.lower()] = int(np.count_nonzero(~np.isfinite(accessor(primitive['attributes'][attr]))))
        report['primitives'].append(entry)
report['embedded_assets'] = not report['external_uris']
args.output.write_text(json.dumps(report, indent=2) + '\n')
if any(p['invalid_indices'] or p['nonfinite_positions'] for p in report['primitives']):
    raise SystemExit('Invalid geometry; see report')
print(json.dumps({k: report[k] for k in ('bytes', 'meshes', 'skins', 'animations', 'embedded_assets')}))
