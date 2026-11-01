'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { withProcessFileLock } = require('./process-file-lock');
const { validateAttempt } = require('./generation-attempt');

function sameAttempt(a, b, root) {
  return Boolean(a && b && a.jobId === b.jobId && typeof a.outPath === 'string' && typeof b.outPath === 'string'
    && path.resolve(root, a.outPath) === path.resolve(root, b.outPath));
}

function createDeferredGenerationQueue({ root, filePath, attemptStore, withLock = withProcessFileLock }) {
  if (!root || !filePath || !attemptStore) throw new TypeError('fila de recuperação sem raiz, arquivo ou checkpoint');
  const lockPath = `${filePath}.lock`;
  async function read() {
    let value;
    try { value = JSON.parse(await fs.readFile(filePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    if (value?.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 100) {
      throw new Error('fila de recuperações inválida; arquivo preservado');
    }
    return value.entries.map(entry => validateAttempt(entry, root));
  }
  async function write(entries) {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, filePath);
    } finally { await fs.unlink(temporary).catch(() => {}); }
  }
  const locked = callback => withLock(callback, { lockPath, owner: 'deferred-generation-queue', timeoutMs: 30000 });
  return {
    async enqueue(candidate) {
      const attempt = validateAttempt(candidate, root);
      return locked(async () => {
        const entries = await read();
        if (entries.some(item => sameAttempt(item, attempt, root))) return false;
        if (entries.length >= 100) throw new Error('fila de recuperações cheia');
        entries.push(attempt);
        await write(entries);
        return true;
      });
    },
    async claimNext({ skipCompleted = async () => false } = {}) {
      return locked(async () => {
        const entries = await read();
        const active = await attemptStore.read();
        if (active) {
          // A crash after checkpoint creation but before dequeue leaves both.
          const remaining = entries.filter(item => !sameAttempt(item, active, root));
          if (remaining.length !== entries.length) await write(remaining);
          return null;
        }
        while (entries.length) {
          const candidate = entries[0];
          if (await skipCompleted(candidate)) { entries.shift(); await write(entries); continue; }
          // Commit the durable in-flight checkpoint before removing the queue
          // item so a crash at either step never loses the recovery.
          const claimed = await attemptStore.write(candidate);
          entries.shift();
          await write(entries);
          return claimed;
        }
        return null;
      });
    }
  };
}

module.exports = { createDeferredGenerationQueue, sameAttempt };
