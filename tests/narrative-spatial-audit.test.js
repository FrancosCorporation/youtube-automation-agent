'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIllustrations } = require('../utils/narrative-illustration-plan');
const { bodyAt, penetration } = require('../utils/narrative-spatial-audit');
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
test('approved creative direction is injected on first authorship and repair requests, without model calls', () => {
  for (const retryErrors of [[], ['illustration: colisão ball[0] atravessa post[0]']]) {
    const prompt = buildAdaptivePrompt({ plan: { title: 'Outro assunto', fps: 24 }, chapterInputs: [{ id: 'scene-1', narration: [sentence] }], retryErrors });
    assert.ok(prompt.includes(CREATIVE_REFERENCE.id));
    assert.match(prompt, /não copie frutas/);
    assert.match(prompt, /spatialChecks/);
    assert.match(prompt, /preparação, ação, contato/);
  }
  assert.equal(sceneFailureTag(new Error('illustration: colisão ball[0] atravessa post[0]')), 'invalid_adaptive_illustration');
});
