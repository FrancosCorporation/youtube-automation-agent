'use strict';

const { isPublicationEligible } = require('./publication-status');
const { assessSourceEvidence } = require('./source-evidence');
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_RECAP_TOPICS = 2;
const MAX_RECAP_TOPICS = 7;
const MAX_SOURCE_CONTEXT_CHARS = 1800;

function timestamp(value, label) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} inválido`);
  return parsed;
}

function weeklyRecapEnabled(env = process.env) {
  return env.ENABLE_WEEKLY_RECAP === '1';
}

function recapWindowFor({ anchorAt, now = new Date(), everyDays, themeId }) {
  const cadence = Number(everyDays);
  if (!Number.isSafeInteger(cadence) || cadence < 1 || cadence > 3650) {
    throw new Error('RECAP_EVERY_DAYS deve ser um inteiro entre 1 e 3650');
  }
  if (typeof themeId !== 'string' || !themeId.trim()) throw new Error('tema obrigatório para agendar recap');
  const anchor = timestamp(anchorAt, 'âncora do calendário');
  const current = timestamp(now, 'data atual');
  if (current < anchor) throw new Error('data atual anterior à âncora do calendário');

  const intervalMs = cadence * DAY_MS;
  const completedWindows = Math.floor((current - anchor) / intervalMs);
  if (completedWindows < 1) return null;
  const windowIndex = completedWindows - 1;
  const startMs = anchor + windowIndex * intervalMs;
  const endMs = startMs + intervalMs;
  return {
    themeId: themeId.trim(),
    windowIndex,
    key: `${themeId.trim()}:${windowIndex}`,
    startAt: new Date(startMs).toISOString(),
    dueAt: new Date(endMs).toISOString(),
    endAt: new Date(endMs).toISOString()
  };
}

function claimRecapWindow(state, options) {
  const currentState = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const window = recapWindowFor(options);
  if (!window) return { claimed: false, reason: 'not_due', window: null, state: currentState };

  const existing = currentState.recapWindowsByTheme && typeof currentState.recapWindowsByTheme === 'object'
    ? currentState.recapWindowsByTheme : {};
  const lastWindow = Number.isSafeInteger(existing[window.themeId]) ? existing[window.themeId] : -1;
  if (lastWindow >= window.windowIndex) {
    return { claimed: false, reason: 'already_claimed', window, state: currentState };
  }

  return {
    claimed: true,
    reason: 'due',
    window,
    state: {
      ...currentState,
      recapWindowsByTheme: { ...existing, [window.themeId]: window.windowIndex }
    }
  };
}

function isValidRecapWindow(window, expectedThemeId) {
  if (!window || typeof window !== 'object' || Array.isArray(window)) return false;
  const themeId = String(window.themeId || '');
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(themeId)
    || (expectedThemeId && themeId !== expectedThemeId)
    || !Number.isSafeInteger(window.windowIndex) || window.windowIndex < 0
    || window.key !== `${themeId}:${window.windowIndex}`
    || typeof window.startAt !== 'string' || !Number.isFinite(Date.parse(window.startAt))
    || typeof window.endAt !== 'string' || !Number.isFinite(Date.parse(window.endAt))
    || window.dueAt !== window.endAt) return false;
  return Date.parse(window.startAt) < Date.parse(window.endAt);
}

function recordRecapWindow(state, window) {
  if (!isValidRecapWindow(window)) throw new Error('janela de recap inválida');
  const currentState = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const existing = currentState.recapWindowsByTheme && typeof currentState.recapWindowsByTheme === 'object'
    ? currentState.recapWindowsByTheme : {};
  const previous = Number.isSafeInteger(existing[window.themeId]) ? existing[window.themeId] : -1;
  return {
    ...currentState,
    recapWindowsByTheme: { ...existing, [window.themeId]: Math.max(previous, window.windowIndex) }
  };
}

function hasRecapWindow(items, window) {
  if (!Array.isArray(items) || !isValidRecapWindow(window)) return false;
  return items.some(item => item?.recap === true
    && isValidRecapWindow(item.recapWindow, window.themeId)
    && item.recapWindow.key === window.key);
}

function decideRecapGeneration({ enabled, state, queue = [], inFlight = null, anchorAt, now = new Date(), everyDays, themeId } = {}) {
  if (enabled !== true) return { recap: false, reason: 'disabled', window: null };
  const claim = claimRecapWindow(state, { anchorAt, now, everyDays, themeId });
  if (!claim.claimed) return { recap: false, reason: claim.reason, window: claim.window };
  if (hasRecapWindow([...queue, ...(inFlight ? [inFlight] : [])], claim.window)) {
    return { recap: false, reason: 'already_queued', window: claim.window };
  }
  return { recap: true, reason: 'due', window: claim.window };
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.toString();
  } catch {
    return '';
  }
}

function normalizedTitle(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function selectRecapEntries(entries, { themeId, now = new Date(), days = 7, maxTopics = MAX_RECAP_TOPICS } = {}) {
  if (typeof themeId !== 'string' || !themeId.trim()) throw new Error('tema obrigatório para selecionar fontes de recap');
  const lookbackDays = Number(days);
  if (!Number.isSafeInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 3650) {
    throw new Error('dias do recap devem ser um inteiro entre 1 e 3650');
  }
  const limit = Number(maxTopics);
  if (!Number.isSafeInteger(limit) || limit < MIN_RECAP_TOPICS || limit > 50) {
    throw new Error(`maxTopics deve ser um inteiro entre ${MIN_RECAP_TOPICS} e 50`);
  }
  if (!Array.isArray(entries)) throw new Error('ledger de fontes deve conter entries');
  const nowMs = timestamp(now, 'data atual');
  const cutoff = nowMs - lookbackDays * DAY_MS;
  const sorted = entries.map((entry, index) => ({ entry, index, generatedMs: Date.parse(entry?.generatedAt || '') }))
    .filter(({ entry, generatedMs }) => entry && entry.theme === themeId
      && generatedMs >= cutoff && generatedMs <= nowMs
      && entry.sourceEvidence?.mode !== 'recap'
      && isPublicationEligible(entry))
    .sort((a, b) => b.generatedMs - a.generatedMs || a.index - b.index);

  const seenUrls = new Set();
  const seenTitles = new Set();
  const selected = [];
  for (const { entry } of sorted) {
    const title = String(entry.sourceEvidence?.sourceTitle || entry.title || '').trim();
    const url = canonicalUrl(entry.sourceEvidence?.sourceUrl || entry.url);
    const titleKey = normalizedTitle(title);
    if (!titleKey || !url || seenUrls.has(url) || seenTitles.has(titleKey)) continue;
    seenUrls.add(url);
    seenTitles.add(titleKey);
    selected.push({ ...entry, recapSourceTitle: title, recapSourceUrl: url });
    if (selected.length >= limit) break;
  }
  return selected;
}

function buildRecapContext(entriesWithContext) {
  if (!Array.isArray(entriesWithContext)) throw new Error('fontes do recap devem ser uma lista');
  return entriesWithContext.map(({ entry, context }) => {
    const title = String(entry?.recapSourceTitle || entry?.sourceEvidence?.sourceTitle || entry?.title || '').trim();
    const source = String(entry?.source || 'Fonte do ledger').trim();
    const generatedAt = Date.parse(entry?.generatedAt || '');
    const date = Number.isFinite(generatedAt) ? new Date(generatedAt).toISOString().slice(0, 10) : 'data não registrada';
    const url = canonicalUrl(entry?.recapSourceUrl || entry?.sourceEvidence?.sourceUrl || entry?.url);
    const sourceText = String(context || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SOURCE_CONTEXT_CHARS);
    if (!sourceText) return null;
    return `TEMA: ${entry?.theme}\nTÍTULO PUBLICADO: ${entry?.title || title}\nTÍTULO DA FONTE: ${title}\nFONTE: ${source}\nDATA NO LEDGER: ${date}\nURL: ${url}\nTEXTO EXTRAÍDO DA FONTE: ${sourceText}`;
  }).filter(Boolean).join('\n\n');
}

function recapTitleForTheme(theme, env = process.env) {
  if (!theme || typeof theme.id !== 'string' || !theme.id.trim()
    || typeof theme.name !== 'string' || !theme.name.trim()) {
    throw new Error('metadados do tema são obrigatórios para criar recap');
  }
  const key = `RECAP_TITLE_${theme.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  return String(env[key] || `Resumo da semana em ${theme.name}`).trim();
}

async function createRecapBrief({ entries, theme, now = new Date(), days = 7, maxTopics = MAX_RECAP_TOPICS, extractContext, env = process.env } = {}) {
  if (typeof extractContext !== 'function') throw new Error('extrator de contexto é obrigatório para criar recap');
  if (!theme || typeof theme.id !== 'string' || !theme.id.trim()) throw new Error('tema obrigatório para criar recap');
  const selected = selectRecapEntries(entries, { themeId: theme.id, now, days, maxTopics });
  if (selected.length < MIN_RECAP_TOPICS) {
    const error = new Error(`recap exige pelo menos ${MIN_RECAP_TOPICS} pautas distintas, publicáveis e do tema ${theme.id}`);
    error.code = 'recap_insufficient_ledger_sources';
    throw error;
  }

  const contextualEntries = await Promise.all(selected.map(async entry => ({ entry, context: await extractContext(entry.recapSourceUrl) })));
  const usableEntries = contextualEntries.filter(item => String(item.context || '').trim());
  if (usableEntries.length < MIN_RECAP_TOPICS) {
    const error = new Error(`recap de ${theme.id} exige texto verificável de pelo menos ${MIN_RECAP_TOPICS} fontes do ledger`);
    error.code = 'recap_source_context_unavailable';
    throw error;
  }

  const title = recapTitleForTheme(theme, env);
  const context = 'Resumo editorial das pautas aprovadas do mesmo tema. Conecte somente fatos sustentados pelos textos extraídos abaixo; não acrescente acontecimentos ausentes nas fontes.\n\n'
    + buildRecapContext(usableEntries);
  const sourceEvidence = assessSourceEvidence({ sourceTitle: title, context, mode: 'recap' });
  if (!sourceEvidence.eligible) {
    const error = new Error(`contexto de recap insuficiente para sustentar o roteiro: ${sourceEvidence.reason}`);
    error.code = sourceEvidence.reason || 'recap_source_context_insufficient';
    throw error;
  }
  return { title, themeId: theme.id, entries: usableEntries.map(item => item.entry), context, sourceEvidence };
}

module.exports = {
  MAX_RECAP_TOPICS,
  MIN_RECAP_TOPICS,
  buildRecapContext,
  claimRecapWindow,
  createRecapBrief,
  decideRecapGeneration,
  hasRecapWindow,
  isValidRecapWindow,
  recapTitleForTheme,
  recapWindowFor,
  recordRecapWindow,
  selectRecapEntries,
  weeklyRecapEnabled
};
