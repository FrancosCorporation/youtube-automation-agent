'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const SCREENSHOT_CACHE_VERSION = 3;
const SCREENSHOT_VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const SCREENSHOT_CLIP = Object.freeze({ x: 0, y: 0, width: 1280, height: 820 });

function articleScreenshotCachePath(cacheDirectory, sourceUrl, capturedAt = new Date()) {
  let url;
  try { url = new URL(String(sourceUrl || '')); }
  catch { throw new TypeError('URL inválida para cache de screenshot de artigo'); }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('protocolo inválido para cache de screenshot de artigo');
  }
  url.hash = '';

  const date = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  if (!Number.isFinite(date.getTime())) throw new TypeError('data inválida para cache de screenshot de artigo');
  const cacheKey = crypto.createHash('sha256').update(JSON.stringify({
    version: SCREENSHOT_CACHE_VERSION,
    sourceUrl: url.href,
    captureDateUtc: date.toISOString().slice(0, 10),
    viewport: SCREENSHOT_VIEWPORT,
    clip: SCREENSHOT_CLIP
  })).digest('hex');
  return path.join(cacheDirectory, `print-v${SCREENSHOT_CACHE_VERSION}-${cacheKey}.png`);
}

module.exports = { articleScreenshotCachePath, SCREENSHOT_CACHE_VERSION };
