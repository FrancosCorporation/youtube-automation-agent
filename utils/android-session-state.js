'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function sessionPath(platform, { root = process.env.STATE_DIR || path.join(ROOT, 'data') } = {}) {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(String(platform || ''))) throw new Error('plataforma Android inválida');
  return path.join(path.resolve(root), 'android-app-sessions', `${platform}.json`);
}

function normalizeDevice(device) {
  if (device == null || device === '') return null;
  const value = String(device).trim();
  if (!/^[\w.:-]+$/.test(value)) throw new Error('dispositivo Android inválido na sessão');
  return value;
}

function normalizeAccountHandle(handle) {
  if (handle == null || String(handle).trim() === '') return null;
  const value = String(handle).trim().replace(/^@/, '');
  if (!/^[A-Za-z\d._]{1,30}$/.test(value)) throw new Error('handle social inválido');
  return `@${value.toLowerCase()}`;
}

function recordAndroidSession(platform, { root, device, accountHandle, identityVerified, now = Date.now() } = {}) {
  const target = sessionPath(platform, { root });
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const session = { platform, status: 'logged_in', verifiedAt: new Date(now).toISOString() };
  const normalizedDevice = normalizeDevice(device);
  const normalizedHandle = normalizeAccountHandle(accountHandle);
  if (identityVerified === true && !normalizedHandle) throw new Error('handle obrigatório para validar identidade Android');
  if (normalizedDevice) session.device = normalizedDevice;
  if (normalizedHandle) session.accountHandle = normalizedHandle;
  if (identityVerified != null) session.identityVerified = Boolean(identityVerified);
  const body = `${JSON.stringify(session)}\n`;
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return target;
}

function hasRecentAndroidSession(platform, { root, device, expectedHandle, now = Date.now(), ttlMs = SESSION_TTL_MS } = {}) {
  try {
    const value = JSON.parse(fs.readFileSync(sessionPath(platform, { root }), 'utf8'));
    if (value.platform !== platform || value.status !== 'logged_in') return false;
    const expectedDevice = normalizeDevice(device);
    if (expectedDevice && value.device !== expectedDevice) return false;
    const normalizedExpectedHandle = normalizeAccountHandle(expectedHandle);
    if (normalizedExpectedHandle
      && (value.identityVerified !== true || normalizeAccountHandle(value.accountHandle) !== normalizedExpectedHandle)) return false;
    const verifiedAt = Date.parse(value.verifiedAt);
    return Number.isFinite(verifiedAt) && verifiedAt <= now && now - verifiedAt <= ttlMs;
  } catch (_error) {
    return false;
  }
}

function clearAndroidSession(platform, { root } = {}) {
  try {
    fs.unlinkSync(sessionPath(platform, { root }));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

module.exports = { SESSION_TTL_MS, clearAndroidSession, hasRecentAndroidSession, normalizeAccountHandle, normalizeDevice, recordAndroidSession, sessionPath };
