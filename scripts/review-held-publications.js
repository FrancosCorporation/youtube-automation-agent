#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const fs = require('node:fs/promises');
const path = require('node:path');
const { extractArticleContext } = require('../utils/article-context');
const { updateTopicLedger } = require('../utils/topic-ledger');
const {
  assessSourceEvidence,
  createPublicationReview,
  hashSourceContext
} = require('../utils/source-evidence');
const { isPublicationEligible } = require('../utils/publication-status');
const { normalizedClips } = require('../utils/publication-status');
const { reviewScriptDeterministically } = require('./generate-animated-video');

const ROOT = path.resolve(__dirname, '..');
const STATE_DIR = path.resolve(ROOT, process.env.STATE_DIR || 'data/state');
const LEDGER_PATH = path.join(STATE_DIR, 'topics.json');
const REVIEW_RETRY_MS = 5 * 60 * 1000;
const TERMINAL_REVIEW_ATTEMPTS = new Set([
  'source_changed_since_generation',
  'source_unverified',
  'review_integrity_failed'
]);

function hasPublicationAttempt(entry) {
  const results = entry?.results || {};
  const values = [
    ...Object.values(results.long || {}),
    ...Object.values(results.clips || {}).flatMap(result => Object.values(result || {}))
  ];
  return values.some(value => typeof value === 'string'
    ? /^https?:\/\//i.test(value.trim())
    : ['attempting', 'submitted', 'processing', 'unknown', 'confirmed'].includes(value?.status));
}

function isVideoInsideProject(videoPath, root = ROOT) {
  if (typeof videoPath !== 'string' || !videoPath.trim()) return false;
  const videoRoot = path.resolve(root, 'data/videos');
  const absolute = path.isAbsolute(videoPath) ? path.resolve(videoPath) : path.resolve(root, videoPath);
  return absolute.startsWith(`${videoRoot}${path.sep}`) && absolute.endsWith('.mp4');
}

function heldReviewIsDue(entry, now = Date.now()) {
  const attempt = entry?.publicationReviewAttempt;
  if (!attempt || typeof attempt !== 'object') return true;
  if (TERMINAL_REVIEW_ATTEMPTS.has(attempt.status)) return false;
  const nextAttemptAt = Date.parse(attempt.nextAttemptAt || '');
  return !Number.isFinite(nextAttemptAt) || nextAttemptAt <= now;
}

async function hasLocalPublicationAsset(entry, root = ROOT) {
  const candidates = [entry?.videoPath, ...normalizedClips(entry).map(clip => clip.path)]
    .filter(candidate => isVideoInsideProject(candidate, root));
  for (const candidate of candidates) {
    const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
    const stat = await fs.stat(absolute).catch(() => null);
    if (stat?.isFile() && stat.size > 0) return true;
  }
  return false;
}

async function findLatestReviewableEntry(entries, { root = ROOT, now = Date.now() } = {}) {
  for (const item of [...entries].reverse()) {
    if (!item || item.publicationEligible === true
      || item.publicationReview?.status !== 'unavailable'
      || item.sourceEvidence?.eligible !== true
      || !item.sourceEvidence?.sourceUrl
      || !isVideoInsideProject(item.videoPath, root)
      || !heldReviewIsDue(item, now)
      || hasPublicationAttempt(item)) continue;
    if (await hasLocalPublicationAsset(item, root)) return item;
  }
  return null;
}

async function persistReviewAttempt(entry, status, { retryAfterMs = null, sourceHash = null } = {}) {
  let updated = false;
  const checkedAt = new Date().toISOString();
  const nextAttemptAt = Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? new Date(Date.now() + retryAfterMs).toISOString() : null;
  await updateTopicLedger(LEDGER_PATH, current => {
    const target = [...current.entries].reverse().find(item => item?.videoPath === entry.videoPath
      && (entry.jobId ? item.jobId === entry.jobId : !item.jobId));
    if (!target || target.publicationEligible === true || hasPublicationAttempt(target)) return current;
    target.publicationReviewAttempt = {
      status,
      checkedAt,
      ...(sourceHash ? { sourceHash } : {}),
      ...(nextAttemptAt ? { nextAttemptAt } : {})
    };
    updated = true;
    return current;
  });
  return updated;
}

function checkpointTargetsVideo(checkpoint, videoPath, root = ROOT) {
  if (typeof checkpoint?.outPath !== 'string' || typeof videoPath !== 'string') return false;
  const resolve = candidate => path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
  return resolve(checkpoint.outPath) === resolve(videoPath);
}

function applyReviewDecision(entry, sourceEvidence, publicationReview) {
  const approved = publicationReview?.status === 'approved';
  const reviewed = {
    ...entry,
    sourceEvidence,
    publicationReview,
    publicationEligible: approved
  };
  if (approved) delete reviewed.publicationHold;
  else reviewed.publicationHold = {
    reason: 'source_claims_unverified',
    reviewer: publicationReview?.reviewer || '',
    checkedAt: publicationReview?.checkedAt || new Date().toISOString()
  };
  return reviewed;
}

async function findScriptForSourceHash(sourceHash, sourceTitle) {
  const scriptsDir = path.join(ROOT, 'data/scripts');
  const names = await fs.readdir(scriptsDir).catch(() => []);
  for (const name of names.filter(value => value.endsWith('.json.meta.json'))) {
    const metaPath = path.join(scriptsDir, name);
    let meta;
    try { meta = JSON.parse(await fs.readFile(metaPath, 'utf8')); } catch { continue; }
    if (meta.contextHash !== sourceHash || meta.topic !== sourceTitle) continue;
    const scriptPath = metaPath.slice(0, -'.meta.json'.length);
    try {
      const script = JSON.parse(await fs.readFile(scriptPath, 'utf8'));
      if (typeof script.title === 'string' && Array.isArray(script.sections) && script.sections.length) {
        return { script, topic: meta.topic };
      }
    } catch { /* ignore stale metadata and continue */ }
  }
  return null;
}

async function reviewHeldLatest({ publish = false } = {}) {
  const ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8'));
  if (!ledger || !Array.isArray(ledger.entries)) throw new Error('ledger structure is invalid');
  const entry = await findLatestReviewableEntry(ledger.entries);
  if (!entry) return { status: 'no_reviewable_candidate' };

  let sourceContext;
  try {
    sourceContext = await extractArticleContext(entry.sourceEvidence.sourceUrl);
  } catch (_error) {
    await persistReviewAttempt(entry, 'source_context_unavailable', { retryAfterMs: REVIEW_RETRY_MS });
    return { status: 'source_context_unavailable' };
  }
  const currentEvidence = assessSourceEvidence({
    sourceTitle: entry.sourceEvidence.sourceTitle,
    sourceUrl: entry.sourceEvidence.sourceUrl,
    context: sourceContext,
    mode: entry.sourceEvidence.mode
  });
  if (!currentEvidence.eligible) {
    const status = currentEvidence.reason || 'source_unverified';
    await persistReviewAttempt(entry, 'source_unverified', { sourceHash: currentEvidence.contextHash });
    return { status };
  }
  if (hashSourceContext(sourceContext) !== entry.sourceEvidence.contextHash) {
    await persistReviewAttempt(entry, 'source_changed_since_generation', { sourceHash: currentEvidence.contextHash });
    return { status: 'source_changed_since_generation' };
  }

  const cached = await findScriptForSourceHash(currentEvidence.contextHash, currentEvidence.sourceTitle);
  if (!cached) {
    await persistReviewAttempt(entry, 'matching_script_not_found', { retryAfterMs: 60 * 60 * 1000, sourceHash: currentEvidence.contextHash });
    return { status: 'matching_script_not_found' };
  }

  let verdict;
  try {
    verdict = reviewScriptDeterministically(cached.script, sourceContext, entry.sourceEvidence?.ageHours);
  } catch (_error) {
    await persistReviewAttempt(entry, 'review_unavailable', { retryAfterMs: REVIEW_RETRY_MS, sourceHash: currentEvidence.contextHash });
    return { status: 'review_unavailable' };
  }
  if (!verdict || !['aprovado', 'reprovado'].includes(verdict.verdict)) {
    await persistReviewAttempt(entry, 'review_unavailable', { retryAfterMs: REVIEW_RETRY_MS, sourceHash: currentEvidence.contextHash });
    return { status: 'review_unavailable' };
  }
  const approved = verdict.verdict === 'aprovado';
  const publicationReview = createPublicationReview({
    verdict: verdict.verdict,
    sourceContext,
    reviewer: verdict.reviewer,
    checkedAt: new Date().toISOString()
  });
  if (typeof verdict.feedback === 'string' && verdict.feedback.trim()) {
    publicationReview.feedback = verdict.feedback.trim().slice(0, 600);
  }
  const reviewedEntry = applyReviewDecision(entry, currentEvidence, publicationReview);
  if (approved && !isPublicationEligible(reviewedEntry)) {
    await persistReviewAttempt(entry, 'review_integrity_failed', { sourceHash: currentEvidence.contextHash });
    return { status: 'review_integrity_failed' };
  }

  let updated = false;
  await updateTopicLedger(LEDGER_PATH, current => {
    const target = [...current.entries].reverse().find(item => item?.jobId === entry.jobId
      && item.videoPath === entry.videoPath);
    if (!target || target.publicationEligible === true
      || target.sourceEvidence?.contextHash !== currentEvidence.contextHash
      || hasPublicationAttempt(target)) return current;
    target.sourceEvidence = currentEvidence;
    target.publicationReview = publicationReview;
    target.publicationReviewAttempt = { status: approved ? 'approved' : 'rejected', checkedAt: publicationReview.checkedAt, sourceHash: currentEvidence.contextHash };
    target.publicationEligible = approved;
    if (approved) delete target.publicationHold;
    else target.publicationHold = reviewedEntry.publicationHold;
    updated = true;
    return current;
  });
  if (!updated) return { status: 'ledger_changed_during_review' };
  if (!approved) return { status: 'review_rejected' };
  if (!publish) return { status: 'approved_ready_for_publish' };

  const queuePath = path.join(STATE_DIR, 'publish-queue.json');
  const queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));
  if (!Array.isArray(queue.pending) || queue.inFlight
    || queue.pending.some(item => item?.outPath === entry.videoPath)) {
    return { status: 'queue_state_changed_after_review' };
  }
  const checkpointPath = path.join(STATE_DIR, 'generation-in-flight.json');
  const checkpointRaw = await fs.readFile(checkpointPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  let checkpoint = null;
  if (checkpointRaw !== null) {
    try { checkpoint = JSON.parse(checkpointRaw); }
    catch { return { status: 'generation_checkpoint_invalid' }; }
    if (typeof checkpoint?.outPath !== 'string') return { status: 'generation_checkpoint_invalid' };
  }
  if (checkpointTargetsVideo(checkpoint, entry.videoPath)) {
    return { status: 'generation_started_after_review' };
  }

  const { publishEverywhere } = require('./channel-scheduler');
  await publishEverywhere(entry.videoPath);
  return { status: 'publication_attempted' };
}

if (require.main === module) {
  reviewHeldLatest({ publish: process.argv.includes('--publish') })
    .then(result => console.log(`held-publication recovery: ${result.status}`))
    .catch(error => {
      console.error(`held-publication recovery failed: ${error?.code || error?.name || 'Error'}`);
      process.exitCode = 1;
    });
}

module.exports = { applyReviewDecision, checkpointTargetsVideo, findLatestReviewableEntry, hasLocalPublicationAsset, hasPublicationAttempt, heldReviewIsDue, isVideoInsideProject, persistReviewAttempt, reviewHeldLatest };
