'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { withAndroidDeviceLock } = require('../utils/android-device-lock');

test('Android device lock serializes uploads across concurrent processes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'android-device-lock-'));
  const lockPath = path.join(root, 'device.lock');
  let active = 0;
  let maximum = 0;
  const run = name => withAndroidDeviceLock(async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 30));
    active--;
    return name;
  }, { lockPath, pollIntervalMs: 2, timeoutMs: 1000, owner: name });

  try {
    assert.deepEqual(await Promise.all([run('kwai'), run('instagram'), run('x')]), ['kwai', 'instagram', 'x']);
    assert.equal(maximum, 1);
    await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Android device lock recovers an abandoned PID and releases after callback failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'android-device-lock-stale-'));
  const lockPath = path.join(root, 'device.lock');
  await fs.writeFile(lockPath, JSON.stringify({ pid: 2147483647, token: 'stale' }));

  try {
    await assert.rejects(withAndroidDeviceLock(async () => {
      throw new Error('upload failed');
    }, { lockPath, pollIntervalMs: 2, timeoutMs: 500, staleAfterMs: 1000 }), /upload failed/);
    await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
