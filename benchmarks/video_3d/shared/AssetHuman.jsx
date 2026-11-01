import React,{useMemo,useLayoutEffect} from 'react';
import {useLoader} from '@react-three/fiber';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';

// Model, motion and scene placement are independent: this actor has no theme logic.
// Absolute clip time and weights make random-frame rendering/backward seeking safe.
export function AssetHuman({src,seconds,motion='Idle',motionSeconds=seconds,blendMotion=null,
  blend=0,position=[0,0,0],yaw=0,controller=false,headYaw=0,headPitch=0}){
  const loaded=useLoader(GLTFLoader,src);
  const state=useMemo(()=>{
    const root=clone(loaded.scene),mixer=new THREE.AnimationMixer(root);
    const actions=Object.fromEntries(loaded.animations.map(c=>[c.name,mixer.clipAction(c)]));
    root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;
      o.material=o.material.clone();if(o.material.map)o.material.map.anisotropy=8;}});
    let remote;
    if(controller){
      remote=new THREE.Group();
      const add=(size,at,color,metalness=0)=>{
        const m=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshStandardMaterial({color,roughness:.4,metalness}));
        m.position.set(...at);m.castShadow=true;remote.add(m);
      };
      add([.43,.055,.24],[0,0,0],'#172b31',.3);
      add([.26,.008,.16],[0,.032,0],'#59bda9',.1);
      for(const x of [-.21,.21]){add([.075,.085,.17],[x,-.014,.015],'#273a3b');add([.018,.035,.018],[x,.05,.025],'#e3aa62');}
      root.add(remote);
    }
    return {root,mixer,actions,remote,head:root.getObjectByName('Head'),left:root.getObjectByName('LeftHand'),right:root.getObjectByName('RightHand')};
  },[loaded,controller]);
  useLayoutEffect(()=>{
    state.mixer.stopAllAction();
    const set=(name,weight)=>{
      const action=state.actions[name];if(!action)throw Error(`Missing human animation: ${name}`);
      action.reset().play();action.setEffectiveWeight(weight);
      const duration=action.getClip().duration;
      const loop=['Idle','Walk','Carry idle','Carry walk'].includes(name);
      action.time=loop?((motionSeconds%duration)+duration)%duration:Math.min(Math.max(motionSeconds,0),duration-.001);
    };
    set(motion,1-blend);if(blendMotion&&blend>0)set(blendMotion,blend);
    state.mixer.update(0);
    if(state.head)state.head.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(headPitch,headYaw,0)));
    state.root.updateMatrixWorld(true);
    if(state.remote&&state.left&&state.right){
      const left=state.root.worldToLocal(state.left.getWorldPosition(new THREE.Vector3()));
      const right=state.root.worldToLocal(state.right.getWorldPosition(new THREE.Vector3()));
      state.remote.position.copy(left.add(right).multiplyScalar(.5)).add(new THREE.Vector3(0,-.015,.08));
      state.remote.rotation.set(-.15,0,0);
    }
  },[state,seconds,motion,motionSeconds,blendMotion,blend,headYaw,headPitch]);
  return <group position={position} rotation={[0,yaw,0]}><primitive object={state.root}/></group>;
}
