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
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'com', 'para', 'por',
  'que', 'um', 'uma', 'sobre', 'the', 'of', 'to', 'in', 'and', 'for', 'on', 'with', 'a', 'is', 'are', 'at', 'by']);

const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' };

async function getText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
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

async function fetchGoogleNews(query, limit = 30) {
  const q = encodeURIComponent(query);
  const xml = await getText(`https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`);
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const block = m[1];
    const title = ((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
    const link = ((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
    const source = ((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '').trim();
    const pub = ((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
    if (title && link) items.push({ title, link, source, pub, ageHours: pub ? (Date.now() - new Date(pub).getTime()) / 3600000 : 24 });
  }
  return items;
}

async function fetchBrazilianRss(feeds) {
  // Feeds do TEMA (config/themes.json) — todos RSS grátis, sem API key.
  const out = [];
  for (const [source, url] of feeds) {
    try {
      const xml = await getText(url);
      const re = /<item>([\s\S]*?)<\/item>/g;
      let m, count = 0;
      while ((m = re.exec(xml)) && count < 20) {
        const block = m[1];
        const title = ((block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '').trim();
        const link = ((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
        const pub = ((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
        if (title && link) {
          const ageHours = pub ? (Date.now() - new Date(pub).getTime()) / 3600000 : 24;
          out.push({ source, title, link, ageHours, points: 0, comments: 0, score: 0.5 + freshness(ageHours) });
          count += 1;
        }
      }
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
    if (kept.some(k => overlap(k.title, it.title) > 0.6)) continue;
    kept.push(it);
  }
  return kept;
}

// Cluster Google News coverage: a story covered by many outlets wins.
function googleNewsClusters(gnItems) {
  const clusters = [];
  for (const it of gnItems) {
    const hit = clusters.find(c => overlap(c.title, it.title) > 0.45);
    if (hit) { hit.outlets.push(it.source); hit.best = hit.best || it; }
    else clusters.push({ title: it.title, outlets: [it.source], best: it, ageHours: it.ageHours });
  }
  return clusters.map(c => ({
    source: `Google News (${c.outlets.length} veículos)`, title: c.title,
    url: c.best.link, link: c.best.link, articleTitle: c.best.title,
    ageHours: c.ageHours, points: 0, comments: c.outlets.length,
    score: lscore(c.outlets.length * 25) + freshness(c.ageHours)
  }));
}

function getTheme(id) {
  const list = THEMES.themes || [];
  return list.find(t => t.id === id) || list[0];
}

async function huntHotTopics(used = {}, themeId = process.env.THEME || 'ia') {
  const theme = getTheme(themeId);
  const usedTitles = Array.isArray(used) ? used : (used.titles || []);
  const usedUrls = Array.isArray(used) ? [] : (used.urls || []);
  const [hn, reddit, gn, br] = await Promise.all([
    theme.useHn ? fetchHackerNews().catch(() => []) : Promise.resolve([]),
    fetchReddit(theme.reddit || []).catch(() => []),
    fetchGoogleNews(theme.gnews).catch(() => []),
    fetchBrazilianRss(theme.feeds || []).catch(() => [])
  ]);
  const clusters = googleNewsClustersWithBoost(gn, br);
  const candidates = dedupe([...clusters, ...hn, ...reddit, ...br], theme.filter)
    .filter(c => !(c.url && usedUrls.includes(c.url)))
    .filter(c => !usedTitles.some(u => overlap(u, c.title) > 0.6));
  return candidates;
}

// Google News clusters that also appear in Brazilian feeds get a boost.
function googleNewsClustersWithBoost(gn, br) {
  const clusters = googleNewsClusters(gn);
  for (const c of clusters) {
    if (br.some(b => overlap(b.title, c.title) > 0.5)) c.score += 0.8;
  }
  return clusters;
}

module.exports = { huntHotTopics, overlap, getTheme };
