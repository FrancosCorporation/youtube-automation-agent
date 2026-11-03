'use strict';
const { auditSpatialChecks, bodyAt } = require('./narrative-spatial-audit');

// Authoring-time support alignment for a level path on an unrotated, static
// box floor. No names/keywords, retiming, scale changes or motion replacement.
function repairActorFloorContact(illustration, sentence) {
  if (illustration.dimension !== '3d' || !illustration.spatialChecks?.length) return illustration;
  const audit = auditSpatialChecks(illustration, sentence);
  const solids = [];
  for (const node of illustration.nodes) {
    if (node.actorId) solids.push({ nodeId: node.id });
    else for (const [meshIndex, mesh] of node.meshes.entries()) {
      if (!['box', 'sphere', 'cylinder'].includes(mesh.type)) return illustration;
      solids.push({ nodeId: node.id, meshIndex });
    }
  }
  if (solids.length > 129) return illustration;
  const candidate = globalThis.structuredClone(illustration), shifted = new Set(), aligned = new Set();
  const nearSupports = [];
  for (const aspect of ['landscape', 'portrait']) for (const actor of illustration.nodes.filter(node => node.actorId)) {
    const subject = { nodeId: actor.id };
    const body = bodyAt(illustration, subject, aspect, sentence.startFrame);
    const floors = solids.filter(ref => ref.meshIndex != null).map(ref => {
      const node = illustration.nodes.find(node => node.id === ref.nodeId), mesh = node.meshes[ref.meshIndex];
      if (mesh.type !== 'box' || mesh.size[1] > .3 || mesh.size[0] < 2 || mesh.size[2] < 2) return null;
      const support = bodyAt(illustration, ref, aspect, sentence.startFrame);
      const gap = Math.abs(body.center[1] - body.half[1] - support.center[1] - support.half[1]);
      return { ref, gap };
    }).filter(Boolean).sort((a, b) => a.gap - b.gap);
    if (floors.length && (!floors[1] || floors[1].gap - floors[0].gap > .025)) {
      nearSupports.push({ subject, obstacle: floors[0].ref, aspect });
    }
  }
  for (const hit of [...audit.collisions, ...nearSupports]) {
    const pairs = [[hit.subject, hit.obstacle], [hit.obstacle, hit.subject]];
    for (const [actorRef, floorRef] of pairs) {
      const actor = candidate.nodes.find(node => node.id === actorRef.nodeId);
      const floor = candidate.nodes.find(node => node.id === floorRef.nodeId);
      const mesh = floor?.meshes[floorRef.meshIndex];
      if (!actor?.actorId || aligned.has(`${hit.aspect}:${actor.id}`) || actorRef.meshIndex != null || !mesh || mesh.type !== 'box'
        || mesh.size[1] > .3 || mesh.size[0] < 2 || mesh.size[2] < 2
        || mesh.rotation.some(value => value !== 0) || floor.layout[hit.aspect].rotate !== 0
        || actor.layout[hit.aspect].rotate !== 0) continue;
      if (candidate.tracks.some(track => track.targetId === floor.id)
        || candidate.motions.some(motion => [actor.id, floor.id].includes(motion.targetId) && !['draw', 'reveal'].includes(motion.kind))) continue;
      const tracks = candidate.tracks.filter(track => track.targetId === actor.id);
      if (tracks.some(track => track.property === 'position3d' && track.keyframes.some(key => key.value[1] !== track.keyframes[0].value[1])
        || track.property === 'rotation3d' && track.keyframes.some(key => key.value[0] !== 0 || key.value[2] !== 0))) continue;
      const support = bodyAt(candidate, floorRef, hit.aspect, sentence.startFrame);
      const body = bodyAt(candidate, actorRef, hit.aspect, sentence.startFrame);
      const delta = (support.center[1] + support.half[1] - (body.center[1] - body.half[1])) / 7;
      const y = actor.layout[hit.aspect].y - delta;
      if (Math.abs(delta) < 1e-8 || Math.abs(delta) > .12 || y < .02 || y > .98) continue;
      // The complete level path must remain on this support. Easing is
      // component-wise monotone between keys; check all key positions and
      // use the maximum horizontal rotation envelope for the actor's width.
      const frames = new Set([sentence.startFrame, sentence.endFrame,
        ...tracks.flatMap(track => track.keyframes.map(key => key.frame))]);
      let supported = true;
      for (const frame of frames) {
        const pose = bodyAt(candidate, actorRef, hit.aspect, frame);
        const radius = Math.hypot(pose.half[0], pose.half[2]);
        if ([0, 2].some(axis => Math.abs(pose.center[axis] - support.center[axis]) + radius > support.half[axis])) supported = false;
      }
      if (!supported) continue;
      actor.layout[hit.aspect].y = y;
      shifted.add(actor.id);
      aligned.add(`${hit.aspect}:${actor.id}`);
    }
  }
  if (!shifted.size || candidate.spatialChecks.length + shifted.size > 64) return illustration;
  for (const nodeId of shifted) candidate.spatialChecks.push({ subject: { nodeId }, obstacles: solids.filter(ref => ref.nodeId !== nodeId) });
  // The caller performs the ordinary full swept check and still rejects
  // every remaining collision, including any revealed by this added coverage.
  return candidate;
}
module.exports = { repairActorFloorContact };
