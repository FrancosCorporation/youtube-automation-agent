'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { withProcessFileLock } = require('./process-file-lock');
const { withAndroidDeviceLock } = require('./android-device-lock');
const { sha256StableRegularFile } = require('./video-qa-manifest');
const { recordPublicationResult } = require('./social-publication-state');
const config = require('../config/youtube-studio.json');

function studioReconciliationCandidates(entries, root, channelId) {
  const candidates = [];
  for (const entry of entries || []) {
    const targets = [{ scope: 'long', platform: 'youtube', file: entry.videoPath, result: entry.results?.long?.youtube },
      ...Object.entries(entry.results?.clips || {}).map(([file, result]) => ({ scope: 'clip', platform: 'shorts', file, result: result.shorts }))];
    for (const target of targets) {
      const r = target.result;
      if (!['unknown', 'submitted', 'processing'].includes(r?.status) || r.platform !== target.platform
        || r.account !== channelId || !/^[A-Za-z0-9_-]{11}$/.test(r.externalId || '')
        || !/^[a-f0-9]{64}$/.test(r.artifact?.sha256 || '') || !target.file || !r.artifact?.path
        || path.resolve(root, target.file) !== path.resolve(root, r.artifact.path)) continue;
      candidates.push({ ...target, entry });
    }
  }
  return candidates;
}

// Read-only Studio inspection of a persisted remote ID. A missing/private row
// stays uncertain; it never grants permission to send another copy.
async function reconcilePendingStudioPublications({ root = path.resolve(__dirname, '..'), env = process.env,
  inspect, maxItems = 2 } = {}) {
  const stateDir = path.resolve(root, env.STATE_DIR || 'data/state');
  const ledgerPath = path.join(stateDir, 'topics.json');
  const statePath = path.join(stateDir, 'reconciliation-youtube.json');
  return withProcessFileLock(async () => {
    let state = {};
    try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (Date.parse(state.nextCheckAt || '') > Date.now()) return { status: 'waiting', confirmed: [] };
    const ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
    const candidates = studioReconciliationCandidates(ledger.entries, root, config.expectedChannelId);
    const report = { checkedAt: new Date().toISOString(), nextCheckAt: new Date(Date.now() + 15 * 60000).toISOString(),
      status: 'checked', candidates: candidates.length, confirmed: [], cursor: state.cursor || 0 };
    for (let i = 0; i < Math.min(maxItems, candidates.length); i++) {
      const candidate = candidates[((state.cursor || 0) + i) % candidates.length];
      const previous = candidate.result;
      try {
        const file = path.resolve(root, candidate.file);
        const proof = await sha256StableRegularFile(file);
        if (proof.sha256 !== previous.artifact.sha256) continue;
        const observation = await (inspect || inspectStudioCandidate)(candidate, env);
        if (observation?.videoId !== previous.externalId) continue;
        const result = { ...previous, status: 'confirmed', confirmedAt: new Date().toISOString(),
          url: `https://youtu.be/${previous.externalId}`,
          evidence: { kind: 'studio_publication_confirmed', observed: 'Studio confirmou o ID persistido como público e publicado no canal configurado.',
            ...(observation.screenshotPath ? { screenshotPath: observation.screenshotPath } : {}) } };
        delete result.failureCode; delete result.nextAttemptAt;
        await recordPublicationResult(ledgerPath, candidate.entry.videoPath,
          { scope: candidate.scope, platform: candidate.platform, artifactPath: candidate.file, result }, { root });
        report.confirmed.push({ jobId: candidate.entry.jobId, platform: candidate.platform, externalId: previous.externalId });
      } catch (error) {
        report.status = 'deferred';
        report.reason = String(error.code || error.name).slice(0, 80);
      }
    }
    report.cursor = candidates.length ? ((state.cursor || 0) + Math.min(maxItems, candidates.length)) % candidates.length : 0;
    const temporary = `${statePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(report, null, 2), { mode: 0o600 });
    await fs.rename(temporary, statePath);
    return report;
  }, { lockPath: `${statePath}.lock`, owner: 'reconcile:youtube', timeoutMs: 1000 });
}

async function inspectStudioCandidate(candidate, env) {
  const { chromium } = require('playwright');
  const { socialAndroidTarget } = require('./android-social-target');
  const { adb, connectStudioBrowser, waitForStudioPublishedRow } = require('./youtube-studio-publisher');
  const target = socialAndroidTarget('instagram', { env });
  const device = env.ANDROID_DEVICE_YOUTUBE || config.androidDevice;
  if (target.device !== device) throw new Error('Studio device mismatch');
  await target.emulator.acquire();
  try {
    return await withAndroidDeviceLock(async () => {
      const browser = await connectStudioBrowser({ device, cdpUrl: env.YOUTUBE_STUDIO_CDP_URL || config.cdpUrl,
        adbPath: env.ADB_PATH || 'adb', runAdb: adb, connect: (...args) => chromium.connectOverCDP(...args) });
      try {
        return await waitForStudioPublishedRow(browser, { videoId: candidate.result.externalId,
          expectedChannelId: config.expectedChannelId, platform: candidate.platform,
          artifactSha256: candidate.result.artifact.sha256, timeoutMs: 60000 });
      } finally { await browser.close().catch(() => {}); }
    }, { lockPath: target.lockPath, owner: 'reconcile:youtube', timeoutMs: 10000 });
  } finally { target.emulator.release(); }
}

module.exports = { studioReconciliationCandidates, reconcilePendingStudioPublications };
