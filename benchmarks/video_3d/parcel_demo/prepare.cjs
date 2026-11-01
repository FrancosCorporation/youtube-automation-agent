'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {execFileSync}=require('node:child_process');
const {extractSpeechEnvelope}=require('../../../utils/speech-envelope');
const base=__dirname,root=path.resolve(base,'../../..'),benchmark=path.resolve(base,'..');
const out=path.join(benchmark,'outputs/parcel_delivery.mp4');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const norm=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]/gu,'');
const run=(cmd,args)=>execFileSync(cmd,args,{stdio:'inherit'});
async function main(){
  const storyPath=path.join(base,'fontes.md'),narrationText=path.join(base,'narracao.txt'),voicePath=path.join(base,'narracao-original.mp3'),timingsPath=path.join(base,'palavras.json');
  if(!fs.existsSync(voicePath)||!fs.existsSync(timingsPath))run('python3',[path.join(root,'scripts/synthesize-edge-tts-word-boundaries.py'),'--text-file',narrationText,'--audio',voicePath,'--timings',timingsPath,'--voice','pt-BR-AntonioNeural','--rate=+0%','--pitch=+0Hz']);
  const lines=fs.readFileSync(narrationText,'utf8').split('\n').filter(Boolean);
  const events=JSON.parse(fs.readFileSync(timingsPath,'utf8')).events;let cursor=0;
  const fps=30,durationSeconds=55,durationInFrames=fps*durationSeconds,leadMs=500;
  const sentences=lines.map((text,index)=>{let chars=0;const words=[];while(cursor<events.length&&chars<norm(text).length){const event=events[cursor++];chars+=norm(event.text).length;words.push(event);}if(chars!==norm(text).length)throw Error(`Alinhamento da narração divergente na frase ${index+1}: ${chars}/${norm(text).length}`);return {id:`s${index+1}`,text,startFrame:Math.round(((words[0].startMs+leadMs)/1000)*fps),endFrame:Math.round(((words.at(-1).endMs+leadMs)/1000)*fps)};});
  if(cursor!==events.length)throw Error(`Eventos de fala sem frase correspondente: ${events.length-cursor}`);
  const spoken=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',voicePath],{encoding:'utf8'}));
  if(spoken>durationSeconds-leadMs/1000-1)throw Error(`A narração dura ${spoken.toFixed(2)} s; encurte antes de continuar para manter o vídeo perto de 1 minuto.`);
  const wav=path.join(base,'narracao.wav'),audio=path.join(base,'narracao.m4a');
  run('ffmpeg',['-y','-v','error','-threads','1','-i',voicePath,'-af',`adelay=${leadMs}:all=1,apad=whole_dur=${durationSeconds}`,'-t',String(durationSeconds),'-ar','48000','-ac','2','-c:a','pcm_s16le',wav]);
  run('ffmpeg',['-y','-v','error','-threads','1','-i',wav,'-c:a','aac','-b:a','192k',audio]);
  const envelope=await extractSpeechEnvelope(wav);
  const captions=sentences.map((s,i)=>({startFrame:s.startFrame,endFrame:sentences[i+1]?.startFrame||durationInFrames,text:s.text}));
  const board={title:'Como uma encomenda encontra o caminho até você',fps,width:1920,height:1080,durationSeconds,durationInFrames,sentences,captions,audioSha256:sha(audio),voice:'pt-BR-AntonioNeural',sourceDate:'2026-11-01'};
  fs.writeFileSync(path.join(base,'storyboard.json'),JSON.stringify(board,null,2)+'\n');
  fs.writeFileSync(path.join(base,'audio-envelope.json'),JSON.stringify(envelope)+'\n');
  const publicDir=path.join(base,'public');fs.mkdirSync(path.join(publicDir,'parcel'),{recursive:true});fs.mkdirSync(path.join(publicDir,'pulso-story'),{recursive:true});
  for(const [src,dest] of [[audio,path.join(publicDir,'parcel','narracao.m4a')],[path.join(root,'experiments/remotion-motion-review/public/pulso-story/approved-robot-rigged.glb'),path.join(publicDir,'pulso-story','approved-robot-rigged.glb')]]){
    if(fs.existsSync(dest)&&sha(src)===sha(dest))continue;if(fs.existsSync(dest))fs.unlinkSync(dest);fs.copyFileSync(src,dest);
  }
  for (const name of ['crew-01.glb','crew-02.glb']) fs.copyFileSync(path.join(base,'models',name),path.join(publicDir,'parcel',name));
  fs.mkdirSync(path.dirname(out),{recursive:true});
  console.log(JSON.stringify({prepared:true,durationSeconds,spokenSeconds:spoken,frames:durationInFrames,storySha256:sha(storyPath),narrationSha256:sha(audio),output:out}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
