'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

function loadLocalAuthRoot() {
  if (process.env.YAI_LOCAL_AUTH_TEST_ROOT) {
    return path.resolve(process.env.YAI_LOCAL_AUTH_TEST_ROOT);
  }
  return path.dirname(require.resolve('@google-cloud/local-auth/package.json'));
}

test('@google-cloud/local-auth works with the audited Google Auth v10 override', () => {
  const localAuthRoot = loadLocalAuthRoot();
  const localAuthEntry = require.resolve(localAuthRoot);
  const authPackage = require.resolve('google-auth-library/package.json', {
    paths: [localAuthRoot]
  });
  const { authenticate } = require(localAuthEntry);
  const { OAuth2Client } = require(require.resolve('google-auth-library', {
    paths: [localAuthRoot]
  }));
  const authVersion = require(authPackage).version;
  const client = new OAuth2Client({ clientId: 'compatibility-test', clientSecret: 'test-secret' });
  const authorizationUrl = client.generateAuthUrl({
    redirect_uri: 'http://localhost:34567/oauth2callback',
    access_type: 'offline',
    scope: 'https://www.googleapis.com/auth/youtube.upload'
  });

  assert.equal(typeof authenticate, 'function');
  assert.equal(Number(authVersion.split('.')[0]), 10);
  assert.equal(typeof client.getToken, 'function');
  assert.equal(new URL(authorizationUrl).hostname, 'accounts.google.com');
  assert.equal(new URL(authorizationUrl).searchParams.get('redirect_uri'), 'http://localhost:34567/oauth2callback');
});
