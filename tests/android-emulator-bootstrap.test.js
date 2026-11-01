'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ensureAndroidBooted, waitForAndroidBoot } = require('../utils/android-emulator-bootstrap');

test('Android bootstrap waits for device readiness and reconnects after host/container startup', async () => {
  let time = 0;
  let checks = 0;
  let reconnects = 0;
  const ready = await waitForAndroidBoot({
    isBooted: async () => ++checks === 3,
    reconnect: async () => { reconnects++; },
    wait: async ms => { time += ms; },
    now: () => time,
    timeoutMs: 10000,
    pollIntervalMs: 2000
  });

  assert.equal(ready, true);
  assert.equal(checks, 3);
  assert.equal(reconnects, 2);
  assert.equal(time, 4000);
});

test('Android bootstrap restarts a running but unbooted container once, then succeeds', async () => {
  let attempts = 0;
  let restarts = 0;
  let time = 0;
  const ready = await ensureAndroidBooted({
    isBooted: async () => ++attempts === 2,
    reconnect: async () => {},
    restartContainer: async () => { restarts++; },
    wait: async ms => { time += ms; },
    now: () => time,
    timeoutMs: 0,
    pollIntervalMs: 1,
    maxAttempts: 2
  });

  assert.equal(ready, true);
  assert.equal(restarts, 1);
});

test('Android bootstrap does not report success when both boot attempts time out', async () => {
  let time = 0;
  let restarts = 0;
  await assert.rejects(ensureAndroidBooted({
    isBooted: async () => false,
    reconnect: async () => {},
    restartContainer: async () => { restarts++; },
    wait: async ms => { time += ms; },
    now: () => time,
    timeoutMs: 100,
    pollIntervalMs: 100,
    maxAttempts: 2
  }), /Android indisponível após 2 tentativas/);
  assert.equal(restarts, 1);
});
