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

function resolveAndroidChromeCdpUrl(options) {
  try {
    ensureAndroidChromeCdpForward(options);
    return options.cdpUrl;
  } catch (error) {
    const stderr = String(error?.stderr || error?.cause?.stderr || '');
    if (error.code !== 'ANDROID_CHROME_CDP_PORT_IN_USE'
      && !/cannot bind listener: Address already in use/i.test(stderr)) throw error;
  }
  const { device, adbPath, runAdb } = options;
  const remote = 'localabstract:chrome_devtools_remote';
  const entries = () => String(runAdb(device, ['forward', '--list'], { adbPath }) || '')
    .trim().split(/\r?\n/).map(line => line.trim().split(/\s+/));
  const portOf = value => /^tcp:\d+$/.test(value || '') && Number(value.slice(4)) >= 1024
    && Number(value.slice(4)) <= 65535 ? Number(value.slice(4)) : null;
  const sameDevice = fields => fields[0] === device && fields[2] === remote && portOf(fields[1]);
  const existing = entries().find(sameDevice);
  if (existing) return `http://127.0.0.1:${portOf(existing[1])}`;
  // ADB chooses a free local port atomically; never rebind someone else's
  // Chrome or fall back to connecting to the host browser on the busy port.
  const allocated = String(runAdb(device, ['forward', 'tcp:0', remote], { adbPath }) || '').trim();
  const port = portOf(`tcp:${allocated}`);
  if (!port || !entries().some(fields => sameDevice(fields) && portOf(fields[1]) === port)) {
    throw Object.assign(new Error('ANDROID_CHROME_CDP_FORWARD_UNVERIFIED'), {
      code: 'ANDROID_CHROME_CDP_FORWARD_UNVERIFIED'
    });
  }
  return `http://127.0.0.1:${port}`;
}

module.exports = { ensureAndroidChromeCdpForward, resolveAndroidChromeCdpUrl };
