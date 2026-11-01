'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readAndroidHierarchy } = require('../utils/android-ui-hierarchy');
const { createAndroidEmulatorControl } = require('../utils/android-emulator-control');
const { dumpUI } = require('../scripts/kwai-emulator');

const xml = '<?xml version="1.0"?><hierarchy><node bounds="[10,20][110,80]" clickable="true" enabled="true" content-desc="A &amp; B" class="android.widget.Button" resource-id="kwai:id/next" text="Pr&#243;ximo" /></hierarchy>';

test('shell hierarchy uses one bounded argv command, unique path and remote timeout', () => {
  const calls = [];
  const runner = (binary, args, options) => { calls.push({ binary, args, options }); return xml; };
  assert.equal(readAndroidHierarchy({ env: {}, adbPath: '/mock/adb', timeoutMs: 5000, runner }), xml);
  readAndroidHierarchy({ env: {}, adbPath: '/mock/adb', timeoutMs: 5000, runner });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].binary, '/mock/adb');
  assert.deepEqual(calls[0].args.slice(0, 3), ['-s', '127.0.0.1:5555', 'shell']);
  assert.match(calls[0].args[3], /timeout -s KILL 4.7 uiautomator dump --compressed/);
  assert.match(calls[0].args[3], /&& cat .*; rm -f/);
  assert.notEqual(calls[0].args[3], calls[1].args[3]);
  assert.equal(calls[0].options.timeout, 5000);
  assert.equal(calls[0].options.killSignal, 'SIGKILL');
});

test('instrumentation backend invokes only the explicit Python helper with argv', () => {
  const calls = [];
  const result = readAndroidHierarchy({ env: { ANDROID_UI_PYTHON: '/isolated path/bin/python' }, timeoutMs: 1200,
    runner: (binary, args, options) => { calls.push({ binary, args, options }); return xml; } });
  assert.equal(result, xml);
  assert.equal(calls[0].binary, '/isolated path/bin/python');
  assert.match(calls[0].args[0], /scripts\/read-android-hierarchy\.py$/);
  assert.deepEqual(calls[0].args.slice(1), ['--device', '127.0.0.1:5555', '--timeout', '0.96']);
  assert.equal(calls[0].options.timeout, 1200);
});

test('hierarchy failure never falls back to another backend or accepts error stdout', () => {
  let calls = 0;
  const result = readAndroidHierarchy({ env: { ANDROID_UI_PYTHON: '/isolated/python' },
    runner: () => { calls++; throw Object.assign(new Error('private screen'), { stdout: xml, stderr: 'private screen' }); } });
  assert.equal(result, '');
  assert.equal(calls, 1);
  for (const output of ['', 'ERROR: could not get idle state', '<hierarchy><node', '<!DOCTYPE hierarchy>' + xml]) {
    assert.equal(readAndroidHierarchy({ env: {}, runner: () => output }), '');
  }
});

test('reader rejects invalid serial and timeout before running a command', () => {
  const runner = () => assert.fail('must not run');
  assert.throws(() => readAndroidHierarchy({ device: 'device;echo unsafe', runner }), /inválido/);
  for (const timeoutMs of [0, -1, NaN, Infinity]) {
    assert.throws(() => readAndroidHierarchy({ timeoutMs, runner }), /inválido/);
  }
});

test('host deadline terminates a hung helper without leaving a child process', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'android reader deadline '));
  const helper = path.join(temp, 'python fixture');
  try {
    fs.writeFileSync(helper, '#!/bin/sh\nexec sleep 10\n', { mode: 0o700 });
    const started = Date.now();
    assert.equal(readAndroidHierarchy({ env: { ...process.env, ANDROID_UI_PYTHON: helper }, timeoutMs: 70 }), '');
    assert.ok(Date.now() - started < 3000, 'subprocess must not consume its ten-second sleep');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('generic Android inspection shares the configured reader and decodes all attribute orders', () => {
  let binary;
  const control = createAndroidEmulatorControl({ env: { ANDROID_UI_PYTHON: '/mock/python' },
    runner: (file, _args, options) => { binary = file; assert.equal(options.timeout, 1800); return xml; } });
  const [node] = control.dumpUi({ timeout: 1800 });
  assert.equal(binary, '/mock/python');
  assert.equal(node.text, 'Próximo');
  assert.equal(node.description, 'A & B');
  assert.equal(node.resourceId, 'kwai:id/next');
});

test('Kwai reader preserves its node contract, ignores hidden controls and disables inactive buttons', async () => {
  const hidden = xml.replace('enabled="true"', 'visible-to-user="false"');
  assert.deepEqual(await dumpUI({ timeoutMs: 1000, runner: () => hidden }), []);
  const nodes = await dumpUI({ timeoutMs: 1000, runner: () => xml.replace('enabled="true"', 'enabled="false"') });
  assert.deepEqual(nodes, [{ text: 'Próximo', rid: 'kwai:id/next', cls: 'android.widget.Button',
    desc: 'A & B', hint: '', clickable: false, x: 60, y: 50, w: 100, h: 60 }]);
});
