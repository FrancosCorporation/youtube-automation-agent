'use strict';

// Explicit, hash-checked recovery of one approved ledger entry. The recurring
// producer and its migration pause remain owned by channel-scheduler.js.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const { withProcessFileLock } = require('../utils/process-file-lock');
const { updateTopicLedger } = require('../utils/topic-ledger');
const { recordPublicationResult } = require('../utils/social-publication-state');
const { isPublicationEligible } = require('../utils/publication-status');
const { verifyVideoQaManifest } = require('../utils/video-qa-manifest');
const { assertPublicationVisualGate } = require('../utils/publication-visual-gate');

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? '' : process.argv[index + 1] || '';
}

async function main() {
  const jobId = option('job-id');
  const selected = [...new Set(option('only').split(',').filter(Boolean))];
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(jobId) || !selected.length
    || selected.some(p => !['youtube', 'shorts', 'instagram', 'kwai', 'tiktok', 'x'].includes(p))) {
    throw new Error('Use --job-id ID --only youtube,shorts,instagram [--publish] [--retry-resolved-storage]');
  }
  const ledgerPath = path.join(root, 'data/state/topics.json');
  const readEntry = async () => {
    const ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
    const entry = ledger.entries.find(item => item.jobId === jobId);
    if (!entry || !isPublicationEligible(entry)) throw new Error('Job ausente ou sem aprovação factual');
    return entry;
  };
  let entry = await readEntry();
  const qa = await verifyVideoQaManifest({ root, manifestPath: entry.qaManifestPath,
    manifestSha256: entry.qaManifestSha256 });
  if (qa.status !== 'verified') throw new Error(`QA inválido: ${qa.reason}`);
  assertPublicationVisualGate(qa);
  console.log(JSON.stringify({ jobId, selected, qa: qa.status, publish: process.argv.includes('--publish') }));
  if (!process.argv.includes('--publish')) return;
  const evidenceDirectory = path.join(root, 'docs/evidencias/android-storage-recovery-2026-10-29');
  await fs.mkdir(evidenceDirectory, { recursive: true });
  const eventsPath = path.join(evidenceDirectory, `${jobId}-publication.jsonl`);
  if (process.argv.includes('--retry-resolved-storage')) {
    const { socialAndroidTarget } = require('../utils/android-social-target');
    const target = socialAndroidTarget('instagram');
    await withProcessFileLock(async () => {
      const output = execFileSync('adb', ['-s', target.device, 'shell', 'df', '-Pk', '/data'],
        { encoding: 'utf8', timeout: 10000 });
      const freeBytes = Number(output.trim().split(/\r?\n/).at(-1).trim().split(/\s+/)[3]) * 1024;
      if (!(freeBytes >= 64 * 1024 * 1024)) throw new Error('Espaço interno ainda insuficiente');
      await updateTopicLedger(ledgerPath, ledger => {
        const current = ledger.entries.find(item => item.jobId === jobId);
        if (current.qaManifestSha256 !== entry.qaManifestSha256) throw new Error('QA alterado');
        const results = [current.results?.long?.youtube,
          ...Object.values(current.results?.clips || {}).flatMap(value => Object.values(value))];
        for (const result of results) {
          if (selected.includes(result?.platform) && result?.status === 'failed'
            && ['android_storage_insufficient', 'YOUTUBE_STUDIO_STORAGE_INSUFFICIENT'].includes(result.failureCode)
            && result.evidence?.kind === 'confirmed_no_send') {
            result.storageRecovery = { resolvedAt: new Date().toISOString(), freeBytes,
              previousNextAttemptAt: result.nextAttemptAt || null };
            result.nextAttemptAt = new Date().toISOString();
          }
        }
      });
      console.log(JSON.stringify({ storageRecovered: true, freeBytes }));
    }, { lockPath: target.lockPath, owner: 'approved-entry-storage-recheck', timeoutMs: 2000 });
    entry = await readEntry();
  }
  process.env.SOCIALS_DISABLED = ['kwai', 'instagram', 'tiktok', 'x', 'telegram']
    .filter(platform => !selected.includes(platform)).join(',');
  process.env.X_POST_FULL_VIDEO = '0';
  const { uploadToAll } = require('./upload-to-socials');
  const results = await uploadToAll({ videoPath: entry.videoPath, clips: entry.clips,
    title: entry.title, themeId: entry.theme, sourceUrl: entry.url,
    thumbnailPath: entry.thumbnailPath, previousResults: entry.results,
    skipYouTube: !selected.includes('youtube'), skipShorts: !selected.includes('shorts'),
    maxShorts: entry.clips.length, qaManifestPath: entry.qaManifestPath, qaManifest: qa,
    onPublicationState: async event => {
      if (!selected.includes(event.platform)) return;
      await recordPublicationResult(ledgerPath, entry.videoPath, event, { root });
      await fs.appendFile(eventsPath, JSON.stringify({ at: new Date().toISOString(), jobId, ...event }) + '\n');
      console.log(JSON.stringify({ platform: event.platform, artifact: path.basename(event.artifactPath),
        result: event.result }));
    }
  });
  console.log(JSON.stringify({ finished: true, selected, results }));
}

if (require.main === module) {
  const jobId = option('job-id');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(jobId)) throw new Error('job-id inválido');
  withProcessFileLock(main, { lockPath: path.join(root, `data/state/${jobId}-manual-publish.lock`),
    owner: 'approved-entry-publication', timeoutMs: 2000 })
    .catch(error => { console.error(error); process.exitCode = 1; });
}
