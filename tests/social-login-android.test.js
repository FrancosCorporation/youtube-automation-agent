'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { formatLoginResult, inspectSocialLogin, recoverSavedTikTokLogin } = require('../scripts/social-login');
const { hasRecentAndroidSession } = require('../utils/android-session-state');

function fakeEmulator() {
  return { acquired: 0, released: 0, confirmed: 0,
    async acquire() { this.acquired++; },
    release() { this.released++; },
    confirmLogin() { this.confirmed++; }
  };
}

test('TikTok saved login only selects a single Google account for the expected profile', async () => {
  const welcome = [
    { text: 'Welcome back', visible: true }, { text: 'rodolfofranco13', visible: true },
    { text: 'Log in', clickable: true, visible: true, x: 300, y: 900 }
  ];
  const picker = [
    { text: 'to continue to TikTok', visible: true },
    { resourceId: 'com.google.android.gms:id/account_name', visible: true, x: 300, y: 700 }
  ];
  let reads = 0;
  const taps = [];
  const control = { dumpUi: async () => reads++ === 0 ? welcome : picker, tap: async (x, y) => taps.push([x, y]) };
  assert.equal(await recoverSavedTikTokLogin(control, '@rodolfofranco13', { wait: async () => {} }), true);
  assert.deepEqual(taps, [[300, 900], [300, 700]]);

  reads = 0; taps.length = 0;
  assert.equal(await recoverSavedTikTokLogin(control, '@another_account', { wait: async () => {} }), false);
  assert.deepEqual(taps, []);

  reads = 0; taps.length = 0;
  const multiple = { ...control, dumpUi: async () => reads++ === 0 ? welcome : [...picker, { ...picker[1], y: 800 }] };
  assert.equal(await recoverSavedTikTokLogin(multiple, '@rodolfofranco13', { wait: async () => {} }), true);
  assert.deepEqual(taps, [[300, 900]], 'do not choose among multiple Google accounts');

  const chooser = [
    { text: 'Sign in with Google', visible: true }, { text: 'Use your account for TikTok', visible: true },
    { text: 'account@example.test', visible: true }, { text: 'Continue', visible: true, x: 600, y: 1120 }
  ];
  taps.length = 0;
  assert.equal(await recoverSavedTikTokLogin({ dumpUi: async () => chooser, tap: async (x, y) => taps.push([x, y]) },
    '@rodolfofranco13', { wait: async () => {} }), true);
  assert.deepEqual(taps, [[600, 1120]]);
  taps.length = 0;
  assert.equal(await recoverSavedTikTokLogin({ dumpUi: async () => [...chooser, { text: 'other@example.test' }], tap: async (x, y) => taps.push([x, y]) },
    '@rodolfofranco13', { wait: async () => {} }), false);
  assert.deepEqual(taps, []);
});

function temporaryState(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-login-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('social login opens only an installed Android app and confirms Kwai after a real home screen', async t => {
  const stateRoot = temporaryState(t);
  const emulator = fakeEmulator();
  const control = {
    device: '127.0.0.1:5555',
    async isPackageInstalled() { return true; },
    openApp() {},
    async dumpUi() { return [{ text: 'Perfil', description: '', visible: true }]; }
  };

  const result = await inspectSocialLogin('kwai', { control, emulator, timeoutMs: 20, sessionRoot: stateRoot });

  assert.equal(result.status, 'logged_in');
  assert.equal(emulator.acquired, 1);
  assert.equal(emulator.released, 1);
  assert.equal(emulator.confirmed, 1);
  assert.equal(hasRecentAndroidSession('kwai', { root: stateRoot, device: '127.0.0.1:5555' }), true);
  assert.equal(hasRecentAndroidSession('kwai', { root: stateRoot, device: 'emulator-5560' }), false);
});

test('social login reports a missing Android app and never marks it authenticated', async t => {
  const stateRoot = temporaryState(t);
  const emulator = fakeEmulator();
  const control = {
    async isPackageInstalled() { return false; },
    openApp() { throw new Error('não deve abrir app ausente'); },
    async dumpUi() { return []; }
  };

  const result = await inspectSocialLogin('instagram', { control, emulator, sessionRoot: stateRoot });

  assert.equal(result.status, 'app_missing');
  assert.equal(emulator.confirmed, 0);
  assert.match(formatLoginResult(result), /app não instalado no emulador/);
});

test('social login explains that unknown screens require the account profile, not another install', () => {
  assert.match(formatLoginResult({ platform: 'instagram', packageName: 'com.instagram.android', status: 'unknown' }),
    /perfil próprio não confirmado/);
  assert.match(formatLoginResult({ platform: 'tiktok', packageName: 'com.zhiliaoapp.musically', status: 'login_required' }),
    /configuração inicial necessária/);
});

test('social login records the observed Instagram handle but blocks until the exact handle is approved', async t => {
  const stateRoot = temporaryState(t);
  const handleEnv = 'ANDROID_SOCIAL_HANDLE_INSTAGRAM';
  const previousHandle = process.env[handleEnv];
  process.env[handleEnv] = '';
  t.after(() => {
    if (previousHandle === undefined) delete process.env[handleEnv];
    else process.env[handleEnv] = previousHandle;
  });
  const emulator = fakeEmulator();
  const control = {
    device: 'emulator-5560',
    async isPackageInstalled() { return true; },
    getResumedActivity() { return 'com.instagram.android/ProfileScreen'; },
    openApp() { throw new Error('must preserve the active profile'); },
    async dumpUi() { return [
      { text: 'Edit profile', visible: true },
      { text: 'pulso_ai_news', resourceId: 'com.instagram.android:id/action_bar_title', visible: true }
    ]; }
  };
  const options = { control, emulator, sessionRoot: stateRoot, timeoutMs: 20, withLock: callback => callback() };

  const unconfirmed = await inspectSocialLogin('instagram', options);
  assert.equal(unconfirmed.status, 'identity_unconfirmed');
  assert.equal(hasRecentAndroidSession('instagram', {
    root: stateRoot, device: 'emulator-5560', expectedHandle: '@pulso_ai_news'
  }), false);

  const approved = await inspectSocialLogin('instagram', { ...options, expectedHandle: '@PULSO_AI_NEWS' });
  assert.equal(approved.status, 'logged_in');
  assert.equal(approved.accountHandle, '@pulso_ai_news');
  assert.equal(hasRecentAndroidSession('instagram', {
    root: stateRoot, device: 'emulator-5560', expectedHandle: '@pulso_ai_news'
  }), true);

  const mismatch = await inspectSocialLogin('instagram', { ...options, expectedHandle: '@another_account' });
  assert.equal(mismatch.status, 'identity_mismatch');
  assert.equal(hasRecentAndroidSession('instagram', {
    root: stateRoot, device: 'emulator-5560', expectedHandle: '@another_account'
  }), false);
});

test('social login rejects unknown apps and releases the emulator after inspection failure', async t => {
  const stateRoot = temporaryState(t);
  const emulator = fakeEmulator();
  await assert.rejects(inspectSocialLogin('facebook', { emulator, sessionRoot: stateRoot }), /plataforma desconhecida/);

  await assert.rejects(inspectSocialLogin('x', {
    emulator,
    control: {
      async isPackageInstalled() { throw new Error('ADB indisponível'); },
      openApp() {},
      async dumpUi() { return []; }
    },
    sessionRoot: stateRoot
  }), /ADB indisponível/);
  assert.equal(emulator.acquired, 1);
  assert.equal(emulator.released, 1);
});

test('automatic revalidation restores Firefox within the device lock; Telegram is excluded', async t => {
  const stateRoot = temporaryState(t);
  const events = [];
  const emulator = fakeEmulator();
  const control = {
    getResumedActivity: () => 'org.mozilla.firefox/org.mozilla.fenix.HomeActivity',
    async isPackageInstalled() { return true; },
    openApp() { events.push('open'); },
    async dumpUi() { return [{ text: 'Perfil', visible: true }]; },
    shell(args) { assert(args.includes('org.mozilla.firefox/org.mozilla.fenix.HomeActivity')); events.push('restore'); }
  };
  const result = await inspectSocialLogin('kwai', { control, emulator, sessionRoot: stateRoot, restorePrevious: true,
    withLock: async callback => { events.push('lock'); const r = await callback(); events.push('unlock'); return r; } });
  assert.equal(result.status, 'logged_in');
  assert.deepEqual(events, ['lock', 'open', 'restore', 'unlock']);
  await assert.rejects(inspectSocialLogin('telegram', { emulator }), /plataforma desconhecida/);
  assert.equal(emulator.acquired, 1);
});
