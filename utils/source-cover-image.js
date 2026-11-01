'use strict';

const sharp = require('sharp');
const { decodeHtmlEntities } = require('./article-context');
const { fetchWithTimeout } = require('./fetch-with-timeout');
const { readBoundedResponseText } = require('./news-hunter');

// This provider is intentionally restricted to the publisher and its image
// hosts. Do not fetch arbitrary destinations found in an article's HTML.
const ARTICLE_HOSTS = new Set(['www.terra.com.br', 'terra.com.br']);
const IMAGE_HOSTS = new Set(['images.terra.com', 'p2.trrsf.com']);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function trustedUrl(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.has(url.hostname)
      ? url : null;
  } catch { return null; }
}

function extractCoverImageUrl(html) {
  for (const match of String(html || '').matchAll(/<meta\b([^>]+)>/gi)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
      .map(attribute => [attribute[1].toLowerCase(), decodeHtmlEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? '')]));
    if (String(attrs.property || attrs.name || '').toLowerCase() !== 'og:image') continue;
    const url = trustedUrl(attrs.content, IMAGE_HOSTS);
    if (!url) continue;
    // Terra's transformed preview crops source images; the original hosted by
    // the publisher preserves the whole product or scene for both formats.
    const original = url.hostname === 'p2.trrsf.com' && url.pathname.match(/\/images\.terra\.com\/(.+)$/);
    return original ? `https://images.terra.com/${original[1]}` : url.href;
  }
  return null;
}

function extractImageCredit(html, imageUrl) {
  const filename = new URL(imageUrl).pathname.split('/').pop();
  if (!filename) return '';
  for (const match of String(html || '').matchAll(/<img\b([^>]+)>/gi)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
      .map(attribute => [attribute[1].toLowerCase(), decodeHtmlEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? '')]));
    if (!String(attrs.src || '').includes(filename)) continue;
    const credit = String(attrs.alt || '').match(/\b(?:foto|imagem):\s*([^—|]+)/i)?.[1]?.trim();
    if (credit) return credit.slice(0, 160);
  }
  return '';
}

async function readBoundedBytes(response, maximum) {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > maximum) throw new Error('imagem de fonte excede limite');
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximum) throw new Error('imagem de fonte excede limite');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maximum) throw new Error('imagem de fonte excede limite');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

async function fetchSourceCoverImage(articleUrl, { fetchImpl = globalThis.fetch } = {}) {
  const article = trustedUrl(articleUrl, ARTICLE_HOSTS);
  if (!article) return null;
  try {
    const options = { redirect: 'error', headers: { 'User-Agent': 'Mozilla/5.0 Pulso editorial' } };
    const page = await fetchWithTimeout(article.href, options, 15000, fetchImpl);
    if (!page.ok || !/html/i.test(String(page.headers?.get?.('content-type') || ''))) return null;
    const html = await readBoundedResponseText(page, 3 * 1024 * 1024);
    const imageUrl = extractCoverImageUrl(html);
    if (!imageUrl || !trustedUrl(imageUrl, IMAGE_HOSTS)) return null;
    const image = await fetchWithTimeout(imageUrl, options, 15000, fetchImpl);
    if (!image.ok || !/^image\/(jpeg|png|webp)(?:;|$)/i.test(String(image.headers?.get?.('content-type') || ''))) return null;
    const bytes = await readBoundedBytes(image, MAX_IMAGE_BYTES);
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || metadata.width < 400 || metadata.height < 400) return null;
    return { sourceUrl: imageUrl, articleUrl: article.href, credit: extractImageCredit(html, imageUrl), bytes,
      dataUrl: `data:image/${metadata.format};base64,${bytes.toString('base64')}` };
  } catch { return null; }
}

module.exports = { extractCoverImageUrl, extractImageCredit, fetchSourceCoverImage, readBoundedBytes, trustedUrl };
