'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const board=require('../benchmarks/video_3d/reforestation_demo/storyboard.json');
const {missionAt}=require('../benchmarks/video_3d/reforestation_demo/motion.cjs');
test('flight keeps the complete rotor radius outside the crew corridor',()=>{
  for(let f=0;f<board.durationInFrames;f++){
    const s=missionAt(f,board);
    for(const p of [[-1.4,-1.1+1.7*s.approach],[.05,.65]])
      assert.ok(Math.hypot(s.drone[0]-p[0],s.drone[2]-p[1])>1.15,`Crew clearance at frame ${f}`);
  }
});
test('capsules leave the nozzle at the target, fall to the ground and persist',()=>{
  const state=missionAt(0,board);
  for(const drop of state.drops){
    const released=missionAt(drop.release*board.fps,board);
    assert.ok(Math.abs(released.drone[0]-drop.target[0])<1e-6);
    assert.ok(Math.abs(released.drone[2]-drop.target[2])<1e-6);
    for(const f of [Math.ceil((drop.release+1)*board.fps),board.durationInFrames-1]){
      const d=missionAt(f,board).drops.find(v=>v.release===drop.release);
      assert.equal(d.visible,true);assert.equal(d.landed,true);assert.equal(d.position[1],.055);
    }
  }
});
test('positions reproduce exactly after nonsequential frame requests',()=>{
  for(const f of [0,160,365,450,507,665,959]){
    const a=missionAt(f,board);missionAt(959-f,board);assert.deepEqual(missionAt(f,board),a);
  }
});
