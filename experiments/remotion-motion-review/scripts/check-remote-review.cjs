const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const shortUrl='https://francoscorporation.ddns.net/remotion-review/';

(async()=>{
 const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[],failed=[],audio=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)failed.push({status:r.status(),url:r.url()});if(r.url().endsWith('/pulso-story/narration.m4a'))audio.push(r.status())});
  const waitForStudio=async({ready=false}={})=>{
   await page.waitForFunction(()=>{
    const frame=document.querySelector('#studio');
    try{return Boolean(frame?.contentWindow?.document?.querySelector('#__remotion-studio-container'))}catch{return false}
   },{timeout:45000});
   const frame=page.frames().find(f=>f.url().includes('/games/play/remotion-review/releases/'));
   assert.ok(frame,'Remotion Studio frame must load from the immutable release');
   if(ready) await frame.waitForFunction(()=>typeof window.remotion_setFrame==='function'&&window.remotion_renderReady,{timeout:45000});
   return frame;
  };

  await page.goto(shortUrl,{waitUntil:'networkidle',timeout:60000});
  let studio=await waitForStudio();
  await studio.waitForFunction(()=>document.body.innerText.includes('PulsoStory'),{timeout:45000});
  const projectList=await studio.locator('body').innerText();
  for(const name of ['LlamaScaleReview','IceFloatsReview','PulsoStory']) assert.ok(projectList.includes(name),`Project selector must include ${name}`);

  await page.goto(`${shortUrl}?/PulsoStory`,{waitUntil:'networkidle',timeout:60000});
  studio=await waitForStudio({ready:true});
  await studio.evaluate(()=>document.fonts.ready);
  const frameNow=()=>studio.locator('button[aria-label]').evaluateAll(es=>Number(es.find(e=>/^\d+$/.test(e.getAttribute('aria-label')))?.getAttribute('aria-label')));
  assert.equal(await studio.evaluate(()=>window.remotion_isReadOnlyStudio),true);
  await studio.getByRole('button',{name:'Play',exact:true}).click();
  await studio.waitForFunction(()=>[...document.querySelectorAll('button[aria-label]')].some(e=>/^\d+$/.test(e.getAttribute('aria-label'))&&Number(e.getAttribute('aria-label'))>=30));
  await studio.getByRole('button',{name:'Pause',exact:true}).click();
  const playbackFrame=await frameNow();
  assert.ok(playbackFrame>=30);
  const frames=[31,58,170,335,455,551,552,700,335];
  const hashes=[];
  for(const frame of frames){
   await studio.evaluate(f=>window.remotion_setFrame(f,'PulsoStory',1),frame);
   await studio.waitForFunction(f=>window.remotion_renderReady&&Boolean(document.querySelector(`button[aria-label="${f}"]`)),frame);
   await studio.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   if(frame===335){
    const bytes=await studio.locator('div[style*="font-family: PulsoSans"]').screenshot();
    hashes.push(createHash('sha256').update(bytes).digest('hex'));
    await fs.writeFile(path.join(root,'renders/remote-review-short-url-frame-335.png'),bytes);
   }
  }
  assert.equal(hashes[0],hashes[1],'Backward seek must restore the same rendered composition');
  await page.screenshot({path:path.join(root,'renders/remote-review-short-url-desktop.png')});
  await page.setViewportSize({width:844,height:390});
  await studio.getByRole('button',{name:'Enter fullscreen preview',exact:true}).click();
  await page.screenshot({path:path.join(root,'renders/remote-review-short-url-mobile-landscape.png')});
  assert.equal(await studio.locator('[aria-label="Apresentador 3D aprovado"] canvas').count(),1);
  assert.ok(audio.some(s=>s===200||s===206),'Narration must load successfully');
  assert.deepEqual(errors,[]);
  assert.deepEqual(failed,[]);
  const report={url:page.url(),title:await page.title(),mode:'stable-short-url-static-studio-review',projectList:['LlamaScaleReview','IceFloatsReview','PulsoStory'],playbackFrame,audioHttpStatuses:audio,seekFrames:frames,repeatFrame335Sha256:hashes,errors,failed,desktop:[1440,1000],mobileLandscape:[844,390],checkedAt:new Date().toISOString()};
  await fs.writeFile(path.join(root,'renders/remote-review-short-url-qa.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
