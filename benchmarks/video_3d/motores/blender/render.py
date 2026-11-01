import bpy,sys,json,hashlib,time
from pathlib import Path
BASE=Path(__file__).resolve().parents[2]
scene=bpy.context.scene
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
frames=[int(v) for v in args[0].split(',')] if args else range(1,scene.frame_end+1)
directory=BASE/'motores/blender/frames';directory.mkdir(exist_ok=True)
fingerprint=hashlib.sha256((BASE/'shared/scene.json').read_bytes()+(BASE/'shared/frames.json').read_bytes()+(BASE/'motores/blender/eclusa.blend').read_bytes()).hexdigest()
manifest=directory/'inputs.json'
if list(directory.glob('*.png')) and (not manifest.exists() or json.loads(manifest.read_text())['sha256']!=fingerprint):
    directory.rename(directory.with_name('previous-frames-'+str(time.time_ns())));directory.mkdir()
manifest.write_text(json.dumps({'sha256':fingerprint})+'\n')
for f in frames:
    output=directory/f'{f:05}.png'
    if output.exists():continue
    scene.frame_set(f);scene.render.filepath=str(output);bpy.ops.render.render(write_still=True)
    if not output.exists() or output.stat().st_size<1000:raise RuntimeError(f'Invalid frame {f}')
print('BLENDER_FRAMES_COMPLETE',len(list(directory.glob('*.png'))),flush=True)
