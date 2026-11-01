'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EMPTY_CONTEXT_SHA256, matchScriptCache, publisherOrigin, resolveOwnerSource, recoverBacklogSources } = require('../scripts/recover-backlog-sources');

test('source recovery uses an allowlisted publisher and keeps aggregator origin separate', async () => {
  let resolutionRequest;
  let fetchedUrl;
  const result = await resolveOwnerSource({
    owner: { title: 'Story', sourceName: 'G1', originTitle: 'Publisher headline',
      originUrl: 'https://news.google.com/rss/articles/id' },
    resolveUrl: async (...args) => { resolutionRequest = args; return 'https://g1.globo.com/story'; },
    fetchArticleContext: async (url, options) => {
      fetchedUrl = url;
      options.onPublicationDate('2026-10-20T10:00:00Z');
      return 'Texto primário da reportagem. '.repeat(30);
    }
  });

  assert.equal(resolutionRequest[0], 'https://news.google.com/rss/articles/id');
  assert.equal(resolutionRequest[1], 'https://g1.globo.com/');
  assert.equal(fetchedUrl, 'https://g1.globo.com/story');
  assert.equal(result.sourceUrl, 'https://g1.globo.com/story');
  assert.equal(result.originUrl, 'https://news.google.com/rss/articles/id');
  assert.equal(result.originTitle, 'Publisher headline');
  assert.equal(result.resolution, 'google_news_publisher_match');
  assert.equal(result.article.status, 'retrieved');
  assert.equal(result.article.publishedAt, '2026-10-20T10:00:00Z');
  assert.equal(result.article.contextWords, 120);
  assert.equal(result.article.meetsSourceEvidenceMinimum, true);
  assert.equal(result.article.meetsNarrationSourceMinimum, false);
  assert.match(result.article.contextSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(result.article, 'text'), false);
});

test('source recovery fails closed for an unknown publisher and retains a direct ledger URL', async () => {
  let requests = 0;
  const unknown = await resolveOwnerSource({
    owner: { sourceName: 'Google News (1 veículos)', originUrl: 'https://news.google.com/rss/articles/id' },
    resolveUrl: async () => { requests++; return 'https://publisher.example/story'; },
    fetchArticleContext: async () => { requests++; return 'should not run'; }
  });
  assert.equal(unknown.resolution, 'publisher_mapping_unavailable');
  assert.equal(unknown.sourceUrl, null);
  assert.equal(unknown.article, null);
  assert.equal(requests, 0);

  const direct = await resolveOwnerSource({
    owner: { sourceName: 'Unknown', sourceUrl: 'https://publisher.example/story' },
    resolveUrl: async () => { requests++; return ''; },
    fetchArticleContext: async () => ''
  });
  assert.equal(direct.resolution, 'ledger_direct_url');
  assert.equal(direct.sourceUrl, 'https://publisher.example/story');
  assert.equal(direct.article.status, 'unavailable');
  assert.equal(requests, 0);
});

test('script title candidates do not claim artifact lineage and expose empty-context review gaps', () => {
  const cache = {
    scriptPath: 'data/scripts/story-retention-emotions-v4-robot3d.json',
    metadataPath: 'data/scripts/story-retention-emotions-v4-robot3d.json.meta.json',
    topic: 'Headline from the publisher',
    scriptTitle: 'Generated short title',
    revision: 'retention-emotions-v4-robot3d',
    contextHash: EMPTY_CONTEXT_SHA256,
    createdAt: '2026-10-11T12:00:00.000Z'
  };
  const owner = { originTitle: 'Headline from the publisher - G1', title: 'Generated short title' };
  const result = matchScriptCache(owner, [cache]);
  assert.equal(result.status, 'candidate');
  assert.equal(result.matches[0].candidateBasis, 'origin_title_metadata');
  assert.equal(result.matches[0].contextEmpty, true);
  assert.equal(result.matches[0].reviewerPresent, false);
  assert.equal(matchScriptCache(owner, [cache, { ...cache, scriptPath: 'another.json' }]).status, 'ambiguous');
  assert.equal(matchScriptCache(owner, []).status, 'not_found');
});

test('source report includes hash-bound candidates and explicit totals', async () => {
  const result = await recoverBacklogSources({ scannedAt: '2026-10-21T19:00:00Z', files: [
    { path: 'a.mp4', currentSha256: 'a'.repeat(64), classification: 'qa_recovery_required', owners: [
      { title: 'Story', sourceName: 'G1', originUrl: 'https://news.google.com/rss/articles/id' }
    ] },
    { path: 'b.mp4', classification: 'publication_pending', owners: [{ sourceName: 'G1' }] }
  ] }, {
    resolvedAt: '2026-10-21T20:00:00Z',
    scriptCaches: [{
      scriptPath: 'data/scripts/story.json', metadataPath: 'data/scripts/story.json.meta.json',
      topic: 'Publisher headline', scriptTitle: 'Story', contextHash: EMPTY_CONTEXT_SHA256
    }],
    resolveUrl: async () => 'https://g1.globo.com/story',
    fetchArticleContext: async () => 'Artigo acessível.'
  });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].currentSha256, 'a'.repeat(64));
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.entries[0].scriptCache.status, 'candidate');
  assert.equal(result.entries[0].scriptCache.matches[0].contextEmpty, true);
  assert.deepEqual(result.totals, {
    candidates: 1,
    publisherUrlsResolved: 1,
    articleContextsRetrieved: 1,
    sourceEvidenceMinimumMet: 0,
    narrationSourceMinimumMet: 0,
    publisherMappingsUnavailable: 0,
    scriptCacheTitleCandidates: 1,
    scriptCacheCandidatesAmbiguous: 0,
    distinctScriptCacheTitleCandidates: 1,
    distinctCachesWithEmptyContext: 1,
    distinctCachesWithoutReviewer: 1
  });
  assert.equal(result.backlogReportScannedAt, '2026-10-21T19:00:00Z');
  assert.equal(publisherOrigin('G1'), 'https://g1.globo.com/');
  assert.equal(publisherOrigin('unknown'), null);
});
