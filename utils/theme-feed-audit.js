'use strict';

const { TextDecoder } = require('node:util');

const DEFAULT_MAX_SAMPLE_BYTES = 65536;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CONCURRENCY = 4;
const PRIVATE_QUERY_NAMES = new Set([
  'access_token', 'api_key', 'apikey', 'auth', 'authorization', 'chat_id', 'client_secret',
  'credential', 'key', 'password', 'refresh_token', 'secret', 'sig', 'signature', 'token'
]);

function isPrivateQueryName(name) {
  const normalized = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return PRIVATE_QUERY_NAMES.has(normalized)
    || normalized.split('_').some(part => PRIVATE_QUERY_NAMES.has(part));
}

function safeReportUrl(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const name of new Set(url.searchParams.keys())) {
      if (isPrivateQueryName(name)) url.searchParams.set(name, '[REDACTED]');
    }
    return url.href;
  } catch (_error) {
    return '[invalid URL]';
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function collectConfiguredFeeds(themes) {
  const feeds = new Map();
  for (const theme of Array.isArray(themes) ? themes : []) {
    for (const entry of Array.isArray(theme.feeds) ? theme.feeds : []) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [source, rawUrl] = entry;
      let url;
      let configuredUrlError = null;
      let normalizedUrl = String(rawUrl || '').trim();
      try {
        url = new URL(rawUrl);
        if (url.protocol !== 'https:') configuredUrlError = 'feed URL must use HTTPS';
        else if (url.username || url.password) configuredUrlError = 'feed URL credentials are not allowed';
        else {
          url.hash = '';
          normalizedUrl = url.href;
        }
      } catch (_error) {
        configuredUrlError = 'feed URL is invalid';
      }
      const key = configuredUrlError ? `${theme.id || 'unknown'}|${source || 'unknown'}|${normalizedUrl}` : normalizedUrl;
      const feed = feeds.get(key) || { url: normalizedUrl, sources: [], themes: [], ...(configuredUrlError ? { configuredUrlError } : {}) };
      if (typeof source === 'string' && source.trim() && !feed.sources.includes(source.trim())) {
        feed.sources.push(source.trim());
      }
      if (typeof theme.id === 'string' && theme.id.trim() && !feed.themes.includes(theme.id.trim())) {
        feed.themes.push(theme.id.trim());
      }
      feeds.set(key, feed);
    }
  }
  return [...feeds.values()].sort((left, right) => left.url.localeCompare(right.url));
}

async function readBoundedSample(response, maxBytes) {
  if (!response.body?.getReader) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';
  try {
    while (bytesRead < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytesRead;
      const chunk = value.subarray(0, remaining);
      bytesRead += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
      if (chunk.byteLength < value.byteLength || bytesRead >= maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function parseFeedSample(sample) {
  const text = String(sample || '').replace(/^\uFEFF/, '').trimStart();
  const isXml = /^<\?xml\b[^>]*>\s*/i.test(text)
    ? /^(?:<!DOCTYPE[^>]*>\s*)?<(?:rss|rdf:RDF|feed)\b/i.test(text.replace(/^<\?xml\b[^>]*>\s*/i, ''))
    : /^(?:<!DOCTYPE[^>]*>\s*)?<(?:rss|rdf:RDF|feed)\b/i.test(text);
  if (!isXml) return { isXml: false, title: null, declaredLanguage: null, latestItemDate: null };

  const language = text.match(/<language(?:\s[^>]*)?>([\s\S]*?)<\/language>/i)
    || text.match(/xml:lang=["']([^"']+)["']/i);
  const title = text.match(/<(?:channel|feed)\b[^>]*>[\s\S]*?<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i);
  const item = text.match(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/i)?.[1] || '';
  const date = item.match(/<(?:pubDate|published|updated)(?:\s[^>]*)?>([\s\S]*?)<\/(?:pubDate|published|updated)>/i);
  const clean = value => value?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim() || null;
  return {
    isXml: true,
    title: clean(title),
    declaredLanguage: clean(language),
    latestItemDate: clean(date)
  };
}

async function auditThemeFeeds({
  themes,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxSampleBytes = DEFAULT_MAX_SAMPLE_BYTES,
  concurrency = DEFAULT_CONCURRENCY
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('auditThemeFeeds exige fetch');
  const targets = collectConfiguredFeeds(themes);
  const queue = [...targets];
  const results = [];
  const limit = positiveInteger(concurrency, DEFAULT_CONCURRENCY);
  const timeout = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
  const sampleLimit = positiveInteger(maxSampleBytes, DEFAULT_MAX_SAMPLE_BYTES);

  async function worker() {
    while (queue.length) {
      const target = queue.shift();
      if (!target) return;
      if (target.configuredUrlError) {
        results.push({
          ...target,
          url: safeReportUrl(target.url),
          state: 'invalid_url',
          httpStatus: null,
          contentType: null,
          sampleBytes: 0,
          isXml: false,
          title: null,
          declaredLanguage: null,
          latestItemDate: null
        });
        continue;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetchImpl(target.url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
            Range: `bytes=0-${sampleLimit - 1}`,
            'User-Agent': 'youtube-ai-feed-audit/1.0 (read-only health check)'
          }
        });
        const sample = await readBoundedSample(response, sampleLimit);
        const parsed = parseFeedSample(sample);
        const state = response.status >= 200 && response.status < 300 && parsed.isXml
          ? 'valid_xml'
          : response.status < 200 || response.status >= 300
            ? `http_${response.status}`
            : 'invalid_feed_body';
        results.push({
          ...target,
          url: safeReportUrl(target.url),
          state,
          httpStatus: response.status,
          contentType: response.headers.get('content-type')?.split(';')[0] || null,
          sampleBytes: Buffer.byteLength(sample),
          ...parsed
        });
      } catch (error) {
        results.push({
          ...target,
          url: safeReportUrl(target.url),
          state: controller.signal.aborted ? 'timeout' : 'request_error',
          httpStatus: null,
          contentType: null,
          sampleBytes: 0,
          isXml: false,
          title: null,
          declaredLanguage: null,
          latestItemDate: null
        });
      } finally {
        clearTimeout(timer);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
  results.sort((left, right) => left.url.localeCompare(right.url));
  const validCount = results.filter(result => result.state === 'valid_xml').length;
  return {
    checkedAt: now().toISOString(),
    readOnly: true,
    maxSampleBytes: sampleLimit,
    feedCount: results.length,
    validCount,
    failedCount: results.length - validCount,
    feeds: results
  };
}

module.exports = { auditThemeFeeds, collectConfiguredFeeds, parseFeedSample };
