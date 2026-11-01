'use strict';
// One spatial/event contract; renderers may improve tessellation and shading.
const { evaluateAnimationTrack } = require('../../../utils/narrative-animation-tracks');
const palette = { dark: '#163b3e', mint: '#95d7bc', cream: '#f3eee0', amber: '#ecb47e', water: '#398eaa', steel: '#65868c' };
function buildModel(sentences, fps, duration) {
  const nodes = [], tracks = [];
  const mesh = (type, color, position, size, extra = {}) => ({type,color,position,size,rotation:[0,0,0],opacity:1,metalness:.12,...extra});
  const box = (color,p,s,extra) => mesh('box',color,p,s,extra);
  function node(id, evidence, si, meshes) {
    nodes.push({id,evidence,evidenceSentenceId:sentences[si].id,label:'',meshes,depth:0,
      layout:{landscape:{x:.5,y:.5,scale:1,rotate:0},portrait:{x:.5,y:.5,scale:1,rotate:0}}});
  }
  const at = (s,p=0) => Math.round(sentences[s].startFrame + (sentences[s].endFrame-sentences[s].startFrame)*p);
  function track(targetId,property,states) {
    const keys=states.map(([frame,value,easing='smooth'])=>({frame,value,easing}));
    tracks.push({targetId,property,keyframes:keys});
  }
  node('foundation','eclusa',0,[box('#274854',[0,-.78,0],[12,.5,4.3]),box('#517275',[0,-.50,-1.72],[12,.12,.7]),box('#517275',[0,-.50,1.72],[12,.12,.7]),
    box('#35515a',[0,.70,-1.38],[6.2,2.5,.35]),box('#65868c',[0,2,-1.38],[6.3,.10,.46]),
    // Front wall is cut low to expose the changing waterline. Not a leaky real lock.
    box('#43636a',[-1.15,-.20,1.38],[3.9,.7,.35]),box('#43636a',[2.15,-.20,1.38],[1.9,.7,.35]),
    // Deliberate opening for the fill conduit, not a pipe crossing solid wall.
    box('#43636a',[1,.10,1.38],[.4,.1,.35]),box('#43636a',[1,-.50,1.38],[.4,.1,.35]),box('#95d7bc',[0,.19,1.38],[6.3,.08,.42]),
    ...[-3.05,3.05].flatMap(x=>[-1.34,1.34].map(z=>box('#66888a',[x,.85,z],[.32,2.65,.52]))),
    ...[-5.4,-4.5,4.5,5.4].map(x=>box('#385a61',[x,-.4,-1.58],[.035,.12,.4]))]);
  node('banks','canal',0,[box('#46615b',[-4.5,.12,-2.04],[2.7,1.5,.62]),box('#57766b',[4.5,.75,-2.04],[2.7,2.75,.62]),
    ...[-5,-4.1,4.4,5.2].flatMap(x=>[mesh('cylinder','#6e6752',[x,1.05,-2.05],[.07,.75,.07]),mesh('sphere','#739f86',[x,1.55,-2.05],[.5,.65,.5])])]);
  node('water-low','água',0,[box(palette.water,[-4.6,-.17,0],[3.05,.74,2.32],{metalness:.3})]);
  node('water-high','água',0,[box(palette.water,[4.6,.51,0],[3.05,2.10,2.32],{metalness:.3})]);
  node('water-chamber','água',0,[box(palette.water,[0,-.17,0],[5.7,.74,2.32],{metalness:.3})]);
  track('water-chamber','scale3d',[[0,[1,1,1]],[at(3,.15),[1,1,1]],[at(4),[1,1.8,1]],[at(5),[1,2.84,1]],[duration,[1,2.84,1]]]);
  // Scale is about the node origin. y offset keeps the bottom at -.54.
  track('water-chamber','position3d',[[0,[0,0,0]],[at(3,.15),[0,0,0]],[at(4),[0,.432,0]],[at(5),[0,.994,0]],[duration,[0,.994,0]]]);
  node('boat','barco',0,[
    mesh('extrude',palette.amber,[-.8,-.12,-.42],[1,1,.84],{points:[[0,0,0],[1.35,0,0],[1.7,.22,0],[1.3,.42,0],[.1,.42,0]]}),
    box(palette.cream,[-.05,.28,0],[1.5,.13,.72]),box(palette.mint,[-.30,.58,0],[.7,.52,.64]),box(palette.cream,[-.30,.88,0],[.83,.10,.74]),
    box('#193b48',[-.32,.66,.328],[.45,.2,.018]),box('#193b48',[-.32,.66,-.328],[.45,.2,.018]),box('#193b48',[.06,.67,0],[.02,.2,.45]),
    mesh('cylinder',palette.steel,[-.52,1.08,0],[.05,.4,.05]),
    ...[-.7,.58].flatMap(x=>[-.28,.28].map(z=>mesh('sphere','#2c4a50',[x,.22,z],[.14,.14,.14]))) ]);
  const boatY0=.2, boatY1=1.56;
  track('boat','position3d',[[0,[-4.8,boatY0,0]],[at(1),[-4.4,boatY0,0]],[at(2),[0,boatY0,0]],[at(3,.15),[0,boatY0,0]],
    [at(4),[0,.792,0]],[at(5),[0,boatY1,0]],[at(6),[0,boatY1,0]],[at(6,.88),[4.8,boatY1,0]],[duration,[5,boatY1,0]]]);
  for(const [gate,x,si,evidence] of [['lower',-2.95,2,'comporta'],['upper',2.95,5,'comporta']]){
    for(const [side,z,dir] of [['near',1.18,-1],['far',-1.18,1]]){
      const id=`gate-${gate}-${side}`;
      node(id,evidence,si,[box(palette.mint,[0,.80,dir*.58],[.14,2.65,1.16]),
        ...[-.35,.35,1.10,1.85].map(y=>box(palette.steel,[-.095,y,dir*.58],[.10,.09,1.12])),
        mesh('cylinder',palette.amber,[0,.85,0],[.16,2.9,.16])]);
      track(id,'position3d',[[0,[x,0,z]],[duration,[x,0,z]]]);
      const angle=gate==='lower'?-dir*Math.PI/2:dir*Math.PI/2;
      track(id,'rotation3d',gate==='lower'?[[0,[0,angle,0]],[at(2,.06),[0,angle,0]],[at(2,.80),[0,0,0]],[duration,[0,0,0]]]:
        [[0,[0,0,0]],[at(5,.35),[0,0,0]],[at(5,.95),[0,angle,0]],[duration,[0,angle,0]]]);
    }
  }
  node('conduit','passagens controladas',3,[mesh('tube',palette.steel,[0,0,0],[.14,1,1],{points:[[4,.6,1.72],[3.5,-.20,1.72],[1,-.20,1.72],[1,-.20,1.0]],metalness:.5}),
    mesh('torus',palette.amber,[2.5,.4,1.72],[.4,.4,.4]),mesh('cylinder',palette.amber,[2.5,.05,1.72],[.06,.55,.06])]);
  const flowMeshes=Array.from({length:12},(_,i)=>mesh('sphere','#b6ece8',[3.6-i*.22,-.19,1.72],[.10,.10,.10]));
  node('flow','água',3,flowMeshes);
  track('flow','opacity',[[0,0],[at(3,.12),0],[at(3,.20),1],[at(5)-4,1],[at(5),0],[duration,0]]);
  track('flow','position3d',[[0,[0,0,0]],[at(3,.20),[0,0,0]],[at(5),[-.5,0,0]],[duration,[-.5,0,0]]]);
  const cameraKeys=[
    [0,[8,7.4,13],[0,.35,0]],[at(1),[5.4,5.7,12],[0,.45,0]],
    [at(2),[-8.5,4.5,3.6],[-.8,.5,0]],[at(3),[-3.9,3.1,7.8],[0,.5,0]],
    [at(3,.55),[3.6,2.0,4.1],[1.5,.1,.6]],[at(4),[1.8,2.0,1.1],[.1,.75,0]],
    [at(4,.75),[0,3.4,7],[0,.8,0]],[at(5),[4.1,4.4,8.6],[0,1,0]],
    [at(6),[5.3,5.7,10.6],[1,1,0]],[duration,[7.8,7.6,13.2],[1,.7,0]]];
  track('camera','position3d',cameraKeys.map(([f,p])=>[f,p]));
  track('camera','target3d',cameraKeys.map(([f,,t])=>[f,t]));
  return {nodes,tracks,fps,durationInFrames:duration,cameraFov:40,palette};
}
function stateAt(model,frame){
  const result={};
  for(const track of model.tracks){(result[track.targetId]||={})[track.property]=evaluateAnimationTrack(track,frame);}
  return result;
}
module.exports={buildModel,stateAt};
