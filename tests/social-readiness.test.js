'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { checkAndroidInternalStorage, createSocialReadiness, socialReadinessDescription } = require('../utils/social-readiness');

test('an expired local confirmation triggers one real app inspection and can resume without a manual login command', async () => {
  let fresh = false;
  let inspected = 0;
  const ensure = createSocialReadiness({ hasHandler: () => true, isSessionFresh: () => fresh,
    inspectSession: async platform => { inspected++; fresh = true; return { platform, status: 'logged_in' }; } });
  const results = await Promise.all([ensure('kwai'), ensure('kwai')]);
  assert.equal(inspected, 1);
  assert(results.every(result => result.ready));
  assert.equal((await ensure('kwai')).ready, true);
  assert.equal(inspected, 1);
});

test('excluded and unsupported destinations cannot touch the device even with an old login marker', async () => {
  let inspected = 0;
  const ensure = createSocialReadiness({ disabled: ['telegram'], hasHandler: p => p === 'kwai',
    isSessionFresh: () => true, inspectSession: async () => { inspected++; } });
  assert.equal((await ensure('telegram')).status, 'disabled');
  assert.equal((await ensure('instagram')).status, 'handler_unavailable');
  assert.equal(inspected, 0);
});

test('app missing and login-required outcomes remain distinct, coalesce checks and retry after a short cooldown', async () => {
  let time = 1000;
  let checks = 0;
  const ensure = createSocialReadiness({ hasHandler: () => true, isSessionFresh: () => false, now: () => time,
    inspectSession: async () => { checks++; return { status: checks === 1 ? 'app_missing' : 'login_required' }; } });
  assert.equal((await ensure('kwai')).status, 'app_missing');
  assert.equal((await ensure('kwai')).ready, false);
  assert.equal(checks, 1);
  time += 60001;
  assert.equal((await ensure('kwai')).status, 'login_required');
  assert.equal(checks, 2);
});

test('an authenticated profile without approved account identity stays blocked', async () => {
  const ensure = createSocialReadiness({
    hasHandler: () => true,
    isSessionFresh: () => false,
    inspectSession: async () => ({ platform: 'instagram', status: 'identity_unconfirmed', accountHandle: '@pulso_ai_news' })
  });
  const result = await ensure('instagram');
  assert.equal(result.ready, false);
  assert.equal(result.status, 'identity_unconfirmed');
  assert.match(socialReadinessDescription(result.status), /handle esperado.*aprovado/);
});

test('login-required readiness description includes first-use setup screens', () => {
  assert.match(socialReadinessDescription('login_required'), /configuração inicial/);
});

test('low Android storage blocks Instagram before a cached session or app inspection and resumes when free', async () => {
  let freeKiB = 12;
  let inspected = 0;
  const control = { shell: async () => `Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/block 100000 99988 ${freeKiB} 100% /data` };
  const ensure = createSocialReadiness({ hasHandler: () => true, isSessionFresh: () => true,
    preflight: async platform => platform === 'instagram' && await checkAndroidInternalStorage(control, 64 * 1024 * 1024) === false
      ? 'storage_insufficient' : null,
    inspectSession: async () => { inspected++; return { status: 'logged_in' }; } });
  assert.equal((await ensure('instagram')).status, 'storage_insufficient');
  assert.equal((await ensure('kwai')).ready, true);
  assert.equal(inspected, 0);
  freeKiB = 65536;
  assert.equal((await ensure('instagram')).ready, true);
  assert.equal(await checkAndroidInternalStorage({ shell: async () => 'invalid' }, 64 * 1024 * 1024), null);
  assert.equal(await checkAndroidInternalStorage({ shell: async () => { throw new Error('offline'); } }, 64 * 1024 * 1024), null);
});

test('storage recovery trims only Android disposable caches and verifies the result', async () => {
  const { recoverAndroidInternalStorage } = require('../utils/social-readiness');
  const commands = []; let trimmed = false;
  const control = { shell: async args => {
    commands.push(args);
    if (args[0] === 'df') return `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/data 2000000 1000000 ${trimmed ? 800000 : 1000} 50% /data`;
    assert.deepEqual(args, ['pm', 'trim-caches', '1073741824', 'internal']); trimmed = true; return '';
  } };
  assert.equal(await recoverAndroidInternalStorage(control, 64 * 1024 ** 2), true);
  assert.equal(commands.filter(args => args[0] === 'pm').length, 1);
  await recoverAndroidInternalStorage(control, 64 * 1024 ** 2);
  assert.equal(commands.filter(args => args[0] === 'pm').length, 1);
});
