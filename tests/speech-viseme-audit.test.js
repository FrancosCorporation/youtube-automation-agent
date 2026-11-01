'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { SHAPES, parseArgs, summarizeTimeline } = require('../scripts/audit-speech-visemes');

test('summarizes seven Rhubarb shapes and transitions without exposing transcript', () => {
  const summary = summarizeTimeline({
    duration: 1.25,
    cues: [
      { start: 0, end: 0.2, value: 'X' },
      { start: 0.2, end: 0.4, value: 'A' },
      { start: 0.4, end: 0.6, value: 'B' },
      { start: 0.6, end: 0.8, value: 'C' },
      { start: 0.8, end: 0.9, value: 'D' },
      { start: 0.9, end: 1, value: 'E' },
      { start: 1, end: 1.15, value: 'F' },
      { start: 1.15, end: 1.25, value: 'X' }
    ]
  });
  assert.deepEqual(summary.coveredShapes, SHAPES);
  assert.deepEqual(summary.shapeCounts, { A: 1, B: 1, C: 1, D: 1, E: 1, F: 1, X: 2 });
  assert.equal(summary.transitions, 7);
  assert.equal(summary.cueCount, 8);
  assert.equal(summary.durationSeconds, 1.25);
  assert.equal(Object.hasOwn(summary, 'transcript'), false);
});

test('CLI arguments are bounded and support a requested excerpt', () => {
  assert.deepEqual(parseArgs(['voice.wav', '--start', '24', '--duration', '60']), {
    source: require('node:path').resolve('voice.wav'), startSeconds: 24, durationSeconds: 60
  });
  assert.throws(() => parseArgs(['voice.wav', '--duration', '301']), /between 1 and 300|1 e 300/);
  assert.throws(() => parseArgs(['--duration', '10']), /Uso:/);
});
