// One-time asset preparation. No browser, remote rigging or service call per video.
// Run with the pinned Ara checkout's tsx; all imports and textures are local.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const PIN = '2e5724de1b12444bf0c2454555fedfc976a4274c';
const args = process.argv.slice(2);
const opt = (name, fallback) => {const i=args.indexOf(name); return i<0?fallback:args[i+1];};
const source = path.resolve(opt('--generator', path.join(os.homedir(), '.cache/pulso/ara3d')));
const specPath = path.resolve(opt('--spec', 'characters.json'));
const out = path.resolve(opt('--out', 'public/humans'));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const canonical = value => JSON.stringify(value, (_,v) => v && !Array.isArray(v) && typeof v==='object'
  ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
const load = relative => import(pathToFileURL(path.join(source, relative)).href);
const commit = execFileSync('git', ['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(commit!==PIN) throw Error(`Ara revision differs from reviewed source: ${commit}`);
const dirty = execFileSync('git',['-C',source,'status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim();
if(dirty) throw Error('Ara source is modified; review and pin it before using this asset cache.');
const {nodeLibrary} = await load('scripts/node-assets.ts');
const {buildHuman} = await load('src/core/human.ts');
const {DEFAULT_PARAMS, PRESETS} = await load('src/core/params.ts');
const {runExport,planExport,DEFAULT_EXPORT} = await load('src/export/index.ts');
const {clipById} = await load('src/core/anim/clips/index.ts');
const lib = await nodeLibrary();
const spec = JSON.parse(await fs.readFile(specPath,'utf8'));
await fs.mkdir(out,{recursive:true});
const manifest = {schema:1,generator:'Ara 3D Gen',repository:'https://github.com/olatunde85/3d-gen',commit,
  sourceCodeLicense:'MIT',baseAssetsLicense:'CC0-1.0',motionLicense:'CMU: commercial use permitted, no standalone motion-data resale',
  catalogSha256:hash(await fs.readFile(path.join(source,'public/assets/catalog.json'))),characters:[]};
for(const job of spec.characters){
  if(!/^[a-z][a-z0-9-]{0,50}$/.test(job.id)) throw Error('Invalid character id');
  if(job.preset && !PRESETS[job.preset]) throw Error(`Unknown preset: ${job.preset}`);
  const clips=job.clips||['idle','walk','carry_idle','carry_walk','use_press'];
  for(const id of clips) if(!clipById.has(id)) throw Error(`Unknown motion: ${id}`);
  const params={...DEFAULT_PARAMS,...(PRESETS[job.preset]||{}),...job.params,name:job.id};
  const key=hash(canonical({commit,catalog:manifest.catalogSha256,params,clips}));
  const file=path.join(out,`${job.id}.glb`),meta=path.join(out,`${job.id}.json`);
  const previous=await fs.readFile(meta,'utf8').then(JSON.parse).catch(()=>null);
  if(previous?.inputSha256===key && await fs.readFile(file).then(b=>hash(b)===previous.sha256).catch(()=>false)){
    manifest.characters.push({...previous,cacheHit:true}); continue;
  }
  const start=performance.now();
  const ch=await buildHuman(lib,params);
  const built=performance.now();
  const plan=planExport(ch,{...DEFAULT_EXPORT,format:'glb',clips});
  const result=await runExport(lib,ch,plan);
  await fs.writeFile(`${file}.part`,result.data); await fs.rename(`${file}.part`,file);
  const gltf=JSON.parse(Buffer.from(result.data).subarray(20,20+new DataView(result.data.buffer,result.data.byteOffset).getUint32(12,true)));
  const info={id:job.id,file:`${job.id}.glb`,params,inputSha256:key,sha256:hash(result.data),bytes:result.data.length,
    heightMeters:ch.height,triangles:ch.mesh.groups.reduce((n,g)=>n+g.indices.length/3,0),joints:ch.rig.bones.length,
    animations:gltf.animations.map(a=>a.name),textures:gltf.images.length,
    buildSeconds:(built-start)/1000,totalSeconds:(performance.now()-start)/1000,cacheHit:false};
  await fs.writeFile(meta,JSON.stringify(info,null,2)+'\n');manifest.characters.push(info);
  console.log(JSON.stringify({id:job.id,triangles:info.triangles,bytes:info.bytes,seconds:info.totalSeconds}));
}
await fs.copyFile(path.join(source,'LICENSE'),path.join(out,'ARA-LICENSE.txt'));
await fs.copyFile(path.join(source,'scripts/ASSETS_LICENSE.txt'),path.join(out,'MAKEHUMAN-LICENSE.txt'));
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({prepared:true,characters:manifest.characters.length,cacheHits:manifest.characters.filter(c=>c.cacheHit).length}));
