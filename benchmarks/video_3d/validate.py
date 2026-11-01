"""Decode, inspect media contracts, compare exact audio and produce real comparison artifacts."""
import hashlib,json,re,subprocess,time
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageChops
BASE=Path(__file__).resolve().parent
NAMES={'A':'video_A_original.mp4','B':'video_B_threejs_procedural.mp4','C':'video_C_blender.mp4','D':'video_D_hibrido.mp4'}
LABELS={'A':'A · Original do projeto','B':'B · Three.js procedural','C':'C · Blender nativo','D':'D · Blender + GLB + Three.js'}
BOARD=json.loads((BASE/'roteiro/storyboard.json').read_text())
def cmd(args):return subprocess.run(list(map(str,args)),check=True,capture_output=True,text=True)
def probe(p):return json.loads(cmd(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',p]).stdout)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def audio_hash(p):return cmd(['ffmpeg','-v','error','-i',p,'-map','0:a:0','-c:a','pcm_s16le','-ar','48000','-ac','2','-f','hash','-hash','sha256','-']).stdout.strip()
def frame(p,t,out):cmd(['ffmpeg','-y','-v','error','-ss',str(t),'-i',p,'-frames:v','1','-threads','1',out])
def geometry_pixels(path):
    # Mint gate/bank geometry in the illustration area; excludes titles, captions and presenter.
    r,g,b=Image.open(path).convert('RGB').crop((180,330,1500,800)).split()
    gr=ImageChops.subtract(g,r).point(lambda v:255 if v>5 else 0)
    gb=ImageChops.subtract(g,b).point(lambda v:255 if v>5 else 0)
    light=g.point(lambda v:255 if v>85 else 0)
    return ImageChops.multiply(ImageChops.multiply(gr,gb),light).histogram()[255]
def main():
    results={};reference_audio=audio_hash(BASE/'roteiro/narracao.m4a')
    timestamps=[3,11,16,23,29,36,44]
    for engine,name in NAMES.items():
        validation_start=time.time()
        p=BASE/'outputs'/name;info=probe(p);video=next(s for s in info['streams'] if s['codec_type']=='video');audio=next(s for s in info['streams'] if s['codec_type']=='audio')
        assert (video['width'],video['height'])==(1920,1080),name
        assert video['avg_frame_rate']=='30/1',name
        assert int(video['nb_read_frames'])==BOARD['durationInFrames'],name
        assert abs(float(info['format']['duration'])-BOARD['durationSeconds'])<.08,name
        decoded=cmd(['ffmpeg','-v','error','-threads','2','-i',p,'-f','null','-']);assert not decoded.stderr.strip(),decoded.stderr
        digest=audio_hash(p);assert digest==reference_audio,f'{name}: audio differs'
        events=cmd(['ffmpeg','-hide_banner','-threads','2','-i',p,'-vf','blackdetect=d=0.10:pix_th=0.03:pic_th=0.98,freezedetect=n=-60dB:d=2','-an','-f','null','-']).stderr
        anomalies=[l for l in events.splitlines() if 'black_start:' in l or 'freeze_start:' in l or 'freeze_duration:' in l]
        (BASE/'logs'/f'{engine}-integrity.log').write_text(events)
        presence={}
        for t in timestamps:
            path=BASE/f'comparacoes/frames/{engine}-{t:02}.png';frame(p,t,path)
            presence[str(t)]=geometry_pixels(path)
            assert presence[str(t)]>500,f'{name}: expected visible scene geometry at {t}s, found {presence[str(t)]} mint pixels'
        validation_seconds=time.time()-validation_start
        (BASE/f'comparacoes/measure-{engine}-validation.json').write_text(json.dumps({'startedAtEpoch':validation_start,'wallSeconds':validation_seconds,'completedAtEpoch':time.time(),'geometryPixels':presence},indent=2)+'\n')
        m=json.loads((BASE/f'comparacoes/measure-{engine}-render.json').read_text())
        native=json.loads((BASE/'comparacoes/measure-C-native.json').read_text()) if engine=='C' else None
        render_seconds=m['renderWallSeconds']+(native['renderWallSeconds'] if native else 0)
        prior=list((BASE/'comparacoes').glob(f'measure-{engine}-render-attempt-*.json'))
        failures=sum(d.get('exitCode',0)!=0 and not d.get('cancelledBeforeRender',False) for x in prior for d in [json.loads(x.read_text())])
        prep_path=BASE/'comparacoes/measure-shared-prepare.json'
        prep=json.loads(prep_path.read_text()) if prep_path.exists() else {}
        build=json.loads((BASE/'comparacoes/measure-blender-build.json').read_text()) if engine in 'CD' else {}
        mux=json.loads((BASE/f'comparacoes/measure-{engine}-mux.json').read_text())
        staging_path=BASE/f'comparacoes/measure-{engine}-staging.json'
        staging_seconds=json.loads(staging_path.read_text())['seconds'] if staging_path.exists() else None
        create_seconds=prep.get('renderWallSeconds',0)+build.get('renderWallSeconds',0)+(staging_seconds or 0)
        mux_seconds=mux['renderWallSeconds']
        wait_seconds=sum(x.get('resourceWaitSeconds',0) for x in [m,native or {},build,mux,prep])
        timing={'creationSeconds':create_seconds,'assetStagingSeconds':staging_seconds,'sharedPreparationSeconds':prep.get('renderWallSeconds'),'blenderModelCreationSeconds':build.get('renderWallSeconds',0),'nativeRenderSeconds':(native or {}).get('renderWallSeconds',0),'remotionRenderSeconds':m['renderWallSeconds'],'muxSeconds':mux_seconds,'validationSeconds':validation_seconds,'readyFromFrozenNarrationSeconds':create_seconds+render_seconds+mux_seconds+validation_seconds,'resourceWaitSeconds':wait_seconds,'readyIncludingRecordedWaitSeconds':create_seconds+render_seconds+mux_seconds+validation_seconds+wait_seconds,'initialNarrationGenerationSeconds':None,'developmentAndManualReviewSeconds':None,'scope':'Automated processing from the single frozen script/audio; includes creation, render, mux and full integrity verification. Initial one-time TTS and human/agent implementation were not timed; not a complete initial-creation total.'}
        if (BASE/'comparacoes/narration-generation.json').exists():timing['initialNarrationGenerationSeconds']=json.loads((BASE/'comparacoes/narration-generation.json').read_text())['seconds']
        results[engine]={'path':str(p),'sha256':sha(p),'audioDecodedHash':digest,'audioEqualsCanonical':True,'width':video['width'],'height':video['height'],'fps':video['avg_frame_rate'],'frames':int(video['nb_read_frames']),'durationSeconds':float(info['format']['duration']),'videoCodec':video['codec_name'],'pixelFormat':video['pix_fmt'],'audioCodec':audio['codec_name'],'sizeBytes':p.stat().st_size,'renderSeconds':render_seconds,'renderFps':BOARD['durationInFrames']/render_seconds,'peakTreeRssBytes':max(m['peakTreeRssBytes'],native['peakTreeRssBytes'] if native else 0),'gpuDevicePeakUsedBytes':max(m.get('gpuDevicePeakUsedBytes') or 0,(native or {}).get('gpuDevicePeakUsedBytes') or 0),'vramExclusiveBytes':None,'renderFailures':failures,'automatedAnomalies':anomalies,'fullDecodePassed':True,'qualitativeScores':None,'timing':timing,'geometryPixels':presence}
        (BASE/f'comparacoes/validated-{engine}.json').write_text(json.dumps(results[engine],indent=2)+'\n')
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',21)
    small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17)
    sheet=Image.new('RGB',(1920,7*310+70),'#081923');draw=ImageDraw.Draw(sheet)
    draw.text((24,15),'ECLUSA · MESMA NARRAÇÃO, MESMOS INSTANTES · 4 MOTORES',font=font,fill='#f3eee0')
    for col,(e,label) in enumerate(LABELS.items()):
        for row,t in enumerate(timestamps):
            im=Image.open(BASE/f'comparacoes/frames/{e}-{t:02}.png').convert('RGB');im.thumbnail((480,270));x=col*480;y=70+row*310
            sheet.paste(im,(x,y+30));draw.text((x+10,y+4),f'{label} | {t:02}s',font=small,fill='#95d7bc')
    sheet.save(BASE/'comparacoes/comparativo.png')
    inputs=[]
    for name in NAMES.values():inputs+=['-i',str(BASE/'outputs'/name)]
    labels=['A - ORIGINAL','B - THREE.JS PROCEDURAL','C - BLENDER NATIVO','D - HIBRIDO BLENDER + THREE.JS']
    filters=[]
    for i,label in enumerate(labels):filters.append(f'[{i}:v]scale=960:540,setsar=1,drawbox=x=0:y=0:w=iw:h=34:color=0x081923@0.94:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text=\'{label}\':x=14:y=5:fontsize=21:fontcolor=0xf3eee0[v{i}]')
    filters.append('[v0][v1][v2][v3]xstack=inputs=4:layout=0_0|960_0|0_540|960_540[out]')
    comparison_start=time.time()
    comparison=BASE/'outputs/comparativo_4_motores.mp4'
    cmd(['ffmpeg','-y','-v','error',*inputs,'-filter_complex_threads','2','-filter_complex',';'.join(filters),'-map','[out]','-map','0:a:0','-c:v','libx264','-crf','19','-preset','medium','-pix_fmt','yuv420p','-threads','4','-c:a','copy','-movflags','+faststart',comparison])
    cp=probe(comparison);assert audio_hash(comparison)==reference_audio
    cv=next(s for s in cp['streams'] if s['codec_type']=='video')
    assert (cv['width'],cv['height'],cv['avg_frame_rate'],int(cv['nb_read_frames']))==(1920,1080,'30/1',BOARD['durationInFrames'])
    assert abs(float(cp['format']['duration'])-BOARD['durationSeconds'])<.08
    cmd(['ffmpeg','-v','error','-threads','2','-i',comparison,'-f','null','-'])
    report={'createdAtEpoch':time.time(),'narrationSha256':BOARD['audioSha256'],'scriptSha256':BOARD['scriptSha256'],'timestampsSeconds':timestamps,'methods':{'renderTime':'includes bundling/render/encoding; C includes native Blender frame render and Remotion assembly; excludes resource waits, TTS and model preparation','ram':'500 ms sampled sum of RSS across process tree, shared pages may be counted more than once','vram':'whole AMD device, includes other workloads; exclusive VRAM unavailable','scores':'subjective assessment recorded separately after visual inspection'},'engines':results,'comparison':{'creationAndValidationSeconds':time.time()-comparison_start,'path':str(comparison),'sha256':sha(comparison),'audioEqualsCanonical':True,'probe':cp},'contactSheet':str(BASE/'comparacoes/comparativo.png')}
    (BASE/'comparacoes/metricas.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    subprocess.run(['python3',str(BASE/'report.py')],check=True)
    print(json.dumps({'validated':list(results),'comparison':str(comparison),'anomalies':{e:r['automatedAnomalies'] for e,r in results.items()}},ensure_ascii=False))
if __name__=='__main__':main()
