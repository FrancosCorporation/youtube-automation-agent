'use strict';

const { bodyAt } = require('./narrative-spatial-audit');

function supportSurfaces(illustration) {
  return illustration.nodes.flatMap(node => (node.meshes || []).flatMap((mesh, meshIndex) =>
    mesh.type === 'box' && mesh.size[1] <= .5 && mesh.size[0] > mesh.size[1] && mesh.size[2] > mesh.size[1]
      ? [{ nodeId: node.id, meshIndex }] : []));
}

function actorSupportState(body, floor) {
  const footY = body.center[1] - body.half[1];
  const topY = floor.center[1] + floor.half[1];
  const delta = body.center.map((value, axis) => value - floor.center[axis]);
  const outside = [0, 2].map(axis => {
    const normal = floor.axes[axis];
    const distance = Math.abs(delta.reduce((sum, value, i) => sum + value * normal[i], 0));
    const extent = body.half.reduce((sum, half, i) => sum + half * Math.abs(body.axes[i].reduce((dot, value, j) => dot + value * normal[j], 0)), 0);
    return Math.max(0, distance + extent - floor.half[axis]);
  });
  const level = Math.abs(floor.axes[1][1] - 1) <= 1e-6;
  const gap = footY - topY;
  return { footY, topY, gap, outside, level,
    supported: floor.opacity > .05 && level && Math.abs(gap) <= .025 && outside.every(value => value <= .025) };
}

// All clips in the local actor catalog are grounded (Idle, Walk, Carry, Use).
// Collision-free space alone is not a floor: a body can be wholly below it.
function assertActorSupports(illustration, sentence) {
  if (illustration.dimension !== '3d') return;
  const actors = illustration.nodes.filter(node => node.actorId);
  if (!actors.length) return;
  const surfaces = supportSurfaces(illustration);
  for (const aspect of ['landscape', 'portrait']) for (const actor of actors) {
    const moving = (illustration.tracks || []).some(track => [actor.id, ...surfaces.map(ref => ref.nodeId)].includes(track.targetId)
      && track.keyframes.some(key => JSON.stringify(key.value) !== JSON.stringify(track.keyframes[0].value)));
    const frames = moving ? Array.from({ length: Math.ceil((sentence.endFrame - sentence.startFrame) * 4) + 1 },
      (_, index) => Math.min(sentence.endFrame, sentence.startFrame + index / 4)) : [sentence.startFrame];
    for (const frame of frames) {
      const body = bodyAt(illustration, { nodeId: actor.id }, aspect, frame);
      if (body.opacity <= .05) continue;
      const candidates = surfaces.map(ref => {
        const floor = bodyAt(illustration, ref, aspect, frame);
        return { ref, visible: floor.opacity > .05, ...actorSupportState(body, floor) };
      });
      if (candidates.some(candidate => candidate.supported)) continue;
      const nearest = candidates.filter(candidate => candidate.visible && candidate.level)
        .sort((a, b) => Math.abs(a.gap) + Math.max(...a.outside) - Math.abs(b.gap) - Math.max(...b.outside))[0];
      const rounded = value => Number(value.toFixed(4));
      const detail = nearest
        ? `piso ${nearest.ref.nodeId}[${nearest.ref.meshIndex}], pés=${rounded(nearest.footY)}, topo=${rounded(nearest.topY)}, diferençaY=${rounded(nearest.gap)}; excede borda X=${rounded(nearest.outside[0])}, Z=${rounded(nearest.outside[1])}; ${Math.abs(nearest.gap) <= .025 ? 'altura correta: ajuste piso/percurso' : 'alinhe altura e confira o percurso'}`
        : 'nenhum piso box fino horizontal visível disponível';
      throw new Error(`illustration: ${actor.id} sem apoio dos pés em ${aspect}, frame ${rounded(frame)}; ${detail}`);
    }
  }
}

module.exports = { assertActorSupports, actorSupportState, supportSurfaces };
