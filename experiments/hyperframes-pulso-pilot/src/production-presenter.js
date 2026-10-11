import { createPresenterRobot } from './presenter-robot.js';

const config = window.PULSO_ROBOT_CONFIG || {};
const seed = Number(config.seed) >>> 0;
const duration = Math.max(0.1, Number(config.durationSeconds) || 1);
const accents = Array.isArray(config.accents) ? config.accents : [];
const rig = createPresenterRobot({
  canvas: document.getElementById('three-layer'),
  width: 710,
  height: 940,
  seed,
  accents
});
const { THREE, renderer, scene, camera, robot, robotShadow, shadowMaterial,
  head, arms, legs, eyeL, eyeR, mouthLine, mouthOpen, ringGroup, motionPhase } = rig;
const envelope = config.speechEnvelope || {};

function smoothstep(a, b, value) {
  const x = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
}

function audioLevelAt(timeSeconds) {
  const levels = Array.isArray(envelope.levels) ? envelope.levels : [];
  if (!levels.length) return 0;
  const stepMs = Math.max(1, Number(envelope.stepMs) || 10);
  const position = THREE.MathUtils.clamp(timeSeconds * 1000 / stepMs, 0, levels.length - 1);
  const left = Math.floor(position);
  const right = Math.min(levels.length - 1, left + 1);
  const fraction = position - left;
  return Number(levels[left] || 0) * (1 - fraction) + Number(levels[right] || 0) * fraction;
}

function blinkAmount(time, offset = 0) {
  const period = 4.8 + (seed % 3) * 0.34;
  const phase = ((time + offset + period * 0.93) % period + period) % period;
  const distance = Math.min(phase, period - phase);
  return Math.exp(-Math.pow(distance / 0.075, 2)) * 0.94;
}

function renderAt(timeSeconds) {
  const t = THREE.MathUtils.clamp(Number(timeSeconds) || 0, 0, duration);
  const voiceLevel = audioLevelAt(t);
  const speaking = voiceLevel >= 0.07;
  const articulation = speaking ? voiceLevel : 0;
  const phaseOffset = (seed % 1250) / 100;
  const cycleSeconds = 12.5;
  const cycle = ((t + phaseOffset) % cycleSeconds + cycleSeconds) % cycleSeconds;
  const greeting = smoothstep(0.35, 1.05, cycle) * (1 - smoothstep(3.6, 4.35, cycle));
  const explaining = smoothstep(5.1, 5.9, cycle) * (1 - smoothstep(9.2, 10.0, cycle));
  const breathe = Math.sin(t * 1.65 + motionPhase) * 0.018;
  const gestureBeat = Math.sin(t * 0.52 + motionPhase);

  robot.position.y = -0.48 + breathe;
  robotShadow.position.y = -0.52 + breathe * 0.25;
  shadowMaterial.opacity = 0.82 - Math.max(0, breathe) * 1.9;
  robot.rotation.y = -0.2 + Math.sin(t * 0.42 + motionPhase) * 0.065 + greeting * 0.07;
  robot.rotation.x = Math.sin(t * 0.8 + motionPhase) * 0.012;
  head.rotation.y = Math.sin(t * 0.75 + 0.4 + motionPhase) * 0.08 - explaining * 0.035;
  head.rotation.x = Math.sin(t * 0.78 + motionPhase) * 0.012;
  head.rotation.z = Math.sin(t * 0.57 + motionPhase) * 0.022 + explaining * 0.018;
  arms[-1].rotation.z = 0.065 - greeting * 0.39 - explaining * 0.18 + gestureBeat * 0.055;
  arms[1].rotation.z = -0.055 + greeting * 0.31 + explaining * 0.32 - gestureBeat * 0.06;
  arms[-1].rotation.x = -0.06 - greeting * 0.10 - explaining * 0.08 - gestureBeat * 0.014;
  arms[1].rotation.x = -0.06 - greeting * 0.13 - explaining * 0.16 + gestureBeat * 0.012;
  arms[-1].rotation.y = Math.sin(t * 0.52 + motionPhase) * 0.018;
  arms[1].rotation.y = Math.sin(t * 0.52 + motionPhase + Math.PI) * 0.018;
  legs[-1].rotation.z = Math.sin(t * 0.68 + motionPhase) * 0.012;
  legs[1].rotation.z = -Math.sin(t * 0.68 + motionPhase) * 0.012;

  const curious = 0.18 + explaining * 0.52 + greeting * 0.16;
  eyeL.scale.y = (0.84 + curious * 0.25) * (1 - blinkAmount(t));
  eyeR.scale.y = (0.84 + curious * 0.25) * (1 - blinkAmount(t, 0.055));
  mouthLine.visible = !speaking;
  mouthOpen.visible = speaking;
  mouthOpen.scale.set(0.34 + articulation * 0.74, 0.14 + articulation * 1.04, 1);
  mouthOpen.position.y = -0.004 - articulation * 0.004;
  ringGroup.rotation.z = Math.sin(t * 0.21) * 0.05;
  ringGroup.rotation.y = Math.cos(t * 0.19) * 0.045;
  renderer.render(scene, camera);
}

window.seekPresenterRobot = renderAt;
window.disposePresenterRobot = () => renderer.dispose();
renderAt(0);
