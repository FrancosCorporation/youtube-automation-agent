'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { completeMovingBodyChecks } = require('../utils/narrative-spatial-coverage');
const { normalizeIllustrations } = require('../utils/narrative-illustration-plan');
const sentence = { id: 's1', text: 'A esfera passa ao lado do suporte.', startFrame: 0, endFrame: 24 };
function drawing(x = .8) {
  const layout = { landscape: { x: .5, y: .5 }, portrait: { x: .5, y: .5 } };
  return { dimension: '3d', cueSentenceId: 's1', explanation: 'A esfera percorre o espaço ao lado do suporte.', nodes: [
    { id: 'ball', evidence: 'esfera', layout, meshes: [{ type: 'sphere', size: [.6, .6, .6], color: '#95d7bc' }] },
    { id: 'post', evidence: 'suporte', layout, meshes: [{ type: 'box', position: [x, 0, .123], size: [.18, 2, .06], color: '#163b3e' }] }
  ], tracks: [{ targetId: 'ball', property: 'position3d', keyframes: [
    { cueSentenceId: 's1', boundary: 'start', value: [0, 0, -1] },
    { cueSentenceId: 's1', boundary: 'end', value: [0, 0, 1] }
  ] }] };
}
test('missing declarations are derived from all known solids without changing geometry or movement', () => {
  const raw = drawing(), snapshot = globalThis.structuredClone(raw);
  const completed = completeMovingBodyChecks(raw);
  assert.deepEqual(raw, snapshot);
  assert.deepEqual(completed.nodes, raw.nodes);
  assert.deepEqual(completed.tracks, raw.tracks);
  assert.deepEqual(completed.spatialChecks, [{ subject: { nodeId: 'ball', meshIndex: 0 }, obstacles: [{ nodeId: 'post', meshIndex: 0 }] }]);
  assert.doesNotThrow(() => normalizeIllustrations([completed], [sentence], 24));
  assert.equal(completeMovingBodyChecks(completed), completed);
});
test('a derived declaration still rejects collisions halfway through the trajectory', () => {
  assert.throws(() => normalizeIllustrations([completeMovingBodyChecks(drawing(0))], [sentence], 24), /colisão/);
});
test('unsupported geometry requires explicit author repair instead of assuming a free path', () => {
  const raw = drawing();raw.nodes[0].meshes[0].type = 'torus';
  assert.equal(completeMovingBodyChecks(raw), raw);
  assert.equal(raw.spatialChecks, undefined);
});
