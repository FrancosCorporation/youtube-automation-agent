import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] || 'robo-bonito-temas';
if (!['robo-bonito-temas', 'robo-bonito-animado'].includes(name)) throw Error('Unknown variant');
const variant = path.join(root, 'variants', name);
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(variant, '.'+new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(variant+path.sep)) throw Error('Invalid path');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({args:['--no-sandbox','--use-gl=angle','--use-angle=gl']});
  const page = await browser.newPage({viewport:{width:1920,height:1080}});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>window.pulsoSpeakingReady, null, {timeout:60000});
  const report = await page.evaluate(() => {
    let mesh; window.pulsoModel.traverse(o=>{if(o.isSkinnedMesh && !mesh) mesh=o;});
    const g = mesh.geometry, pos=g.attributes.position, joints=g.attributes.skinIndex, weights=g.attributes.skinWeight;
    const edges=[]; const edgeSet=new Set();
    for(let i=0; i<g.index.count; i+=3) {
      const v=[g.index.getX(i),g.index.getX(i+1),g.index.getX(i+2)];
      for(let j=0;j<3;j++) {
        const a=Math.min(v[j],v[(j+1)%3]),b=Math.max(v[j],v[(j+1)%3]);
        const key=a*pos.count+b; if(edgeSet.has(key))continue; edgeSet.add(key);
        const rest=Math.hypot(pos.getX(a)-pos.getX(b),pos.getY(a)-pos.getY(b),pos.getZ(a)-pos.getZ(b));
        if(rest>1e-7)edges.push([a,b,rest]);
      }
    }
    const vertex=i=>({index:i,position:[pos.getX(i),pos.getY(i),pos.getZ(i)],
      joints:[joints.getX(i),joints.getY(i)],weights:[weights.getX(i),weights.getY(i)]});
    const samples=[]; const vector=window.pulsoBones.Head.position.clone();
    for(const time of [0,1,1.5,2.4,3.65,15.5,17.8,19.9,22]) {
      window.seekPulsoSpeaking(time);
      const transformed=new Float32Array(pos.count*3);
      for(let i=0;i<pos.count;i++){mesh.getVertexPosition(i,vector);transformed.set([vector.x,vector.y,vector.z],i*3);}
      let maxRatio=0,countOver3=0,maxExtraLength=0;const worst=[];
      for(const [a,b,rest]of edges){
        const current=Math.hypot(...[0,1,2].map(k=>transformed[a*3+k]-transformed[b*3+k]));
        const ratio=current/rest,extra=current-rest;
        maxRatio=Math.max(maxRatio,ratio);maxExtraLength=Math.max(maxExtraLength,extra);if(ratio>3)countOver3++;
        if(extra>.025)worst.push({a,b,rest,current,ratio,extra});
      }
      worst.sort((a,b)=>b.extra-a.extra);
      samples.push({time,maxRatio,countOver3,maxExtraLength,worst:worst.slice(0,8).map(e=>({...e,a:vertex(e.a),b:vertex(e.b)}))});
    }
    return {vertices:pos.count,edges:edges.length,samples};
  });
  await writeFile(path.join(variant,'arm-edge-audit.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.samples.map(s=>({time:s.time,maxRatio:s.maxRatio,over3:s.countOver3,maxExtra:s.maxExtraLength}))));
  // Diagnostic source geometry, colored by dominant rigid bone; no texture edits.
  const colored = await page.evaluate(()=>{
    if(!window.pulsoRenderer) return false;
    window.seekPulsoSpeaking(0);
    const colors=['#888888','#888888','#BBBBBB','#555555','#FFFFFF','#EF4444','#22C55E','#3B82F6','#F97316','#14B8A6','#8B5CF6'];
    window.pulsoModel.traverse(o=>{
      if(!o.isSkinnedMesh)return;
      const j=o.geometry.attributes.skinIndex,p=o.geometry.attributes.position;
      const values=new Float32Array(p.count*3),color=o.material.color.clone();
      for(let i=0;i<p.count;i++){color.set(colors[j.getX(i)]||'#666666');values.set([color.r,color.g,color.b],i*3);}
      o.geometry.setAttribute('color',new p.constructor(values,3));
      o.material=o.material.clone();o.material.map=null;o.material.normalMap=null;
      o.material.metalnessMap=null;o.material.roughnessMap=null;o.material.color.set('#FFFFFF');
      o.material.metalness=0;o.material.roughness=1;o.material.vertexColors=true;o.material.needsUpdate=true;
    });
    for(const b of Object.values(window.pulsoBones))b.quaternion.identity();
    window.pulsoModel.updateMatrixWorld(true);
    window.pulsoRenderer.render(window.pulsoScene,window.pulsoCamera);
    return true;
  });
  if(colored) await page.screenshot({path:path.join(root,'renders',`${name}-rig-colors.png`)});
} finally { if(browser)await browser.close(); await new Promise(r=>server.close(r)); }
