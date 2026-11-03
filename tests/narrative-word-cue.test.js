'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { narrativeLabelCueFrame, narrativeWordCues } = require('../utils/narrative-word-cue');
const { normalizeAnimationTracks } = require('../utils/narrative-animation-tracks');

test('o objeto entra quando sua expressão literal é narrada; repetições ficam sem cue ambíguo', () => {
  const sentence = { wordTimings: [{ text: 'A', startFrame: 1 }, { text: 'conta', startFrame: 4 },
    { text: 'de', startFrame: 8 }, { text: 'energia,', startFrame: 10 }, { text: 'caiu.', startFrame: 20 }] };
  assert.equal(narrativeLabelCueFrame('conta de energia', sentence), 4);
  assert.equal(narrativeLabelCueFrame('energia', sentence), 10);
  assert.equal(narrativeLabelCueFrame('conta de luz', sentence), null);
  assert.equal(narrativeLabelCueFrame('energia', { wordTimings: [...sentence.wordTimings, { text: 'energia', startFrame: 30 }] }), null);
});

test('writer cues preserve the measured occurrence of repeated words in a long sentence', () => {
  const sentence = { id: 's1', text: 'O sinal e o retorno e o resultado', startFrame: 100, endFrame: 900,
    wordTimings: [{ text: 'O', startFrame: 100 }, { text: 'sinal', startFrame: 140 },
      { text: 'e', startFrame: 180 }, { text: 'o', startFrame: 240 }, { text: 'retorno', startFrame: 460 },
      { text: 'e', startFrame: 600 }, { text: 'o', startFrame: 720 }, { text: 'resultado', startFrame: 800 }] };
  const cues = narrativeWordCues(sentence, 24);
  assert.equal(cues.length, 8);
  const [track] = normalizeAnimationTracks([{ targetId: 'camera', property: 'position3d',
    keyframes: cues.map((cue, i) => ({ ...cue.keyframeCue, value: [i / 10, 0, 0] })) }], [], [sentence], 24);
  assert.deepEqual(track.keyframes.map(key => key.frame), sentence.wordTimings.map(word => word.startFrame));
  assert.equal(cues[6].keyframeCue.boundary, 'end');
});
