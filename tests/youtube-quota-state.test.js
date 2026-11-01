'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createYouTubeQuotaStore, normalizeQuotaState, quotaBlocked, youtubeQuotaRetryAt } = require('../utils/youtube-quota-state');

test('channel upload cap waits 24h rather than API midnight, including across Pacific DST', () => {
  for (const at of ['2026-10-18T14:09:01.461Z', '2026-11-01T06:30:00.000Z']) {
    assert.equal(Date.parse(youtubeQuotaRetryAt({ reason: 'uploadLimitExceeded', now: Date.parse(at) })), Date.parse(at) + 86400000);
  }
  assert.equal(youtubeQuotaRetryAt({ reason: 'quotaExceeded', now: Date.parse('2026-10-18T14:09:01Z') }), '2026-10-19T07:00:00.000Z');
  assert.equal(youtubeQuotaRetryAt({ reason: 'quotaExceeded', now: Date.parse('2026-11-02T02:00:00Z') }), '2026-11-02T08:00:00.000Z');
  assert.equal(youtubeQuotaRetryAt({ reason: 'uploadLimitExceeded', now: 0, retryAfter: '3600' }), '1970-01-01T01:00:00.000Z');
});

test('channel upload rejection blocks both YouTube surfaces while social destinations stay independent', () => {
  const at = '2026-10-18T14:09:01Z';
  const state = normalizeQuotaState({ at, destination: 'shorts', evidence: { observed: 'uploadLimitExceeded' } });
  const now = Date.parse(at) + 60000;
  assert.equal(quotaBlocked(state, 'shorts', now), true);
  assert.equal(quotaBlocked(state, 'youtube', now), true);
  assert.equal(quotaBlocked(state, 'instagram', now), false);
  assert.equal(quotaBlocked(state, 'kwai', now), false);
  assert.equal(quotaBlocked(state, 'shorts', Date.parse(at) + 86400000), false);
  assert.equal(quotaBlocked(state, 'youtube', Date.parse(at) + 86400000), false);
  const api = normalizeQuotaState({ at, evidence: { observed: 'quotaExceeded' } });
  assert.equal(quotaBlocked(api, 'youtube', now), true);
  assert.equal(quotaBlocked(api, 'shorts', now), true);
  assert.equal(quotaBlocked(api, 'instagram', now), false);
});

test('both YouTube surfaces honor the latest observed channel retry time', () => {
  const state = normalizeQuotaState({ schemaVersion: 2, blocks: {
    shorts: { reason: 'uploadLimitExceeded', retryAt: '2026-10-19T14:09:01.000Z' },
    youtube: { reason: 'uploadLimitExceeded', retryAt: '2026-10-19T17:11:09.000Z' }
  } });
  const betweenSurfaceRetries = Date.parse('2026-10-19T15:00:00.000Z');
  assert.equal(quotaBlocked(state, 'shorts', betweenSurfaceRetries), true);
  assert.equal(quotaBlocked(state, 'youtube', betweenSurfaceRetries), true);
  assert.equal(quotaBlocked(state, 'kwai', betweenSurfaceRetries), false);
});

test('concurrent rejections preserve each surface, and replaying a result does not extend its wait', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-quota-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'quota.json');
  const store = createYouTubeQuotaStore(file);
  const rejection = { status: 'skipped', failureCode: 'quota_exceeded', submittedAt: '2026-10-18T14:09:01Z',
    nextAttemptAt: '2026-10-18T14:10:01Z', evidence: { kind: 'api_rejected', observed: 'uploadLimitExceeded' } };
  await Promise.all([
    store.recordResults({ clips: { part: { shorts: rejection } } }),
    store.recordResults({ long: { youtube: rejection } })
  ]);
  const before = await store.read();
  assert.equal(before.blocks.shorts.retryAt, '2026-10-19T14:09:01.000Z');
  assert.equal(before.blocks.youtube.retryAt, before.blocks.shorts.retryAt);
  await store.recordResults({ clips: { part: { shorts: rejection } } });
  assert.deepEqual((await store.read()).blocks, before.blocks);
  assert.equal(await store.recordResults({ clips: { part: { kwai: rejection } } }), false);
  assert.equal(await store.recordResults({ long: { youtube: { ...rejection, status: 'unknown' } } }), false);
});

test('YouTube Studio confirmed channel-limit refusal blocks long and Shorts for the supplied 24h', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-studio-quota-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const at = Date.now();
  const retryAt = new Date(at + 24 * 60 * 60 * 1000).toISOString();
  const store = createYouTubeQuotaStore(path.join(root, 'quota.json'));
  const refusal = {
    status: 'failed',
    platform: 'youtube',
    failureCode: 'youtube_upload_limit',
    submittedAt: new Date(at).toISOString(),
    nextAttemptAt: retryAt,
    evidence: { kind: 'confirmed_no_send', observed: 'Studio recusou por limite diário; nenhum vídeo foi publicado.' }
  };
  assert.equal(await store.recordResults({ long: { youtube: refusal } }), true);
  assert.equal(await store.blocked('youtube'), true);
  assert.equal(await store.blocked('shorts'), true);
  assert.equal(await store.blocked('instagram'), false);
  assert.equal((await store.read()).blocks.youtube.retryAt, retryAt);
});
