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
test('a stationary legacy move cannot satisfy narrative motion in either aspect', () => {
  const raw = drawing();
  raw[0].motions[0].to.portrait = { ...raw[0].nodes[0].layout.portrait };
  assert.throws(() => normalizeIllustrations(raw, [sentence], 24), /ação sem mudança visível em portrait/);
  raw[0].motions[0].to.landscape = { ...raw[0].nodes[0].layout.landscape };
  assert.throws(() => normalizeIllustrations(raw, [sentence], 24), /ação sem mudança visível em landscape/);
});
test('holds and camera travel alone cannot replace an object action', () => {
  const raw = drawing(); raw[0].dimension = '3d'; raw[0].motions = [];
  for (const node of raw[0].nodes) { node.shapes = []; node.meshes = [{ type: 'box', color: '#75baca', size: [1, 1, 1] }]; }
  const track = (targetId, property, values) => ({ targetId, property, keyframes: values.map((value, index) => ({
    cueSentenceId: sentence.id, boundary: index ? 'end' : 'start', value
  })) });
  raw[0].tracks = [track('wave', 'opacity', [1, 1]), track('camera', 'position3d', [[0, 0, 0], [0, 1, 0]])];
  assert.throws(() => normalizeIllustrations(raw, [sentence], 24), /ação sem mudança visível/);
  raw[0].tracks[0] = track('wave', 'opacity', [0, 1]);
  assert.equal(normalizeIllustrations(raw, [sentence], 24).length, 1);
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
test('narrated people use a detailed licensed actor with a speech-aligned local clip', () => {
  const spoken = { id: 'person-cue', text: 'Uma pessoa caminha até a costa.', startFrame: 0, endFrame: 240,
    wordTimings: [{ text: 'caminha', startFrame: 60, endFrame: 76 }] };
  const layout = { landscape: { x: .35, y: .62, scale: .8 }, portrait: { x: .5, y: .5, scale: .65 } };
  const raw = [{ dimension: '3d', cueSentenceId: spoken.id, explanation: 'A pessoa caminha até a costa mostrada no cenário.', nodes: [
    { id: 'actor', evidence: 'pessoa', label: 'pessoa', actorId: 'person-a', actorMotion: 'Walk', actorMotionCueText: 'caminha', layout },
    { id: 'coast', evidence: 'costa', label: 'costa', layout, meshes: [{ type: 'box', color: '#ecb47e', size: [3, .2, 1], position: [0, -.1, 0] }] }
  ] }];
  const [result] = normalizeIllustrations(raw, [spoken], 24);
  assert.equal(result.nodes[0].actorId, 'person-a');
  assert.match(result.nodes[0].actorSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.nodes[0].actorMotionStartFrame, 60);
  assert.deepEqual(normalizeIllustrations([result], [spoken], 24)[0], result);
  const unsupported = JSON.parse(JSON.stringify(raw));
  unsupported[0].nodes[0].actorMotionCueText = 'corre';
  assert.throws(() => normalizeIllustrations(unsupported, [spoken], 24), /movimento humano precisa de cue literal/);
});

test('narrated people cannot fall back to procedural person glyphs', () => {
  const spoken = { ...sentence, text: 'Uma pessoa caminha pela costa.' };
  const raw = drawing();
  raw[0].nodes[0].prop = 'person';
  raw[0].nodes[0].evidence = 'pessoa';
  assert.throws(() => normalizeIllustrations(raw, [spoken], 24), /não desenhe pessoas com pictogramas/);
});

test('geometry repair identifies the exact mesh axis and numeric bounds', () => {
  const data = drawing(); data[0].dimension = '3d';
  for (const node of data[0].nodes) {
    node.shapes = [];
    node.meshes = [{ type: 'box', color: '#75baca', size: [3, .3, 2] }];
  }
  data[0].nodes[0].meshes[0].size[1] = -0.3;
  assert.throws(() => normalizeIllustrations(data, [sentence], 24), error =>
    error.message.includes('s1/wave.meshes[0].size[1]')
    && error.message.includes('recebido -0.3') && error.message.includes('permitido 0.01–12'));
  data[0].nodes[0].meshes[0].size[1] = .3;
  assert.equal(normalizeIllustrations(data, [sentence], 24)[0].nodes[0].meshes[0].size[1], .3);
});

test('missing scale amount has an actionable diagnostic without echoing arbitrary values', () => {
  const data = drawing(); data[0].motions[0].kind = 'scale';
  assert.throws(() => normalizeIllustrations(data, [sentence], 24), error =>
    error.message.includes('s1/wave.scale') && error.message.includes('tipo undefined')
    && error.message.includes('permitido 0.05–3'));
  data[0].motions[0].amount = 'private-token-example';
  assert.throws(() => normalizeIllustrations(data, [sentence], 24), error =>
    error.message.includes('tipo string') && !error.message.includes('private-token-example'));
  data[0].motions[0].amount = 1.5;
  assert.equal(normalizeIllustrations(data, [sentence], 24)[0].motions[0].amount, 1.5);
});

test('author prompt declares required scale and rotation limits used by the validator', () => {
  const { illustrationPrompt } = require('../utils/narrative-illustration-plan');
  const prompt = illustrationPrompt();
  assert.match(prompt, /scale exige amount numérico entre \.05 e 3/);
  assert.match(prompt, /rotate exige amount numérico em graus entre -360 e 360/);
  assert.match(prompt, /rotation em radianos entre -6\.3 e 6\.3/);
});
