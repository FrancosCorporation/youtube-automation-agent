#!/usr/bin/env python3
"""Preserve the narrated pilot, human models and the verified review evidence."""
import hashlib
import json
import zipfile
from pathlib import Path

DEMO = Path(__file__).resolve().parent
ROOT = DEMO.parents[2]
BENCHMARK = DEMO.parent
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
WORK = BENCHMARK / '.work'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    videos = [BENCHMARK / 'outputs/parcel_delivery.mp4', BENCHMARK / 'outputs/parcel_delivery_vertical.mp4']
    for layout, video in zip(['landscape', 'portrait'], videos):
        report = json.loads((DEMO / 'reports' / layout / 'render-qa.json').read_text())
        if report['status'] != 'passed' or report['sha256'] != sha(video):
            raise SystemExit('QA ou SHA divergente: ' + layout)
        if report['checks']['visualReview']['status'] != 'inspected':
            raise SystemExit('Revisão visual específica pendente: ' + layout)
    if not json.loads((DEMO / 'reports/seek-pixels.json').read_text())['passed']:
        raise SystemExit('QA de seeks pendente ou falhou')
    files = [DEMO / name for name in ['narracao-original.mp3', 'narracao.wav', 'narracao.m4a', 'narracao.txt', 'palavras.json', 'audio-envelope.json', 'models-provenance.json', 'fontes.md', 'review-contact-sheet.png', 'review-contact-sheet-portrait.png']]
    files += sorted((DEMO / 'models').glob('*.glb')) + sorted((DEMO / 'reports').rglob('*.json')) + sorted((DEMO / 'reports').rglob('*.png')) + sorted((DEMO / 'review_frames').rglob('*.png'))
    files.append(ROOT / 'experiments/remotion-motion-review/public/pulso-story/approved-robot-rigged.glb')
    manifest = {str(file.relative_to(ROOT)): sha(file) for file in files}
    WORK.mkdir(parents=True, exist_ok=True)
    archive = WORK / ('parcel-assets-v' + VERSION + '.zip')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=5) as bundle:
        for file in files:
            bundle.write(file, file.relative_to(ROOT))
        bundle.writestr('assets-manifest.json', json.dumps(manifest, indent=2) + '\n')
    with zipfile.ZipFile(archive) as bundle:
        for name, digest in manifest.items():
            if hashlib.sha256(bundle.read(name)).hexdigest() != digest:
                raise SystemExit('ZIP divergente: ' + name)
    assets = videos + [archive, DEMO / 'review-contact-sheet.png', DEMO / 'review-contact-sheet-portrait.png']
    checksum = WORK / ('SHA256SUMS-parcel-v' + VERSION + '.txt')
    checksum.write_text(''.join(sha(file) + '  ' + file.name + '\n' for file in assets))
    print(json.dumps({'archive': str(archive.relative_to(ROOT)), 'bytes': archive.stat().st_size, 'files': len(files), 'manifestVerified': True, 'checksums': str(checksum.relative_to(ROOT))}))


if __name__ == '__main__':
    main()
