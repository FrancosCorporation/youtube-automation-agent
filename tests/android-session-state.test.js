'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  clearAndroidSession,
  hasRecentAndroidSession,
  recordAndroidSession,
  sessionPath
} = require('../utils/android-session-state');

test('Android login evidence is private, short lived, and contains no account credentials', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'android-session-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = Date.parse('2026-10-13T12:00:00Z');

  const file = recordAndroidSession('instagram', { root, now });
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.deepEqual(Object.keys(parsed).sort(), ['platform', 'status', 'verifiedAt']);
  assert.equal(hasRecentAndroidSession('instagram', { root, now: now + 1000 }), true);
  assert.equal(hasRecentAndroidSession('instagram', { root, device: 'emulator-5560', now: now + 1000 }), false,
    'legacy markers without a device require live revalidation');
  assert.equal(hasRecentAndroidSession('instagram', { root, now: now + 24 * 60 * 60 * 1000 + 1 }), false);
  assert.equal(hasRecentAndroidSession('tiktok', { root, now }), false);
});

test('Android login evidence is bound to its device and invalidated when the route changes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'android-session-device-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  recordAndroidSession('instagram', { root, device: 'emulator-5560' });
  assert.equal(hasRecentAndroidSession('instagram', { root, device: 'emulator-5560' }), true);
  assert.equal(hasRecentAndroidSession('instagram', { root, device: '127.0.0.1:5555' }), false);
  assert.throws(() => recordAndroidSession('instagram', { root, device: 'emulator/5560' }), /dispositivo Android inválido/);
});

test('social session markers require an exact owner-approved handle when one is expected', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'android-session-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  recordAndroidSession('instagram', {
    root, device: 'emulator-5560', accountHandle: 'Pulso_AI_News', identityVerified: false
  });
  assert.equal(hasRecentAndroidSession('instagram', { root, device: 'emulator-5560', expectedHandle: '@pulso_ai_news' }), false);

  recordAndroidSession('instagram', {
    root, device: 'emulator-5560', accountHandle: '@Pulso_AI_News', identityVerified: true
  });
  assert.equal(hasRecentAndroidSession('instagram', { root, device: 'emulator-5560', expectedHandle: 'pulso_ai_news' }), true);
  assert.equal(hasRecentAndroidSession('instagram', { root, device: 'emulator-5560', expectedHandle: '@other_account' }), false);
  assert.throws(() => recordAndroidSession('instagram', { root, accountHandle: 'https://example.com' }), /handle social inválido/);
});

test('Android login evidence can be revoked and platform paths are validated', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'android-session-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  recordAndroidSession('kwai', { root });

  assert.equal(clearAndroidSession('kwai', { root }), true);
  assert.equal(clearAndroidSession('kwai', { root }), false);
  assert.equal(hasRecentAndroidSession('kwai', { root }), false);
  assert.throws(() => sessionPath('../x', { root }), /plataforma Android inválida/);
});
