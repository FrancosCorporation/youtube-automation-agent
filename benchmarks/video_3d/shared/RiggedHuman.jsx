import React, {useLayoutEffect, useMemo, useRef} from 'react';
import {useLoader} from '@react-three/fiber';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

// The same rig, identity and clothes survive all shots. Clips and IK are sought
// from an absolute timestamp, never accumulated with the browser clock.
export function RiggedHuman({src,seconds,position=[0,0,0],yaw=0,walk=false,distance=0,hands=null,phase=0}) {
  const group=useRef();
  const gltf=useLoader(GLTFLoader,src,(loader)=>loader.setMeshoptDecoder(MeshoptDecoder));
  const data=useMemo(()=>{
    const model=clone(gltf.scene);model.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3());
    const factor=1.75/size.y,center=bounds.getCenter(new THREE.Vector3());
    model.scale.multiplyScalar(factor);model.position.add(new THREE.Vector3(-center.x*factor,-bounds.min.y*factor,-center.z*factor));
    const bones={},rest=[];
    model.traverse((node)=>{
      if(node.isMesh){node.castShadow=true;node.receiveShadow=true;node.frustumCulled=false;}
      if(node.isBone){bones[node.name.replace(/[^a-z]/gi,'').toLowerCase()]=node;rest.push([node,node.position.clone(),node.quaternion.clone(),node.scale.clone()]);}
    });
    const mixer=new THREE.AnimationMixer(model);
    return {model,mixer,bones,rest};
  },[gltf]);
  useLayoutEffect(()=>{
    data.mixer.stopAllAction();
    for(const [bone,p,q,s] of data.rest){bone.position.copy(p);bone.quaternion.copy(q);bone.scale.copy(s);}
    const clip=gltf.animations.find((c)=>c.name.toLowerCase()===(walk?'walk':'idle'));
    if(!clip)throw new Error('Modelo humano precisa de clips Walk e Idle.');
    data.mixer.clipAction(clip).reset().play();
    data.mixer.setTime(walk?(distance/.86)*clip.duration:(seconds+phase)%clip.duration);
    // Travel belongs to the world path, not to the hip track of the source clip.
    const hip=data.rest.find(([bone])=>/hips$/i.test(bone.name));
    if(hip){hip[0].position.x=hip[1].x;hip[0].position.z=hip[1].z;}
    group.current.updateMatrixWorld(true);
    if(hands)for(const side of ['left','right']){
      if(!hands[side])continue;
      const target=group.current.localToWorld(new THREE.Vector3(...hands[side]));
      const hand=data.bones[`mixamorig${side}hand`];
      const chain=[data.bones[`mixamorig${side}forearm`],data.bones[`mixamorig${side}arm`]];
      if(!hand||chain.some((bone)=>!bone))throw new Error('Rig humano sem articulações de braço/mão.');
      for(let iteration=0;iteration<10;iteration++)for(const bone of chain){
        const origin=bone.getWorldPosition(new THREE.Vector3());
        const from=hand.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
        const to=target.clone().sub(origin).normalize();
        const delta=new THREE.Quaternion().setFromUnitVectors(from,to);
        const world=bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
        const parent=bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        bone.quaternion.copy(parent.multiply(world));group.current.updateMatrixWorld(true);
      }
    }
  },[data,gltf,seconds,walk,distance,hands,phase]);
  return <group ref={group} position={position} rotation={[0,yaw,0]}><primitive object={data.model}/></group>;
}
