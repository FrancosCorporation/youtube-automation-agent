"""Package reproducible media assets without caches, private data or duplicate MP4s."""
import hashlib,json,zipfile
from pathlib import Path
BASE=Path(__file__).resolve().parent
out=BASE/'.work/video-3d-assets-v2.14.0.zip'
files=list((BASE/'roteiro').glob('*.wav'))+list((BASE/'roteiro').glob('*.mp3'))+list((BASE/'roteiro').glob('*.m4a'))
files += [BASE/'motores/blender/eclusa.blend',BASE/'motores/hibrido/lock.blender.glb',BASE/'comparacoes/comparativo.png']
files += list((BASE/'comparacoes/frames').glob('*.png'))
manifest={str(p.relative_to(BASE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=3) as z:
    for p in files:z.write(p,p.relative_to(BASE))
    z.writestr('assets-manifest.json',json.dumps(manifest,indent=2)+'\n')
with zipfile.ZipFile(out) as z:
    for name,digest in manifest.items():assert hashlib.sha256(z.read(name)).hexdigest()==digest,name
assets=[*sorted((BASE/'outputs').glob('*.mp4')),out,BASE/'RELATORIO_FINAL.md',BASE/'comparacoes/comparativo.png']
(BASE/'.work/SHA256SUMS-video-3d-v2.14.0.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in assets))
print(json.dumps({'zip':str(out),'files':len(files),'bytes':out.stat().st_size,'verified':True}))
