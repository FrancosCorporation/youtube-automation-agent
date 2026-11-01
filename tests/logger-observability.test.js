'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LOG_ROTATION, Logger } = require('../utils/logger');
const { REDACTED, isPrivateField, sanitizeLogData, sanitizeLogText } = require('../utils/log-sanitizer');

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  throw new Error(`arquivo de log não foi criado: ${path.basename(filePath)}`);
}

test('log sanitizer removes private fields and inline credentials but preserves correlation context', () => {
  assert.equal(isPrivateField('context'), false);
  assert.equal(isPrivateField('jobId'), false);
  assert.equal(isPrivateField('videoId'), false);
  assert.equal(isPrivateField('audioPath'), true);

  const sanitized = sanitizeLogData({
    jobId: 'job-7',
    videoId: 'video-3',
    destination: 'kwai',
    context: { durationMs: 32 },
    prompt: 'private prompt',
    audioPath: '/private/narration.mp3',
    api_key: 'sensitive-key',
    nested: { userText: 'private user text', status: 'failed' }
  });

  assert.equal(sanitized.jobId, 'job-7');
  assert.equal(sanitized.videoId, 'video-3');
  assert.equal(sanitized.destination, 'kwai');
  assert.deepEqual(sanitized.context, { durationMs: 32 });
  assert.equal(sanitized.prompt, REDACTED);
  assert.equal(sanitized.audioPath, REDACTED);
  assert.equal(sanitized.api_key, REDACTED);
  assert.deepEqual(sanitized.nested, { userText: REDACTED, status: 'failed' });

  const safeText = sanitizeLogText('Authorization: Bearer fake-private-secret prompt: "private phrase" token=inline-secret');
  assert.match(safeText, /Bearer \[REDACTED\]/);
  assert.doesNotMatch(safeText, /fake-private-secret|private phrase|inline-secret/);
});

test('Winston logs correlate pipeline and publication records, redact data, and retain configured rotation', async () => {
  const logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-logger-test-'));
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};

  const logger = new Logger('../Audit Agent', { logDir: logDirectory });
  assert.match(logger.component, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(LOG_ROTATION, {
    combined: { maxsize: 5 * 1024 * 1024, maxFiles: 5 },
    error: { maxsize: 5 * 1024 * 1024, maxFiles: 3 },
    component: { maxsize: 2 * 1024 * 1024, maxFiles: 3 }
  });

  try {
    logger.logContentPipeline('render', 'video-3', 'failed', {
      jobId: 'job-7',
      platform: 'kwai',
      durationMs: 1200,
      prompt: 'private prompt text',
      audioPath: '/private/narration.wav'
    });
    logger.logPublishing('upload', 'video-3', 'confirmed', {
      jobId: 'job-7',
      destination: 'kwai',
      requestBody: 'private caption text',
      url: 'https://api.example.test/post?access_token=secret-query-value'
    });
    logger.logAnalytics('video-3', { views: 10, apiKey: 'sensitive-api-key' }, ['private insight text']);
    logger.logErrorWithContext(new Error('upload failed for Bearer diagnostic-secret'), {
      jobId: 'job-7',
      transcript: 'private spoken text'
    });
    logger.startTimer('video render', { jobId: 'job-7' }).end();

    await new Promise(resolve => {
      logger.winston.once('finish', resolve);
      logger.winston.end();
    });

    const combinedPath = path.join(logDirectory, 'combined.log');
    await waitForFile(combinedPath);
    const combined = await fs.readFile(combinedPath, 'utf8');
    assert.doesNotMatch(combined, /private prompt text|narration\.wav|private caption text|secret-query-value|sensitive-api-key|private insight text|diagnostic-secret|private spoken text/);
    const records = combined.trim().split('\n').map(line => JSON.parse(line));
    const pipeline = records.find(record => record.message === 'Content Pipeline');
    const publishing = records.find(record => record.message === 'Publishing Event');
    const analytics = records.find(record => record.message === 'Analytics Update');
    const timing = records.find(record => record.message === 'Operation timing');

    assert.equal(pipeline.jobId, 'job-7');
    assert.equal(pipeline.videoId, 'video-3');
    assert.equal(pipeline.destination, 'kwai');
    assert.equal(pipeline.prompt, REDACTED);
    assert.equal(publishing.jobId, 'job-7');
    assert.equal(publishing.destination, 'kwai');
    assert.equal(publishing.requestBody, REDACTED);
    assert.equal(analytics.insightsCount, 1);
    assert.equal(timing.jobId, 'job-7');
    assert.equal(typeof timing.durationMs, 'number');
  } finally {
    console.log = originalLog;
    console.error = originalError;
    await fs.rm(logDirectory, { recursive: true, force: true });
  }
});

test('Winston file rotation enforces the configured retained-file count', async () => {
  const logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-logger-rotation-'));
  const originalLog = console.log;
  console.log = () => {};
  const logger = new Logger('Rotation Check', {
    logDir: logDirectory,
    rotation: {
      combined: { maxsize: 512, maxFiles: 2 },
      error: { maxsize: 512, maxFiles: 2 },
      component: { maxsize: 512, maxFiles: 2 }
    }
  });

  try {
    for (let index = 0; index < 40; index++) {
      logger.info('rotation marker', { sequence: index, payload: 'x'.repeat(100) });
    }
    await new Promise(resolve => {
      logger.winston.once('finish', resolve);
      logger.winston.end();
    });
    await waitForFile(path.join(logDirectory, 'combined.log'));
    const combinedFiles = (await fs.readdir(logDirectory)).filter(name => /^combined\d*\.log$/.test(name));
    assert.ok(combinedFiles.length > 1, 'deveria criar ao menos um arquivo rotacionado');
    assert.ok(combinedFiles.length <= 2, `retenção excedida: ${combinedFiles.join(', ')}`);
  } finally {
    console.log = originalLog;
    await fs.rm(logDirectory, { recursive: true, force: true });
  }
});
