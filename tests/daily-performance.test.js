'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { collectDailyPerformance, publicationInventory, counterDelta, youtubeId } = require('../utils/daily-performance');
const { collectYouTubeVideoMetrics, METRICS, calendarDate, analyticsErrorCode } = require('../utils/youtube-observed-metrics');

const VIDEO = 'abcdefghijk';
const NOW = '2026-10-16T12:00:00Z';

async function fixture(t, entries) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-daily-performance-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDir = path.join(root, 'data', 'state');
  const reportDir = path.join(root, 'data', 'reports', 'performance');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(path.join(root, 'data', 'videos'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'videos', 'fixture.mp4'), 'test artifact only');
  await fs.writeFile(path.join(stateDir, 'topics.json'), JSON.stringify({ entries: entries || [{
    jobId: 'job-1', title: 'Título | sem quebrar tabela', theme: 'ia', videoPath: 'data/videos/fixture.mp4',
    results: { long: { youtube: 'https://www.youtube.com/watch?v=' + VIDEO } }
  }] }));
  return { root, stateDir, reportDir, now: NOW };
}

function officialClients(overrides = {}) {
  const youtube = { videos: { list: async () => ({ data: { items: [{
    id: VIDEO, snippet: { channelId: 'UCown', publishedAt: '2026-10-10T14:00:00Z' },
    statistics: { viewCount: '20', likeCount: '0' }, contentDetails: { duration: 'PT1M30S' }, status: { privacyStatus: 'public' }
  }] } }) } };
  const analytics = { reports: { query: async () => ({ data: {
    columnHeaders: [{ name: 'day' }, ...METRICS.map(name => ({ name }))],
    rows: [['2026-10-13', 12, 8, 10, 75, 83.3, 0, 0, 2, 1, 0]]
  } }) } };
  return { youtube, analytics, videoId: VIDEO, channelId: 'UCown', now: NOW, ...overrides };
}

test('official metrics preserve zero, missing data, publication time and delayed Pacific days', async () => {
  const clients = officialClients();
  const result = await collectYouTubeVideoMetrics(clients);
  assert.equal(result.status, 'observed');
  assert.deepEqual(result.counters, { views: 20, likes: 0, comments: null });
  assert.equal(result.durationSeconds, 90);
  assert.equal(result.publishedAt, '2026-10-10T14:00:00Z');
  assert.equal(result.analytics.requestedEndDate, '2026-10-15');
  assert.equal(result.analytics.availableThrough, '2026-10-13');
  assert.equal(result.analytics.days[0].metrics.engagedViews, 8);
  assert.equal(calendarDate('2026-10-16T01:00:00Z'), '2026-10-15');
});

test('analytics permission failure retains observed public counters without simulated fallback', async () => {
  const clients = officialClients();
  clients.analytics.reports.query = async () => { throw { response: { status: 403 }, message: 'secret-token-value' }; };
  const result = await collectYouTubeVideoMetrics(clients);
  assert.equal(result.status, 'partial');
  assert.equal(result.counters.views, 20);
  assert.equal(result.analytics.reason, 'permission_or_quota_denied');
  assert.equal(result.analytics.availableThrough, null);
  assert.equal(JSON.stringify(result).includes('secret-token-value'), false);
});

test('analytics provider errors retain safe API, quota and permission categories', () => {
  assert.equal(analyticsErrorCode({ response: { status: 403, data: { error: {
    message: 'YouTube Analytics API has not been used in project 123 or it is disabled.',
    errors: [{ reason: 'accessNotConfigured' }]
  } } } }), 'api_disabled');
  assert.equal(analyticsErrorCode({ response: { status: 403, data: { error: {
    errors: [{ reason: 'userRateLimitExceeded' }]
  } } } }), 'quota_exceeded');
  assert.equal(analyticsErrorCode({ response: { status: 403, data: { error: {
    errors: [{ reason: 'insufficientPermissions' }]
  } } } }), 'permission_denied');
  assert.equal(analyticsErrorCode({ response: { status: 403 } }), 'permission_or_quota_denied');
});

test('metric names drive mapping and missing columns never become observed zeros', async () => {
  const clients = officialClients();
  clients.analytics.reports.query = async () => ({ data: {
    columnHeaders: [{ name: 'engagedViews' }, { name: 'day' }, { name: 'views' }],
    rows: [[4, '2026-10-14', 8]]
  } });
  const result = await collectYouTubeVideoMetrics(clients);
  assert.equal(result.status, 'partial');
  assert.equal(result.analytics.reason, 'metrics_incomplete');
  assert.equal(result.analytics.days[0].metrics.engagedViews, 4);
  assert.equal(result.analytics.days[0].metrics.views, 8);
  assert.equal(result.analytics.days[0].metrics.shares, null);
});

test('account mismatch does not query analytics and empty rows are not zero', async () => {
  const clients = officialClients({ channelId: 'UCsomeoneelse' });
  clients.analytics.reports.query = async () => { throw new Error('must not run'); };
  assert.equal((await collectYouTubeVideoMetrics(clients)).reason, 'account_mismatch');
  const empty = officialClients();
  empty.analytics.reports.query = async () => ({ data: { columnHeaders: [{ name: 'day' }], rows: [] } });
  const result = await collectYouTubeVideoMetrics(empty);
  assert.equal(result.analytics.status, 'no_data');
  assert.deepEqual(result.analytics.days, []);
  assert.equal(result.status, 'partial');
});

test('inventory rejects wrong platform/artifact, foreign URLs and unconfirmed attempts', () => {
  const proof = { status: 'confirmed', confirmedAt: NOW, platform: 'kwai', artifact: { path: '/root/a.mp4' }, evidence: { kind: 'public_profile', observed: 'verified' } };
  const { posts } = publicationInventory({ entries: [{ jobId: 'j', videoPath: '/root/b.mp4', results: { long: {
    kwai: proof, youtube: 'https://evil.example/watch?v=' + VIDEO, shorts: { ...proof, status: 'attempting' }
  } } }] }, '/root');
  assert.deepEqual(posts, []);
  assert.equal(youtubeId('https://youtu.be/' + VIDEO), VIDEO);
  assert.equal(youtubeId('https://youtube.com.evil.example/watch?v=' + VIDEO), null);
});

test('legacy clip kind is not mislabeled as an editorial format', () => {
  const proof = { status: 'confirmed', confirmedAt: NOW, platform: 'kwai', artifact: { path: '/root/a.mp4' }, evidence: { kind: 'public_profile', observed: 'verified' } };
  const { posts } = publicationInventory({ entries: [{ jobId: 'j', title: 'Title', videoPath: '/root/master.mp4',
    clips: [{ path: '/root/a.mp4', kind: 'social-narrative-part', title: 'Part' }],
    results: { clips: { '/root/a.mp4': { kwai: proof } } }
  }] }, '/root');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].formatId, 'unknown');
  assert.equal(posts[0].formatProvenance, 'unknown');
  assert.equal(posts[0].surfaceId, 'clip');
  assert.equal(posts[0].clipKind, 'social-narrative-part');
});

test('daily inventory preserves explicit format version and experiment lineage for confirmed posts', () => {
  const proof = { status: 'confirmed', confirmedAt: NOW, platform: 'youtube',
    artifact: { path: '/root/master.mp4' }, evidence: { kind: 'youtube_video', observed: 'found' }, externalId: VIDEO };
  const inventory = publicationInventory({ entries: [{ jobId: 'lineage-job', title: 'Lineage', videoPath: '/root/master.mp4',
    formatId: 'myth-correction', formatVersion: 2, experimentId: 'experiment-1234',
    results: { long: { youtube: proof } } }] }, '/root');
  assert.equal(inventory.posts.length, 1);
  assert.equal(inventory.posts[0].formatId, 'myth-correction');
  assert.equal(inventory.posts[0].formatVersion, 2);
  assert.equal(inventory.posts[0].experimentId, 'experiment-1234');
  assert.equal(inventory.posts[0].experimentProvenance, 'explicit');
});

test('publication health reports the last confirmed post and newest unresolved attempt', () => {
  const inventory = publicationInventory({ entries: [{ jobId: 'health-job', videoPath: '/root/master.mp4',
    clips: [{ path: '/root/clip.mp4' }], results: {
      long: { youtube: { status: 'confirmed', platform: 'youtube', confirmedAt: '2026-10-14T10:00:00Z',
        artifact: { path: '/root/master.mp4' }, evidence: { kind: 'youtube_video', observed: 'found' }, externalId: VIDEO } },
      clips: { '/root/clip.mp4': { kwai: { status: 'unknown', platform: 'kwai', submittedAt: '2026-10-16T10:00:00Z',
        failureCode: 'attempt_outcome_unknown', artifact: { path: '/root/clip.mp4' } } } }
    } }] }, '/root');
  assert.equal(inventory.health.youtube.lastConfirmedAt, '2026-10-14T10:00:00.000Z');
  assert.equal(inventory.health.kwai.latestAttemptStatus, 'unknown');
  assert.equal(inventory.health.kwai.latestFailureCode, 'attempt_outcome_unknown');
});

test('daily collection serializes callers, persists one real snapshot and regenerates Markdown without API calls', async t => {
  const options = await fixture(t);
  let calls = 0;
  options.createClient = async () => ({ channelId: 'UCown', collect: async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 35));
    return collectYouTubeVideoMetrics(officialClients());
  } });
  const results = await Promise.all([collectDailyPerformance(options), collectDailyPerformance(options)]);
  assert.equal(calls, 1);
  assert.equal(results.filter(result => result.cached).length, 1);
  const result = results[0];
  assert.match(result.report.posts[0].assetSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.report.coverage.youtube.status, 'observed');
  assert.equal(result.report.coverage.instagram.status, 'no_confirmed_posts');
  assert.equal((await fs.stat(result.jsonPath)).mode & 0o777, 0o600);
  assert.equal((await fs.readFile(result.markdownPath, 'utf8')).includes('Título   sem quebrar tabela'), true);
  await fs.unlink(result.markdownPath);
  await collectDailyPerformance(options);
  assert.equal(calls, 1);
  assert.ok(await fs.stat(result.markdownPath));
});

test('OAuth failure records one account blocker for all videos and no fictional counters', async t => {
  const options = await fixture(t, [VIDEO, 'lmnopqrstuv'].map(id => ({ title: id, results: { long: { youtube: 'https://youtu.be/' + id } } })));
  let calls = 0;
  options.createClient = async () => { calls++; throw { response: { data: { error: 'invalid_grant' } }, message: 'sensitive-url' }; };
  const { report } = await collectDailyPerformance(options);
  assert.equal(calls, 1);
  assert.equal(report.posts.length, 2);
  assert.equal(report.coverage.youtube.reason, 'oauth_invalid_grant');
  assert.equal(report.status, 'blocked');
  assert.ok(report.posts.every(post => !post.counters && post.status === 'unavailable'));
  assert.equal(JSON.stringify(report).includes('sensitive-url'), false);
  assert.equal(analyticsErrorCode({ response: { data: { error: 'invalid_grant' } } }), 'oauth_invalid_grant');
});

test('explicit refresh archives the prior snapshot; malformed ledger preserves existing report', async t => {
  const options = await fixture(t);
  options.createClient = async () => ({ channelId: 'UCown', collect: () => collectYouTubeVideoMetrics(officialClients()) });
  const first = await collectDailyPerformance(options);
  await collectDailyPerformance({ ...options, refresh: true });
  const history = await fs.readdir(path.join(options.reportDir, 'history'));
  assert.equal(history.length, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(options.reportDir, 'history', history[0]), 'utf8')), first.report);
  const before = await fs.readFile(first.jsonPath, 'utf8');
  await fs.writeFile(path.join(options.stateDir, 'topics.json'), '{broken');
  await assert.rejects(collectDailyPerformance({ ...options, refresh: true }));
  assert.equal(await fs.readFile(first.jsonPath, 'utf8'), before);
});

test('deltas require the same account, exact observed interval and preserve platform corrections', () => {
  const previous = { accountId: 'one', observedAt: '2026-10-15T11:00:00Z', counters: { views: 100, likes: 2, comments: null } };
  const current = { accountId: 'one', observedAt: NOW, counters: { views: 90, likes: 0, comments: 1 } };
  assert.deepEqual(counterDelta(current, previous), { hours: 25, metrics: { views: -10, likes: -2, comments: null }, viewsPer24Hours: null, platformAdjustment: true });
  assert.equal(counterDelta({ ...current, accountId: 'two' }, previous), null);
  assert.equal(counterDelta({ ...current, observedAt: '2026-10-20T12:00:00Z' }, previous), null);
  assert.equal(counterDelta({ ...current, counters: { ...current.counters, views: 150 } }, previous).viewsPer24Hours, 48);
});

test('daily collection finds the nearest comparable snapshot across a missing day', async t => {
  const options = await fixture(t);
  await fs.mkdir(options.reportDir, { recursive: true });
  const { posts } = publicationInventory(JSON.parse(await fs.readFile(path.join(options.stateDir, 'topics.json'), 'utf8')), options.root);
  const publicationId = posts[0].publicationId;
  const priorReport = { reportDate: '2026-10-14', posts: [{ publicationId, accountId: require('node:crypto').createHash('sha256').update('youtube:UCown').digest('hex').slice(0, 24),
    observedAt: '2026-10-14T12:00:00.000Z', counters: { views: 100, likes: 1, comments: 0 } }] };
  await fs.writeFile(path.join(options.reportDir, '2026-10-14.json'), JSON.stringify(priorReport));
  options.createClient = async () => ({ channelId: 'UCown', collect: async () => ({ status: 'observed', observedAt: NOW,
    counters: { views: 150, likes: 2, comments: 0 }, analytics: { status: 'no_data', days: [] } }) });
  const { report } = await collectDailyPerformance(options);
  assert.equal(report.posts[0].delta.hours, 48);
  assert.equal(report.posts[0].delta.metrics.views, 50);
  assert.equal(report.posts[0].delta.viewsPer24Hours, 25);
});
