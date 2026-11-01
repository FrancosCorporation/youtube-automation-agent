'use strict';

const { fallbackThumbnailHeadline } = require('./thumbnail-design');

function resolvePublicationTitle({ seoTitle, title, sourceTitle, maxLength = 100 } = {}) {
  if (!Number.isInteger(maxLength) || maxLength < 35 || maxLength > 100) throw new RangeError('limite de título inválido');
  for (const candidate of [seoTitle, title, sourceTitle]) {
    const value = typeof candidate === 'string' ? candidate.replace(/\s+/g, ' ').trim() : '';
    if (value && value.length <= maxLength) return value;
  }
  for (const candidate of [sourceTitle, title]) {
    if (!candidate) continue;
    try {
      const value = fallbackThumbnailHeadline(candidate);
      if (value && value.length <= maxLength) return value;
    } catch { /* Try the next source; never submit a clipped unsupported claim. */ }
  }
  throw Object.assign(new Error('título fiel dentro do limite não pôde ser determinado'), { code: 'PUBLICATION_TITLE_UNAVAILABLE' });
}

function buildShortsTitle({ title, sourceTitle, partIndex, partCount, hashtags = '' } = {}) {
  const prefix = Number.isInteger(partIndex) && Number.isInteger(partCount) ? `Parte ${partIndex}/${partCount} | ` : '';
  const required = ' #shorts';
  const available = 100 - prefix.length - required.length;
  const base = resolvePublicationTitle({ title, sourceTitle, maxLength: Math.min(100, available) });
  const extra = String(hashtags).trim().split(/\s+/).filter(tag => /^#[\p{L}\p{N}_]+$/u.test(tag)
    && tag.toLowerCase() !== '#shorts');
  let result = `${prefix}${base}`;
  for (const tag of extra) if (result.length + 1 + tag.length + required.length <= 100) result += ` ${tag}`;
  return result + required;
}

module.exports = { buildShortsTitle, resolvePublicationTitle };
