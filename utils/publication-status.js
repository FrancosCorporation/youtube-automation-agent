'use strict';

const path = require('node:path');

function publicationSucceeded(value) {
  return typeof value === 'string' && (/^ok$/i.test(value.trim()) || /^https?:\/\//i.test(value.trim()));
}

function sameProjectPath(root, left, right) {
  if (!left || !right) return false;
  const resolve = value => path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  return resolve(left) === resolve(right);
}

function disabledPlatforms(options) {
  return new Set(((options.disabledPlatforms ?? process.env.SOCIALS_DISABLED) || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
}

function normalizedClips(entry) {
  return (Array.isArray(entry?.clips) ? entry.clips : []).map(clip => typeof clip === 'string' ? { path: clip } : clip)
    .filter(clip => clip && typeof clip.path === 'string' && clip.path);
}

function shortsLimit(options, clipsLength) {
  const raw = options.maxShorts ?? (process.env.MAX_SHORTS || 1);
  const parsed = Number(raw);
  const count = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 1;
  return Math.min(clipsLength, count);
}

function longUploadsSucceeded(entry, results, options = {}) {
  if (!entry || !results) return false;
  const youtube = results.long?.youtube || entry.ytUrl;
  if (!publicationSucceeded(youtube)) return false;
  const disabled = disabledPlatforms(options);
  if (process.env.TELEGRAM_CHANNEL && !disabled.has('telegram') && !publicationSucceeded(results.long?.telegram)) return false;
  return true;
}

function clipUploadsSucceeded(entry, results, index, options = {}) {
  if (!entry || !results) return false;
  const clips = normalizedClips(entry);
  const clip = clips[index];
  if (!clip) return false;
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  const result = Object.entries(results.clips || {})
    .find(([resultPath]) => sameProjectPath(root, resultPath, clip.path))?.[1];
  if (!result || typeof result !== 'object') return false;

  const disabled = disabledPlatforms(options);
  for (const platform of ['tiktok', 'kwai', 'instagram', 'x']) {
    if (!disabled.has(platform) && !publicationSucceeded(result[platform])) return false;
  }
  if (index < shortsLimit(options, clips.length) && !publicationSucceeded(result.shorts)) return false;
  return true;
}

function allRequiredUploadsSucceeded(entry, results, options = {}) {
  if (!longUploadsSucceeded(entry, results, options)) return false;
  return normalizedClips(entry).every((_clip, index) => clipUploadsSucceeded(entry, results, index, options));
}

module.exports = {
  allRequiredUploadsSucceeded,
  clipUploadsSucceeded,
  longUploadsSucceeded,
  normalizedClips,
  publicationSucceeded
};
