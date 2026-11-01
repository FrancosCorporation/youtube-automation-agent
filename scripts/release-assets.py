#!/usr/bin/env python3
"""Pack/restore the public creative assets separately from runtime/account data."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

ROOTS = ('assets/brand', 'experiments/hyperframes-pulso-pilot/assets',
         'experiments/hyperframes-pulso-pilot/variants',
         'experiments/remotion-motion-review/public', 'data/assets/sfx')
EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.svg', '.glb', '.fbx', '.blend',
              '.m4a', '.mp3', '.wav', '.ogg', '.woff', '.woff2', '.ttf', '.otf'}


def allowed(name):
    path = PurePosixPath(name)
    return (not path.is_absolute() and '..' not in path.parts
            and '_runtime' not in path.parts
            and any(name.startswith(prefix + '/') for prefix in ROOTS)
            and path.suffix.lower() in EXTENSIONS)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def pack(root, archive):
    records, seen = [], set()
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=3) as bundle:
        for prefix in ROOTS:
            for path in sorted((root / prefix).rglob('*')):
                if not path.is_file() or path.is_symlink():
                    continue
                name = path.relative_to(root).as_posix()
                if not allowed(name):
                    continue
                data = path.read_bytes()
                sha = digest(data)
                records.append({'path': name, 'sha256': sha, 'bytes': len(data)})
                if sha not in seen:
                    bundle.writestr('blobs/' + sha, data)
                    seen.add(sha)
        bundle.writestr('manifest.json', json.dumps({'schemaVersion': 1, 'assets': records}, indent=2))
    print(json.dumps({'files': len(records), 'uniqueBlobs': len(seen), 'archive': str(archive)}))


def restore(root, archive):
    restored = 0
    with zipfile.ZipFile(archive) as bundle:
        manifest = json.loads(bundle.read('manifest.json'))
        if manifest.get('schemaVersion') != 1:
            raise ValueError('Unsupported asset manifest')
        # Validate all entries before writing; refuse to overwrite different local work.
        for entry in manifest['assets']:
            name, sha = entry['path'], entry['sha256']
            if not allowed(name) or len(sha) != 64 or any(c not in '0123456789abcdef' for c in sha):
                raise ValueError('Invalid asset path/hash')
            target = root / name
            if not target.resolve().is_relative_to(root):
                raise ValueError('Asset escapes restore root')
            data = bundle.read('blobs/' + sha)
            if digest(data) != sha or len(data) != entry['bytes']:
                raise ValueError('Asset integrity mismatch: ' + name)
            if target.exists() and (not target.is_file() or digest(target.read_bytes()) != sha):
                raise ValueError('Preserving different local asset: ' + name)
        for entry in manifest['assets']:
            target = root / entry['path']
            if target.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(bundle.read('blobs/' + entry['sha256']))
            restored += 1
    print(json.dumps({'restored': restored, 'verified': len(manifest['assets'])}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['pack', 'restore'])
    parser.add_argument('archive', type=Path)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    globals()[args.action](args.root.resolve(), args.archive.resolve())
