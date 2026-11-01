/**
 * News Hunter — encontra a pauta MAIS QUENTE para um TEMA entre várias fontes.
 *
 * O tema vem de config/themes.json (parâmetro): cada réplica da instância roda
 * com o seu TEMA. Fontes todas sem API key:
 *   - Hacker News (opcional por tema: useHn)
 *   - Reddit (subs do tema)  → upvotes + comentários
 *   - Google News (query do tema, pt-BR)
 *   - RSS do tema
 *
 * Score de viralidade = engajamento (log) + frescor. Dedup por URL/título.
 */
const THEMES = require('../config/themes.json');
const { TextDecoder } = require('node:util');
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'com', 'para', 'por',
  'que', 'um', 'uma', 'sobre', 'the', 'of', 'to', 'in', 'and', 'for', 'on', 'with', 'a', 'is', 'are', 'at', 'by']);

const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' };
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const googleNewsUrlCache = new Map();
const GENERIC_PUBLISHER_TERMS = new Set([
  'news', 'technology', 'tech', 'business', 'work', 'career', 'careers', 'health', 'science',
  'ai', 'artificial', 'intelligence', 'finance', 'economy', 'latest', 'rss', 'feed', 'digital',
  'tecnologia', 'negocios', 'saude', 'carreira', 'trabalho', 'noticias', 'brasil'
]);
const GENERIC_STORY_TITLE_TERMS = new Set([
  ...STOP,
  'prefeitura', 'municipal', 'municipio', 'município', 'municipios', 'municípios', 'cidade', 'estado', 'agencia', 'agência', 'sine',
  'vaga', 'vagas', 'emprego', 'empregos', 'oferece', 'oferecem', 'abre', 'abertas', 'abertos',
  'mutirao', 'mutirão', 'proximo', 'próximo', 'proxima', 'próxima', 'hoje', 'amanha', 'amanhã',
  'segunda', 'terca', 'terça', 'quarta', 'quinta', 'sexta', 'sabado', 'sábado', 'domingo',
  'area', 'área', 'areas', 'áreas', 'diferentes', 'oportunidade', 'oportunidades', 'notícia', 'notícias',
  'the', 'new', 'latest', 'report', 'reports', 'research', 'study', 'studies', 'about', 'today',
  'tomorrow', 'city', 'state', 'jobs', 'job', 'offers', 'offer', 'opening', 'openings', 'announces'
]);

function decodeXml(value) {
  return String(value || '').replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&#x([\da-f]{1,6});/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_match, entity) => ({
      amp: '&', lt: '<', gt: '>', quot: '"', apos: '\''
    })[entity]);
}

function publisherIdentity(source, sourceUrl = '') {
  const labelTokens = String(source || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().match(/[a-z0-9]+/g) || [];
  const brandTokens = labelTokens.filter(token => !GENERIC_PUBLISHER_TERMS.has(token) && token !== 'the');
  if (brandTokens.length) return `name:${brandTokens.join(' ')}`;
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\d?\./, '');
    if (hostname) return `host:${hostname}`;
  } catch (_error) { /* usa o rótulo disponível abaixo */ }
  return labelTokens.length ? `name:${labelTokens.join(' ')}` : 'unknown';
}

const NEWS_AGGREGATOR_LABEL = /^(?:hacker\s*news|reddit|google\s*news(?:\s*\([^)]*\))?)$/i;
const PUBLISHER_BRANDS = Object.freeze({
  arxiv: 'arXiv',
  bbc: 'BBC',
  deepseek: 'DeepSeek',
  github: 'GitHub',
  google: 'Google',
  hackernews: 'Hacker News',
  openai: 'OpenAI',
  nytimes: 'The New York Times',
  reuters: 'Reuters',
  techcrunch: 'TechCrunch',
  theguardian: 'The Guardian',
  wired: 'WIRED'
});
const SECOND_LEVEL_PUBLIC_SUFFIXES = new Set(['co.uk', 'org.uk', 'com.au', 'co.nz', 'com.br', 'com.cn', 'co.jp', 'co.in']);

function publisherDisplayName(source, sourceUrl = '') {
  const label = String(source || '').trim();
  if (label && !NEWS_AGGREGATOR_LABEL.test(label)) return label;

  let hostname;
  try {
    hostname = new URL(String(sourceUrl || '')).hostname.toLowerCase().replace(/^www\d?\./, '');
  } catch {
    return label || 'Imprensa';
  }
  if (!hostname || /(^|\.)(?:news\.ycombinator\.com|reddit\.com|news\.google\.com)$/.test(hostname)) {
    return label || 'Imprensa';
  }

  const parts = hostname.split('.');
  const suffix = parts.slice(-2).join('.');
  const brand = parts.at(SECOND_LEVEL_PUBLIC_SUFFIXES.has(suffix) ? -3 : -2) || parts[0];
  return PUBLISHER_BRANDS[brand] || brand.replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

function candidateSignalLabel(candidate) {
  if (String(candidate?.source || '').startsWith('Google News (')) {
    const count = Number(candidate.independentSources) || 0;
    return `${count} ${count === 1 ? 'fonte independente' : 'fontes independentes'}`;
  }
  const count = Number(candidate?.comments) || 0;
  return `${count} ${count === 1 ? 'comentário' : 'comentários'}`;
}

async function getText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await readBoundedResponseText(res);
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedResponseText(response, maxBytes = MAX_RESPONSE_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxBytes deve ser um inteiro positivo');
  }

  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) {
    try { await response.body?.cancel?.(); } catch (_error) { /* falha ao cancelar não muda o limite */ }
    throw new Error(`Response exceeds ${maxBytes} byte limit`);
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    if (response.body) throw new Error('Streaming response body is required for bounded reads');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`Response exceeds ${maxBytes} byte limit`);
    }
    return text;
  }

  const decoder = new TextDecoder();
  const parts = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`Response exceeds ${maxBytes} byte limit`);
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally {
    reader.releaseLock();
  }
}

async function getJson(url, timeoutMs = 15000) {
  const text = await getText(url, timeoutMs);
  return JSON.parse(text);
}

const tokens = s => String(s || '').toLowerCase().replace(/[^\wà-ú\s]/g, ' ').split(/\s+/)
  .filter(w => w.length > 2 && !STOP.has(w));

function overlap(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

function storyTitleEntities(title) {
  return new Set((String(title || '').match(/[\p{L}\p{N}]+/gu) || [])
    .filter(token => /^[\p{Lu}][\p{L}\p{N}]*$/u.test(token) && token.length > 2)
    .map(token => token.toLocaleLowerCase('pt-BR'))
    .filter(token => !GENERIC_STORY_TITLE_TERMS.has(token)));
}

function storyTitleNumbers(title) {
  return new Set((String(title || '').match(/\b\d+(?:[.,]\d+)?%?\b/g) || [])
    .map(value => value.replace(',', '.').replace(/%$/, '')));
}

function sameStoryTitle(leftTitle, rightTitle, minimumOverlap = 0.45) {
  if (overlap(leftTitle, rightTitle) < minimumOverlap) return false;

  const leftEntities = storyTitleEntities(leftTitle);
  const rightEntities = storyTitleEntities(rightTitle);
  if (leftEntities.size && rightEntities.size
      && ![...leftEntities].some(entity => rightEntities.has(entity))) return false;

  const leftNumbers = storyTitleNumbers(leftTitle);
  const rightNumbers = storyTitleNumbers(rightTitle);
  if (leftNumbers.size && rightNumbers.size
      && ![...leftNumbers].some(number => rightNumbers.has(number))) return false;

  return true;
}

function filterSameStoryNewsReferences(articles, sourceTitle, minimumOverlap = 0.45) {
  if (!Array.isArray(articles) || !String(sourceTitle || '').trim()) return [];
  return articles.filter(article => article && typeof article.title === 'string'
    && sameStoryTitle(article.title, sourceTitle, minimumOverlap));
}

const lscore = x => Math.log10(1 + Math.max(0, Number(x) || 0));
const freshness = ageH => Math.max(0, 1 - ageH / 72);

/* ---------------- fontes ---------------- */

async function fetchHackerNews(limit = 60) {
  const ids = (await getJson('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, limit);
  const items = await Promise.all(ids.map(id =>
    getJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)
  ));
  return items.filter(it => it && it.title && (it.url || it.text))
    .map(it => {
      const ageH = (Date.now() / 1000 - (it.time || 0)) / 3600;
      return {
        source: 'Hacker News', title: it.title, url: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
        ageHours: ageH, points: it.score || 0, comments: it.descendants || 0,
        score: lscore(it.score) + 0.7 * lscore(it.descendants) + freshness(ageH)
      };
    });
}

async function fetchReddit(subs, limit = 25) {
  const out = [];
  for (const sub of subs) {
    try {
      const data = await getJson(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=${limit}`);
      for (const c of (data?.data?.children || [])) {
        const d = c.data;
        if (!d || !d.title) continue;
        const ageH = (Date.now() / 1000 - (d.created_utc || 0)) / 3600;
        out.push({
          source: `Reddit r/${sub}`, title: d.title,
          url: d.url && d.url.startsWith('http') ? d.url : `https://reddit.com${d.permalink}`,
          ageHours: ageH, points: d.ups || 0, comments: d.num_comments || 0,
          score: lscore(d.ups) + 0.7 * lscore(d.num_comments) + freshness(ageH)
        });
      }
    } catch (_e) { /* sub indisponível */ }
  }
  return out;
}

function parseGoogleNewsFeed(xml, limit = 30) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const block = m[1];
    const title = ((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
    const link = ((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
    const sourceTag = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
    const source = decodeXml(sourceTag?.[2] || '').trim();
    const sourceUrl = decodeXml(sourceTag?.[1]?.match(/\burl=["']([^"']+)["']/i)?.[1] || '').trim();
    const pub = ((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
    const description = ((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '').trim();
    if (title && link) items.push({
      title: decodeXml(title), link: decodeXml(link), source, sourceUrl,
      description: decodeXml(description), pub,
      ageHours: pub ? (Date.now() - new Date(pub).getTime()) / 3600000 : 24
    });
  }
  return items;
}

async function fetchGoogleNews(query, limit = 30) {
  const q = encodeURIComponent(query);
  const xml = await getText(`https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`);
  return parseGoogleNewsFeed(xml, limit);
}

function readFeedTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i'));
  return match ? decodeXml(match[1]).trim() : '';
}

function readXmlAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return decodeXml(match?.[1] ?? match?.[2] ?? '').trim();
}

function readAtomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?\s*>/gi)];
  const alternate = links.find(([, attributes]) => {
    const relation = readXmlAttribute(attributes, 'rel');
    return relation === '' || relation === 'alternate';
  });
  return alternate ? readXmlAttribute(alternate[1], 'href') : '';
}

function parseThemeFeed(xml, { source = '', url = '', limit = 20 } = {}) {
  const text = String(xml || '');
  const rssItems = [...text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)];
  const isRss = rssItems.length > 0;
  const blocks = isRss
    ? rssItems.map(([, block]) => ({ block, atom: false }))
    : [...text.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi)]
      .map(([, block]) => ({ block, atom: true }));
  const maxItems = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 20;
  const items = [];

  for (const { block, atom } of blocks.slice(0, maxItems)) {
    const title = readFeedTag(block, 'title');
    const link = atom
      ? readAtomLink(block)
      : readFeedTag(block, 'link');
    const pub = readFeedTag(block, atom ? 'published' : 'pubDate')
      || (atom ? readFeedTag(block, 'updated') : readFeedTag(block, 'dc:date'));
    if (!title || !link) continue;

    let resolvedLink = link;
    try { resolvedLink = new URL(link, url || undefined).href; } catch (_error) { /* preserva o link bruto */ }
    const timestamp = pub ? new Date(pub).getTime() : Number.NaN;
    const ageHours = Number.isFinite(timestamp) ? (Date.now() - timestamp) / 3600000 : 24;
    items.push({
      source,
      sourceUrl: url,
      title,
      link: resolvedLink,
      ageHours,
      points: 0,
      comments: 0,
      score: 0.5 + freshness(ageHours)
    });
  }

  return items;
}

async function fetchThemeFeeds(feeds) {
  // Feeds configurados para o TEMA (config/themes.json) — sem API key.
  const out = [];
  for (const [source, url] of feeds) {
    try {
      const xml = await getText(url);
      out.push(...parseThemeFeed(xml, { source, url }));
    } catch (_e) { /* feed indisponível */ }
  }
  return out;
}

/* ---------------- hunter ---------------- */

function dedupe(items, filter) {
  const re = filter ? new RegExp(filter, 'i') : null;
  const kept = [];
  for (const it of items.sort((a, b) => b.score - a.score)) {
    if (re && !re.test(it.title)) continue; // fora do tema
    if (/^(show|ask)\s+hn\b/i.test(it.title)) continue; // projetos, não notícia
    if (kept.some(k => sameStoryTitle(k.title, it.title, 0.6))) continue;
    kept.push(it);
  }
  return kept;
}

// Cluster Google News coverage: a story covered by many outlets wins.
function googleNewsClusters(gnItems) {
  const clusters = [];
  for (const it of gnItems) {
    const hit = clusters.find(c => sameStoryTitle(c.title, it.title));
    if (hit) {
      hit.outlets.push(it.source);
      hit.sourceIds.push(publisherIdentity(it.source, it.sourceUrl));
      hit.publisherArticles.push(it);
      hit.best = hit.best || it;
    } else {
      clusters.push({
        title: it.title,
        outlets: [it.source],
        sourceIds: [publisherIdentity(it.source, it.sourceUrl)],
        publisherArticles: [it],
        best: it,
        ageHours: it.ageHours
      });
    }
  }
  return clusters.map(c => {
    const outlets = [...new Set(c.outlets.map(source => String(source || '').trim()).filter(Boolean))];
    const sourceIds = [...new Set(c.sourceIds.filter(sourceId => sourceId !== 'unknown'))];
    return {
      source: `Google News (${sourceIds.length} veículos)`, title: c.title,
      url: c.best.link, link: c.best.link, articleTitle: c.best.title,
      publisherUrl: c.best.sourceUrl || '', description: c.best.description || '',
      ageHours: c.ageHours, points: 0, comments: sourceIds.length,
      outlets, sourceIds,
      publisherArticles: c.publisherArticles
        .filter(article => article.link && article.sourceUrl)
        .slice(0, 8)
        .map(article => ({
          title: article.title,
          source: article.source,
          url: article.link,
          publisherUrl: article.sourceUrl
        })),
      independentSources: sourceIds.length,
      score: lscore(sourceIds.length * 25) + freshness(c.ageHours)
    };
  });
}

function getTheme(id) {
  const list = THEMES.themes || [];
  return list.find(t => t.id === id) || list[0];
}

async function huntHotTopics(used = {}, themeId = process.env.THEME || 'ia') {
  const theme = getTheme(themeId);
  const usedTitles = Array.isArray(used) ? used : (used.titles || []);
  const usedUrls = Array.isArray(used) ? [] : (used.urls || []);
  const [hn, reddit, gn, themeFeeds] = await Promise.all([
    theme.useHn ? fetchHackerNews().catch(() => []) : Promise.resolve([]),
    fetchReddit(theme.reddit || []).catch(() => []),
    fetchGoogleNews(theme.gnews).catch(() => []),
    fetchThemeFeeds(theme.feeds || []).catch(() => [])
  ]);
  const clusters = googleNewsClustersWithBoost(gn, themeFeeds);
  const candidates = dedupe([...clusters, ...hn, ...reddit, ...themeFeeds], theme.filter)
    .filter(c => !(c.url && usedUrls.includes(c.url)))
    .filter(c => !usedTitles.some(u => sameStoryTitle(u, c.title, 0.6)));
  return candidates;
}

// Give a small corroboration boost only when a distinct configured publisher confirms the story.
function googleNewsClustersWithBoost(gn, themeFeeds) {
  const clusters = googleNewsClusters(gn);
  for (const c of clusters) {
    const corroboratingFeeds = themeFeeds.filter(feed => sameStoryTitle(feed.title, c.title, 0.5));
    const sourceIds = new Set(c.sourceIds || []);
    for (const feed of corroboratingFeeds) {
      const sourceId = publisherIdentity(feed.source, feed.sourceUrl);
      if (sourceId !== 'unknown') sourceIds.add(sourceId);
    }
    if (sourceIds.size > c.independentSources) {
      c.score += 0.8;
    }
    c.sourceIds = [...sourceIds];
    c.independentSources = sourceIds.size;
    const articlesByPublisher = new Map();
    for (const article of [
      ...corroboratingFeeds.map(feed => ({ ...feed, link: feed.link })),
      ...(c.publisherArticles || []).map(article => ({ ...article, link: article.url }))
    ]) {
      const publisherUrl = article.sourceUrl || article.publisherUrl || '';
      if (typeof article.link !== 'string' || !/^https?:\/\//i.test(article.link)
          || !/^https?:\/\//i.test(publisherUrl)) continue;
      const sourceId = publisherIdentity(article.source, publisherUrl);
      if (sourceId === 'unknown' || articlesByPublisher.has(sourceId)) continue;
      articlesByPublisher.set(sourceId, {
        title: article.title,
        source: article.source,
        url: article.link,
        publisherUrl
      });
      if (articlesByPublisher.size >= 4) break;
    }
    c.corroboratingArticles = [...articlesByPublisher.values()];
  }
  return clusters;
}

function publisherHostMatches(candidateUrl, publisherUrl) {
  try {
    const candidate = new URL(candidateUrl);
    const publisher = new URL(publisherUrl);
    if (!['http:', 'https:'].includes(candidate.protocol) || !['http:', 'https:'].includes(publisher.protocol)) return false;
    const candidateHost = candidate.hostname.toLowerCase().replace(/^www\d?\./, '');
    const publisherHost = publisher.hostname.toLowerCase().replace(/^www\d?\./, '');
    return candidateHost === publisherHost || candidateHost.endsWith(`.${publisherHost}`);
  } catch {
    return false;
  }
}

async function resolveGoogleNewsUrl(link, publisherUrl, { timeoutMs = 12000, fetchImpl = globalThis.fetch } = {}) {
  if (!link || !publisherUrl || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) return '';
  let parsedLink;
  try { parsedLink = new URL(link); } catch { return ''; }
  const linkHost = parsedLink.hostname.toLowerCase();
  const isGoogleNews = linkHost === 'news.google.com' || linkHost.endsWith('.news.google.com');
  if (!isGoogleNews) return publisherHostMatches(link, publisherUrl) ? link : '';
  if (typeof fetchImpl !== 'function') return '';
  const cacheKey = `${link}\n${publisherUrl}`;
  if (googleNewsUrlCache.has(cacheKey)) return googleNewsUrlCache.get(cacheKey);

  const articleId = parsedLink.pathname.match(/\/(?:rss\/)?(?:articles|read)\/([^/]+)\/?$/i)?.[1];
  if (!articleId || articleId.length > 2048) return '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const pageResponse = await fetchImpl(link, {
      headers: {
        ...UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        Cookie: 'CONSENT=PENDING+987',
        'Upgrade-Insecure-Requests': '1'
      },
      redirect: 'follow', signal: controller.signal
    });
    if (!pageResponse.ok) return '';
    const finalUrl = String(pageResponse.url || '');
    if (publisherHostMatches(finalUrl, publisherUrl)) return finalUrl;
    const html = await readBoundedResponseText(pageResponse, MAX_RESPONSE_BYTES);
    const signature = decodeXml(html.match(/\bdata-n-a-sg\s*=\s*["']([^"']{1,4096})["']/i)?.[1] || '');
    const timestampValue = html.match(/\bdata-n-a-ts\s*=\s*["'](\d{1,16})["']/i)?.[1] || '';
    const timestamp = Number(timestampValue);
    if (!signature || !Number.isSafeInteger(timestamp) || timestamp <= 0) return '';

    const locale = parsedLink.searchParams.get('ceid')
      || `${parsedLink.searchParams.get('gl') || 'BR'}:${parsedLink.searchParams.get('hl') || 'pt-419'}`;
    const payload = [
      'garturlreq',
      [['X', 'X', ['X', 'X'], null, null, 1, 1, locale, null, 1, null, null, null, null, null, 0, 1],
        'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      decodeURIComponent(articleId), timestamp, signature
    ];
    const formValue = JSON.stringify([[['Fbv4je', JSON.stringify(payload)]]]);
    const cookieValues = ['CONSENT=PENDING+987'];
    const responseCookies = pageResponse.headers?.getSetCookie?.() || [];
    for (const cookie of responseCookies) {
      const nameValue = String(cookie).split(';', 1)[0];
      if (nameValue && !/^CONSENT=/i.test(nameValue)) cookieValues.push(nameValue);
    }
    const rpcResponse = await fetchImpl('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: {
        ...UA,
        Accept: '*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Origin: 'https://news.google.com',
        Referer: 'https://news.google.com/',
        'X-Same-Domain': '1',
        Cookie: cookieValues.join('; ')
      },
      body: `f.req=${encodeURIComponent(formValue)}`,
      signal: controller.signal
    });
    if (!rpcResponse.ok) return '';
    const raw = await readBoundedResponseText(rpcResponse, MAX_RESPONSE_BYTES);
    const jsonStart = raw.indexOf('[');
    if (jsonStart < 0) return '';
    let frames;
    try { frames = JSON.parse(raw.slice(jsonStart)); } catch { return ''; }
    const findRpcPayload = (node, depth = 0) => {
      if (depth > 12 || !Array.isArray(node)) return null;
      if (node[0] === 'wrb.fr' && node[1] === 'Fbv4je') return node[2];
      for (const child of node) {
        const result = findRpcPayload(child, depth + 1);
        if (result !== null) return result;
      }
      return null;
    };
    const rpcPayload = findRpcPayload(frames);
    if (typeof rpcPayload !== 'string') return '';
    let decoded;
    try { decoded = JSON.parse(rpcPayload); } catch { return ''; }
    const resolvedUrl = Array.isArray(decoded) && decoded[0] === 'garturlres' ? String(decoded[1] || '') : '';
    if (!publisherHostMatches(resolvedUrl, publisherUrl)) return '';
    if (googleNewsUrlCache.size >= 200) googleNewsUrlCache.delete(googleNewsUrlCache.keys().next().value);
    googleNewsUrlCache.set(cacheKey, resolvedUrl);
    return resolvedUrl;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  huntHotTopics,
  overlap,
  sameStoryTitle,
  filterSameStoryNewsReferences,
  getTheme,
  publisherIdentity,
  publisherDisplayName,
  candidateSignalLabel,
  googleNewsClusters,
  googleNewsClustersWithBoost,
  publisherHostMatches,
  resolveGoogleNewsUrl,
  parseGoogleNewsFeed,
  parseThemeFeed,
  readBoundedResponseText
};
