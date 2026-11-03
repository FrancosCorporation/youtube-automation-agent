'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIllustrations } = require('../utils/narrative-illustration-plan');
const { bodyAt, penetration, auditSpatialChecks } = require('../utils/narrative-spatial-audit');
const { buildAdaptivePrompt, sceneFailureTag } = require('../utils/narrative-scene-author');
const { CREATIVE_REFERENCE } = require('../utils/narrative-creative-reference');
const sentence = { id: 's1', text: 'A esfera passa ao lado do suporte.', startFrame: 0, endFrame: 24 };
function drawing(x = 0) {
  const layout = { landscape: { x: .5, y: .5 }, portrait: { x: .5, y: .5 } };
  return [{ dimension: '3d', cueSentenceId: 's1', explanation: 'A esfera percorre o corredor ao lado do suporte sólido.', nodes: [
    { id: 'ball', evidence: 'esfera', layout, meshes: [{ type: 'sphere', color: '#ecb47e', size: [.6, .6, .6] }] },
    { id: 'post', evidence: 'suporte', layout, meshes: [{ type: 'box', color: '#95d7bc', position: [x, 0, .123], size: [.18, 2, .06] }] },
  ], tracks: [{ targetId: 'ball', property: 'position3d', keyframes: [
    { cueSentenceId: 's1', boundary: 'start', value: [0, 0, -1] },
    { cueSentenceId: 's1', boundary: 'end', value: [0, 0, 1] },
  ] }], spatialChecks: [{ subject: { nodeId: 'ball', meshIndex: 0 }, obstacles: [{ nodeId: 'post', meshIndex: 0 }] }] }];
}
test('detects a support crossing even though both trajectory endpoints are free', () => {
  assert.throws(() => normalizeIllustrations(drawing(), [sentence], 24), /colisão ball\[0\] atravessa post\[0\]/);
  const result = normalizeIllustrations(drawing(.8), [sentence], 24);
  assert.deepEqual(normalizeIllustrations(result, [sentence], 24), result);
});
test('checks the vertical layout independently', () => {
  const raw = drawing(.8);
  raw[0].nodes[1].layout = { landscape: { x: .5, y: .5 }, portrait: { x: .5 - .8 / 9.6, y: .5 } };
  assert.throws(() => normalizeIllustrations(raw, [sentence], 24), /em portrait/);
});
test('fast passage through a thin obstacle cannot pass just because integer frames miss it', () => {
  const raw = drawing();
  raw[0].tracks[0].keyframes[1].offsetSeconds = -23 / 24;
  assert.throws(() => normalizeIllustrations(raw, [sentence], 24), /colisão|rápido demais/);
});
test('constant transforms are checked once while hidden or displaced intermediate states remain sampled', () => {
  const [illustration] = normalizeIllustrations(drawing(.8), [sentence], 24);
  illustration.tracks = [];
  const held = auditSpatialChecks(illustration, sentence);
  assert.equal(held.status, 'pass');
  assert.equal(held.samples, 2);
  for (const aspect of ['landscape', 'portrait']) for (let frame = 0; frame <= 24; frame += .25) {
    assert.deepEqual(bodyAt(illustration, { nodeId: 'ball', meshIndex: 0 }, aspect, frame),
      bodyAt(illustration, { nodeId: 'ball', meshIndex: 0 }, aspect, 0));
  }
  illustration.tracks = [{ targetId: 'ball', property: 'position3d', keyframes: [
    { frame: 0, value: [0, 0, 0] }, { frame: 12, value: [.8, 0, 0] }, { frame: 24, value: [0, 0, 0] }
  ] }];
  assert.equal(auditSpatialChecks(illustration, sentence).status, 'collision');
  illustration.tracks = [{ targetId: 'ball', property: 'position3d', keyframes: [
    { frame: 0, value: [.8, 0, 0] }, { frame: 24, value: [.8, 0, 0] }
  ] }, { targetId: 'ball', property: 'opacity', keyframes: [
    { frame: 0, value: 0 }, { frame: 12, value: 1 }, { frame: 24, value: 0 }
  ] }];
  assert.equal(auditSpatialChecks(illustration, sentence).status, 'collision');
});
test('contact is permitted but penetration is not; rotated boxes respect their actual axes', () => {
  const basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const sphere = { type: 'sphere', center: [.8, 0, 0], radius: .3 };
  const box = { type: 'box', center: [0, 0, 0], half: [.5, .5, .5], axes: basis };
  assert.ok(Math.abs(penetration(sphere, box)) < 1e-10);
  assert.ok(penetration({ ...sphere, center: [.6, 0, 0] }, box) > .1);
  const box2 = { ...box, center: [2, 0, 0], axes: [[Math.SQRT1_2, Math.SQRT1_2, 0], [-Math.SQRT1_2, Math.SQRT1_2, 0], [0, 0, 1]] };
  assert.ok(penetration(box, box2) < 0);
});
test('mesh translation follows parent rotation and scale, matching the renderer transform order', () => {
  const [illustration] = normalizeIllustrations(drawing(2), [sentence], 24);
  const node = illustration.nodes[0]; node.layout.landscape.rotate = 90; node.layout.landscape.scale = 2;
  node.meshes[0].position = [1, 0, 0]; illustration.tracks = [];
  const body = bodyAt(illustration, { nodeId: 'ball', meshIndex: 0 }, 'landscape', 0);
  assert.ok(Math.abs(body.center[0]) < 1e-10); assert.equal(body.center[1], 2); assert.equal(body.radius, .6);
});
test('human actor collision checks use a conservative full-body envelope in both aspects', () => {
  const spoken = { id: 's1', text: 'Uma pessoa caminha ao lado do suporte.', startFrame: 0, endFrame: 24 };
  const layout = { landscape: { x: .5, y: .5 }, portrait: { x: .5, y: .5 } };
  const raw = [{ dimension: '3d', cueSentenceId: 's1', explanation: 'A pessoa caminha perto do suporte.', nodes: [
    { id: 'person', evidence: 'pessoa', actorId: 'person-a', actorMotion: 'Walk', actorMotionCueText: 'caminha', layout },
    { id: 'floor', evidence: 'ao lado do suporte', layout, meshes: [{ type: 'box', color: '#163b3e', position: [0, -.05, 0], size: [8, .1, 8] }] },
    { id: 'support', evidence: 'suporte', layout, meshes: [{ type: 'box', color: '#95d7bc', position: [0, .82, 0], size: [.2, 1.8, .2] }] }
  ], spatialChecks: [{ subject: { nodeId: 'person' }, obstacles: [{ nodeId: 'support', meshIndex: 0 }] }] }];
  assert.throws(() => normalizeIllustrations(raw, [spoken], 24), /colisão person atravessa support/);
  const [illustration] = normalizeIllustrations(drawing(2), [sentence], 24);
  const [actor] = normalizeIllustrations(raw.map(item => ({ ...item, spatialChecks: [] })), [spoken], 24);
  const body = bodyAt(actor, { nodeId: 'person' }, 'landscape', 0);
  assert.equal(body.type, 'box');
  assert.ok(body.half[1] > .8);
  assert.equal(illustration.dimension, '3d');
});
test('approved creative direction is injected on first authorship and repair requests, without model calls', () => {
  for (const retryErrors of [[], ['illustration: colisão ball[0] atravessa post[0]']]) {
    const prompt = buildAdaptivePrompt({ plan: { title: 'Outro assunto', fps: 24 }, chapterInputs: [{ id: 'scene-1', narration: [sentence] }], retryErrors });
    assert.ok(prompt.includes(CREATIVE_REFERENCE.id));
    assert.match(prompt, /não copie frutas/);
    assert.match(prompt, /spatialChecks/);
    assert.match(prompt, /preparação, ação, contato/);
    assert.match(prompt, /actorId/);
    assert.match(prompt, /person-a/);
  }
  assert.equal(sceneFailureTag(new Error('illustration: colisão ball[0] atravessa post[0]')), 'invalid_adaptive_illustration');
});
test('author receives measured word times so offsets are not mistaken for elapsed sentence time', () => {
  const spoken = { ...sentence, startFrame: 240, endFrame: 480, wordTimings: [{ text: 'esfera', startFrame: 276 }] };
  const prompt = buildAdaptivePrompt({ plan: { title: 'Movimento', fps: 24 }, chapterInputs: [{ id: 'scene-1', narration: [spoken] }] });
  assert.match(prompt, /"startFrame":240,"endFrame":480,"fps":24/);
  const cues = JSON.parse(prompt.split('\n').find(line => line.startsWith('Cenas e narração exata: ')).slice('Cenas e narração exata: '.length))[0].sentences[0].wordCues;
  assert.deepEqual(cues, [{ text: 'esfera', atSeconds: 1.5,
    keyframeCue: { cueSentenceId: 's1', boundary: 'word', cueText: 'esfera', offsetSeconds: 0 } }]);
  assert.match(prompt, /offsetSeconds permanece ZERO/);
});
