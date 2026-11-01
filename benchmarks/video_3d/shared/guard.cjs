/* global __filename */
'use strict';
// Respect the production render lock and resource gate; never stop its service.
const path=require('node:path');const fs=require('node:fs');const {spawn}=require('node:child_process');
const {probeRenderHardwareGate}=require('../../../utils/render-timing');
const {acquireProcessFileLock}=require('../../../utils/process-file-lock');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const generator=path.resolve(__dirname,'../../../scripts/generate-animated-video.js');
function writerPids(){
  // That exact production entrypoint renders only inside narrative-render.lock
  // (NarrativeEpisodeRenderer.renderEpisode). Exclude it ONLY while we own the
  // same lock. Other waiting benchmark guards also own no renderer while we hold
  // this lock; their argv includes the future command and would otherwise cause
  // mutual false contention. Actual Remotion children remain visible to the gate.
  return fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x)).filter(pid=>{
    try{return fs.readFileSync(`/proc/${pid}/cmdline`).toString().split('\0').some(arg=>arg===generator||arg===__filename);}catch{return false;}
  }).map(Number);
}
async function main(){
  const args=process.argv.slice(2);if(!args.length)throw Error('Command required');
  const deadline=Date.now()+12*3600*1000;let release;
  while(Date.now()<deadline){
    release=await acquireProcessFileLock({lockPath:path.resolve(__dirname,'../../../data/state/narrative-render.lock'),owner:'video-3d-benchmark',timeoutMs:60000}).catch(()=>null);
    if(!release)continue;
    const excludedWriters=writerPids();
    const gate=probeRenderHardwareGate({excludePids:[process.pid,...excludedWriters]});
    if(gate.renderSafe){console.log(JSON.stringify({gate,serializedProductionWriters:excludedWriters}));break;}
    console.log(JSON.stringify({waitingForResources:gate.reasons,at:gate.observedAt}));
    await release();release=null;await pause(15000);
  }
  if(!release)throw Error('Resource wait deadline exceeded; production left unchanged');
  console.log('BENCHMARK_RENDER_START '+new Date().toISOString());
  try{await new Promise((resolve,reject)=>{const c=spawn(args[0],args.slice(1),{stdio:'inherit',env:process.env});c.on('error',reject);c.on('exit',code=>code?reject(Error('Renderer exit '+code)):resolve());});}
  finally{await release();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
