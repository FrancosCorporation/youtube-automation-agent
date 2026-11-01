'use strict';

const { videoIdForPath } = require('./observability-ids');
const { publicationSucceeded } = require('./publication-status');

const PUBLICATION_STATUSES = new Set([
  'attempting', 'submitted', 'processing', 'confirmed', 'unknown', 'failed', 'skipped'
]);

function normalizedStatus(result) {
  if (result && typeof result === 'object' && PUBLICATION_STATUSES.has(result.status)) {
    return result.status;
  }
  if (publicationSucceeded(result)) return 'confirmed';
  if (typeof result === 'string' && /^(?:desativado\b|pulado\b|ignorado:|não logado$|não alvo$)/i.test(result.trim())) {
    return 'skipped';
  }
  return 'unknown';
}

function createPersistThenObservePublicationState({ persist, observe }) {
  if (typeof persist !== 'function' || typeof observe !== 'function') {
    throw new TypeError('persistência e observador de publicação são obrigatórios');
  }
  return async event => {
    await persist(event);
    observe(event);
  };
}

function createPublicationObserver({ logger, jobId, videoId, now = Date.now }) {
  if (!logger || typeof logger.logPublishing !== 'function') {
    throw new TypeError('logger de publicação obrigatório');
  }
  if (typeof jobId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(jobId)
    || typeof videoId !== 'string' || !/^vid_[a-f0-9]{24}$/.test(videoId)) {
    throw new TypeError('jobId e videoId opacos válidos são obrigatórios para observabilidade de publicação');
  }

  const attempts = new Map();
  return event => {
    if (!event || !['long', 'clip'].includes(event.scope)
      || typeof event.platform !== 'string' || !event.platform.trim()
      || typeof event.artifactPath !== 'string' || !event.artifactPath.trim()) return;

    const artifactId = videoIdForPath(event.artifactPath);
    const key = `${event.scope}:${event.platform}:${artifactId}`;
    const status = normalizedStatus(event.result);
    const timestamp = now();
    let durationMs;
    if (status === 'attempting') {
      attempts.set(key, timestamp);
    } else if (attempts.has(key)) {
      durationMs = Math.max(0, timestamp - attempts.get(key));
      attempts.delete(key);
    }

    const result = event.result && typeof event.result === 'object' ? event.result : {};
    const failureCode = typeof result.failureCode === 'string'
      && /^[a-z0-9_]{1,50}$/i.test(result.failureCode)
      ? result.failureCode
      : undefined;
    logger.logPublishing(`upload_${event.scope}`, videoId, status, {
      jobId,
      destination: event.platform,
      artifactId,
      scope: event.scope,
      ...(Number.isSafeInteger(result.attemptCount) ? { attemptCount: result.attemptCount } : {}),
      ...(Number.isInteger(result.httpStatus) ? { httpStatus: result.httpStatus } : {}),
      ...(failureCode ? { failureCode } : {}),
      ...(durationMs != null ? { durationMs } : {})
    });
  };
}

module.exports = { createPersistThenObservePublicationState, createPublicationObserver, normalizedStatus };
