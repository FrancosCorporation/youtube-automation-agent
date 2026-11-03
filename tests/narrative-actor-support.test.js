'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { normalizeIllustrations } = require('../utils/narrative-illustration-plan');
const { repairActorFloorContact } = require('../utils/narrative-floor-contact');
const { bodyAt, penetration } = require('../utils/narrative-spatial-audit');
const sentence = { id: 's1', text: 'A pessoa caminha pelo piso.', startFrame: 0, endFrame: 24 };
function drawing() {
  const layout = { landscape: { x: .5, y: .5 }, portrait: { x: .5, y: .5 } };
  return [{ dimension: '3d', cueSentenceId: 's1', explanation: 'A pessoa caminha apoiada no piso durante a frase.', nodes: [
    { id: 'actor', evidence: 'pessoa', actorId: 'person-a', actorMotion: 'Walk', actorMotionCueText: 'caminha', layout: structuredClone(layout) },
    { id: 'floor', evidence: 'piso', layout, meshes: [{ type: 'box', size: [6, .1, 6], position: [0, -.05, 0], color: '#95d7bc' }] }
  ], spatialChecks: [{ subject: { nodeId: 'actor' }, obstacles: [{ nodeId: 'floor', meshIndex: 0 }] }] }];
}
test('a wholly below-floor actor is collision-free but is rejected for lack of support', () => {
  const [normalized] = normalizeIllustrations(drawing(), [sentence], 24);
  normalized.nodes[0].layout.portrait.y = .9;
  assert(penetration(bodyAt(normalized, { nodeId: 'actor' }, 'portrait', 0),
    bodyAt(normalized, { nodeId: 'floor', meshIndex: 0 }, 'portrait', 0)) < 0);
  assert.throws(() => normalizeIllustrations([normalized], [sentence], 24), /sem apoio dos pés em portrait/);
  assert.throws(() => normalizeIllustrations([normalized], [sentence], 24, { repairLayout: repairActorFloorContact }), /sem apoio dos pés/);
});
test('a small floating offset is repaired onto a unique nearby support and revalidated', () => {
  const raw = drawing(); raw[0].nodes[0].layout.landscape.y = .45;
  assert.throws(() => normalizeIllustrations(raw, [sentence], 24), /sem apoio dos pés/);
  const [fixed] = normalizeIllustrations(raw, [sentence], 24, { repairLayout: repairActorFloorContact });
  assert.equal(fixed.nodes[0].layout.landscape.y, .5);
  assert.equal(raw[0].nodes[0].layout.landscape.y, .45);
  assert.deepEqual(normalizeIllustrations([fixed], [sentence], 24), [fixed]);
});
test('support covers the complete path and visible states in both aspects', () => {
  const raw = drawing();
  raw[0].tracks = [{ targetId: 'actor', property: 'position3d', keyframes: [
    { cueSentenceId: 's1', boundary: 'start', value: [0, 0, 0] },
    { cueSentenceId: 's1', boundary: 'start', offsetSeconds: .5, value: [4, 0, 0] },
    { cueSentenceId: 's1', boundary: 'end', value: [0, 0, 0] }
  ] }];
  assert.throws(() => normalizeIllustrations(raw, [sentence], 24), /sem apoio dos pés/);
  raw[0].tracks = [{ targetId: 'actor', property: 'opacity', keyframes: [
    { cueSentenceId: 's1', boundary: 'start', value: 0 },
    { cueSentenceId: 's1', boundary: 'end', value: 1 }
  ] }];
  raw[0].nodes[0].layout.portrait.y = .45;
  assert.throws(() => normalizeIllustrations(raw, [sentence], 24), /sem apoio dos pés em portrait/);
});
