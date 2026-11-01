'use strict';
// Real browser seeks: revisit the same canvas after another frame and compare pixels.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');const sharp=require('sharp');
const base=path.resolve(__dirname,'..'),root=path.resolve(base,'../..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const portraitOnly=process.argv.includes('--portrait'),expected=portraitOnly?12:24;
  const port=3203;const log=fs.openSync(path.join(base,'logs/reforestation-seek-studio.log'),'w');
  const studio=spawn(path.join(base,'node_modules/.bin/remotion'),['studio',path.join(base,'reforestation_demo/index.jsx'),`--port=${port}`,`--public-dir=${base}/reforestation_demo/public`,`--config=${base}/remotion.config.js`,'--no-open'],{cwd:root,stdio:['ignore',log,log]});
  let browser;const errors=[],results=[],renderers={};
  try{
    for(let i=0;i<90;i++){try{const r=await fetch(`http://127.0.0.1:${port}`);if(r.ok)break;}catch{/* Studio may still be binding its socket. */}if(i===89)throw Error('Studio startup timed out');await pause(1000);}
    browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle']});
    const page=await browser.newPage({viewport:{width:1400,height:1000}});page.on('pageerror',e=>errors.push(e.message));
    for(const engine of portraitOnly?['Portrait']:['Landscape','Portrait']){
      const comp=`Reforestation${engine}`;await page.goto(`http://127.0.0.1:${port}/${comp}`,{waitUntil:'domcontentloaded',timeout:90000});
      await page.waitForFunction(()=>typeof window.remotion_setFrame==='function',{timeout:90000});
      await page.locator('canvas').first().waitFor({state:'visible',timeout:90000});
      renderers[engine]=await page.locator('canvas').first().evaluate(c=>{const gl=c.getContext('webgl2')||c.getContext('webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return gl?{vendor:gl.getParameter(ext?ext.UNMASKED_VENDOR_WEBGL:gl.VENDOR),renderer:gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER),version:gl.getParameter(gl.VERSION)}:null;});
      for(const frame of [60,195,325,460,540,750]){
        const images=[];
        for(const f of [frame,frame===0?750:0,frame]){
          await page.evaluate(([f,c])=>window.remotion_setFrame(f,c,0),[f,comp]);
          await page.waitForFunction(()=>window.remotion_renderReady===true,{timeout:90000});await pause(400);
          if(f===frame)images.push(await Promise.all([0,1].map(i=>page.locator('canvas').nth(i).screenshot())));
        }
        for(let canvasIndex=0;canvasIndex<2;canvasIndex++){
        const a=await sharp(images[0][canvasIndex]).ensureAlpha().raw().toBuffer(),b=await sharp(images[1][canvasIndex]).ensureAlpha().raw().toBuffer();
        if(a.length!==b.length)throw Error('Seek canvas changed dimensions');let max=0,sq=0,changed=0;
        for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);sq+=d*d;if(d>8)changed++;}
        const rmse=Math.sqrt(sq/a.length)/255,passed=max<=8&&changed<=400&&rmse<=.002;
        results.push({engine,frame,canvasIndex,passed,maxChannelDelta:max,channelsOver8:changed,rmse,firstSha256:crypto.createHash('sha256').update(images[0][canvasIndex]).digest('hex'),revisitedSha256:crypto.createHash('sha256').update(images[1][canvasIndex]).digest('hex')});
        }
      }
    }
  }finally{if(browser)await browser.close();studio.kill('SIGTERM');fs.closeSync(log);fs.writeFileSync(path.join(base,portraitOnly?'reforestation_demo/reports/seek-pixels-portrait-final.json':'reforestation_demo/reports/seek-pixels.json'),JSON.stringify({results,errors,renderers,passed:results.length===expected&&results.every(r=>r.passed)&&!errors.length},null,2)+'\n');}
  if(results.length!==expected||!results.every(r=>r.passed)||errors.length)throw Error('Pixel seek failed: '+JSON.stringify({results,errors}));
  console.log(JSON.stringify({passed:true,checks:results.length}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
