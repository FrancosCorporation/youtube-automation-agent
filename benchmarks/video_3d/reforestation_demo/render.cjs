'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {bundle}=require('@remotion/bundler');
const {selectComposition,renderStill,renderMedia,openBrowser}=require('@remotion/renderer');
const base=__dirname,benchmark=path.resolve(base,'..'),modules=path.join(benchmark,'node_modules');
const reports=path.join(base,'reports');fs.mkdirSync(reports,{recursive:true});
const board=require('./storyboard.json');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const run=(c,a)=>execFileSync(c,a,{encoding:'utf8',maxBuffer:10*1024*1024,stdio:['ignore','pipe','pipe']});
async function main(){
  const preview=process.argv.includes('--preview');
  const serveUrl=await bundle({entryPoint:path.join(base,'index.jsx'),publicDir:path.join(base,'public'),outDir:path.join(benchmark,'.work/reforestation-bundle'),
    webpackOverride:config=>({...config,resolve:{...config.resolve,alias:{...config.resolve?.alias,
      'three$':path.join(modules,'three'),'three/':path.join(modules,'three')+'/',
      'react$':path.join(modules,'react'),'react-dom$':path.join(modules,'react-dom'),
      'remotion$':path.join(modules,'remotion'),'@react-three/fiber$':path.join(modules,'@react-three/fiber'),
      '@remotion/':path.join(modules,'@remotion')+'/'}}})});
  const browser=await openBrowser('chrome',{chromiumOptions:{gl:'angle'}});
  const errors=[];
  const common={serveUrl,puppeteerInstance:browser,chromiumOptions:{gl:'angle'},logLevel:'error',onBrowserLog:log=>{if(log.type==='error')errors.push(log.text);}};
  try{
    for(const aspect of process.argv.includes('--portrait')?['portrait']:process.argv.includes('--landscape')?['landscape']:['landscape','portrait']){
      const id=aspect==='portrait'?'ReforestationPortrait':'ReforestationLandscape';
      const composition=await selectComposition({...common,id});
      if(preview){
        const frames=(process.argv.find(a=>a.startsWith('--frames='))?.split('=')[1]||'60,195,325,460,540,750').split(',').map(Number);
        if(frames.some(f=>!Number.isInteger(f)||f<0||f>=board.durationInFrames))throw Error('Invalid preview frame');
        for(const frame of frames){
          await renderStill({...common,composition,frame,imageFormat:'png',output:path.join(reports,`${aspect}-${frame}.png`)});
          console.log(JSON.stringify({preview:aspect,frame}));
        }
        continue;
      }
      const output=path.join(benchmark,'outputs',aspect==='portrait'?'reforestation_humans_vertical.mp4':'reforestation_humans.mp4');
      const start=performance.now();let shown=-1;
      await renderMedia({...common,composition,outputLocation:output,codec:'h264',crf:19,x264Preset:'medium',concurrency:1,enforceAudioTrack:true,overwrite:true,
        onProgress:p=>{const step=Math.floor(p.progress*10);if(step>shown){shown=step;console.log(JSON.stringify({render:aspect,percent:step*10}));}}});
      const renderSeconds=(performance.now()-start)/1000;
      const probe=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output]));
      const video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');
      if(Number(video.nb_frames)!==board.durationInFrames||Math.abs(Number(probe.format.duration)-board.durationSeconds)>.1||!audio)throw Error('Media properties mismatch');
      run('ffmpeg',['-v','error','-xerror','-i',output,'-f','null','-']);
      for(const frame of [60,195,325,460,540,750])run('ffmpeg',['-y','-v','error','-ss',String(frame/30),'-i',output,'-frames:v','1',path.join(reports,`${aspect}-${frame}.png`)]);
      const selected=[60,195,325,460,540,750].map(n=>`eq(n\\,${n})`).join('+');
      run('ffmpeg',['-y','-v','error','-i',output,'-vf',`select='${selected}',scale=${aspect==='portrait'?'270:480':'640:360'},tile=3x2`,'-frames:v','1',path.join(reports,`${aspect}-contact.png`)]);
      const report={status:'technical-pass',aspect,renderSeconds,output:path.relative(path.resolve(base,'../../..'),output),sha256:sha(output),bytes:fs.statSync(output).size,
        durationSeconds:Number(probe.format.duration),width:video.width,height:video.height,frames:Number(video.nb_frames),codec:video.codec_name,audioCodec:audio.codec_name,
        fullDecode:true,browserErrors:errors,visualReview:{status:'pending'},models:JSON.parse(fs.readFileSync(path.join(base,'public/humans/manifest.json'))).characters.map(c=>({id:c.id,sha256:c.sha256,triangles:c.triangles}))};
      fs.writeFileSync(path.join(reports,`${aspect}-qa.json`),JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify({done:aspect,renderSeconds,sha256:report.sha256}));
    }
    if(errors.length)throw Error('Browser errors: '+JSON.stringify(errors));
  }finally{await browser.close({silent:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
