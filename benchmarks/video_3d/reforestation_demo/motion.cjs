'use strict';
const clamp=x=>Math.max(0,Math.min(1,x));
const ease=x=>{const p=clamp(x);return p*p*(3-2*p);};
const mix=(a,b,p)=>a.map((v,i)=>v+(b[i]-v)*p);
const TARGETS=[[-1.7,0,-1.8],[0,0,-2.4],[1.7,0,-1.8],[2.7,0,-.4]];
function missionAt(frame,board){
  const seconds=frame/board.fps;
  const flightStart=board.sentences[2].startFrame/board.fps;
  const dropStart=board.sentences[3].startFrame/board.fps;
  const finish=board.sentences[4].startFrame/board.fps;
  const pad=[1.6,.24,1.2],hover=[1.6,2,1.2];
  let drone=pad;
  if(seconds>=flightStart)drone=mix(pad,hover,ease((seconds-flightStart)/1.6));
  if(seconds>=flightStart+1.6){
    const transit=clamp((seconds-flightStart-1.6)/Math.max(.1,dropStart-flightStart-1.6));
    const clearance=[2.7,2,-.3],destination=[TARGETS[0][0],2,TARGETS[0][2]];
    drone=transit<.42?mix(hover,clearance,ease(transit/.42)):mix(clearance,destination,ease((transit-.42)/.58));
  }
  const segment=(finish-dropStart)/TARGETS.length;
  const drops=TARGETS.map((target,i)=>{
    const release=dropStart+i*segment+.5;
    const age=seconds-release;
    return {target,release,visible:age>=0,position:[target[0],Math.max(.055,1.84-.5*9.81*Math.max(0,age)**2),target[2]],landed:age>=Math.sqrt((1.84-.055)*2/9.81)};
  });
  if(seconds>=dropStart){
    const i=Math.min(TARGETS.length-1,Math.floor((seconds-dropStart)/segment));
    const p=ease((seconds-(dropStart+i*segment)-.85)/Math.max(.1,segment-.85));
    const a=TARGETS[i],b=TARGETS[Math.min(i+1,TARGETS.length-1)];drone=mix([a[0],2,a[2]],[b[0],2,b[2]],p);
  }
  if(seconds>=finish)drone=mix([TARGETS.at(-1)[0],2,TARGETS.at(-1)[2]],[3.6,2.4,-2.5],ease((seconds-finish)/3));
  const approach=ease(seconds/3.3);
  return {seconds,drone,drops,flightStart,dropStart,finish,approach,rotors:clamp((seconds-flightStart+.45)/.7)};
}
module.exports={clamp,ease,mix,TARGETS,missionAt};
