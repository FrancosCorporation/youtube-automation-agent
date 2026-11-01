'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AITextService } = require('../utils/ai-text-service');

test('an explicitly selected Gemini fallback is not shadowed by NVIDIA environment credentials', t => {
  const previousNvidiaKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'test-nvidia-key';
  t.after(() => {
    if (previousNvidiaKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousNvidiaKey;
  });

  const service = new AITextService({ gemini: { apiKey: 'test-gemini-key', model: 'gemini-3.7-flash' } });
  assert.equal(service.providerName, 'Google Gemini');
  assert.equal(service.model, 'gemini-3.7-flash');
  assert.equal(service.isAvailable(), true);
});

test('an explicitly selected OpenAI-compatible gateway uses its own URL and label', () => {
  const service = new AITextService({ aiProvider: {
    provider: 'openai-compatible',
    apiKey: 'test-gateway-key',
    baseURL: 'https://gateway.example/v1',
    name: 'OpenCode test gateway',
    model: 'test-model'
  } });
  assert.equal(service.providerName, 'OpenCode test gateway');
  assert.equal(service.model, 'test-model');
  assert.equal(service.isAvailable(), true);
});
