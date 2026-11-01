'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { narrativeLabelCueFrame } = require('../utils/narrative-word-cue');

test('o objeto entra quando sua expressão literal é narrada; repetições ficam sem cue ambíguo', () => {
  const sentence = { wordTimings: [{ text: 'A', startFrame: 1 }, { text: 'conta', startFrame: 4 },
    { text: 'de', startFrame: 8 }, { text: 'energia,', startFrame: 10 }, { text: 'caiu.', startFrame: 20 }] };
  assert.equal(narrativeLabelCueFrame('conta de energia', sentence), 4);
  assert.equal(narrativeLabelCueFrame('energia', sentence), 10);
  assert.equal(narrativeLabelCueFrame('conta de luz', sentence), null);
  assert.equal(narrativeLabelCueFrame('energia', { wordTimings: [...sentence.wordTimings, { text: 'energia', startFrame: 30 }] }), null);
});
