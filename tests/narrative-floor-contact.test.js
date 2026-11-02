'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { normalizeIllustrations } = require('../utils/narrative-illustration-plan');
const { repairActorFloorContact } = require('../utils/narrative-floor-contact');
const { bodyAt, auditSpatialChecks } = require('../utils/narrative-spatial-audit');
const sentence = { id: 's1', text: 'A pessoa caminha pelo piso, perto do suporte.', startFrame: 0, endFrame: 24 };
const layout = y => ({ landscape: { x: .5, y }, portrait: { x: .5, y: y + .01 } });
function drawing() {
  return [{ dimension: '3d', cueSentenceId: 's1', explanation: 'A pessoa percorre o piso apoiando os pés.', nodes: [
    { id: 'actor', evidence: 'pessoa', actorId: 'person-a', actorMotion: 'Walk', actorMotionCueText: 'caminha', layout: layout(.55) },
    { id: 'floor', evidence: 'piso', layout: layout(.5), meshes: [{ type: 'box', size: [8, .1, 8], position: [0, -.05, 0], color: '#f3eee0' }] }
  ], tracks: [{ targetId: 'actor', property: 'position3d', keyframes: [
    { cueSentenceId: 's1', boundary: 'start', value: [-1, 0, 0] },
    { cueSentenceId: 's1', boundary: 'end', value: [1, 0, 0] }
  ] }], spatialChecks: [{ subject: { nodeId: 'actor' }, obstacles: [{ nodeId: 'floor', meshIndex: 0 }] }] }];
}
test('a level walking path is supported in both layouts without changing its action or horizontal path', () => {
  const raw = drawing(), snapshot = globalThis.structuredClone(raw);
  assert.throws(() => normalizeIllustrations(raw, [sentence], 24), /colisão/);
  const [fixed] = normalizeIllustrations(raw, [sentence], 24, { repairLayout: repairActorFloorContact });
  assert.deepEqual(raw, snapshot);
  assert.equal(fixed.nodes[0].actorMotion, 'Walk');
  assert.equal(auditSpatialChecks(fixed, sentence).status, 'pass');
  for (const aspect of ['landscape', 'portrait']) for (let frame = 0; frame <= 24; frame++) {
    const actor = bodyAt(fixed, { nodeId: 'actor' }, aspect, frame), floor = bodyAt(fixed, { nodeId: 'floor', meshIndex: 0 }, aspect, frame);
    assert.ok(Math.abs(actor.center[1] - actor.half[1] - floor.center[1] - floor.half[1]) < 1e-10);
  }
  assert.deepEqual(normalizeIllustrations([fixed], [sentence], 24), [fixed]);
});
test('support alignment cannot hide an intermediate crossing of another solid', () => {
  const raw = drawing();raw[0].nodes.push({ id: 'post', evidence: 'suporte', layout: layout(.5),
    meshes: [{ type: 'box', size: [.1, 2, .1], position: [0, 1, 0], color: '#163b3e' }] });
  let rejected;
  try { normalizeIllustrations(raw, [sentence], 24, { repairLayout: repairActorFloorContact }); }
  catch (error) { rejected = error; }
  assert.match(rejected?.message || '', /colisão/);
  const [draft] = rejected.illustrationDrafts;
  const actor = bodyAt(draft, { nodeId: 'actor' }, 'landscape', 0);
  const floor = bodyAt(draft, { nodeId: 'floor', meshIndex: 0 }, 'landscape', 0);
  assert.ok(Math.abs(actor.center[1] - actor.half[1] - floor.center[1] - floor.half[1]) < 1e-10);
  assert.throws(() => normalizeIllustrations([draft], [sentence], 24), /colisão/);
  draft.nodes.find(node => node.id === 'post').layout = layout(.9);
  assert.equal(auditSpatialChecks(normalizeIllustrations([draft], [sentence], 24)[0], sentence).status, 'pass');
});
test('vertical motion, rotated supports and paths outside the platform require writer repair', () => {
  for (const change of [raw => { raw[0].tracks[0].keyframes[1].value[1] = .4; },
    raw => { raw[0].nodes[1].meshes[0].rotation = [.1, 0, 0]; },
    raw => { raw[0].tracks[0].keyframes[1].value[0] = 5; }]) {
    const raw = drawing();change(raw);
    assert.throws(() => normalizeIllustrations(raw, [sentence], 24, { repairLayout: repairActorFloorContact }), /colisão/);
  }
});
