'use strict';

const assert = require('node:assert/strict');
const { TextEncoder } = require('node:util');
const { ReadableStream } = require('node:stream/web');
const test = require('node:test');
const { auditThemeFeeds, collectConfiguredFeeds, parseFeedSample } = require('../utils/theme-feed-audit');

function response(status, body, contentType = 'application/rss+xml') {
  return {
    status,
    headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
    body: body == null ? null : new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      }
    })
  };
}

test('feed audit deduplicates URLs, preserves theme provenance, and reads only bounded RSS metadata', async () => {
  const xml = '<?xml version="1.0"?><rss version="2.0"><channel><title>Fonte teste</title><language>pt-BR</language><item><title>Notícia</title><pubDate>Tue, 13 Oct 2026 20:00:00 GMT</pubDate></item></channel></rss>';
  const themes = [
    { id: 'ia', feeds: [['Fonte A', 'https://feeds.test/ia.xml']] },
    { id: 'fitness', feeds: [['Fonte B', 'https://feeds.test/shared.xml']] },
    { id: 'saude', feeds: [['Fonte B', 'https://feeds.test/shared.xml']] }
  ];
  const requested = [];
  const report = await auditThemeFeeds({
    themes,
    fetchImpl: async (url, options) => {
      requested.push({ url, options });
      return response(206, xml, 'application/xml; charset=utf-8');
    },
    now: () => new Date('2026-10-13T21:00:00.000Z'),
    maxSampleBytes: 2048,
    concurrency: 2
  });

  assert.equal(report.checkedAt, '2026-10-13T21:00:00.000Z');
  assert.equal(report.feedCount, 2);
  assert.equal(report.validCount, 2);
  assert.equal(report.failedCount, 0);
  assert.equal(requested.length, 2);
  assert.ok(requested.every(request => request.options.headers.Range === 'bytes=0-2047'));
  const shared = report.feeds.find(feed => feed.url.endsWith('/shared.xml'));
  assert.deepEqual(shared.themes, ['fitness', 'saude']);
  assert.deepEqual(shared.sources, ['Fonte B']);
  assert.equal(shared.declaredLanguage, 'pt-BR');
  assert.equal(shared.title, 'Fonte teste');
  assert.equal(shared.httpStatus, 206);
  assert.equal(shared.state, 'valid_xml');
});

test('feed audit distinguishes HTTP, empty, malformed, invalid-URL, and request failures', async () => {
  const themes = [{ id: 'test', feeds: [
    ['404', 'https://feeds.test/missing.xml'],
    ['empty', 'https://feeds.test/empty.xml'],
    ['html', 'https://feeds.test/html.xml'],
    ['network', 'https://feeds.test/network.xml'],
    ['insecure', 'http://feeds.test/insecure.xml']
  ] }];
  let fetchCount = 0;
  const report = await auditThemeFeeds({
    themes,
    fetchImpl: async url => {
      fetchCount++;
      if (url.endsWith('/missing.xml')) return response(404, '<html>missing</html>', 'text/html');
      if (url.endsWith('/empty.xml')) return response(204, null, null);
      if (url.endsWith('/html.xml')) return response(200, '<html><body>not RSS</body></html>', 'text/html');
      throw new Error('synthetic network failure');
    }
  });
  const stateByUrl = new Map(report.feeds.map(feed => [feed.url, feed.state]));

  assert.equal(report.feedCount, 5);
  assert.equal(report.validCount, 0);
  assert.equal(report.failedCount, 5);
  assert.equal(fetchCount, 4, 'non-HTTPS configuration must not make a request');
  assert.equal(stateByUrl.get('https://feeds.test/missing.xml'), 'http_404');
  assert.equal(stateByUrl.get('https://feeds.test/empty.xml'), 'invalid_feed_body');
  assert.equal(stateByUrl.get('https://feeds.test/html.xml'), 'invalid_feed_body');
  assert.equal(stateByUrl.get('https://feeds.test/network.xml'), 'request_error');
  assert.equal(stateByUrl.get('http://feeds.test/insecure.xml'), 'invalid_url');
});

test('feed audit redacts credential-like URL data and network errors from its report', async () => {
  const requested = [];
  const secretUrl = 'https://feeds.test/rss.xml?edition=uk&access_token=query-secret&X_API-Key=second-secret#private-fragment';
  const report = await auditThemeFeeds({
    themes: [{ id: 'ia', feeds: [['Private feed', secretUrl]] }],
    fetchImpl: async url => {
      requested.push(url);
      throw new Error(`request failed for ${url} with password=error-secret`);
    }
  });

  assert.deepEqual(requested, ['https://feeds.test/rss.xml?edition=uk&access_token=query-secret&X_API-Key=second-secret']);
  assert.equal(report.feeds[0].state, 'request_error');
  assert.match(report.feeds[0].url, /edition=uk/);
  assert.doesNotMatch(JSON.stringify(report), /query-secret|second-secret|error-secret|private-fragment/);
  assert.match(report.feeds[0].url, /access_token=%5BREDACTED%5D/);
  assert.match(report.feeds[0].url, /X_API-Key=%5BREDACTED%5D/);
});

test('feed audit rejects URL credentials before making a request and redacts malformed URLs', async () => {
  let fetchCount = 0;
  const report = await auditThemeFeeds({
    themes: [{ id: 'private', feeds: [
      ['credential URL', 'https://feed-user:feed-password@feeds.test/rss.xml'],
      ['malformed URL', 'not-a-url?token=unparseable-secret']
    ] }],
    fetchImpl: async () => { fetchCount++; return response(200, '<rss></rss>'); }
  });

  assert.equal(fetchCount, 0);
  assert.equal(report.failedCount, 2);
  assert.ok(report.feeds.every(feed => feed.state === 'invalid_url'));
  assert.equal(report.feeds.find(feed => feed.sources[0] === 'credential URL').url, 'https://feeds.test/rss.xml');
  assert.equal(report.feeds.find(feed => feed.sources[0] === 'malformed URL').url, '[invalid URL]');
  assert.doesNotMatch(JSON.stringify(report), /feed-user|feed-password|unparseable-secret/);
});

test('feed parser accepts RSS and Atom language metadata without parsing article content', () => {
  assert.deepEqual(parseFeedSample('<feed xml:lang="en-US"><title>Atom source</title></feed>'), {
    isXml: true,
    title: 'Atom source',
    declaredLanguage: 'en-US',
    latestItemDate: null
  });
  assert.equal(parseFeedSample('<!doctype html><html><body><rss>not a feed</rss></body></html>').isXml, false);
  assert.deepEqual(collectConfiguredFeeds([{ id: 'bad', feeds: [['bad url', 'not a URL']] }])[0].configuredUrlError, 'feed URL is invalid');
});
