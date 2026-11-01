'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resumeDelegatedReview } = require('../utils/resume-delegated-review');

const entry = { jobId: 'job-123456', videoId: 'vid-123456', videoPath: '/video.mp4', qaManifestSha256: 'a'.repeat(64) };
const pending = { status: 'verified', visualReview: 'pending', masterPath: '/video.mp4', thumbnail: '/cover.png',
  portraitThumbnail: '/portrait.png', coverVariants: { requiredFormats: ['16:9', '9:16'] } };

test('automatic review recovery refreshes the ledger hash and verifies it before continuing', async () => {
  const updated = { ...entry, qaManifestSha256: 'b'.repeat(64) };
  const calls = [];
  const result = await resumeDelegatedReview({ entry, verified: pending,
    apply: async e => { calls.push(['apply', e.qaManifestSha256]); return { status: 'approved' }; },
    reloadEntry: async path => { calls.push(['reload', path]); return updated; },
    verifyEntry: async e => { calls.push(['verify', e.qaManifestSha256]); return { status: 'verified', visualReview: 'approved' }; }
  });
  assert.equal(result.status, 'approved');
  assert.equal(result.entry.qaManifestSha256, updated.qaManifestSha256);
  assert.deepEqual(calls, [['apply', entry.qaManifestSha256], ['reload', entry.videoPath], ['verify', updated.qaManifestSha256]]);
});

test('missing cover, rejected review or a changed job never authorizes publication', async () => {
  let calls = 0;
  const notReady = await resumeDelegatedReview({ entry, verified: { ...pending, portraitThumbnail: null },
    apply: async () => { calls++; } });
  assert.equal(notReady.status, 'not_ready');
  assert.equal(calls, 0);
  const held = await resumeDelegatedReview({ entry, verified: pending, apply: async () => ({ status: 'held', reason: 'review_rejected' }) });
  assert.equal(held.status, 'review_rejected');
  assert.equal(held.verified.visualReview, 'pending');
  await assert.rejects(resumeDelegatedReview({ entry, verified: pending,
    apply: async () => ({ status: 'approved' }), reloadEntry: async () => ({ ...entry, jobId: 'another-job' }) }), /identidade/);
  await assert.rejects(resumeDelegatedReview({ entry, verified: pending,
    apply: async () => ({ status: 'approved' }), reloadEntry: async () => entry,
    verifyEntry: async () => ({ status: 'invalid' }) }), /hash/);
});
