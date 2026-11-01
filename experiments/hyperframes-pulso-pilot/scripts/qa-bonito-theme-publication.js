import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const name=process.argv[2]||'robo-bonito-temas';
if(!['robo-bonito-temas','robo-bonito-temas-v3'].includes(name))throw Error('Unknown variant');
const publicDir=name==='robo-bonito-temas-v3'?'robo-temas-v3':'robo-temas-v2';
const variant=path.join(root,'variants',name);
const base='https://francoscorporation.ddns.net/games/play/pulso-ia/';
const assets=JSON.parse(await readFile(path.join(variant,'publication-assets.json'),'utf8'));
const network=[];
for(const asset of assets){
  const url=base+(asset.published.includes('/'+publicDir+'/')?publicDir+'/':'')+path.basename(asset.published);
  const response=await fetch(url);
  const bytes=Buffer.from(await response.arrayBuffer());
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(response.status!==200 || hash!==asset.sha256)throw Error('Published asset differs: '+url);
  network.push({url,status:response.status,type:response.headers.get('content-type'),bytes:bytes.length,sha256:hash});
}
const range=await fetch(base+'robo-bonito-tema-ia-v2.mp4',{headers:{Range:'bytes=0-1023'}});
const rangedBytes=(await range.arrayBuffer()).byteLength;
if(range.status!==206 || rangedBytes!==1024)throw Error('Range requests failed');
let browser;
const views=[];
try{
  browser=await chromium.launch({args:['--no-sandbox']});
  const errors=[];
  for(const viewport of [{width:1366,height:900},{width:390,height:844}]){
    const page=await browser.newPage({viewport});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+publicDir+'/');
    const ids=await page.locator('#theme option').evaluateAll(options=>options.map(o=>o.value));
    for(const id of ids){await page.selectOption('#theme',id);await page.waitForFunction(()=>{const i=document.getElementById('preview');return i.complete&&i.naturalWidth===1920;});}
    const overview=await page.locator('.sample').count();
    if(name==='robo-bonito-temas-v3'){
      if(overview!==10)throw Error('Missing theme overview');
      for(const id of ids){
        await page.locator(`.sample[data-theme="${id}"]`).click();
        if(await page.locator('#theme').inputValue()!==id)throw Error('Theme card selection failed');
        await page.waitForFunction(expected=>{const i=document.getElementById('preview');return i.complete&&i.currentSrc.endsWith('/'+expected+'.png');},id);
      }
    }
    await page.selectOption('#theme','ia');
    await page.waitForFunction(()=>{const i=document.getElementById('preview');return i.complete&&i.currentSrc.endsWith('/ia.png');});
    const imageRatio=await page.evaluate(()=>{const r=document.getElementById('preview').getBoundingClientRect();return r.width/r.height;});
    if(Math.abs(imageRatio-16/9)>.01)throw Error('Wrong preview image ratio');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if(overflow)throw Error('Gallery overflows viewport');
    await page.evaluate(async()=>{const v=document.getElementById('video');v.muted=true;await v.play();});
    await page.waitForFunction(()=>document.getElementById('video').currentTime>.3);
    const playback=await page.evaluate(()=>{const v=document.getElementById('video');return {time:v.currentTime,width:v.videoWidth,height:v.videoHeight,duration:v.duration};});
    if(playback.width!==1920 || playback.height!==1080)throw Error('Wrong video format');
    await page.screenshot({path:path.join(root,'renders',`${publicDir}-public-${viewport.width}.png`),fullPage:true});
    views.push({viewport,palettes:ids.length,overview,overflow,imageRatio,playback});await page.close();
  }
  const vertical=await browser.newPage();
  await vertical.goto(base+'robo-bonito-tema-ia-v2-vertical.mp4');
  await vertical.evaluate(async()=>{const v=document.querySelector('video');v.muted=true;await v.play();});
  await vertical.waitForFunction(()=>document.querySelector('video').currentTime>.3);
  const portrait=await vertical.evaluate(()=>{const v=document.querySelector('video');return {width:v.videoWidth,height:v.videoHeight,time:v.currentTime,duration:v.duration};});
  if(portrait.width!==1080 || portrait.height!==1920)throw Error('Wrong portrait video');
  if(errors.length)throw Error(errors.join('\n'));
  await writeFile(path.join(variant,'dns-publication.json'),JSON.stringify({network,range:{status:range.status,bytes:rangedBytes},views,portrait,errors,scope:'HTTPS tests from this host; not a separate external network.'},null,2)+'\n');
  console.log(JSON.stringify({assetsVerified:network.length,views,portrait,errors}));
}finally{if(browser)await browser.close();}
