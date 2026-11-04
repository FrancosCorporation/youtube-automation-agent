'use strict';

const fs = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');

async function waitForProcessStop(pid, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const status = await fs.readFile(`/proc/${pid}/status`, 'utf8');
    if (/^State:\s+T\b/m.test(status)) return true;
    await delay(10);
  } while (Date.now() < deadline);
  return false;
}

function schedulerIsIdle(health, now = Date.now()) {
  return health?.status === 'active' && now - Date.parse(health.heartbeatAt) >= 0
    && now - Date.parse(health.heartbeatAt) < 90000
    && ['waiting', 'backoff', 'ready_to_publish', 'waiting_resources', 'waiting_social_retry', 'waiting_slot', 'waiting_queue'].includes(health.producer?.state)
    && ['waiting', 'missed_slot_waiting_for_video'].includes(health.consumer?.state)
    && health.queue?.inFlight === false && health.retry?.inProgress === false;
}

// Freeze only an idle coordinator while rechecking its children and shared
// locks. This closes the check/restart race; render/upload workers are never
// signalled. SIGCONT is guaranteed even if a check fails.
async function reloadIdleScheduler({ pid, readHealth, readChildren, hasActiveLocks, signal,
  waitForStopped = waitForProcessStop, now = Date.now }) {
  const idle = () => schedulerIsIdle(readHealth(), now()) && readChildren().length === 0 && !hasActiveLocks();
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new TypeError('PID inválido');
  if (!idle()) return { status: 'deferred' };
  signal(pid, 'SIGSTOP');
  try {
    // Sending SIGSTOP does not mean the kernel has stopped the coordinator yet.
    // Wait for acknowledgement before the final child/lock check.
    if (!await waitForStopped(pid)) return { status: 'deferred' };
    if (!idle()) return { status: 'deferred' };
    signal(pid, 'SIGTERM');
    return { status: 'requested' };
  } finally { signal(pid, 'SIGCONT'); }
}

module.exports = { schedulerIsIdle, reloadIdleScheduler, waitForProcessStop };
