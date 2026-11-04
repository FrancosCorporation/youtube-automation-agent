'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertGenerationFinalization, requiredSocialPlatforms } = require('../utils/generation-finalization');
const { isRetryableGenerationFailure, shouldDeferGenerationAttempt } = require('../utils/generation-retry');

const part = (index, count = 2) => ({ path: `part-${index}.mp4`, kind: 'social-narrative-part',
  platforms: ['instagram', 'tiktok', 'shorts', 'kwai', 'x'], partIndex: index, partCount: count, durationSeconds: 100 });
const complete = () => ({ thumbnailPath: 'cover.png', portraitThumbnailPath: 'portrait.png', clips: [part(1), part(2)] });

test('cover/clip failures remain retryable in the same job, and repeated failures release the producer', () => {
  for (const [changes, code] of [
    [{ thumbnailPath: '' }, 'GENERATION_COVERS_PENDING'],
    [{ portraitThumbnailPath: '' }, 'GENERATION_COVERS_PENDING'],
    [{ clips: [] }, 'GENERATION_SOCIAL_PARTS_PENDING'],
    [{ clips: [part(1)] }, 'GENERATION_SOCIAL_PARTS_PENDING'],
    [{ clips: [part(1), part(1)] }, 'GENERATION_SOCIAL_PARTS_PENDING'],
    [{ clips: [{ ...part(1, 1), durationSeconds: 60 }] }, 'GENERATION_SOCIAL_PARTS_PENDING']
  ]) {
    assert.throws(() => assertGenerationFinalization({ ...complete(), ...changes }), { code });
    assert.equal(isRetryableGenerationFailure(code.toLowerCase()), true);
    assert.equal(shouldDeferGenerationAttempt(code.toLowerCase(), 3), true);
  }
  assert.doesNotThrow(() => assertGenerationFinalization(complete()));
});

test('only disabled destinations are excluded, not temporarily logged out destinations', () => {
  assert.deepEqual(requiredSocialPlatforms({ SOCIALS_DISABLED: ' X,telegram,kwai ' }), ['instagram', 'tiktok', 'shorts']);
  assert.doesNotThrow(() => assertGenerationFinalization({ ...complete(), platforms: ['instagram'],
    clips: [{ ...part(1, 1), platforms: ['instagram'] }] }));
  assert.throws(() => assertGenerationFinalization({ ...complete(), clips: [{ ...part(1, 1), platforms: ['instagram'] }] }),
    { code: 'GENERATION_SOCIAL_PARTS_PENDING' });
});
