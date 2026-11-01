'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { requestNvidiaChatCompletion } = require('../utils/nvidia-chat-completions');

function mockResponse(status, value) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => value };
}

test('NVIDIA chat completion returns synchronous responses unchanged', async () => {
  const expected = mockResponse(200, { choices: [] });
  let request;
  const response = await requestNvidiaChatCompletion({
    apiKey: 'test-key',
    body: { model: 'openai/gpt-oss-20b' },
    timeoutMs: 1000,
    fetchImpl: async (url, init) => { request = { url, init }; return expected; }
  });

  assert.equal(response, expected);
  assert.equal(request.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(JSON.parse(request.init.body), { model: 'openai/gpt-oss-20b' });
});

test('NVIDIA chat completion polls a pending request until its result is ready', async () => {
  const calls = [];
  let now = 0;
  const responses = [
    mockResponse(202, { requestId: 'req-123' }),
    mockResponse(202, { status: 'pending' }),
    mockResponse(200, { choices: [{ finish_reason: 'stop' }] })
  ];
  const response = await requestNvidiaChatCompletion({
    apiKey: 'test-key',
    body: { model: 'openai/gpt-oss-20b' },
    timeoutMs: 5000,
    pollIntervalMs: 10,
    now: () => now,
    sleepImpl: async ms => { now += ms; },
    fetchImpl: async (url, init) => { calls.push({ url, init }); return responses.shift(); }
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, 'https://integrate.api.nvidia.com/v1/status/req-123');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer test-key');
});

test('NVIDIA chat completion forwards cancellation through the pending status poll', async () => {
  const controller = new AbortController();
  const calls = [];
  const responses = [
    mockResponse(202, { requestId: 'req-cancel' }),
    mockResponse(200, { choices: [{ finish_reason: 'stop' }] })
  ];
  await requestNvidiaChatCompletion({
    apiKey: 'test-key',
    body: { model: 'openai/gpt-oss-20b' },
    timeoutMs: 5000,
    signal: controller.signal,
    pollIntervalMs: 10,
    sleepImpl: async () => {},
    fetchImpl: async (url, init) => {
      calls.push({ url, signal: init.signal });
      return responses.shift();
    }
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal.aborted, false);
  assert.equal(calls[1].signal.aborted, false);
  controller.abort();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, true);
});

test('NVIDIA pending responses without a request ID fail with a safe code', async () => {
  await assert.rejects(requestNvidiaChatCompletion({
    apiKey: 'test-key',
    body: { model: 'openai/gpt-oss-20b' },
    timeoutMs: 1000,
    fetchImpl: async () => mockResponse(202, { status: 'pending' })
  }), error => error.code === 'NVIDIA_PENDING_REQUEST_ID_MISSING');
});

test('NVIDIA status polling respects the original request timeout', async () => {
  let now = 0;
  let calls = 0;
  await assert.rejects(requestNvidiaChatCompletion({
    apiKey: 'test-key',
    body: { model: 'openai/gpt-oss-20b' },
    timeoutMs: 20,
    pollIntervalMs: 20,
    now: () => now,
    sleepImpl: async ms => { now += ms; },
    fetchImpl: async () => {
      calls += 1;
      return mockResponse(202, { requestId: 'req-123' });
    }
  }), error => error.code === 'NVIDIA_STATUS_POLL_TIMEOUT' && error.name === 'TimeoutError');
  assert.equal(calls, 1);
});
