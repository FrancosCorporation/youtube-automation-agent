'use strict';

const { auditSpatialChecks } = require('./narrative-spatial-audit');

// Authoring-time layout correction only. Publication validation remains strict
// and never changes a saved plan. Clip-driven/contact actions are excluded.
function repairIdleActorLayout(illustration, sentence, { maxShift = .12 } = {}) {
  if (illustration.dimension !== '3d' || !illustration.spatialChecks?.length) return illustration;
  const originalAudit = auditSpatialChecks(illustration, sentence);
  if (originalAudit.status !== 'collision') return illustration;
  const nodesById = new Map(illustration.nodes.map(node => [node.id, node]));
  const idle = ref => {
    const node = nodesById.get(ref.nodeId);
    return node?.actorId && node.actorMotion === 'Idle' && ref.meshIndex == null;
  };
  if (!originalAudit.collisions.every(hit => idle(hit.subject) || idle(hit.obstacle))) return illustration;
  // Do not translate actors whose rendered motion uses legacy layout changes.
  const actorIds = [...new Set(originalAudit.collisions.flatMap(hit => [hit.subject, hit.obstacle]).filter(idle).map(ref => ref.nodeId))];
  if ((illustration.motions || []).some(motion => actorIds.includes(motion.targetId)
    && !['draw', 'reveal'].includes(motion.kind))) return illustration;
  const solids = [];
  for (const node of illustration.nodes) {
    if (node.actorId) solids.push({ nodeId: node.id });
    else for (const [meshIndex, mesh] of node.meshes.entries()) {
      if (!['box', 'sphere', 'cylinder'].includes(mesh.type)) return illustration;
      solids.push({ nodeId: node.id, meshIndex });
    }
  }
  if (solids.length > 129 || illustration.spatialChecks.length + actorIds.length > 64) return illustration;
  let candidate = globalThis.structuredClone(illustration);
  // Every candidate is checked against every known solid, not just the pair
  // initially reported. Preserve the original checks and add full coverage.
  for (const nodeId of actorIds) candidate.spatialChecks.push({ subject: { nodeId },
    obstacles: solids.filter(ref => ref.nodeId !== nodeId) });
  let audit = auditSpatialChecks(candidate, sentence);
  if (!audit.collisions.every(hit => idle(hit.subject) || idle(hit.obstacle))) return candidate;
  const origins = new Map(actorIds.map(id => [id, illustration.nodes.find(node => node.id === id).layout]));
  const shifts = [.01, -.01, .02, -.02, .04, -.04, .06, -.06, .08, -.08, .10, -.10, .12, -.12].filter(shift => Math.abs(shift) <= maxShift);
  const score = checked => checked.collisions.length * 1000 + checked.collisions.reduce((sum, hit) => sum + hit.penetrationMeters, 0);
  for (let round = 0; round < actorIds.length * 2 && audit.collisions.length; round++) {
    let improved = null;
    let bestScore = score(audit);
    const targets = [...new Set(audit.collisions.flatMap(hit => [
      `${hit.aspect}:${hit.subject.nodeId}`, `${hit.aspect}:${hit.obstacle.nodeId}`
    ]))];
    search:
    for (const target of targets) {
      const [aspect, nodeId] = target.split(':');
      if (!origins.has(nodeId)) continue;
      for (const shift of shifts) {
        const x = origins.get(nodeId)[aspect].x + shift;
        if (x < .02 || x > .98) continue;
        const trial = globalThis.structuredClone(candidate);
        trial.nodes.find(node => node.id === nodeId).layout[aspect].x = x;
        const checked = auditSpatialChecks(trial, sentence);
        if (score(checked) < bestScore) {
          improved = { illustration: trial, audit: checked };
          bestScore = score(checked);
          if (!checked.collisions.length) break search;
        }
      }
    }
    if (!improved) break;
    candidate = improved.illustration;
    audit = improved.audit;
  }
  // An unsuccessful correction is still rejected by the ordinary strict audit.
  return candidate;
}

module.exports = { repairIdleActorLayout };
