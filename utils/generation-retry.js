'use strict';

const DEFAULT_RETRY_DELAY_MS = 5 * 60 * 1000;
const NO_FRESH_TOPIC_RETRY_DELAY_MS = 30 * 1000;
const BUDGET_RESET_GRACE_MS = 1000;
const DAILY_RETRY_FAILURE_CODES = new Set([
  'budget_exhausted'
]);

function hasConfiguredAlternateWriterProvider(environment = process.env, { openCodeProviders, mimoCodeProvider } = {}) {
  if (environment.GEMINI_API_KEY) return true;
  const { PROVIDERS } = require('./ai-text-service');
  if (Object.entries(PROVIDERS).some(([provider, preset]) =>
    provider !== 'nvidia' && Boolean(environment[preset.envKey]))) return true;
  const { loadConfiguredMimoCodeProvider, loadConfiguredOpenCodeProviders } = require('./opencode-providers');
  const configuredOpenCode = openCodeProviders || loadConfiguredOpenCodeProviders();
  const configuredMimo = mimoCodeProvider === undefined ? loadConfiguredMimoCodeProvider() : mimoCodeProvider;
  return configuredOpenCode.length > 0 || Boolean(configuredMimo);
}

function shouldBypassDailyBudgetBackoff(failureCode, environment = process.env, options = {}) {
  return failureCode === 'budget_exhausted' && hasConfiguredAlternateWriterProvider(environment, options);
}

function delayUntilNextUtcDay(now) {
  // Only the daily API budget needs to wait for the UTC boundary. A rejected
  // source is quarantined by topic; other themes can continue after backoff.
  const nextUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return nextUtcDay - now.getTime() + BUDGET_RESET_GRACE_MS;
}

function generationRetryDelayMs(failureCode, now = new Date(), { retryAt } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('data inválida para retry da geração');
  const providerDelay = Date.parse(retryAt || '') - now.getTime();
  if (failureCode === 'narrative_scene_provider_unavailable' && Number.isFinite(providerDelay) && providerDelay > 0) {
    return Math.max(30000, Math.min(providerDelay, 24 * 60 * 60 * 1000 + BUDGET_RESET_GRACE_MS));
  }
  if (failureCode === 'no_fresh_topic_candidates') return NO_FRESH_TOPIC_RETRY_DELAY_MS;
  // A source rejected before writing/rendering should advance the theme
  // rotation promptly, without relaxing the minimum factual context.
  if (['source_context_too_short', 'youtube_longform_source_too_short',
    'youtube_longform_narrative_too_short', 'youtube_longform_narration_too_short'].includes(failureCode)) return 30000;
  if (failureCode === 'source_claims_unverified' && process.env.PULSO_PIPELINED_PRODUCTION === '1') return 30000;
  if (failureCode === 'host_resource_gate') return 10000;
  if (failureCode === 'narrative_scene_provider_unavailable') return DEFAULT_RETRY_DELAY_MS;
  if (failureCode === 'narration_provider_unavailable') return 30000;
  if (DAILY_RETRY_FAILURE_CODES.has(failureCode)) return delayUntilNextUtcDay(now);
  return DEFAULT_RETRY_DELAY_MS;
}

function isRetryableGenerationFailure(failureCode) {
  if (typeof failureCode !== 'string' || !failureCode.trim()) return false;
  const code = failureCode.trim().toLowerCase();
  // A pinned episode or its media may need repair; retain the in-flight
  // checkpoint rather than silently abandoning a partially rendered video.
  if (['generation_worker_interrupted', 'narration_alignment_failed', 'narrative_resume_plan_mismatch', 'narrative_asset_integrity_failed', 'narrative_render_output_collision'].includes(code)) return true;
  if (['source_claims_unverified', 'source_evidence_missing', 'source_context_too_short',
    'youtube_longform_source_too_short', 'youtube_longform_narrative_too_short', 'youtube_longform_narration_too_short',
    'budget_exhausted', 'no_fresh_topic_candidates', 'invalid_topic', 'theme_disabled',
    'video_technical_qa_failed'].includes(code)) return false;
  return /timeout|timed_out|rate.?limit|temporar|network|connection|provider_unavailable|host_resource|render.*(?:failed|timeout)|fetch_failed|http_5\d\d|econn|eai_again|enotfound|spawn_/.test(code);
}

function shouldDeferGenerationAttempt(failureCode, attemptCount) {
  return ['narrative_scene_provider_unavailable', 'narration_provider_unavailable', 'narration_alignment_failed']
    .includes(failureCode) && Number.isSafeInteger(attemptCount) && attemptCount >= 3;
}

function formatGenerationRetryDelay(delayMs) {
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError('atraso de retry inválido');
  if (delayMs < 60 * 1000) return `${Math.round(delayMs / 1000)}s`;
  if (delayMs < 60 * 60 * 1000) return `${Math.round(delayMs / 60000)} min`;
  return `${(delayMs / 3600000).toFixed(1)}h`;
}

module.exports = {
  DEFAULT_RETRY_DELAY_MS,
  DAILY_RETRY_FAILURE_CODES,
  NO_FRESH_TOPIC_RETRY_DELAY_MS,
  delayUntilNextUtcDay,
  formatGenerationRetryDelay,
  hasConfiguredAlternateWriterProvider,
  generationRetryDelayMs,
  isRetryableGenerationFailure,
  shouldDeferGenerationAttempt,
  shouldBypassDailyBudgetBackoff
};
