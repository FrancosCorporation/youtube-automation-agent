'use strict';

function validateLogger(logger) {
  if (!logger || typeof logger.logContentPipeline !== 'function') {
    throw new TypeError('logger de pipeline obrigatório');
  }
}

function logGenerationProcessStarted(logger, {
  videoId,
  jobId,
  destination = 'local_render'
}) {
  validateLogger(logger);
  logger.logContentPipeline('generation_process_started', videoId || 'unassigned', 'started', {
    ...(jobId ? { jobId } : {}),
    destination
  });
}

function logGenerationFinished(logger, {
  videoId,
  jobId,
  startedAt,
  status,
  errorCode,
  destination = 'local_render'
}, now = Date.now) {
  validateLogger(logger);
  if (!['completed', 'failed'].includes(status)) {
    throw new TypeError('status terminal de geração inválido');
  }

  const durationMs = Number.isFinite(startedAt) ? Math.max(0, now() - startedAt) : undefined;
  logger.logContentPipeline('generation_finished', videoId || 'unassigned', status, {
    ...(jobId ? { jobId } : {}),
    destination,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(status === 'failed' && errorCode ? { errorCode: String(errorCode).slice(0, 80) } : {})
  });
}

function logGenerationProcessFinished(logger, options, now = Date.now) {
  validateLogger(logger);
  if (!['completed', 'failed'].includes(options?.status)) {
    throw new TypeError('status terminal de processo de geração inválido');
  }

  const durationMs = Number.isFinite(options.startedAt) ? Math.max(0, now() - options.startedAt) : undefined;
  logger.logContentPipeline('generation_process_finished', options.videoId || 'unassigned', options.status, {
    ...(options.jobId ? { jobId: options.jobId } : {}),
    destination: options.destination || 'local_render',
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(options.status === 'failed' && options.errorCode
      ? { errorCode: String(options.errorCode).slice(0, 80) }
      : {})
  });
}

module.exports = {
  logGenerationFinished,
  logGenerationProcessFinished,
  logGenerationProcessStarted
};
