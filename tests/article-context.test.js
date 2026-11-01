'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractArticleContext, extractTextFromHtml, extractArticlePublishedAt } = require('../utils/article-context');

test('publisher publication metadata wins over an update date and arbitrary dates in the body', () => {
  const html = '<meta itemprop="datePublished" content="2026-07-17T15:41:18-03:00"><meta itemprop="dateModified" content="2026-10-17T20:00:00-03:00"><p>2026-10-17T20:00:00Z</p>';
  assert.equal(extractArticlePublishedAt(html), '2026-07-17T18:41:18.000Z');
  assert.equal(extractArticlePublishedAt('<meta itemprop="dateModified" content="2026-10-17T20:00:00Z">'), null);
  assert.equal(extractArticlePublishedAt('<meta itemprop="datePublished" content="2026-10-17T20:00:00">'), null);
  assert.equal(extractArticlePublishedAt('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-17T20:00:00Z"}</script>'), '2026-10-17T20:00:00.000Z');
});

test('text and publication date are read from the same bounded source request', async () => {
  let calls = 0;
  let publicationDate;
  const text = 'A fonte descreve o resultado e explicita os seus limites. '.repeat(8);
  const context = await extractArticleContext('https://example.test/article', {
    fetchImpl: async () => { calls++; return new globalThis.Response(`<meta property="article:published_time" content="2026-07-17T18:41:18Z"><article><p>${text}</p></article>`, { headers: { 'content-type': 'text/html' } }); },
    onPublicationDate: value => { publicationDate = value; }
  });
  assert.equal(calls, 1);
  assert.equal(publicationDate, '2026-07-17T18:41:18.000Z');
  assert(context.startsWith('A fonte descreve'));
});

test('article context prefers structured article body and removes markup', () => {
  const body = 'A reportagem explica que a tecnologia avançou em pesquisa aplicada e apresenta dados verificáveis. '.repeat(8);
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'NewsArticle', articleBody: body
  })}</script></head><body><nav>Menu que não deve aparecer</nav><article><p>Texto breve.</p></article></body></html>`;
  const context = extractTextFromHtml(html);

  assert.ok(context.length > 300);
  assert.ok(context.startsWith('A reportagem explica'));
  assert.doesNotMatch(context, /Menu que não deve aparecer/);
});

test('article context falls back to page paragraphs when semantic regions are recommendation cards', () => {
  const body = 'A reportagem apresenta fatos verificáveis e descreve as consequências para as pessoas afetadas. '.repeat(6);
  const html = `<html><body><main><article><p>Recomendação editorial com um pequeno resumo desta outra notícia.</p></article></main><div class="post-content"><p>${body}</p></div></body></html>`;
  const context = extractTextFromHtml(html);

  assert.ok(context.length > 300);
  assert.ok(context.includes('A reportagem apresenta fatos verificáveis'));
});

test('article context refuses image responses such as Googleusercontent thumbnails', async () => {
  const context = await extractArticleContext('https://lh3.googleusercontent.com/photo.png', {
    fetchImpl: async () => new globalThis.Response('binary image', {
      headers: { 'content-type': 'image/png' }, status: 200
    })
  });

  assert.equal(context, '');
});

test('article context aborts slow source requests and returns no unverified text', async () => {
  let aborted = false;
  const context = await extractArticleContext('https://publisher.example.com/news/story', {
    timeoutMs: 10,
    fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
      setTimeout(() => {
        aborted = signal.aborted;
        reject(signal.reason || new Error('request timeout'));
      }, 25);
    })
  });

  assert.equal(context, '');
  assert.equal(aborted, true);
});
