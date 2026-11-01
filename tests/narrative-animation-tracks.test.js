'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAnimationTracks, evaluateAnimationTrack, animationState } = require('../utils/narrative-animation-tracks');
const { normalizeIllustrations } = require('../utils/narrative-illustration-plan');
const sentences = [
  { id: 's1', text: 'A roda gira e leva a fruta.', startFrame: 0, endFrame: 100, wordTimings: [{ text: 'gira', startFrame: 20 }] },
  { id: 's2', text: 'A fruta cai na caixa.', startFrame: 100, endFrame: 200, wordTimings: [{ text: 'cai', startFrame: 140 }] },
];
const nodes = [{ id: 'wheel', meshes: [{}, {}] }];
const raw = () => [{ targetId: 'wheel', property: 'rotation3d', keyframes: [
  { cueSentenceId: 's1', boundary: 'word', cueText: 'gira', value: [0, 0, 0] },
  { cueSentenceId: 's2', boundary: 'end', value: [0, 0, 36] },
] }];
test('continuous rotation crosses captions and gives the same pose after backward seeks', () => {
  const [track] = normalizeAnimationTracks(raw(), nodes, sentences, 20);
  assert.deepEqual(evaluateAnimationTrack(track, 100), [0, 0, 16]);
  assert.deepEqual(evaluateAnimationTrack(track, 101), [0, 0, 16.2]);
  const before = evaluateAnimationTrack(track, 80);
  evaluateAnimationTrack(track, 190);
  evaluateAnimationTrack(track, 2);
  assert.deepEqual(evaluateAnimationTrack(track, 80), before);
  assert.deepEqual(evaluateAnimationTrack(track, 300), [0, 0, 36]);
});
test('translation and per-piece articulation remain independent of the parent rotation', () => {
  const data = raw();
  data.push({ ...globalThis.structuredClone(data[0]), property: 'position3d', meshIndex: 1 });
  data[1].keyframes[1].value = [0, 0, 2];
  const tracks = normalizeAnimationTracks(data, nodes, sentences, 20);
  assert.deepEqual(animationState(tracks, 'wheel', 110), { rotation3d: [0, 0, 18] });
  assert.deepEqual(animationState(tracks, 'wheel', 110, 1), { position3d: [0, 0, 1] });
  assert.deepEqual(animationState(tracks, 'wheel', 110, 0), {});
});
test('re-normalization binds to changed spoken cues instead of using stale cached frame numbers', () => {
  const tracks = normalizeAnimationTracks(raw(), nodes, sentences, 20);
  const changed = globalThis.structuredClone(sentences);
  changed[0].wordTimings[0].startFrame = 40;
  assert.equal(normalizeAnimationTracks(tracks, nodes, changed, 20)[0].keyframes[0].frame, 40);
});
test('unknown targets, duplicate properties, reversed time and non-finite geometry are rejected', () => {
  for (const modify of [
    t => { t[0].targetId = 'missing'; }, t => { t[0].meshIndex = 2; },
    t => { t.push(globalThis.structuredClone(t[0])); }, t => { t[0].keyframes.reverse(); },
    t => { t[0].keyframes[1].value = [NaN, 0, 0]; },
    t => { t[0].keyframes[0].cueText = 'não narrado'; },
    t => { t[0].property = 'target3d'; },
  ]) { const data = raw(); modify(data); assert.throws(() => normalizeAnimationTracks(data, nodes, sentences, 20), /illustration:/); }
});
test('an impact accelerates, bounces and settles at a stable endpoint', () => {
  const track = { keyframes: [
    { frame: 0, value: [0, 2, 0] }, { frame: 20, value: [0, 0, 0], easing: 'ease-in' },
    { frame: 25, value: [0, .3, 0], easing: 'ease-out' }, { frame: 32, value: [0, 0, 0], easing: 'ease-in' },
  ] };
  assert.ok(evaluateAnimationTrack(track, 10)[1] > 1);
  assert.equal(evaluateAnimationTrack(track, 20)[1], 0);
  assert.equal(evaluateAnimationTrack(track, 25)[1], .3);
  assert.deepEqual(evaluateAnimationTrack(track, 300), [0, 0, 0]);
});
test('persistent 3D objects can cite an earlier sentence and keep identical tracks at a cut', () => {
  const layout = { landscape: { x: .5, y: .5 }, portrait: { x: .5, y: .5 } };
  const drawings = sentences.map(s => ({ cueSentenceId: s.id, dimension: '3d', explanation: 'A roda gira continuamente e a fruta chega à caixa.',
    nodes: [
      { id: 'wheel', evidence: 'roda', evidenceSentenceId: 's1', layout, meshes: [{ type: 'cylinder', color: '#95d7bc' }] },
      { id: 'fruit', evidence: 'fruta', evidenceSentenceId: 's1', layout, meshes: [{ type: 'sphere', color: '#ecb47e' }] },
    ], tracks: raw() }));
  const normalized = normalizeIllustrations(drawings, sentences, 20);
  assert.deepEqual(normalized[0].tracks, normalized[1].tracks);
  assert.deepEqual(normalizeIllustrations(normalized, sentences, 20), normalized);
  assert.equal(animationState(normalized[1].tracks, 'wheel', 120).rotation3d[2], 20);
});
