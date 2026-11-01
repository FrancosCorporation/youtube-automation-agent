'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createPersistThenObservePublicationState,
  createPublicationObserver,
  normalizedStatus
} = require('../utils/publication-observability');
const { createPublicationResult } = require('../utils/publication-status');
const { checkpointedPublication, recordPublicationResult } = require('../utils/social-publication-state');
const { updateTopicLedger } = require('../utils/topic-ledger');

test('retry publication states are persisted before their structured log event', async () => {
  const order = [];
  const event = { scope: 'clip', platform: 'kwai', artifactPath: '/managed/clip.mp4', result: { status: 'confirmed' } };
  const handle = createPersistThenObservePublicationState({
    persist: async received => { assert.equal(received, event); order.push('persist'); },
    observe: received => { assert.equal(received, event); order.push('observe'); }
  });
  await handle(event);
  assert.deepEqual(order, ['persist', 'observe']);

  const failedOrder = [];
  const failClosed = createPersistThenObservePublicationState({
    persist: async () => { failedOrder.push('persist'); throw new Error('ledger unavailable'); },
    observe: () => failedOrder.push('observe')
  });
  await assert.rejects(failClosed(event), /ledger unavailable/);
  assert.deepEqual(failedOrder, ['persist']);
});

test('publication observer correlates destination attempts without logging media paths or result text', () => {
  const events = [];
  let now = 100;
  const observe = createPublicationObserver({
    logger: { logPublishing: (...args) => events.push(args) },
    jobId: 'job-opaque-1',
    videoId: 'vid_0123456789abcdef01234567',
    now: () => now
  });
  const artifactPath = '/private/videos/assunto-sensivel.mp4';

  observe({ scope: 'clip', platform: 'kwai', artifactPath, result: {
    status: 'attempting', attemptCount: 2, artifact: { path: artifactPath }, caption: 'texto privado'
  } });
  now += 1750;
  observe({ scope: 'clip', platform: 'kwai', artifactPath, result: {
    status: 'confirmed', attemptCount: 2, url: 'https://example.test/post', account: 'private account'
  } });

  assert.equal(events.length, 2);
  assert.deepEqual(events[0].slice(0, 3), ['upload_clip', 'vid_0123456789abcdef01234567', 'attempting']);
  assert.deepEqual(events[1].slice(0, 3), ['upload_clip', 'vid_0123456789abcdef01234567', 'confirmed']);
  assert.equal(events[1][3].jobId, 'job-opaque-1');
  assert.equal(events[1][3].destination, 'kwai');
  assert.match(events[1][3].artifactId, /^vid_[a-f0-9]{24}$/);
  assert.equal(events[1][3].durationMs, 1750);
  assert.doesNotMatch(JSON.stringify(events), /assunto-sensivel|texto privado|private account/);
});

test('publication statuses use a bounded vocabulary', () => {
  assert.equal(normalizedStatus({ status: 'submitted' }), 'submitted');
  assert.equal(normalizedStatus('https://example.test/publication'), 'confirmed');
  assert.equal(normalizedStatus('não logado'), 'skipped');
  assert.equal(normalizedStatus('não alvo'), 'skipped');
  assert.equal(normalizedStatus('falha com texto sensível'), 'unknown');
});

test('persisted publication intent and confirmation share ledger IDs with safe log events', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-publication-observability-'));
  const masterPath = path.join(root, 'videos', 'master.mp4');
  const clipPath = path.join(root, 'videos', 'clips', 'clip-private-name.mp4');
  const ledgerPath = path.join(root, 'state', 'topics.json');
  const jobId = 'job-correlation-test';
  const videoId = 'vid_0123456789abcdef01234567';
  const events = [];
  const observe = createPublicationObserver({
    logger: { logPublishing: (...event) => events.push(event) }, jobId, videoId
  });

  try {
    await updateTopicLedger(ledgerPath, ledger => {
      ledger.entries.push({ jobId, videoId, videoPath: masterPath, clips: [{ path: clipPath }] });
      return ledger;
    });
    const onPublicationState = async event => {
      await recordPublicationResult(ledgerPath, masterPath, event, { root });
      observe(event);
    };

    const result = await checkpointedPublication({
      scope: 'clip',
      platform: 'kwai',
      videoPath: clipPath,
      upload: async () => createPublicationResult({
        platform: 'kwai',
        videoPath: clipPath,
        status: 'confirmed',
        account: 'private-account-name',
        attemptCount: 1,
        evidence: { kind: 'profile_caption_match', observed: 'caption and post time matched' }
      }),
      onPublicationState
    });

    const saved = JSON.parse(await fs.readFile(ledgerPath, 'utf8')).entries[0];
    assert.equal(result.status, 'confirmed');
    assert.equal(saved.jobId, jobId);
    assert.equal(saved.videoId, videoId);
    assert.equal(saved.results.clips[clipPath].kwai.status, 'confirmed');
    assert.deepEqual(events.map(event => event[2]), ['attempting', 'confirmed']);
    assert.ok(events.every(event => event[3].jobId === saved.jobId && event[1] === saved.videoId));
    assert.doesNotMatch(JSON.stringify(events), /clip-private-name|private-account-name|caption and post time/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
