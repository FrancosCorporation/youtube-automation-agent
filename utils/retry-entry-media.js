'use strict';

function sortRetryEntriesOldestFirst(entries) {
  return [...entries].sort((left, right) => {
    const timestamp = entry => {
      const value = Date.parse(entry?.generatedAt || '');
      return Number.isFinite(value) ? value : 0;
    };
    return timestamp(left) - timestamp(right);
  });
}

async function resolveRetryEntryMedia(entry, safeManagedMediaPath) {
  if (!entry || typeof safeManagedMediaPath !== 'function') {
    throw new TypeError('entry e safeManagedMediaPath são obrigatórios');
  }

  const masterPath = typeof entry.videoPath === 'string'
    ? await safeManagedMediaPath(entry.videoPath, ['.mp4']) : null;
  const clipPaths = [];
  for (const clip of Array.isArray(entry.clips) ? entry.clips : []) {
    const clipPath = typeof clip === 'string' ? clip : clip?.path;
    if (typeof clipPath !== 'string' || !clipPath) continue;
    const safeClipPath = await safeManagedMediaPath(clipPath, ['.mp4']);
    if (safeClipPath) clipPaths.push(safeClipPath);
  }

  if (!masterPath && clipPaths.length === 0) return null;
  return { masterPath, clipPaths };
}

module.exports = { resolveRetryEntryMedia, sortRetryEntriesOldestFirst };
