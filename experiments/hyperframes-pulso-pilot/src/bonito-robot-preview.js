import * as THREE from 'three';
import gsap from 'gsap';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const duration = 8;
const root = document.getElementById('root');
const canvas = document.getElementById('three-layer');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(1040, 1040, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environment = pmrem.fromScene(room, 0.04);
scene.environment = environment.texture;
room.dispose(); pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xf1f8ff, 0x394c64, 1.4));
for (const [color, intensity, position] of [
  [0xfff4e8, 2.8, [3, 6, 5]], [0xb8e6ff, 1.6, [-4, 3, 4]], [0xb4e3ff, 2, [1, 5, -4]]
]) {
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(...position);
  if (position[0] === 3) {
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.left = -3; light.shadow.camera.right = 3;
    light.shadow.camera.top = 5; light.shadow.camera.bottom = -1;
    light.shadow.normalBias = 0.02;
  }
  scene.add(light);
}
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.2 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.015;
floor.receiveShadow = true;
scene.add(floor);
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
const pivot = new THREE.Group();
scene.add(pivot);
const shots = [
  { start: 0, side: 'right', angle: 0, close: false, label: '01 · FRENTE' },
  { start: 2, side: 'left', angle: Math.PI / 2, close: false, label: '02 · PERFIL' },
  { start: 4, side: 'right', angle: Math.PI, close: false, label: '03 · COSTAS' },
  { start: 6, side: 'center', angle: 0, close: true, label: '04 · ROSTO' }
];

function renderAt(seconds) {
  const t = Math.min(duration, Math.max(0, Number(seconds) || 0));
  const shot = shots.findLast(s => s.start <= t);
  root.dataset.presenterSide = shot.side;
  document.querySelector('.footnote').textContent = shot.label;
  pivot.rotation.y = shot.angle + Math.sin((t - shot.start) * 0.7) * 0.1;
  camera.position.set(0, shot.close ? 3.15 : 2.05, shot.close ? 3.8 : 8.5);
  camera.lookAt(0, shot.close ? 3.05 : 2.05, 0);
  renderer.render(scene, camera);
}

async function build() {
  const gltf = await new GLTFLoader().loadAsync('assets/robo-bonito-hunyuan.glb');
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite) || size.y <= 0) throw new Error('GLB sem dimensões válidas');
  const scale = 3.85 / size.y;
  model.scale.multiplyScalar(scale);
  const scaled = new THREE.Box3().setFromObject(model);
  const center = scaled.getCenter(new THREE.Vector3());
  model.position.add(new THREE.Vector3(-center.x, -scaled.min.y, -center.z));
  let meshes = 0, vertices = 0, triangles = 0, skinnedMeshes = 0;
  model.traverse(node => {
    if (!node.isMesh) return;
    meshes++; vertices += node.geometry.attributes.position.count;
    triangles += (node.geometry.index?.count || node.geometry.attributes.position.count) / 3;
    skinnedMeshes += node.isSkinnedMesh ? 1 : 0;
    node.castShadow = true; node.receiveShadow = true;
  });
  pivot.add(model);
  window.generatedRobotModel = model;
  window.generatedRobotMetrics = { sourceSize: size.toArray(), normalizedHeight: 3.85,
    meshes, vertices, triangles, skinnedMeshes, animations: gltf.animations.map(a => ({ name: a.name, duration: a.duration })) };
  await renderer.compileAsync(scene, camera);
  const clock = { time: 0 };
  const timeline = gsap.timeline({ paused: true, onUpdate: () => renderAt(clock.time) });
  timeline.to(clock, { time: duration, duration, ease: 'none' }, 0);
  window.generatedRobotTimeline = timeline;
  window.seekGeneratedRobot = renderAt;
  renderAt(0);
  window.generatedRobotReady = true;
}
window.__hf = window.__hf || {};
window.__hf.buildReady = window.__hf.buildReady || {};
window.__hf.buildReady['pulso-generated-glb'] = build().catch(error => {
  window.generatedRobotError = String(error.stack || error);
  throw error;
});
