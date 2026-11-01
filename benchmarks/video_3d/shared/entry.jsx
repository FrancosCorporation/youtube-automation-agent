import React,{useLayoutEffect} from 'react';
import {registerRoot,Composition,AbsoluteFill,useCurrentFrame,staticFile,Audio,Img} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import {useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {Procedural} from '../motores/threejs/Procedural';
import {Hybrid} from '../motores/hibrido/Hybrid';
import board from '../roteiro/storyboard.json';
import model from './scene.json';
import {stateAt} from './model.cjs';

const WIDTH=1690,HEIGHT=670;
function StudioLight(){
  const {gl,scene}=useThree();
  useLayoutEffect(()=>{const room=new RoomEnvironment();const pmrem=new THREE.PMREMGenerator(gl);const target=pmrem.fromScene(room,.04);scene.environment=target.texture;scene.environmentIntensity=.45;return()=>{scene.environment=null;target.dispose();room.dispose();pmrem.dispose();};},[gl,scene]);
  return null;
}
function Camera({state}){
  const {camera}=useThree();
  useLayoutEffect(()=>{camera.position.set(...state.position3d);camera.lookAt(...state.target3d);camera.fov=model.cameraFov;camera.updateProjectionMatrix();camera.updateMatrixWorld();},[camera,state]);
  return null;
}
function Graphics({engine}){
  const frame=useCurrentFrame(),state=stateAt(model,frame);
  if(engine==='C')return <Img src={staticFile(`blender-frames/${String(frame+1).padStart(5,'0')}.png`)} style={{width:WIDTH,height:HEIGHT}}/>;
  return <ThreeCanvas width={WIDTH} height={HEIGHT} shadows camera={{position:state.camera.position3d,fov:model.cameraFov,near:.05,far:100}}
    gl={{alpha:true,antialias:true,toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:1}}>
    <Camera state={state.camera}/><StudioLight/><ambientLight intensity={.65}/><hemisphereLight args={['#e5f4ef','#1e3546',1.4]}/>
    <directionalLight position={[-4,8,6]} color="#fff1d1" intensity={3} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={6} shadow-camera-bottom={-6} shadow-bias={-.0003}/>
    <directionalLight position={[6,3,-4]} color="#80d5cf" intensity={1.6}/>
    {engine==='D'?<Hybrid state={state}/>:<Procedural state={state} frame={frame}/>}
  </ThreeCanvas>;
}
function Benchmark({engine}){
  const f=useCurrentFrame();const caption=board.captions.find(c=>f>=c.startFrame&&f<c.endFrame)||board.captions[0];
  return <AbsoluteFill style={{background:'radial-gradient(ellipse at 65% 45%, #173c46 0%, #0c2632 42%, #081923 80%)',color:'#f5f3e9',fontFamily:'Arial, sans-serif'}}>
    <div style={{position:'absolute',left:'6%',top:'5.2%',fontSize:23,fontWeight:700,letterSpacing:3,color:'#95d7bc'}}>PULSO / EXPLICA</div>
    <div style={{position:'absolute',left:'6%',top:'10.5%',maxWidth:'57%'}}><div style={{fontSize:18,letterSpacing:2.6,color:'#adc5c9',fontWeight:700,marginBottom:12}}>ENGENHARIA</div><div style={{fontSize:58,fontWeight:750,lineHeight:1.08,letterSpacing:-1}}>{board.title}</div></div>
    <div style={{position:'absolute',left:'3%',top:'22%',width:WIDTH,height:HEIGHT}}><Graphics engine={engine}/><div style={{position:'absolute',bottom:'8%',left:'3%',fontSize:18,letterSpacing:1.5,color:'#a2bbb0'}}>ILUSTRAÇÃO 3D • ESQUEMA EXPLICATIVO</div></div>
    <div style={{position:'absolute',left:'6%',bottom:'7.5%',maxWidth:'62%',padding:'16px 22px',borderLeft:'4px solid #95d7bc',borderRadius:'0 8px 8px 0',background:'rgba(4,17,24,.93)',color:'#f5f4ea',fontSize:30,fontWeight:650,lineHeight:1.25}}>{caption.text}</div>
    <div style={{position:'absolute',left:'6%',right:'6%',bottom:'2.5%',height:3,background:'rgba(160,201,197,.2)'}}><div style={{width:`${f/(board.durationInFrames-1)*100}%`,height:'100%',background:'#95d7bc'}}/></div>
    <Audio src={staticFile('_runtime/video-3d-benchmark/episode-audio.m4a')}/>
  </AbsoluteFill>;
}
function Root(){return <>{['B','C','D'].map(engine=><Composition key={engine} id={`Benchmark${engine}`} component={Benchmark} defaultProps={{engine}} durationInFrames={board.durationInFrames} fps={30} width={1920} height={1080}/>)}</>}
registerRoot(Root);
