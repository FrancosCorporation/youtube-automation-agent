'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { critiqueScript } = require('../scripts/generate-animated-video');
const {
  buildSourceFreshnessGuidance,
  hasStaleRelativeFreshnessWording,
  inspectSourceFreshness
} = require('../utils/source-freshness');

test('freshness uses the Sao Paulo calendar day as well as a 24-hour age threshold', () => {
  const saturdayMorning = new Date('2026-10-17T11:09:57.000Z');
  const previousDay = inspectSourceFreshness(16, saturdayMorning);
  assert.equal(previousDay.currentLocalDate, '2026-10-17');
  assert.equal(previousDay.publishedLocalDate, '2026-10-16');
  assert.equal(previousDay.stale, true);
  assert.match(buildSourceFreshnessGuidance(16, saturdayMorning), /16\/10\/2026/);

  const sameDay = inspectSourceFreshness(6, saturdayMorning);
  assert.equal(sameDay.sameLocalDate, true);
  assert.equal(sameDay.stale, false);
  assert.equal(buildSourceFreshnessGuidance(6, saturdayMorning), '');
});

test('stale relative wording catches today and deictic weekdays, but accepts explicit past attribution', () => {
  const saturdayMorning = new Date('2026-10-17T11:09:57.000Z');
  assert.equal(hasStaleRelativeFreshnessWording({ title: 'Horóscopo financeiro de hoje' }, 16, saturdayMorning), true);
  assert.equal(hasStaleRelativeFreshnessWording({
    sections: [{ content: 'O horóscopo desta sexta-feira recomenda revisar o orçamento.' }]
  }, 16, saturdayMorning), true);
  assert.equal(hasStaleRelativeFreshnessWording({
    title: 'Como organizar as finanças',
    publicationMetadata: {
      youtubeTitle: 'Horóscopo financeiro de hoje',
      description: 'Veja as previsões desta sexta-feira para o orçamento.'
    }
  }, 16, saturdayMorning), true);
  assert.equal(hasStaleRelativeFreshnessWording({
    conclusion: 'Na matéria publicada em 16 de outubro, o veículo descreveu a leitura astrológica.'
  }, 16, saturdayMorning), false);
  assert.equal(hasStaleRelativeFreshnessWording({ title: 'Tema de hoje' }, 6, saturdayMorning), false);
});

test('script review rejects stale SEO wording before any external reviewer request', async () => {
  const previousApiKey = process.env.NVIDIA_API_KEY;
  const previousNoCritic = process.env.NO_SCRIPT_CRITIC;
  process.env.NVIDIA_API_KEY = 'test-key-for-deterministic-review';
  delete process.env.NO_SCRIPT_CRITIC;
  try {
    const review = await critiqueScript({
      title: 'Planejamento financeiro para o fim de semana',
      hook: 'Uma análise de entretenimento.',
      sections: [{ title: 'Contexto', content: 'O veículo publicou as previsões.' }],
      conclusion: 'Consulte fontes confiáveis.',
      publicationMetadata: {
        youtubeTitle: 'Horóscopo financeiro de hoje',
        description: 'As previsões desta sexta-feira.'
      }
    }, 'horóscopo financeiro', 'Horóscopo financeiro publicado ontem', 'https://example.test', 'contexto suficiente', 48);

    assert.equal(review.verdict, 'reprovado');
    assert.match(review.feedback, /data local/i);
    assert.match(review.feedback, /7–12 palavras/);
  } finally {
    if (previousApiKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousApiKey;
    if (previousNoCritic === undefined) delete process.env.NO_SCRIPT_CRITIC;
    else process.env.NO_SCRIPT_CRITIC = previousNoCritic;
  }
});
