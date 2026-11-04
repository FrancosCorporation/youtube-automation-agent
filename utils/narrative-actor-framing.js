'use strict';
const { bodyAt } = require('./narrative-spatial-audit');
const { animationState } = require('./narrative-animation-tracks');
const { illustrationViewport } = require('./narrative-illustration-viewport');
const MIN_ACTOR_VIEWPORT_HEIGHT = .23;
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const unit = a => a.map(v => v / Math.hypot(...a));
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const baseCamera = (drawing, aspect) => drawing.camera?.[aspect] || { position: [0, 2.6, 15], target: [0, 0, 0], fov: 34 };

function corners(body) {
  return Array.from({ length: 8 }, (_, mask) => body.center.map((v, axis) => v + body.half.reduce((s, half, i) =>
    s + ((mask >> i) & 1 ? 1 : -1) * half * body.axes[i][axis], 0)));
}
function projection(drawing, aspect, frame, camera = baseCamera(drawing, aspect)) {
  const motion = animationState(drawing.tracks, 'camera', frame);
  const position = add(camera.position, motion.position3d || [0, 0, 0]);
  const target = add(camera.target, motion.target3d || [0, 0, 0]);
  const forward = unit(sub(target, position)), right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward);
  const view = illustrationViewport(aspect, aspect === 'portrait' ? 1080 : 1920, aspect === 'portrait' ? 1920 : 1080);
  const tangent = Math.tan(camera.fov * Math.PI / 360);
  return point => {
    const relative = sub(point, position), depth = dot(relative, forward);
    return { x: dot(relative, right) / (depth * tangent * view.width / view.height), y: dot(relative, up) / (depth * tangent), depth };
  };
}
function sampleFrames(drawing, sentence) {
  const moving = (drawing.tracks || []).some(track => track.keyframes.some(key => JSON.stringify(key.value) !== JSON.stringify(track.keyframes[0].value)));
  return moving ? Array.from({ length: Math.ceil((sentence.endFrame - sentence.startFrame) * 4) + 1 },
    (_, index) => Math.min(sentence.endFrame, sentence.startFrame + index / 4)) : [sentence.startFrame];
}
function fits(points, project, margin) {
  return points.every(point => {
    const p = project(point);
    return Number.isFinite(p.x) && Number.isFinite(p.y) && p.depth > .1 && p.depth < 100 && Math.abs(p.x) <= margin && Math.abs(p.y) <= margin;
  });
}
function projectedHeight(points, project) {
  const values = points.map(project);
  if (values.some(p => !Number.isFinite(p.y) || p.depth <= .1)) return 0;
  return (Math.max(...values.map(p => p.y)) - Math.min(...values.map(p => p.y))) / 2;
}
function assertActorFraming(drawing, sentence, { minHeight = 0 } = {}) {
  if (drawing.dimension !== '3d') return;
  const actors = drawing.nodes.filter(node => node.actorId);
  if (!actors.length) return;
  for (const aspect of ['landscape', 'portrait']) for (const frame of sampleFrames(drawing, sentence)) {
    const project = projection(drawing, aspect, frame);
    for (const actor of actors) {
      const body = bodyAt(drawing, { nodeId: actor.id }, aspect, frame);
      if (body.opacity <= .05) continue;
      const points = corners(body);
      if (!fits(points, project, .96)) {
        throw new Error(`illustration: câmera corta ${actor.id} em ${aspect}, frame ${frame}; enquadre o corpo inteiro e o percurso com margem, ajustando camera.position/target sem mover o piso ou reduzir o ator`);
      }
      if (projectedHeight(points, project) < minHeight) {
        throw new Error(`illustration: ator ${actor.id} pequeno demais em ${aspect}, frame ${frame}; aproxime a ação para ocupar ao menos ${Math.round(minHeight * 100)}% da altura do viewport, preservando corpo inteiro, percurso e objetos relevantes`);
      }
    }
  }
}

// Authorship only. Translate/dolly each aspect's camera, keeping its lens,
// viewing direction and animated offsets. No actor, geometry or cue changes.
function repairActorFraming(drawing, sentence) {
  if (drawing.dimension !== '3d' || !drawing.nodes.some(node => node.actorId)) return drawing;
  const frames = sampleFrames(drawing, sentence), candidate = globalThis.structuredClone(drawing);
  let changed = false;
  for (const aspect of ['landscape', 'portrait']) {
    const actors = drawing.nodes.filter(node => node.actorId);
    const actorSamples = frames.map(frame => ({ frame, bodies: actors.map(node => {
      const body = bodyAt(drawing, { nodeId: node.id }, aspect, frame);
      return body.opacity > .05 ? corners(body) : [];
    }) }));
    const cropped = actorSamples.some(sample => sample.bodies.some(points => !fits(points, projection(drawing, aspect, sample.frame), .96)));
    // A body can be entirely inside the frame yet be too small to read. Use
    // the viewport height, not the full video height, for this geometric check.
    const tooSmall = actorSamples.some(sample => sample.bodies.some(points => points.length
      && projectedHeight(points, projection(drawing, aspect, sample.frame)) < MIN_ACTOR_VIEWPORT_HEIGHT));
    if (!cropped && !tooSmall) continue;
    const refs = drawing.nodes.flatMap(node => node.actorId ? [{ nodeId: node.id }] : node.meshes.flatMap((mesh, meshIndex) =>
      node.solidRole !== 'wall' && ['box', 'sphere', 'cylinder'].includes(mesh.type) && !(mesh.type === 'box' && mesh.size[1] <= .3 && mesh.size[0] >= 2 && mesh.size[2] >= 2)
        ? [{ nodeId: node.id, meshIndex }] : []));
    // Do not guess camera placement around unsupported legacy motion.
    if ((drawing.motions || []).some(motion => refs.some(ref => ref.nodeId === motion.targetId) && !['draw', 'reveal'].includes(motion.kind))) continue;
    const samples = frames.map(frame => ({ frame, points: refs.flatMap(ref => {
      const body = bodyAt(drawing, ref, aspect, frame);
      return body.opacity > .05 ? corners(body) : [];
    }) }));
    const points = samples.flatMap(sample => sample.points);
    const target = [0, 1, 2].map(axis => {
      let lo = Infinity, hi = -Infinity;
      for (const point of points) { lo = Math.min(lo, point[axis]); hi = Math.max(hi, point[axis]); }
      return (lo + hi) / 2;
    });
    if (!target.every(v => Number.isFinite(v) && Math.abs(v) <= 12)) continue;
    const original = baseCamera(drawing, aspect), offset = sub(original.position, original.target);
    for (let step = 0; step <= 24; step++) {
      const scale = .3 + step * .05;
      const camera = { ...original, target, position: add(target, offset.map(value => value * scale)) };
      if (!camera.position.every(v => Math.abs(v) <= 24)) continue;
      if (!samples.every(sample => fits(sample.points, projection(drawing, aspect, sample.frame, camera), .82))) continue;
      if (!cropped && !actorSamples.every(sample => sample.bodies.every(points => !points.length
        || projectedHeight(points, projection(drawing, aspect, sample.frame, camera))
          > projectedHeight(points, projection(drawing, aspect, sample.frame)) + .01))) continue;
      candidate.camera ||= {};
      candidate.camera[aspect] = camera;
      changed = true;
      break;
    }
  }
  return changed ? candidate : drawing;
}
module.exports = { assertActorFraming, repairActorFraming, MIN_ACTOR_VIEWPORT_HEIGHT };
