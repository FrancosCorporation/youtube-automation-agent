import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { applyBonitoTheme } from './bonito-theme.js';
import { sampleViseme } from './viseme-track.js';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smooth=(a,b,t)=>{const x=clamp((t-a)/(b-a),0,1);return x*x*(3-2*x);};
const pulse=(t,a,b,c,d)=>smooth(a,b,t)*(1-smooth(c,d,t));
function dynamicPose(seconds, level, duration, seed){
 const t=clamp(Number(seconds)||0,0,duration),voice=clamp(Number(level)||0,0,1);
 const cycle=(t+((Number(seed)>>>0)%5)*.23)%14;
 const greeting=pulse(cycle,.35,1,2.9,3.7);
 const explainL=pulse(cycle,5,5.8,7.7,8.5),explainR=pulse(cycle,7.0,7.8,9.9,10.7);
 const blink=Math.exp(-Math.pow(((t+4.4)%4.8-.18)/.075,2));
 return {time:t,voice,speaking:voice>.035,rootYaw:0,rootY:0,chestZ:Math.sin(t*.7)*.015,
 head:[Math.sin(t*.88)*.025,Math.sin(t*.65)*.12,Math.sin(t*.45)*.025],
 leftArm:[-.06-explainL*.10,-.05+explainL*.12,-.17+greeting*.99+explainL*.52+Math.sin(t*.8)*.025],
 leftElbow:[.03+greeting*.28,greeting*.04,greeting*.85+explainL*.34],
 leftHand:[greeting*.10,greeting*Math.sin(t*7.4)*.20,greeting*Math.sin(t*6.4)*.12],
 rightArm:[-.04-explainR*.12,.035-explainR*.10,.17-explainR*.62-Math.sin(t*.73+.8)*.026],
 rightElbow:[.02+explainR*.16,-.025,-explainR*.42],rightHand:[.01,.03,-explainR*.08],
 eyeY:1-blink*.97,smileY:1,mouthX:.80+voice*.25,mouthY:.10+voice*.88};
}

export async function createBonitoPresenter({canvas,width=710,height=940,assetUrl='assets/pulso-robot.glb',accents=['#22D3EE'],duration=60,seed=0,mouthCues=null}){
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(width, height, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .98;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, .04).texture;
room.dispose(); pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xf1f8ff, 0x394c64, 1.5));
for (const [color, intensity, position] of [
  [0xfff4e8, 2.0, [3, 6, 5]], [0xb8e6ff, 1.3, [-4, 3, 4]], [0xb4e3ff, 1.5, [1, 5, -4]]
]) {
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(...position);
  if (position[0] === 3) {
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.left = -4; light.shadow.camera.right = 4;
    light.shadow.camera.top = 5; light.shadow.camera.bottom = -1;
    light.shadow.normalBias = .02;
  }
  scene.add(light);
}
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: .18 }));
floor.rotation.x = -Math.PI/2; floor.position.y = -.015; floor.receiveShadow = true; scene.add(floor);
const camera = new THREE.PerspectiveCamera(35, width/height, .05, 100);
const character = new THREE.Group(); scene.add(character);
let model, bones, controls, bind, state, pointing=false;
function renderAt(seconds, voiceLevel = 0, mouthShape = null) {
  if (!model) return;
  const p = dynamicPose(seconds, voiceLevel, duration, seed), t = p.time;
  const viseme = mouthShape || sampleViseme(mouthCues,t,voiceLevel);
  if(viseme){p.viseme=viseme.value;p.speaking=!viseme.rest;p.mouthX=viseme.x;p.mouthY=viseme.y;}
  for (const [name, bone] of Object.entries(bones)) {
    bone.position.copy(bind[name].position); bone.quaternion.copy(bind[name].quaternion);
  }
  const set = (name, values) => bones[name].rotation.set(...values);
  set('Root', [0, p.rootYaw, 0]);
  bones.Root.position.y = bind.Root.position.y + p.rootY;
  set('Chest', [0, 0, p.chestZ]); set('Head', p.head);
  set('UpperArm_L', p.leftArm); set('Forearm_L', p.leftElbow); set('Hand_L', p.leftHand);
  set('UpperArm_R', p.rightArm); set('Forearm_R', p.rightElbow); set('Hand_R', p.rightHand);
  if(pointing){set('UpperArm_R',[0,.03,-.9]);set('Forearm_R',[0,0,-.35]);set('Hand_R',[0,0,0]);}
  for (const name of ['FaceEye_L', 'FaceEye_R']) controls[name].scale.y = p.eyeY;
  controls.FaceSmile.visible = !p.speaking; controls.FaceSmile.scale.y = p.smileY;
  controls.FaceMouth.visible = p.speaking;
  controls.FaceMouth.scale.set(p.mouthX, p.mouthY, 1);
  model.updateMatrixWorld(true);
  model.traverse(o => { if (o.isSkinnedMesh) o.skeleton.update(); });
  state = p;
  renderer.render(scene, camera);
}

  const gltf = await new GLTFLoader().loadAsync(assetUrl);
  model = gltf.scene;
  applyBonitoTheme(model, { accents });
  const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
  model.scale.setScalar(3.85/size.y);
  const scaled = new THREE.Box3().setFromObject(model), center = scaled.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -scaled.min.y, -center.z);
  bones = {}; controls = {}; bind = {};
  model.traverse(node => {
    if (node.isBone) {
      bones[node.name] = node;
      bind[node.name] = { position: node.position.clone(), quaternion: node.quaternion.clone() };
    }
    if (node.name.startsWith('Face')) controls[node.name] = node;
    if (node.isMesh) {
      node.castShadow = !node.name.startsWith('Face'); node.receiveShadow = !node.name.startsWith('Face');
      if (node.name.startsWith('Face')) node.material.toneMapped = false;
    }
  });
  for (const name of ['Root', 'Chest', 'Head', 'UpperArm_L', 'Forearm_L', 'Hand_L', 'UpperArm_R', 'Forearm_R', 'Hand_R'])
    if (!bones[name]) throw new Error('Rig missing '+name);
  for (const name of ['FaceEye_L', 'FaceEye_R', 'FaceSmile', 'FaceMouth'])
    if (!controls[name]) throw new Error('Face control missing '+name);
  {
    // Solid mechanical interiors cover the newly separated joint seams.
    const jointMaterial = new THREE.MeshStandardMaterial({color:0x111820,metalness:.65,roughness:.4});
    for (const side of ['L', 'R']) for (const [part, radius] of [['UpperArm', .046], ['Forearm', .046], ['Hand', .032]]) {
      const joint = new THREE.Mesh(new THREE.SphereGeometry(size.y*radius, 32, 20), jointMaterial);
      joint.name = 'MechanicalJoint_'+part+'_'+side;
      joint.castShadow = true; joint.receiveShadow = true;
      bones[part+'_'+side].add(joint);
    }
  }
  character.add(model);

 function setFraming(name){
  if(name==='close'){camera.position.set(0,3.22,5.3);camera.lookAt(0,3.07,0);}
  else if(name==='medium'){camera.position.set(0,2.7,7.2);camera.lookAt(0,2.6,0);}
  else{camera.position.set(0,1.98,10.5);camera.lookAt(0,1.98,0);}
 }
 setFraming('full');renderAt(0);await renderer.compileAsync(scene,camera);
 function dispose(){const geometries=new Set(),materials=new Set(),textures=new Set();
  scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of(Array.isArray(o.material)?o.material:[o.material]))materials.add(m);if(o.isLight&&o.shadow)o.shadow.dispose();});
  for(const m of materials)for(const value of Object.values(m))if(value?.isTexture)textures.add(value);
  textures.add(scene.environment);for(const t of textures)t?.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();renderer.dispose();renderer.forceContextLoss();
 }
 return {renderer,scene,camera,model,bones,controls,renderAt,setFraming,dispose,setPointing(value){pointing=Boolean(value);},get state(){return state;}};
}
