'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPublicationResult } = require('../utils/publication-status');

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-upload-limit-state-'));
const savedEnv = Object.fromEntries([
  'STATE_DIR', 'SOCIAL_TELEGRAM_MAX_BYTES', 'TELEGRAM_CHANNEL',
  'X_MAX_VIDEO_SECONDS', 'X_POST_FULL_VIDEO', 'SOCIALS_DISABLED',
  'YT_MAX_VIDEO_SECONDS', 'FFPROBE_PATH'
].map(key => [key, process.env[key]]));

process.env.STATE_DIR = stateDir;
process.env.SOCIAL_TELEGRAM_MAX_BYTES = '16';
process.env.TELEGRAM_CHANNEL = 'fixture-channel';
process.env.X_MAX_VIDEO_SECONDS = '14400';
process.env.X_POST_FULL_VIDEO = '';
process.env.SOCIALS_DISABLED = '';
process.env.YT_MAX_VIDEO_SECONDS = '900';

const { uploadToAll, retryPendingYouTubeShorts, PLATFORM_VIDEO_LIMIT_SECONDS, YOUTUBE_LONGFORM_MIN_SECONDS,
  TELEGRAM_APP_MAX_FILE_BYTES } = require('../scripts/upload-to-socials');
const { recordAndroidSession } = require('../utils/android-session-state');
const approvedQa = { status: 'verified', visualReview: 'approved' };

test('social uploader blocks before any destination when visual review is pending', async () => {
  await assert.rejects(
    uploadToAll({
      videoPath: '/not-used.mp4',
      title: 'fixture',
      qaManifest: { status: 'verified', visualReview: 'pending' },
      onPublicationState: async () => {}
    }),
    error => error.code === 'PUBLICATION_VISUAL_REVIEW_REQUIRED'
  );
});

test('YouTube Shorts retry excludes artifacts outside the explicit visual-review scope', async () => {
  const masterPath = '/media/master.mp4';
  const shortPath = '/media/short.mp4';
  const output = await retryPendingYouTubeShorts({
    entry: {
      videoPath: masterPath,
      title: 'fixture',
      clips: [{ path: shortPath, platforms: ['shorts'], partIndex: 1, partCount: 1 }]
    },
    results: {
      long: { youtube: 'https://youtube.test/watch?v=confirmed' },
      clips: { [shortPath]: { shorts: 'desativado' } }
    },
    maxShorts: 1,
    maxUploads: 1,
    onPublicationState: async () => assert.fail('corte não revisado não deve ser enviado'),
    qaManifest: {
      status: 'verified',
      visualReview: 'approved',
      visualReviewAssets: [{ path: masterPath, sha256: 'a'.repeat(64) }],
      visualReviewScopeInvalid: false
    }
  });

  assert.equal(output.clips[shortPath].shorts, 'desativado');
});

test('X Android configuration cannot exceed the documented Premium app limit', () => {
  assert.equal(PLATFORM_VIDEO_LIMIT_SECONDS.x, 600);
  assert.equal(YOUTUBE_LONGFORM_MIN_SECONDS, 360);
});

test('owner-excluded Telegram stays disabled even with a configured channel and a fresh login', async t => {
  t.after(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const videoPath = path.join(stateDir, 'master.mp4');
  fs.writeFileSync(videoPath, Buffer.alloc(17));
  recordAndroidSession('telegram', { root: stateDir });
  const events = [];

  const results = await uploadToAll({
    videoPath,
    clips: [],
    title: 'fixture',
    skipYouTube: true,
    qaManifest: {
      ...approvedQa,
      visualReviewAssets: [{ path: videoPath, sha256: 'a'.repeat(64) }],
      visualReviewScopeInvalid: false
    },
    onPublicationState: async event => events.push(event)
  });

  assert.equal(TELEGRAM_APP_MAX_FILE_BYTES, 16);
  assert.equal(results.long.telegram, 'desativado');
  assert.equal(events.some(event => event.platform === 'telegram' && event.result === 'desativado'), true);
  assert.equal(events.some(event => event.platform === 'telegram' && event.result?.status === 'attempting'), false);
  assert.equal(fs.existsSync(path.join(stateDir, 'android-social-upload.lock')), false,
    'excluded destination must never open the Android upload flow');
});

test('an explicit Shorts-only routing skip leaves the long-upload option independent', async t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-surface-quota-'));
  const master = path.join(fixture, 'master.mp4');
  const short = path.join(fixture, 'short.mp4');
  const probe = path.join(fixture, 'ffprobe');
  fs.writeFileSync(master, 'fixture master');
  fs.writeFileSync(short, 'fixture short');
  fs.writeFileSync(probe, '#!/bin/sh\nprintf "360\\n"\n', { mode: 0o755 });
  const previousProbe = process.env.FFPROBE_PATH;
  const uploader = require('../utils/youtube-studio-publisher');
  const original = uploader.uploadWithStudio;
  const publisherPath = require.resolve('../scripts/upload-to-socials');
  const previousPublisher = require.cache[publisherPath];
  const calls = [];
  uploader.uploadWithStudio = async payload => {
    calls.push(payload.videoPath);
    return createPublicationResult({ platform: 'youtube', videoPath: payload.videoPath, status: 'confirmed',
      url: 'https://youtube.test/new-long', evidence: { kind: 'upload_response', observed: 'fixture confirmado' } });
  };
  // The publisher captures the Studio adapter at module load. Install the stub
  // first so the test cannot open Android or submit a real upload.
  delete require.cache[publisherPath];
  const isolatedUploadToAll = require('../scripts/upload-to-socials').uploadToAll;
  process.env.FFPROBE_PATH = probe;
  t.after(() => {
    uploader.uploadWithStudio = original;
    require.cache[publisherPath] = previousPublisher;
    if (previousProbe === undefined) delete process.env.FFPROBE_PATH;
    else process.env.FFPROBE_PATH = previousProbe;
    fs.rmSync(fixture, { recursive: true, force: true });
  });
  const result = await isolatedUploadToAll({ videoPath: master, title: 'fixture', skipYouTube: false, skipShorts: true,
    clips: [{ path: short, platforms: ['shorts'], kind: 'social-narrative-part', partIndex: 1, partCount: 1 }],
    qaManifest: { ...approvedQa, visualReviewScopeInvalid: false,
      visualReviewAssets: [master, short].map(file => ({ path: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') })) },
    onPublicationState: async () => {}
  });
  assert.deepEqual(calls, [master]);
  assert.equal(result.long.youtube.url || result.long.youtube, 'https://youtube.test/new-long');
  assert.equal(result.clips[short].shorts, 'pulado (cota)');
});

test('YouTube long upload is rejected before the API when duration exceeds the configured account limit', async t => {
  const originalEnv = Object.fromEntries(['FFPROBE_PATH', 'TELEGRAM_CHANNEL', 'SOCIALS_DISABLED']
    .map(key => [key, process.env[key]]));
  const videoPath = path.join(stateDir, 'youtube-over-limit.mp4');
  const probePath = path.join(stateDir, 'ffprobe-fixture');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(videoPath, Buffer.from('fixture video'));
  fs.writeFileSync(probePath, '#!/bin/sh\nprintf "%s\\n" "901"\n', { mode: 0o755 });
  process.env.FFPROBE_PATH = probePath;
  process.env.TELEGRAM_CHANNEL = '';
  process.env.SOCIALS_DISABLED = 'telegram';
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const events = [];
  const results = await uploadToAll({
    videoPath,
    title: 'fixture',
    qaManifest: {
      ...approvedQa,
      visualReviewAssets: [{ path: videoPath, sha256: 'b'.repeat(64) }],
      visualReviewScopeInvalid: false
    },
    onPublicationState: async event => events.push(event)
  });

  assert.match(results.long.youtube, /901\.0s excede o limite configurado de 900s/);
  assert.equal(events.some(event => event.platform === 'youtube' && /excede o limite/.test(event.result)), true);
});

test('YouTube master shorter than six minutes is held before publication', async t => {
  const originalEnv = Object.fromEntries(['FFPROBE_PATH', 'TELEGRAM_CHANNEL', 'SOCIALS_DISABLED']
    .map(key => [key, process.env[key]]));
  const videoPath = path.join(stateDir, 'youtube-under-six-minutes.mp4');
  const probePath = path.join(stateDir, 'ffprobe-under-six-minutes');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(videoPath, Buffer.from('fixture video'));
  fs.writeFileSync(probePath, '#!/bin/sh\nprintf "%s\\n" "359.9"\n', { mode: 0o755 });
  process.env.FFPROBE_PATH = probePath;
  process.env.TELEGRAM_CHANNEL = '';
  process.env.SOCIALS_DISABLED = 'telegram';
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const events = [];
  const results = await uploadToAll({
    videoPath,
    title: 'fixture',
    clips: [],
    qaManifest: {
      ...approvedQa,
      visualReviewAssets: [{ path: videoPath, sha256: crypto.createHash('sha256').update(fs.readFileSync(videoPath)).digest('hex') }],
      visualReviewScopeInvalid: false
    },
    onPublicationState: async event => events.push(event)
  });

  assert.match(results.long.youtube, /abaixo do mínimo editorial de 360s \(6 minutos\)/);
  assert.equal(events.some(event => event.platform === 'youtube' && event.result?.status === 'attempting'), false);
});

test('YouTube Shorts retry applies its own 180-second ceiling before the API', async t => {
  const originalProbe = process.env.FFPROBE_PATH;
  const probePath = path.join(os.tmpdir(), `ffprobe-short-limit-${process.pid}`);
  const mediaRoot = path.join(__dirname, '..', 'data', 'videos');
  fs.mkdirSync(mediaRoot, { recursive: true });
  const fixtureDir = fs.mkdtempSync(path.join(mediaRoot, '.short-retry-limit-'));
  const videoPath = path.join(fixtureDir, 'short.mp4');
  fs.writeFileSync(videoPath, Buffer.from('fixture video'));
  fs.writeFileSync(probePath, '#!/bin/sh\nprintf "%s\\n" "181"\n', { mode: 0o755 });
  process.env.FFPROBE_PATH = probePath;
  t.after(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(probePath, { force: true });
    if (originalProbe === undefined) delete process.env.FFPROBE_PATH;
    else process.env.FFPROBE_PATH = originalProbe;
  });

  const results = await retryPendingYouTubeShorts({
    entry: { ytUrl: 'https://youtube.test/long', clips: [{
      path: videoPath, title: 'Overlong short', kind: 'social-narrative-part',
      platforms: ['shorts'], partIndex: 1, partCount: 1
    }] },
    results: { long: { youtube: 'https://youtube.test/long' }, clips: { [videoPath]: {} } },
    qaManifest: {
      ...approvedQa,
      visualReviewAssets: [{ path: videoPath, sha256: 'c'.repeat(64) }],
      visualReviewScopeInvalid: false
    },
    onPublicationState: async () => {}
  });

  assert.match(results.clips[videoPath].shorts, /181\.0s acima do limite de 180s do Shorts/);
});

test('YouTube Shorts retry rejects narrative micro-clips before an upload attempt', async t => {
  const originalProbe = process.env.FFPROBE_PATH;
  const probePath = path.join(os.tmpdir(), `ffprobe-short-minimum-${process.pid}`);
  const mediaRoot = path.join(__dirname, '..', 'data', 'videos');
  const fixtureDir = fs.mkdtempSync(path.join(mediaRoot, '.short-retry-minimum-'));
  const videoPath = path.join(fixtureDir, 'short.mp4');
  fs.writeFileSync(videoPath, Buffer.from('fixture video'));
  fs.writeFileSync(probePath, '#!/bin/sh\nprintf "%s\\n" "9"\n', { mode: 0o755 });
  process.env.FFPROBE_PATH = probePath;
  t.after(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(probePath, { force: true });
    if (originalProbe === undefined) delete process.env.FFPROBE_PATH;
    else process.env.FFPROBE_PATH = originalProbe;
  });

  const results = await retryPendingYouTubeShorts({
    entry: { ytUrl: 'https://youtube.test/long', clips: [{
      path: videoPath, title: 'Nove segundos', kind: 'social-narrative-part',
      platforms: ['shorts'], partIndex: 1, partCount: 1
    }] },
    results: { long: { youtube: 'https://youtube.test/long' }, clips: { [videoPath]: {} } },
    qaManifest: {
      ...approvedQa,
      visualReviewAssets: [{ path: videoPath, sha256: 'd'.repeat(64) }],
      visualReviewScopeInvalid: false
    },
    onPublicationState: async () => {}
  });

  assert.match(results.clips[videoPath].shorts, /abaixo de 60s/);
});
