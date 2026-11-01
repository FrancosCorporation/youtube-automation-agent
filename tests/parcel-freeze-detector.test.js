'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {getFFmpegPath}=require('../utils/ffmpeg');
const {sceneFreezeFilter}=require('../benchmarks/video_3d/parcel_demo/media-qa.cjs');
function scan(size,position){
  const result=spawnSync(getFFmpegPath(),['-hide_banner','-filter_complex_threads','1','-f','lavfi','-i','color=c=0x17343e:s=1920x1080:r=30:d=4','-f','lavfi','-i','testsrc2=s='+size+':r=30:d=4','-filter_complex','[0:v][1:v]overlay='+position+','+sceneFreezeFilter(),'-an','-f','null','-'],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);return result.stderr.includes('freeze_start:');
}
test('animated presenter outside the viewport cannot conceal a frozen scene',()=>{
  assert.equal(scan('370x620','1500:240'),true);
});
test('movement in the scene viewport is accepted with a static surrounding layout',()=>{
  assert.equal(scan('1460x620','40:240'),false);
});
