'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

async function acquireLock(lockPath, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return async () => {
        await handle.close().catch(() => {});
        await fs.unlink(lockPath).catch(() => {});
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const [raw, stat] = await Promise.all([fs.readFile(lockPath, 'utf8'), fs.stat(lockPath)]);
        let owner = null;
        try { owner = JSON.parse(raw); } catch (_e) { /* incompleto: aguarda e verifica de novo */ }
        const ageMs = Date.now() - stat.mtimeMs;
        const staleOwner = owner && !(await processIsAlive(Number(owner.pid))) && ageMs > 30000;
        const abandonedCreation = !owner && ageMs > 60000;
        if (staleOwner || abandonedCreation) {
          await fs.unlink(lockPath).catch(() => {});
          continue;
        }
      } catch (_e) { /* outro processo pode estar liberando o lock */ }
      await sleep(100);
    }
  }
  throw new Error(`timeout aguardando lock do ledger: ${lockPath}`);
}

async function updateTopicLedger(ledgerPath, update) {
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  const release = await acquireLock(`${ledgerPath}.lock`);
  try {
    let ledger = { entries: [] };
    try {
      ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`ledger ilegível; atualização cancelada para preservar os dados: ${error.message}`);
    }
    if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger) || !Array.isArray(ledger.entries)) {
      throw new Error('ledger inválido; atualização cancelada para preservar os dados');
    }
    const next = update(ledger) || ledger;
    if (!next || typeof next !== 'object' || !Array.isArray(next.entries)) {
      throw new Error('a atualização produziu um ledger inválido; arquivo original preservado');
    }
    const tempPath = `${ledgerPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 });
      await fs.rename(tempPath, ledgerPath);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  } finally {
    await release();
  }
}

module.exports = { updateTopicLedger };
