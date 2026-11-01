"""Repeatable isolated benchmark. python3 benchmarks/video_3d/run.py --all"""
import argparse,hashlib,json,os,shutil,subprocess,sys,time,platform
import psutil
from pathlib import Path
from measure import run
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[1]
PROJECT=ROOT/'experiments/remotion-motion-review';CLI=PROJECT/'node_modules/.bin/remotion'
OUTPUTS={'A':'video_A_original.mp4','B':'video_B_threejs_procedural.mp4','C':'video_C_blender.mp4','D':'video_D_hibrido.mp4'}
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def input_signature(engine):
    files=[BASE/'roteiro/storyboard.json',BASE/'roteiro/narracao.m4a',ROOT/'utils/narrative-animation-tracks.js']
    if engine=='A':files+=[BASE/'motores/original/props.json',PROJECT/'package-lock.json',PROJECT/'src/NarrativeEpisodeV2.tsx',PROJECT/'src/NarrativeIllustrationScene.tsx',PROJECT/'src/ApprovedRobotPresenter.tsx']
    else:
        files+=[BASE/'package-lock.json',BASE/'shared/scene.json',BASE/'shared/entry.jsx',BASE/'shared/model.cjs']
        files += [BASE/'motores/threejs/Procedural.jsx'] if engine=='B' else [BASE/'motores/hibrido/Hybrid.jsx',BASE/'motores/hibrido/lock.blender.glb'] if engine=='D' else [BASE/'motores/blender/build.py',BASE/'motores/blender/render.py',BASE/'motores/blender/eclusa.blend']
    manifest={str(p.relative_to(ROOT)):sha(p) for p in files}
    return hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest(),manifest
def link(src,dst):
    dst=Path(dst);dst.parent.mkdir(parents=True,exist_ok=True)
    if dst.exists():
        if sha(src)!=sha(dst):dst.unlink()
        else:return
    os.link(src,dst)
def public(engine):
    p=BASE/'.work'/f'public-{engine}';p.mkdir(parents=True,exist_ok=True)
    link(BASE/'roteiro/narracao.m4a',p/'_runtime/video-3d-benchmark/episode-audio.m4a')
    if engine=='A':link(PROJECT/'public/pulso-story/approved-robot-rigged.glb',p/'pulso-story/approved-robot-rigged.glb')
    if engine=='D':link(BASE/'motores/hibrido/lock.blender.glb',p/'lock.blender.glb')
    if engine=='C':
        for frame in (BASE/'motores/blender/frames').glob('*.png'):link(frame,p/'blender-frames'/frame.name)
    return p
def guarded(command):
    cpus=sorted(os.sched_getaffinity(0))[:6]
    return ['env','PULSO_CONSTRAINED_RENDER=1','nice','-n','10','taskset','-c',','.join(map(str,cpus)),'node',str(BASE/'shared/guard.cjs'),*map(str,command)]
def cli_args(engine,output,frame=None):
    entry=PROJECT/'src/index.ts' if engine=='A' else BASE/'shared/entry.jsx'
    comp='NarrativeEpisode' if engine=='A' else f'Benchmark{engine}'
    cli=CLI if engine=='A' else BASE/'node_modules/.bin/remotion'
    args=[str(cli),'still' if frame is not None else 'render',str(entry),comp,str(output),f'--public-dir={public(engine)}','--gl=angle','--log=info']
    if engine=='A':args.append(f'--props={BASE}/motores/original/props.json')
    if frame is None:args+=['--concurrency=1','--codec=h264','--crf=19','--x264-preset=medium','--image-format=png']
    else:args+=[f'--frame={frame}']
    return args
def blender_build_manifest():
    sources=[BASE/'shared/scene.json',BASE/'shared/frames.json',BASE/'motores/blender/build.py']
    outputs=[BASE/'motores/blender/eclusa.blend',BASE/'motores/hibrido/lock.blender.glb']
    return {'inputs':{str(p.relative_to(BASE)):sha(p) for p in sources},'outputs':{str(p.relative_to(BASE)):sha(p) for p in outputs if p.exists()}}
def ensure_blender_build(force=False):
    marker=BASE/'comparacoes/completed-blender-build.json'
    current=blender_build_manifest()
    if not force and len(current['outputs'])==2 and marker.exists() and json.loads(marker.read_text())==current:return
    run('blender-build',guarded(['blender','--background','--factory-startup','--python',str(BASE/'motores/blender/build.py')]),ROOT,BASE)
    marker.write_text(json.dumps(blender_build_manifest(),indent=2)+'\n')
def native_cache_valid():
    directory=BASE/'motores/blender/frames'
    manifest=directory/'inputs.json'
    files=[BASE/'shared/scene.json',BASE/'shared/frames.json',BASE/'motores/blender/eclusa.blend']
    fingerprint=hashlib.sha256(b''.join(p.read_bytes() for p in files)).hexdigest()
    count=json.loads((BASE/'roteiro/storyboard.json').read_text())['durationInFrames']
    return manifest.exists() and json.loads(manifest.read_text()).get('sha256')==fingerprint and all((directory/f'{f:05}.png').exists() and (directory/f'{f:05}.png').stat().st_size>1000 for f in range(1,count+1))
def render_engine(engine,preview=False):
    output=BASE/'outputs'/OUTPUTS[engine];marker=BASE/'comparacoes'/f'completed-{engine}.json'
    signature,inputs=input_signature(engine)
    if not preview and output.exists() and marker.exists():
        saved=json.loads(marker.read_text())
        if saved['inputSha256']==signature and saved['outputSha256']==sha(output):print(f'{engine}: verified existing output');return
        archive=BASE/'.work'/f'previous-{time.time_ns()}';archive.mkdir();output.rename(archive/output.name);marker.rename(archive/marker.name)
    if engine=='C' and not native_cache_valid():
        native=[1,301,601,901,1201] if preview else []
        command=['blender','--background','--factory-startup',str(BASE/'motores/blender/eclusa.blend'),'--python',str(BASE/'motores/blender/render.py')]
        if native:command+=['--',','.join(map(str,native))]
        cached=len(list((BASE/'motores/blender/frames').glob('*.png')))
        native_metrics=run('C-native-preview' if preview else 'C-native',guarded(command),ROOT,BASE)
        native_metrics['cachedNativeFramesBefore']=cached
        native_metrics['nativeFramesAfter']=len(list((BASE/'motores/blender/frames').glob('*.png')))
        (BASE/'comparacoes'/('measure-C-native-preview.json' if preview else 'measure-C-native.json')).write_text(json.dumps(native_metrics,indent=2)+'\n')
    if preview:
        frame=900
        run(f'{engine}-preview',guarded(cli_args(engine,BASE/f'comparacoes/frames/{engine}-preview.png',frame)),ROOT,BASE);return
    intermediate=BASE/'.work'/f'{engine}-render.mp4'
    staging_start=time.time();args=cli_args(engine,intermediate)
    (BASE/f'comparacoes/measure-{engine}-staging.json').write_text(json.dumps({'startedAtEpoch':staging_start,'seconds':time.time()-staging_start,'method':'validate/hardlink only required public assets and form renderer arguments'},indent=2)+'\n')
    run(f'{engine}-render',guarded(args),ROOT,BASE)
    # The same pre-encoded audio packets are muxed unchanged into all versions.
    duration=str(json.loads((BASE/'roteiro/storyboard.json').read_text())['durationSeconds'])
    run(f'{engine}-mux',['ffmpeg','-y','-v','error','-i',str(intermediate),'-i',str(BASE/'roteiro/narracao.m4a'),'-map','0:v:0','-map','1:a:0','-c','copy','-t',duration,'-movflags','+faststart',str(output)],ROOT,BASE)
    marker.write_text(json.dumps({'inputSha256':signature,'inputFiles':inputs,'outputSha256':sha(output),'narrationSha256':sha(BASE/'roteiro/narracao.m4a')},indent=2)+'\n')
def main():
    p=argparse.ArgumentParser();p.add_argument('--all',action='store_true');p.add_argument('--engine',choices=list(OUTPUTS));p.add_argument('--preview',action='store_true');p.add_argument('--prepare',action='store_true');a=p.parse_args()
    for tool in ['node','ffmpeg','ffprobe','blender','taskset']:
        if not shutil.which(tool):raise RuntimeError('Missing dependency '+tool)
    environment={'recordedAtEpoch':time.time(),'cpuLogical':psutil.cpu_count(),'cpuPhysical':psutil.cpu_count(logical=False),'cpuAffinity':sorted(os.sched_getaffinity(0)),'memoryTotalBytes':psutil.virtual_memory().total,'memoryAvailableBytes':psutil.virtual_memory().available,'diskFreeBytes':shutil.disk_usage(BASE).free,'python':platform.python_version(),'gpu':[{'device':str(p.parent),'vramTotalBytes':int(p.read_text())} for p in Path('/sys/class/drm').glob('card*/device/mem_info_vram_total')]}
    (BASE/'comparacoes').mkdir(exist_ok=True)
    (BASE/'comparacoes/environment-latest.json').write_text(json.dumps(environment,indent=2)+'\n')
    if environment['diskFreeBytes']<2*1024**3:raise RuntimeError('Less than 2 GiB disk free; preserve files and free space before rendering')
    if (BASE/'node_modules').is_symlink():raise RuntimeError('Benchmark dependencies must be isolated; refusing to install through a symlink')
    if not (BASE/'node_modules/.bin/remotion').exists():subprocess.run(['npm','ci','--ignore-scripts','--no-audit','--no-fund'],cwd=BASE,check=True)
    audio_existed=(BASE/'roteiro/narracao-original.mp3').exists()
    prepare_metrics=run('shared-prepare',['node',str(BASE/'prepare.cjs')],ROOT,BASE)
    prepare_metrics['initialNarrationAlreadyExisted']=audio_existed
    (BASE/'comparacoes/measure-shared-prepare.json').write_text(json.dumps(prepare_metrics,indent=2)+'\n')
    ensure_blender_build(a.prepare)
    engines=list(OUTPUTS) if a.all else [a.engine] if a.engine else []
    for e in engines:render_engine(e,a.preview)
    if a.all and not a.preview:subprocess.run([sys.executable,str(BASE/'validate.py')],cwd=ROOT,check=True)
if __name__=='__main__':main()
