'use strict';

// Authoring helper: derive missing collision declarations from known solids.
// It never changes geometry or suppresses the subsequent strict swept audit.
function completeMovingBodyChecks(illustration) {
  if (illustration.dimension !== '3d' || !Array.isArray(illustration.nodes)) return illustration;
  const solids = [];
  for (const node of illustration.nodes) {
    if (node.actorId) solids.push({ nodeId: node.id });
    else {
      if (!Array.isArray(node.meshes) || !node.meshes.length) return illustration;
      for (const [meshIndex, mesh] of node.meshes.entries()) {
        if (!['box', 'sphere', 'cylinder'].includes(mesh.type)) return illustration;
        solids.push({ nodeId: node.id, meshIndex });
      }
    }
  }
  if (solids.length > 129) return illustration;
  const checks = [...(illustration.spatialChecks || [])];
  for (const track of illustration.tracks || []) {
    if (track.property !== 'position3d' || track.targetId === 'camera') continue;
    if (checks.some(check => check.subject?.nodeId === track.targetId
      && (track.meshIndex == null || check.subject.meshIndex === track.meshIndex))) continue;
    const subjects = solids.filter(ref => ref.nodeId === track.targetId
      && (track.meshIndex == null || ref.meshIndex === track.meshIndex));
    // Parts of a rigid node move together. Other nodes remain obstacles;
    // declared checks between articulated members are preserved separately.
    const obstacles = solids.filter(ref => ref.nodeId !== track.targetId);
    if (!subjects.length || !obstacles.length || obstacles.length > 128) return illustration;
    for (const subject of subjects) checks.push({ subject, obstacles });
    if (checks.length > 64) return illustration;
  }
  return checks.length === (illustration.spatialChecks || []).length
    ? illustration : { ...illustration, spatialChecks: checks };
}

module.exports = { completeMovingBodyChecks };
