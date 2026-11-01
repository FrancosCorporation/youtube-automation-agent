import * as THREE from 'three';
import gsap from 'gsap';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { poseAt, duration, cues } from './bonito-motion.js';
import { applyBonitoTheme, paletteFor } from './bonito-theme.js';

const root = document.getElementById('root');
const canvas = document.getElementById('three-layer');
const portrait = root.dataset.resolution === 'portrait';
const themed = Boolean(root.dataset.theme);
const palette = paletteFor(root.dataset.theme, Number(root.dataset.paletteSeed || 1));
if (themed) {
  root.style.setProperty('--theme-accent', palette.accents[0]);
  document.querySelector('.brand').textContent = palette.brand.toUpperCase();
}
const width = portrait ? 1080 : 1040, height = portrait ? 1450 : 1040;
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
let model, bones, controls, bind;
const shots = [
  { start: 0, side: 'right', close: false },
  { start: 3.744, side: 'center', close: true },
  { start: 9.904, side: 'center', close: true },
  { start: 14.608, side: 'left', close: false },
  { start: 19.584, side: 'right', close: false },
  { start: 24.336, side: 'center', close: true }
];

function renderAt(seconds) {
  if (!model) return;
  const p = poseAt(seconds), t = p.time;
  for (const [name, bone] of Object.entries(bones)) {
    bone.position.copy(bind[name].position); bone.quaternion.copy(bind[name].quaternion);
  }
  const set = (name, values) => bones[name].rotation.set(...values);
  set('Root', [0, p.rootYaw, 0]);
  bones.Root.position.y = bind.Root.position.y + p.rootY;
  set('Chest', [0, 0, p.chestZ]); set('Head', p.head);
  set('UpperArm_L', p.leftArm); set('Forearm_L', p.leftElbow); set('Hand_L', p.leftHand);
  set('UpperArm_R', p.rightArm); set('Forearm_R', p.rightElbow); set('Hand_R', p.rightHand);
  for (const name of ['FaceEye_L', 'FaceEye_R']) controls[name].scale.y = p.eyeY;
  controls.FaceSmile.visible = !p.speaking; controls.FaceSmile.scale.y = p.smileY;
  controls.FaceMouth.visible = p.speaking;
  controls.FaceMouth.scale.set(p.mouthX, p.mouthY, 1);
  const shot = shots.findLast(s => s.start <= t);
  root.dataset.presenterSide = portrait ? 'center' : shot.side;
  camera.position.set(0, shot.close ? 3.22 : 1.98,
    shot.close ? (portrait ? 5.15 : 4.05) : (portrait ? 10.6 : 8.8));
  camera.lookAt(0, shot.close ? 3.07 : 1.98, 0);
  const cue = cues.find(c => t >= c.start && t < c.end);
  const caption = document.querySelector('.caption');
  caption.textContent = cue?.text || '';
  caption.classList.toggle('has-text', Boolean(cue));
  document.querySelector('.footnote').textContent = p.label;
  model.updateMatrixWorld(true);
  model.traverse(o => { if (o.isSkinnedMesh) o.skeleton.update(); });
  window.pulsoAnimationState = { ...p, shot: shot.start, close: shot.close, caption: cue?.text || '' };
  renderer.render(scene, camera);
}

async function build() {
  const gltf = await new GLTFLoader().loadAsync('assets/robo-bonito-rigged.glb');
  model = gltf.scene;
  if (themed) applyBonitoTheme(model, palette);
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
  if (themed) {
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
  window.pulsoModel = model; window.pulsoBones = bones; window.pulsoControls = controls;
  window.pulsoCamera = camera;
  window.pulsoRenderer = renderer; window.pulsoScene = scene;
  window.pulsoRigMetrics = { bones: Object.keys(bones), faceControls: Object.keys(controls),
    sourceHeight: size.y, normalizedHeight: 3.85, duration, portrait, theme: themed ? palette : null };
  renderAt(0);
  await renderer.compileAsync(scene, camera);
  const clock = { time: 0 };
  const timeline = gsap.timeline({ paused: true, onUpdate: () => renderAt(clock.time) });
  timeline.to(clock, { time: duration, duration, ease: 'none' }, 0);
  window.__timelines = window.__timelines || {};
  window.__timelines['pulso-speaking'] = timeline;
  window.pulsoTimeline = timeline; window.seekPulsoSpeaking = renderAt;
  window.pulsoPoseAt = poseAt; window.pulsoSpeakingReady = true;
}
window.__hf = window.__hf || {}; window.__hf.buildReady = window.__hf.buildReady || {};
window.__hf.buildReady['pulso-speaking-rig'] = build().catch(e => {
  window.pulsoSpeakingError = String(e.stack || e); throw e;
});
