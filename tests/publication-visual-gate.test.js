'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertPublicationVisualGate,
  publicationVisualGate
} = require('../utils/publication-visual-gate');

test('publication requires a verified manifest and an explicit visual approval', () => {
  assert.deepEqual(publicationVisualGate({ status: 'verified', visualReview: 'approved' }), {
    allowed: true,
    reason: null
  });
  for (const qa of [
    { status: 'verified', visualReview: 'pending' },
    { status: 'verified', visualReview: 'rejected' },
    { status: 'verified' },
    { status: 'legacy', visualReview: 'unrecorded' },
    { status: 'mismatch', visualReview: 'approved' },
    null
  ]) {
    assert.equal(publicationVisualGate(qa).allowed, false);
  }
});

test('blocked visual review has a stable publication error code', () => {
  assert.throws(
    () => assertPublicationVisualGate({ status: 'verified', visualReview: 'pending' }),
    error => error.code === 'PUBLICATION_VISUAL_REVIEW_REQUIRED'
      && error.message === 'visual_review_not_approved'
  );
  const approved = { status: 'verified', visualReview: 'approved' };
  assert.equal(assertPublicationVisualGate(approved), approved);
});

test('an explicit visual review scope only permits the hash-bound artifact', () => {
  const scoped = {
    status: 'verified',
    visualReview: 'approved',
    visualReviewAssets: [{ path: '/media/master.mp4', sha256: 'a'.repeat(64) }],
    visualReviewScopeInvalid: false
  };
  assert.equal(publicationVisualGate(scoped, '/media/master.mp4').allowed, true);
  assert.deepEqual(publicationVisualGate(scoped, '/media/short.mp4'), {
    allowed: false,
    reason: 'visual_asset_not_approved'
  });
  assert.deepEqual(publicationVisualGate({ ...scoped, visualReviewAssets: [] }), {
    allowed: false,
    reason: 'visual_review_has_no_approved_assets'
  });
  assert.deepEqual(publicationVisualGate({ ...scoped, visualReviewScopeInvalid: true }, '/media/master.mp4'), {
    allowed: false,
    reason: 'visual_review_scope_invalid'
  });
});

test('an approved status without a hash-bound asset scope cannot publish a file', () => {
  const qa = { status: 'verified', visualReview: 'approved' };
  assert.deepEqual(publicationVisualGate(qa, '/media/master.mp4'), {
    allowed: false,
    reason: 'visual_review_scope_missing'
  });
});

test('publishing a master requires its hash-bound thumbnail to be included in visual review', () => {
  const masterPath = '/media/master.mp4';
  const thumbnailPath = '/media/thumb.png';
  const qa = {
    status: 'verified',
    visualReview: 'approved',
    visualReviewScopeInvalid: false,
    masterPath,
    thumbnail: { path: thumbnailPath, sha256: 'b'.repeat(64) },
    visualReviewAssets: [
      { path: masterPath, sha256: 'a'.repeat(64) },
      { path: thumbnailPath, sha256: 'b'.repeat(64) }
    ]
  };

  assert.deepEqual(publicationVisualGate(qa, masterPath), { allowed: true, reason: null });
  assert.deepEqual(publicationVisualGate({ ...qa, visualReviewAssets: [qa.visualReviewAssets[0]] }, masterPath), {
    allowed: false,
    reason: 'thumbnail_not_approved'
  });
  assert.deepEqual(publicationVisualGate(qa, masterPath, { thumbnailPath: '/media/other.png' }), {
    allowed: false,
    reason: 'thumbnail_path_mismatch'
  });
  assert.deepEqual(publicationVisualGate({ ...qa, thumbnail: null }, masterPath), {
    allowed: false,
    reason: 'thumbnail_not_hash_bound'
  });
});
