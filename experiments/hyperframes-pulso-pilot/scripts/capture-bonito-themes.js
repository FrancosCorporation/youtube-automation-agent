import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const name=process.argv[2]||'robo-bonito-temas';
if(!['robo-bonito-temas','robo-bonito-temas-v3'].includes(name))throw Error('Unknown variant');
const variant=path.join(root,'variants',name);
const themes=JSON.parse(await readFile(path.join(root,'../../config/themes.json'),'utf8')).themes;
const html=await readFile(path.join(variant,'index.html'),'utf8');
const gallery=path.join(variant,'gallery'); await mkdir(gallery,{recursive:true});
const server=createServer(async(req,res)=>{
  try{
    const [id,...parts]=new URL(req.url,'http://localhost').pathname.slice(1).split('/');
    if(!themes.some(t=>t.id===id))throw Error('Unknown theme');
    const relative=parts.join('/')||'index.html';
    if(relative==='index.html'){
      res.setHeader('Content-Type','text/html');
      res.end(html.replace('data-theme="ia"',`data-theme="${id}"`).replace('data-palette-seed="1"',`data-palette-seed="${id==='ia'?1:0}"`));
    }else{
      const file=path.resolve(variant,relative);if(!file.startsWith(variant+path.sep))throw Error('Invalid path');
      res.end(await readFile(file));
    }
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
  browser=await chromium.launch({args:['--no-sandbox','--use-gl=angle','--use-angle=gl']});
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const manifest=[];
  for(const theme of themes){
    await page.goto(`http://127.0.0.1:${server.address().port}/${theme.id}/`);
    await page.waitForFunction(()=>window.pulsoSpeakingReady,null,{timeout:60000});
    await page.evaluate(()=>{window.seekPulsoSpeaking(1.5);});
    await page.screenshot({path:path.join(gallery,theme.id+'.png')});
    // Native canvas export gives the comparison overview the actual rendered
    // model, at the same pose/camera/lighting; no retouch of the source image.
    const capture=await page.evaluate(()=>{
      // Read the WebGL buffer in the same task as rendering: it is discarded
      // between frames when preserveDrawingBuffer is false.
      window.seekPulsoSpeaking(1.5);
      const source=document.getElementById('three-layer');
      const copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;
      const context=copy.getContext('2d');context.drawImage(source,0,0);
      const pixels=context.getImageData(0,0,copy.width,copy.height).data;
      let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>16)visible++;
      return {png:source.toDataURL('image/png'),visibleFraction:visible/(copy.width*copy.height)};
    });
    if(capture.visibleFraction<.08)throw Error('Empty robot capture: '+theme.id);
    await writeFile(path.join(gallery,theme.id+'-robot.png'),Buffer.from(capture.png.split(',')[1],'base64'));
    const palette=await page.evaluate(()=>window.pulsoRigMetrics.theme);
    if(palette.id!==theme.id)throw Error('Wrong theme rendered');
    manifest.push({...palette,image:theme.id+'.png',robotImage:theme.id+'-robot.png',visibleFraction:capture.visibleFraction});
  }
  if(errors.length)throw Error(errors.join('\n'));
  await writeFile(path.join(gallery,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({themes:manifest.length,errors}));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
