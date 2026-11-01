'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  classifyFile, nextActionFor, outsideLedgerDisposition, sha256File, isConclusiveBaselineDeletion,
  isPublicationQaReady, baselineCaptureTimestamp, indexBaselineDeletions
} = require('../scripts/report-disk-backlog');

test('backlog report carries the baseline capture timestamp when scannedAt is absent', () => {
  assert.equal(baselineCaptureTimestamp({ capturedAt: '2026-10-21T14:53:47.721Z' }), '2026-10-21T14:53:47.721Z');
  assert.equal(baselineCaptureTimestamp({ scannedAt: '2026-10-21T15:00:00.000Z', capturedAt: '2026-10-21T14:53:47.721Z' }), '2026-10-21T15:00:00.000Z');
  assert.equal(baselineCaptureTimestamp({ capturedAt: 'invalid' }), null);
});

test('report source metadata keeps publisher URLs separate from aggregator origins', () => {
  const { compactOwnerMetadata } = require('../scripts/report-disk-backlog');
  const metadata = compactOwnerMetadata({
    jobId: 'job-1', sourceName: 'Publisher', originTitle: 'Published headline',
    sourceUrl: 'https://publisher.test/article',
    originUrl: 'https://news.google.com/rss/articles/id'
  });
  assert.equal(metadata.sourceName, 'Publisher');
  assert.equal(metadata.originTitle, 'Published headline');
  assert.equal(metadata.sourceUrl, 'https://publisher.test/article');
  assert.equal(metadata.originUrl, 'https://news.google.com/rss/articles/id');
});

test('backlog classifier preserves uncertain states and distinguishes outputs from app evidence', () => {
  assert.equal(classifyFile({ classification: 'queued', ledger: [] }, 'data/videos/a.mp4'), 'active_queue_protected');
  assert.equal(classifyFile({ classification: 'untracked', ledger: [] }, 'data/videos/a.mp4'), 'orphan_requires_provenance');
  assert.equal(outsideLedgerDisposition('experiments/hyperframes-pulso-pilot/renders/preview.mp4'), 'evaluation_render_discard_candidate');
  assert.equal(outsideLedgerDisposition('experiments/hyperframes-pulso-pilot/renders/pulso-ia-piloto-robot-aprovado-16x9-2026-10-21.mp4'), 'mascot_pilot_review_pending');
  assert.equal(outsideLedgerDisposition('experiments/hyperframes-pulso-pilot/renders/pulso-ia-robo-referencia-aprovada-20261022.mp4'), 'mascot_pilot_review_pending');
  assert.equal(outsideLedgerDisposition('docs/evidencias/run/social-pacing-proof.mp4'), 'qa_evidence_preserve');
  assert.equal(outsideLedgerDisposition('../remotion-pilot/out/pulso_news.mp4'), 'legacy_remotion_render_requires_review');
  assert.match(nextActionFor('reconcile_before_retry_or_delete'), /não reenviar nem excluir enquanto incerto/);
  assert.match(nextActionFor('qa_rejected_destination_reconciliation_required'), /não excluir enquanto houver resultado ausente ou incerto/);

  const owner = { publicationEligible: true, requiredDestinations: ['instagram', 'shorts'], destinations: { instagram: 'confirmed', shorts: 'unknown' } };
  assert.equal(classifyFile({ classification: 'ledger-linked', ledger: [owner] }, 'data/videos/a.mp4'), 'reconcile_before_retry_or_delete');
  assert.equal(classifyFile({ classification: 'ledger-linked', ledger: [{
    publicationEligible: false, requiredDestinations: [], destinations: { kwai: 'unknown' }
  }] }, 'data/videos/legacy.mp4'), 'reconcile_before_retry_or_delete');
  assert.equal(classifyFile({ classification: 'ledger-linked', ledger: [{
    ...owner, destinations: { instagram: 'confirmed', shorts: 'confirmed' }, destinationProofs: {
      instagram: { artifactSha256: 'a'.repeat(64) }, shorts: { artifactSha256: 'a'.repeat(64) }
    }
  }] }, 'data/videos/a.mp4', [{ ownerIndex: 0, publicationReady: true }]), 'reconcile_before_retry_or_delete');
  assert.equal(classifyFile({ classification: 'ledger-linked', currentSha256: 'a'.repeat(64), ledger: [{
    ...owner, destinations: { instagram: 'confirmed', shorts: 'confirmed' }, destinationProofs: {
      instagram: { artifactSha256: 'a'.repeat(64) }, shorts: { artifactSha256: 'a'.repeat(64) }
    }
  }] }, 'data/videos/a.mp4', [{ ownerIndex: 0, publicationReady: true }]), 'all_destinations_confirmed_cleanup_ready');
  assert.equal(classifyFile({ classification: 'ledger-linked', ledger: [{
    ...owner, publicationEligible: false, publicationReviewStatus: 'rejected',
    destinations: { instagram: 'failed', shorts: 'failed' }, destinationProofs: {
      instagram: { evidenceKind: 'confirmed_no_send' }, shorts: { evidenceKind: 'confirmed_no_send' }
    }
  }] }, 'data/videos/a.mp4'), 'qa_unapproved_delete_before_recreate');
  assert.equal(classifyFile({ classification: 'ledger-linked', ledger: [{
    publicationEligible: false, publicationReviewStatus: 'rejected',
    requiredDestinations: ['youtube'], destinations: {}
  }] }, 'data/videos/rejected-no-results.mp4'), 'qa_rejected_destination_reconciliation_required');
  assert.equal(classifyFile({ classification: 'ledger-linked', ledger: [{
    publicationEligible: false, publicationReviewStatus: 'rejected',
    requiredDestinations: ['youtube', 'x'], destinations: { youtube: 'quota_skipped_legacy' }
  }] }, 'data/videos/rejected-partial-results.mp4'), 'qa_rejected_destination_reconciliation_required');
  assert.equal(classifyFile({ classification: 'ledger-linked', currentSha256: 'a'.repeat(64), ledger: [{
    publicationEligible: false, publicationReviewStatus: 'rejected', requiredDestinations: ['youtube'],
    destinations: { youtube: 'quota_skipped_legacy', x: 'disabled_or_not_targeted_legacy' }
  }] }, 'data/videos/rejected-proven-no-send.mp4'), 'qa_unapproved_delete_before_recreate');
  assert.equal(classifyFile({ classification: 'ledger-linked', ledger: [{
    publicationEligible: false, publicationReviewStatus: 'rejected',
    requiredDestinations: [], destinations: { instagram: 'legacy_or_unstructured' }
  }] }, 'data/videos/rejected-legacy-result.mp4'), 'qa_rejected_destination_reconciliation_required');
  assert.equal(classifyFile({ classification: 'ledger-linked', ledger: [
    { publicationEligible: false, publicationReviewStatus: 'rejected', requiredDestinations: [], destinations: {} },
    { publicationEligible: true, requiredDestinations: ['instagram'], destinations: { instagram: 'not_attempted' } }
  ] }, 'data/videos/shared.mp4'), 'shared_unapproved_with_legacy_owner_requires_disposition');
  assert.equal(classifyFile({ classification: 'ledger-linked', ledger: [{
    publicationEligible: true, requiredDestinations: ['instagram'], destinations: { instagram: 'not_attempted' }
  }] }, 'data/videos/old.mp4'), 'qa_recovery_required');
  assert.equal(classifyFile({ classification: 'ledger-linked', ledger: [{
    publicationEligible: true, requiredDestinations: ['instagram'], destinations: { instagram: 'not_attempted' }
  }] }, 'data/videos/no-qa.mp4', [{ ownerIndex: 0, publicationReady: false }]), 'qa_recovery_required');
});

test('backlog hash streams a regular media file to its SHA-256 fingerprint', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-backlog-hash-'));
  const file = path.join(root, 'media.mp4');
  const contents = 'known media bytes';
  try {
    await fs.writeFile(file, contents);
    assert.equal(await sha256File(file), crypto.createHash('sha256').update(contents).digest('hex'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('baseline retirement requires a post-capture SHA and byte-size match, comparing the baseline hash when available', () => {
  const baselineTime = Date.parse('2026-10-21T14:53:47.721Z');
  const sha256 = 'a'.repeat(64);
  const deletion = { completedAt: '2026-10-21T15:25:15.925Z', sha256, sizeBytes: 1234 };
  assert.equal(isConclusiveBaselineDeletion(deletion, {
    baselineTime, baselineSize: 1234, baselineSha: sha256
  }), true);
  assert.equal(isConclusiveBaselineDeletion(deletion, {
    baselineTime, baselineSize: 1234, baselineSha: null
  }), true);
  assert.equal(isConclusiveBaselineDeletion({ ...deletion, completedAt: '2026-10-21T14:00:00Z' }, {
    baselineTime, baselineSize: 1234, baselineSha: sha256
  }), false);
  assert.equal(isConclusiveBaselineDeletion({ ...deletion, sha256: 'b'.repeat(64) }, {
    baselineTime, baselineSize: 1234, baselineSha: sha256
  }), false);
  assert.equal(isConclusiveBaselineDeletion({ ...deletion, sizeBytes: 1235 }, {
    baselineTime, baselineSize: 1234, baselineSha: sha256
  }), false);
  assert.equal(isConclusiveBaselineDeletion(deletion, { baselineSize: 1234, baselineSha: sha256 }), false);
});

test('baseline deletion lookup resolves project and workspace paths without ambiguous matches', () => {
  const root = '/workspace/youtube-automation-agent';
  const workspace = '/workspace';
  const remotionPath = '/workspace/remotion-pilot/out/pulso_news.mp4';
  const projectPath = '/workspace/youtube-automation-agent/data/videos/retired.mp4';
  const ambiguousProjectPath = '/workspace/youtube-automation-agent/shared/output.mp4';
  const ambiguousWorkspacePath = '/workspace/shared/output.mp4';
  const baselinePaths = new Set([remotionPath, projectPath, ambiguousProjectPath, ambiguousWorkspacePath]);
  const remotionDeletion = {
    path: 'remotion-pilot/out/pulso_news.mp4',
    completedAt: '2026-10-21T15:38:40.853Z',
    sha256: 'd4ee77655dec8f77af9dc1b1f73a128fd8d8e0f98436af80f58f61d35d9dcc08',
    sizeBytes: 10516245
  };
  const projectDeletion = { path: 'data/videos/retired.mp4', sizeBytes: 20, sha256: 'a'.repeat(64) };
  const ambiguousDeletion = { path: 'shared/output.mp4', sizeBytes: 30, sha256: 'b'.repeat(64) };
  const indexed = indexBaselineDeletions([remotionDeletion, projectDeletion, ambiguousDeletion], baselinePaths, { root, workspace });

  assert.deepEqual(indexed.get(remotionPath), [remotionDeletion]);
  assert.deepEqual(indexed.get(projectPath), [projectDeletion]);
  assert.equal(indexed.has(ambiguousProjectPath), false);
  assert.equal(indexed.has(ambiguousWorkspacePath), false);
  assert.equal(isConclusiveBaselineDeletion(remotionDeletion, {
    baselineTime: Date.parse('2026-10-21T14:53:47.721Z'),
    baselineSize: 10516245,
    baselineSha: null
  }), true);
});

test('publication QA requires the current source review, asset hash, technical status and visual approval', () => {
  const sha256 = 'a'.repeat(64);
  const sourceHash = 'b'.repeat(64);
  const filePath = '/project/data/videos/clip.mp4';
  const owner = { publicationEligible: true, publicationReviewStatus: 'approved',
    sourceEvidence: { contextHash: sourceHash } };
  const asset = { path: 'data/videos/clip.mp4', sha256, sizeBytes: 12, technical: { status: 'passed' } };
  const manifest = { technicalStatus: 'passed', sourceReview: { sourceHash, factualReviewStatus: 'approved' },
    visualReview: { status: 'approved', approvedAssets: [{ path: 'data/videos/clip.mp4', sha256 }] } };
  const proof = { owner, manifest, recordedAsset: asset, filePath, currentSha256: sha256,
    currentSizeBytes: 12, manifestHashMatches: true, root: '/project' };
  assert.equal(isPublicationQaReady(proof), true);
  assert.equal(isPublicationQaReady({ ...proof, manifest: { ...manifest,
    sourceReview: { ...manifest.sourceReview, sourceHash: 'c'.repeat(64) } } }), false);
  assert.equal(isPublicationQaReady({ ...proof, currentSha256: 'd'.repeat(64) }), false);
  assert.equal(isPublicationQaReady({ ...proof, recordedAsset: { ...asset,
    technical: { status: 'failed' } } }), false);
  assert.equal(isPublicationQaReady({ ...proof, manifestHashMatches: false }), false);
  assert.equal(isPublicationQaReady({ ...proof, filePath: '/project/renders/clip.mp4' }), false);
});
