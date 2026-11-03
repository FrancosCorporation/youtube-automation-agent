'use strict';

const { bodyAt } = require('./narrative-spatial-audit');
const { actorSupportState, supportSurfaces } = require('./narrative-actor-support');

// Authoring-only repair of a slightly undersized, static flat support. Preserve
// actor height, path, clip, scale and all timings. The ordinary swept collision
// and support validators still run afterwards, including against added floor.
function repairActorSupportFootprint(illustration, sentence) {
  if (illustration.dimension !== '3d' || !illustration.spatialChecks?.length) return illustration;
  const solids = [];
  for (const node of illustration.nodes) {
    if (node.actorId) solids.push({ nodeId: node.id });
    else for (const [meshIndex, mesh] of node.meshes.entries()) {
      if (!['box', 'sphere', 'cylinder'].includes(mesh.type)) return illustration;
      solids.push({ nodeId: node.id, meshIndex });
    }
  }
  if (solids.length > 129) return illustration;
  const floors = supportSurfaces(illustration).filter(ref => {
    const node = illustration.nodes.find(item => item.id === ref.nodeId), mesh = node.meshes[ref.meshIndex];
    return mesh.rotation.every(value => value === 0) && mesh.size[1] <= .3 && mesh.size[0] >= 2 && mesh.size[2] >= 2
      && ['landscape', 'portrait'].every(aspect => node.layout[aspect].rotate === 0)
      && !(illustration.tracks || []).some(track => track.targetId === node.id)
      && !(illustration.motions || []).some(motion => motion.targetId === node.id);
  });
  const required = new Map();
  for (const actor of illustration.nodes.filter(node => node.actorId)) {
    const tracks = (illustration.tracks || []).filter(track => track.targetId === actor.id);
    // Endpoint bounds are exact only for a constant-orientation/scale actor
    // with component-wise monotone translations (the contract's easing set).
    if (tracks.some(track => !['position3d', 'opacity'].includes(track.property))
      || ['landscape', 'portrait'].some(aspect => actor.layout[aspect].rotate !== 0)
      || (illustration.motions || []).some(motion => motion.targetId === actor.id && !['draw', 'reveal'].includes(motion.kind))) continue;
    const frames = [...new Set([sentence.startFrame, sentence.endFrame,
      ...tracks.flatMap(track => track.keyframes.map(key => key.frame))])]
      .filter(frame => frame >= sentence.startFrame && frame <= sentence.endFrame);
    for (const aspect of ['landscape', 'portrait']) {
      const first = bodyAt(illustration, { nodeId: actor.id }, aspect, sentence.startFrame);
      const available = floors.filter(ref => actorSupportState(first, bodyAt(illustration, ref, aspect, sentence.startFrame)).supported);
      // A staircase, overlapping platforms or an unsupported starting pose
      // needs a writer decision, not an invented choice of ground.
      if (available.length !== 1) continue;
      const ref = available[0], floorNode = illustration.nodes.find(node => node.id === ref.nodeId);
      const mesh = floorNode.meshes[ref.meshIndex], floor = bodyAt(illustration, ref, aspect, sentence.startFrame);
      const poses = frames.map(frame => bodyAt(illustration, { nodeId: actor.id }, aspect, frame));
      if (poses.some(pose => Math.abs(actorSupportState(pose, floor).gap) > .025)) continue;
      if (poses.every(pose => actorSupportState(pose, floor).supported)) continue;
      const key = `${ref.nodeId}:${ref.meshIndex}`;
      const entry = required.get(key) || { ref, size: [...mesh.size] };
      for (const axis of [0, 2]) {
        const extent = Math.max(...poses.map(pose => Math.abs(pose.center[axis] - floor.center[axis]) + pose.half[axis]));
        entry.size[axis] = Math.max(entry.size[axis], 2 * (extent + .01) / floorNode.layout[aspect].scale);
      }
      required.set(key, entry);
    }
  }
  const changes = [...required.values()].filter(({ ref, size }) => {
    const before = illustration.nodes.find(node => node.id === ref.nodeId).meshes[ref.meshIndex].size;
    return [0, 2].every(axis => size[axis] <= 12 && size[axis] - before[axis] <= Math.min(2, before[axis] * .25));
  });
  if (!changes.length || illustration.spatialChecks.length + changes.length > 64) return illustration;
  const candidate = globalThis.structuredClone(illustration);
  for (const { ref, size } of changes) {
    candidate.nodes.find(node => node.id === ref.nodeId).meshes[ref.meshIndex].size = size;
    candidate.spatialChecks.push({ subject: ref, obstacles: solids.filter(other =>
      other.nodeId !== ref.nodeId || other.meshIndex !== ref.meshIndex) });
  }
  return candidate;
}

module.exports = { repairActorSupportFootprint };
