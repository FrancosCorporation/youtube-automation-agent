'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  logGenerationFinished,
  logGenerationProcessFinished,
  logGenerationProcessStarted
} = require('../utils/generation-observability');

test('generation completion records a correlated terminal event and elapsed time', () => {
  const events = [];
  logGenerationFinished({ logContentPipeline: (...event) => events.push(event) }, {
    videoId: 'vid_0123456789abcdef01234567',
    jobId: 'job-resume-123',
    startedAt: 1000,
    status: 'completed'
  }, () => 1630);

  assert.deepEqual(events, [[
    'generation_finished',
    'vid_0123456789abcdef01234567',
    'completed',
    { jobId: 'job-resume-123', destination: 'local_render', durationMs: 630 }
  ]]);
});

test('generation failure records only a bounded error code and supports an unassigned job', () => {
  const events = [];
  logGenerationFinished({ logContentPipeline: (...event) => events.push(event) }, {
    startedAt: 100,
    status: 'failed',
    errorCode: `E_RENDER_${'x'.repeat(100)}`
  }, () => 95);

  assert.deepEqual(events, [[
    'generation_finished',
    'unassigned',
    'failed',
    { destination: 'local_render', durationMs: 0, errorCode: `E_RENDER_${'x'.repeat(71)}` }
  ]]);
});

test('generation terminal event rejects unsupported statuses and missing loggers', () => {
  assert.throws(() => logGenerationFinished(null, { status: 'completed' }), /logger de pipeline obrigatório/);
  assert.throws(() => logGenerationFinished({ logContentPipeline() {} }, { status: 'started' }), /status terminal de geração inválido/);
});

test('scheduler process lifecycle uses distinct stages from the generator lifecycle', () => {
  const events = [];
  const logger = { logContentPipeline: (...event) => events.push(event) };

  logGenerationProcessStarted(logger, {
    videoId: 'vid_0123456789abcdef01234567',
    jobId: 'job-resume-123'
  });
  logGenerationProcessFinished(logger, {
    videoId: 'vid_0123456789abcdef01234567',
    jobId: 'job-resume-123',
    startedAt: 100,
    status: 'failed',
    errorCode: 'exit_1'
  }, () => 450);

  assert.deepEqual(events, [
    [
      'generation_process_started',
      'vid_0123456789abcdef01234567',
      'started',
      { jobId: 'job-resume-123', destination: 'local_render' }
    ],
    [
      'generation_process_finished',
      'vid_0123456789abcdef01234567',
      'failed',
      { jobId: 'job-resume-123', destination: 'local_render', durationMs: 350, errorCode: 'exit_1' }
    ]
  ]);
  assert.throws(() => logGenerationProcessFinished(logger, { status: 'running' }), /status terminal de processo de geração inválido/);
});
