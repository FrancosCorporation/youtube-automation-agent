"""Recoverable demo assets; explicit allowlist excludes browser profiles and caches."""
from pathlib import Path
import hashlib
import zipfile

demo = Path(__file__).resolve().parent
benchmark = demo.parent
root = benchmark.parent.parent
output = benchmark / 'outputs/reforestation_assets_v217.zip'
files = []
for name in ['README.md', 'characters.json', 'models-provenance.json', 'narracao.txt',
             'storyboard.json', 'audio-envelope.json', 'words.json', 'voice.mp3',
             'Scene.jsx', 'index.jsx', 'motion.cjs', 'prepare.cjs', 'render.cjs',
             'seek-check.cjs', 'package-assets.py']:
    files.append(demo / name)
files.extend(p for p in (demo / 'public').rglob('*') if p.is_file())
files.extend(p for p in (demo / 'reports').glob('*')
             if p.name.startswith(('landscape-', 'portrait-', 'seek-', 'media-'))
             and p.suffix in ['.json', '.png'])
files.extend(benchmark / 'shared' / name for name in ['AssetHuman.jsx', 'build-human-library.mjs'])
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(set(files)):
        archive.write(file, str(file.relative_to(root)))
    archive.writestr('CONTENTS-SHA256.txt', ''.join(
        hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + str(p.relative_to(root)) + '\n'
        for p in sorted(set(files))))
targets = [output, benchmark / 'outputs/reforestation_humans.mp4',
           benchmark / 'outputs/reforestation_humans_vertical.mp4']
(benchmark / 'outputs/reforestation-SHA256SUMS.txt').write_text(''.join(
    hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n' for p in targets))
print(f'{output}: {output.stat().st_size} bytes; {len(files)} assets')
