'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIllustrations } = require('../utils/narrative-illustration-plan');
const { repairActorSupportFootprint } = require('../utils/narrative-support-footprint');
const { actorSupportState } = require('../utils/narrative-actor-support');
const { bodyAt } = require('../utils/narrative-spatial-audit');
const sentence = { id: 's1', text: 'A pessoa caminha pelo piso com a carga.', startFrame: 0, endFrame: 48 };
const layout = () => ({ landscape: { x: .5, y: .85 }, portrait: { x: .5, y: .85 } });

function drawing() {
  const actorLayout = layout();
  actorLayout.landscape.x = .35;
  for (const aspect of ['landscape', 'portrait']) actorLayout[aspect].scale = .9;
  return { dimension: '3d', cueSentenceId: 's1', explanation: 'A pessoa caminha apoiada no piso, conservando o percurso.', nodes: [
    { id: 'adult', evidence: 'pessoa', actorId: 'person-a', actorMotion: 'Walk', actorMotionCueText: 'caminha', depth: 4, layout: actorLayout },
    { id: 'floor', evidence: 'piso', layout: layout(), meshes: [{ type: 'box', size: [12, .1, 9], position: [0, -.05, 0], color: '#f3eee0' }] }
  ], tracks: [{ targetId: 'adult', property: 'position3d', keyframes: [
    { cueSentenceId: 's1', boundary: 'start', value: [0, 0, 0] },
    { cueSentenceId: 's1', boundary: 'end', value: [0, 0, .4] }
  ] }], spatialChecks: [{ subject: { nodeId: 'adult' }, obstacles: [{ nodeId: 'floor', meshIndex: 0 }] }] };
}

test('correct height and insufficient depth receive distinct actionable feedback', () => {
  let failure;
  try { normalizeIllustrations([drawing()], [sentence], 24); } catch (error) { failure = error; }
  assert.match(failure?.message || '', /diferençaY=0; excede borda X=0, Z=0\.0/);
  assert.match(failure.message, /altura correta: ajuste piso\/percurso/);
  const raw = drawing(); raw.nodes[0].layout.portrait.y -= .05;
  raw.tracks[0].keyframes[1].value[2] = 0;
  assert.throws(() => normalizeIllustrations([raw], [sentence], 24), /diferençaY=0\.35.*alinhe altura/);
});

test('slight missing ground is solved without moving the actor or changing the clip/timeline', () => {
  const raw = drawing(), original = globalThis.structuredClone(raw);
  const [fixed] = normalizeIllustrations([raw], [sentence], 24, { repairLayout: repairActorSupportFootprint });
  assert.deepEqual(raw, original);
  assert.ok(Math.abs(fixed.nodes[1].meshes[0].size[2] - 9.45) < 1e-10);
  assert.deepEqual(fixed.nodes[1].meshes[0].position, [0, -.05, 0]);
  assert.equal(fixed.nodes[0].depth, 4);
  assert.equal(fixed.nodes[0].layout.landscape.y, .85);
  assert.equal(fixed.nodes[0].actorMotion, 'Walk');
  assert.deepEqual(fixed.tracks[0].keyframes.map(key => key.value), [[0, 0, 0], [0, 0, .4]]);
  for (const aspect of ['landscape', 'portrait']) for (let frame = 0; frame <= 48; frame += .25) {
    assert.equal(actorSupportState(bodyAt(fixed, { nodeId: 'adult' }, aspect, frame),
      bodyAt(fixed, { nodeId: 'floor', meshIndex: 0 }, aspect, frame)).supported, true);
  }
  assert.deepEqual(normalizeIllustrations([fixed], [sentence], 24), [fixed], 'publication validation stays strict and does not repair');
  assert.equal(repairActorSupportFootprint(fixed, sentence), fixed, 'repair is idempotent');
});

test('a new collision caused by extending the support still rejects the scene', () => {
  const raw = drawing();
  raw.nodes.push({ id: 'cargo', evidence: 'carga', layout: layout(),
    meshes: [{ type: 'box', size: [.2, .08, .2], position: [0, -.05, 4.65], color: '#ecb47e' }] });
  assert.throws(() => normalizeIllustrations([raw], [sentence], 24, { repairLayout: repairActorSupportFootprint }), /colisão.*floor.*cargo/);
});

test('large missing ground, vertical paths and rotating actors remain rejected', () => {
  for (const change of [raw => { raw.tracks[0].keyframes[1].value[2] = 1.6; },
    raw => { raw.tracks[0].keyframes[1].value[1] = .3; },
    raw => { raw.tracks.push({ targetId: 'adult', property: 'rotation3d', keyframes: [
      { cueSentenceId: 's1', boundary: 'start', value: [0, 0, 0] },
      { cueSentenceId: 's1', boundary: 'end', value: [0, .3, 0] }
    ] }); }]) {
    const raw = drawing(); change(raw);
    assert.throws(() => normalizeIllustrations([raw], [sentence], 24, { repairLayout: repairActorSupportFootprint }), /sem apoio dos pés/);
  }
});

test('overlapping possible supports do not invent a choice of floor', () => {
  const raw = drawing(); raw.nodes.push({ ...globalThis.structuredClone(raw.nodes[1]), id: 'other-floor' });
  assert.throws(() => normalizeIllustrations([raw], [sentence], 24, { repairLayout: repairActorSupportFootprint }), /sem apoio dos pés/);
});
