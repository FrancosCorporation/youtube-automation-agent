'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { assertNarrativeEpisodeProps, validateNarrativeEpisodeProps } = require('../utils/narrative-episode-props');

function props(overrides = {}) {
  return {
    episode: {
      fps: 24, durationInFrames: 120, durationMs: 5000,
      scenes: [{ id: 'scene-1' }], sentences: [{ id: 'sentence-1' }]
    },
    audioSrc: '_runtime/job-12345678/episode-audio.m4a',
    robotSrc: 'pulso-story/approved-robot-rigged.glb',
    aspect: 'landscape', width: 1920, height: 1080, fps: 24, durationInFrames: 120,
    accents: ['#22D3EE', '#67E8F9'], lipSyncEnvelope: Array(500).fill(0.2),
    lipSyncStepMs: 10, gestureCues: {}, ...overrides
  };
}

test('narrative props must match plan duration, audio, aspect, and approved assets', () => {
  assert.deepEqual(validateNarrativeEpisodeProps(props()), { valid: true, errors: [] });
  for (const invalid of [
    props({ width: 1080 }),
    props({ fps: 30 }),
    props({ durationInFrames: 121 }),
    props({ audioSrc: 'https://example.test/audio.m4a' }),
    props({ robotSrc: 'other/robot.glb' }),
    props({ accents: ['not-a-color'] }),
    props({ lipSyncEnvelope: [0, NaN] }),
    props({ lipSyncStepMs: 0 })
  ]) assert.equal(validateNarrativeEpisodeProps(invalid).valid, false);
});

test('preview composition defaults remain explicit and valid without a production episode', () => {
  assert.deepEqual(validateNarrativeEpisodeProps(props({ episode: null }), { allowPreview: true }), {
    valid: true, preview: true, errors: []
  });
  assert.throws(() => assertNarrativeEpisodeProps(props({ episode: null })), {
    code: 'NARRATIVE_EPISODE_PROPS_INVALID'
  });
});
