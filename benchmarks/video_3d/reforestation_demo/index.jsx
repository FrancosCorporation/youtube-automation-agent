import React from 'react';
import {registerRoot,Composition,AbsoluteFill,Audio,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import {ApprovedRobotPresenter} from '../../../experiments/remotion-motion-review/src/ApprovedRobotPresenter';
import {Scene} from './Scene';
import motion from './motion.cjs';
import board from './storyboard.json';
import envelope from './audio-envelope.json';
function Episode(){
  const frame=useCurrentFrame(),{width,height}=useVideoConfig(),portrait=height>width;
  const s=motion.missionAt(frame,board);
  const caption=board.sentences.find((v,i)=>frame>=v.startFrame&&frame<(board.sentences[i+1]?.startFrame||board.durationInFrames));
  const stage=frame<board.sentences[2].startFrame?'PREPARAR':frame<board.sentences[3].startFrame?'DECOLAR':frame<board.sentences[4].startFrame?'SEMEAR':'ACOMPANHAR';
  return <AbsoluteFill style={{background:'#b6c7c0',color:'#fff9e9',fontFamily:'Arial,sans-serif'}}>
    <ThreeCanvas width={width} height={height} shadows="percentage" camera={{fov:40,near:.05,far:150}} gl={{antialias:true,toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:.9}}><Scene frame={frame} portrait={portrait}/></ThreeCanvas>
    <div style={{position:'absolute',inset:0,background:'linear-gradient(180deg,rgba(14,34,29,.9) 0%,rgba(14,34,29,0) 25%,rgba(14,34,29,0) 67%,rgba(14,34,29,.94) 100%)',pointerEvents:'none'}}/>
    <div style={{position:'absolute',top:portrait?65:42,left:portrait?55:72,fontWeight:700,fontSize:portrait?24:19,letterSpacing:3,color:'#cce2b2'}}>PULSO • NATUREZA E TECNOLOGIA</div>
    <div style={{position:'absolute',top:portrait?115:85,left:portrait?55:72,width:portrait?940:1450,fontSize:portrait?62:58,lineHeight:1.08,fontWeight:750}}>Uma missão para<br/>semear o futuro</div>
    <div style={{position:'absolute',top:portrait?285:242,left:portrait?55:72,fontSize:portrait?23:18,letterSpacing:2,borderLeft:'3px solid #c9db91',padding:'8px 14px',background:'#16392b99'}}>{stage}</div>
    {s.seconds>s.finish&&<div style={{position:'absolute',right:portrait?50:70,top:portrait?1200:80,width:portrait?215:250,padding:20,background:'#132e27e8',border:'1px solid #bdc89966',borderRadius:12}}>
      <div style={{fontSize:18,color:'#d4e0bc',marginBottom:12}}>PERCURSO DA MISSÃO</div>
      <svg viewBox="0 0 200 130" style={{width:'100%'}}><path d="M20 100 L45 45 L95 20 L145 45 L180 85" fill="none" stroke="#d7d3a5" strokeWidth="3"/>{[[45,45],[95,20],[145,45],[180,85]].map(([x,y],i)=><g key={i}><circle cx={x} cy={y} r="10" fill="#b9d69c"/><path d={`M${x-4} ${y} l3 3 l6 -7`} fill="none" stroke="#29412b" strokeWidth="2"/></g>)}</svg>
      <div style={{fontSize:18,lineHeight:1.3,color:'#f1ead8'}}>Sementes no solo.<br/>Próximo passo: monitorar.</div>
    </div>}
    <ApprovedRobotPresenter src={staticFile('robot.glb')} side="right" accents={{primary:'#b7d59f',secondary:'#dfb981'}}
      gestureCues={{hook:0,explain:board.sentences[1].startFrame,point:board.sentences[2].startFrame,emphasize:board.sentences[3].startFrame,conclusion:board.sentences[4].startFrame}}
      lipSyncEnvelope={envelope.levels} lipSyncFps={1000/envelope.stepMs} canvasSize={portrait?{width:170,height:280}:{width:215,height:355}}
      style={{top:portrait&&stage!=='SEMEAR'?365:'auto',right:35,bottom:portrait?(stage==='SEMEAR'?310:'auto'):170}}/>
    {caption&&<div style={{position:'absolute',left:portrait?55:72,bottom:portrait?150:72,width:portrait?970:1560,boxSizing:'border-box',fontSize:portrait?37:31,lineHeight:1.26,fontWeight:600,padding:'18px 22px',borderLeft:'4px solid #b7d59f',background:'#122c24e8'}}>{caption.text}</div>}
    <div style={{position:'absolute',left:portrait?55:72,bottom:portrait?77:32,fontSize:portrait?19:15,color:'#d5ddc7'}}>CENA FICTÍCIA • DEMONSTRAÇÃO DE ANIMAÇÃO 3D</div>
    <Audio src={staticFile('voice.m4a')}/>
  </AbsoluteFill>;
}
function Root(){return <>{[{id:'ReforestationLandscape',width:1920,height:1080},{id:'ReforestationPortrait',width:1080,height:1920}].map(v=><Composition key={v.id} {...v} component={Episode} fps={30} durationInFrames={board.durationInFrames}/>)}</>;}
registerRoot(Root);
