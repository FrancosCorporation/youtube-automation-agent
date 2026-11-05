'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createAndroidEmulatorControl } = require('./android-emulator-control');
const { withAndroidDeviceLock } = require('./android-device-lock');
const devices = require('../config/android-social-devices.json');

function socialAndroidTarget(platform, { env = process.env, stateRoot, control: suppliedControl,
  withLock = withAndroidDeviceLock, runService = execFileSync,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, bootTimeoutMs = 180000 } = {}) {
  const configured = devices.platforms[platform];
  if (!configured) throw new Error(`destino Android fora do escopo: ${platform}`);
  const device = env[`ANDROID_DEVICE_${platform.toUpperCase()}`] || env.ANDROID_DEVICE || configured.device;
  if (!/^[\w.:-]+$/.test(device)) throw new Error('dispositivo Android inválido');
  const root = path.resolve(stateRoot || env.STATE_DIR || path.join(__dirname, '..', 'data'));
  const lockPath = path.join(root, configured.runtime === 'redroid'
    ? 'android-social-upload.lock' : `android-social-${device.replace(/[^a-z0-9_-]/gi, '_')}.lock`);
  const control = suppliedControl || createAndroidEmulatorControl({ device, env });
  const avdStopped = () => {
    if (!/^emulator-\d+$/.test(device)) return false;
    try {
      return /^virtual device is stopped\s*\r?\nOK\s*$/i.test(
        String(control.run(['emu', 'avd', 'status'], { timeout: 3000 })).trim());
    } catch { return false; }
  };
  const resumeStoppedAvd = async () => {
    if (!avdStopped()) return;
    await withLock(async () => {
      if (!avdStopped()) return;
      // systemctl start cannot resume a paused VM inside an active unit.
      // Resume it in place; never reboot or discard its browser/upload state.
      try { control.run(['emu', 'avd', 'start'], { timeout: 8000 }); }
      catch (error) {
        // A slow console response can time out after the VM has resumed.
        // Confirm the resulting state instead of repeating the command.
        const status = String(control.run(['emu', 'avd', 'status'], { timeout: 3000 }));
        if (!/^virtual device is running\s*\r?\nOK\s*$/i.test(status.trim())) throw error;
      }
    }, { lockPath, owner: 'android-avd-resume', timeoutMs: 10000 });
  };
  const emulator = configured.runtime === 'redroid' ? require('../scripts/kwai-emulator') : {
    async acquire() {
      const deadline = now() + bootTimeoutMs;
      await resumeStoppedAvd();
      if (control.isBooted()) return;
      runService('systemctl', ['--user', 'start', configured.service], {
        env: { ...process.env, XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR || '/run/user/1000',
          DBUS_SESSION_BUS_ADDRESS: env.DBUS_SESSION_BUS_ADDRESS || 'unix:path=/run/user/1000/bus' },
        timeout: 30000, stdio: 'pipe'
      });
      await resumeStoppedAvd();
      while (!control.isBooted()) {
        if (now() >= deadline) throw new Error('Android Google Play não concluiu o boot');
        await wait(Math.min(1500, deadline - now()));
      }
    },
    release() {} // Preserve account/login state while the user authenticates.
  };
  return { device, control, emulator, lockPath };
}

module.exports = { socialAndroidTarget };
