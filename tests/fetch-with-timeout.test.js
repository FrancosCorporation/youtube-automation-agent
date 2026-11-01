'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fetchWithTimeout } = require('../utils/fetch-with-timeout');

test('fetchWithTimeout aborts a request after its configured deadline', async () => {
  let observedSignal;
  const fakeFetch = (_url, options) => {
    observedSignal = options.signal;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  };

  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(fetchWithTimeout('https://example.test', {}, 15, fakeFetch), { name: 'TimeoutError' });
    assert.equal(observedSignal.aborted, true);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('fetchWithTimeout preserves caller cancellation and validates its arguments', async () => {
  const controller = new AbortController();
  const fakeFetch = (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const pending = fetchWithTimeout('https://example.test', { signal: controller.signal }, 1000, fakeFetch);
  controller.abort(new Error('caller cancelled'));

  await assert.rejects(pending, /caller cancelled/);
  assert.throws(() => fetchWithTimeout('https://example.test', {}, 0, fakeFetch), RangeError);
  assert.throws(() => fetchWithTimeout('https://example.test', {}, 1, null), TypeError);
});
