'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { findNarrativeReadyCandidate } = require('../utils/narrative-source-candidate');

test('skips a headline-only page and chooses the next distinct article with enough source context', async () => {
  const candidates = [
    { title: 'Headline only', url: 'https://publisher.example/short', source: 'Publisher A' },
    { title: 'Another source-backed story', url: 'https://publisher.example/full', source: 'Publisher B' }
  ];
  const result = await findNarrativeReadyCandidate(candidates, {
    resolveGoogleNewsUrl: async url => url,
    extractArticleContext: async url => url.endsWith('/short') ? 'Título e resumo curto.' : `${'Fato sustentado pela reportagem. '.repeat(60)}`
  });
  assert.equal(result.candidate, candidates[1]);
  assert.equal(result.url, 'https://publisher.example/full');
  assert.ok(result.contextWords >= 150);
  assert.equal(result.fetches, 2);
});

test('long-form source selection can require enough evidence for a six-minute narration', async () => {
  const candidates = [
    { title: 'Short notice', url: 'https://publisher.example/notice', source: 'Publisher A' },
    { title: 'Detailed topic', url: 'https://publisher.example/detailed', source: 'Publisher B' }
  ];
  const result = await findNarrativeReadyCandidate(candidates, {
    resolveGoogleNewsUrl: async url => url,
    extractArticleContext: async url => url.endsWith('/notice')
      ? 'Fato verificável publicado pela fonte. '.repeat(100)
      : 'Fato verificável publicado pela fonte apresenta dados e contexto adicional. '.repeat(140),
    minimumWords: 945,
    maxFetches: 4
  });
  assert.equal(result.candidate, candidates[1]);
  assert.ok(result.contextWords >= 945);
  assert.equal(result.fetches, 2);
});

test('resolves Google News wrappers only through the named publisher and keeps the source identity', async () => {
  const candidate = {
    title: 'Primary story',
    publisherUrl: 'https://publisher.example/story',
    publisherArticles: [{ url: 'https://news.google.com/rss/articles/abc', publisherUrl: 'https://publisher.example/story', source: 'Publisher' }]
  };
  let resolved = false;
  const result = await findNarrativeReadyCandidate([candidate], {
    resolveGoogleNewsUrl: async (url, publisherUrl) => {
      resolved = url.includes('news.google.com') && publisherUrl === 'https://publisher.example/story';
      return 'https://publisher.example/story';
    },
    extractArticleContext: async () => `${'Texto primário verificável. '.repeat(60)}`
  });
  assert.equal(resolved, true);
  assert.equal(result.url, 'https://publisher.example/story');
  assert.equal(result.source, 'Publisher');
});

test('fails closed when all extracted article contexts are too short', async () => {
  const result = await findNarrativeReadyCandidate([
    { title: 'Short', url: 'https://publisher.example/short' }
  ], {
    resolveGoogleNewsUrl: async url => url,
    extractArticleContext: async () => 'Texto insuficiente.'
  });
  assert.equal(result.candidate, null);
  assert.equal(result.reason, 'no_narration_length_source');
});

test('searches beyond the first four sources before rejecting a short-context theme cycle', async () => {
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    title: `Story ${index}`,
    url: `https://publisher.example/story-${index}`,
    source: `Publisher ${index}`
  }));
  const result = await findNarrativeReadyCandidate(candidates, {
    maxFetches: 8,
    resolveGoogleNewsUrl: async url => url,
    extractArticleContext: async url => url.endsWith('story-5')
      ? `${'Informação primária sustentada pela reportagem. '.repeat(45)}`
      : 'Título e resumo curtos.'
  });
  assert.equal(result.candidate, candidates[5]);
  assert.equal(result.fetches, 6);
  assert.ok(result.contextWords >= 150);
});

test('does not fetch the same resolved article more than once across candidate records', async () => {
  const duplicate = 'https://publisher.example/shared-story';
  const candidates = [
    { title: 'First reference', url: duplicate },
    { title: 'Duplicate reference', url: duplicate },
    { title: 'Distinct reference', url: 'https://publisher.example/other-story' }
  ];
  const fetched = [];
  const result = await findNarrativeReadyCandidate(candidates, {
    maxFetches: 2,
    resolveGoogleNewsUrl: async url => url,
    extractArticleContext: async url => {
      fetched.push(url);
      return url.endsWith('other-story') ? `${'Texto primário verificável. '.repeat(60)}` : 'Resumo curto.';
    }
  });
  assert.equal(result.candidate, candidates[2]);
  assert.equal(result.fetches, 2);
  assert.deepEqual(fetched, [duplicate, 'https://publisher.example/other-story']);
});
