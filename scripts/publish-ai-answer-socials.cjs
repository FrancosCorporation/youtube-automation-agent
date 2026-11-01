'use strict';

// Shorts uses the same authenticated Android Studio adapter as the scheduler.
// Use --only shorts or --only instagram,kwai for a hash-bound partial batch.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { verifyVideoQaManifest } = require('../utils/video-qa-manifest');
const { assertPublicationVisualGate } = require('../utils/publication-visual-gate');
const { isPublicationEligible } = require('../utils/publication-status');
const { updateTopicLedger } = require('../utils/topic-ledger');
const { withProcessFileLock } = require('../utils/process-file-lock');
const { ENABLED_SOCIAL_PLATFORMS, EXCLUDED_SOCIAL_PLATFORMS } = require('../utils/social-platforms');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });
const evidence = path.join(root, 'docs/evidencias/ia-como-responde-2026-10-23');
const ledgerPath = path.join(root, 'data/state/topics.json');
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const sha = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const SOCIAL_PLATFORMS = ['shorts', ...ENABLED_SOCIAL_PLATFORMS];

function socialTargets(args = process.argv.slice(2), env = process.env) {
  const option = args.find(value => value.startsWith('--only='));
  const optionIndex = args.indexOf('--only');
  const hasOption = Boolean(option) || optionIndex >= 0;
  const only = option ? option.slice('--only='.length) : optionIndex >= 0 ? args[optionIndex + 1] : null;
  if (hasOption && (only == null || String(only).startsWith('--'))) {
    throw new Error(`informe as plataformas após --only: ${SOCIAL_PLATFORMS.join(', ')}`);
  }
  const configuredDisabled = [...new Set([
    ...(env.SOCIALS_DISABLED || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean),
    ...EXCLUDED_SOCIAL_PLATFORMS
  ])];
  let selected = SOCIAL_PLATFORMS.filter(platform => !configuredDisabled.includes(platform));
  if (hasOption) {
    const requested = [...new Set(String(only).split(',').map(value => value.trim().toLowerCase()).filter(Boolean))];
    if (!requested.length || requested.some(platform => !SOCIAL_PLATFORMS.includes(platform))) {
      throw new Error(`--only aceita: ${SOCIAL_PLATFORMS.join(', ')}`);
    }
    const disabledRequested = requested.filter(platform => configuredDisabled.includes(platform));
    if (disabledRequested.length) throw new Error(`plataforma desligada pela configuração: ${disabledRequested.join(', ')}`);
    selected = requested;
  }
  const disabled = [...new Set([...configuredDisabled, ...SOCIAL_PLATFORMS.filter(platform => !selected.includes(platform))])];
  return { selected, disabled };
}

async function publish() {
  const targets = socialTargets();
  const staged = await json(path.join(evidence, 'publication-package.json'));
  const ledger = await json(ledgerPath);
  const entry = ledger.entries.find(item => item.videoId === staged.videoId);
  if (!isPublicationEligible(entry)) throw new Error('Episode lacks approved factual/source evidence');
  const qa = await verifyVideoQaManifest({ root, manifestPath: entry.qaManifestPath, manifestSha256: entry.qaManifestSha256,
    // The confirmed master may already have been cleaned up. Verify every clip
    // being sent against the original approved manifest, without rewriting it.
    expectedPaths: [...entry.clips.map(clip => clip.path), entry.portraitVideoPath].filter(Boolean),
    allowMissingManifestAssets: true });
  if (qa.status !== 'verified') throw new Error(`Hash-bound QA failed: ${qa.reason}`);
  assertPublicationVisualGate(qa);
  if (!process.argv.includes('--publish')) {
    console.log(JSON.stringify({ status: 'ready-for-authorized-social-attempt', videoId: entry.videoId,
      clips: entry.clips.length, platforms: targets.selected, youtube: 'Master preserved; Shorts through Android Studio',
      action: 'Run with --publish [--only instagram,kwai] after final review. Each outcome is checkpointed in topics.json.' }, null, 2));
    return;
  }
  // Current owner request targets all four configured social apps, excluding Telegram.
  process.env.SOCIALS_DISABLED = targets.disabled.join(',');
  process.env.X_POST_FULL_VIDEO = '0';
  const { uploadToAll } = require('./upload-to-socials');
  const results = await uploadToAll({ videoPath: entry.videoPath, clips: entry.clips, title: entry.title,
    themeId: entry.theme, hashtags: '#InteligenciaArtificial #IA #PulsoExplica', sourceUrl: entry.url,
    thumbnailPath: entry.thumbnailPath, skipYouTube: true, skipShorts: !targets.selected.includes('shorts'),
    maxShorts: entry.clips.length,
    qaManifestPath: entry.qaManifestPath, qaManifest: qa, previousResults: entry.results,
    onPublicationState: async ({ scope, platform, artifactPath, result }) => {
      // A partial batch never overwrites state belonging to another destination.
      if (!targets.selected.includes(platform)) return;
      await updateTopicLedger(ledgerPath, current => {
        const item = current.entries.find(row => row.videoId === entry.videoId);
        if (!item || item.qaManifestSha256 !== entry.qaManifestSha256) throw new Error('Episode changed while publishing');
        item.results ||= { long: {}, clips: {} };
        if (scope === 'long') item.results.long[platform] = result;
        else { item.results.clips[artifactPath] ||= {}; item.results.clips[artifactPath][platform] = result; }
      });
      await fs.appendFile(path.join(evidence, 'social-attempts.jsonl'), JSON.stringify({ recordedAt: new Date().toISOString(),
        videoId: entry.videoId, scope, platform, artifactPath, result }) + '\n');
      console.log(JSON.stringify({ platform, part: path.basename(artifactPath), status: result?.status || result }));
    }
  });
  const filename = `social-attempt-${new Date().toISOString().replace(/[^0-9TZ]/g, '')}.json`;
  await fs.writeFile(path.join(evidence, filename), JSON.stringify({ finishedAt: new Date().toISOString(),
    videoId: entry.videoId, qaManifestSha256: await sha(path.resolve(root, entry.qaManifestPath)), results,
    youtube: 'No API upload attempted; Android Studio remains required.' }, null, 2) + '\n', { flag: 'wx' });
}

if (require.main === module) {
  withProcessFileLock(publish, { lockPath: path.join(root, 'data/state/ia-answer-20261023-publish.lock'),
    owner: 'ia-answer-social-publisher', timeoutMs: 1000 }).catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { socialTargets };
