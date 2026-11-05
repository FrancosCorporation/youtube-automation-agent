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
test('authorship joins duplicate fragments only at exactly shared cues and preserves every pose', () => {
  const base = raw()[0];
  const middle = { cueSentenceId: 's2', boundary: 'start', value: [0, 0, 12] };
  const first = { ...base, keyframes: [base.keyframes[0], middle] };
  const second = { ...base, keyframes: [middle, base.keyframes[1]] };
  const input = [second, first, globalThis.structuredClone(second)];
  const snapshot = globalThis.structuredClone(input);
  const [expected] = normalizeAnimationTracks([{ ...base, keyframes: [base.keyframes[0], middle, base.keyframes[1]] }], nodes, sentences, 20);
  const [actual] = normalizeAnimationTracks(input, nodes, sentences, 20, { orderByTime: true });
  assert.deepEqual(input, snapshot);
  assert.deepEqual(actual, expected);
  for (const frame of [...Array(205).keys(), 70, 199, 0]) {
    assert.deepEqual(evaluateAnimationTrack(actual, frame), evaluateAnimationTrack(expected, frame));
  }
  assert.throws(() => normalizeAnimationTracks(input, nodes, sentences, 20), /trilhas concorrentes/);
  const conflict = globalThis.structuredClone(second);
  conflict.keyframes[0].value = [0, 0, 13];
  assert.throws(() => normalizeAnimationTracks([first, conflict], nodes, sentences, 20, { orderByTime: true }), /trilhas concorrentes/);
  const branch = globalThis.structuredClone(second);
  branch.keyframes[1].value = [0, 0, 15];
  assert.throws(() => normalizeAnimationTracks([first, second, branch], nodes, sentences, 20, { orderByTime: true }), /trilhas concorrentes/);
});
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
test('authorship can order explicit measured cues without retiming or changing their values', () => {
  const [expected] = normalizeAnimationTracks(raw(), nodes, sentences, 20);
  const data = raw();data[0].keyframes.reverse();
  const snapshot = globalThis.structuredClone(data);
  assert.throws(() => normalizeAnimationTracks(data, nodes, sentences, 20), /tempos estritamente crescentes/);
  const [ordered] = normalizeAnimationTracks(data, nodes, sentences, 20, { orderByTime: true });
  assert.deepEqual(data, snapshot);
  assert.deepEqual(ordered, expected);
  for (const frame of [0, 20, 75, 150, 200, 110, 0]) assert.deepEqual(evaluateAnimationTrack(ordered, frame), evaluateAnimationTrack(expected, frame));
  data[0].keyframes.push({ ...data[0].keyframes[0], value: [1, 2, 3] });
  assert.throws(() => normalizeAnimationTracks(data, nodes, sentences, 20, { orderByTime: true }), /tempos estritamente crescentes/);
});

test('a redundant clamped end hold preserves every pose and backward seek; conflicts remain rejected', () => {
  const [reference] = normalizeAnimationTracks(raw(), nodes, sentences, 20);
  const data = raw();
  data[0].keyframes.push({ ...data[0].keyframes[1], offsetSeconds: 3 });
  const [normalized] = normalizeAnimationTracks(data, nodes, sentences, 20);
  assert.equal(normalized.keyframes.length, 2);
  for (const frame of [...Array(202).keys(), 180, 10, 150, 0]) {
    assert.deepEqual(evaluateAnimationTrack(normalized, frame), evaluateAnimationTrack(reference, frame));
  }
  data[0].keyframes[2].value = [0, 0, 35];
  assert.throws(() => normalizeAnimationTracks(data, nodes, sentences, 20), /tempos estritamente crescentes/);
  data[0].keyframes[2].value = [0, 0, 36];
  data[0].keyframes[2].easing = 'ease-out';
  assert.throws(() => normalizeAnimationTracks(data, nodes, sentences, 20), /tempos estritamente crescentes/);
});
test('authorship repairs word elapsed time copied into offsets only when measured cues prove it', () => {
  const spoken = [{ id: 's1', text: 'Vagas em oito estados', startFrame: 0, endFrame: 92,
    wordTimings: [{ text: 'oito', startFrame: 58 }, { text: 'estados', startFrame: 65 }] }];
  const data = [{ targetId: 'wheel', property: 'opacity', keyframes: [
    { cueSentenceId: 's1', boundary: 'word', cueText: 'oito', offsetSeconds: 2.4, value: 0 },
    { cueSentenceId: 's1', boundary: 'word', cueText: 'estados', offsetSeconds: 2.7, value: 1 }
  ] }];
  assert.throws(() => normalizeAnimationTracks(data, nodes, spoken, 24), /tempos estritamente crescentes/);
  const [fixed] = normalizeAnimationTracks(data, nodes, spoken, 24, { orderByTime: true });
  assert.deepEqual(fixed.keyframes.map(key => [key.frame, key.offsetSeconds]), [[58, 0], [65, 0]]);
  assert.deepEqual(normalizeAnimationTracks([fixed], nodes, spoken, 24), [fixed]);
  const roundedRealDraft = globalThis.structuredClone(data);
  roundedRealDraft[0].keyframes[0].offsetSeconds = 2.625;
  roundedRealDraft[0].keyframes[1].offsetSeconds = 2.625;
  const [recovered] = normalizeAnimationTracks(roundedRealDraft, nodes, spoken, 24, { orderByTime: true });
  assert.deepEqual(recovered.keyframes.map(key => [key.frame, key.offsetSeconds]), [[58, 0], [65, 0]]);
  for (const frame of [0, 58, 61, 65, 92, 61, 0]) {
    assert.equal(evaluateAnimationTrack(recovered, frame), evaluateAnimationTrack(fixed, frame));
  }
  const ambiguous = globalThis.structuredClone(data);
  ambiguous[0].keyframes[0].offsetSeconds = 1.9;
  assert.throws(() => normalizeAnimationTracks(ambiguous, nodes, spoken, 24, { orderByTime: true }), /tempos estritamente crescentes/);
  const noTiming = [{ ...spoken[0], wordTimings: [] }];
  const [untimed] = normalizeAnimationTracks(data, nodes, noTiming, 24, { orderByTime: true });
  assert.deepEqual(untimed.keyframes.map(key => key.offsetSeconds), [2.4, 2.7]);
});
test('a multi-key camera draft recovers copied word times while keeping the start and end holds', () => {
  const spoken = [{ id: 's1', text: 'No Nordeste há vagas em Olinda e em São Luís Maranhão.', startFrame: 754, endFrame: 944,
    wordTimings: [{ text: 'Nordeste', startFrame: 757 }, { text: 'são', startFrame: 785 }, { text: 'Olinda', startFrame: 832 },
      { text: 'São', startFrame: 906 }, { text: 'Luís', startFrame: 912 }, { text: 'Maranhão', startFrame: 930 }] }];
  const keys = spoken[0].wordTimings.filter(w => w.text !== 'são').map((word, i) => ({ cueSentenceId: 's1', boundary: 'word', cueText: word.text,
    offsetSeconds: (word.startFrame - 754) / 24, value: [i, 0, 0] }));
  const data = [{ targetId: 'camera', property: 'position3d', keyframes: [
    { cueSentenceId: 's1', boundary: 'start', value: [0, 0, 0] }, ...keys,
    { cueSentenceId: 's1', boundary: 'end', value: [0, 0, 0] }
  ] }];
  assert.throws(() => normalizeAnimationTracks(data, [], spoken, 24), /tempos estritamente crescentes/);
  const fixed = normalizeAnimationTracks(data, [], spoken, 24, { orderByTime: true });
  assert.deepEqual(fixed[0].keyframes.map(key => key.frame), [754, 757, 832, 906, 912, 930, 944]);
  assert.deepEqual(normalizeAnimationTracks(fixed, [], spoken, 24), fixed);
  data[0].keyframes[2].offsetSeconds = 2;
  assert.throws(() => normalizeAnimationTracks(data, [], spoken, 24, { orderByTime: true }), /tempos estritamente crescentes/);
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
test('opacity repair identifies the exact property and scalar type without relaxing validation', () => {
  const data = raw();
  data[0].property = 'opacity';
  data[0].keyframes[0].value = [0.1, 0, 0];
  assert.throws(() => normalizeAnimationTracks(data, nodes, sentences, 20), /wheel\.opacity; value deve ser um número, nunca vetor entre 0 e 1/);
  data[0].keyframes[0].value = 0;
  data[0].keyframes[1].value = 1;
  const [track] = normalizeAnimationTracks(data, nodes, sentences, 20);
  assert.equal(evaluateAnimationTrack(track, 20), 0);
  assert.equal(evaluateAnimationTrack(track, 200), 1);
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
