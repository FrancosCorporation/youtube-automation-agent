import React,{useLayoutEffect,useMemo} from 'react';
import {useThree} from '@react-three/fiber';
import {staticFile} from 'remotion';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import {AssetHuman} from '../shared/AssetHuman';
import motion from './motion.cjs';
import board from './storyboard.json';
const {missionAt,ease,mix}=motion;

const mat=(color,roughness=.7,metalness=0)=>({color,roughness,metalness});
function Box({size,position,rotation,color,roughness=.65,metalness=0}){
  return <mesh position={position} rotation={rotation} castShadow receiveShadow><boxGeometry args={size}/><meshStandardMaterial {...mat(color,roughness,metalness)}/></mesh>;
}
function Cylinder({position,rotation,radius,height,color,radial=24}){return <mesh position={position} rotation={rotation} castShadow receiveShadow><cylinderGeometry args={[radius,radius,height,radial]}/><meshStandardMaterial {...mat(color)}/></mesh>;}
function Drone({position,seconds,power}){
  return <group position={position}>
    <mesh castShadow scale={[.38,.13,.28]}><sphereGeometry args={[1,32,20]}/><meshStandardMaterial {...mat('#dfebdc',.32,.2)}/></mesh>
    <Box size={[.28,.11,.28]} position={[0,.09,0]} color="#1d3c3c" metalness={.3}/>
    <Cylinder position={[0,-.19,0]} radius={.13} height={.22} color="#c5a66d"/>
    <mesh position={[0,-.33,0]} rotation={[Math.PI,0,0]} castShadow><coneGeometry args={[.13,.1,24]}/><meshStandardMaterial color="#d3b77d"/></mesh>
    {[-1,1].flatMap(x=>[-1,1].map(z=><group key={`${x}:${z}`}>
      <Box size={[.78,.055,.065]} position={[x*.28,0,z*.28]} rotation={[0,-x*z*Math.PI/4,0]} color="#263b3c" metalness={.5}/>
      <Cylinder position={[x*.55,.02,z*.55]} radius={.065} height={.12} color="#203c3d"/>
      <group position={[x*.55,.09,z*.55]} rotation={[0,seconds*power*110*(x*z),0]}>
        <Box size={[.55,.012,.045]} color="#182b2d" roughness={.35}/>
        <Box size={[.045,.012,.55]} color="#182b2d" roughness={.35}/>
      </group>
      <mesh position={[x*.55,.15,z*.55]}><sphereGeometry args={[.027,12,8]}/><meshStandardMaterial color={x>0?'#efad58':'#60d9b0'} emissive={x>0?'#cc7c22':'#2fa779'} emissiveIntensity={.5}/></mesh>
    </group>))}
    {[-.26,.26].map(x=><group key={x}>
      <Box position={[x,-.24,0]} size={[.035,.4,.035]} rotation={[0,0,x*.5]} color="#263b3c"/>
      <Cylinder position={[x,-.42,0]} rotation={[Math.PI/2,0,0]} radius={.022} height={.6} color="#263b3c"/>
    </group>)}
  </group>;
}
function groundTexture(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#8b8a62';ctx.fillRect(0,0,1024,1024);
  let seed=43;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<24000;i++){
    ctx.fillStyle=['#716e4a55','#afa77b66','#b9af8a44','#59674955'][i%4];
    ctx.beginPath();ctx.ellipse(random()*1024,random()*1024,random()*9+.5,random()*4+.5,random()*Math.PI,0,Math.PI*2);ctx.fill();
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(7,7);texture.anisotropy=8;return texture;
}
function Terrain(){
  const texture=useMemo(groundTexture,[]);
  const foliage=useMemo(()=>{
    const leaves=new THREE.InstancedMesh(new THREE.SphereGeometry(1,12,10),new THREE.MeshStandardMaterial({roughness:.9}),37*28);
    const dummy=new THREE.Object3D();
    for(let i=0;i<37;i++)for(let j=0;j<28;j++){
      const x=(i%13-6)*2.1,z=-7-Math.floor(i/13)*5-(i%3)*.4,s=1+(i%7)*.14;
      const a=j*2.4+i*.7,r=.3+.7*Math.sin(j*8.2)**2;
      dummy.position.set(x+Math.cos(a)*r*s,(2.15+.4*Math.sin(j*2.1)+j/60)*s,z+Math.sin(a)*r*s);
      dummy.scale.set(.34*s,(.27+.15*Math.cos(j)**2)*s,.28*s);dummy.rotation.set(j,0,a);dummy.updateMatrix();
      leaves.setMatrixAt(i*28+j,dummy.matrix);leaves.setColorAt(i*28+j,new THREE.Color(['#526649','#6a7d50','#839360','#3d5940'][(i+j)%4]));
    }
    leaves.castShadow=true;leaves.receiveShadow=true;return leaves;
  },[]);
  return <>
    <mesh rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[150,150]}/><meshStandardMaterial map={texture} roughness={1}/></mesh>
    <primitive object={foliage}/>
    {Array.from({length:37},(_,i)=>{
      const x=(i%13-6)*2.1,z=-7-Math.floor(i/13)*5-(i%3)*.4,s=1+(i%7)*.14;
      return <group key={i} position={[x,0,z]} scale={s}>
        <Cylinder position={[0,1,0]} radius={.11} height={2} color="#514e36" radial={10}/>
        {[-1,1].map(k=><Cylinder key={k} position={[k*.2,1.75,0]} rotation={[0,0,-k*.65]} radius={.045} height={.85} color="#514e36" radial={10}/>)}
      </group>;
    })}
    {Array.from({length:65},(_,i)=>{
      const x=Math.sin(i*74.3)*7,z=Math.cos(i*17.9)*5;
      if(z>-.5&&Math.abs(x)<3.5)return null;
      return <mesh key={i} position={[x,.035,z]} rotation={[0,i,0]} scale={[.06+(i%4)*.025,.035,.05]} castShadow><icosahedronGeometry args={[1,1]}/><meshStandardMaterial color="#b1aa89" roughness={1}/></mesh>;
    })}
    <Cylinder position={[1.6,.025,1.2]} radius={.9} height={.045} color="#cfb873" radial={64}/>
    <mesh position={[1.6,.05,1.2]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.66,.69,64]}/><meshStandardMaterial color="#f0e9d6"/></mesh>
    <Box position={[1.6,.052,1.2]} size={[.06,.01,.38]} color="#f0e9d6"/>
    <Box position={[1.6,.053,1.2]} size={[.3,.01,.06]} color="#f0e9d6"/>
  </>;
}
function Environment({frame,portrait}){
  const {gl,scene,camera}=useThree();
  useLayoutEffect(()=>{
    const generator=new THREE.PMREMGenerator(gl),room=new RoomEnvironment();
    const target=generator.fromScene(room,.04);scene.environment=target.texture;scene.environmentIntensity=.35;
    return ()=>{scene.environment=null;target.dispose();generator.dispose();room.dispose();};
  },[gl,scene]);
  useLayoutEffect(()=>{
    const s=missionAt(frame,board),t=s.seconds;
    const closeStart=board.sentences[1].startFrame/30;
    let pos,target,fov=portrait?44:36;
    if(t<closeStart){pos=portrait?[4.7,3.5,8.8]:[4,2.8,7];target=portrait?[.4,1,-.1]:[0,1,-.2];}
    else if(t<s.flightStart-3.5){
      const p=ease((t-closeStart)/5);
      pos=mix(portrait?[-2.1,1.7,3]:[-2.5,1.72,2.9],portrait?[-2.1,1.65,2.8]:[-2.35,1.65,2.6],p);
      target=[-1.4,1.25,.6];fov=portrait?38:34;
    }else if(t<s.flightStart+1.5){pos=portrait?[.9,1.8,3.5]:[1.5,1.7,3.5];target=portrait?[.15,1.4,.85]:[.15,1.08,.85];fov=portrait?43:38;}
    else if(t<s.dropStart){pos=portrait?[5,4.5,10]:[5.8,3.6,7.2];target=portrait?[.6,1.1,-.2]:[0,1,-.5];if(portrait)fov=54;}
    else if(t<s.finish){
      pos=portrait?[s.drone[0]+2.7,3.0,s.drone[2]+4.1]:[s.drone[0]+3.4,2.9,s.drone[2]+4.3];
      target=[s.drone[0],1.12,s.drone[2]];fov=portrait?50:37;
    }else{pos=portrait?[6.9,6.4,8.1]:[6.5,5.3,7.2];target=[.5,1,-.6];fov=portrait?46:40;}
    camera.position.set(...pos);camera.fov=fov;camera.lookAt(...target);camera.updateProjectionMatrix();
  },[frame,portrait,camera]);
  return <>
    <color attach="background" args={['#b6c7c0']}/><fog attach="fog" args={['#b6c7c0',18,60]}/>
    <hemisphereLight args={['#f2f1dc','#757553',.65]}/>
    <directionalLight position={[-3.5,7,5]} color="#fff0d4" intensity={2.2} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9} shadow-normalBias={.018} shadow-bias={-.0001}/>
    <directionalLight position={[3,4,-5]} color="#d9e9ee" intensity={1.35}/>
  </>;
}
export function Scene({frame,portrait}){
  const s=missionAt(frame,board),walkBlend=ease((s.seconds-2.7)/.6);
  return <>
    <Environment frame={frame} portrait={portrait}/><Terrain/>
    <AssetHuman src={staticFile('humans/field-biologist.glb')} seconds={s.seconds}
      position={[-1.4,0,-1.1+1.7*s.approach]} motion="Walk" motionSeconds={s.seconds>=3.3?s.seconds:1.7*s.approach/1.1} blendMotion="Idle" blend={walkBlend} yaw={.13} headYaw={.24*Math.sin(s.seconds*.45)} headPitch={.09}/>
    <AssetHuman src={staticFile('humans/drone-operator.glb')} seconds={s.seconds}
      position={[.05,0,.65]} motion="Carry idle" yaw={.15} controller headPitch={.18-.24*ease((s.seconds-s.flightStart)/2)} headYaw={.06*Math.sin(s.seconds*.4)}/>
    <Drone position={[s.drone[0],s.drone[1]+.22,s.drone[2]]} seconds={s.seconds} power={s.rotors}/>
    {s.drops.map((drop,i)=><group key={i}>
      <mesh position={[drop.target[0],.014,drop.target[2]]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.22,.235,48]}/><meshStandardMaterial color={drop.landed?'#b4dc99':'#e7d2a1'}/></mesh>
      {drop.visible&&<mesh position={drop.position} castShadow><sphereGeometry args={[.055,16,12]}/><meshStandardMaterial color="#513a22" roughness={1}/></mesh>}
      {drop.landed&&<mesh position={[drop.target[0],.013,drop.target[2]]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.27,.285,48]}/><meshStandardMaterial color="#c8e4b0"/></mesh>}
    </group>)}
  </>;
}
