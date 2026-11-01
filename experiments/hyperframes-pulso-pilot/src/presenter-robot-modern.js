import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createPresenterRobot({ canvas, width = 710, height = 940, seed = 0, accents = [] }) {
  if (!canvas) throw new Error('Canvas do mascote 3D não encontrado');
  const palette = accents.length ? accents : ['#55d8ff', '#a7edff', '#40b8e5', '#b3e5fa'];
  const colorHex = (value, fallback) => new THREE.Color(value || fallback).getHex();
  const look = {
    eye: colorHex(palette[1], '#a9efcf'),
    eyeGlow: colorHex(palette[0], '#4dbd9e'),
    mouth: colorHex(palette[3], '#f3bc7d'),
    mouthGlow: colorHex(palette[3], '#b75c24'),
    accent: colorHex(palette[2], '#559d8c')
  };
  const motionPhase = ((Number(seed) >>> 0) % 997) / 997 * Math.PI * 2;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
  camera.position.set(0.06, 1.86, 7.8);
  camera.lookAt(0.06, 1.7, 0);

  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environment, 0.04).texture;
  scene.environmentIntensity = 0.48;
  environment.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xf0f6ff, 0x182538, 1.1));
  const keyLight = new THREE.DirectionalLight(0xf1f5ff, 3.2);
  keyLight.position.set(-3.5, 7.0, 5.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -3;
  keyLight.shadow.camera.right = 3;
  keyLight.shadow.camera.top = 5;
  keyLight.shadow.camera.bottom = -2;
  keyLight.shadow.normalBias = 0.035;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x9dcaff, 1.6);
  fillLight.position.set(4.0, 3.7, 2.4);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0x84ddff, 3.0);
  rimLight.position.set(0.5, 5.0, -4.0);
  scene.add(rimLight);

  const ceramic = new THREE.MeshPhysicalMaterial({ color: 0xe6edf5, metalness: 0.08, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const ceramicLight = new THREE.MeshPhysicalMaterial({ color: 0xf2f6fa, metalness: 0.08, roughness: 0.24, clearcoat: 0.85, clearcoatRoughness: 0.14 });
  const graphite = new THREE.MeshStandardMaterial({ color: 0x17232f, metalness: 0.7, roughness: 0.3 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x597180, metalness: 0.88, roughness: 0.27 });
  const accent = new THREE.MeshStandardMaterial({ color: look.accent, metalness: 0.22, roughness: 0.26, emissive: look.accent, emissiveIntensity: 0.65 });
  const titanium = new THREE.MeshStandardMaterial({ color: 0x788694, metalness: 0.85, roughness: 0.25 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x07121d, metalness: 0.32, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.07 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: look.eye, metalness: 0.0, roughness: 0.25, emissive: look.eyeGlow, emissiveIntensity: 0.9 });
  const eyeCore = new THREE.MeshStandardMaterial({ color: 0x0b283b, metalness: 0.2, roughness: 0.2 });
  const catchlight = new THREE.MeshBasicMaterial({ color: 0xf4fbff });
  const cheekMaterial = new THREE.MeshStandardMaterial({ color: 0x65d9f0, metalness: 0.15, roughness: 0.35, emissive: 0x228cba, emissiveIntensity: 0.2 });
  const mouthMaterial = new THREE.MeshStandardMaterial({ color: 0xabeaff, metalness: 0, roughness: 0.2, emissive: 0x39b6db, emissiveIntensity: 0.9 });

  const robot = new THREE.Group();
  robot.scale.setScalar(0.96);
  robot.position.set(0.06, -0.48, 0);
  scene.add(robot);

  const shadowMaterial = new THREE.ShadowMaterial({ opacity: 0.2 });
  const robotShadow = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), shadowMaterial);
  robotShadow.rotation.x = -Math.PI / 2;
  robotShadow.position.set(0.06, -0.52, 0);
  robotShadow.receiveShadow = true;
  scene.add(robotShadow);

  function roundedBox(parent, size, radius, material, position, rotation = [0, 0, 0], segments = 5) {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(size[0], size[1], size[2], segments, radius), material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function sphere(parent, size, material, position, segments = 28) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segments, Math.max(16, segments >> 1)), material);
    mesh.scale.set(...size);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function capsule(parent, radius, length, material, position, rotation = [0, 0, 0]) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 7, 20), material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function tubeStroke(parent, points, radius, material) {
    const path = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 28, radius, 8, false), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  // Hip/waist assembly: separated joints read as articulated machinery, not a flat mascot sprite.
  sphere(robot, [0.35, 0.19, 0.25], graphite, [0, 1.52, 0]);
  roundedBox(robot, [0.76, 0.44, 0.49], 0.18, ceramicLight, [0, 1.72, 0]);
  const torso = roundedBox(robot, [1.06, 1.17, 0.66], 0.25, ceramicLight, [0, 2.43, 0], [0.01, -0.04, 0], 8);
  const positions = torso.geometry.attributes.position;
  const normals = torso.geometry.attributes.normal;
  const normal = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    const taper = 0.85 + 0.15 * (positions.getY(i) / 1.17 + 0.5);
    const originalX = positions.getX(i);
    const correctedX = normals.getX(i) / taper;
    normal.set(correctedX, normals.getY(i) - originalX * (0.15 / 1.17) * correctedX, normals.getZ(i)).normalize();
    normals.setXYZ(i, normal.x, normal.y, normal.z);
    positions.setX(i, positions.getX(i) * taper);
  }
  roundedBox(robot, [0.62, 0.57, 0.085], 0.16, glass, [0, 2.48, 0.354], [0, 0, 0], 8);
  const pulseRing = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.012, 12, 80), titanium);
  pulseRing.position.set(0, 2.48, 0.405);
  robot.add(pulseRing);
  for (let i = 0; i < 3; i++) {
    roundedBox(robot, [0.032, [0.1, 0.22, 0.15][i], 0.025], 0.013, accent, [(i - 1) * 0.067, 2.48, 0.414]);
  }
  roundedBox(robot, [0.28, 0.023, 0.024], 0.01, titanium, [0, 2.075, 0.327]);
  for (const x of [-0.105, 0, 0.105]) sphere(robot, [0.023, 0.023, 0.018], x === 0 ? titanium : accent, [x, 2.91, 0.34], 18);
  // Small mechanical seams and side vents add scale and material contrast.
  for (const side of [-1, 1]) {
    roundedBox(robot, [0.035, 0.29, 0.042], 0.017, graphite, [side * 0.54, 2.47, 0.29]);
    sphere(robot, [0.055, 0.055, 0.035], titanium, [side * 0.56, 2.63, 0.31], 18);
  }

  // Neck and head: porcelain shell, deep curved visor, emissive eyes and a mouth that changes expression.
  capsule(robot, 0.155, 0.14, titanium, [0, 3.13, 0]);
  const head = new THREE.Group();
  head.position.set(0, 3.65, 0);
  robot.add(head);
  roundedBox(head, [1.04, 0.84, 0.73], 0.3, ceramicLight, [0, 0, 0], [0, -0.045, 0], 8);
  roundedBox(head, [0.91, 0.535, 0.115], 0.2, graphite, [0, -0.015, 0.339], [0, 0, 0], 8);
  roundedBox(head, [0.845, 0.47, 0.068], 0.185, glass, [0, -0.015, 0.408], [0, 0, 0], 8);
  const eyeGroups = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * 0.175, 0.025, 0.453);
    head.add(eye);
    roundedBox(eye, [0.13, 0.185, 0.03], 0.058, eyeMaterial, [0, 0, 0], [0, 0, 0], 7);
    sphere(eye, [0.027, 0.045, 0.014], eyeCore, [0.003, 0.002, 0.025], 24);
    sphere(eye, [0.012, 0.014, 0.006], catchlight, [-0.023, 0.039, 0.039], 16);
    sphere(eye, [0.005, 0.006, 0.004], catchlight, [0.025, -0.026, 0.039], 12);
    eyeGroups.push(eye);
  }
  const [eyeL, eyeR] = eyeGroups;
  // Curved brows, warm cheek lights and tiny catchlights give the digital face
  // a readable, friendly expression without turning it into a flat cartoon.
  for (const side of [-1, 1]) {
    tubeStroke(head, [
      [side * 0.265, 0.16, 0.45],
      [side * 0.19, 0.182, 0.463],
      [side * 0.115, 0.166, 0.455]
    ], 0.01, eyeMaterial);
    sphere(head, [0.035, 0.012, 0.012], cheekMaterial, [side * 0.31, -0.12, 0.453], 24);
    sphere(head, [0.006, 0.006, 0.004], catchlight, [side * 0.275 - side * 0.012, -0.125, 0.448], 12);
  }
  const mouth = new THREE.Group();
  mouth.position.set(0, -0.135, 0.461);
  head.add(mouth);
  const mouthLine = tubeStroke(mouth, [
    [-0.105, 0.008, 0.008], [-0.055, -0.022, 0.014], [0, -0.030, 0.017],
    [0.055, -0.022, 0.014], [0.105, 0.008, 0.008]
  ], 0.013, mouthMaterial);
  const mouthOpen = new THREE.Group();
  mouth.add(mouthOpen);
  sphere(mouthOpen, [0.056, 0.071, 0.018], graphite, [0, 0, 0]);
  const mouthRim = new THREE.Mesh(new THREE.TorusGeometry(0.067, 0.009, 12, 48), mouthMaterial);
  mouthRim.scale.set(0.84, 1, 1);
  mouthRim.position.z = 0.019;
  mouthOpen.add(mouthRim);
  mouthOpen.visible = false;
  // Side discs read as hinge covers and catch the warm rim light.
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.075, 32), graphite);
    ear.rotation.z = Math.PI / 2;
    ear.position.set(side * 0.52, -0.07, 0.0);
    head.add(ear);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.082, 28), teal);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(side * 0.565, -0.07, 0.0);
    head.add(cap);
  }
  roundedBox(head, [0.27, 0.024, 0.025], 0.01, titanium, [0, 0.388, 0.115]);
  roundedBox(head, [0.07, 0.022, 0.029], 0.01, accent, [0, 0.389, 0.14]);
  capsule(head, 0.025, 0.1, titanium, [0.28, 0.43, -0.06], [0, 0, -0.18]);
  roundedBox(head, [0.065, 0.075, 0.065], 0.027, accent, [0.291, 0.505, -0.06]);

  // Arms use shoulder pivots, elbow housings, forearms and individual fingers.
  const arms = {};
  function buildArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.59, 2.91, 0.015);
    robot.add(pivot);
    sphere(pivot, [0.19, 0.19, 0.2], graphite, [0, 0, 0]);
    sphere(pivot, [0.17, 0.17, 0.18], ceramic, [0, 0, 0.045]);
    capsule(pivot, 0.135, 0.43, ceramicLight, [side * 0.055, -0.37, 0.005], [0, 0, side * -0.1]);
    sphere(pivot, [0.14, 0.15, 0.15], graphite, [side * 0.1, -0.69, 0.02]);
    sphere(pivot, [0.066, 0.07, 0.075], titanium, [side * 0.1, -0.69, 0.106], 20);
    roundedBox(pivot, [0.215, 0.43, 0.255], 0.095, ceramic, [side * 0.13, -0.97, 0.015], [0, 0, side * -0.06], 6);
    roundedBox(pivot, [0.085, 0.024, 0.027], 0.01, accent, [side * 0.13, -0.88, 0.163]);
    sphere(pivot, [0.15, 0.16, 0.15], graphite, [side * 0.13, -1.28, 0.045]);
    roundedBox(pivot, [0.21, 0.23, 0.23], 0.075, ceramicLight, [side * 0.13, -1.4, 0.065], [0, 0, 0], 5);
    for (let i = 0; i < 4; i += 1) {
      capsule(pivot, 0.03, 0.105, ceramicLight, [side * 0.13 + (i - 1.5) * 0.046, -1.56, 0.07]);
    }
    capsule(pivot, 0.045, 0.11, ceramicLight, [side * 0.13 + side * 0.17, -1.41, 0.13], [0, 0, side * 0.9]);
    arms[side] = pivot;
  }
  buildArm(-1);
  buildArm(1);

  // Two separated, visibly mechanical legs finish the full-body silhouette.
  const legs = {};
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.285, 1.42, 0);
    robot.add(leg);
    sphere(leg, [0.19, 0.18, 0.2], graphite, [0, 0, 0]);
    capsule(leg, 0.165, 0.39, ceramic, [0, -0.35, 0], [0, 0, side * 0.035]);
    sphere(leg, [0.165, 0.15, 0.17], graphite, [0, -0.68, 0.03]);
    roundedBox(leg, [0.12, 0.08, 0.08], 0.035, titanium, [0, -0.68, 0.135]);
    roundedBox(leg, [0.265, 0.55, 0.30], 0.11, ceramicLight, [0, -0.98, 0.015], [0, 0, side * -0.02], 6);
    roundedBox(leg, [0.04, 0.18, 0.025], 0.014, accent, [0, -0.99, 0.181]);
    roundedBox(leg, [0.32, 0.19, 0.49], 0.08, graphite, [0, -1.32, 0.12], [0.055, 0, 0], 6);
    roundedBox(leg, [0.29, 0.105, 0.40], 0.048, ceramic, [0, -1.23, 0.14], [0.055, 0, 0], 5);
    roundedBox(leg, [0.095, 0.035, 0.025], 0.012, accent, [0, -1.30, 0.359], [0, 0, 0], 5);
    sphere(leg, [0.022, 0.022, 0.014], titanium, [side * 0.09, -1.30, 0.347], 16);
    legs[side] = leg;
  }

  // Keep the animation interface compatible with the current production rig.
  const ringGroup = new THREE.Group();
  robot.add(ringGroup);
  robot.name = 'PulsoModernRobot';
  head.name = 'Head';
  for (const side of [-1, 1]) {
    arms[side].name = side < 0 ? 'ArmLeft' : 'ArmRight';
    legs[side].name = side < 0 ? 'LegLeft' : 'LegRight';
  }


  return {
    THREE, renderer, scene, camera, robot, robotShadow, shadowMaterial,
    head, arms, legs, eyeL, eyeR, mouthLine, mouthOpen, ringGroup, motionPhase
  };
}
