import React, {useLayoutEffect} from 'react';
import {useThree} from '@react-three/fiber';
import * as THREE from 'three';

const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const smooth=(n)=>{n=clamp(n);return n*n*(3-2*n);};
const mix=(a,b,t)=>a+(b-a)*t;
const V=(a,b,t)=>a.map((x,i)=>mix(x,b[i],t));
const CAMERAS=[
  {time:0,p:[8,7,13],t:[0,1,0]},
  {time:9,p:[5,4.8,10],t:[0,1.1,0]},
  {time:18,p:[-1,3.4,7],t:[-1.5,1.1,.1]},
  {time:27,p:[-2.6,2.8,6],t:[-2,1,.4]},
  {time:37,p:[2.5,3.5,8],t:[1,1,0]},
  {time:46,p:[7,4.1,9],t:[3,1,.5]},
  {time:53,p:[9,6.3,12],t:[0,1,0]},
  {time:60,p:[8,7,13],t:[0,1,0]},
];
function cameraAt(seconds){let i=1;while(i<CAMERAS.length-1&&seconds>CAMERAS[i].time)i++;const a=CAMERAS[i-1],b=CAMERAS[i],p=smooth((seconds-a.time)/(b.time-a.time));return {position:V(a.p,b.p,p),target:V(a.t,b.t,p)};}
function Camera({frame}){const {camera}=useThree();useLayoutEffect(()=>{const c=cameraAt(frame/30);camera.position.set(...c.position);camera.lookAt(...c.target);camera.updateProjectionMatrix();camera.updateMatrixWorld();},[camera,frame]);return null;}
function Box({p,s,color,roughness=.68,radius=false,opacity=1}){return <mesh position={p} scale={s} castShadow receiveShadow><boxGeometry args={[1,1,1]}/><meshStandardMaterial color={color} roughness={roughness} transparent={opacity<1} opacity={opacity} depthWrite={opacity>=.95}/></mesh>;}
function Sphere({p,s,color,roughness=.55,metalness=0,opacity=1}){return <mesh position={p} scale={s} castShadow receiveShadow><sphereGeometry args={[1,20,14]}/><meshStandardMaterial color={color} roughness={roughness} metalness={metalness} transparent={opacity<1} opacity={opacity} depthWrite={opacity>=.95}/></mesh>;}
function Cylinder({p,s,color,rotation=[0,0,0],roughness=.65}){return <mesh position={p} scale={s} rotation={rotation} castShadow receiveShadow><cylinderGeometry args={[.5,.5,1,20]}/><meshStandardMaterial color={color} roughness={roughness}/></mesh>;}
function Human({x,z,skin,suit=false,reach=0,walk=0,opacity=1,scale=1}){
  const stride=Math.sin(walk*Math.PI*4)*.28;
  const armA=reach*.72,armB=reach*.55;
  const cloth=suit?'#e6e5d9':['#4c91a1','#d58b5c','#738b64','#aa7aaf'][Math.abs(Math.round(x*10))%4];
  return <group position={[x,-.05,z]} scale={scale} visible={opacity>.02}>
    <group position={[0,0,0]}>
      <mesh position={[0,1.05,0]} scale={[1,.91,.7]} castShadow receiveShadow><capsuleGeometry args={[.24,.43,5,10]}/><meshStandardMaterial color={cloth}/></mesh>
      <Cylinder p={[0,1.48,0]} s={[.15,.18,.15]} color={skin}/>
      {suit?<><Sphere p={[0,1.85,0]} s={[.36,.39,.34]} color="#d5e5df" roughness={.32}/><Sphere p={[0,1.85,.265]} s={[.255,.245,.095]} color="#315564" roughness={.2} metalness={.12}/><Box p={[0,.98,-.25]} s={[.39,.47,.23]} color="#aeb9b1"/></>:<><Sphere p={[0,1.83,0]} s={[.25,.29,.24]} color={skin}/><Sphere p={[0,2.02,-.015]} s={[.255,.15,.25]} color="#373436"/></>}
      {!suit&&<><Sphere p={[-.087,1.86,.203]} s={[.035,.045,.025]} color="#17252a"/><Sphere p={[.087,1.86,.203]} s={[.035,.045,.025]} color="#17252a"/><Sphere p={[0,1.81,.232]} s={[.035,.045,.035]} color={skin}/></>}
      <group position={[-.27,1.32,0]} rotation={[0,0,armA]}><mesh position={[0,-.22,0]}><capsuleGeometry args={[.095,.34,4,8]}/><meshStandardMaterial color={cloth}/></mesh><Sphere p={[0,-.47,.015]} s={[.12,.12,.12]} color={suit?'#b6c3bd':skin}/></group>
      <group position={[.27,1.32,0]} rotation={[0,0,-armB]}><mesh position={[0,-.22,0]}><capsuleGeometry args={[.095,.34,4,8]}/><meshStandardMaterial color={cloth}/></mesh><Sphere p={[0,-.47,.015]} s={[.12,.12,.12]} color={suit?'#b6c3bd':skin}/></group>
      <group position={[-.12,.62,0]} rotation={[0,0,stride]}><mesh position={[0,-.22,0]}><capsuleGeometry args={[.115,.39,4,8]}/><meshStandardMaterial color={suit?'#c9d2cc':'#283c49'}/></mesh><Box p={[0,-.51,.06]} s={[.21,.12,.35]} color="#273840"/></group>
      <group position={[.12,.62,0]} rotation={[0,0,-stride]}><mesh position={[0,-.22,0]}><capsuleGeometry args={[.115,.39,4,8]}/><meshStandardMaterial color={suit?'#c9d2cc':'#283c49'}/></mesh><Box p={[0,-.51,.06]} s={[.21,.12,.35]} color="#273840"/></group>
      {suit&&<><Box p={[0,1.37,-.28]} s={[.34,.43,.18]} color="#8c9da0"/><Cylinder p={[-.3,1.32,0]} s={[.14,.22,.15]} color="#6d858a"/><Cylinder p={[.3,1.32,0]} s={[.14,.22,.15]} color="#6d858a"/></>}
    </group>
  </group>;
}
function PlantBed({x,z,active}){return <group position={[x,0,z]}>
  <Box p={[0,.28,0]} s={[1.5,.45,.82]} color="#74583c"/><Box p={[0,.53,0]} s={[1.42,.08,.74]} color="#4a4334"/>
  {[0,1,2,3,4].map(i=>{const xx=(i-2)*.22,h=.38+(i%2)*.1;return <group key={i} position={[xx,.57,((i%2)-.5)*.25]}>
    <Cylinder p={[0,h/2,0]} s={[.035,h,.035]} color="#74a576"/>
    <Sphere p={[-.09,h*.62,0]} s={[.16,.08,.07]} color={active?'#9ecb79':'#739b72'}/><Sphere p={[.09,h*.83,.01]} s={[.16,.08,.07]} color="#82b17d"/>
  </group>;})}
</group>;}
function MarsScene({frame}){
  const seconds=frame/30;
  const eva=smooth((seconds-40)/3)*(1-smooth((seconds-51)/2));
  const message=smooth((seconds-29)/1.5)*(1-smooth((seconds-36)/1.5));
  const packetT=clamp((seconds-30)/5);
  const egress=smooth((seconds-47)/2);
  const commCurve=new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.15,1.75,.92),
    new THREE.Vector3(1.75,2.55,1.7),
    new THREE.Vector3(2.8,2.8,1.05),
    new THREE.Vector3(3.5,2.75,-.2),
  ]);
  return <>
    <Camera frame={frame}/>
    <color attach="background" args={['#101d2b']}/>
    <ambientLight intensity={.82}/><hemisphereLight args={['#ffe4ca','#452b36',1.15]}/>
    <directionalLight position={[-5,9,7]} color="#ffe2bb" intensity={2.4} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048}/>
    <directionalLight position={[6,5,-4]} color="#82bad0" intensity={1.05}/>
    {/* Martian terrain and a clean cutaway habitat let the viewer read the interior. */}
    <mesh position={[0,-.225,-4]} rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[200,200]}/><meshStandardMaterial color="#9c503e" roughness={1}/></mesh>
    <Sphere p={[-7,5,-9]} s={[1.1,1.1,1.1]} color="#d8795c" roughness={1}/>
    <Box p={[0,-.04,0]} s={[7.4,.2,4.1]} color="#c9bd9e"/>
    <Box p={[-3.55,.95,-.02]} s={[.2,2,.3]} color="#cfc9b9"/><Box p={[-3.3,1.94,-.02]} s={[.65,.14,.3]} color="#cfc9b9"/>
    <Box p={[-.5,1.72,-1.9]} s={[6.05,.2,.18]} color="#d6d0c3"/>
    <Box p={[0,.84,-1.92]} s={[6.05,1.66,.18]} color="#c5c2b5"/>
    <Box p={[3.54,.94,-.1]} s={[.2,1.95,3.72]} color="#c6c2b8"/>
    {/* Printed ribs and roof arch communicate the 3D-printed habitat without blocking the cutaway. */}
    {[-2.5,-1.25,0,1.25,2.5].map((x,i)=><mesh key={i} position={[x,.25,-2.15]} rotation={[0,Math.PI/2,0]}><torusGeometry args={[1.65,.035,8,36,Math.PI]}/><meshStandardMaterial color="#e0d9c8" roughness={.5}/></mesh>)}
    <Box p={[3.62,1.01,.95]} s={[.08,1.32,.88]} color="#71969b" opacity={mix(.5,1,egress)}/>
    <Box p={[3.75,1.02,1.12]} s={[.1,1.34,.12]} color="#e8bd74" opacity={egress}/>
    <PlantBed x={-2.45} z={.62} active={seconds>12&&seconds<27}/><PlantBed x={-1.35} z={.62} active={seconds>12&&seconds<27}/>
    <Box p={[1.15,.47,.75]} s={[1.8,.16,.72]} color="#71614e"/><Box p={[1.15,1.17,.73]} s={[1.62,1.15,.12]} color="#294553"/>
    {[0,1,2].map(i=><group key={i} position={[.63+i*.5,1.18,.65]}><Box p={[0,0,.08]} s={[.32,.48,.035]} color="#426c70"/><Box p={[0,-.08,.11]} s={[.21,.055,.02]} color={i===0?'#86bd8d':i===1?'#dfb36e':'#8fadc1'}/><Box p={[0,.08,.11]} s={[.19,.035,.02]} color="#d6e3cf"/></group>)}
    <PlantBed x={-2.1} z={-1.15} active={seconds>13&&seconds<27}/>
    <Box p={[-2.7,.58,-1.27]} s={[.86,.12,.7]} color="#70898a"/><Box p={[-2.7,.98,-1.53]} s={[.75,.7,.08]} color="#45616b"/>
    <Cylinder p={[3.17,2.18,-1.2]} s={[.12,.42,.12]} color="#d6c9a9"/>
    <Cylinder p={[3.17,2.45,-1.2]} s={[.5,.06,.5]} color="#83b9c4" rotation={[0,0,.25]}/>
    <Sphere p={[3.5,2.75,-.2]} s={[.48,.48,.48]} color="#4d9dce" roughness={.35} opacity={message}/>
    <Sphere p={[3.37,2.82,.205]} s={[.15,.16,.075]} color="#6fb26c" opacity={message}/>
    {message>.01&&<><mesh><tubeGeometry args={[commCurve,48,.03,8,false]}/><meshBasicMaterial color="#87e5da" transparent opacity={.9*message}/></mesh><Sphere p={commCurve.getPoint(packetT).toArray()} s={[.13,.13,.13]} color="#fff1ae"/></>}
    {[0,1,2,3].map(i=>{
      const xs=[-2.65,-.75,.75,2.12],skins=['#9d674e','#e3b589','#c88766','#684936'];
      if(i===3)return <React.Fragment key={i}><group visible={seconds<40}><Human x={xs[i]} z={.92} skin={skins[i]} reach={seconds>13&&seconds<24?.65:.12}/></group><group visible={seconds>=40}><Human x={mix(xs[i],4.75,eva)} z={mix(.8,2.2,eva)} skin={skins[i]} suit walk={eva} reach={.35} opacity={Math.max(.02,eva)}/></group></React.Fragment>;
      const reach=i===0&&seconds>13&&seconds<27?.8:i===1&&seconds>30&&seconds<38?.55:i===2&&seconds>22&&seconds<35?.36:.1;
      return <Human key={i} x={xs[i]} z={i===1?-.2:.92} skin={skins[i]} reach={reach} scale={i===2?.94:1}/>;
    })}
    {seconds>47&&<><Sphere p={[4.15,.8,2.35]} s={[.14,.14,.14]} color="#e2b584"/><Box p={[4.58,.21,2.35]} s={[.72,.28,.42]} color="#b66448"/><Box p={[4.26,.18,2.35]} s={[.13,.36,.08]} color="#e1ba81"/></>}
  </>;
}

export {MarsScene};
