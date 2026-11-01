'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Both session inspection and Kwai controls must use the same backend. Mixing
// shell uiautomator and an instrumentation server can disconnect accessibility.
function readAndroidHierarchy({
  adbPath = 'adb', device = '127.0.0.1:5555', timeoutMs = 30000,
  env = process.env, runner = execFileSync
} = {}) {
  if (!/^[\w.:-]+$/.test(device)) throw new TypeError('identificador Android inválido');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new TypeError('prazo da hierarquia Android inválido');
  const timeout = Math.ceil(timeoutMs);
  // Reserve time for the helper to exit/clean up before the host hard deadline.
  const seconds = Math.max(0.001, (timeout - Math.min(300, timeout / 5)) / 1000);
  const python = String(env.ANDROID_UI_PYTHON || '').trim();
  let binary, args;
  if (python) {
    binary = python;
    args = [path.join(__dirname, '..', 'scripts', 'read-android-hierarchy.py'),
      '--device', device, '--timeout', String(seconds)];
  } else {
    binary = adbPath;
    const remote = '/sdcard/pulso-ui-' + crypto.randomUUID() + '.xml';
    // Generated path/validated numbers only; no media path or user text enters
    // this remote shell. timeout terminates the Android command, not just adb.
    const command = `timeout -s KILL ${seconds} uiautomator dump --compressed ${remote} >/dev/null 2>&1 && cat ${remote}; rm -f ${remote}`;
    args = ['-s', device, 'shell', command];
  }
  try {
    const output = String(runner(binary, args, {
      encoding: 'utf8', timeout, killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024,
      env: { ...env, ADBUTILS_ADB_PATH: adbPath }
    }) || '').trim();
    // Partial output from a timed out command is never accepted as a new tree.
    return /^(?:<\?xml[^>]*\?>\s*)?<hierarchy\b/.test(output)
      && /<\/hierarchy>$/.test(output) && !/<!DOCTYPE|<!ENTITY/i.test(output)
      ? output : '';
  } catch {
    // Never surface stderr: a hierarchy/helper error can include app text.
    // The bounded caller owns retries and the sanitized diagnostic screenshot.
    return '';
  }
}

module.exports = { readAndroidHierarchy };
