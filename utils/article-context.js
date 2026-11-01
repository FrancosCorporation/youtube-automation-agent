'use strict';

const { fetchWithTimeout } = require('./fetch-with-timeout');
const { readBoundedResponseText } = require('./news-hunter');

const ARTICLE_FETCH_TIMEOUT_MS = 15 * 1000;
const MAX_ARTICLE_RESPONSE_BYTES = 3 * 1024 * 1024;
const MAX_ARTICLE_CONTEXT_CHARS = 8000;
const ARTICLE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
  Accept: 'text/html,application/xhtml+xml'
};
const HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®',
  ccedil: 'ç', atilde: 'ã', otilde: 'õ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú'
};

function decodeHtmlEntities(value) {
  return String(value || '').replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z][\da-z]{1,31});/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hexadecimal = entity[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return ' ';
      try { return String.fromCodePoint(codePoint); } catch { return ' '; }
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function stripMarkup(value) {
  return decodeHtmlEntities(String(value || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[\u00a0\u200b\u200c\u200d]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function walkArticleBodies(value, output, depth = 0) {
  if (depth > 8 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) walkArticleBodies(item, output, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const type = value['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some(item => ['article', 'newsarticle', 'reportage', 'blogposting'].includes(String(item || '').toLowerCase()))
      && typeof value.articleBody === 'string') {
    output.push(stripMarkup(value.articleBody));
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'articleBody') continue;
    walkArticleBodies(child, output, depth + 1);
  }
}

function extractTextFromHtml(html) {
  const source = String(html || '');
  const structuredBodies = [];
  const jsonLd = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = jsonLd.exec(source))) {
    try { walkArticleBodies(JSON.parse(match[1].trim()), structuredBodies); } catch { /* malformed third-party metadata */ }
  }

  const articleRegions = [];
  const regionPattern = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  while ((match = regionPattern.exec(source))) articleRegions.push(match[2]);
  const contentHtml = articleRegions.sort((a, b) => b.length - a.length)[0] || source;
  function readParagraphs(html) {
    const paragraphs = [];
    const paragraphPattern = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi;
    let paragraphMatch;
    while ((paragraphMatch = paragraphPattern.exec(html))) {
      const paragraph = stripMarkup(paragraphMatch[1]);
      if (paragraph.length > 40) paragraphs.push(paragraph);
    }
    return paragraphs;
  }
  let paragraphs = readParagraphs(contentHtml);
  // Some publishers place the article body outside <article>/<main>, while
  // using those elements for related-story cards. Only fall back to the full
  // page when the selected semantic region contains too little usable text.
  if (paragraphs.join(' ').length < 300 && contentHtml !== source) paragraphs = readParagraphs(source);

  const metadata = [];
  const metaPattern = /<meta\b([^>]+)>/gi;
  while ((match = metaPattern.exec(source))) {
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
      .map(attribute => [attribute[1].toLowerCase(), decodeHtmlEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? '')]));
    const key = String(attributes.property || attributes.name || '').toLowerCase();
    if (['og:description', 'twitter:description', 'description'].includes(key) && attributes.content) {
      const description = stripMarkup(attributes.content);
      if (description.length > 40) metadata.push(description);
    }
  }

  const candidates = [...structuredBodies, ...paragraphs, ...metadata];
  const seen = new Set();
  return candidates.filter(text => {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_ARTICLE_CONTEXT_CHARS);
}

function extractArticlePublishedAt(html) {
  const source = String(html || '');
  const parseDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  };
  const visit = (value, depth = 0) => {
    if (!value || depth > 8) return null;
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1)).find(Boolean) || null;
    if (typeof value !== 'object') return null;
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.some(type => /^(?:NewsArticle|Article|BlogPosting|Reportage)$/i.test(type || ''))) {
      const date = parseDate(value.datePublished);
      if (date) return date;
    }
    return Object.values(value).map(child => visit(child, depth + 1)).find(Boolean) || null;
  };
  for (const match of source.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { const date = visit(JSON.parse(match[1])); if (date) return date; }
    catch { /* Inspect the publisher's standard metadata instead. */ }
  }
  const dates = new Map();
  for (const match of source.matchAll(/<meta\b([^>]+)>/gi)) {
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
      .map(item => [item[1].toLowerCase(), decodeHtmlEntities(item[2] ?? item[3] ?? '')]));
    const key = String(attributes.itemprop || attributes.property || attributes.name || '').toLowerCase();
    const date = parseDate(attributes.content);
    if (date) dates.set(key, date);
  }
  for (const key of ['datepublished', 'article:published_time', 'publish-date', 'pubdate', 'dc.date.issued']) {
    if (dates.has(key)) return dates.get(key);
  }
  return null;
}

async function extractArticleContext(url, {
  fetchImpl = globalThis.fetch,
  timeoutMs = ARTICLE_FETCH_TIMEOUT_MS,
  maxBytes = MAX_ARTICLE_RESPONSE_BYTES,
  onPublicationDate
} = {}) {
  try {
    const response = await fetchWithTimeout(url, { headers: ARTICLE_HEADERS }, timeoutMs, fetchImpl);
    if (!response.ok) return '';
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('html') && !contentType.includes('xhtml')) return '';
    const html = await readBoundedResponseText(response, maxBytes);
    onPublicationDate?.(extractArticlePublishedAt(html));
    return extractTextFromHtml(html);
  } catch {
    return '';
  }
}

module.exports = { ARTICLE_FETCH_TIMEOUT_MS, MAX_ARTICLE_RESPONSE_BYTES, decodeHtmlEntities, extractArticleContext, extractTextFromHtml, extractArticlePublishedAt };
