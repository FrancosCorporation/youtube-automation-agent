'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIllustrations } = require('../utils/narrative-illustration-plan');
const { repairIdleActorLayout } = require('../utils/narrative-idle-layout');
const { auditSpatialChecks } = require('../utils/narrative-spatial-audit');

const sentence = { id: 's1', text: 'Asya e Derin aguardam perto da parede.', startFrame: 0, endFrame: 12 };
function drawing() {
  const layout = { landscape: { x: .5, y: .7, scale: .6 }, portrait: { x: .5, y: .7, scale: .6 } };
  return [{ dimension: '3d', cueSentenceId: 's1', explanation: 'Asya e Derin aguardam lado a lado.', nodes: [
    { id: 'asya', actorId: 'person-a', actorMotion: 'Idle', evidence: 'Asya', layout },
    { id: 'derin', actorId: 'person-a', actorMotion: 'Idle', evidence: 'Derin', layout },
    { id: 'floor', evidence: 'perto da parede', layout, meshes: [{ type: 'box', color: '#163b3e', size: [8, .1, 8], position: [0, -.05, 0] }] },
  ], tracks: [{ targetId: 'asya', property: 'rotation3d', keyframes: [
    { cueSentenceId: 's1', boundary: 'start', value: [0, 0, 0] },
    { cueSentenceId: 's1', boundary: 'end', value: [0, .05, 0] },
  ] }], spatialChecks: [{ subject: { nodeId: 'asya' }, obstacles: [{ nodeId: 'derin' }] }] }];
}
test('authoring separates idle actors in both aspects without changing cues, action or feet', () => {
  const raw = drawing(), snapshot = globalThis.structuredClone(raw);
  assert.throws(() => normalizeIllustrations(raw, [sentence], 24), /colisão/);
  const [repaired] = normalizeIllustrations(raw, [sentence], 24, { repairLayout: repairIdleActorLayout });
  assert.equal(auditSpatialChecks(repaired, sentence).status, 'pass');
  assert.deepEqual(raw, snapshot);
  for (const node of repaired.nodes) for (const aspect of ['landscape', 'portrait']) {
    assert.equal(node.layout[aspect].y, .7);
    assert.equal(node.layout[aspect].scale, .6);
    assert.ok(Math.abs(node.layout[aspect].x - .5) <= .1200001);
  }
  const [original] = normalizeIllustrations(raw.map(item => ({ ...item, spatialChecks: [] })), [sentence], 24);
  assert.deepEqual(repaired.tracks, original.tracks);
  assert.deepEqual(normalizeIllustrations([repaired], [sentence], 24), [repaired]);
});
test('an idle observer can be separated from a moving human without shifting the moving human', () => {
  const raw = drawing();
  raw[0].nodes[0].actorMotion = 'Walk';
  raw[0].nodes[0].actorMotionCueText = 'Asya';
  const [repaired] = normalizeIllustrations(raw, [sentence], 24, { repairLayout: repairIdleActorLayout });
  assert.equal(auditSpatialChecks(repaired, sentence).status, 'pass');
  assert.equal(repaired.nodes[0].layout.landscape.x, .5);
  assert.equal(repaired.nodes[0].layout.portrait.x, .5);
  raw[0].nodes[1].actorMotion = 'Walk';
  raw[0].nodes[1].actorMotionCueText = 'Derin';
  assert.throws(() => normalizeIllustrations(raw, [sentence], 24, { repairLayout: repairIdleActorLayout }), /colisão/);
});
test('the repair checks other solids and rejects a trapped cast rather than hiding the collision', () => {
  const raw = drawing();
  raw[0].nodes.push({ id: 'wall', evidence: 'parede', layout: { landscape: { x: .5, y: .5 }, portrait: { x: .5, y: .5 } },
    meshes: [{ type: 'box', size: [8, 8, 8], color: '#163b3e' }] });
  assert.throws(() => normalizeIllustrations(raw, [sentence], 24, { repairLayout: repairIdleActorLayout }), /colisão/);
});
test('an insufficient displacement budget preserves strict rejection', () => {
  assert.throws(() => normalizeIllustrations(drawing(), [sentence], 24,
    { repairLayout: (illustration, cue) => repairIdleActorLayout(illustration, cue, { maxShift: .001 }) }), /colisão/);
});
