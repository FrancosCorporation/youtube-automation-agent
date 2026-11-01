'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const { verifyVideoQaManifest } = require('../utils/video-qa-manifest');
const { assertPublicationVisualGate } = require('../utils/publication-visual-gate');
const { isPublicationEligible, publicationSucceeded } = require('../utils/publication-status');
const { recordPublicationResult } = require('../utils/social-publication-state');
const { createAndroidSocialPublisher } = require('../utils/android-social-publisher');
const { publishTikTok } = require('../utils/tiktok-android-publisher');
const { checkpointedPublication } = require('./upload-to-socials');
const { withProcessFileLock } = require('../utils/process-file-lock');
const { socialClipCaption, isPlatformTargeted, narrativePartDurationRejection } = require('../utils/platform-video-policy');
const option = name => process.argv[process.argv.indexOf(`--${name}`) + 1];

async function main() {
  const jobId = option('job-id');
  const part = Number(option('part'));
  const ledger = path.join(root, 'data/state/topics.json');
  const entry = JSON.parse(fs.readFileSync(ledger)).entries.find(item => item.jobId === jobId);
  const clip = entry?.clips?.find(item => item.partIndex === part);
  if (!clip || !isPublicationEligible(entry) || !isPlatformTargeted(clip, 'tiktok')
    || narrativePartDurationRejection('tiktok', clip, clip.durationSeconds, 180)) {
    throw new Error('Parte sem aprovação/contrato TikTok');
  }
  if (part > 1) {
    const previousPart = entry.clips.find(item => item.partIndex === part - 1);
    if (!publicationSucceeded(entry.results?.clips?.[previousPart?.path]?.tiktok)) {
      throw new Error('Confirme a parte anterior no TikTok antes de seguir');
    }
  }
  const qa = await verifyVideoQaManifest({ root,
    manifestPath: entry.qaManifestPath, manifestSha256: entry.qaManifestSha256 });
  if (qa.status !== 'verified') throw new Error(`QA inválido: ${qa.reason}`);
  assertPublicationVisualGate(qa, clip.path);
  const hash = qa.assetProofs.find(asset => path.resolve(asset.path) === path.resolve(clip.path))?.sha256;
  if (!hash) throw new Error('Hash aprovado ausente');
  console.log(JSON.stringify({ jobId, part, qa: qa.status }));
  if (!process.argv.includes('--publish')) return;
  const directory = path.join(root, 'docs/evidencias/android-storage-recovery-2026-10-29');
  fs.mkdirSync(directory, { recursive: true });
  const publisher = createAndroidSocialPublisher({ handlers: { tiktok: async payload => {
    const result = await publishTikTok({ ...payload, accountHandle: process.env.ANDROID_SOCIAL_HANDLE_TIKTOK });
    const screenshotPath = path.join(directory, `${jobId}-tiktok-part-${part}-${Date.now()}.png`);
    fs.writeFileSync(screenshotPath, payload.control.screenshot());
    return { ...result, evidence: { ...result.evidence, screenshotPath } };
  } } });
  const result = await checkpointedPublication({ scope: 'clip', platform: 'tiktok', videoPath: clip.path,
    previous: entry.results?.clips?.[clip.path]?.tiktok,
    artifactSha256: hash, qaManifestPath: entry.qaManifestPath, handlerAvailable: true, identityVerified: true,
    onPublicationState: async event => {
      await recordPublicationResult(ledger, entry.videoPath, event, { root });
      fs.appendFileSync(path.join(directory, 'tiktok-approved-episode-attempt.jsonl'),
        JSON.stringify({ at: new Date().toISOString(), jobId, ...event }) + '\n');
      console.log(JSON.stringify(event));
    },
    upload: () => publisher.publish({ platform: 'tiktok', videoPath: clip.path,
      caption: socialClipCaption({ clip, title: clip.title, hashtags: '#ia #inteligenciaartificial #tecnologia',
        sourceUrl: entry.url, platform: 'tiktok' }) })
  });
  console.log(JSON.stringify({ finished: true, result }));
}

const jobId = option('job-id');
if (!/^[a-zA-Z0-9_-]{8,100}$/.test(jobId || '')) throw new Error('Use --job-id ID --part N [--publish]');
withProcessFileLock(main, { lockPath: path.join(root, `data/state/${jobId}-manual-publish.lock`),
  owner: 'approved-tiktok-part-publication', timeoutMs: 2000 })
  .catch(error => { console.error(error.message); process.exitCode = 1; });
