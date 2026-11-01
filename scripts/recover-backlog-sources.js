#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { extractArticleContext } = require('../utils/article-context');
const { resolveGoogleNewsUrl } = require('../utils/news-hunter');
const { countWords, DEFAULT_MINIMUM_CONTEXT_CHARS, DEFAULT_MINIMUM_CONTEXT_WORDS, hashSourceContext } = require('../utils/source-evidence');

const ROOT = path.resolve(__dirname, '..');
const EMPTY_CONTEXT_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const PUBLISHER_ORIGINS = new Map([
  ['agência brasil', 'https://agenciabrasil.ebc.com.br/'],
  ['agencia brasil', 'https://agenciabrasil.ebc.com.br/'],
  ['csb central dos sindicat', 'https://csb.org.br/'],
  ['cnn brasil', 'https://www.cnnbrasil.com.br/'],
  ['globo', 'https://gshow.globo.com/'],
  ['g1', 'https://g1.globo.com/'],
  ['ig último segundo', 'https://ultimosegundo.ig.com.br/'],
  ['infomoney', 'https://www.infomoney.com.br/'],
  ['prefeitura de aracaju', 'https://www.aracaju.se.gov.br/'],
  ['prefeitura de manaus', 'https://www.manaus.am.gov.br/'],
  ['poder360', 'https://www.poder360.com.br/'],
  ['r7', 'https://noticias.r7.com/'],
  ['veja', 'https://veja.abril.com.br/']
]);

function publisherOrigin(sourceName) {
  return PUBLISHER_ORIGINS.get(String(sourceName || '').trim().toLocaleLowerCase('pt-BR')) || null;
}

function normalizeTitle(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim();
}

function titleAliases(value) {
  const title = String(value || '').trim();
  if (!title) return [];
  const aliases = new Set([normalizeTitle(title)]);
  const publisherSeparator = title.lastIndexOf(' - ');
  if (publisherSeparator > 0) aliases.add(normalizeTitle(title.slice(0, publisherSeparator)));
  return [...aliases].filter(Boolean);
}

function matchScriptCache(owner, scriptCaches = []) {
  const originTitles = new Set(titleAliases(owner?.originTitle));
  const generatedTitles = new Set(titleAliases(owner?.title));
  const matches = [];
  for (const cache of scriptCaches) {
    const topic = normalizeTitle(cache?.topic);
    const scriptTitle = normalizeTitle(cache?.scriptTitle);
    const candidateBasis = originTitles.has(topic) ? 'origin_title_metadata'
      : generatedTitles.has(scriptTitle) ? 'generated_title' : null;
    if (!candidateBasis) continue;
    matches.push({
      scriptPath: cache.scriptPath,
      metadataPath: cache.metadataPath,
      topic: cache.topic || null,
      scriptTitle: cache.scriptTitle || null,
      revision: cache.revision || null,
      contextHash: cache.contextHash || null,
      contextEmpty: cache.contextHash === EMPTY_CONTEXT_SHA256,
      reviewerPresent: Boolean(String(cache.reviewer || '').trim()),
      createdAt: cache.createdAt || null,
      candidateBasis
    });
  }
  return {
    status: matches.length === 1 ? 'candidate' : matches.length > 1 ? 'ambiguous' : 'not_found',
    matches
  };
}

async function loadScriptCacheIndex(directory = path.join(ROOT, 'data/scripts')) {
  const files = await fs.readdir(directory).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const caches = [];
  for (const file of files.filter(name => name.endsWith('-retention-emotions-v4-robot3d.json'))) {
    const scriptPath = path.join(directory, file);
    const metadataPath = `${scriptPath}.meta.json`;
    try {
      const [script, metadata] = await Promise.all([
        fs.readFile(scriptPath, 'utf8').then(JSON.parse),
        fs.readFile(metadataPath, 'utf8').then(JSON.parse)
      ]);
      caches.push({
        scriptPath: path.relative(ROOT, scriptPath),
        metadataPath: path.relative(ROOT, metadataPath),
        topic: metadata.topic,
        scriptTitle: script.title,
        revision: metadata.revision,
        contextHash: metadata.contextHash,
        reviewer: metadata.reviewer,
        createdAt: metadata.createdAt
      });
    } catch { /* Incomplete or corrupt caches cannot prove script lineage. */ }
  }
  return caches;
}

async function resolveOwnerSource({ owner, resolveUrl = resolveGoogleNewsUrl,
  fetchArticleContext = extractArticleContext } = {}) {
  const sourceName = typeof owner?.sourceName === 'string' ? owner.sourceName : null;
  const originUrl = typeof owner?.originUrl === 'string' ? owner.originUrl : null;
  const directLedgerUrl = typeof owner?.sourceUrl === 'string' ? owner.sourceUrl : null;
  let resolvedUrl = directLedgerUrl;
  let resolution = directLedgerUrl ? 'ledger_direct_url' : 'unresolved';

  if (!resolvedUrl && originUrl && publisherOrigin(sourceName)) {
    resolvedUrl = await resolveUrl(originUrl, publisherOrigin(sourceName), { timeoutMs: 15000 }) || '';
    if (resolvedUrl) resolution = 'google_news_publisher_match';
  } else if (!resolvedUrl && originUrl && !publisherOrigin(sourceName)) {
    resolution = 'publisher_mapping_unavailable';
  } else if (!originUrl && !resolvedUrl) {
    resolution = 'origin_url_missing';
  }

  let article = null;
  if (resolvedUrl) {
    let publishedAt = null;
    const context = await fetchArticleContext(resolvedUrl, {
      onPublicationDate: value => { publishedAt = value || null; }
    });
    const normalizedContext = String(context || '').trim();
    const contextWords = countWords(normalizedContext);
    article = {
      status: normalizedContext ? 'retrieved' : 'unavailable',
      publishedAt,
      contextChars: normalizedContext.length,
      contextWords,
      meetsSourceEvidenceMinimum: normalizedContext.length >= DEFAULT_MINIMUM_CONTEXT_CHARS
        && contextWords >= DEFAULT_MINIMUM_CONTEXT_WORDS,
      meetsNarrationSourceMinimum: normalizedContext.length >= DEFAULT_MINIMUM_CONTEXT_CHARS && contextWords >= 150,
      contextSha256: normalizedContext ? hashSourceContext(normalizedContext) : null
    };
  }

  return {
    title: typeof owner?.title === 'string' ? owner.title : null,
    originTitle: typeof owner?.originTitle === 'string' ? owner.originTitle : null,
    sourceName,
    sourceUrl: resolvedUrl || null,
    originUrl,
    resolution,
    article
  };
}

async function recoverBacklogSources(report, { resolveUrl, fetchArticleContext, concurrency = 3,
  resolvedAt = new Date().toISOString(), scriptCaches = [] } = {}) {
  if (!Array.isArray(report?.files)) throw new TypeError('Backlog report must contain a files array');
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new TypeError('Concurrency must be an integer from 1 through 8');
  }
  const candidates = report.files.flatMap(row => {
    if (!['qa_recovery_required', 'publication_eligibility_review_required'].includes(row.classification)) return [];
    return (row.owners || []).map(owner => ({ path: row.path, currentSha256: row.currentSha256,
      classification: row.classification, owner }));
  });
  const rows = new Array(candidates.length);
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const index = cursor++;
      const item = candidates[index];
      const source = await resolveOwnerSource({ owner: item.owner, resolveUrl, fetchArticleContext });
      rows[index] = {
        path: item.path,
        currentSha256: item.currentSha256 || null,
        classification: item.classification,
        scriptCache: matchScriptCache(item.owner, scriptCaches),
        ...source
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  const uniqueCaches = new Map(rows.flatMap(row => row.scriptCache.matches)
    .filter(cache => cache.scriptPath).map(cache => [cache.scriptPath, cache]));
  const distinctCaches = [...uniqueCaches.values()];
  return {
    schemaVersion: 2,
    resolvedAt,
    backlogReportScannedAt: report.scannedAt || null,
    criteria: {
      sourceEvidenceMinimum: {
        contextChars: DEFAULT_MINIMUM_CONTEXT_CHARS,
        contextWords: DEFAULT_MINIMUM_CONTEXT_WORDS
      },
      narrationSourceMinimumWords: 150
    },
    entries: rows,
    totals: {
      candidates: rows.length,
      publisherUrlsResolved: rows.filter(row => row.sourceUrl).length,
      articleContextsRetrieved: rows.filter(row => row.article?.status === 'retrieved').length,
      sourceEvidenceMinimumMet: rows.filter(row => row.article?.meetsSourceEvidenceMinimum).length,
      narrationSourceMinimumMet: rows.filter(row => row.article?.meetsNarrationSourceMinimum).length,
      publisherMappingsUnavailable: rows.filter(row => row.resolution === 'publisher_mapping_unavailable').length,
      scriptCacheTitleCandidates: rows.filter(row => row.scriptCache.status === 'candidate').length,
      scriptCacheCandidatesAmbiguous: rows.filter(row => row.scriptCache.status === 'ambiguous').length,
      distinctScriptCacheTitleCandidates: distinctCaches.length,
      distinctCachesWithEmptyContext: distinctCaches.filter(cache => cache.contextEmpty).length,
      distinctCachesWithoutReviewer: distinctCaches.filter(cache => !cache.reviewerPresent).length
    }
  };
}

async function writeJsonAtomically(outputPath, value) {
  const absolutePath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporaryPath, absolutePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function main() {
  const reportPath = path.resolve(process.argv[2] || path.join(ROOT, 'docs/evidencias/backlog-reconciliation-live-2026-10-21.json'));
  const outputPath = path.resolve(process.argv[3] || path.join(ROOT, 'docs/evidencias/backlog-source-resolution-2026-10-21.json'));
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const scriptCaches = await loadScriptCacheIndex();
  const result = await recoverBacklogSources(report, { scriptCaches });
  await writeJsonAtomically(outputPath, result);
  console.log(JSON.stringify({ output: path.relative(ROOT, outputPath), ...result.totals }, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Falha ao recuperar URLs de fontes: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  EMPTY_CONTEXT_SHA256,
  PUBLISHER_ORIGINS,
  loadScriptCacheIndex,
  matchScriptCache,
  normalizeTitle,
  publisherOrigin,
  resolveOwnerSource,
  recoverBacklogSources,
  titleAliases,
  writeJsonAtomically
};
