'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const base=path.resolve(__dirname,'..');const board=require('../roteiro/storyboard.json');const model=require('./scene.json');const {stateAt}=require('./model.cjs');
test('one complete timed narration and contiguous storyboard at 1080p30',()=>{
  assert.equal(board.fps,30);assert.equal(board.width,1920);assert.equal(board.height,1080);assert.ok(board.durationSeconds>=45&&board.durationSeconds<=60);
  assert.equal(board.scenes[0].startFrame,0);assert.equal(board.scenes.at(-1).endFrame,board.durationInFrames);
  for(let i=1;i<board.scenes.length;i++)assert.equal(board.scenes[i].startFrame,board.scenes[i-1].endFrame);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(base,board.narration))).digest('hex'),board.audioSha256);
});
test('boat maintains flotation; chamber bottom fixed; no lift before lower gate closes',()=>{
  const fillStart=board.scenes[3].startFrame;
  for(let f=0;f<board.durationInFrames;f++){
    const s=stateAt(model,f),w=s['water-chamber'];const waterTop=.2*w.scale3d[1]+w.position3d[1],bottom=-.54*w.scale3d[1]+w.position3d[1];
    assert.ok(Math.abs(bottom+.54)<.002,`moving chamber floor ${f}`);
    const [x,y]=s.boat.position3d;if(x>-2&&x<2)assert.ok(Math.abs(y-waterTop)<.004,`boat not floating ${f}`);
    if(waterTop>.201)assert.ok(Math.abs(s['gate-lower-near'].rotation3d[1])<.001,`filling before closure ${f}`);
    if(f<fillStart)assert.ok(waterTop<.201);
  }
});
test('upper gate opens only after levels equalize and boat clears gates during travel',()=>{
  for(let f=0;f<board.durationInFrames;f++){
    const s=stateAt(model,f);const water=.2*s['water-chamber'].scale3d[1]+s['water-chamber'].position3d[1];
    if(Math.abs(s['gate-upper-near'].rotation3d[1])>.001)assert.ok(Math.abs(water-1.56)<.004,`unsafe upper opening ${f}`);
    const x=s.boat.position3d[0];for(const [name,gx] of [['lower',-2.95],['upper',2.95]]){
      if(Math.abs(x-gx)<.95)assert.ok(Math.abs(s[`gate-${name}-near`].rotation3d[1])>1.55,`boat crosses closed gate ${name} ${f}`);
    }
  }
});
test('frame evaluations reproduce identically after forward and backward seeks',()=>{
  const order=[0,300,900,1000,1439,300,0,900];const states=new Map();for(const f of order){const value=JSON.stringify(stateAt(model,f));if(states.has(f))assert.equal(value,states.get(f));states.set(f,value);}
});
test('Blender export really contains every animated group',()=>{
  const b=fs.readFileSync(path.join(base,'motores/hibrido/lock.blender.glb'));assert.equal(b.toString('ascii',0,4),'glTF');
  const json=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));const names=new Set(json.nodes.map(n=>n.name));for(const n of model.nodes)assert.ok(names.has(n.id),n.id);
  assert.match(json.asset.generator,/Blender/);assert.ok(json.meshes.length>20);
});
