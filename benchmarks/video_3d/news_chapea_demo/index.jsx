import React from 'react';
import {registerRoot,Composition,AbsoluteFill,Audio,staticFile,useCurrentFrame} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import {ApprovedRobotPresenter} from '../../../experiments/remotion-motion-review/src/ApprovedRobotPresenter';
import {MarsScene} from './MarsHabitatScene';
import board from './storyboard.json';
import envelope from './audio-envelope.json';

function Episode(){
  const frame=useCurrentFrame();
  const sentence=board.captions.find(c=>frame>=c.startFrame&&frame<c.endFrame);
  const progress=frame/Math.max(1,board.durationInFrames-1);
  const gestures={hook:0,explain:285,point:850,compare:1120,emphasize:1410,conclusion:1570};
  return <AbsoluteFill style={{background:'radial-gradient(ellipse at 54% 42%, #193b45 0%, #0c2531 48%, #071821 100%)',color:'#f5f1e7',fontFamily:'Arial,sans-serif',overflow:'hidden'}}>
    <div style={{position:'absolute',left:'5.2%',top:'4.4%',fontSize:20,fontWeight:750,letterSpacing:3,color:'#95d7bc'}}>PULSO • CIÊNCIA</div>
    <div style={{position:'absolute',left:'5.2%',top:'9.4%',fontSize:16,fontWeight:700,letterSpacing:2.2,color:'#adc5c9'}}>NOTÍCIA NASA · MISSÃO CHAPEA 2</div>
    <div style={{position:'absolute',left:'5.2%',top:'12.6%',maxWidth:'67%',fontSize:48,fontWeight:760,lineHeight:1.04,letterSpacing:-.8}}>378 dias vivendo como se estivessem em Marte</div>
    <div style={{position:'absolute',left:'1.6%',top:'23.1%',width:1480,height:665}}>
      <ThreeCanvas width={1480} height={665} shadows="percentage" camera={{position:[7,6,11],fov:38,near:.1,far:120}}
        gl={{alpha:true,antialias:true,toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:1}}
        style={{position:'absolute',inset:0,width:'100%',height:'100%'}}>
        <MarsScene frame={frame}/>
      </ThreeCanvas>
      <div style={{position:'absolute',left:'2.5%',bottom:'3%',padding:'7px 12px',background:'#071821c9',borderRadius:5,color:'#d5e3d7',fontSize:14,letterSpacing:1.1}}>RECONSTRUÇÃO 3D PROCEDURAL · FIGURAS HUMANAS ILUSTRATIVAS</div>
    </div>
    <ApprovedRobotPresenter src={staticFile('pulso-story/approved-robot-rigged.glb')} side="right" accents={{primary:'#95d7bc',secondary:'#ecb47e'}}
      gestureCues={gestures} lipSyncEnvelope={envelope.levels} lipSyncFps={1000/envelope.stepMs}
      canvasSize={{width:390,height:650}} style={{top:225,right:42,zIndex:4}} />
    {sentence&&<div style={{position:'absolute',left:'5.2%',bottom:'8.1%',width:'72%',minHeight:82,padding:'18px 22px',background:'rgba(4,17,24,.94)',borderLeft:'4px solid #95d7bc',borderRadius:'0 9px 9px 0',fontSize:27,fontWeight:650,lineHeight:1.23,zIndex:5,boxSizing:'border-box'}}>{sentence.text}</div>}
    <div style={{position:'absolute',left:'5.2%',bottom:'3.1%',fontSize:13,color:'#aac0bd',letterSpacing:.5}}>Fonte: NASA · 19 e 27 out. 2026 · estudo em habitat terrestre</div>
    <div style={{position:'absolute',left:'5.2%',right:'5.2%',bottom:'1.5%',height:3,background:'#aac0bd33'}}><div style={{width:`${progress*100}%`,height:'100%',background:'#95d7bc'}}/></div>
    <Audio src={staticFile('news-chapea/narracao.m4a')}/>
  </AbsoluteFill>;
}
function Root(){return <Composition id="NewsChapeaProcedural" component={Episode} width={board.width} height={board.height} fps={board.fps} durationInFrames={board.durationInFrames}/>;}
registerRoot(Root);
