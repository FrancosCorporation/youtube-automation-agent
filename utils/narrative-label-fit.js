'use strict';

function narrativeLabelMaxWidth({ x, width, spacing, margin = 18 }) {
  if (![x, width, spacing, margin].every(Number.isFinite) || width <= 0 || spacing <= 0 || margin < 0) {
    throw new TypeError('geometria de rótulo inválida');
  }
  return Math.max(1, Math.min(spacing - margin, 2 * (x - margin), 2 * (width - x - margin)));
}

// Pure screen-space placement: repeat/backward seeks produce the same labels.
// Candidate positions hug projected anchors, then try the edges of previously
// placed boxes. Reserve room above the illustration footer and captions.
function placeProjectedLabels(labels, width, height, gap = 8, excluded = []) {
  const placed = [];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const overlap = (a, b) => Math.max(0, Math.min(a.x+a.width+gap,b.x+b.width+gap)-Math.max(a.x,b.x))
    * Math.max(0,Math.min(a.y+a.height+gap,b.y+b.height+gap)-Math.max(a.y,b.y));
  for (const label of labels) {
    const w = Math.min(label.width,width-2*gap), h=label.height;
    const origin={x:clamp(label.x-w/2,gap,width-w-gap),y:clamp(label.y,gap,height-h-gap)};
    const obstacles = [...excluded, ...placed];
    const xs=[origin.x,...obstacles.flatMap(p=>[p.x-w-gap,p.x+p.width+gap])];
    const ys=[origin.y,...obstacles.flatMap(p=>[p.y-h-gap,p.y+p.height+gap])];
    let best, score=Infinity;
    for(const x of xs)for(const y of ys){
      if(x<gap||y<gap||x+w>width-gap||y+h>height-gap)continue;
      const box={...label,x,y,width:w,height:h};
      const cost=obstacles.reduce((s,p)=>s+overlap(box,p)*1e6,0)+(x-origin.x)**2+(y-origin.y)**2;
      if(cost<score){best=box;score=cost;}
    }
    placed.push(best||{...label,...origin,width:w,height:h});
  }
  return placed;
}

module.exports = { narrativeLabelMaxWidth, placeProjectedLabels };
