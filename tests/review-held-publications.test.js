'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  applyReviewDecision,
  checkpointTargetsVideo,
  findLatestReviewableEntry,
  hasPublicationAttempt,
  heldReviewIsDue,
  isVideoInsideProject
} = require('../scripts/review-held-publications');
const { assessSourceEvidence, createPublicationReview } = require('../utils/source-evidence');
const { isPublicationEligible } = require('../utils/publication-status');

test('held publication recovery never retries artifacts with a prior or uncertain upload attempt', () => {
  assert.equal(hasPublicationAttempt({}), false);
  assert.equal(hasPublicationAttempt({ results: { long: { youtube: { status: 'attempting' } } } }), true);
  assert.equal(hasPublicationAttempt({ results: { clips: { a: { instagram: { status: 'unknown' } } } } }), true);
  assert.equal(hasPublicationAttempt({ results: { long: { youtube: 'https://youtube.test/video' } } }), true);
});

test('held publication recovery only accepts MP4 files inside the managed video directory', () => {
  assert.equal(isVideoInsideProject('data/videos/clip.mp4'), true);
  assert.equal(isVideoInsideProject('/home/servidor/Git/youtube_ai/youtube-automation-agent/data/videos/clip.mp4'), true);
  assert.equal(isVideoInsideProject('/tmp/clip.mp4'), false);
  assert.equal(isVideoInsideProject('data/videos/../secret.mp4'), false);
  assert.equal(isVideoInsideProject('data/videos/clip.mov'), false);
});

test('held-review recovery skips a newer ledger entry whose master and clips are missing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'held-review-media-'));
  const mediaRoot = path.join(root, 'data', 'videos');
  try {
    await fs.mkdir(mediaRoot, { recursive: true });
    const older = {
      videoPath: 'data/videos/missing-master.mp4',
      publicationEligible: false,
      publicationReview: { status: 'unavailable' },
      sourceEvidence: { eligible: true, sourceUrl: 'https://example.test/older' },
      clips: [{ path: 'data/videos/available-clip.mp4' }]
    };
    const newer = {
      videoPath: 'data/videos/missing-newer.mp4',
      publicationEligible: false,
      publicationReview: { status: 'unavailable' },
      sourceEvidence: { eligible: true, sourceUrl: 'https://example.test/newer' },
      clips: []
    };
    await fs.writeFile(path.join(mediaRoot, 'available-clip.mp4'), 'clip');
    assert.equal(await findLatestReviewableEntry([older, newer], { root }), older,
      'a missing newest master must not starve an older job that still has a local clip');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('held-review retry state skips stale sources and defers transient provider failures', () => {
  const now = Date.parse('2026-10-20T20:00:00.000Z');
  assert.equal(heldReviewIsDue({ publicationReviewAttempt: { status: 'source_changed_since_generation' } }, now), false);
  assert.equal(heldReviewIsDue({ publicationReviewAttempt: { status: 'review_unavailable', nextAttemptAt: new Date(now + 60000).toISOString() } }, now), false);
  assert.equal(heldReviewIsDue({ publicationReviewAttempt: { status: 'review_unavailable', nextAttemptAt: new Date(now - 1).toISOString() } }, now), true);
});

test('held publication recovery only blocks generation of the same target video', () => {
  const root = '/workspace/project';
  assert.equal(checkpointTargetsVideo({ outPath: 'data/videos/active.mp4' }, 'data/videos/active.mp4', root), true);
  assert.equal(checkpointTargetsVideo({ outPath: '/workspace/project/data/videos/active.mp4' }, 'data/videos/active.mp4', root), true);
  assert.equal(checkpointTargetsVideo({ outPath: 'data/videos/other.mp4' }, 'data/videos/active.mp4', root), false);
  assert.equal(checkpointTargetsVideo(null, 'data/videos/active.mp4', root), false);
});

test('held publication recovery persists rejection and only approves a matching source hash', () => {
  const sourceTitle = 'Fonte verificável de demonstração';
  const sourceUrl = 'https://example.test/story';
  const sourceContext = Array(5).fill('O texto da fonte descreve os fatos confirmados e limita as conclusões apresentadas.').join(' ');
  const sourceEvidence = assessSourceEvidence({ sourceTitle, sourceUrl, context: sourceContext });
  const entry = { publicationHold: { reason: 'publication_review_unverified' }, publicationEligible: false };
  const rejected = applyReviewDecision(entry, sourceEvidence, createPublicationReview({
    verdict: 'reprovado', sourceContext, reviewer: 'reviewer'
  }));
  const approved = applyReviewDecision(entry, sourceEvidence, createPublicationReview({
    verdict: 'aprovado', sourceContext, reviewer: 'reviewer'
  }));

  assert.equal(rejected.publicationEligible, false);
  assert.equal(rejected.publicationReview.status, 'rejected');
  assert.equal(rejected.publicationHold.reason, 'source_claims_unverified');
  assert.equal(isPublicationEligible(approved), true);
});
