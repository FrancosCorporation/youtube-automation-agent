'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { isBackgroundRetryEligible, normalizedClips, publicationSucceeded } = require('./publication-status');
const { checkpointedPublication, priorClipResult, shouldRetrySocialAutomatically } = require('./social-publication-state');
const { resolveThemeHashtags } = require('./theme-metadata');
const { isPlatformTargeted, narrativePartDurationRejection, socialClipCaption } = require('./platform-video-policy');

const SOCIAL_PLATFORMS = ['tiktok', 'kwai', 'instagram', 'x'];

function disabledSet(value) {
  if (value instanceof Set) return new Set([...value].map(item => String(item).trim().toLowerCase()));
  return new Set(String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean));
}

function isWithin(parent, candidate) {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

async function managedVideoPath(root, candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  const mediaRoot = path.resolve(root, 'data', 'videos');
  const videoPath = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
  if (!isWithin(mediaRoot, videoPath)) return null;
  try {
    const [realMediaRoot, realVideoPath] = await Promise.all([
      fs.realpath(mediaRoot),
      fs.realpath(videoPath)
    ]);
    if (!isWithin(realMediaRoot, realVideoPath) || !(await fs.stat(realVideoPath)).isFile()) return null;
    return realVideoPath;
  } catch (_error) {
    return null;
  }
}

async function retryPendingSocialUploads({
  entry,
  results,
  maxUploads = 1,
  skipPlatforms = [],
  onPublicationState,
  root = path.resolve(__dirname, '..'),
  disabledPlatforms = process.env.SOCIALS_DISABLED || '',
  isLogged = async () => false,
  getMediaDuration = async () => null,
  videoLimits = {},
  uploaders = {},
  isHandlerAvailable = () => false,
  canPublishArtifact = () => true,
  expectedSha256ForArtifact = () => null,
  shouldYield = () => false,
  canStartPlatform = () => true,
  withBudget = (_platform, promise) => promise,
  now = Date.now()
}) {
  const next = {
    ...(results || {}),
    long: { ...(results?.long || {}) },
    clips: { ...(results?.clips || {}) }
  };
  if (!isBackgroundRetryEligible(entry)) return { results: next, uploadsAttempted: 0, attemptedPlatforms: [] };
  if (typeof onPublicationState !== 'function') throw new TypeError('retry social exige persistência por destino');

  const disabled = new Set([
    ...disabledSet(disabledPlatforms),
    ...disabledSet(skipPlatforms)
  ]);
  const parsedLimit = Number(maxUploads);
  const uploadLimit = Math.max(1, Number.isFinite(parsedLimit) ? Math.floor(parsedLimit) : 1);
  let uploadsAttempted = 0;
  const attemptedPlatforms = [];

  for (const clip of normalizedClips(entry)) {
    const matched = priorClipResult(next, clip.path, root);
    const resultKey = matched.key;
    const clipResults = { ...(matched.value || {}) };
    const videoPath = await managedVideoPath(root, clip.path);
    if (!videoPath) continue;
    if (!canPublishArtifact(clip.path)) continue;

    let duration;
    try { duration = await getMediaDuration(videoPath); }
    catch (_error) { continue; }
    if (!Number.isFinite(Number(duration)) || Number(duration) <= 0) continue;

    for (const platform of SOCIAL_PLATFORMS) {
      if (shouldYield()) return { results: next, uploadsAttempted, attemptedPlatforms };
      if (!isPlatformTargeted(clip, platform)) continue;
      if (disabled.has(platform)) continue;
      // The explicitly approved existing series must remain in order. If a
      // previous Kwai result is unresolved, do not release later parts.
      if (entry.jobId === 'ia-answer-20261023-gps-v2' && platform === 'kwai' && Number(clip.partIndex) > 1) {
        const earlier = normalizedClips(entry).filter(item => Number(item.partIndex) < Number(clip.partIndex));
        if (!earlier.every(item => publicationSucceeded(priorClipResult(next, item.path, root).value?.kwai))) continue;
      }
      const handlerAvailable = isHandlerAvailable(platform);
      let identityVerified = false;
      if (clipResults[platform]?.failureCode === 'social_account_identity_unverified' && handlerAvailable) {
        try { identityVerified = await isLogged(platform); }
        catch (_error) { continue; }
      }
      if (!shouldRetrySocialAutomatically(clipResults[platform], now, {
        platform, artifactPath: clip.path, root, handlerAvailable, identityVerified
      })) continue;
      if (typeof uploaders[platform] !== 'function') continue;
      let sessionReady = identityVerified;
      try {
        if (!sessionReady) sessionReady = await isLogged(platform);
        if (!sessionReady) continue;
      } catch (_error) {
        continue;
      }

      const maxSeconds = Math.max(1, Number(videoLimits[platform]) || 140);
      if (Number(duration) > maxSeconds) continue;
      if (narrativePartDurationRejection(platform, clip, duration, maxSeconds)) continue;
      const hashtags = resolveThemeHashtags(entry.seo?.hashtags, entry.theme);
      const title = clip.title || entry.seo?.youtubeTitle || entry.title || 'Pulso IA';
      const caption = socialClipCaption({ clip, title, hashtags, sourceUrl: entry.url || '', platform });
      if (shouldYield()) return { results: next, uploadsAttempted, attemptedPlatforms };
      if (!canStartPlatform(platform)) continue;
      uploadsAttempted += 1;
      attemptedPlatforms.push(platform);
      clipResults[platform] = await checkpointedPublication({
        scope: 'clip',
        platform,
        videoPath,
        previous: clipResults[platform],
        qaManifestPath: entry.qaManifestPath,
        artifactSha256: expectedSha256ForArtifact(clip.path),
        handlerAvailable,
        identityVerified,
        onPublicationState,
        upload: () => withBudget(platform, uploaders[platform]({ videoPath, caption }))
      });
      next.clips[resultKey] = clipResults;
      if (uploadsAttempted >= uploadLimit) return { results: next, uploadsAttempted, attemptedPlatforms };
    }
  }

  return { results: next, uploadsAttempted, attemptedPlatforms };
}

module.exports = { managedVideoPath, retryPendingSocialUploads };
