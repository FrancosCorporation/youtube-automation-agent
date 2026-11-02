'use strict';

// Caller holds the Android device lock. ADB forwards disappear after server or
// device restarts; a configured URL alone is not a live browser connection.
function ensureAndroidChromeCdpForward({ cdpUrl, device, adbPath, runAdb }) {
  const endpoint = new URL(cdpUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) return false;
  const port = Number(endpoint.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ANDROID_CHROME_CDP_PORT_INVALID');
  const local = `tcp:${port}`, remote = 'localabstract:chrome_devtools_remote';
  const entries = String(runAdb(device, ['forward', '--list'], { adbPath }) || '')
    .trim().split(/\r?\n/).map(line => line.trim().split(/\s+/));
  const existing = entries.find(fields => fields[1] === local);
  if (existing) {
    if (existing[0] === device && existing[2] === remote) return false;
    throw Object.assign(new Error('ANDROID_CHROME_CDP_PORT_IN_USE'), { code: 'ANDROID_CHROME_CDP_PORT_IN_USE' });
  }
  // Never take a port from another emulator or local debugging session.
  runAdb(device, ['forward', '--no-rebind', local, remote], { adbPath });
  return true;
}

module.exports = { ensureAndroidChromeCdpForward };
