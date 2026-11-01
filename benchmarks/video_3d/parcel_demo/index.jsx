import React from 'react';
import {registerRoot,Composition,AbsoluteFill,Audio,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import {ApprovedRobotPresenter} from '../../../experiments/remotion-motion-review/src/ApprovedRobotPresenter';
import {ParcelScene,sceneAt} from './ParcelScene';
import board from './storyboard.json';
import envelope from './audio-envelope.json';
function Episode(){
  const frame=useCurrentFrame(),{width,height}=useVideoConfig(),portrait=height>width;
  const sentence=board.captions.find(c=>frame>=c.startFrame&&frame<c.endFrame),{label}=sceneAt(frame);
  const viewport=portrait?{left:40,top:330,width:1000,height:1050}:{left:40,top:240,width:1460,height:620};
  return <AbsoluteFill style={{background:'#0c2531',color:'#f2efdf',fontFamily:'Arial,sans-serif'}}>
    <div style={{position:'absolute',left:portrait?65:100,top:portrait?65:48,fontSize:portrait?27:20,letterSpacing:3,color:'#a2ddbf',fontWeight:750}}>PULSO • CURIOSIDADES</div>
    <div style={{position:'absolute',left:portrait?65:100,top:portrait?125:105,width:portrait?930:1350,fontSize:portrait?64:54,fontWeight:750,lineHeight:1.08}}>Como uma encomenda encontra o caminho até você</div>
    <div style={{position:'absolute',...viewport}}>
      <ThreeCanvas width={viewport.width} height={viewport.height} shadows="percentage" camera={{fov:38,near:.1,far:80}} gl={{antialias:true,toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:1}}><ParcelScene frame={frame} portrait={portrait}/></ThreeCanvas>
      <div style={{position:'absolute',top:18,left:22,padding:'9px 15px',background:'#0b242bdd',color:'#c4e6ce',fontSize:portrait?25:20,fontWeight:700}}>{label}</div>
      <div style={{position:'absolute',bottom:15,left:22,maxWidth:portrait?'70%':undefined,padding:'5px 8px',background:'#0b242bdd',color:'#d2e2d5',fontSize:portrait?18:14}}>ESQUEMA ILUSTRATIVO · PESSOAS FICTÍCIAS · SEM ROTA REAL</div>
    </div>
    <ApprovedRobotPresenter src={staticFile('pulso-story/approved-robot-rigged.glb')} side="right" accents={{primary:'#a2ddbf',secondary:'#e6bb77'}} gestureCues={{hook:0,explain:250,point:690,compare:1000,emphasize:1300,conclusion:1560}} lipSyncEnvelope={envelope.levels} lipSyncFps={1000/envelope.stepMs} canvasSize={portrait?{width:185,height:300}:{width:370,height:620}} style={portrait?{top:1220,right:45}:{top:240,right:50}}/>
    {sentence&&<div style={{position:'absolute',left:portrait?65:100,bottom:portrait?140:105,width:portrait?950:1330,padding:portrait?'24px 28px':'20px 24px',fontSize:portrait?36:29,lineHeight:1.25,fontWeight:650,background:'#061921ed',borderLeft:'5px solid #a2ddbf',boxSizing:'border-box'}}>{sentence.text}</div>}
    <div style={{position:'absolute',left:portrait?65:100,bottom:portrait?60:44,fontSize:portrait?19:15,color:'#b1c8bf'}}>Fontes: Correios · endereçamento, CEP e etapas do envio</div>
    <Audio src={staticFile('parcel/narracao.m4a')}/>
  </AbsoluteFill>;
}
function Root(){return <>{[{id:'ParcelLandscape',width:1920,height:1080},{id:'ParcelPortrait',width:1080,height:1920}].map((v)=><Composition key={v.id} {...v} component={Episode} fps={30} durationInFrames={board.durationInFrames}/>)}</>;}
registerRoot(Root);
