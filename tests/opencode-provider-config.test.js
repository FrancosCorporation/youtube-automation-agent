'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  getConfiguredMimoCodeProvider,
  loadConfiguredMimoCodeProvider,
  loadConfiguredOpenCodeProviders,
  getConfiguredOpenCodeProvider
} = require('../utils/opencode-providers');

test('loads only allowlisted OpenCode chat gateways with explicit keys and models', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-provider-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, 'opencode.json');
  fs.writeFileSync(configPath, JSON.stringify({ provider: {
    atria: { options: { apiKey: 'atria-test-secret', baseURL: 'https://api.atria-asi.ai/v1/' }, models: { 'Atria-Dawn-Preview': {} } },
    mwapi: { options: { apiKey: 'mwapi-test-secret', baseURL: 'https://api.mwapi.dev/v1' }, models: { 'claude-haiku-test': {} } },
    lebang: { options: { apiKey: '', baseURL: 'https://lebang.si/v1' }, models: { 'model-without-key': {} } },
    unrelated: { options: { apiKey: 'must-not-be-used', baseURL: 'https://other.example/v1' }, models: { other: {} } }
  } }));

  const providers = loadConfiguredOpenCodeProviders({ configPath });
  assert.deepEqual(providers.map(provider => provider.id), ['atria', 'mwapi']);
  assert.equal(providers[0].baseURL, 'https://api.atria-asi.ai/v1');
  assert.deepEqual(providers[0].models, ['Atria-Dawn']);
  assert.deepEqual(providers[1].models, ['claude-haiku-test']);
  assert.equal(getConfiguredOpenCodeProvider('mwapi', { configPath }).apiKey, 'mwapi-test-secret');
  assert.equal(getConfiguredOpenCodeProvider('unrelated', { configPath }), null);
});

test('missing or invalid OpenCode config fails closed without throwing', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-provider-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const missingPath = path.join(dir, 'missing.json');
  assert.deepEqual(loadConfiguredOpenCodeProviders({ configPath: missingPath }), []);
  const invalidPath = path.join(dir, 'invalid.json');
  fs.writeFileSync(invalidPath, '{invalid');
  assert.deepEqual(loadConfiguredOpenCodeProviders({ configPath: invalidPath }), []);
});

test('loads the MimoCode Xiaomi key only for its fixed API endpoint', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimocode-provider-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const authPath = path.join(dir, 'auth.json');
  fs.writeFileSync(authPath, JSON.stringify({ xiaomi: {
    type: 'api',
    key: 'mimo-test-secret',
    metadata: { base_url: 'https://api.xiaomimimo.com/v1/' }
  } }));
  const provider = loadConfiguredMimoCodeProvider({ authPath });
  assert.equal(provider.route, 'mimocode');
  assert.equal(provider.baseURL, 'https://api.xiaomimimo.com/v1');
  assert.deepEqual(provider.models, ['mimo-v2.6-flash', 'mimo-v2.6-pro']);
  assert.equal(getConfiguredMimoCodeProvider({ authPath }).apiKey, 'mimo-test-secret');

  fs.writeFileSync(authPath, JSON.stringify({ xiaomi: {
    type: 'api', key: 'must-not-be-sent', metadata: { base_url: 'https://attacker.example/v1' }
  } }));
  assert.equal(loadConfiguredMimoCodeProvider({ authPath }), null);
});
