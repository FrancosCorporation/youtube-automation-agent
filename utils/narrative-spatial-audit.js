'use strict';
// Local geometric QA for declared physical interactions, not a physics solver.
// Uses the same global tracks as the renderer. No model calls or stateful simulation.
const { animationState } = require('./narrative-animation-tracks');
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, b) => a.map((v, i) => v * b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const length = a => Math.hypot(...a);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const fail = message => { throw new Error(`illustration: ${message}`); };
// Three.js Euler XYZ applies Z, then Y, then X to a column vector.
function rotate([x, y, z], [rx, ry, rz]) {
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  return [x, y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
}
function normalizeSpatialChecks(raw, nodes) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 64) fail('spatialChecks excessivo');
  const ref = value => {
    const node = nodes.find(n => n.id === value?.nodeId);
    const meshIndex = value?.meshIndex;
    if (!node || !Number.isInteger(meshIndex) || !node.meshes[meshIndex]) fail('spatialChecks sem malha válida');
    if (!['sphere', 'box', 'cylinder'].includes(node.meshes[meshIndex].type)) fail('spatialChecks requer sphere, box ou cylinder; decomponha o sólido');
    return { nodeId: node.id, meshIndex };
  };
  return raw.map(item => {
    const subject = ref(item.subject);
    if (!Array.isArray(item.obstacles) || !item.obstacles.length || item.obstacles.length > 128) fail('spatialChecks sem obstáculos ou excessivo');
    const obstacles = item.obstacles.map(ref);
    if (obstacles.some(o => o.nodeId === subject.nodeId && o.meshIndex === subject.meshIndex)) fail('spatialChecks contra si mesmo');
    return { subject, obstacles };
  });
}
function bodyAt(illustration, ref, aspect, frame) {
  const node = illustration.nodes.find(n => n.id === ref.nodeId), mesh = node.meshes[ref.meshIndex];
  if ((illustration.motions || []).some(m => m.targetId === node.id && !['reveal', 'draw'].includes(m.kind))) fail(`spatialChecks: ${node.id} deve usar tracks para movimento físico`);
  const parent = animationState(illustration.tracks, node.id, frame);
  const part = animationState(illustration.tracks, node.id, frame, ref.meshIndex);
  const pose = node.layout[aspect], scale = mul([pose.scale, pose.scale, pose.scale], parent.scale3d || [1, 1, 1]);
  const rotation = add([0, 0, pose.rotate * Math.PI / 180], parent.rotation3d || [0, 0, 0]);
  const meshRotation = add(mesh.rotation, part.rotation3d || [0, 0, 0]);
  const basis = axes.map(axis => rotate(mul(rotate(axis, meshRotation), scale), rotation));
  const lengths = basis.map(length), unit = basis.map((a, i) => a.map(v => v / lengths[i]));
  if (Math.abs(dot(unit[0], unit[1])) > .0001 || Math.abs(dot(unit[0], unit[2])) > .0001 || Math.abs(dot(unit[1], unit[2])) > .0001) fail('spatialChecks: escala com cisalhamento não suportada; separe a peça');
  const size = mul(mul(mesh.size, part.scale3d || [1, 1, 1]), lengths);
  const center = add(add([(pose.x - .5) * (aspect === 'portrait' ? 9.6 : 12), (.5 - pose.y) * 7, node.depth], parent.position3d || [0, 0, 0]),
    rotate(mul(add(mesh.position, part.position3d || [0, 0, 0]), scale), rotation));
  return { center, axes: unit, half: size.map(v => v / 2), type: mesh.type, radius: Math.max(...size) / 2,
    rotation: [...rotation, ...meshRotation], opacity: mesh.opacity * (parent.opacity ?? 1) * (part.opacity ?? 1) };
}
function penetration(a, b) {
  if (a.type !== 'sphere' && b.type === 'sphere') return penetration(b, a);
  if (a.type === 'sphere') {
    if (b.type === 'sphere') return a.radius + b.radius - length(sub(a.center, b.center));
    const local = b.axes.map(axis => dot(sub(a.center, b.center), axis));
    let distance;
    if (b.type === 'cylinder') {
      const d = [Math.hypot(local[0], local[2]) - Math.max(b.half[0], b.half[2]), Math.abs(local[1]) - b.half[1]];
      distance = Math.hypot(...d.map(v => Math.max(0, v))) + Math.min(0, Math.max(...d));
    } else {
      const d = local.map((v, i) => Math.abs(v) - b.half[i]);
      distance = Math.hypot(...d.map(v => Math.max(0, v))) + Math.min(0, Math.max(...d));
    }
    return a.radius - distance;
  }
  // SAT for oriented boxes; cylinders in this pair use conservative boxes.
  let overlap = Infinity;
  for (const axis of [...a.axes, ...b.axes, ...a.axes.flatMap(x => b.axes.map(y => cross(x, y)))]) {
    const len = length(axis); if (len < 1e-8) continue;
    const n = axis.map(v => v / len);
    const extent = body => body.half.reduce((sum, v, i) => sum + v * Math.abs(dot(body.axes[i], n)), 0);
    overlap = Math.min(overlap, extent(a) + extent(b) - Math.abs(dot(sub(a.center, b.center), n)));
    if (overlap <= 0) break;
  }
  return overlap;
}
function auditSpatialChecks(illustration, sentence) {
  const collisions = [];
  if (!illustration.spatialChecks?.length) return { status: 'not-declared', collisions };
  let samples = 0;
  for (const aspect of ['landscape', 'portrait']) {
    for (const check of illustration.spatialChecks) for (const obstacle of check.obstacles) {
      let hit = false;
      const inspect = (frame, a, b) => {
        samples++;
        // Small tolerance for rounded primitives and ellipsoid bounding spheres.
        if (a.opacity > .05 && b.opacity > .05 && penetration(a, b) > .025) {
          collisions.push({ aspect, frame: Number(frame.toFixed(3)), subject: check.subject, obstacle }); hit = true;
        }
      };
      for (let frame = sentence.startFrame; frame < sentence.endFrame && !hit; frame++) {
        const next = Math.min(frame + 1, sentence.endFrame);
        const a = bodyAt(illustration, check.subject, aspect, frame), b = bodyAt(illustration, obstacle, aspect, frame);
        const an = bodyAt(illustration, check.subject, aspect, next), bn = bodyAt(illustration, obstacle, aspect, next);
        const travel = (p, q) => length(sub(p.center, q.center)) + length(sub(p.half, q.half))
          + length(sub(p.rotation, q.rotation)) * length(p.half);
        const clearance = Math.max(.025, Math.min(...a.half, ...b.half) * .5);
        const steps = Math.max(4, Math.ceil(4 * (travel(a, an) + travel(b, bn)) / clearance));
        // Reject instead of silently skipping very fast/small interactions.
        if (steps > 256) fail(`spatialChecks: movimento rápido demais em ${check.subject.nodeId}; aumente duração/espaço`);
        for (let step = 0; step < steps && !hit; step++) {
          const t = frame + step / steps;
          inspect(t, step ? bodyAt(illustration, check.subject, aspect, t) : a, step ? bodyAt(illustration, obstacle, aspect, t) : b);
        }
      }
      if (collisions.length >= 8) return { status: 'collision', collisions, samples };
    }
  }
  return { status: collisions.length ? 'collision' : 'pass', collisions, samples };
}
function assertSpatialChecks(illustration, sentence) {
  const result = auditSpatialChecks(illustration, sentence);
  if (result.collisions.length) {
    const hit = result.collisions[0];
    fail(`colisão ${hit.subject.nodeId}[${hit.subject.meshIndex}] atravessa ${hit.obstacle.nodeId}[${hit.obstacle.meshIndex}] em ${hit.aspect}, frame ${hit.frame}; reposicione o obstáculo ou corrija a trajetória, mantendo contato e cue`);
  }
  return result;
}
module.exports = { normalizeSpatialChecks, auditSpatialChecks, assertSpatialChecks, bodyAt, penetration };
