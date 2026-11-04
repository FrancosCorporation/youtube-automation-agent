'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { schedulerIsIdle, reloadIdleScheduler, waitForProcessStop } = require('../utils/scheduler-idle-reload');
const now = Date.now();
const health = { status: 'active', heartbeatAt: new Date(now).toISOString(), producer: { state: 'waiting' },
  consumer: { state: 'waiting' }, queue: { inFlight: false }, retry: { inProgress: false } };

test('stale health, production, uploads and retries forbid reload', () => {
  for (const change of [{ heartbeatAt: new Date(now - 90001).toISOString() }, { producer: { state: 'generating' } },
    { consumer: { state: 'publishing' } }, { queue: { inFlight: true } }, { retry: { inProgress: true } }]) {
    assert.equal(schedulerIsIdle({ ...health, ...change }, now), false);
  }
  assert.equal(schedulerIsIdle(health, now), true);
});

test('reload closes spawn race, resumes the coordinator on errors, and never signals its children', async () => {
  const signals = [];
  const options = { pid: 123, readHealth: () => health, readChildren: () => [], hasActiveLocks: () => false,
    now: () => now, waitForStopped: async () => true, signal: (pid, signal) => signals.push([pid, signal]) };
  assert.equal((await reloadIdleScheduler({ ...options, readChildren: () => ['worker'] })).status, 'deferred');
  assert.equal((await reloadIdleScheduler({ ...options, hasActiveLocks: () => true })).status, 'deferred');
  assert.deepEqual(signals, []);
  let reads = 0;
  assert.equal((await reloadIdleScheduler({ ...options, readChildren: () => ++reads === 1 ? [] : ['worker'] })).status, 'deferred');
  assert.deepEqual(signals.splice(0), [[123, 'SIGSTOP'], [123, 'SIGCONT']]);
  assert.equal((await reloadIdleScheduler(options)).status, 'requested');
  assert.deepEqual(signals.splice(0), [[123, 'SIGSTOP'], [123, 'SIGTERM'], [123, 'SIGCONT']]);
  reads = 0;
  await assert.rejects(reloadIdleScheduler({ ...options, readChildren: () => { if (++reads === 2) throw new Error('io'); return []; } }), /io/);
  assert.deepEqual(signals, [[123, 'SIGSTOP'], [123, 'SIGCONT']]);
});

test('an unacknowledged stop cannot terminate the coordinator', async () => {
  const signals = [];
  let checks = 0;
  const options = { pid: 123, readHealth: () => health, now: () => now,
    readChildren: () => { checks++; return []; }, hasActiveLocks: () => false,
    signal: (_pid, signal) => signals.push(signal), waitForStopped: async () => false };
  assert.equal((await reloadIdleScheduler(options)).status, 'deferred');
  assert.equal(checks, 1);
  assert.deepEqual(signals.splice(0), ['SIGSTOP', 'SIGCONT']);
  await assert.rejects(reloadIdleScheduler({ ...options, waitForStopped: async () => { throw new Error('process exited'); } }), /process exited/);
  assert.deepEqual(signals, ['SIGSTOP', 'SIGCONT']);
});

test('Linux acknowledges a real child stop before reload checks continue', { skip: process.platform !== 'linux' }, async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await once(child, 'spawn');
  t.after(async () => {
    const exited = once(child, 'exit');
    child.kill('SIGCONT');
    child.kill('SIGTERM');
    await exited;
  });
  child.kill('SIGSTOP');
  assert.equal(await waitForProcessStop(child.pid), true);
});
