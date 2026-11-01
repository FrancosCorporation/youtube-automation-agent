const assert = require('node:assert/strict');
const test = require('node:test');
const { createPublicationResult, longUploadsSucceeded } = require('../utils/publication-status');

function withEnvironment(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function confirmedX(videoPath = '/fixture/full-video.mp4') {
  return createPublicationResult({
    platform: 'x',
    videoPath,
    status: 'confirmed',
    account: '@pulso',
    evidence: { kind: 'success_message', observed: 'Vídeo publicado com sucesso' }
  });
}

test('full X upload is required for cleanup only when enabled and not explicitly disabled', () => {
  withEnvironment({ TELEGRAM_CHANNEL: undefined, X_POST_FULL_VIDEO: undefined }, () => {
    const entry = { videoPath: '/fixture/full-video.mp4', ytUrl: 'https://youtube.com/watch?v=fixture' };
    const youtubeOnly = { long: { youtube: entry.ytUrl } };

    assert.equal(longUploadsSucceeded(entry, youtubeOnly, { disabledPlatforms: '' }), true,
      'default configuration must not require a full X post');

    process.env.X_POST_FULL_VIDEO = 'true';
    assert.equal(longUploadsSucceeded(entry, youtubeOnly, { disabledPlatforms: '' }), false,
      'enabled full X requires verifiable publication evidence before cleanup');
    assert.equal(longUploadsSucceeded(entry, { ...youtubeOnly, long: { ...youtubeOnly.long, x: { status: 'submitted' } } }, { disabledPlatforms: '' }), false,
      'submitted without confirmation is not cleanup evidence');
    assert.equal(longUploadsSucceeded(entry, { ...youtubeOnly, long: { ...youtubeOnly.long, x: confirmedX() } }, { disabledPlatforms: '' }), true,
      'confirmed X publication permits cleanup');
    assert.equal(longUploadsSucceeded(entry, { ...youtubeOnly, long: { ...youtubeOnly.long, x: confirmedX('/fixture/other-video.mp4') } }, { disabledPlatforms: '' }), false,
      'X confirmation for a different master does not permit cleanup');
    assert.equal(longUploadsSucceeded(entry, { ...youtubeOnly, long: { ...youtubeOnly.long, x: { ...confirmedX(), platform: 'instagram' } } }, { disabledPlatforms: '' }), false,
      'X destination requires X confirmation evidence');
    assert.equal(longUploadsSucceeded(entry, youtubeOnly, { disabledPlatforms: 'x' }), true,
      'an explicitly disabled X destination does not block cleanup');
  });
});
