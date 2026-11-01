'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function readLock(lockPath) {
  try {
    const [serialized, stat] = await Promise.all([
      fs.readFile(lockPath, 'utf8'),
      fs.stat(lockPath)
    ]);
    try {
      return { value: JSON.parse(serialized), modifiedAt: stat.mtimeMs };
    } catch {
      return { value: null, modifiedAt: stat.mtimeMs };
    }
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function removeStaleLock(lockPath, staleAfterMs) {
  const current = await readLock(lockPath);
  if (!current) return false;
  if (processIsAlive(Number(current.value?.pid))) return false;
  if (!current.value && Date.now() - current.modifiedAt < staleAfterMs) return false;

  const latest = await readLock(lockPath);
  if (!latest || latest.modifiedAt !== current.modifiedAt
    || latest.value?.pid !== current.value?.pid
    || latest.value?.token !== current.value?.token) return false;
  await fs.unlink(lockPath).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  return true;
}

async function acquireProcessFileLock(options = {}) {
  if (!options.lockPath) throw new TypeError('caminho do lock de processo obrigatório');
  const lockPath = path.resolve(options.lockPath);
  const timeoutMs = Math.max(1, Number(options.timeoutMs || 30 * 60 * 1000));
  const pollIntervalMs = Math.max(1, Number(options.pollIntervalMs || 250));
  const staleAfterMs = Math.max(1000, Number(options.staleAfterMs || 5 * 60 * 1000));
  const startedAt = Date.now();
  const token = crypto.randomUUID();
  const owner = String(options.owner || 'process-operation').slice(0, 80);
  await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });

  while (Date.now() - startedAt <= timeoutMs) {
    let handle;
    try {
      handle = await fs.open(lockPath, 'wx', 0o600);
      const body = `${JSON.stringify({ pid: process.pid, token, owner, acquiredAt: new Date().toISOString() })}\n`;
      await handle.writeFile(body);
      await handle.sync();
      await handle.close();
      return async () => {
        const current = await readLock(lockPath);
        if (current?.value?.token === token && current.value.pid === process.pid) {
          await fs.unlink(lockPath).catch(error => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
      };
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (error.code !== 'EEXIST') throw error;
      await removeStaleLock(lockPath, staleAfterMs);
      if (Date.now() - startedAt >= timeoutMs) break;
      await sleep(Math.min(pollIntervalMs, timeoutMs - (Date.now() - startedAt)));
    }
  }

  throw new Error(`tempo esgotado aguardando lock de processo (${owner})`);
}

async function withProcessFileLock(callback, options) {
  if (typeof callback !== 'function') throw new TypeError('callback do lock obrigatório');
  const release = await acquireProcessFileLock(options);
  try {
    return await callback();
  } finally {
    await release();
  }
}

module.exports = { acquireProcessFileLock, processIsAlive, withProcessFileLock };
