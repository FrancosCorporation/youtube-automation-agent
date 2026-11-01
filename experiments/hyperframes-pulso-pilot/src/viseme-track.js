// Stylized LED equivalents of Rhubarb's basic A–F shapes; X is the smile at rest.
export const MOUTH_SHAPES = Object.freeze({
  A:{x:.92,y:.045}, B:{x:1.04,y:.16}, C:{x:.98,y:.52},
  D:{x:.88,y:.94}, E:{x:.66,y:.53}, F:{x:.43,y:.38}, X:{x:.86,y:.04}
});

export function sampleViseme(track, seconds, voiceLevel=1) {
  const cues = track?.cues || [];
  if (!cues.length) return null;
  const t = Math.max(0,Number(seconds)||0);
  const level = Number(voiceLevel);
  let low=0, high=cues.length-1, index=-1;
  while(low<=high){const mid=(low+high)>>1;if(cues[mid].start<=t){index=mid;low=mid+1;}else high=mid-1;}
  const cue=cues[index];
  if(!cue||t>=cue.end||!Number.isFinite(level)||level<.005)return {value:'X',...MOUTH_SHAPES.X,rest:true};
  const value=MOUTH_SHAPES[cue.value]?cue.value:'X', current=MOUTH_SHAPES[value];
  const previous=cues[index-1];
  const previousIsContinuous=previous&&previous.end>=cue.start-.001;
  const before=previousIsContinuous?(MOUTH_SHAPES[previous.value]||MOUTH_SHAPES.X):MOUTH_SHAPES.X;
  const transition=Math.min(.05,(cue.end-cue.start)/2);
  const blend=transition>0?Math.min(1,(t-cue.start)/transition):1;
  return {value,x:before.x+(current.x-before.x)*blend,y:before.y+(current.y-before.y)*blend,rest:value==='X'};
}
