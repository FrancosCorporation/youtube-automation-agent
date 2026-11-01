import { chromium } from 'playwright';
const base='https://francoscorporation.ddns.net/games/play/pulso-ia/producao-robo-fonemas/';
const browser=await chromium.launch({args:['--no-sandbox']});
const errors=[];
const views=[];
try{
  for(const viewport of [{width:1366,height:900,label:'desktop'},{width:390,height:844,label:'mobile'}]){
    const page=await browser.newPage({viewport});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base,{waitUntil:'load'});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if(overflow)throw Error(`Page overflows viewport ${viewport.label}`);
    const videos=await page.locator('video').count();
    if(videos!==2)throw Error(`Expected 2 videos, found ${videos}`);
    const horizontal=page.locator('video').nth(0);
    const vertical=page.locator('video').nth(1);
    for(const [label,locator,w,h] of [['horizontal',horizontal,1920,1080],['vertical',vertical,1080,1920]]){
      await locator.evaluate(async v=>{v.muted=true;await v.play();});
      await page.waitForFunction(([sel])=>{const v=document.querySelectorAll('video')[sel];return v&&v.currentTime>.3;},[label==='horizontal'?0:1],{timeout:15000});
      const info=await locator.evaluate(v=>({time:v.currentTime,width:v.videoWidth,height:v.videoHeight,duration:v.duration}));
      if(info.width!==w||info.height!==h)throw Error(`${label}: wrong dimensions ${info.width}x${info.height}`);
      if(Math.abs(info.duration-15.375)>.05)throw Error(`${label}: unexpected duration ${info.duration}`);
      views.push({viewport:viewport.label,label,...info});
    }
    await page.screenshot({path:new URL(`../renders/fonemas-public-${viewport.label}.png`,import.meta.url).pathname,fullPage:true});
    await page.close();
  }
}finally{await browser.close();}
if(errors.length)throw Error('Page errors: '+errors.join(' | '));
console.log(JSON.stringify({ok:true,views},null,1));
