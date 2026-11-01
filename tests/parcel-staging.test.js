'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {checkDoorPassage,validate}=require('../benchmarks/video_3d/parcel_demo/staging-qa.cjs');
test('person cannot pass through a closed or insufficiently opened panel',()=>{
  assert.equal(checkDoorPassage({z:0,door:0}),false);
  assert.equal(checkDoorPassage({z:0,door:.5}),false);
  assert.equal(checkDoorPassage({z:0,door:1}),true);
  assert.equal(checkDoorPassage({z:-2,door:0}),true);
});
test('authored route opens before both person and parcel enter and closes after passage',()=>{
  const report=validate();assert.equal(report.status,'passed',JSON.stringify(report.problems));
  assert.equal(report.sampledStates,5403);
});
