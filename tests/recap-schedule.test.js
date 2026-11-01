'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildRecapContext,
  claimRecapWindow,
  createRecapBrief,
  decideRecapGeneration,
  hasRecapWindow,
  recapTitleForTheme,
  recapWindowFor,
  recordRecapWindow,
  selectRecapEntries,
  weeklyRecapEnabled
} = require('../utils/recap-schedule');
const {
  assessSourceEvidence,
  createPublicationReview,
  createTopicRecord
} = require('../utils/source-evidence');

const now = new Date('2026-10-17T12:00:00.000Z');
const anchorAt = '2026-10-03T12:00:00.000Z';

function eligibleEntry({ theme = 'ia', title, sourceTitle = title, url, generatedAt = '2026-10-16T12:00:00.000Z' }) {
  const articleText = `${sourceTitle}. ${'A reportagem informa dados e contexto verificável para resumir o assunto com precisão. '.repeat(12)}`;
  const sourceEvidence = assessSourceEvidence({ sourceTitle, sourceUrl: url, context: articleText, mode: 'article' });
  const publicationReview = createPublicationReview({
    verdict: 'aprovado',
    sourceContext: articleText,
    reviewer: 'fixture-reviewer',
    checkedAt: generatedAt
  });
  return createTopicRecord({
    theme,
    title,
    source: 'Fonte de teste',
    url,
    sourceEvidence,
    publicationReview,
    publicationEligible: true
  }, generatedAt);
}

test('calendar opens after one full cadence and claims at most once per theme/window', () => {
  assert.equal(recapWindowFor({ anchorAt, now: '2026-10-10T11:59:59.999Z', everyDays: 7, themeId: 'ia' }), null);

  const due = claimRecapWindow({}, { anchorAt, now: '2026-10-10T12:00:00.000Z', everyDays: 7, themeId: 'ia' });
  assert.equal(due.claimed, true);
  assert.equal(due.window.windowIndex, 0);
  assert.equal(due.window.key, 'ia:0');

  const duplicate = claimRecapWindow(due.state, { anchorAt, now: '2026-10-11T12:00:00.000Z', everyDays: 7, themeId: 'ia' });
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.reason, 'already_claimed');

  const otherTheme = claimRecapWindow(due.state, { anchorAt, now: '2026-10-11T12:00:00.000Z', everyDays: 7, themeId: 'fitness' });
  assert.equal(otherTheme.claimed, true);

  const followingWindow = claimRecapWindow(due.state, { anchorAt, now: '2026-10-17T12:00:00.000Z', everyDays: 7, themeId: 'ia' });
  assert.equal(followingWindow.claimed, true);
  assert.equal(followingWindow.window.windowIndex, 1);
});

test('producer recap gate is opt-in and persisted queue/state prevent duplicate windows', () => {
  assert.equal(weeklyRecapEnabled({}), false);
  assert.equal(weeklyRecapEnabled({ ENABLE_WEEKLY_RECAP: 'true' }), false);
  assert.equal(weeklyRecapEnabled({ ENABLE_WEEKLY_RECAP: '1' }), true);

  const window = recapWindowFor({ anchorAt, now, everyDays: 7, themeId: 'ia' });
  assert.equal(decideRecapGeneration({
    enabled: false,
    state: {},
    anchorAt,
    now,
    everyDays: 7,
    themeId: 'ia'
  }).reason, 'disabled');

  const due = decideRecapGeneration({ enabled: true, state: {}, anchorAt, now, everyDays: 7, themeId: 'ia' });
  assert.equal(due.recap, true);
  assert.equal(due.window.key, window.key);
  const queued = { recap: true, recapWindow: window };
  assert.equal(hasRecapWindow([queued], window), true);
  assert.equal(decideRecapGeneration({
    enabled: true,
    state: {},
    queue: [queued],
    anchorAt,
    now,
    everyDays: 7,
    themeId: 'ia'
  }).reason, 'already_queued');

  const recorded = recordRecapWindow({}, window);
  assert.equal(recorded.recapWindowsByTheme.ia, window.windowIndex);
  assert.equal(decideRecapGeneration({ enabled: true, state: recorded, anchorAt, now, everyDays: 7, themeId: 'ia' }).reason, 'already_claimed');
});

test('recap source selection uses only recent approved ledger entries for the requested theme and deduplicates', () => {
  const entries = [
    eligibleEntry({ title: 'IA anuncia novo modelo', url: 'https://news.example/modelo?utm_source=feed' }),
    eligibleEntry({ title: 'IA anuncia novo modelo duplicado', sourceTitle: 'IA anuncia novo modelo', url: 'https://news.example/modelo#article', generatedAt: '2026-10-16T13:00:00.000Z' }),
    eligibleEntry({ title: 'Pesquisa de robótica', url: 'https://science.example/robotica', generatedAt: '2026-10-15T12:00:00.000Z' }),
    eligibleEntry({ theme: 'fitness', title: 'Treino em estudo', url: 'https://fitness.example/estudo' }),
    eligibleEntry({ title: 'Pauta antiga', url: 'https://news.example/antiga', generatedAt: '2026-10-01T12:00:00.000Z' }),
    { ...eligibleEntry({ title: 'Recap anterior', url: 'https://news.example/recap' }), sourceEvidence: { ...eligibleEntry({ title: 'Recap anterior', url: 'https://news.example/recap' }).sourceEvidence, mode: 'recap' } },
    { ...eligibleEntry({ title: 'Sem aprovação', url: 'https://news.example/sem-aprovacao' }), publicationReview: { status: 'rejected' } }
  ];

  const selected = selectRecapEntries(entries, { themeId: 'ia', now, days: 7 });
  assert.deepEqual(selected.map(entry => entry.recapSourceTitle), ['IA anuncia novo modelo', 'Pesquisa de robótica']);
  assert.ok(selected.every(entry => entry.theme === 'ia'));
});

test('recap context includes extracted source text and titles use the selected theme metadata', () => {
  const selected = selectRecapEntries([
    eligibleEntry({ theme: 'fitness', title: 'A descoberta sobre corrida', url: 'https://fitness.example/corrida' })
  ], { themeId: 'fitness', now, days: 7 });
  const entry = selected[0];
  const context = buildRecapContext([{ entry, context: 'O estudo acompanhou participantes durante doze semanas e mediu resultados.' }]);

  assert.match(context, /TEMA: fitness/);
  assert.match(context, /TÍTULO DA FONTE: A descoberta sobre corrida/);
  assert.match(context, /TEXTO EXTRAÍDO DA FONTE: O estudo acompanhou participantes/);
  assert.equal(recapTitleForTheme({ id: 'fitness', name: 'Fitness & Treino Surpreendente' }, {}), 'Resumo da semana em Fitness & Treino Surpreendente');
  assert.equal(recapTitleForTheme({ id: 'fitness', name: 'Fitness' }, { RECAP_TITLE_FITNESS: 'Destaques do treino' }), 'Destaques do treino');
});

test('recap brief fetches source text from eligible ledger URLs and refuses insufficient evidence', async () => {
  const entries = [
    eligibleEntry({ title: 'Nova pesquisa de sono', url: 'https://health.example/sono' }),
    eligibleEntry({ title: 'Estudo sobre recuperação', url: 'https://health.example/recuperacao', generatedAt: '2026-10-15T12:00:00.000Z' })
  ];
  const calls = [];
  const brief = await createRecapBrief({
    entries,
    theme: { id: 'ia', name: 'Inteligência Artificial', brand: 'Pulso IA' },
    now,
    extractContext: async url => {
      calls.push(url);
      return `Fonte jornalística: ${url}. ${'O texto detalha fatos, método, resultados e limitações observadas para contextualizar a notícia com precisão. '.repeat(4)}`;
    }
  });

  assert.deepEqual(calls, ['https://health.example/sono', 'https://health.example/recuperacao']);
  assert.equal(brief.themeId, 'ia');
  assert.equal(brief.title, 'Resumo da semana em Inteligência Artificial');
  assert.equal(brief.entries.length, 2);
  assert.equal(brief.sourceEvidence.eligible, true);
  assert.match(brief.context, /TEXTO EXTRAÍDO DA FONTE/);

  await assert.rejects(createRecapBrief({
    entries: entries.slice(0, 1),
    theme: { id: 'ia', name: 'Inteligência Artificial' },
    now,
    extractContext: async () => 'contexto que não deve ser necessário'
  }), error => error.code === 'recap_insufficient_ledger_sources');

  await assert.rejects(createRecapBrief({
    entries,
    theme: { id: 'ia', name: 'Inteligência Artificial' },
    now,
    extractContext: async url => url.endsWith('/sono') ? 'texto disponível' : ''
  }), error => error.code === 'recap_source_context_unavailable');
});
