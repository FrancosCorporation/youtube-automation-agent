'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { generationRetryDelayMs } = require('./generation-retry');

const FAILURE_LINE = /\[([^\]]+)\].*❌ falhou \(code \d+; ([a-z0-9_.-]+)\)/gi;

async function readJson(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function findSchedulerProcess(procRoot = '/proc', projectRoot = path.join(__dirname, '..')) {
  let entries;
  try { entries = await fs.readdir(procRoot); }
  catch { return null; }
  const expectedRoot = path.resolve(projectRoot);
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let command;
    try { command = await fs.readFile(path.join(procRoot, entry, 'cmdline')); }
    catch { continue; }
    const args = command.toString().split('\0');
    if (!args.some(arg => /(?:^|\/)scripts\/channel-scheduler\.js$/.test(arg))) continue;
    let cwd;
    try { cwd = await fs.realpath(path.join(procRoot, entry, 'cwd')); }
    catch { continue; }
    if (cwd !== expectedRoot) continue;
    return Number(entry);
  }
  return null;
}

function latestGenerationFailure(logText) {
  let latest = null;
  for (const match of String(logText || '').matchAll(FAILURE_LINE)) {
    const at = Date.parse(match[1]);
    if (!Number.isFinite(at)) continue;
    if (!latest || at >= Date.parse(latest.at)) latest = { at: new Date(at).toISOString(), code: match[2] };
  }
  return latest;
}

function nextSlotAt(startedAt, videosPerDay, nowMs) {
  const start = Date.parse(startedAt || '');
  if (!Number.isFinite(start) || !Number.isInteger(videosPerDay) || videosPerDay < 1) return null;
  const intervalMs = 86400000 / videosPerDay;
  const intervalsPassed = Math.floor((nowMs - start) / intervalMs);
  return new Date(start + (intervalsPassed + 1) * intervalMs).toISOString();
}

function restoreGenerationRetryState(health, now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('data inválida para retry da geração');
  const rawFailure = health?.lastGenerationFailure;
  const failure = rawFailure && typeof rawFailure === 'object'
    && Number.isFinite(Date.parse(rawFailure.at || ''))
    && typeof rawFailure.code === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(rawFailure.code)
    ? { at: new Date(Date.parse(rawFailure.at)).toISOString(), code: rawFailure.code }
    : null;
  if (!failure) return { lastGenerationFailure: null, nextGenerationRetryAt: null };

  const derivedRetryAt = Date.parse(failure.at) + generationRetryDelayMs(failure.code, new Date(failure.at));
  const persistedRetryAt = Date.parse(health?.nextGenerationRetryAt || '');
  const retryAt = Number.isFinite(persistedRetryAt) ? Math.max(derivedRetryAt, persistedRetryAt) : derivedRetryAt;
  return {
    lastGenerationFailure: failure,
    nextGenerationRetryAt: retryAt > now.getTime() ? new Date(retryAt).toISOString() : null
  };
}

async function readPersistedGenerationRetryState({ filePath, now = new Date() } = {}) {
  if (typeof filePath !== 'string' || !filePath) throw new TypeError('caminho do estado do scheduler obrigatório');
  return restoreGenerationRetryState(await readJson(filePath), now);
}

function createSchedulerRuntimeWriter({ filePath, now = () => new Date() }) {
  if (typeof filePath !== 'string' || !filePath) throw new TypeError('caminho do estado do scheduler obrigatório');
  let snapshot = {
    schemaVersion: 1,
    startedAt: now().toISOString(),
    status: 'active',
    producer: { state: 'starting' },
    consumer: { state: 'starting' },
    queue: { pending: 0, inFlight: false }
  };
  let writeChain = Promise.resolve();

  async function write() {
    const value = { ...snapshot, heartbeatAt: now().toISOString() };
    const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    writeChain = writeChain.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      try {
        await fs.writeFile(tempPath, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
        await fs.rename(tempPath, filePath);
      } catch (error) {
        await fs.unlink(tempPath).catch(() => {});
        throw error;
      }
    });
    return writeChain;
  }

  function update(patch = {}) {
    snapshot = {
      ...snapshot,
      ...patch,
      producer: patch.producer ? { ...snapshot.producer, ...patch.producer } : snapshot.producer,
      consumer: patch.consumer ? { ...snapshot.consumer, ...patch.consumer } : snapshot.consumer,
      queue: patch.queue ? { ...snapshot.queue, ...patch.queue } : snapshot.queue
    };
    return write();
  }

  return { update, heartbeat: write };
}

async function readSchedulerRuntimeHealth({ root = path.join(__dirname, '..'), stateDir, now = new Date(), procRoot = '/proc', videosPerDay: videosPerDayOverride } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('data inválida para saúde do scheduler');
  const resolvedStateDir = stateDir
    ? path.resolve(root, stateDir)
    : path.join(root, process.env.STATE_DIR || 'data/state');
  const [scheduler, queue, heartbeat, processId] = await Promise.all([
    readJson(path.join(resolvedStateDir, 'scheduler.json')),
    readJson(path.join(resolvedStateDir, 'publish-queue.json')),
    readJson(path.join(resolvedStateDir, 'scheduler-health.json')),
    findSchedulerProcess(procRoot, root)
  ]);

  let logText = '';
  let lastLogAt = null;
  try {
    const logPath = path.join(root, 'logs', 'scheduler.log');
    const handle = await fs.open(logPath, 'r');
    try {
      const stat = await handle.stat();
      lastLogAt = new Date(stat.mtimeMs).toISOString();
      const length = Math.min(stat.size, 256 * 1024);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, stat.size - length);
      logText = buffer.toString('utf8');
    } finally { await handle.close(); }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  let envFileCadence;
  if (videosPerDayOverride === undefined && !process.env.VIDEOS_PER_DAY) {
    try {
      const dotenv = require('dotenv');
      envFileCadence = dotenv.parse(await fs.readFile(path.join(root, '.env'))).VIDEOS_PER_DAY;
    } catch { envFileCadence = undefined; }
  }
  const configured = Number(videosPerDayOverride ?? process.env.VIDEOS_PER_DAY ?? envFileCadence ?? 5);
  const failureFromLog = latestGenerationFailure(logText);
  const heartbeatFailure = heartbeat?.lastGenerationFailure;
  const validHeartbeatFailure = heartbeatFailure && typeof heartbeatFailure === 'object'
    && Number.isFinite(Date.parse(heartbeatFailure.at || ''))
    && typeof heartbeatFailure.code === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(heartbeatFailure.code)
    ? { at: new Date(Date.parse(heartbeatFailure.at)).toISOString(), code: heartbeatFailure.code }
    : null;
  // An explicit null is the scheduler's current state, not missing data. In
  // particular, don't resurrect an old log failure after a new job starts.
  const hasHeartbeatFailure = heartbeat && Object.hasOwn(heartbeat, 'lastGenerationFailure');
  const hasHeartbeatRetry = heartbeat && Object.hasOwn(heartbeat, 'nextGenerationRetryAt');
  const failure = hasHeartbeatFailure ? validHeartbeatFailure : failureFromLog;
  const retryAt = hasHeartbeatRetry
    ? Number.isFinite(Date.parse(heartbeat.nextGenerationRetryAt || ''))
      ? new Date(Date.parse(heartbeat.nextGenerationRetryAt)).toISOString()
      : null
    : failure
      ? new Date(Date.parse(failure.at) + generationRetryDelayMs(failure.code, new Date(failure.at))).toISOString()
      : null;
  const lastActivityAt = Number.isFinite(Date.parse(heartbeat?.heartbeatAt || ''))
    ? new Date(Date.parse(heartbeat.heartbeatAt)).toISOString()
    : lastLogAt || (scheduler?.lastRunAt && Number.isFinite(Date.parse(scheduler.lastRunAt))
    ? new Date(Date.parse(scheduler.lastRunAt)).toISOString() : null);
  const heartbeatAgeSeconds = lastActivityAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(lastActivityAt)) / 1000)) : null;
  const heartbeatFresh = Boolean(heartbeatAgeSeconds !== null && heartbeatAgeSeconds <= 90);
  const configuredVideosPerDay = Number.isInteger(heartbeat?.configuredVideosPerDay)
    && heartbeat.configuredVideosPerDay >= 1 && heartbeat.configuredVideosPerDay <= 1440
    ? heartbeat.configuredVideosPerDay
    : Number.isInteger(configured) && configured >= 1 && configured <= 1440 ? configured : null;
  const validSlot = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : null;

  return {
    status: processId ? 'active' : 'not_running',
    lastActivityAt,
    activityAgeSeconds: heartbeatAgeSeconds,
    heartbeatAvailable: Boolean(heartbeat && Number.isFinite(Date.parse(heartbeat.heartbeatAt || ''))),
    heartbeatFresh,
    producer: heartbeat?.producer && typeof heartbeat.producer === 'object' ? {
      state: typeof heartbeat.producer.state === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(heartbeat.producer.state) ? heartbeat.producer.state : null,
      slotAt: validSlot(heartbeat.producer.slotAt)
    } : null,
    consumer: heartbeat?.consumer && typeof heartbeat.consumer === 'object' ? {
      state: typeof heartbeat.consumer.state === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(heartbeat.consumer.state) ? heartbeat.consumer.state : null,
      lastMissedSlotAt: validSlot(heartbeat.consumer.lastMissedSlotAt)
    } : null,
    queue: {
      pending: Number.isInteger(heartbeat?.queue?.pending) ? heartbeat.queue.pending
        : Array.isArray(queue?.pending) ? queue.pending.length : null,
      inFlight: typeof heartbeat?.queue?.inFlight === 'boolean' ? heartbeat.queue.inFlight : Boolean(queue?.inFlight)
    },
    retry: heartbeat?.retry && typeof heartbeat.retry === 'object' ? {
      inProgress: typeof heartbeat.retry.inProgress === 'boolean' ? heartbeat.retry.inProgress : null,
      youtubePending: typeof heartbeat.retry.youtubePending === 'boolean' ? heartbeat.retry.youtubePending : null,
      socialPending: typeof heartbeat.retry.socialPending === 'boolean' ? heartbeat.retry.socialPending : null
    } : null,
    renderGate: heartbeat?.renderGate && typeof heartbeat.renderGate === 'object' ? {
      renderSafe: typeof heartbeat.renderGate.renderSafe === 'boolean' ? heartbeat.renderGate.renderSafe : null,
      observedAt: validSlot(heartbeat.renderGate.observedAt),
      availableMemoryBytes: Number.isFinite(heartbeat.renderGate.availableMemoryBytes)
        && heartbeat.renderGate.availableMemoryBytes >= 0 ? heartbeat.renderGate.availableMemoryBytes : null,
      reasons: Array.isArray(heartbeat.renderGate.reasons)
        ? heartbeat.renderGate.reasons.filter(reason => typeof reason === 'string' && /^[a-z0-9_.]{1,80}$/.test(reason)).slice(0, 20) : []
    } : null,
    lastGenerationFailure: failure,
    nextGenerationRetryAt: retryAt,
    configuredVideosPerDay,
    nextConfiguredSlotAt: validSlot(heartbeat?.nextConfiguredSlotAt)
      || nextSlotAt(scheduler?.startedAt, configuredVideosPerDay, now.getTime())
  };
}

module.exports = {
  createSchedulerRuntimeWriter,
  findSchedulerProcess,
  latestGenerationFailure,
  nextSlotAt,
  readPersistedGenerationRetryState,
  readSchedulerRuntimeHealth,
  restoreGenerationRetryState
};
