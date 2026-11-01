'use strict';

const fs = require('node:fs/promises');
const sharp = require('sharp');

const MIN_BYTES = 10 * 1024;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 400;
const MIN_DETAIL_COVERAGE = 0.005;

/** Reject blank/error pages before their screenshot is cached or shown in a video. */
async function assessArticleScreenshot(filePath, imageProcessor = sharp) {
  let stat;
  let metadata;
  let stats;
  let sample;
  try {
    stat = await fs.stat(filePath);
    metadata = await imageProcessor(filePath).metadata();
    stats = await imageProcessor(filePath).greyscale().stats();
    sample = await imageProcessor(filePath)
      .greyscale()
      .resize({ width: 128, height: 82, fit: 'fill' })
      .raw()
      .toBuffer();
  } catch (_error) {
    return { ok: false, reason: 'decode-failed' };
  }
  if (stat.size < MIN_BYTES) return { ok: false, reason: 'file-too-small' };
  if (metadata.width < MIN_WIDTH || metadata.height < MIN_HEIGHT) return { ok: false, reason: 'dimensions-too-small' };

  const values = Array.from(sample).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  const detailedPixels = sample.reduce((count, value) => count + (Math.abs(value - median) > 10 ? 1 : 0), 0);
  const detailCoverage = detailedPixels / Math.max(1, sample.length);
  const stdev = Math.max(...stats.channels.map(channel => channel.stdev));
  if (stdev < 18 || detailCoverage < MIN_DETAIL_COVERAGE) {
    return { ok: false, reason: 'insufficient-page-content', stdev, detailCoverage };
  }
  return { ok: true, reason: 'content-detected', stdev, detailCoverage, width: metadata.width, height: metadata.height };
}

module.exports = { assessArticleScreenshot, MIN_BYTES, MIN_WIDTH, MIN_HEIGHT, MIN_DETAIL_COVERAGE };
