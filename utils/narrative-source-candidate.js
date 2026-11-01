'use strict';

const { countWords, DEFAULT_MINIMUM_CONTEXT_CHARS } = require('./source-evidence');

function candidateReferences(candidate) {
  return [
    ...(Array.isArray(candidate?.corroboratingArticles) ? candidate.corroboratingArticles : []),
    ...(Array.isArray(candidate?.publisherArticles) ? candidate.publisherArticles : []),
    candidate
  ].map(reference => ({
    url: String(reference?.url || reference?.link || '').trim(),
    publisherUrl: String(reference?.publisherUrl || candidate?.publisherUrl || '').trim(),
    source: String(reference?.source || candidate?.source || '').trim()
  })).filter(reference => /^https?:\/\//i.test(reference.url));
}

/** Finds a fresh candidate whose primary article contains enough text for narration. */
async function findNarrativeReadyCandidate(candidates, {
  resolveGoogleNewsUrl,
  extractArticleContext,
  maxFetches = 4,
  minimumWords = 150,
  minimumChars = DEFAULT_MINIMUM_CONTEXT_CHARS
} = {}) {
  if (typeof resolveGoogleNewsUrl !== 'function') throw new TypeError('resolver de URL obrigatório');
  if (typeof extractArticleContext !== 'function') throw new TypeError('extrator do artigo obrigatório');
  if (!Number.isSafeInteger(maxFetches) || maxFetches < 1) throw new RangeError('maxFetches inválido');
  if (!Number.isSafeInteger(minimumWords) || minimumWords < 1) throw new RangeError('minimumWords inválido');

  let fetches = 0;
  const visitedUrls = new Set();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    for (const reference of candidateReferences(candidate)) {
      if (fetches >= maxFetches) return { candidate: null, fetches, reason: 'fetch_limit' };
      let url = reference.url;
      if (/^https?:\/\/(?:[^/]+\.)?news\.google\.com\//i.test(url)) {
        url = await resolveGoogleNewsUrl(url, reference.publisherUrl);
      }
      if (!/^https?:\/\//i.test(String(url || '')) || visitedUrls.has(url)) continue;
      visitedUrls.add(url);
      fetches++;
      const context = String(await extractArticleContext(url) || '').replace(/\s+/g, ' ').trim();
      const words = countWords(context);
      if (context.length >= minimumChars && words >= minimumWords) {
        return {
          candidate,
          url,
          source: reference.source || candidate.source || '',
          context,
          contextWords: words,
          fetches
        };
      }
    }
  }
  return { candidate: null, fetches, reason: 'no_narration_length_source' };
}

module.exports = { candidateReferences, findNarrativeReadyCandidate };
