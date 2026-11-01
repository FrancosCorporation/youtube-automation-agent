import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function createPresenterRobot({ canvas, width = 710, height = 940, seed = 0 }) {
  if (!canvas) throw new Error('Canvas do mascote 3D não encontrado');
  // Canonical character design: approved pearl-white shell, dark teal plates,
  // black visor, cyan face/chest lights and the pink antenna tip. Keep the
  // mascot identity fixed across editorial theme palettes.
  const look = {
    eye: 0x35f1e8,
    eyeGlow: 0x00d9d2,
    mouth: 0x35f1e8,
    mouthGlow: 0x00d9d2,
    accent: 0x24ded6,
    pink: 0xff9dc5
  };
  const motionPhase = ((Number(seed) >>> 0) % 997) / 997 * Math.PI * 2;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
  camera.position.set(0.06, 1.86, 7.8);
  camera.lookAt(0.06, 1.7, 0);

  scene.add(new THREE.HemisphereLight(0xeaf5eb, 0x243737, 2.0));
  const keyLight = new THREE.DirectionalLight(0xffe5c6, 3.2);
  keyLight.position.set(-3.5, 7.0, 5.5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x91ddce, 2.3);
  fillLight.position.set(4.0, 3.7, 2.4);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0xd49a68, 3.6);
  rimLight.position.set(0.5, 5.0, -4.0);
  scene.add(rimLight);

  const ceramic = new THREE.MeshStandardMaterial({ color: 0xe7e6df, metalness: 0.12, roughness: 0.27 });
  const ceramicLight = new THREE.MeshStandardMaterial({ color: 0xf8f6ef, metalness: 0.12, roughness: 0.22 });
  const graphite = new THREE.MeshStandardMaterial({ color: 0x101719, metalness: 0.58, roughness: 0.2 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x075548, metalness: 0.34, roughness: 0.24, emissive: 0x05251f, emissiveIntensity: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: look.accent, metalness: 0.15, roughness: 0.18, emissive: look.eyeGlow, emissiveIntensity: 1.65 });
  const amber = new THREE.MeshStandardMaterial({ color: 0x18cfc8, metalness: 0.26, roughness: 0.22, emissive: 0x087d78, emissiveIntensity: 0.65 });
  const pink = new THREE.MeshStandardMaterial({ color: look.pink, metalness: 0.12, roughness: 0.2, emissive: 0xff5ba9, emissiveIntensity: 1.05 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x050a0c, metalness: 0.24, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0x03090b, emissiveIntensity: 0.18 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: look.eye, metalness: 0.08, roughness: 0.16, emissive: look.eyeGlow, emissiveIntensity: 2.8 });
  const eyeCore = new THREE.MeshStandardMaterial({ color: 0x03171a, metalness: 0.2, roughness: 0.14 });
  const catchlight = new THREE.MeshBasicMaterial({ color: 0xfff8eb });
  const mouthMaterial = new THREE.MeshStandardMaterial({ color: look.mouth, metalness: 0.15, roughness: 0.2, emissive: look.mouthGlow, emissiveIntensity: 1.55 });

  const robot = new THREE.Group();
  robot.scale.setScalar(0.96);
  robot.position.set(0.06, -0.48, 0);
  scene.add(robot);

  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128;
  shadowCanvas.height = 64;
  const shadowContext = shadowCanvas.getContext('2d');
  const shadowGradient = shadowContext.createRadialGradient(64, 32, 3, 64, 32, 62);
  shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0.34)');
  shadowGradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.16)');
  shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  shadowContext.fillStyle = shadowGradient;
  shadowContext.fillRect(0, 0, 128, 64);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  shadowTexture.colorSpace = THREE.SRGBColorSpace;
  const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.82, depthWrite: false });
  const robotShadow = new THREE.Mesh(new THREE.PlaneGeometry(2.65, 0.54), shadowMaterial);
  robotShadow.position.set(0.06, -0.52, -0.26);
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
  roundedBox(robot, [0.83, 0.49, 0.52], 0.18, ceramicLight, [0, 1.72, 0]);
  roundedBox(robot, [1.13, 1.17, 0.66], 0.27, ceramicLight, [0, 2.43, 0], [0.01, -0.04, 0], 7);
  roundedBox(robot, [0.76, 0.67, 0.105], 0.18, teal, [0, 2.48, 0.359]);
  const chestRing = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.034, 14, 64), accent);
  chestRing.position.set(0, 2.52, 0.43);
  chestRing.castShadow = true;
  robot.add(chestRing);
  const chestCore = new THREE.Mesh(new THREE.CircleGeometry(0.145, 48), eyeCore);
  chestCore.position.set(0, 2.52, 0.432);
  robot.add(chestCore);
  sphere(robot, [0.073, 0.073, 0.018], accent, [0, 2.52, 0.446], 28);
  roundedBox(robot, [0.33, 0.075, 0.04], 0.035, teal, [0, 2.82, 0.345]);
  for (const x of [-0.16, 0, 0.16]) sphere(robot, [0.018, 0.018, 0.014], accent, [x, 2.89, 0.35], 16);
  // Dark teal side panels and cyan service lights match the approved shell.
  for (const side of [-1, 1]) {
    roundedBox(robot, [0.035, 0.29, 0.042], 0.017, graphite, [side * 0.54, 2.47, 0.29]);
    roundedBox(robot, [0.075, 0.39, 0.05], 0.028, teal, [side * 0.43, 2.46, 0.305]);
    sphere(robot, [0.035, 0.075, 0.018], accent, [side * 0.46, 2.46, 0.344], 20);
  }

  // Neck and head: porcelain shell, deep curved visor, emissive eyes and a mouth that changes expression.
  capsule(robot, 0.19, 0.16, graphite, [0, 3.13, 0]);
  const head = new THREE.Group();
  head.position.set(0, 3.65, 0);
  robot.add(head);
  roundedBox(head, [1.12, 0.93, 0.77], 0.34, ceramicLight, [0, 0, 0], [0.005, -0.035, 0], 9);
  roundedBox(head, [1.0, 0.65, 0.105], 0.24, graphite, [0, -0.012, 0.352], [0, 0, 0], 9);
  roundedBox(head, [0.91, 0.56, 0.075], 0.205, glass, [0, -0.005, 0.411], [0, 0, 0], 9);
  const eyeGroups = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * 0.215, 0.02, 0.454);
    head.add(eye);
    const outer = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.026, 14, 56), eyeMaterial);
    outer.position.z = 0.012;
    eye.add(outer);
    const iris = new THREE.Mesh(new THREE.CircleGeometry(0.078, 48), eyeCore);
    iris.position.z = 0.013;
    eye.add(iris);
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.048, 40), graphite);
    pupil.position.z = 0.015;
    eye.add(pupil);
    sphere(eye, [0.025, 0.025, 0.012], accent, [-0.027, 0.035, 0.025], 20);
    sphere(eye, [0.010, 0.010, 0.007], catchlight, [0.044, -0.045, 0.026], 14);
    eyeGroups.push(eye);
  }
  const [eyeL, eyeR] = eyeGroups;
  // Cyan brows, round luminous eyes and the small smile are the defining face.
  for (const side of [-1, 1]) {
    tubeStroke(head, [
      [side * 0.31, 0.17, 0.448],
      [side * 0.24, 0.205, 0.458],
      [side * 0.17, 0.17, 0.45]
    ], 0.012, accent);
  }
  const mouth = new THREE.Group();
  mouth.position.set(0, -0.145, 0.457);
  head.add(mouth);
  const mouthLine = tubeStroke(mouth, [
    [-0.13, 0.018, 0.008], [-0.075, -0.018, 0.014], [0, -0.033, 0.017],
    [0.075, -0.018, 0.014], [0.13, 0.018, 0.008]
  ], 0.016, mouthMaterial);
  const mouthOpen = new THREE.Group();
  mouth.add(mouthOpen);
  sphere(mouthOpen, [0.063, 0.075, 0.018], graphite, [0, 0, 0]);
  const lowerLip = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 8, 32, Math.PI), mouthMaterial);
  lowerLip.position.set(0, -0.015, 0.012);
  lowerLip.rotation.z = Math.PI;
  mouthOpen.add(lowerLip);
  mouthOpen.visible = false;
  // Side discs read as hinge covers and catch the warm rim light.
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.095, 40), teal);
    ear.rotation.z = Math.PI / 2;
    ear.position.set(side * 0.53, -0.055, 0.0);
    head.add(ear);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.105, 36), graphite);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(side * 0.59, -0.055, 0.0);
    head.add(cap);
    roundedBox(head, [0.025, 0.32, 0.045], 0.012, accent, [side * 0.64, -0.055, 0.005]);
  }
  roundedBox(head, [0.34, 0.065, 0.06], 0.027, teal, [0, 0.43, 0.12]);
  sphere(head, [0.045, 0.045, 0.027], graphite, [0, 0.44, 0.16], 24);
  capsule(head, 0.034, 0.19, graphite, [0, 0.55, 0.02]);
  sphere(head, [0.092, 0.092, 0.084], pink, [0, 0.69, 0.02], 32);

  // Arms use shoulder pivots, elbow housings, forearms and individual fingers.
  const arms = {};
  function buildArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.59, 2.91, 0.015);
    robot.add(pivot);
    sphere(pivot, [0.22, 0.22, 0.23], graphite, [0, 0, 0]);
    sphere(pivot, [0.19, 0.19, 0.2], ceramic, [0, 0, 0.045]);
    capsule(pivot, 0.155, 0.43, ceramicLight, [side * 0.055, -0.37, 0.005], [0, 0, side * -0.1]);
    sphere(pivot, [0.14, 0.15, 0.15], graphite, [side * 0.1, -0.69, 0.02]);
    sphere(pivot, [0.085, 0.09, 0.095], amber, [side * 0.1, -0.69, 0.106], 20);
    roundedBox(pivot, [0.245, 0.43, 0.28], 0.105, ceramic, [side * 0.13, -0.97, 0.015], [0, 0, side * -0.06], 6);
    roundedBox(pivot, [0.11, 0.07, 0.07], 0.032, teal, [side * 0.13, -0.88, 0.163]);
    sphere(pivot, [0.15, 0.16, 0.15], graphite, [side * 0.13, -1.28, 0.045]);
    roundedBox(pivot, [0.21, 0.23, 0.23], 0.075, ceramicLight, [side * 0.13, -1.4, 0.065], [0, 0, 0], 5);
    for (let i = 0; i < 3; i += 1) {
      capsule(pivot, 0.043, 0.12, ceramicLight, [side * 0.13 + (i - 1) * 0.072, -1.56, 0.07]);
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
    capsule(leg, 0.18, 0.39, ceramic, [0, -0.35, 0], [0, 0, side * 0.035]);
    sphere(leg, [0.165, 0.15, 0.17], graphite, [0, -0.68, 0.03]);
    roundedBox(leg, [0.12, 0.08, 0.08], 0.035, amber, [0, -0.68, 0.135]);
    roundedBox(leg, [0.29, 0.55, 0.32], 0.12, ceramicLight, [0, -0.98, 0.015], [0, 0, side * -0.02], 6);
    roundedBox(leg, [0.12, 0.11, 0.08], 0.04, teal, [0, -0.99, 0.181]);
    roundedBox(leg, [0.37, 0.22, 0.58], 0.095, graphite, [0, -1.32, 0.12], [0.055, 0, 0], 6);
    roundedBox(leg, [0.33, 0.105, 0.45], 0.048, ceramic, [0, -1.23, 0.14], [0.055, 0, 0], 5);
    roundedBox(leg, [0.095, 0.035, 0.025], 0.012, accent, [0, -1.30, 0.414], [0, 0, 0], 5);
    sphere(leg, [0.022, 0.022, 0.014], amber, [side * 0.105, -1.30, 0.405], 16);
    legs[side] = leg;
  }

  // A small non-literal ring set gives the robot a dimensional studio context without visual clutter.
  const ringGroup = new THREE.Group();
  ringGroup.position.set(0, 2.42, -0.75);
  robot.add(ringGroup);
  for (let i = 0; i < 3; i += 1) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.84 + i * 0.14, 0.006 + i * 0.0015, 8, 112), new THREE.MeshBasicMaterial({ color: i === 2 ? 0x78bda7 : 0x8aa798, transparent: true, opacity: 0.23 - i * 0.04 }));
    ring.position.z = -0.03 - i * 0.08;
    ringGroup.add(ring);
  }


  return {
    THREE, renderer, scene, camera, robot, robotShadow, shadowMaterial,
    head, arms, legs, eyeL, eyeR, mouthLine, mouthOpen, ringGroup, motionPhase
  };
}
