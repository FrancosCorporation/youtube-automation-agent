'use strict';

// Stage the reviewed first episode. This command never submits a platform upload.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');
const { writeVideoQaManifest, verifyVideoQaManifest, inspectThumbnailArtifact } = require('../utils/video-qa-manifest');
const { recordVideoVisualReview } = require('../utils/video-qa-review');
const { updateTopicLedger } = require('../utils/topic-ledger');
const { hashSourceContext, countWords } = require('../utils/source-evidence');
const { videoIdForPath } = require('../utils/observability-ids');
const { isPublicationEligible } = require('../utils/publication-status');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'docs/evidencias/ia-como-responde-2026-10-23');
const project = path.join(root, 'experiments/remotion-motion-review');
const rendered = path.join(project, 'renders/ia-answer-20261023');
const managed = path.join(root, 'data/videos/ia-answer-20261023');
const horizontalCover = path.join(evidence, 'thumbnail/cover.png');
const verticalCover = path.join(evidence, 'thumbnail/cover-portrait.png');
const ledgerPath = path.join(root, 'data/state/topics.json');
const statePath = path.join(evidence, 'publication-package.json');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = async file => digest(await fs.readFile(file));
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));

async function copyReviewed(source, target, expected) {
  if (await sha(source) !== expected) throw new Error(`Reviewed artifact changed: ${source}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  try { await fs.copyFile(source, target, require('node:fs').constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (await sha(target) !== expected) throw new Error(`Managed destination differs: ${target}`);
}

async function replaceReviewed(source, target, expected, backup) {
  if (await sha(source) !== expected) throw new Error(`Reviewed artifact changed: ${source}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const current = await sha(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (current === expected) return;
  if (current && backup) {
    await fs.copyFile(target, backup, require('node:fs').constants.COPYFILE_EXCL)
      .catch(error => { if (error.code !== 'EEXIST') throw error; });
  }
  const temporary = `${target}.${process.pid}.reviewed.tmp`;
  await fs.copyFile(source, temporary, require('node:fs').constants.COPYFILE_EXCL);
  if (await sha(temporary) !== expected) {
    await fs.unlink(temporary).catch(() => {});
    throw new Error(`Managed staging copy differs: ${target}`);
  }
  await fs.rename(temporary, target);
}

async function refreshExistingPackage(previous) {
  const review = await json(path.join(rendered, 'final-visual-review.json'));
  const technical = await json(path.join(rendered, 'technical-qa.json'));
  if (review.status !== 'approved' || review.assets?.length !== 10 || technical.technical?.length !== 8) {
    throw new Error('Existing package needs the approved review for both covers and eight video assets');
  }
  const ledger = await json(ledgerPath);
  const entry = ledger.entries.find(item => item.videoId === previous.videoId);
  const manifestPath = path.resolve(root, entry?.qaManifestPath || '');
  const priorQa = await verifyVideoQaManifest({ root, manifestPath, manifestSha256: entry?.qaManifestSha256 });
  if (priorQa.status !== 'verified' || !isPublicationEligible(entry)) throw new Error('Existing staged package needs reconciliation');
  const manifest = await json(manifestPath);
  const expectedVideoFiles = technical.technical.map(item => item.file);
  for (const source of expectedVideoFiles) {
    const reviewed = review.assets.find(item => path.resolve(item.path) === path.resolve(source));
    const technicalItem = technical.technical.find(item => item.file === source);
    const managedPath = path.join(managed, path.basename(source));
    const bound = manifest.assets.find(item => path.resolve(root, item.path) === path.resolve(managedPath));
    if (!reviewed || !technicalItem || reviewed.sha256 !== technicalItem.sha256 || reviewed.sha256 !== bound?.sha256) {
      throw new Error(`Video master or cut changed since staging: ${source}`);
    }
  }
  const horizontalReview = review.assets.find(item => path.resolve(item.path) === path.resolve(horizontalCover));
  const verticalReview = review.assets.find(item => path.resolve(item.path) === path.resolve(verticalCover));
  if (!horizontalReview || !verticalReview) throw new Error('Both cover hashes must be present in the final visual review');
  const previousCoverHash = manifest.thumbnail?.sha256;
  if (previousCoverHash !== horizontalReview.sha256 && hasPublicationResult(entry)) {
    throw new Error('A cover cannot be replaced after a platform submission has started');
  }
  const managedCover = path.join(managed, 'cover.png');
  const managedPortrait = path.join(managed, 'cover-portrait.png');
  await replaceReviewed(horizontalCover, managedCover, horizontalReview.sha256,
    path.join(evidence, 'thumbnail/cover-managed-before-refresh-v1.png'));
  await replaceReviewed(verticalCover, managedPortrait, verticalReview.sha256,
    path.join(evidence, 'thumbnail/cover-portrait-managed-before-refresh-v1.png'));

  const portraitCoverChanged = manifest.portraitThumbnail?.sha256 !== verticalReview.sha256
    || path.resolve(root, manifest.portraitThumbnail?.path || '') !== path.resolve(managedPortrait);
  if (previousCoverHash !== horizontalReview.sha256 || portraitCoverChanged) {
    const metadata = await sharp(managedCover).metadata();
    const stat = await fs.stat(managedCover);
    manifest.thumbnail = { path: path.relative(root, managedCover), sha256: horizontalReview.sha256,
      sizeBytes: stat.size, format: metadata.format, width: metadata.width, height: metadata.height };
    manifest.portraitThumbnail = await inspectThumbnailArtifact({ root, filePath: managedPortrait, variant: 'portrait' });
    manifest.coverVariants = { schemaVersion: 1, requiredFormats: ['16:9', '9:16'] };
    const coverPaths = new Set([path.resolve(managedCover), path.resolve(managedPortrait)]);
    manifest.visualReview = { ...manifest.visualReview, status: 'pending', note: 'Capa atualizada; nova revisão por hash em andamento.',
      approvedAssets: (manifest.visualReview?.approvedAssets || []).filter(asset =>
        !coverPaths.has(path.resolve(root, asset.path))) };
    const temporary = `${manifestPath}.${process.pid}.cover.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, manifestPath);
  }

  const portraitThumbnailSha256 = verticalReview.sha256;
  const nextManifestSha = await sha(manifestPath);
  await updateTopicLedger(ledgerPath, current => {
    const target = current.entries.find(item => item.videoId === previous.videoId);
    if (!target) throw new Error('Staged episode disappeared from ledger');
    target.portraitThumbnailPath = managedPortrait;
    target.portraitThumbnailSha256 = portraitThumbnailSha256;
    target.portraitVideoPath ||= path.join(managed, 'ai-answer-portrait.mp4');
    target.qaManifestSha256 = nextManifestSha;
  });
  const refreshed = await recordVideoVisualReview({ root, ledgerPath, manifestPath: entry.qaManifestPath,
    expectedManifestSha256: nextManifestSha, reviewer: 'Codex', method: 'owner-delegated-automatic', status: 'approved',
    approvedPaths: [...manifest.assets.map(asset => path.resolve(root, asset.path)), managedCover, managedPortrait],
    authorization: { policySha256: await sha(path.join(root, 'config/publication-review-policy.json')) },
    note: 'Capa horizontal e capa vertical geradas pelo ImageGen do GPT e revisadas em seus formatos próprios; masters e cortes preservam revisão por hash.',
    validateEntry: isPublicationEligible });
  const refreshedLedger = await json(ledgerPath);
  const refreshedEntry = refreshedLedger.entries.find(item => item.videoId === previous.videoId);
  const verification = await verifyVideoQaManifest({ root, manifestPath: refreshedEntry.qaManifestPath,
    manifestSha256: refreshedEntry.qaManifestSha256,
    expectedPaths: [refreshedEntry.videoPath, ...refreshedEntry.clips.map(clip => clip.path), refreshedEntry.portraitVideoPath] });
  if (verification.status !== 'verified' || !isPublicationEligible(refreshedEntry)) {
    throw new Error('Updated covers did not reconcile against the staged QA manifest');
  }
  const updatedPackage = { ...previous, portraitThumbnailPath: managedPortrait,
    portraitThumbnailSha256, thumbnailProvider: 'gpt-image-gen', coverHeadline: 'PARECE CERTO. MAS É?',
    coverUpdatedAt: new Date().toISOString(), qaManifestSha256: refreshed.manifestSha256 };
  await fs.writeFile(statePath, `${JSON.stringify(updatedPackage, null, 2)}\n`);
  console.log('Existing package updated with reviewed horizontal and vertical GPT covers; publication state preserved.');
}

function hasPublicationResult(entry) {
  const longResults = Object.values(entry?.results?.long || {});
  const clipResults = Object.values(entry?.results?.clips || {}).flatMap(value => Object.values(value || {}));
  return [...longResults, ...clipResults].some(result => result && !['not_started', 'skipped'].includes(result.status));
}

(async () => {
  const scheduler = spawnSync('systemctl', ['--user', 'is-active', '--quiet', 'ai-video-scheduler.service'], {
    env: { ...process.env, XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' }
  });
  if (scheduler.status !== 3) throw new Error('Stop the idle legacy scheduler before staging: its retries must not submit this episode through the old YouTube API route');
  const previous = await json(statePath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (previous) {
    await refreshExistingPackage(previous);
    return;
  }
  const review = await json(path.join(rendered, 'final-visual-review.json'));
  const technical = await json(path.join(rendered, 'technical-qa.json'));
  const factual = await json(path.join(evidence, 'factual-review-approved.json'));
  const script = await json(path.join(evidence, 'script-draft.json'));
  const timeline = await json(path.join(project, 'public/ia-answer-20261023/timeline.json'));
  const sourceContext = await fs.readFile(path.join(evidence, 'review-source-context.txt'), 'utf8');
  if (review.status !== 'approved' || !Array.isArray(review.assets) || review.assets.length !== 10) throw new Error('Both masters, all six cuts and both aspect-ratio covers need a final hash-bound visual review');
  if (technical.technical?.length !== 8 || technical.technical.some(item => !item.fullDecodePassed)) throw new Error('Eight technical checks are required');
  if (factual.result?.verdict !== 'aprovado' || new Set(factual.result.reviewers || []).size < 2
    || factual.scriptSha256 !== await sha(path.join(evidence, 'script-draft.json'))
    || factual.sourceContextSha256 !== digest(sourceContext)) throw new Error('Factual review changed or is incomplete');
  const sourceFiles = [...technical.technical.map(item => item.file), horizontalCover];
  const reviewedFiles = [...sourceFiles, verticalCover];
  for (const source of reviewedFiles) {
    const approved = review.assets.find(item => path.resolve(item.path) === path.resolve(source));
    if (!approved) throw new Error(`Missing final visual review: ${source}`);
    const technicalItem = technical.technical.find(item => item.file === source);
    if (technicalItem && technicalItem.sha256 !== approved.sha256) throw new Error('Technical and visual reviews disagree');
    await copyReviewed(source, path.join(managed, path.basename(source)), approved.sha256);
  }
  const narration = path.join(project, 'public/ia-answer-20261023/narration.wav');
  await copyReviewed(narration, path.join(managed, 'narration.wav'), await sha(narration));
  const videoPath = path.join(managed, 'ai-answer-landscape.mp4');
  const videoId = videoIdForPath(videoPath);
  const jobId = 'ia-answer-20261023-gps-v2';
  const clips = timeline.chapters.map(chapter => ({
    path: path.join(managed, `parte-${String(chapter.index + 1).padStart(2, '0')}.mp4`),
    title: chapter.title, kind: 'social-narrative-part', partIndex: chapter.index + 1, partCount: timeline.chapters.length,
    durationSeconds: chapter.durationSeconds, platforms: ['shorts', 'instagram', 'kwai', 'tiktok', 'x'],
    formatId: 'direct-answer', formatVersion: 1
  }));
  const sourceEvidence = {
    schemaVersion: 1, eligible: true, mode: 'auto', sourceTitle: script.title,
    sourceUrl: 'https://developers.google.com/machine-learning/crash-course/llm',
    contextHash: hashSourceContext(sourceContext), contextChars: sourceContext.length,
    contextWords: countWords(sourceContext), checkedAt: factual.reviewedAt
  };
  const publicationReview = { status: 'approved', sourceHash: sourceEvidence.contextHash, reviewer: factual.result.reviewer, checkedAt: factual.reviewedAt,
    reviewEvidencePath: path.relative(root, path.join(evidence, 'factual-review-approved.json')) };
  const thumbnailPath = path.join(managed, 'cover.png');
  const portraitThumbnailPath = path.join(managed, 'cover-portrait.png');
  const narrationTimings = await Promise.all(timeline.chapters.map(async chapter => {
    const boundaries = await json(path.join(project, `public/ia-answer-20261023/chapter-${String(chapter.index + 1).padStart(2, '0')}.words.json`));
    return { provider: 'edge-tts/pt-BR-FranciscaNeural', alignment: boundaries.alignment,
      durationMs: chapter.durationSeconds * 1000, cueCount: boundaries.events.length };
  }));
  const qa = await writeVideoQaManifest({ root, videoPath, clips: [...clips, { path: path.join(managed, 'ai-answer-portrait.mp4'), platforms: [] }],
    videoId, jobId, themeId: 'ia', topic: script.title, targetWords: script.targetWords, formatId: 'direct-answer', formatVersion: 1,
    scriptRevision: factual.scriptSha256, seed: 20261023, hook: script.hook, visualMode: 'graphics-and-source-prints',
    narrationTimings,
    narrationAudio: { path: path.join(managed, 'narration.wav'), inputSha256: factual.scriptSha256 },
    thumbnailPath, portraitThumbnailPath, sourceEvidence, sourceContext, sourceName: 'Google, Microsoft, Hugging Face, Anthropic', sourceTimeLabel: 'Material didático consultado em 23/10/2026', publicationReview });
  const entry = { jobId, videoId, renderer: 'remotion-gps-v2-narrative-episode', theme: 'ia', title: script.title,
    url: sourceEvidence.sourceUrl, source: 'Google, Microsoft, Hugging Face, Anthropic', sourceEvidence, publicationReview,
    publicationEligible: true, qaManifestPath: qa.manifestPath, qaManifestSha256: qa.manifestSha256,
    videoPath, clips, thumbnailPath, portraitThumbnailPath, portraitVideoPath: path.join(managed, 'ai-answer-portrait.mp4'),
    portraitThumbnailSha256: review.assets.find(item => path.resolve(item.path) === path.resolve(verticalCover)).sha256,
    formatId: 'direct-answer', formatVersion: 1, hook: script.hook,
    generatedAt: new Date().toISOString(), results: { long: {}, clips: {} } };
  if (!isPublicationEligible(entry) || qa.manifest.technicalStatus !== 'passed') throw new Error('Staged episode is not eligible for review');
  await updateTopicLedger(ledgerPath, ledger => {
    if (ledger.entries.some(item => item.videoId === videoId || item.jobId === jobId)) throw new Error('Episode already exists in ledger; reconcile without resetting attempts');
    ledger.entries.push(entry);
  });
  await recordVideoVisualReview({ root, ledgerPath, manifestPath: qa.manifestPath, expectedManifestSha256: qa.manifestSha256,
    reviewer: 'Codex', method: 'owner-delegated-automatic', status: 'approved',
    approvedPaths: [...sourceFiles.map(file => path.join(managed, path.basename(file))), path.join(managed, path.basename(verticalCover))],
    authorization: { policySha256: await sha(path.join(root, 'config/publication-review-policy.json')) },
    note: 'Final masters, six chapter cuts, horizontal thumbnail and vertical cover visually reviewed against final-visual-review.json; factual consensus, full decode, exact frame coverage and measured loudness verified.',
    validateEntry: isPublicationEligible });
  await fs.writeFile(statePath, JSON.stringify({ stagedAt: new Date().toISOString(), videoId, jobId, videoPath, clips, thumbnailPath,
    portraitThumbnailPath, portraitThumbnailSha256: entry.portraitThumbnailSha256,
    qaManifestPath: qa.manifestPath, youtubeRoute: 'authenticated-android-chrome-studio-only', excludedPlatforms: ['telegram'],
    note: 'Staging and QA do not prove a platform publication.' }, null, 2) + '\n', { flag: 'wx' });
  console.log(`Package staged and reviewed: ${videoId}. No platform submission performed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
