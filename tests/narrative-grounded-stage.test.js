'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIllustrations } = require('../utils/narrative-illustration-plan');
const { repairGroundedStage } = require('../utils/narrative-grounded-stage');
const { repairActorFraming } = require('../utils/narrative-actor-framing');
const { bodyAt, auditSpatialChecks } = require('../utils/narrative-spatial-audit');
const { assertActorSupports } = require('../utils/narrative-actor-support');
const sentence = {id: 's1', text: 'A pessoa assume as tarefas na mesa perto do piso e da parede.', startFrame: 0, endFrame: 48};
const pose = (x, y) => ({landscape: {x, y}, portrait: {x, y}});
function drawing() {
  return {dimension: '3d', cueSentenceId: 's1', explanation: 'A pessoa assume as tarefas na mesa.', nodes: [
    {id: 'floor', evidence: 'piso', depth: -4, layout: pose(.5, .92), meshes: [{type: 'box', size: [12,.1,12], position: [0,-.05,0], color: '#f3eee0'}]},
    {id: 'table', evidence: 'mesa', depth: -2, layout: pose(.5,.55), meshes: [{type: 'box', size: [4,.8,2.5], position: [0,.4,0], color: '#163b3e'}]},
    {id: 'adult', evidence: 'pessoa', actorId: 'person-a', actorMotion: 'Carry idle', actorMotionCueText: 'assume', depth: -1, layout: pose(.35,.55)},
    {id: 'task', evidence: 'tarefas', depth: -2, layout: pose(.5,.55), meshes: [{type: 'box', size: [.4,.1,.6], position: [-1.2,.85,0], color: '#75baca'}]}
  ], tracks: [{targetId: 'adult', property: 'position3d', keyframes: [
    {cueSentenceId: 's1', boundary: 'start', value: [0,0,0]}, {cueSentenceId: 's1', boundary: 'end', value: [.8,0,0]}]},
    {targetId: 'floor', property: 'position3d', keyframes: [
      {cueSentenceId: 's1', boundary: 'start', value: [0,0,0]}, {cueSentenceId: 's1', boundary: 'end', value: [0,0,0]}]}],
  spatialChecks: [{subject: {nodeId: 'adult'}, obstacles: [{nodeId: 'floor', meshIndex: 0}, {nodeId: 'table', meshIndex: 0}]}]};
}
const repair = (drawing, sentence) => repairActorFraming(repairGroundedStage(drawing, sentence), sentence);

test('grounding preserves table-top contact and the whole actor path while resolving a real overlap', () => {
  const raw = drawing(), snapshot = globalThis.structuredClone(raw);
  assert.throws(() => normalizeIllustrations([raw], [sentence], 24), /colisão|sem apoio/);
  const [fixed] = normalizeIllustrations([raw], [sentence], 24, {repairLayout: repair});
  assert.deepEqual(raw, snapshot);
  assert.equal(fixed.nodes.find(n => n.id === 'table').solidRole, 'table');
  assert.equal(fixed.nodes.find(n => n.id === 'adult').actorMotion, 'Carry idle');
  assert.deepEqual(fixed.tracks[0].keyframes.map(k => k.value), [[0,0,0],[.8,0,0]]);
  assert.equal(auditSpatialChecks(fixed, sentence).status, 'pass');
  assertActorSupports(fixed, sentence);
  for (const aspect of ['landscape','portrait']) {
    const table = bodyAt(fixed,{nodeId:'table',meshIndex:0},aspect,0), task = bodyAt(fixed,{nodeId:'task',meshIndex:0},aspect,0);
    const floor = bodyAt(fixed,{nodeId:'floor',meshIndex:0},aspect,0);
    assert(Math.abs(table.center[1]-table.half[1]-floor.center[1]-floor.half[1])<1e-9);
    assert(Math.abs(task.center[1]-task.half[1]-table.center[1]-table.half[1])<1e-9);
  }
  assert.deepEqual(repairGroundedStage(fixed, sentence), fixed, 'repeated repair does not grow checks or shift again');
  assert.deepEqual(normalizeIllustrations([fixed],[sentence],24),[fixed]);
});

test('new obstacles remain enforced and ambiguous floors are not selected arbitrarily', () => {
  const raw = drawing(); raw.nodes.push({...globalThis.structuredClone(raw.nodes[0]),id:'other-floor'});
  assert.throws(() => normalizeIllustrations([raw],[sentence],24,{repairLayout:repair}),/colisão|sem apoio/);
  const blocked = drawing();
  blocked.nodes.push({id:'wall',evidence:'parede',layout:pose(.5,.92),depth:-1,
    meshes:[{type:'box',size:[12,4,12],position:[0,2,0],color:'#163b3e'}]});
  assert.throws(() => normalizeIllustrations([blocked],[sentence],24,{repairLayout:repair}),/colisão/);
});

test('a ground slab mislabeled as furniture is not checked against itself or rendered as a table', () => {
  const raw = drawing();
  raw.nodes[0].solidRole = 'table';
  const [fixed] = normalizeIllustrations([raw], [sentence], 24, { repairLayout: repair });
  assert.equal(fixed.nodes[0].solidRole, undefined);
  assert.equal(raw.nodes[0].solidRole, 'table', 'source is preserved');
  assert.equal(auditSpatialChecks(fixed, sentence).status, 'pass');
  assert.deepEqual(normalizeIllustrations([fixed], [sentence], 24), [fixed]);
  const floatingTable = globalThis.structuredClone(fixed);
  floatingTable.nodes.find(node => node.id === 'table').layout.landscape.y -= .1;
  assert.throws(() => normalizeIllustrations([floatingTable], [sentence], 24), /sem apoio no piso|colisão/);
});

test('a small bag resting on the table stays supported, but lifting it with no carrier fails', () => {
  const raw = drawing();
  const bag = raw.nodes.find(n => n.id === 'task');
  bag.solidRole = 'bag';
  raw.nodes.find(n => n.id === 'adult').actorMotion = 'Idle';
  // Ground the furniture first; the bag is placed on its repaired top.
  raw.nodes.find(n => n.id === 'table').layout = pose(.5,.92);
  bag.layout = pose(.5,.92);
  const [fixed] = normalizeIllustrations([raw],[sentence],24,{repairLayout:repair});
  assert.equal(auditSpatialChecks(fixed,sentence).status,'pass');
  const floating = globalThis.structuredClone(fixed);
  floating.nodes.find(n => n.id === 'adult').actorMotion = 'Idle';
  // Without Carry, the renderer has no held-load relationship to justify lift.
  floating.tracks.push({targetId:'task',property:'position3d',keyframes:[
    {cueSentenceId:'s1',boundary:'start',value:[0,0,0]},
    {cueSentenceId:'s1',boundary:'end',value:[0,.2,0]}
  ]});
  assert.throws(() => normalizeIllustrations([floating],[sentence],24),/flutua sem apoio/);
});
