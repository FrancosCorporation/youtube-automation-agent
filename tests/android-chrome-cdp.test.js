'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureAndroidChromeCdpForward, resolveAndroidChromeCdpUrl } = require('../utils/android-chrome-cdp');
const options = { cdpUrl: 'http://127.0.0.1:9223', device: 'emulator-5560' };
test('restores an absent local forward without rebinding another session', () => {
  const calls = [];
  assert.equal(ensureAndroidChromeCdpForward({ ...options, runAdb: (device, args) => { calls.push([device, ...args]);return ''; } }), true);
  assert.deepEqual(calls, [['emulator-5560', 'forward', '--list'],
    ['emulator-5560', 'forward', '--no-rebind', 'tcp:9223', 'localabstract:chrome_devtools_remote']]);
});
test('preserves the correct existing forward and refuses one owned by another device or socket', () => {
  for (const [serial, socket, expected] of [['emulator-5560', 'chrome_devtools_remote', false],
    ['emulator-5554', 'chrome_devtools_remote', 'ANDROID_CHROME_CDP_PORT_IN_USE'],
    ['emulator-5560', 'other_browser', 'ANDROID_CHROME_CDP_PORT_IN_USE']]) {
    let calls = 0;
    const run = () => ensureAndroidChromeCdpForward({ ...options, runAdb: () => { calls++;return `${serial} tcp:9223 localabstract:${socket}\n`; } });
    if (expected === false) assert.equal(run(), false);
    else assert.throws(run, { code: expected });
    assert.equal(calls, 1);
  }
});
test('a remote endpoint never touches Android forwarding', () => {
  assert.equal(ensureAndroidChromeCdpForward({ ...options, cdpUrl: 'https://remote.example', runAdb: () => assert.fail() }), false);
});

test('host Chrome port collision reuses only the same Android Chrome binding', () => {
  const calls = [];
  const url = resolveAndroidChromeCdpUrl({ ...options, runAdb: (_device, args) => {
    calls.push(args);
    if (args.includes('--list')) return 'emulator-5560 tcp:9235 localabstract:chrome_devtools_remote\n';
    throw Object.assign(new Error('ADB forward failed'), {
      cause: { stderr: 'adb: error: cannot bind listener: Address already in use' }
    });
  } });
  assert.equal(url, 'http://127.0.0.1:9235');
  assert.equal(calls.filter(args => args.includes('tcp:0')).length, 0);
  assert(calls.some(args => args.includes('--no-rebind')));
});

test('a foreign device keeps its port while a new binding is verified for this device', () => {
  const calls = [];
  let allocated = false;
  const url = resolveAndroidChromeCdpUrl({ ...options, runAdb: (_device, args) => {
    calls.push(args);
    if (args.includes('--list')) return 'emulator-5554 tcp:9223 localabstract:chrome_devtools_remote\n'
      + (allocated ? 'emulator-5560 tcp:32001 localabstract:chrome_devtools_remote\n' : '');
    assert.deepEqual(args, ['forward', 'tcp:0', 'localabstract:chrome_devtools_remote']);
    allocated = true;
    return '32001\n';
  } });
  assert.equal(url, 'http://127.0.0.1:32001');
  assert.equal(calls.filter(args => args.includes('tcp:0')).length, 1);
});

test('a malformed port or a mismatching allocated binding cannot become a CDP URL', () => {
  for (const allocated of ['garbage', '80', '65536', '32002']) {
    assert.throws(() => resolveAndroidChromeCdpUrl({ ...options, runAdb: (_device, args) => {
      if (args.includes('--list')) return 'emulator-other tcp:9223 localabstract:chrome_devtools_remote\n';
      return allocated;
    } }), { code: 'ANDROID_CHROME_CDP_FORWARD_UNVERIFIED' });
  }
});

test('offline and authentication failures do not trigger port recovery', () => {
  let calls = 0;
  const error = Object.assign(new Error('device offline'), { code: 'YOUTUBE_STUDIO_ADB_FAILED' });
  assert.throws(() => resolveAndroidChromeCdpUrl({ ...options, runAdb: () => { calls++; throw error; } }), e => e === error);
  assert.equal(calls, 1);
  assert.equal(resolveAndroidChromeCdpUrl({ ...options, cdpUrl: 'https://remote.example', runAdb: () => assert.fail() }), 'https://remote.example');
});
