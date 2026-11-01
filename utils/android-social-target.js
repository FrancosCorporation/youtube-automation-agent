'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createAndroidEmulatorControl } = require('./android-emulator-control');
const devices = require('../config/android-social-devices.json');

function socialAndroidTarget(platform, { env = process.env, stateRoot, control: suppliedControl } = {}) {
  const configured = devices.platforms[platform];
  if (!configured) throw new Error(`destino Android fora do escopo: ${platform}`);
  const device = env[`ANDROID_DEVICE_${platform.toUpperCase()}`] || env.ANDROID_DEVICE || configured.device;
  if (!/^[\w.:-]+$/.test(device)) throw new Error('dispositivo Android inválido');
  const root = path.resolve(stateRoot || env.STATE_DIR || path.join(__dirname, '..', 'data'));
  const lockPath = path.join(root, configured.runtime === 'redroid'
    ? 'android-social-upload.lock' : `android-social-${device.replace(/[^a-z0-9_-]/gi, '_')}.lock`);
  const control = suppliedControl || createAndroidEmulatorControl({ device, env });
  const emulator = configured.runtime === 'redroid' ? require('../scripts/kwai-emulator') : {
    async acquire() {
      if (control.isBooted()) return;
      execFileSync('systemctl', ['--user', 'start', configured.service], {
        env: { ...process.env, XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR || '/run/user/1000',
          DBUS_SESSION_BUS_ADDRESS: env.DBUS_SESSION_BUS_ADDRESS || 'unix:path=/run/user/1000/bus' },
        timeout: 30000, stdio: 'pipe'
      });
      const deadline = Date.now() + 180000;
      while (!control.isBooted()) {
        if (Date.now() >= deadline) throw new Error('Android Google Play não concluiu o boot');
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    },
    release() {} // Preserve account/login state while the user authenticates.
  };
  return { device, control, emulator, lockPath };
}

module.exports = { socialAndroidTarget };
