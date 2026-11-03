'use strict';

const { bodyAt } = require('./narrative-spatial-audit');

// All clips in the local actor catalog are grounded (Idle, Walk, Carry, Use).
// Collision-free space alone is not a floor: a body can be wholly below it.
function assertActorSupports(illustration, sentence) {
  if (illustration.dimension !== '3d') return;
  const actors = illustration.nodes.filter(node => node.actorId);
  if (!actors.length) return;
  const surfaces = illustration.nodes.flatMap(node => (node.meshes || []).flatMap((mesh, meshIndex) =>
    mesh.type === 'box' && mesh.size[1] <= .5 && mesh.size[0] > mesh.size[1] && mesh.size[2] > mesh.size[1]
      ? [{ nodeId: node.id, meshIndex }] : []));
  for (const aspect of ['landscape', 'portrait']) for (const actor of actors) {
    const moving = (illustration.tracks || []).some(track => [actor.id, ...surfaces.map(ref => ref.nodeId)].includes(track.targetId)
      && track.keyframes.some(key => JSON.stringify(key.value) !== JSON.stringify(track.keyframes[0].value)));
    const frames = moving ? Array.from({ length: Math.ceil((sentence.endFrame - sentence.startFrame) * 4) + 1 },
      (_, index) => Math.min(sentence.endFrame, sentence.startFrame + index / 4)) : [sentence.startFrame];
    for (const frame of frames) {
      const body = bodyAt(illustration, { nodeId: actor.id }, aspect, frame);
      if (body.opacity <= .05) continue;
      const footY = body.center[1] - body.half[1];
      const supported = surfaces.some(ref => {
        const floor = bodyAt(illustration, ref, aspect, frame);
        if (floor.opacity <= .05 || Math.abs(floor.axes[1][1] - 1) > 1e-6) return false;
        if (Math.abs(footY - floor.center[1] - floor.half[1]) > .025) return false;
        const delta = body.center.map((value, axis) => value - floor.center[axis]);
        return [0, 2].every(axis => {
          const normal = floor.axes[axis];
          const distance = Math.abs(delta.reduce((sum, value, i) => sum + value * normal[i], 0));
          const extent = body.half.reduce((sum, half, i) => sum + half * Math.abs(body.axes[i].reduce((dot, value, j) => dot + value * normal[j], 0)), 0);
          return distance + extent <= floor.half[axis] + .025;
        });
      });
      if (!supported) throw new Error(`illustration: ${actor.id} sem apoio dos pés em ${aspect}, frame ${Number(frame.toFixed(3))}, altura ${Number(footY.toFixed(3))}; alinhe pés ao topo de um piso box fino que cubra todo o percurso; não coloque o ator abaixo do piso para evitar colisão`);
    }
  }
}

module.exports = { assertActorSupports };
