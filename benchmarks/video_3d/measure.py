"""Measure a command's process tree; GPU sysfs readings are explicitly host totals."""
import argparse,json,os,subprocess,time,datetime,re
from pathlib import Path
import psutil

def run(name,command,cwd,base):
    logs=base/'logs';logs.mkdir(exist_ok=True)
    report=base/'comparacoes'/f'measure-{name}.json'
    if report.exists():
        old=json.loads(report.read_text())
        archive=report.with_name(report.stem+f'-attempt-{time.time_ns()}.json')
        archive.write_text(json.dumps(old,indent=2))
        old_log=logs/f'{name}.log'
        if old_log.exists():old_log.rename(logs/f'{name}-{time.time_ns()}.log')
    started=time.time();peak=0;peak_gpu=None;samples=0
    gpu_paths=list(Path('/sys/class/drm').glob('card*/device/mem_info_vram_used'))
    with (logs/f'{name}.log').open('w') as log:
        child=subprocess.Popen(command,cwd=cwd,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        while child.poll() is None:
            rss=0
            try:
                parent=psutil.Process(child.pid)
                for p in [parent,*parent.children(recursive=True)]:
                    try:rss+=p.memory_info().rss
                    except (psutil.NoSuchProcess,psutil.AccessDenied):pass
            except psutil.NoSuchProcess:pass
            peak=max(peak,rss)
            for p in gpu_paths:
                try:peak_gpu=max(peak_gpu or 0,int(p.read_text()))
                except OSError:pass
            samples+=1;time.sleep(.5)
        result={'name':name,'command':command,'startedAtEpoch':started,'wallSecondsIncludingWait':time.time()-started,'exitCode':child.returncode,'peakTreeRssBytes':peak,'rssMethod':'sum of RSS across live process tree; shared pages can be counted more than once; 500 ms sampling','gpuDevicePeakUsedBytes':peak_gpu,'gpuAttribution':'whole device, includes other processes; not renderer-exclusive','samples':samples,'sampleIntervalMs':500}
    markers=re.findall(r'BENCHMARK_RENDER_START (\S+)',(logs/f'{name}.log').read_text(errors='replace'))
    if markers:
        render_start=datetime.datetime.fromisoformat(markers[-1].replace('Z','+00:00')).timestamp()
        result['renderWallSeconds']=time.time()-render_start
        result['resourceWaitSeconds']=render_start-started
    else:
        result['renderWallSeconds']=result['wallSecondsIncludingWait']
        result['resourceWaitSeconds']=0
    report.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result),flush=True)
    if child.returncode:raise subprocess.CalledProcessError(child.returncode,command)
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('name');parser.add_argument('--cwd',default='.');parser.add_argument('command',nargs=argparse.REMAINDER);args=parser.parse_args()
    cmd=args.command[1:] if args.command[:1]==['--'] else args.command
    run(args.name,cmd,args.cwd,Path(__file__).parent)
