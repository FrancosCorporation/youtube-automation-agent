'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { updateTopicLedger } = require('./topic-ledger');
const { isPublicationEligible } = require('./publication-status');
const { shouldAttemptPublication } = require('./social-publication-state');
const { loadVisualRebuildCritique } = require('./video-qa-review');
const { createGenerationAttemptStore } = require('./generation-attempt');
const { assertSafeVisualRebuildOutput } = require('./hyperframes-video-renderer');
const { resumePlanPath } = require('./narrative-resume-plan');
const { sha256, stableJson, validateNarrativeEpisodePlan } = require('./narrative-episode-plan');

async function preservedRebuildScenes({ root, stateDir, critique }) {
  const record = JSON.parse(await fs.readFile(resumePlanPath(root, stateDir, critique.sourceMasterPath).file, 'utf8'));
  if (record.planSha256 !== critique.sourceScenePlanSha256
    || sha256(Buffer.from(stableJson(record.plan))) !== record.planSha256
    || !validateNarrativeEpisodePlan(record.plan).valid) throw new Error('source narrative plan changed before rebuild');
  return record.plan.scenes.filter(scene => !critique.sceneIds.includes(scene.id));
}

async function prepareVisualRebuildOutput({ root, stateDir, outPath, sourceMasterPath,
  jobId, manifestPath, manifestSha256, resume }) {
  const output = path.resolve(root, outPath);
  let attempt = null;
  if (resume) {
    const store = createGenerationAttemptStore({ root, filePath: path.join(stateDir, 'generation-in-flight.json') });
    attempt = await store.read();
    if (attempt?.jobId !== jobId || path.resolve(root, attempt.outPath) !== output
      || attempt.visualRebuild?.manifestSha256 !== manifestSha256
      || path.resolve(root, attempt.visualRebuild?.manifestPath || '') !== path.resolve(root, manifestPath)) {
      throw new Error('visual rebuild resume does not match its durable checkpoint');
    }
  }
  try { await assertSafeVisualRebuildOutput(output, sourceMasterPath); }
  catch (error) {
    if (!attempt || error.code !== 'VISUAL_REBUILD_OUTPUT_EXISTS') throw error;
    const stat = await fs.lstat(output);
    if (!stat.isFile() || stat.isSymbolicLink()) throw error;
  }
  return attempt;
}

function hasRemotePublication(entry) {
  return Boolean(entry.ytUrl) || [...Object.values(entry.results?.long || {}),
    ...Object.values(entry.results?.clips || {}).flatMap(clip => Object.values(clip || {}))]
    .some(value => !shouldAttemptPublication(value));
}

// Only explicit, hash-bound narrative critiques are candidates. Technical
// failures, arbitrary holds and uncertain remote submissions are not retries.
async function enqueueVisualRebuilds({ root, ledgerPath, queue, activeThemes,
  loadCritique = loadVisualRebuildCritique, now = new Date(), onError = () => {} }) {
  const ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
  let enqueued = 0;
  for (const entry of ledger.entries) {
    if (!entry.qaManifestPath || !entry.qaManifestSha256 || entry.visualRecovery
      || !isPublicationEligible(entry) || entry.publicationHold || hasRemotePublication(entry)
      || !activeThemes.includes(entry.theme) || (entry.visualRecoveryDepth || 0) >= 2) continue;
    const manifestPath = path.resolve(root, entry.qaManifestPath);
    const relative = path.relative(path.join(root, 'data/reports/qa'), manifestPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (manifest.visualReview?.status !== 'rejected' || manifest.visualReview.rebuildRequired !== true
      || manifest.editorial?.visualMode !== 'narrative-episode-v2'
      || !manifest.visualReview.critique?.findings?.every(f => f.correction?.operation === 'reauthor-narrative')) continue;
    let critique;
    try { critique = await loadCritique({ root, manifestPath, expectedManifestSha256: entry.qaManifestSha256 }); }
    catch (error) { onError(entry.videoId, error); continue; }
    // A stable identity makes a crash between ledger reservation and enqueue
    // recoverable without ever creating a second replacement for this critique.
    const digest = crypto.createHash('sha256').update(`visual-rebuild:${entry.qaManifestSha256}`).digest('hex');
    const jobId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const attempt = { version: 1, jobId, theme: entry.theme, seed: critique.sourceEditorial.seed,
      formatId: critique.sourceEditorial.formatId, outPath: `data/videos/rebuild_${jobId}.mp4`,
      startedAt: now.toISOString(), visualRebuild: { manifestPath: path.relative(root, manifestPath),
        manifestSha256: entry.qaManifestSha256, depth: (entry.visualRecoveryDepth || 0) + 1 } };
    let reserved = false;
    await updateTopicLedger(ledgerPath, current => {
      const source = current.entries.find(e => e.videoId === entry.videoId && e.qaManifestSha256 === entry.qaManifestSha256);
      if (source && !source.visualRecovery && isPublicationEligible(source) && !hasRemotePublication(source)) {
        source.visualRecovery = { status: 'pending', attempt };
        reserved = true;
      }
      return current;
    });
    if (reserved) enqueued++;
  }
  // Replay reservations after a crash. The deferred queue deduplicates by job
  // and commits the active checkpoint before removing the queued item.
  const current = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
  for (const entry of current.entries) {
    if (entry.visualRecovery?.status === 'pending' && !hasRemotePublication(entry)
      && isPublicationEligible(entry)
      && entry.qaManifestSha256 === entry.visualRecovery.attempt.visualRebuild.manifestSha256) {
      await queue.enqueue(entry.visualRecovery.attempt);
    }
  }
  return enqueued;
}

async function finishVisualRebuild({ ledgerPath, jobId, status }) {
  if (!['completed', 'failed'].includes(status)) throw new TypeError('estado da reconstrução inválido');
  await updateTopicLedger(ledgerPath, ledger => {
    for (const entry of ledger.entries) if (entry.visualRecovery?.attempt?.jobId === jobId) {
      entry.visualRecovery.status = status;
      entry.visualRecovery.finishedAt = new Date().toISOString();
    }
    return ledger;
  });
}

module.exports = { enqueueVisualRebuilds, finishVisualRebuild, hasRemotePublication, prepareVisualRebuildOutput, preservedRebuildScenes };
