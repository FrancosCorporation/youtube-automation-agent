'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_MIGRATION_PAUSE_MARKER = path.join(__dirname, '..', 'data', 'state', 'narrative-method-migration.paused');
const DEFAULT_MIGRATION_CANARY = path.join(__dirname, '..', 'data', 'state', 'narrative-method-migration-canary.json');
const APPROVED_NARRATIVE_RENDERER = 'remotion-4.0.537-narrative-episode-v2-approved-robot';
// One explicitly owner-approved explainer, not a general legacy exception.
// Its public source audit, original reference and portrait must all match.
const APPROVED_REFERENCE = Object.freeze({
  jobId: 'pulso-internet-reference-20261029',
  renderer: 'owner-approved-internet-reference-v2',
  reviewer: 'owner-approved-reference-source-audit-v1',
  sourceHash: '34410029c8a61ad66439587fea28ac9e34ace9a1a54b49eae667ef18ed6fa26f',
  auditPath: 'docs/evidencias/pulso-referencia-publicavel-20261029/auditoria-fontes.json',
  auditSha256: 'c03968acd584ecc750d2ffb3c522dfbc35e8d2983178c21626966fc564d9e811',
  masterSha256: '573ee1802fdac2bc294acc51b101a8e0c7e5e5fababc40aeb5854efe4f3838aa',
  portraitSha256: '5b902a7348522e466c5be1a203de872a36f1c373f816e7d516cbf9beb8ee2882'
});
// Identify the previously published package so cleanup preserves its proof.
// This identification does not make the legacy renderer eligible for retry.
const APPROVED_EXISTING_EPISODE = Object.freeze({
  jobId: 'ia-answer-20261023-gps-v2',
  renderer: 'remotion-gps-v2-narrative-episode',
  manifestSha256: '74a2334a5caf38d1d49720267ee58639f718da758f5c519481323fe07eca9d52',
  sourceHash: '96090856f3afa11d6737bfe6b186aa9501579d9a1e083b1c4511c373f182a7ea'
});

function isVideoGenerationPaused(env = process.env, markerPath = DEFAULT_MIGRATION_PAUSE_MARKER) {
  return env.PAUSE_VIDEO_GENERATION === '1' || fs.existsSync(markerPath);
}

// While publication stays paused, the existing scheduler may create a single
// reviewable v2 candidate after the configured provider reset. Invalid or
// missing state always fails closed and an administrative pause always wins.
function canRunMigrationCanary({ env = process.env, markerPath = DEFAULT_MIGRATION_PAUSE_MARKER,
  canaryPath = DEFAULT_MIGRATION_CANARY, now = Date.now() } = {}) {
  if (env.PAUSE_VIDEO_GENERATION === '1' || !fs.existsSync(markerPath) || !Number.isFinite(now)) return false;
  try {
    const record = JSON.parse(fs.readFileSync(canaryPath, 'utf8'));
    if (record.version !== 1 || record.renderer !== APPROVED_NARRATIVE_RENDERER
      || typeof record.notBefore !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(record.notBefore)) return false;
    const start = Date.parse(record.notBefore);
    return Number.isFinite(start) && now >= start;
  } catch { return false; }
}

function isScheduledGenerationPaused(options = {}) {
  return isVideoGenerationPaused(options.env, options.markerPath) && !canRunMigrationCanary(options);
}

function migrationCanaryRetryDelayMs(failureCode, baseDelayMs, canaryActive) {
  return canaryActive && failureCode === 'script_generation_unavailable'
    ? Math.max(baseDelayMs, 30 * 60 * 1000) : baseDelayMs;
}

function isApprovedExistingEpisode(entry) {
  return entry?.jobId === APPROVED_EXISTING_EPISODE.jobId
    && entry.renderer === APPROVED_EXISTING_EPISODE.renderer
    && entry.qaManifestSha256 === APPROVED_EXISTING_EPISODE.manifestSha256;
}

function autonomousNarrativePublicationDecision(entry, qaManifest) {
  if (!entry || typeof entry !== 'object') return { allowed: false, reason: 'ledger_entry_missing' };
  if (entry.jobId === APPROVED_REFERENCE.jobId) {
    let auditHash = '';
    try { auditHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', APPROVED_REFERENCE.auditPath))).digest('hex'); }
    catch { /* a missing audit blocks the reference */ }
    const assets = Array.isArray(qaManifest?.assetProofs) ? qaManifest.assetProofs : [];
    const exactReference = entry.renderer === APPROVED_REFERENCE.renderer && entry.publicationEligible === true
      && entry.publicationReview?.status === 'approved' && entry.publicationReview?.reviewer === APPROVED_REFERENCE.reviewer
      && entry.publicationReview?.sourceHash === APPROVED_REFERENCE.sourceHash
      && entry.sourceEvidence?.contextHash === APPROVED_REFERENCE.sourceHash
      && qaManifest?.status === 'verified' && qaManifest.renderer === APPROVED_REFERENCE.renderer
      && qaManifest.visualMode === 'approved-reference-v2'
      && qaManifest.visualReview === 'approved' && qaManifest.factualReviewStatus === 'approved'
      && qaManifest.reviewer === APPROVED_REFERENCE.reviewer && qaManifest.sourceHash === APPROVED_REFERENCE.sourceHash
      && auditHash === APPROVED_REFERENCE.auditSha256
      && assets.some(asset => asset.role === 'master' && asset.sha256 === APPROVED_REFERENCE.masterSha256)
      && assets.some(asset => asset.role === 'social_part' && asset.sha256 === APPROVED_REFERENCE.portraitSha256);
    return exactReference ? { allowed: true, reason: null } : { allowed: false, reason: 'approved_reference_proof_mismatch' };
  }
  if (entry.renderer !== APPROVED_NARRATIVE_RENDERER) return { allowed: false, reason: 'renderer_not_approved_for_automatic_route' };
  if (entry.publicationEligible !== true || entry.publicationReview?.status !== 'approved') {
    return { allowed: false, reason: 'factual_publication_review_not_approved' };
  }
  const sourceHash = entry.sourceEvidence?.contextHash;
  if (!/^[a-f0-9]{64}$/i.test(String(sourceHash || ''))
    || entry.publicationReview?.sourceHash !== sourceHash) {
    return { allowed: false, reason: 'factual_review_source_hash_mismatch' };
  }
  if (qaManifest?.status !== 'verified' || qaManifest.renderer !== APPROVED_NARRATIVE_RENDERER
    || qaManifest.visualMode !== 'narrative-episode-v2'
    || qaManifest.factualReviewStatus !== 'approved'
    || qaManifest.sourceHash !== sourceHash
    || qaManifest.reviewer !== 'deterministic-source-evidence-v1') {
    return { allowed: false, reason: 'hash_bound_narrative_manifest_not_verified' };
  }
  const rhythm = qaManifest.scenePlan?.visualRhythm;
  if (rhythm?.schemaVersion !== 1 || rhythm.rule !== 'long-cue-shot-variation-v1' || rhythm.status !== 'passed'
    || !/^[a-f0-9]{64}$/.test(String(qaManifest.scenePlan?.sha256 || ''))
    || rhythm.planSha256 !== qaManifest.scenePlan.sha256) {
    return { allowed: false, reason: 'visual_rhythm_evidence_missing' };
  }
  return { allowed: true, reason: null };
}

module.exports = {
  APPROVED_NARRATIVE_RENDERER,
  DEFAULT_MIGRATION_CANARY,
  DEFAULT_MIGRATION_PAUSE_MARKER,
  autonomousNarrativePublicationDecision,
  canRunMigrationCanary,
  isApprovedExistingEpisode,
  isScheduledGenerationPaused,
  isVideoGenerationPaused,
  migrationCanaryRetryDelayMs
};
