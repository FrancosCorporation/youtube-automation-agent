'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { NVIDIA_BASE_URL, nvidiaDailyLimit, nvidiaRouteIdentity, initializeNvidiaRuntime, nvidiaSceneModels } = require('../utils/nvidia-runtime');

test('NVIDIA sem teto local mantém limites explícitos e invalida circuito ao trocar rota', () => {
  assert.equal(nvidiaDailyLimit({}), null);
  assert.equal(nvidiaDailyLimit({ NVIDIA_CALLS_PER_DAY: '0' }), null);
  assert.equal(nvidiaDailyLimit({ NVIDIA_CALLS_PER_DAY: 'unlimited' }), null);
  assert.equal(nvidiaDailyLimit({ NVIDIA_CALLS_PER_DAY: '600' }), 600);
  assert.throws(() => nvidiaDailyLimit({ NVIDIA_CALLS_PER_DAY: '-1' }), TypeError);
  const first = { NVIDIA_API_KEY: 'test-first', NVIDIA_CALLS_PER_DAY: '600' };
  assert.notEqual(nvidiaRouteIdentity(first), nvidiaRouteIdentity({ ...first, NVIDIA_CALLS_PER_DAY: '0' }));
  assert.notEqual(nvidiaRouteIdentity(first), nvidiaRouteIdentity({ ...first, NVIDIA_API_KEY: 'test-second' }));
});

test('catálogo usa credencial autorizada sem expor segredo e filtra modelos de autoria', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-nvidia-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'opencode.json');
  await fs.writeFile(configPath, JSON.stringify({ provider: { nvidia: { options: {
    baseURL: NVIDIA_BASE_URL, apiKey: 'test-config-only'
  } } } }));
  const messages = [];
  const environment = { NVIDIA_API_KEY: 'test-old' };
  const result = await initializeNvidiaRuntime({ environment, configPath,
    logger: { info: message => messages.push(message) }, fetchImpl: async (url, options) => {
      assert.equal(url, `${NVIDIA_BASE_URL}/models`);
      assert.equal(options.headers.Authorization, 'Bearer test-config-only');
      return { ok: true, json: async () => ({ data: [
        { id: 'nvidia/nemotron-3.5-super-vl-120b-a12b' }, { id: 'stepfun-ai/step-5-preview' },
        { id: 'nvidia/ai-synthetic-video-detector' }
      ] }) };
    } });
  assert.equal(environment.NVIDIA_API_KEY, 'test-config-only');
  assert.deepEqual(result.models, ['nvidia/nemotron-3.5-super-vl-120b-a12b', 'stepfun-ai/step-5-preview']);
  assert.deepEqual(nvidiaSceneModels(), result.models);
  assert(!messages.join(' ').includes('test-config-only'));
});
