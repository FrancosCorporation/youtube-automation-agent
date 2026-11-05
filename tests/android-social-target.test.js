'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { socialAndroidTarget } = require('../utils/android-social-target');
const { createAndroidEmulatorControl } = require('../utils/android-emulator-control');

function fixture({ status = 'stopped', booted, startError, statusError, locked = false, device = 'emulator-5560' } = {}) {
  let current = status, time = 0, held = false;
  const calls = [], starts = [], locks = [];
  const control = {
    run(args, options) {
      calls.push(args.join(' '));
      assert.ok(options.timeout <= 8000);
      if (args[2] === 'status') {
        if (statusError) throw new Error('console unavailable');
        return `virtual device is ${current}\r\nOK\r\n`;
      }
      assert.equal(held, true, 'resume must own device lock');
      assert.equal(args.join(' '), 'emu avd start');
      current = 'running';
      if (startError) throw new Error('console response timed out');
      return 'OK';
    },
    isBooted: () => booted ?? current === 'running'
  };
  const target = socialAndroidTarget('x', {
    env: { ANDROID_DEVICE_X: device }, stateRoot: '/tmp/target-test', control,
    withLock: async (action, options) => {
      locks.push(options.lockPath);
      if (locked) throw new Error('device occupied');
      held = true;
      try { return await action(); } finally { held = false; }
    },
    runService: (...args) => starts.push(args), now: () => time,
    wait: async ms => { time += ms; }, bootTimeoutMs: 3000
  });
  return { target, calls, starts, locks, elapsed: () => time };
}

test('paused Google Play VM resumes once under its device lock without restarting the unit', async () => {
  const f = fixture();
  await f.target.emulator.acquire();
  assert.deepEqual(f.calls, ['emu avd status', 'emu avd status', 'emu avd start']);
  assert.deepEqual(f.locks, [f.target.lockPath]);
  assert.equal(f.starts.length, 0);
});

test('a timed out resume response is reconciled against VM state without repeating start', async () => {
  const f = fixture({ startError: true });
  await f.target.emulator.acquire();
  assert.equal(f.calls.filter(s => s === 'emu avd start').length, 1);
  assert.equal(f.calls.at(-1), 'emu avd status');
});

test('running VM and remote devices do not acquire recovery locks or send resume', async () => {
  for (const options of [{ status: 'running' }, { device: '192.0.2.10:5555', booted: true }]) {
    const f = fixture(options);
    await f.target.emulator.acquire();
    assert.equal(f.calls.includes('emu avd start'), false);
    assert.equal(f.locks.length, 0);
    assert.equal(f.starts.length, 0);
  }
});

test('unknown/error console responses cannot authorize resume and boot failure stays bounded', async () => {
  for (const options of [{ status: 'not stopped' }, { statusError: true }]) {
    const f = fixture({ ...options, booted: false });
    await assert.rejects(f.target.emulator.acquire(), /não concluiu o boot/);
    assert.equal(f.calls.includes('emu avd start'), false);
    assert.equal(f.starts.length, 1);
    assert.deepEqual(f.starts[0].slice(0, 2), ['systemctl', ['--user', 'start', 'pulso-social-android.service']]);
    assert.equal(f.elapsed(), 3000);
  }
});

test('occupied Android lock leaves paused VM and unit untouched', async () => {
  const f = fixture({ locked: true });
  await assert.rejects(f.target.emulator.acquire(), /device occupied/);
  assert.deepEqual(f.calls, ['emu avd status']);
  assert.equal(f.starts.length, 0);
});

test('boot probe uses a short timeout even when Android shell is unresponsive', () => {
  let observed;
  const control = createAndroidEmulatorControl({ device: 'emulator-5560', runner: (_file, args, options) => {
    observed = { args, options };
    throw new Error('timeout');
  } });
  assert.equal(control.isBooted(), false);
  assert.equal(observed.options.timeout, 5000);
  assert.deepEqual(observed.args.slice(-3), ['shell', 'getprop', 'sys.boot_completed']);
});
