import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function createPresenterRobot({ canvas, width = 710, height = 940, seed = 0, accents = [] }) {
  if (!canvas) throw new Error('Canvas do mascote 3D não encontrado');
  const palette = accents.length ? accents : ['#5EEAD4', '#60A5FA', '#A78BFA', '#FBBF24'];
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

  const ceramic = new THREE.MeshStandardMaterial({ color: 0xd8ded2, metalness: 0.22, roughness: 0.31 });
  const ceramicLight = new THREE.MeshStandardMaterial({ color: 0xf0ecdd, metalness: 0.17, roughness: 0.26 });
  const graphite = new THREE.MeshStandardMaterial({ color: 0x27393a, metalness: 0.75, roughness: 0.28 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x559d8c, metalness: 0.48, roughness: 0.25, emissive: 0x123f37, emissiveIntensity: 0.55 });
  const accent = new THREE.MeshStandardMaterial({ color: look.accent, metalness: 0.46, roughness: 0.24, emissive: look.accent, emissiveIntensity: 0.22 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xd99258, metalness: 0.58, roughness: 0.25, emissive: 0x43200c, emissiveIntensity: 0.45 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x102426, metalness: 0.45, roughness: 0.12, clearcoat: 0.95, clearcoatRoughness: 0.08, emissive: 0x0b2423, emissiveIntensity: 0.5 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: look.eye, metalness: 0.1, roughness: 0.2, emissive: look.eyeGlow, emissiveIntensity: 2.35 });
  const eyeCore = new THREE.MeshStandardMaterial({ color: 0x13383b, metalness: 0.2, roughness: 0.16 });
  const catchlight = new THREE.MeshBasicMaterial({ color: 0xfff8eb });
  const cheekMaterial = new THREE.MeshStandardMaterial({ color: 0xe7a49a, metalness: 0.05, roughness: 0.32, emissive: 0xa74a49, emissiveIntensity: 0.25 });
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
  roundedBox(robot, [0.73, 0.71, 0.11], 0.12, glass, [0, 2.48, 0.354]);
  roundedBox(robot, [0.08, 0.53, 0.035], 0.035, accent, [0, 2.46, 0.417]);
  roundedBox(robot, [0.34, 0.065, 0.035], 0.03, amber, [0, 2.17, 0.416]);
  roundedBox(robot, [0.36, 0.058, 0.035], 0.025, accent, [0, 2.78, 0.416]);
  for (const x of [-0.105, 0, 0.105]) sphere(robot, [0.023, 0.023, 0.018], x === 0 ? amber : accent, [x, 2.91, 0.34], 18);
  // Small mechanical seams and side vents add scale and material contrast.
  for (const side of [-1, 1]) {
    roundedBox(robot, [0.035, 0.29, 0.042], 0.017, graphite, [side * 0.54, 2.47, 0.29]);
    sphere(robot, [0.055, 0.055, 0.035], amber, [side * 0.56, 2.63, 0.31], 18);
  }

  // Neck and head: porcelain shell, deep curved visor, emissive eyes and a mouth that changes expression.
  capsule(robot, 0.19, 0.16, graphite, [0, 3.13, 0]);
  const head = new THREE.Group();
  head.position.set(0, 3.65, 0);
  robot.add(head);
  roundedBox(head, [0.92, 0.84, 0.73], 0.31, ceramicLight, [0, 0, 0], [0, -0.045, 0], 8);
  roundedBox(head, [0.76, 0.49, 0.105], 0.2, graphite, [0, -0.015, 0.332], [0, 0, 0], 8);
  roundedBox(head, [0.675, 0.405, 0.075], 0.17, glass, [0, -0.005, 0.39], [0, 0, 0], 8);
  const eyeGroups = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * 0.15, 0.015, 0.435);
    head.add(eye);
    roundedBox(eye, [0.12, 0.17, 0.034], 0.058, eyeMaterial, [0, 0, 0], [0, 0, 0], 7);
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
      [side * 0.245, 0.145, 0.434],
      [side * 0.185, 0.184, 0.448],
      [side * 0.105, 0.154, 0.438]
    ], 0.014, graphite);
    sphere(head, [0.047, 0.029, 0.014], cheekMaterial, [side * 0.275, -0.13, 0.433], 24);
    sphere(head, [0.006, 0.006, 0.004], catchlight, [side * 0.275 - side * 0.012, -0.125, 0.448], 12);
  }
  const mouth = new THREE.Group();
  mouth.position.set(0, -0.135, 0.442);
  head.add(mouth);
  const mouthLine = tubeStroke(mouth, [
    [-0.105, 0.008, 0.008], [-0.055, -0.022, 0.014], [0, -0.030, 0.017],
    [0.055, -0.022, 0.014], [0.105, 0.008, 0.008]
  ], 0.013, mouthMaterial);
  const mouthOpen = new THREE.Group();
  mouth.add(mouthOpen);
  const mouthInterior = sphere(mouthOpen, [0.056, 0.071, 0.018], graphite, [0, 0, 0]);
  const tongue = sphere(mouthOpen, [0.031, 0.015, 0.009], cheekMaterial, [0, -0.034, 0.015], 20);
  mouthOpen.visible = false;
  // Side discs read as hinge covers and catch the warm rim light.
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.075, 32), graphite);
    ear.rotation.z = Math.PI / 2;
    ear.position.set(side * 0.46, -0.07, 0.0);
    head.add(ear);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.082, 28), teal);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(side * 0.51, -0.07, 0.0);
    head.add(cap);
  }
  roundedBox(head, [0.35, 0.055, 0.055], 0.024, amber, [0, 0.398, 0.12]);
  sphere(head, [0.045, 0.045, 0.027], accent, [0, 0.405, 0.16], 24);
  capsule(head, 0.035, 0.16, graphite, [0, 0.48, 0.02]);
  sphere(head, [0.07, 0.07, 0.06], accent, [0, 0.59, 0.02], 24);
  sphere(head, [0.035, 0.035, 0.03], amber, [0, 0.62, 0.04], 20);

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
