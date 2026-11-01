import gsap from 'gsap';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createPresenterRobot } from './presenter-robot-modern.js';
import framing from '../../../utils/presenter-framing.js';

const rig = createPresenterRobot({ canvas: document.getElementById('three-layer'), width: 1040, height: 1040 });
const { renderer, scene, camera, robot, head, arms, eyeL, eyeR } = rig;
const shots = [
  { start: 0, side: 'right', framing: 'full', label: '01 · CORPO INTEIRO · DIREITA' },
  { start: 3, side: 'left', framing: 'full', label: '02 · CORPO INTEIRO · ESQUERDA' },
  { start: 6, side: 'right', framing: 'medium', label: '03 · PLANO MÉDIO · DIREITA' },
  { start: 9, side: 'center', framing: 'close', label: '04 · EXPRESSÃO · CLOSE' }
];
const smooth = (a, b, t) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
function renderAt(seconds) {
  const t = Math.min(12, Math.max(0, Number(seconds) || 0));
  const shot = shots.findLast(value => value.start <= t);
  document.getElementById('root').dataset.presenterSide = shot.side;
  document.querySelector('.footnote').textContent = shot.label;
  const view = framing.cameraForPresenter(shot.framing);
  camera.position.set(...view.position);
  camera.lookAt(...view.target);
  const greet = smooth(0.7, 1.8, t) * (1 - smooth(3.6, 4.6, t));
  robot.rotation.set(0, -0.28 + 0.48 * smooth(3.8, 7.5, t), 0);
  robot.position.y = -0.48 + Math.sin(t * 1.6) * 0.009;
  head.rotation.set(Math.sin(t * 0.8) * 0.015, Math.sin(t * 0.6) * 0.05, greet * -0.035);
  arms[-1].rotation.set(-0.05, 0, 0.08 + Math.sin(t * 1.2) * 0.03);
  arms[1].rotation.set(-0.08 - greet * 0.2, 0, -0.08 + greet * (0.68 + Math.sin(t * 4) * 0.11));
  const blink = Math.exp(-Math.pow((t - 3.35) / 0.09, 2)) * 0.94;
  eyeL.scale.y = eyeR.scale.y = 1 - blink;
  renderer.render(scene, camera);
}
const clock = { time: 0 };
const timeline = gsap.timeline({ paused: true, onUpdate: () => renderAt(clock.time) });
timeline.to(clock, { time: 12, duration: 12, ease: 'none' }, 0);
window.modernRobotTimeline = timeline;
window.seekModernRobot = renderAt;
window.exportModernRobot = async () => {
  renderAt(0);
  const glb = await new GLTFExporter().parseAsync(robot, { binary: true, onlyVisible: true });
  const blob = new Blob([glb], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pulso-robo-moderno.glb';
  a.click();
  URL.revokeObjectURL(url);
};
renderAt(0);
