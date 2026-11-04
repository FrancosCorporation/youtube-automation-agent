'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-android-routing-'));
const profileDir = path.join(stateDir, 'old-browser-profile', 'tiktok', 'Default');
fs.mkdirSync(profileDir, { recursive: true });
fs.writeFileSync(path.join(profileDir, 'Cookies'), Buffer.alloc(12000));
process.env.STATE_DIR = stateDir;

const { allowUnknownAndroidSession, isLogged, isSocialHandlerAvailable, uploadX } = require('../scripts/upload-to-socials');
const { recordAndroidSession } = require('../utils/android-session-state');

test('social routes ignore legacy Chromium cookies and fail closed before login', async t => {
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const previousHandle = process.env.ANDROID_SOCIAL_HANDLE_TIKTOK;
  t.after(() => {
    if (previousHandle === undefined) delete process.env.ANDROID_SOCIAL_HANDLE_TIKTOK;
    else process.env.ANDROID_SOCIAL_HANDLE_TIKTOK = previousHandle;
  });
  delete process.env.ANDROID_SOCIAL_HANDLE_TIKTOK;

  assert.equal(isLogged('tiktok'), false);
  assert.equal(isSocialHandlerAvailable('tiktok'), true);
  assert.equal(fs.existsSync(path.join(stateDir, 'android-social-upload.lock')), false);

  recordAndroidSession('tiktok', { root: stateDir, device: 'emulator-5560', accountHandle: '@pulso_ai_news', identityVerified: false });
  assert.equal(isLogged('tiktok'), false, 'a session marker without owner-approved identity is not publish-ready');
  process.env.ANDROID_SOCIAL_HANDLE_TIKTOK = '@pulso_ai_news';
  recordAndroidSession('tiktok', { root: stateDir, device: 'emulator-5560', accountHandle: '@pulso_ai_news', identityVerified: true });
  assert.equal(isLogged('tiktok'), true);
});

test('TikTok retoma a tela For You somente com a sessão e o handle aprovados', async t => {
  const isolatedState = fs.mkdtempSync(path.join(os.tmpdir(), 'social-android-tiktok-recovery-'));
  const previousStateDir = process.env.STATE_DIR;
  const previousHandle = process.env.ANDROID_SOCIAL_HANDLE_TIKTOK;
  t.after(() => {
    fs.rmSync(isolatedState, { recursive: true, force: true });
    if (previousStateDir === undefined) delete process.env.STATE_DIR;
    else process.env.STATE_DIR = previousStateDir;
    if (previousHandle === undefined) delete process.env.ANDROID_SOCIAL_HANDLE_TIKTOK;
    else process.env.ANDROID_SOCIAL_HANDLE_TIKTOK = previousHandle;
  });
  process.env.STATE_DIR = isolatedState;
  process.env.ANDROID_SOCIAL_HANDLE_TIKTOK = '@approved';
  recordAndroidSession('tiktok', {
    root: isolatedState, device: 'emulator-5560', accountHandle: '@approved', identityVerified: true
  });
  assert.equal(await allowUnknownAndroidSession({
    platform: 'tiktok',
    session: { status: 'unknown', packageName: 'com.zhiliaoapp.musically' },
    control: { dumpUi: async () => [] }
  }), true);
  assert.equal(await allowUnknownAndroidSession({
    platform: 'tiktok',
    session: { status: 'unknown', packageName: 'com.zhiliaoapp.musically' },
    control: { dumpUi: async () => [
      { visible: true, resourceId: 'com.zhiliaoapp.musically:id/h9x' },
      { visible: true, resourceId: 'com.zhiliaoapp.musically:id/tjf', text: 'Post' }
    ] }
  }), false);
  assert.equal(await allowUnknownAndroidSession({
    platform: 'tiktok',
    session: { status: 'unknown', packageName: 'com.zhiliaoapp.musically' },
    control: { dumpUi: async () => [{ visible: true, resourceId: 'com.zhiliaoapp.musically:id/h9x' }] }
  }), false, 'o editor continua ativo quando as sugestões escondem Post');
  fs.rmSync(path.join(isolatedState, 'android-app-sessions', 'tiktok.json'));
  assert.equal(await allowUnknownAndroidSession({
    platform: 'tiktok',
    session: { status: 'unknown', packageName: 'com.zhiliaoapp.musically' },
    control: { dumpUi: async () => [] }
  }), false);
});

test('X requires the approved Android browser identity before invoking its publisher', async t => {
  const isolatedState = fs.mkdtempSync(path.join(os.tmpdir(), 'social-x-routing-'));
  const videoPath = path.join(isolatedState, 'fixture.mp4');
  fs.writeFileSync(videoPath, 'fixture');
  const previousStateDir = process.env.STATE_DIR;
  const previousHandle = process.env.ANDROID_SOCIAL_HANDLE_X;
  const originalLoad = Module._load;
  let published = 0;
  process.env.STATE_DIR = isolatedState;
  delete process.env.ANDROID_SOCIAL_HANDLE_X;
  Module._load = function (request, parent, isMain) {
    if (request === '../utils/x-android-publisher') return {
      inspectXAndroidSession: async () => ({ platform: 'x', status: 'identity_unconfirmed' }),
      publishXAndroid: async payload => { published++; assert.equal(payload.videoPath, videoPath); return { status: 'submitted' }; }
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
    if (previousStateDir === undefined) delete process.env.STATE_DIR; else process.env.STATE_DIR = previousStateDir;
    if (previousHandle === undefined) delete process.env.ANDROID_SOCIAL_HANDLE_X; else process.env.ANDROID_SOCIAL_HANDLE_X = previousHandle;
    fs.rmSync(isolatedState, { recursive: true, force: true });
  });
  assert.equal(isSocialHandlerAvailable('x'), true);
  const held = await uploadX({ videoPath, caption: 'fixture' });
  assert.equal(held.evidence.kind, 'confirmed_no_send');
  assert.equal(published, 0);
  process.env.ANDROID_SOCIAL_HANDLE_X = '@approved';
  recordAndroidSession('x', { root: isolatedState, device: 'emulator-5560', accountHandle: '@approved', identityVerified: true });
  assert.equal((await uploadX({ videoPath, caption: 'fixture' })).status, 'submitted');
  assert.equal(published, 1);
  assert.equal(isSocialHandlerAvailable('instagram'), true);
  assert.equal(isSocialHandlerAvailable('tiktok'), true);
  assert.equal(isSocialHandlerAvailable('telegram'), false);
});
