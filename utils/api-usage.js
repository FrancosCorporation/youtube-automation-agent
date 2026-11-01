/**
 * Atomic daily API-call accounting shared by generator processes.
 * State stays in STATE_DIR so each scheduler replica has its own budget.
 */
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
// An isolated test/job state may explicitly share the live budget so it does
// not silently gain a separate allowance for the same external provider.
const DEFAULT_STATE_PATH = process.env.API_USAGE_STATE_PATH
  ? path.resolve(ROOT, process.env.API_USAGE_STATE_PATH)
  : path.join(path.resolve(ROOT, process.env.STATE_DIR || 'data/state'), 'api-usage.json');
const LOCK_TIMEOUT_MS = 30000;
const STALE_LOCK_MS = 60000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function validateService(service) {
  if (typeof service !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(service)) {
    throw new TypeError('nome de serviço inválido para o contador de chamadas');
  }
}

function validateAttribution(attribution) {
  if (attribution == null) return null;
  if (!attribution || typeof attribution !== 'object' || Array.isArray(attribution)) {
    throw new TypeError('atribuição de chamada inválida');
  }
  const jobId = String(attribution.jobId || '');
  const operation = String(attribution.operation || '');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(jobId)
    || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(operation)) {
    throw new TypeError('jobId/operação inválidos para atribuição de chamada');
  }
  return { jobId, operation };
}

function validateUsage(usage, filePath) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)
    || !/^\d{4}-\d{2}-\d{2}$/.test(usage.date)
    || !usage.counts || typeof usage.counts !== 'object' || Array.isArray(usage.counts)) {
    throw new Error(`estado de uso inválido em ${filePath}; arquivo preservado`);
  }
  for (const [service, count] of Object.entries(usage.counts)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(service) || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`contagem inválida em ${filePath}; arquivo preservado`);
    }
  }
  if (usage.byJob !== undefined) {
    if (!usage.byJob || typeof usage.byJob !== 'object' || Array.isArray(usage.byJob)) {
      throw new Error(`atribuição por job inválida em ${filePath}; arquivo preservado`);
    }
    for (const [jobId, operations] of Object.entries(usage.byJob)) {
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(jobId)
        || !operations || typeof operations !== 'object' || Array.isArray(operations)) {
        throw new Error(`atribuição por job inválida em ${filePath}; arquivo preservado`);
      }
      for (const [operation, serviceCounts] of Object.entries(operations)) {
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(operation)
          || !serviceCounts || typeof serviceCounts !== 'object' || Array.isArray(serviceCounts)) {
          throw new Error(`atribuição por operação inválida em ${filePath}; arquivo preservado`);
        }
        for (const [service, count] of Object.entries(serviceCounts)) {
          if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(service)
            || !Number.isSafeInteger(count) || count < 0) {
            throw new Error(`contagem atribuída inválida em ${filePath}; arquivo preservado`);
          }
        }
      }
    }
  }
  return usage;
}

async function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

function sameOwner(left, right) {
  return Boolean(left && right)
    && Number(left.pid) === Number(right.pid)
    && String(left.createdAt) === String(right.createdAt);
}

function incrementAttributedCall(usage, service, attribution) {
  if (!attribution) return usage;
  const job = { ...(usage.byJob?.[attribution.jobId] || {}) };
  const operationCounts = { ...(job[attribution.operation] || {}) };
  operationCounts[service] = (operationCounts[service] || 0) + 1;
  job[attribution.operation] = operationCounts;
  return { ...usage, byJob: { ...(usage.byJob || {}), [attribution.jobId]: job } };
}

async function readLockOwner(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function releaseHandle(filePath, handle) {
  await handle.close().catch(() => {});
  await fs.unlink(filePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
}

async function recoverStaleReaper(reapPath) {
  let stat;
  let owner;
  try {
    [stat, owner] = await Promise.all([
      fs.stat(reapPath),
      readLockOwner(reapPath)
    ]);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (Date.now() - stat.mtimeMs <= STALE_LOCK_MS || (owner && await isAlive(Number(owner.pid)))) return false;

  const [currentStat, currentOwner] = await Promise.all([
    fs.stat(reapPath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error)),
    readLockOwner(reapPath)
  ]);
  const sameObservation = (!owner && !currentOwner) || sameOwner(owner, currentOwner);
  if (!currentStat || stat.ino !== currentStat.ino || stat.dev !== currentStat.dev || !sameObservation
    || (currentOwner && await isAlive(Number(currentOwner.pid)))) return false;
  await fs.unlink(reapPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  return true;
}

function createUsageStore({ statePath = DEFAULT_STATE_PATH, now = () => new Date(), lockTimeoutMs = LOCK_TIMEOUT_MS } = {}) {
  const filePath = path.resolve(statePath);
  const lockPath = `${filePath}.lock`;
  const reapPath = `${lockPath}.reaper`;

  function today() {
    const date = now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('relógio UTC inválido');
    return date.toISOString().slice(0, 10);
  }

  async function acquireLock() {
    const deadline = Date.now() + lockTimeoutMs;
    let delayMs = 15;
    while (Date.now() < deadline) {
      try {
        const handle = await fs.open(lockPath, 'wx', 0o600);
        const owner = { pid: process.pid, createdAt: new Date().toISOString() };
        try {
          await handle.writeFile(JSON.stringify(owner));
          return async () => releaseHandle(lockPath, handle);
        } catch (error) {
          await releaseHandle(lockPath, handle).catch(() => {});
          throw error;
        }
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }

      let stat;
      let owner;
      try {
        [stat, owner] = await Promise.all([
          fs.stat(lockPath),
          fs.readFile(lockPath, 'utf8').then(raw => JSON.parse(raw)).catch(() => null)
        ]);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
      }

      if (stat && Date.now() - stat.mtimeMs > STALE_LOCK_MS
        && (!owner || !await isAlive(Number(owner.pid)))) {
        // Serialize stale-lock recovery and verify the original owner again so
        // a waiter can never remove a lock acquired by a live process.
        let reaper;
        try { reaper = await fs.open(reapPath, 'wx', 0o600); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          await recoverStaleReaper(reapPath);
        }
        if (reaper) {
          const reapOwner = { pid: process.pid, createdAt: new Date().toISOString() };
          try {
            await reaper.writeFile(JSON.stringify(reapOwner));
            const [currentStat, currentOwner] = await Promise.all([
              fs.stat(lockPath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error)),
              fs.readFile(lockPath, 'utf8').then(raw => JSON.parse(raw)).catch(() => null)
            ]);
            if (currentStat && stat.ino === currentStat.ino && stat.dev === currentStat.dev
              && ((!owner && !currentOwner) || sameOwner(owner, currentOwner))
              && (!currentOwner || !await isAlive(Number(currentOwner.pid)))) {
              await fs.unlink(lockPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
            }
          } finally {
            await releaseHandle(reapPath, reaper).catch(() => {});
          }
        }
      }

      await sleep(delayMs);
      delayMs = Math.min(250, delayMs * 2);
    }
    throw new Error(`timeout aguardando o lock de orçamento em ${filePath}; confira se há outro processo ativo`);
  }

  async function readUsage() {
    let raw;
    try { raw = await fs.readFile(filePath, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return { date: today(), counts: {} };
      throw error;
    }

    let usage;
    try { usage = JSON.parse(raw); }
    catch (error) { throw new Error(`estado de uso ilegível em ${filePath}; arquivo preservado: ${error.message}`); }
    validateUsage(usage, filePath);
    return usage.date === today() ? usage : { date: today(), counts: {} };
  }

  async function writeUsage(usage) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    let handle;
    try {
      handle = await fs.open(tempPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(usage, null, 2));
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await handle?.close().catch(() => {});
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  async function updateCounts(update) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const release = await acquireLock();
    try {
      const usage = await readUsage();
      const next = update(usage);
      await writeUsage(next);
      return next;
    } finally {
      await release();
    }
  }

  async function usedToday(service) {
    validateService(service);
    const usage = await readUsage();
    return usage.counts[service] || 0;
  }

  async function reserveCall(service, limitPerDay, attributionInput) {
    validateService(service);
    const attribution = validateAttribution(attributionInput);
    if (!Number.isSafeInteger(limitPerDay) || limitPerDay < 1) {
      throw new TypeError('o limite diário deve ser um inteiro positivo');
    }
    const usage = await updateCounts(current => {
      const count = current.counts[service] || 0;
      if (count >= limitPerDay) {
        const error = new Error(`orçamento diário de ${service} esgotado (${count}/${limitPerDay} chamadas hoje)`);
        error.code = 'BUDGET_EXHAUSTED';
        throw error;
      }
      const next = { ...current, counts: { ...current.counts, [service]: count + 1 } };
      return incrementAttributedCall(next, service, attribution);
    });
    return usage.counts[service];
  }

  async function recordCall(service, attributionInput) {
    validateService(service);
    const attribution = validateAttribution(attributionInput);
    const usage = await updateCounts(current => incrementAttributedCall({
      ...current,
      counts: { ...current.counts, [service]: (current.counts[service] || 0) + 1 }
    }, service, attribution));
    return usage.counts[service];
  }

  async function assertBudget(service, limitPerDay) {
    validateService(service);
    if (!Number.isSafeInteger(limitPerDay) || limitPerDay < 1) {
      throw new TypeError('o limite diário deve ser um inteiro positivo');
    }
    const used = await usedToday(service);
    if (used >= limitPerDay) {
      const error = new Error(`orçamento diário de ${service} esgotado (${used}/${limitPerDay} chamadas hoje)`);
      error.code = 'BUDGET_EXHAUSTED';
      throw error;
    }
    return used;
  }

  return { filePath, usedToday, recordCall, reserveCall, assertBudget };
}

const defaultStore = createUsageStore();
module.exports = { ...defaultStore, createUsageStore, DEFAULT_STATE_PATH };
