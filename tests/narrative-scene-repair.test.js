'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applySceneRepairs } = require('../utils/narrative-scene-repair');

const draft = { id: 'scene-01', illustrations: [{ cueSentenceId: 's1', nodes: [
  { id: 'actor', evidence: 'pessoa', layout: { landscape: { x: .5 }, portrait: { x: .5 } }, meshes: [] }
], spatialChecks: [{ subject: { nodeId: 'actor' } }], tracks: [] }] };
test('localized repairs change only specified geometry and preserve the source draft', () => {
  const fixed = applySceneRepairs(draft, { repairs: [{ path: '/illustrations/0/nodes/0/layout/portrait/x', valueJson: '0.8' }] });
  assert.equal(fixed.illustrations[0].nodes[0].layout.portrait.x, .8);
  assert.equal(draft.illustrations[0].nodes[0].layout.portrait.x, .5);
  assert.deepEqual(fixed.illustrations[0].spatialChecks, draft.illustrations[0].spatialChecks);
});
test('a repair cannot remove QA, rewrite source/identity, create arbitrary fields or mutate prototypes', () => {
  for (const path of ['/illustrations/0/spatialChecks', '/illustrations/0/nodes', '/illustrations/0/nodes/0/id',
    '/illustrations/0/nodes/0/evidence', '/illustrations/0/nodes/0/layout/landscape/z',
    '/illustrations/0/tracks/__proto__/polluted', '/illustrations/0/camera/constructor/prototype/polluted']) {
    assert.throws(() => applySceneRepairs(draft, { repairs: [{ path, valueJson: '[]' }] }), /reparo localizado/);
  }
  assert.throws(() => applySceneRepairs(draft, { repairs: [] }), /reparo localizado/);
  assert.equal({}.polluted, undefined);
});
