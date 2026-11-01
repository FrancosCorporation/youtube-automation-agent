'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIllustrations } = require('../utils/narrative-illustration-plan');
const sentence = { id: 's1', text: 'Uma onda avança em direção à costa.', startFrame: 0, endFrame: 240,
  wordTimings: [{ text: 'avança', startFrame: 72, endFrame: 82 }] };
const layout = { landscape: { x: .3, y: .5, scale: 1 }, portrait: { x: .5, y: .3, scale: .8 } };
function drawing() {
  return [{ cueSentenceId: 's1', explanation: 'A água se desloca em direção à faixa da costa.', nodes: [
    { id: 'wave', evidence: 'onda', label: '', layout, shapes: [{ type: 'path', d: 'M-100 40Q0-90 100 40Z', fill: '#75baca' }] },
    { id: 'coast', evidence: 'costa', label: 'costa', layout, shapes: [{ type: 'rect', x: -90, y: -30, width: 180, height: 60, fill: '#ecb47e' }] }
  ], motions: [{ targetId: 'wave', kind: 'move', cueText: 'avança', durationSeconds: 2, to: { landscape: { x: .7, y: .5, scale: 1 }, portrait: { x: .5, y: .7, scale: .8 } } }] }];
}
test('arbitrary authored geometry survives normalization and cache rebinding without topic recipes', () => {
  const result = normalizeIllustrations(drawing(), [sentence], 24);
  assert.equal(result[0].nodes[0].shapes[0].d, 'M-100 40Q0-90 100 40Z');
  assert.equal(result[0].motions[0].startFrame, 72);
  assert.equal(result[0].motions[0].endFrame, 120);
  assert.deepEqual(normalizeIllustrations(result, [sentence], 24), result);
});
test('untrusted vector plans cannot inject markup, URLs, unsupported primitives or ungrounded labels', () => {
  for (const bad of [
    d => { d[0].nodes[0].shapes[0].d = '<script>alert(1)</script>'; },
    d => { d[0].nodes[0].shapes[0].fill = 'url(https://external.test/x)'; },
    d => { d[0].nodes[0].shapes[0].type = 'foreignObject'; },
    d => { d[0].nodes[0].label = '100 metros'; },
    d => { d[0].motions[0].targetId = 'missing'; }
  ]) { const data = drawing(); bad(data); assert.throws(() => normalizeIllustrations(data, [sentence], 24), /illustration:/); }
});
test('authored 3D uses bounded meshes, separate layouts and the same speech cues', () => {
  const data = drawing(); data[0].dimension = '3d';
  for (const node of data[0].nodes) { node.shapes = []; node.meshes = [{ type: 'box', color: '#75baca', size: [3, .3, 2] }]; }
  const result = normalizeIllustrations(data, [sentence], 24);
  assert.equal(result[0].dimension, '3d');
  assert.equal(result[0].nodes[0].meshes[0].size[0], 3);
  assert.equal(result[0].motions[0].startFrame, 72);
  data[0].nodes[0].meshes[0].size[0] = Infinity;
  assert.throws(() => normalizeIllustrations(data, [sentence], 24), /illustration:/);
});
