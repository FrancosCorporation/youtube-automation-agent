import React,{useLayoutEffect,useMemo} from 'react';
import {useLoader} from '@react-three/fiber';
import {staticFile,useCurrentFrame} from 'remotion';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import model from '../../shared/scene.json';
export function Hybrid({state}){
  const frame=useCurrentFrame();
  const wave=useMemo(()=>{const t=new THREE.DataTexture(new Uint8Array(64*64*4),64,64,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(6,3);return t;},[]);
  const asset=useLoader(GLTFLoader,staticFile('lock.blender.glb'));
  const scene=useMemo(()=>asset.scene.clone(true),[asset.scene]);
  useLayoutEffect(()=>{
    for(const n of model.nodes){const o=scene.getObjectByName(n.id);if(!o)throw Error('GLB missing authored group '+n.id);const s=state[n.id]||{};o.position.set(...(s.position3d||[0,0,0]));o.rotation.set(...(s.rotation3d||[0,0,0]));o.scale.set(...(s.scale3d||[1,1,1]));o.visible=(s.opacity??1)>.01;}
    // glTF does not preserve Blender's procedural bump node; rebuild a deterministic
    // water normal map in Three using the same motion parameters as procedural B.
    const data=wave.image.data,tau=Math.PI*2;
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){const k=(y*64+x)*4;data[k]=128+Math.round(3*Math.sin((x+2*y)/64*tau+frame/30*.7)+2*Math.sin((3*x-y)/64*tau-frame/30*.4));data[k+1]=128+Math.round(3*Math.cos((2*x+y)/64*tau+frame/30*.6));data[k+2]=255;data[k+3]=255;}
    wave.needsUpdate=true;
    scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(o.name.startsWith('water')&&o.material.normalMap!==wave){o.material.normalMap=wave;o.material.needsUpdate=true;}}});scene.updateMatrixWorld(true);
  },[scene,state,frame,wave]);
  return <primitive object={scene}/>;
}
