'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  OAUTH_SCOPES,
  validateCallbackRequest,
  validateOAuthTokens,
  findVerifiedChannelId,
  quoteAndroidShell,
  writePrivateObject
} = require('../scripts/auth-youtube-emulator');

test('OAuth callback requires matching CSRF state and a nonempty code', () => {
  assert.equal(validateCallbackRequest('/?state=expected&code=abc', 'expected'), 'abc');
  assert.throws(() => validateCallbackRequest('/?state=wrong&code=abc', 'expected'), /state mismatch/);
  assert.throws(() => validateCallbackRequest('/?state=expected&error=access_denied', 'expected'), /access_denied/);
  assert.throws(() => validateCallbackRequest('/?state=expected', 'expected'), /authorization code/);
});

test('OAuth token is rejected without refresh token or any required YouTube scope', () => {
  assert.throws(() => validateOAuthTokens({ access_token: 'access', scope: OAUTH_SCOPES.join(' ') }), /refresh tokens/);
  assert.throws(() => validateOAuthTokens({ access_token: 'access', refresh_token: 'refresh', scope: OAUTH_SCOPES.slice(1).join(' ') }), /scopes are incomplete/);
  assert.doesNotThrow(() => validateOAuthTokens({
    access_token: 'access', refresh_token: 'refresh', scope: OAUTH_SCOPES.join(' ')
  }));
});

test('channel identity must overlap both the signed-in account and known uploaded videos', () => {
  assert.equal(findVerifiedChannelId(['channel-a'], ['channel-b', 'channel-a']), 'channel-a');
  assert.equal(findVerifiedChannelId(['channel-a'], ['channel-b']), null);
  assert.equal(findVerifiedChannelId([], ['channel-a']), null);
});

test('Android shell URL quoting preserves OAuth query parameters', () => {
  assert.equal(quoteAndroidShell('https://accounts.google.test/?state=a&prompt=consent'), "'https://accounts.google.test/?state=a&prompt=consent'");
  assert.equal(quoteAndroidShell("https://accounts.google.test/?q=o'hare"), "'https://accounts.google.test/?q=o'\\''hare'");
});

test('OAuth token storage is atomic and private', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-oauth-emulator-'));
  const target = path.join(directory, 'tokens.json');
  try {
    await writePrivateObject(target, { youtube: { refresh_token: 'private' }, other: { keep: true } });
    const stored = JSON.parse(await fs.readFile(target, 'utf8'));
    assert.deepEqual(stored, { youtube: { refresh_token: 'private' }, other: { keep: true } });
    assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['tokens.json']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
