'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  NO_FRESH_TOPIC_RETRY_DELAY_MS,
  formatGenerationRetryDelay,
  generationRetryDelayMs, isRetryableGenerationFailure,
  hasConfiguredAlternateWriterProvider,
  shouldBypassDailyBudgetBackoff
} = require('../utils/generation-retry');

test('generation retries wait for the UTC API-budget rollover without increasing the cap', () => {
  const now = new Date('2026-10-16T15:04:44.500Z');
  assert.equal(generationRetryDelayMs('budget_exhausted', now), 9 * 60 * 60 * 1000 - 4 * 60 * 1000 - 44_500 + 1000);
  assert.equal(formatGenerationRetryDelay(generationRetryDelayMs('budget_exhausted', now)), '8.9h');
  assert.equal(generationRetryDelayMs('no_fresh_topic_candidates', now), NO_FRESH_TOPIC_RETRY_DELAY_MS);
});

test('generation retry delay validates its clock and format input', () => {
  assert.throws(() => generationRetryDelayMs('budget_exhausted', new Date(Number.NaN)), /data inválida/);
  assert.throws(() => formatGenerationRetryDelay(Number.NaN), /atraso de retry inválido/);
});

test('recursos e autoria de cenas retomam sem o backoff genérico de cinco minutos', () => {
  assert.equal(generationRetryDelayMs('host_resource_gate'), 10000);
  assert.equal(generationRetryDelayMs('narrative_scene_provider_unavailable'), 30000);
  assert.equal(generationRetryDelayMs('narration_provider_unavailable'), 30000);
  assert.equal(isRetryableGenerationFailure('narration_provider_unavailable'), true);
});

test('fonte curta rejeitada troca de pauta após 30 s, sem repetir o mesmo roteiro nem aguardar a cota diária', () => {
  assert.equal(generationRetryDelayMs('source_context_too_short'), 30000);
  assert.equal(isRetryableGenerationFailure('source_context_too_short'), false);
  for (const code of ['youtube_longform_source_too_short', 'youtube_longform_narrative_too_short',
    'youtube_longform_narration_too_short']) {
    assert.equal(generationRetryDelayMs(code), 30000);
    assert.equal(isRetryableGenerationFailure(code), false);
  }
});

test('perfil contínuo avança uma pauta reprovada sem liberar fatos nem aumentar o orçamento', t => {
  const previous = process.env.PULSO_PIPELINED_PRODUCTION;
  t.after(() => {
    if (previous === undefined) delete process.env.PULSO_PIPELINED_PRODUCTION;
    else process.env.PULSO_PIPELINED_PRODUCTION = previous;
  });
  process.env.PULSO_PIPELINED_PRODUCTION = '0';
  assert.equal(generationRetryDelayMs('source_claims_unverified'), 5 * 60000);
  process.env.PULSO_PIPELINED_PRODUCTION = '1';
  assert.equal(generationRetryDelayMs('source_claims_unverified'), 30000);
  assert.equal(isRetryableGenerationFailure('source_claims_unverified'), false);
  assert(generationRetryDelayMs('budget_exhausted') > 30000);
});

test('a configured alternate model provider bypasses only the NVIDIA daily backoff', () => {
  assert.equal(hasConfiguredAlternateWriterProvider({ GEMINI_API_KEY: 'configured' }), true);
  assert.equal(hasConfiguredAlternateWriterProvider(
    { NVIDIA_API_KEY: 'configured', API_KEY: 'dashboard' }, { openCodeProviders: [], mimoCodeProvider: null }
  ), false);
  assert.equal(shouldBypassDailyBudgetBackoff('budget_exhausted', { GEMINI_API_KEY: 'configured' }), true);
  assert.equal(shouldBypassDailyBudgetBackoff('provider_unavailable', { GEMINI_API_KEY: 'configured' }), false);
  assert.equal(hasConfiguredAlternateWriterProvider(
    { NVIDIA_API_KEY: 'configured' }, { openCodeProviders: [{ id: 'mwapi' }] }
  ), true);
  assert.equal(shouldBypassDailyBudgetBackoff(
    'budget_exhausted', { NVIDIA_API_KEY: 'configured' }, { openCodeProviders: [{ id: 'mwapi' }] }
  ), true);
  assert.equal(hasConfiguredAlternateWriterProvider(
    { NVIDIA_API_KEY: 'configured' }, { openCodeProviders: [], mimoCodeProvider: { id: 'xiaomi' } }
  ), true);
});
