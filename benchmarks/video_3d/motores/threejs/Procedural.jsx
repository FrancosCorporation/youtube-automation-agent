import React,{useMemo,useLayoutEffect} from 'react';
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import model from '../../shared/scene.json';
function geometryFor(m){
  switch(m.type){
    case 'box':return new RoundedBoxGeometry(1,1,1,3,.045);
    case 'sphere':return new THREE.SphereGeometry(.5,32,24);
    case 'cylinder':return new THREE.CylinderGeometry(.5,.5,1,40);
    case 'torus':return new THREE.TorusGeometry(.5,.12,16,56);
    case 'tube':return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(m.points.map(p=>new THREE.Vector3(...p))),64,m.size[0],12,false);
    case 'extrude':{const s=new THREE.Shape();m.points.forEach((p,i)=>i?s.lineTo(p[0],p[1]):s.moveTo(p[0],p[1]));s.closePath();return new THREE.ExtrudeGeometry(s,{depth:m.size[2],bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.035,bevelThickness:.025});}
    default:throw Error('Unknown geometry '+m.type);
  }
}
function Part({m,id,frame}){
  const geo=useMemo(()=>geometryFor(m),[m]);
  const scale=m.type==='tube'?[1,1,1]:m.type==='extrude'?[m.size[0],m.size[1],1]:m.size;
  const water=id.startsWith('water');
  const wave=useMemo(()=>{if(!water)return null;const data=new Uint8Array(64*64*4);const t=new THREE.DataTexture(data,64,64,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(6,3);return t;},[water]);
  const mat=useMemo(()=>new THREE.MeshPhysicalMaterial({color:m.color,roughness:water?.20:.36,metalness:water?.32:m.metalness,clearcoat:water?.65:.12,clearcoatRoughness:.2,transparent:m.opacity<1,opacity:m.opacity}),[m,water]);
  useLayoutEffect(()=>{if(!wave)return;const data=wave.image.data;const tau=Math.PI*2;for(let y=0;y<64;y++)for(let x=0;x<64;x++){const k=(y*64+x)*4;data[k]=128+Math.round(3*Math.sin((x+2*y)/64*tau+frame/30*.7)+2*Math.sin((3*x-y)/64*tau-frame/30*.4));data[k+1]=128+Math.round(3*Math.cos((2*x+y)/64*tau+frame/30*.6));data[k+2]=255;data[k+3]=255;}wave.needsUpdate=true;if(mat.normalMap!==wave){mat.normalMap=wave;mat.needsUpdate=true;}},[frame,wave,mat]);
  return <mesh geometry={geo} material={mat} position={m.position} rotation={m.rotation} scale={scale} castShadow receiveShadow/>;
}
export function Procedural({state,frame}){
  return model.nodes.map(n=>{const s=state[n.id]||{};return <group key={n.id} position={s.position3d||[0,0,0]} rotation={s.rotation3d||[0,0,0]} scale={s.scale3d||[1,1,1]} visible={(s.opacity??1)>.01}>{n.meshes.map((m,i)=><Part key={i} m={m} id={n.id} frame={frame}/>)}</group>});
}
