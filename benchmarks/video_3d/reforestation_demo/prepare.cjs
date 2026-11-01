'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {extractSpeechEnvelope}=require('../../../utils/speech-envelope');
const base=__dirname,root=path.resolve(base,'../../..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const run=(c,a)=>execFileSync(c,a,{stdio:'inherit'});
const norm=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
async function main(){
  const text=path.join(base,'narracao.txt'),voice=path.join(base,'voice.mp3'),timing=path.join(base,'words.json');
  let sameText=false;
  try{sameText=norm(JSON.parse(fs.readFileSync(timing)).events.map(e=>e.text).join(''))===norm(fs.readFileSync(text,'utf8'));}catch{/* Missing or invalid timing requires new speech. */}
  if(!fs.existsSync(voice)||!sameText)run('python3',[path.join(root,'scripts/synthesize-edge-tts-word-boundaries.py'),'--text-file',text,'--audio',voice,'--timings',timing,'--voice','pt-BR-AntonioNeural','--rate=+0%','--pitch=+0Hz']);
  const events=JSON.parse(fs.readFileSync(timing)).events;let cursor=0;
  const fps=30,leadMs=700;
  const sentences=fs.readFileSync(text,'utf8').trim().split('\n').map((text,i)=>{
    const words=[];let count=0;while(cursor<events.length&&count<norm(text).length){const w=events[cursor++];words.push(w);count+=norm(w.text).length;}
    if(count!==norm(text).length||norm(words.map(w=>w.text).join(''))!==norm(text))throw Error('Narration alignment failed at sentence '+i);
    return {text,startFrame:Math.round((words[0].startMs+leadMs)*fps/1000),endFrame:Math.round((words.at(-1).endMs+leadMs)*fps/1000)};
  });
  if(cursor!==events.length)throw Error('Unmatched spoken words');
  const durationSeconds=Math.ceil((events.at(-1).endMs+leadMs)/1000)+2;
  const wav=path.join(base,'voice.wav');
  const pub=path.join(base,'public');fs.mkdirSync(pub,{recursive:true});
  run('ffmpeg',['-y','-v','error','-i',voice,'-af',`adelay=${leadMs}:all=1,apad=whole_dur=${durationSeconds}`,'-t',String(durationSeconds),'-ar','48000','-ac','2',wav]);
  run('ffmpeg',['-y','-v','error','-i',wav,'-c:a','aac','-b:a','192k',path.join(pub,'voice.m4a')]);
  const board={title:'Uma missão para semear o futuro',fiction:true,fps,durationSeconds,durationInFrames:durationSeconds*fps,sentences,audioSha256:sha(path.join(pub,'voice.m4a'))};
  fs.writeFileSync(path.join(base,'storyboard.json'),JSON.stringify(board,null,2)+'\n');
  fs.writeFileSync(path.join(base,'audio-envelope.json'),JSON.stringify(await extractSpeechEnvelope(wav))+'\n');
  fs.copyFileSync(path.join(root,'experiments/remotion-motion-review/public/pulso-story/approved-robot-rigged.glb'),path.join(pub,'robot.glb'));
  console.log(JSON.stringify({prepared:true,durationSeconds,sentenceStarts:sentences.map(s=>s.startFrame)}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
