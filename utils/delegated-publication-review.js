'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isPublicationEligible } = require('./publication-status');
const { verifyVideoQaManifest } = require('./video-qa-manifest');
const { recordVideoVisualReview } = require('./video-qa-review');

const NANO_BANANA_PRO_MODEL_ID = 'gemini-3-pro-image';

// Owner-authorized automatic release is recorded separately from human aesthetic
// review. Uploaders still require the exact approved paths/hashes in the manifest.
async function applyDelegatedPublicationReview({
  root = path.join(__dirname, '..'),
  manifestPath,
  ledgerPath = path.join(root, process.env.STATE_DIR || 'data/state', 'topics.json')
} = {}) {
  const projectRoot = path.resolve(root);
  let policyBytes;
  try { policyBytes = await fs.readFile(path.join(projectRoot, 'config', 'publication-review-policy.json')); }
  catch (error) {
    if (error.code === 'ENOENT') return { status: 'disabled', reason: 'policy_missing' };
    throw error;
  }
  const policy = JSON.parse(policyBytes);
  if (policy.enabled === false) return { status: 'disabled', reason: 'policy_disabled' };
  if (policy.schemaVersion !== 1 || policy.enabled !== true || policy.mode !== 'owner-delegated-automatic'
    || !/^[a-z0-9-]{8,80}$/.test(policy.id || '') || !Number.isFinite(Date.parse(policy.authorizedAt || ''))
    || typeof policy.instruction !== 'string' || !policy.instruction.trim()) {
    throw new Error('invalid delegated publication review policy');
  }
  const resolvedManifestPath = path.resolve(projectRoot, manifestPath || '');
  const ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
  const matching = ledger.entries.filter(entry => typeof entry.qaManifestPath === 'string'
    && path.resolve(projectRoot, entry.qaManifestPath) === resolvedManifestPath);
  if (matching.length !== 1) throw new Error('automatic review requires exactly one matching ledger entry');
  const entry = matching[0];
  const eligible = current => isPublicationEligible(current) && !current.publicationHold
    && current.sourceEvidence?.contextHash === entry.sourceEvidence?.contextHash;
  if (!eligible(entry)) return { status: 'held', reason: 'source_or_publication_hold', videoId: entry.videoId };
  if (!/^[a-f0-9]{64}$/.test(entry.qaManifestSha256 || '')) throw new Error('ledger manifest hash is required');
  const expectedPaths = [entry.videoPath, entry.portraitVideoPath, ...(entry.clips || []).map(clip => clip.path)]
    .filter(value => typeof value === 'string' && value);
  const verified = await verifyVideoQaManifest({
    root: projectRoot, manifestPath: resolvedManifestPath,
    manifestSha256: entry.qaManifestSha256, expectedPaths
  });
  if (verified.status !== 'verified') throw new Error(`automatic review QA failed: ${verified.reason}`);
  const manifest = JSON.parse(await fs.readFile(resolvedManifestPath, 'utf8'));
  if (entry.thumbnailArtPolicy) {
    const requiredModelId = entry.thumbnailArtPolicy.requiredModelId;
    const requiredFormats = [...(entry.thumbnailArtPolicy.formats || [])].sort();
    if (requiredModelId !== NANO_BANANA_PRO_MODEL_ID
      || requiredFormats.join(',') !== '16:9,9:16'
      || verified.thumbnailArt?.modelId !== requiredModelId
      || !verified.thumbnailArt.landscape || !verified.thumbnailArt.portrait) {
      throw new Error('automatic review requires both hash-bound Nano Banana Pro covers');
    }
  }
  // An explicit, hash-bound rejection of a rendered master must win over the
  // owner's standing authorization for automatic review. A replacement
  // with different bytes can be reviewed independently.
  const holdPath = path.join(path.dirname(ledgerPath), 'visual-publication-holds.json');
  let holds;
  try { holds = JSON.parse(await fs.readFile(holdPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (holds) {
    if (holds.schemaVersion !== 1 || !Array.isArray(holds.entries)
      || holds.entries.some(hold => !/^[a-f0-9]{64}$/.test(String(hold?.sha256 || ''))
        && !/^[A-Za-z0-9_-]{8,80}$/.test(String(hold?.jobId || '')))) {
      throw new Error('invalid visual publication holds');
    }
    const masterSha256 = manifest.assets?.find(asset => asset.role === 'master')?.sha256;
    const hold = holds.entries.find(hold => (hold.sha256 && hold.sha256 === masterSha256)
      || (!hold.sha256 && hold.jobId === manifest.jobId));
    if (hold) {
      // A critique can be recorded while the other aspect is still rendering.
      // Bind it to the completed manifest once, so the producer can repair it
      // instead of retrying an opaque hold forever. Never transfer it to a
      // different scene plan or reinterpret an unstructured hold as a repair.
      if (hold.critique && hold.sourceScenePlanSha256 === manifest.scenePlan?.sha256
        && verified.visualReview !== 'rejected') {
        await recordVideoVisualReview({ root: projectRoot, manifestPath: resolvedManifestPath, ledgerPath,
          status: 'rejected', reviewer: 'Revisão visual registrada durante a geração',
          expectedManifestSha256: entry.qaManifestSha256, validateEntry: eligible,
          note: hold.reason, critique: hold.critique });
      }
      return { status: 'held', reason: 'visual_artifact_rejected', videoId: entry.videoId };
    }
  }
  if (verified.visualReview === 'rejected') return { status: 'held', reason: 'review_rejected', videoId: entry.videoId };
  if (verified.visualReview === 'approved') return { status: 'unchanged', reason: 'already_reviewed', videoId: entry.videoId };
  if (verified.visualReview !== 'pending') throw new Error('automatic review requires a pending review');
  if (manifest.scenePlan?.rebuild) {
    return { status: 'held', reason: 'visual_rebuild_requires_fresh_review', videoId: entry.videoId };
  }
  if (manifest.videoId !== entry.videoId || manifest.sourceReview?.factualReviewStatus !== 'approved'
    || manifest.sourceReview?.sourceHash !== entry.sourceEvidence.contextHash) {
    throw new Error('manifest source review does not match the approved source');
  }
  if (!verified.masterPath || !verified.thumbnail
    || (verified.coverVariants?.requiredFormats?.includes('9:16') && !verified.portraitThumbnail)
    || manifest.assets.some(asset => asset.technical?.status !== 'passed'
      || ['readableDuration', 'durationInRange', 'audioTrack', 'minimumFileSize']
        .some(check => asset.technical.checks?.[check] !== true)
      || !Array.isArray(asset.technical.issues) || asset.technical.issues.length)) {
    throw new Error('automatic review requires complete technical checks and a bound master/thumbnail');
  }
  const policySha256 = crypto.createHash('sha256').update(policyBytes).digest('hex');
  return recordVideoVisualReview({
    root: projectRoot, manifestPath: resolvedManifestPath, ledgerPath,
    reviewer: 'QA automático delegado pelo proprietário',
    method: 'owner-delegated-automatic',
    authorization: { policyId: policy.id, policySha256, authorizedAt: policy.authorizedAt },
    expectedManifestSha256: entry.qaManifestSha256,
    validateEntry: eligible,
    approvedPaths: [...manifest.assets.map(asset => asset.path), manifest.thumbnail.path,
      ...(manifest.portraitThumbnail?.path ? [manifest.portraitThumbnail.path] : [])],
    note: 'Liberação automática autorizada pelo proprietário. Fonte/revisão factual, checks técnicos, capas horizontal/vertical aplicáveis e hashes conferidos por ativo. Não representa revisão estética humana.'
  });
}

module.exports = { applyDelegatedPublicationReview };
