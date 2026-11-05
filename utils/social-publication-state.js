'use strict';

const path = require('node:path');
const { updateTopicLedger } = require('./topic-ledger');
const { createPublicationResult, nextPublicationRetryAt, publicationSucceeded } = require('./publication-status');
const { youtubeQuotaRetryAt } = require('./youtube-quota-state');
const { sha256StableRegularFile } = require('./video-qa-manifest');

const SAFE_NO_SEND_RETRY_BASE_MS = 60 * 1000;
const SAFE_NO_SEND_RETRY_MAX_MS = 30 * 60 * 1000;
const OAUTH_RETRY_BASE_MS = 30 * 60 * 1000;
const OAUTH_RETRY_MAX_MS = 6 * 60 * 60 * 1000;

function resolveArtifactPath(root, candidate) {
  return path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
}

function sameArtifactPath(root, left, right) {
  if (!left || !right) return false;
  return resolveArtifactPath(root, left) === resolveArtifactPath(root, right);
}

function structuredResultMatchesTarget(value, target) {
  if (!target || !value || typeof value !== 'object') return true;
  return typeof value.platform === 'string'
    && typeof target.platform === 'string'
    && value.platform.toLowerCase() === target.platform.toLowerCase()
    && sameArtifactPath(target.root || path.resolve(__dirname, '..'), value.artifact?.path, target.artifactPath);
}

function validatePublicationEvent(entry, event, root) {
  const listedClips = (Array.isArray(entry.clips) ? entry.clips : [])
    .map(item => typeof item === 'string' ? item : item?.path)
    .filter(Boolean);
  const recordedClipPaths = entry.results?.clips && typeof entry.results.clips === 'object'
    ? Object.keys(entry.results.clips)
    : [];
  const artifacts = event.scope === 'long'
    ? [entry.videoPath].filter(Boolean)
    : [...listedClips, ...recordedClipPaths];
  const artifactPath = artifacts.find(candidate => sameArtifactPath(root, candidate, event.artifactPath));
  if (!artifactPath) throw new TypeError('evento de publicação não corresponde a um artefato do ledger');

  const result = event.result;
  if (typeof result === 'string') return;
  const allowedStatuses = new Set(['attempting', 'submitted', 'processing', 'confirmed', 'unknown', 'failed', 'skipped']);
  if (!result || typeof result !== 'object' || !allowedStatuses.has(result.status)
    || typeof result.platform !== 'string' || result.platform.toLowerCase() !== event.platform.toLowerCase()
    || !sameArtifactPath(root, result.artifact?.path, artifactPath)
    || (result.artifact?.sha256 != null && !/^[a-f0-9]{64}$/i.test(String(result.artifact.sha256)))
    || (result.status === 'confirmed' && !publicationSucceeded(result))) {
    throw new TypeError('resultado de publicação não corresponde ao destino/artefato ou não é válido');
  }
}

function retryIsDue(previous, now = Date.now()) {
  if (previous?.status !== 'skipped' || previous.retryable !== true
    || !['quota_exceeded', 'rate_limited'].includes(previous.failureCode)
    || previous.evidence?.kind !== 'api_rejected'
    || typeof previous.evidence?.observed !== 'string' || !previous.evidence.observed.trim()) return false;
  const nextAttempt = Date.parse(previous.nextAttemptAt || '');
  return Number.isFinite(nextAttempt) && nextAttempt <= now;
}

function isConfirmedPreSubmitFailure(previous) {
  return previous?.status === 'failed'
    && (['pre_submit_ui_error', 'android_storage_insufficient', 'youtube_upload_limit'].includes(previous.failureCode)
      || (previous.platform === 'x'
        && /^x_(?:input|identity|composer|existing_draft|media_upload|media_readiness)_failed$/.test(String(previous.failureCode || '')))
      || (['youtube', 'shorts'].includes(previous.platform)
        && (/^YOUTUBE_STUDIO_[A-Z0-9_]+$/.test(String(previous.failureCode || ''))
          || (previous.failureCode === 'youtube_studio_pre_submit_failed'
            && /net::ERR_(?:NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|NETWORK_CHANGED|CONNECTION_(?:RESET|CLOSED|TIMED_OUT))/i
              .test(String(previous.evidence?.observed || ''))))))
    && previous.evidence?.kind === 'confirmed_no_send'
    && typeof previous.evidence?.observed === 'string'
    && Boolean(previous.evidence.observed.trim());
}

function safeNoSendRetryDelayMs(attemptCount, failureCode = '') {
  if (failureCode === 'android_storage_insufficient') return SAFE_NO_SEND_RETRY_MAX_MS;
  const attempt = Number.isSafeInteger(attemptCount) && attemptCount > 0 ? attemptCount : 1;
  return Math.min(SAFE_NO_SEND_RETRY_MAX_MS,
    SAFE_NO_SEND_RETRY_BASE_MS * (2 ** Math.min(attempt - 1, 10)));
}

function confirmedNoSendRetryAt(previous) {
  if (!isConfirmedPreSubmitFailure(previous)) return NaN;
  const explicit = Date.parse(previous.nextAttemptAt || '');
  if (Number.isFinite(explicit)) return explicit;
  const submittedAt = Date.parse(previous.submittedAt || '');
  if (!Number.isFinite(submittedAt)) return NaN;
  return submittedAt + safeNoSendRetryDelayMs(previous.attemptCount, previous.failureCode);
}

function confirmedNoSendRetryIsDue(previous, now = Date.now()) {
  const retryAt = confirmedNoSendRetryAt(previous);
  return Number.isFinite(retryAt) && retryAt <= now;
}

function isKnownOAuthNoSend(previous) {
  return previous?.status === 'failed'
    && ['youtube', 'shorts'].includes(previous?.platform)
    && previous?.failureCode === 'oauth_invalid_grant'
    && previous?.evidence?.kind === 'api_rejected';
}

function oauthRetryAt(previous) {
  if (!isKnownOAuthNoSend(previous)) return NaN;
  const explicit = Date.parse(previous.nextAttemptAt || '');
  if (Number.isFinite(explicit)) return explicit;
  const submittedAt = Date.parse(previous.submittedAt || '');
  if (!Number.isFinite(submittedAt)) return NaN;
  const attempt = Number.isSafeInteger(previous.attemptCount) && previous.attemptCount > 0
    ? previous.attemptCount : 1;
  const delayMs = Math.min(OAUTH_RETRY_MAX_MS,
    OAUTH_RETRY_BASE_MS * (2 ** Math.min(attempt - 1, 10)));
  return submittedAt + delayMs;
}

function oauthRetryIsDue(previous, now = Date.now()) {
  const retryAt = oauthRetryAt(previous);
  return Number.isFinite(retryAt) && retryAt <= now;
}

function shouldAttemptPublication(previous, now = Date.now(), target = null) {
  if (previous == null || previous === '') return true;
  if (!structuredResultMatchesTarget(previous, target)) return false;
  if (publicationSucceeded(previous)) return false;
  if (previous?.failureCode === 'social_handler_unavailable') return target?.handlerAvailable === true;
  if (previous?.failureCode === 'social_account_identity_unverified') {
    return target?.handlerAvailable === true && target?.identityVerified === true;
  }
  if (confirmedNoSendRetryIsDue(previous, now)) return true;
  if (isKnownOAuthNoSend(previous)) {
    // Old videos without a hash-bound QA manifest stay held for manual review;
    // reauthorizing YouTube must not release stale/legacy media automatically.
    if (!target?.qaManifestPath) return false;
    return oauthRetryIsDue(previous, now);
  }
  if (typeof previous === 'string') {
    return /^(?:desativado(?:\b.*)?|pulado(?:\s.*)?|ignorado(?::|\s).+|n[aã]o logado)$/i.test(previous.trim());
  }
  return retryIsDue(previous, now);
}

function shouldRetrySocialAutomatically(previous, now = Date.now(), target = null) {
  if (previous == null || previous === '') {
    return Boolean(target?.handlerAvailable === true
      && typeof target.platform === 'string'
      && typeof target.artifactPath === 'string'
      && target.artifactPath.trim());
  }
  if (!structuredResultMatchesTarget(previous, target)) return false;
  if (previous?.failureCode === 'social_handler_unavailable') return target?.handlerAvailable === true;
  if (previous?.failureCode === 'social_account_identity_unverified') {
    return target?.handlerAvailable === true && target?.identityVerified === true;
  }
  if (previous === 'não logado') return true;
  return retryIsDue(previous, now) || confirmedNoSendRetryIsDue(previous, now);
}

// This is only a scheduler prefilter, not authorization to publish. Include a
// previously unverified identity so the retry worker can inspect the session
// again after the owner logs in; the worker must still verify it before upload.
function shouldInspectSocialRetry(previous, now = Date.now(), target = null) {
  return shouldRetrySocialAutomatically(previous, now, target ? { ...target, identityVerified: true } : target);
}

function normalizeUploadPublication(value, platform, videoPath, attemptCount, artifactSha256 = null) {
  if (typeof value === 'string' && publicationSucceeded(value)) {
    if (!artifactSha256) return value;
    const url = value.trim();
    let externalId = null;
    try {
      const parsed = new URL(url);
      externalId = parsed.searchParams.get('v') || parsed.pathname.split('/').filter(Boolean).at(-1) || null;
    } catch (_error) { /* Keep the URL as the proof when no stable ID can be parsed. */ }
    return createPublicationResult({
      platform,
      videoPath,
      artifactSha256,
      status: 'confirmed',
      url,
      externalId,
      attemptCount,
      evidence: { kind: 'upload_response', observed: 'destino retornou URL pública para o envio deste artefato hash-bound' }
    });
  }
  const structuredResult = value && typeof value === 'object' && typeof value.status === 'string';
  if (structuredResult) {
    const sameArtifact = typeof value.artifact?.path === 'string'
      && path.resolve(value.artifact.path) === path.resolve(videoPath);
    const samePlatform = value.platform === platform;
    const validStatus = ['attempting', 'submitted', 'processing', 'confirmed', 'unknown', 'failed', 'skipped'].includes(value.status);
    if (!sameArtifact || !samePlatform || !validStatus
      || (value.status === 'confirmed' && !publicationSucceeded(value))) {
      return createPublicationResult({
        platform,
        videoPath,
        ...(artifactSha256 ? { artifactSha256 } : {}),
        status: 'unknown',
        attemptCount,
        evidence: {
          kind: 'invalid_adapter_result',
          observed: 'resultado estruturado não corresponde à plataforma/arquivo solicitado ou não prova confirmação'
        }
      });
    }
    if (artifactSha256 && value.artifact?.sha256 && value.artifact.sha256 !== artifactSha256) {
      return createPublicationResult({
        platform,
        videoPath,
        artifactSha256,
        status: 'unknown',
        attemptCount,
        failureCode: 'artifact_hash_mismatch',
        evidence: { kind: 'adapter_artifact_hash_mismatch', observed: 'o resultado do destino aponta para outro hash do artefato' }
      });
    }
    const normalized = {
      ...value,
      artifact: { ...value.artifact },
      ...(Number.isSafeInteger(value.attemptCount) ? {} : { attemptCount })
    };
    if (artifactSha256) normalized.artifact = { ...normalized.artifact, sha256: artifactSha256 };
    if (isConfirmedPreSubmitFailure(normalized)
      && !Number.isFinite(Date.parse(normalized.nextAttemptAt || ''))) {
      const submittedAt = Date.parse(normalized.submittedAt || '');
      if (Number.isFinite(submittedAt)) {
        normalized.nextAttemptAt = new Date(submittedAt + safeNoSendRetryDelayMs(
          normalized.attemptCount, normalized.failureCode
        )).toISOString();
      }
    }
    return normalized;
  }
  return createPublicationResult({
    platform,
    videoPath,
    ...(artifactSha256 ? { artifactSha256 } : {}),
    status: 'submitted',
    attemptCount,
    evidence: { kind: 'submission_unverified', observed: 'uploader terminou sem URL ou confirmação estruturada' }
  });
}

function safeApiDiagnostic(value) {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return String(text)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/(access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|api[_-]?key)(["'\s:=]+)[^,}\s"']+/gi, '$1$2[redacted]')
    .slice(0, 240);
}

function knownRejectedUpload(error, platform, videoPath, attemptCount = 1, artifactSha256 = null) {
  const response = error?.response;
  const httpStatus = Number(response?.status);
  if (!Number.isInteger(httpStatus) || httpStatus < 400 || httpStatus >= 500) return null;
  const responseData = response?.data;
  const apiError = responseData?.error && typeof responseData.error === 'object'
    ? responseData.error
    : responseData;
  const reasons = apiError?.errors || error?.errors;
  const reason = Array.isArray(reasons)
    ? reasons.map(item => String(item?.reason || '')).filter(Boolean).join(' ')
    : '';
  const detail = [apiError?.message, apiError?.status, reason]
    .filter(value => typeof value === 'string' && value.trim())
    .join(' — ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .slice(0, 240)
    || safeApiDiagnostic(responseData)
    || safeApiDiagnostic(error?.message);
  const authRevoked = /invalid_grant|token has been expired or revoked/i.test(`${detail} ${safeApiDiagnostic(error?.message)}`);
  const quotaRejected = /quotaExceeded|dailyLimitExceeded|uploadLimitExceeded/i.test(reason);
  const rateLimited = httpStatus === 429 || /rateLimitExceeded|userRateLimitExceeded/i.test(reason);
  const retryable = quotaRejected || rateLimited;
  const failureCode = authRevoked ? 'oauth_invalid_grant'
    : quotaRejected ? 'quota_exceeded'
      : rateLimited ? 'rate_limited' : `http_${httpStatus}`;
  const result = createPublicationResult({
    platform,
    videoPath,
    ...(artifactSha256 ? { artifactSha256 } : {}),
    status: retryable ? 'skipped' : 'failed',
    retryable,
    failureCode,
    attemptCount,
    ...(quotaRejected && ['youtube', 'shorts'].includes(platform)
      ? { nextAttemptAt: youtubeQuotaRetryAt({ reason: /uploadLimitExceeded/i.test(reason)
        ? 'uploadLimitExceeded' : 'quotaExceeded', retryAfter: response?.headers?.['retry-after'] }) }
      : retryable ? { nextAttemptAt: nextPublicationRetryAt(attemptCount) }
      : authRevoked ? { nextAttemptAt: new Date(Date.now() + Math.min(OAUTH_RETRY_MAX_MS,
        OAUTH_RETRY_BASE_MS * (2 ** Math.min(Math.max(0, attemptCount - 1), 10)))).toISOString() } : {}),
    evidence: {
      kind: 'api_rejected',
      observed: authRevoked
        ? 'YouTube recusou a autenticação OAuth (invalid_grant; requer nova autorização da conta)'
        : `API recusou o envio (HTTP ${httpStatus}${quotaRejected ? '; cota' : rateLimited ? '; limite de requisições' : ''})${detail ? `: ${detail}` : ''}`
    }
  });
  if (quotaRejected) {
    result.apiReason = /uploadLimitExceeded/i.test(reason) ? 'uploadLimitExceeded' : 'quotaExceeded';
    result.retryTimeSource = response?.headers?.['retry-after'] ? 'retry_after_header' : 'documented_wait_estimate';
  }
  return result;
}

async function checkpointedPublication({ scope, platform, videoPath, previous, upload, onPublicationState, qaManifestPath, artifactSha256 = null, handlerAvailable = false, identityVerified = false }) {
  if (typeof onPublicationState !== 'function') throw new TypeError('callback de persistência por destino obrigatório');
  if (artifactSha256 != null && !/^[a-f0-9]{64}$/i.test(String(artifactSha256))) {
    throw new TypeError('hash SHA-256 aprovado para publicação inválido');
  }
  if (!shouldAttemptPublication(previous, Date.now(), {
    platform, artifactPath: videoPath, root: path.resolve(__dirname, '..'), qaManifestPath,
    handlerAvailable, identityVerified
  })) return previous;
  const persist = result => onPublicationState({ scope, platform, artifactPath: videoPath, result });
  const attemptCount = (Number.isSafeInteger(previous?.attemptCount) ? previous.attemptCount : 0) + 1;
  if (artifactSha256) {
    let current;
    try { current = await sha256StableRegularFile(videoPath); }
    catch (_error) {
      const result = createPublicationResult({
        platform, videoPath, artifactSha256, status: 'failed', attemptCount,
        failureCode: 'qa_asset_unavailable',
        evidence: { kind: 'confirmed_no_send', observed: 'o artefato hash-bound não estava disponível como arquivo estável; envio não iniciado' }
      });
      await persist(result);
      return result;
    }
    if (current.sha256 !== artifactSha256) {
      const result = createPublicationResult({
        platform, videoPath, artifactSha256, status: 'failed', attemptCount,
        failureCode: 'qa_asset_hash_mismatch',
        evidence: { kind: 'confirmed_no_send', observed: 'o arquivo atual difere do hash aprovado no manifesto QA; envio não iniciado' }
      });
      await persist(result);
      return result;
    }
  }
  await persist(createPublicationResult({
    platform,
    videoPath,
    ...(artifactSha256 ? { artifactSha256 } : {}),
    status: 'attempting',
    attemptCount,
    evidence: { kind: 'durable_intent', observed: 'intenção salva antes de iniciar o envio' }
  }));

  let outcome;
  try {
    outcome = normalizeUploadPublication(await upload(), platform, videoPath, attemptCount, artifactSha256);
  } catch (error) {
    outcome = knownRejectedUpload(error, platform, videoPath, attemptCount, artifactSha256) || createPublicationResult({
      platform,
      videoPath,
      ...(artifactSha256 ? { artifactSha256 } : {}),
      status: 'unknown',
      attemptCount,
      evidence: { kind: 'attempt_outcome_unknown', observed: 'envio iniciado; verificar a conta antes de qualquer nova tentativa' }
    });
  }
  if (artifactSha256) {
    let current;
    try { current = await sha256StableRegularFile(videoPath); }
    catch (_error) { current = null; }
    if (!current || current.sha256 !== artifactSha256) {
      outcome = createPublicationResult({
        platform,
        videoPath,
        artifactSha256,
        status: 'unknown',
        attemptCount,
        failureCode: 'artifact_changed_during_upload',
        evidence: { kind: 'artifact_changed_after_submission', observed: 'o arquivo não conserva o hash aprovado após a tentativa; reconciliar o destino antes de qualquer nova ação' }
      });
    }
  }
  await persist(outcome);
  return outcome;
}

async function recordNoSend({ scope, platform, videoPath, previous, result, onPublicationState }) {
  if (typeof onPublicationState !== 'function') throw new TypeError('callback de persistência por destino obrigatório');
  if (!shouldAttemptPublication(previous, Date.now(), {
    platform, artifactPath: videoPath, root: path.resolve(__dirname, '..')
  })) return previous;
  await onPublicationState({ scope, platform, artifactPath: videoPath, result });
  return result;
}

function priorClipResult(results, artifactPath, root) {
  const match = Object.entries(results?.clips || {}).find(([candidate]) => sameArtifactPath(root, candidate, artifactPath));
  return match ? { key: match[0], value: match[1] } : { key: artifactPath, value: {} };
}

function applyPublicationResult(entry, event, root) {
  validatePublicationEvent(entry, event, root);
  const current = entry.results && typeof entry.results === 'object' ? entry.results : {};
  const results = {
    ...current,
    long: { ...(current.long || {}) },
    clips: { ...(current.clips || {}) }
  };
  if (event.scope === 'long') {
    const previous = results.long[event.platform];
    if (publicationSucceeded(previous) && !publicationSucceeded(event.result)) return results;
    results.long[event.platform] = event.result;
    const youtubeUrl = typeof event.result === 'string' ? event.result : event.result?.url;
    if (event.platform === 'youtube' && typeof youtubeUrl === 'string' && /^https?:\/\//i.test(youtubeUrl)) {
      entry.ytUrl = youtubeUrl;
    }
  } else if (event.scope === 'clip') {
    const prior = priorClipResult(results, event.artifactPath, root);
    const previous = prior.value?.[event.platform];
    if (publicationSucceeded(previous) && !publicationSucceeded(event.result)) return results;
    results.clips[prior.key] = { ...(prior.value || {}), [event.platform]: event.result };
  } else {
    throw new TypeError(`escopo de publicação inválido: ${event.scope}`);
  }
  entry.results = results;
  return results;
}

async function recordPublicationResult(ledgerPath, masterPath, event, options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  if (!event || !['long', 'clip'].includes(event.scope)) throw new TypeError('escopo de publicação inválido');
  if (typeof event.platform !== 'string' || !event.platform.trim()) throw new TypeError('plataforma obrigatória');
  if (typeof event.artifactPath !== 'string' || !event.artifactPath.trim()) throw new TypeError('caminho do artefato obrigatório');
  let matched = false;
  await updateTopicLedger(ledgerPath, ledger => {
    for (const entry of [...ledger.entries].reverse()) {
      if (!entry || !sameArtifactPath(root, entry.videoPath, masterPath)) continue;
      applyPublicationResult(entry, event, root);
      matched = true;
      break;
    }
    if (!matched) throw new Error(`entrada do ledger não encontrada para ${masterPath}`);
    return ledger;
  });
  return true;
}

async function reconcileInterruptedPublicationAttempts(ledgerPath, masterPath, options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  const reconciledAt = new Date(options.now ?? Date.now()).toISOString();
  let matched = false;
  let reconciled = 0;

  await updateTopicLedger(ledgerPath, ledger => {
    for (const entry of [...ledger.entries].reverse()) {
      if (!entry || !sameArtifactPath(root, entry.videoPath, masterPath)) continue;
      matched = true;
      const allowedArtifacts = [entry.videoPath, ...(Array.isArray(entry.clips) ? entry.clips : [])]
        .map(item => typeof item === 'string' ? item : item?.path)
        .filter(Boolean);

      const markInterrupted = (platform, result) => {
        if (!result || typeof result !== 'object' || result.status !== 'attempting'
          || result.platform !== platform || typeof result.artifact?.path !== 'string'
          || !allowedArtifacts.some(candidate => sameArtifactPath(root, candidate, result.artifact.path))) {
          return result;
        }
        reconciled++;
        return {
          ...result,
          status: 'unknown',
          reconciledAt,
          evidence: {
            kind: 'interrupted_attempt_reconciliation',
            observed: 'scheduler reiniciado durante a tentativa; confira a conta antes de reenviar'
          }
        };
      };

      const results = entry.results && typeof entry.results === 'object' ? entry.results : {};
      if (results.long && typeof results.long === 'object') {
        for (const [platform, result] of Object.entries(results.long)) {
          results.long[platform] = markInterrupted(platform, result);
        }
      }
      if (results.clips && typeof results.clips === 'object') {
        for (const clipResults of Object.values(results.clips)) {
          if (!clipResults || typeof clipResults !== 'object') continue;
          for (const [platform, result] of Object.entries(clipResults)) {
            clipResults[platform] = markInterrupted(platform, result);
          }
        }
      }
      entry.results = results;
      break;
    }
    return ledger;
  });

  return { matched, reconciled };
}

module.exports = {
  applyPublicationResult,
  checkpointedPublication,
  knownRejectedUpload,
  priorClipResult,
  recordNoSend,
  recordPublicationResult,
  reconcileInterruptedPublicationAttempts,
  retryIsDue,
  shouldInspectSocialRetry,
  shouldRetrySocialAutomatically,
  shouldAttemptPublication
};
