'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureAndroidChromeCdpForward } = require('../utils/android-chrome-cdp');
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
