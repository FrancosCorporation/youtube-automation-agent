'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { publicReport, readDailyPerformanceReports } = require('../utils/daily-performance-view');
const { createSchedulerRuntimeWriter, latestGenerationFailure, nextSlotAt, readPersistedGenerationRetryState, readSchedulerRuntimeHealth, restoreGenerationRetryState } = require('../utils/scheduler-runtime-health');

test('scheduler restart restores a future generation backoff and derives a non-shorter quota wait', async () => {
  const now = new Date('2026-10-19T15:23:04.210Z');
  const sourceFailure = restoreGenerationRetryState({
    lastGenerationFailure: { at: now.toISOString(), code: 'source_context_too_short' },
    nextGenerationRetryAt: '2026-10-19T15:28:04.210Z'
  }, now);
  assert.deepEqual(sourceFailure, {
    lastGenerationFailure: { at: now.toISOString(), code: 'source_context_too_short' },
    nextGenerationRetryAt: '2026-10-19T15:28:04.210Z'
  });

  const quotaFailure = restoreGenerationRetryState({
    lastGenerationFailure: { at: now.toISOString(), code: 'budget_exhausted' },
    nextGenerationRetryAt: '2026-10-19T15:28:05.000Z'
  }, now);
  assert.equal(quotaFailure.nextGenerationRetryAt, '2026-10-20T00:00:01.000Z');
});

test('persisted retry state ignores expired/malformed failures and reads the scheduler snapshot', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scheduler-retry-'));
  const healthPath = path.join(root, 'scheduler-health.json');
  try {
    await fs.writeFile(healthPath, JSON.stringify({
      lastGenerationFailure: { at: '2026-10-19T14:00:00.000Z', code: 'source_context_too_short' },
      nextGenerationRetryAt: '2026-10-19T14:05:00.000Z'
    }));
    assert.deepEqual(await readPersistedGenerationRetryState({ filePath: healthPath, now: new Date('2026-10-19T15:00:00.000Z') }), {
      lastGenerationFailure: { at: '2026-10-19T14:00:00.000Z', code: 'source_context_too_short' },
      nextGenerationRetryAt: null
    });
    assert.deepEqual(restoreGenerationRetryState({ lastGenerationFailure: { at: 'bad', code: 'budget_exhausted' } }, new Date('2026-10-19T15:00:00.000Z')),
      { lastGenerationFailure: null, nextGenerationRetryAt: null });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('public view retains measured values, keeps missing values null, and strips private paths and hashes', () => {
  const report = publicReport({ schemaVersion: 2, reportDate: '2026-10-16', status: 'partial', posts: [{
    publicationId: 'p1', platform: 'youtube', title: 'Real post', formatId: 'myth-correction', status: 'observed',
    source: 'youtube_official_apis',
    publishedAt: '2026-10-15T08:00:00Z', durationSeconds: 90,
    artifactPath: '/private/file.mp4', assetSha256: 'secret-hash', counters: { views: 12, likes: null },
    delta: { hours: 24, viewsPer24Hours: 4, metrics: { views: 4 } }, analytics: { days: [{ date: '2026-10-15', metrics: { views: 5, engagedViews: null } }] }
  }] });
  assert.equal(report.posts[0].counters.views, 12);
  assert.equal(report.posts[0].counters.likes, null);
  assert.equal(report.posts[0].delta.metrics.views, 4);
  assert.equal(report.posts[0].delta.viewsPer24Hours, 4);
  assert.equal(report.posts[0].publishedAt, '2026-10-15T08:00:00Z');
  assert.equal(report.posts[0].durationSeconds, 90);
  assert.equal(report.posts[0].analytics.days[0].metrics.engagedViews, null);
  assert.equal(JSON.stringify(report).includes('/private/file.mp4'), false);
  assert.equal(JSON.stringify(report).includes('secret-hash'), false);
});

test('format labels from legacy reports are shown as unknown unless explicitly tagged', () => {
  const legacy = publicReport({ schemaVersion: 1, reportDate: '2026-10-15', status: 'observed', posts: [{ formatId: 'kwai:social-narrative',
    platform: 'youtube', status: 'observed', counters: { views: 999999 }, analytics: { days: [{ metrics: { views: 999999 } }] } }] });
  assert.equal(legacy.posts[0].formatId, 'unknown');
  assert.equal(legacy.posts[0].status, 'unverified');
  assert.equal(legacy.posts[0].counters, null);
  assert.deepEqual(legacy.posts[0].analytics, { status: 'unverified', reason: 'metric_provenance_missing', availableThrough: null, days: [] });
  assert.equal(legacy.status, 'partial');
  const simulated = publicReport({ schemaVersion: 2, reportDate: '2026-10-16', posts: [{ source: 'youtube_official_apis', simulated: true,
    counters: { views: 999999 }, analytics: { days: [] } }] });
  assert.equal(simulated.posts[0].counters, null);
  const current = publicReport({ schemaVersion: 2, reportDate: '2026-10-16', posts: [{ formatId: 'myth-correction', formatProvenance: 'explicit' }] });
  assert.equal(current.posts[0].formatId, 'myth-correction');
});

test('daily public view exposes only validated explicit experiment identifiers', () => {
  const report = publicReport({ schemaVersion: 2, reportDate: '2026-10-16', posts: [
    { experimentId: 'experiment-1234', experimentProvenance: 'explicit', formatId: 'myth-correction',
      formatVersion: 2, formatProvenance: 'explicit' },
    { experimentId: 'invalid id', experimentProvenance: 'explicit', formatId: 'myth-correction', formatProvenance: 'explicit' },
    { experimentId: 'experiment-1234', experimentProvenance: 'unknown', formatId: 'myth-correction', formatProvenance: 'explicit' }
  ] });
  assert.equal(report.posts[0].experimentId, 'experiment-1234');
  assert.equal(report.posts[0].formatVersion, 2);
  assert.equal(report.posts[1].experimentId, null);
  assert.equal(report.posts[2].experimentId, null);
});

test('latest daily snapshots are returned newest first and malformed files are ignored', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-performance-view-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const date of ['2026-10-14', '2026-10-16', '2026-10-15']) {
    await fs.writeFile(path.join(dir, `${date}.json`), JSON.stringify({ reportDate: date, status: 'blocked', posts: [] }));
  }
  await fs.writeFile(path.join(dir, '2026-10-13.json'), '{broken');
  await fs.writeFile(path.join(dir, 'not-a-date.json'), '{}');
  const result = await readDailyPerformanceReports(dir, 2);
  assert.equal(result.latestDate, '2026-10-16');
  assert.deepEqual(result.reports.map(report => report.reportDate), ['2026-10-16', '2026-10-15']);
});

test('missing report directory yields an explicit unavailable state', async () => {
  const result = await readDailyPerformanceReports('/tmp/nonexistent-pulso-reports-' + process.pid);
  assert.deepEqual(result, { status: 'not_available', reports: [] });
});

test('runtime health reports active scheduler, queue, configured slot and quota-aware retry without exposing paths', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scheduler-health-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const procRoot = path.join(root, 'proc');
  await fs.mkdir(path.join(procRoot, '4242'), { recursive: true });
  await fs.symlink(root, path.join(procRoot, '4242', 'cwd'));
  await fs.writeFile(path.join(procRoot, '4242', 'cmdline'), '/usr/bin/node\0scripts/channel-scheduler.js\0');
  await fs.mkdir(path.join(root, 'data/state'), { recursive: true });
  await fs.mkdir(path.join(root, 'logs'), { recursive: true });
  await fs.writeFile(path.join(root, 'data/state/scheduler.json'), JSON.stringify({ startedAt: '2026-10-16T00:00:00.000Z' }));
  await fs.writeFile(path.join(root, 'data/state/publish-queue.json'), JSON.stringify({ pending: [{ path: '/private/video.mp4' }], inFlight: null }));
  await fs.writeFile(path.join(root, 'logs/scheduler.log'), '[2026-10-16T19:17:39.000Z] ❌ falhou (code 1; budget_exhausted) — private path /private/video.mp4');

  const result = await readSchedulerRuntimeHealth({ root, stateDir: 'data/state', procRoot, videosPerDay: 60, now: new Date('2026-10-16T22:59:00.000Z') });
  assert.equal(result.status, 'active');
  assert.deepEqual(result.queue, { pending: 1, inFlight: false });
  assert.equal(result.lastGenerationFailure.code, 'budget_exhausted');
  assert.equal(result.nextGenerationRetryAt, '2026-10-17T00:00:01.000Z');
  assert.equal(result.configuredVideosPerDay, 60);
  assert.equal(result.nextConfiguredSlotAt, nextSlotAt('2026-10-16T00:00:00.000Z', 60, Date.parse('2026-10-16T22:59:00.000Z')));
  assert.equal(JSON.stringify(result).includes('/private/video.mp4'), false);
  assert.equal(latestGenerationFailure('not a generation failure'), null);

  const healthPath = path.join(root, 'data/state/scheduler-health.json');
  const writer = createSchedulerRuntimeWriter({ filePath: healthPath, now: () => new Date('2026-10-16T22:58:30.000Z') });
  await writer.update({ configuredVideosPerDay: 60, lastGenerationFailure: { at: '2026-10-16T19:17:39.000Z', code: 'budget_exhausted' },
    nextGenerationRetryAt: '2026-10-17T00:00:01.000Z', producer: { state: 'backoff' }, queue: { pending: 1 },
    retry: { inProgress: true, youtubePending: false, socialPending: true },
    renderGate: { renderSafe: false, observedAt: '2026-10-16T22:58:00Z', availableMemoryBytes: 4 * 1024 ** 3,
      reasons: ['available_memory_below_6_gib', '/private/video.mp4'] } });
  assert.equal((await fs.stat(healthPath)).mode & 0o777, 0o600);
  const live = await readSchedulerRuntimeHealth({ root, stateDir: 'data/state', procRoot, videosPerDay: 60,
    now: new Date('2026-10-16T22:59:00.000Z') });
  assert.equal(live.heartbeatAvailable, true);
  assert.equal(live.heartbeatFresh, true);
  assert.equal(live.activityAgeSeconds, 30);
  assert.equal(live.producer.state, 'backoff');
  assert.deepEqual(live.retry, { inProgress: true, youtubePending: false, socialPending: true });
  assert.deepEqual(live.renderGate, { renderSafe: false, observedAt: '2026-10-16T22:58:00.000Z',
    availableMemoryBytes: 4 * 1024 ** 3, reasons: ['available_memory_below_6_gib'] });

  await writer.update({ lastGenerationFailure: null, nextGenerationRetryAt: null, producer: { state: 'generating' } });
  const recovered = await readSchedulerRuntimeHealth({ root, stateDir: 'data/state', procRoot, videosPerDay: 60,
    now: new Date('2026-10-16T22:59:00.000Z') });
  assert.equal(recovered.producer.state, 'generating');
  assert.equal(recovered.lastGenerationFailure, null);
  assert.equal(recovered.nextGenerationRetryAt, null);

  await writer.update({ lastGenerationFailure: { at: '2026-10-16T19:17:39.000Z', code: 'budget_exhausted' },
    nextGenerationRetryAt: null });
  const expired = await readSchedulerRuntimeHealth({ root, stateDir: 'data/state', procRoot, videosPerDay: 60,
    now: new Date('2026-10-17T00:01:00.000Z') });
  assert.equal(expired.lastGenerationFailure.code, 'budget_exhausted');
  assert.equal(expired.nextGenerationRetryAt, null);
});
