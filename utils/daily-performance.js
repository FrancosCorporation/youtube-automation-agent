'use strict';

const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withProcessFileLock } = require('./process-file-lock');
const { publicationMatchesTarget } = require('./publication-status');
const { analyticsErrorCode, calendarDate, REQUEST_OPTIONS } = require('./youtube-observed-metrics');

const PLATFORMS = ['youtube', 'shorts', 'kwai', 'instagram', 'tiktok', 'x', 'telegram'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function youtubeId(result) {
  const externalId = typeof result === 'object' ? result.externalId : null;
  if (typeof externalId === 'string' && /^[\w-]{11}$/.test(externalId)) return externalId;
  try {
    const url = new URL(typeof result === 'string' ? result : result.url);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    const id = host === 'youtu.be' ? url.pathname.slice(1)
      : ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)
        ? (url.searchParams.get('v') || /^\/(?:shorts|embed)\/([\w-]+)$/.exec(url.pathname)?.[1]) : null;
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}

function publicationInventory(ledger, root) {
  if (!ledger || !Array.isArray(ledger.entries)) throw new Error('invalid_topic_ledger');
  const posts = new Map();
  const health = Object.fromEntries(PLATFORMS.map(platform => [platform, {
    confirmed: 0, attempting: 0, failed: 0, unknown: 0,
    lastConfirmedAt: null, latestAttemptAt: null, latestAttemptStatus: null, latestFailureCode: null
  }]));
  function visit(entry, artifactPath, results, clip) {
    for (const [platform, result] of Object.entries(results || {})) {
      if (!PLATFORMS.includes(platform)) continue;
      const state = typeof result === 'object' && result ? result.status : null;
      if (['attempting', 'failed', 'unknown'].includes(state)) health[platform][state]++;
      if (typeof result === 'object' && result && ['attempting', 'failed', 'unknown'].includes(state)) {
        const attemptedAt = Date.parse(result.submittedAt || '');
        const currentLatest = Date.parse(health[platform].latestAttemptAt || '');
        if (Number.isFinite(attemptedAt) && (!Number.isFinite(currentLatest) || attemptedAt > currentLatest)) {
          health[platform].latestAttemptAt = new Date(attemptedAt).toISOString();
          health[platform].latestAttemptStatus = state;
          health[platform].latestFailureCode = typeof result.failureCode === 'string' ? result.failureCode : null;
        }
      }
      if (!publicationMatchesTarget(result, platform, artifactPath, root)) continue;
      const contentId = ['youtube', 'shorts'].includes(platform) ? youtubeId(result)
        : (typeof result === 'object' ? result.externalId || null : null);
      // A URL on another host is not a YouTube identity, even in a legacy ledger.
      if (['youtube', 'shorts'].includes(platform) && !contentId) continue;
      const publicationId = digest(platform + ':' + (contentId || (entry.jobId || '') + ':' + artifactPath)).slice(0, 24);
      if (posts.has(publicationId)) continue;
      health[platform].confirmed++;
      const confirmedAt = typeof result === 'object' ? result.confirmedAt : null;
      if (Number.isFinite(Date.parse(confirmedAt || ''))
        && (!Number.isFinite(Date.parse(health[platform].lastConfirmedAt || ''))
          || Date.parse(confirmedAt) > Date.parse(health[platform].lastConfirmedAt))) {
        health[platform].lastConfirmedAt = new Date(Date.parse(confirmedAt)).toISOString();
      }
      posts.set(publicationId, {
        publicationId, platform, contentId, jobId: entry.jobId || null,
        title: String(clip?.title || entry.title || ''), theme: entry.theme || null,
        formatId: clip?.formatId || entry.formatId || 'unknown',
        formatProvenance: clip?.formatId || entry.formatId ? 'explicit' : 'unknown',
        formatVersion: Number.isInteger(clip?.formatVersion) ? clip.formatVersion
          : Number.isInteger(entry.formatVersion) ? entry.formatVersion : null,
        experimentId: typeof (clip?.experimentId || entry.experimentId) === 'string'
          && /^[A-Za-z0-9_-]{8,80}$/.test(clip?.experimentId || entry.experimentId)
          ? clip?.experimentId || entry.experimentId : null,
        experimentProvenance: typeof (clip?.experimentId || entry.experimentId) === 'string'
          && /^[A-Za-z0-9_-]{8,80}$/.test(clip?.experimentId || entry.experimentId) ? 'explicit' : 'unknown',
        surfaceId: clip ? 'clip' : 'long_form',
        clipKind: typeof clip?.kind === 'string' ? clip.kind : null,
        renderer: entry.renderer || null,
        confirmedAt,
        url: ['youtube', 'shorts'].includes(platform) ? 'https://www.youtube.com/watch?v=' + contentId : null,
        artifactPath
      });
    }
  }
  for (const entry of ledger.entries) {
    visit(entry, entry.videoPath, entry.results?.long, null);
    for (const [artifactPath, results] of Object.entries(entry.results?.clips || {})) {
      const clip = (entry.clips || []).find(item => (typeof item === 'string' ? item : item.path) === artifactPath);
      visit(entry, artifactPath, results, typeof clip === 'object' ? clip : null);
    }
  }
  return { posts: [...posts.values()], health };
}

async function assetHash(artifactPath, root) {
  if (typeof artifactPath !== 'string') return null;
  try {
    const real = await fs.realpath(path.resolve(root, artifactPath));
    const mediaRoot = await fs.realpath(path.join(root, 'data', 'videos'));
    if (!real.startsWith(mediaRoot + path.sep)) return null;
    const hash = crypto.createHash('sha256');
    for await (const chunk of createReadStream(real)) hash.update(chunk);
    return hash.digest('hex');
  } catch (error) {
    if (['ENOENT', 'EACCES', 'EISDIR'].includes(error.code)) return null;
    throw error;
  }
}

async function defaultClient() {
  const { CredentialManager } = require('./credential-manager');
  const { AnalyticsOptimizationAgent } = require('../agents/analytics-optimization-agent');
  const credentials = new CredentialManager();
  // Loading only: collection must not rewrite credentials, launch a browser or prompt.
  await credentials.loadCredentials();
  await credentials.loadTokens();
  const agent = new AnalyticsOptimizationAgent(null, credentials);
  await agent.setupAnalyticsAPI();
  const response = await agent.youtube.channels.list({ part: 'id', mine: true }, REQUEST_OPTIONS);
  const channelId = response.data?.items?.[0]?.id;
  if (!channelId || response.data.items.length !== 1) throw new Error('channel_identity_unavailable');
  return { channelId, collect: (id, now) => agent.readObservedVideoMetrics(id, { channelId, now }) };
}

async function readReport(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function atomicWrite(file, value) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(value);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function counterDelta(post, previous) {
  if (!previous || !post.accountId || post.accountId !== previous.accountId) return null;
  const hours = (Date.parse(post.observedAt) - Date.parse(previous.observedAt)) / 3600000;
  if (!(hours > 0 && hours <= 48)) return null;
  const values = Object.fromEntries(['views', 'likes', 'comments'].map(metric => {
    const a = post.counters?.[metric], b = previous.counters?.[metric];
    return [metric, Number.isFinite(a) && Number.isFinite(b) ? a - b : null];
  }));
  const viewsPer24Hours = Number.isFinite(values.views) && values.views >= 0
    ? Number((values.views * 24 / hours).toFixed(2)) : null;
  return { hours: Number(hours.toFixed(3)), metrics: values, viewsPer24Hours,
    platformAdjustment: Object.values(values).some(value => value !== null && value < 0) };
}

async function previousComparableReport(reportDir, reportDate, posts) {
  const candidates = posts.filter(post => ['youtube', 'shorts'].includes(post.platform));
  if (!candidates.length) return null;
  let names;
  try { names = await fs.readdir(reportDir); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const earlier = names.filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)
    && name.slice(0, 10) < reportDate).sort().reverse().slice(0, 7);
  const byId = new Map();
  for (const name of earlier) {
    const report = await readReport(path.join(reportDir, name)).catch(error => error instanceof SyntaxError ? null : Promise.reject(error));
    if (!report || report.reportDate !== name.slice(0, 10) || !Array.isArray(report.posts)) continue;
    for (const current of candidates) {
      if (byId.has(current.publicationId)) continue;
      const prior = report.posts.find(post => post.publicationId === current.publicationId);
      if (prior && prior.accountId && prior.accountId === current.accountId
        && Number.isFinite(Date.parse(prior.observedAt || ''))) byId.set(current.publicationId, prior);
    }
  }
  return byId;
}

function markdownReport(report) {
  const cell = value => String(value ?? 'indisponível').replace(/[\r\n|]/g, ' ').replace(/[<>]/g, '');
  const out = ['# Desempenho diário — ' + report.reportDate, '',
    'Estado da coleta: ' + (report.status || 'não classificado') + '.', '',
    'Coletado em ' + report.collectedAt + ' · agenda America/Sao_Paulo.', '',
    'Views públicas são contadores cumulativos. Deltas mostram a janela exata entre observações. Métricas diárias YouTube usam dias Pacific e podem chegar atrasadas. Ausência de dados não significa zero.', ''];
  for (const platform of PLATFORMS) {
    const posts = report.posts.filter(post => post.platform === platform);
    const coverage = report.coverage[platform];
    out.push('## ' + platform, '', 'Coleta: ' + coverage.status + (coverage.reason ? ' (' + coverage.reason + ')' : '') +
      '. Posts confirmados no ledger: ' + report.publicationHealth[platform].confirmed + '.', '');
    if (!posts.length) continue;
    out.push('| Vídeo/formato | Estado | Views observadas | Δ views / horas | Último dia Analytics | Engaged views nesse dia |',
      '|---|---|---:|---|---|---:|');
    for (const post of posts) {
      const last = post.analytics?.days?.at(-1);
      const delta = post.delta?.metrics?.views;
      out.push('| ' + cell(post.title) + ' / ' + cell(post.formatId) + ' | ' + cell(post.status) +
        (post.reason || post.analytics?.reason ? ' (' + cell(post.reason || post.analytics.reason) + ')' : '') +
        ' | ' + cell(post.counters?.views) + ' | ' + (delta == null ? 'indisponível' : delta + ' / ' + post.delta.hours + 'h') +
        ' | ' + cell(last?.date) + ' | ' + cell(last?.metrics?.engagedViews) + ' |');
    }
    const top = posts.filter(post => Number.isFinite(post.delta?.metrics?.views) && post.delta.metrics.views >= 0)
      .sort((a, b) => b.delta.metrics.views - a.delta.metrics.views).slice(0, 3);
    out.push('', top.length ? 'Maiores deltas observados: ' + top.map(post => cell(post.title)).join('; ') + '.' : 'Sem duas observações comparáveis para ranking diário.',
      'Nenhum formato é promovido automaticamente. Comparar idade, duração, tema e tráfego; esta observação não prova causalidade.', '');
  }
  out.push('## Próxima ação', '', report.posts.some(post => post.status === 'observed')
    ? 'Inspecionar retenção e gancho dos candidatos com maior delta; definir um experimento de uma variável. Amostra insuficiente permanece inconclusiva.'
    : 'Resolver as lacunas de autenticação/coleta listadas acima. Ainda não há métricas suficientes para escolher um formato vencedor.', '');
  return out.join('\n');
}

async function collectDailyPerformance(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  const stateDir = path.resolve(options.stateDir || process.env.STATE_DIR || path.join(root, 'data', 'state'));
  const reportDir = path.resolve(options.reportDir || path.join(root, 'data', 'reports', 'performance'));
  const now = new Date(options.now || Date.now());
  const reportDate = calendarDate(now);
  await fs.mkdir(reportDir, { recursive: true, mode: 0o700 });
  return withProcessFileLock(async () => {
    const jsonPath = path.join(reportDir, reportDate + '.json');
    const markdownPath = path.join(reportDir, reportDate + '.md');
    const existing = await readReport(jsonPath);
    if (existing && !options.refresh) {
      await atomicWrite(markdownPath, markdownReport(existing));
      return { report: existing, jsonPath, markdownPath, cached: true };
    }
    const ledger = JSON.parse(await fs.readFile(path.join(stateDir, 'topics.json'), 'utf8'));
    const inventory = publicationInventory(ledger, root);
    const report = { schemaVersion: 2, collectorVersion: 2, reportDate, collectedAt: now.toISOString(),
      timeZone: 'America/Sao_Paulo', publicationHealth: inventory.health, coverage: {}, posts: [] };
    let client, blocked;
    if (inventory.posts.some(post => ['youtube', 'shorts'].includes(post.platform))) {
      try { client = await (options.createClient || defaultClient)(); }
      catch (error) { blocked = analyticsErrorCode(error); }
    }
    const hashes = new Map();
    for (const item of inventory.posts) {
      const { artifactPath, ...post } = item;
      if (!hashes.has(artifactPath)) hashes.set(artifactPath, await assetHash(artifactPath, root));
      post.assetSha256 = hashes.get(artifactPath);
      post.status = 'unavailable';
      post.reason = 'official_collector_unavailable';
      if (['youtube', 'shorts'].includes(post.platform)) {
        post.reason = blocked || null;
        if (client) {
          post.accountId = digest('youtube:' + client.channelId).slice(0, 24);
          try { Object.assign(post, await client.collect(post.contentId, options.now ? now : new Date())); }
          catch (error) {
            post.reason = analyticsErrorCode(error);
            if (['oauth_invalid_grant', 'authentication_required', 'rate_limited'].includes(post.reason)) {
              blocked = post.reason;
              client = null;
            }
          }
        }
      }
      report.posts.push(post);
    }
    const previousById = await previousComparableReport(reportDir, reportDate, report.posts);
    for (const post of report.posts) {
      post.delta = counterDelta(post, previousById?.get(post.publicationId));
    }
    for (const platform of PLATFORMS) {
      const posts = report.posts.filter(post => post.platform === platform);
      report.coverage[platform] = { status: !posts.length ? 'no_confirmed_posts'
        : posts.every(post => post.status === 'observed') ? 'observed'
          : posts.some(post => ['observed', 'partial'].includes(post.status)) ? 'partial' : 'unavailable',
      reason: posts.find(post => post.reason)?.reason || posts.find(post => post.analytics?.reason)?.analytics.reason || null };
    }
    report.status = !report.posts.length ? 'empty'
      : report.posts.every(post => post.status === 'observed') ? 'observed'
        : report.posts.some(post => ['observed', 'partial'].includes(post.status)) ? 'partial' : 'blocked';
    if (existing) {
      const archiveDir = path.join(reportDir, 'history');
      await fs.mkdir(archiveDir, { recursive: true, mode: 0o700 });
      await atomicWrite(path.join(archiveDir, reportDate + '-' + crypto.randomUUID() + '.json'), JSON.stringify(existing, null, 2) + '\n');
    }
    await atomicWrite(jsonPath, JSON.stringify(report, null, 2) + '\n');
    await atomicWrite(markdownPath, markdownReport(report));
    return { report, jsonPath, markdownPath, cached: false };
  }, { lockPath: path.join(reportDir, '.collection.lock'), owner: 'daily-performance', timeoutMs: options.lockTimeoutMs || 1000, pollIntervalMs: 20 });
}

module.exports = { collectDailyPerformance, publicationInventory, youtubeId, counterDelta, markdownReport };
