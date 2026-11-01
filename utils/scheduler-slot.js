'use strict';

function restoredMissedSlot(health, now = Date.now()) {
  const value = Date.parse(health?.consumer?.lastMissedSlotAt || '');
  return health?.consumer?.state === 'missed_slot_waiting_for_video'
    && !health?.queue?.inFlight && Number.isFinite(value) && value <= now
    ? new Date(value).toISOString() : null;
}

function producerTargetSlot({ now, startedAt, intervalMs, pendingMissedSlotAt }) {
  if (![now, startedAt, intervalMs].every(Number.isFinite) || intervalMs <= 0) throw new TypeError('relógio da agenda inválido');
  const missed = Date.parse(pendingMissedSlotAt || '');
  if (Number.isFinite(missed) && missed <= now) return missed;
  return startedAt + (Math.floor((now - startedAt) / intervalMs) + 1) * intervalMs;
}

function retainedSlotAfterPreflight(dueSlot, publication) {
  if (publication?.slotConsumed !== false) return null;
  if (!Number.isFinite(dueSlot)) throw new TypeError('slot de publicação inválido');
  return new Date(dueSlot).toISOString();
}

function requestedImmediateSlot(request, now = Date.now()) {
  const at = Date.parse(request?.requestedAt || '');
  if (request?.version !== 1 || !Number.isFinite(now) || !Number.isFinite(at)
    || at > now || now - at > 30 * 60 * 1000) return null;
  return new Date(at).toISOString();
}

function restoredWaitingQueueSlot(health, queuedSlotAt, now = Date.now()) {
  const scheduled = Date.parse(health?.nextConfiguredSlotAt || '');
  const queued = Date.parse(queuedSlotAt || '');
  const heartbeat = Date.parse(health?.heartbeatAt || '');
  if (health?.producer?.state !== 'waiting_queue' || health?.consumer?.state !== 'waiting'
    || health?.queue?.inFlight || health?.queue?.pending !== 1
    || !Number.isFinite(scheduled) || !Number.isFinite(queued) || !Number.isFinite(heartbeat)
    || heartbeat > now || now - heartbeat > 120000 || scheduled <= now || queued >= scheduled) return null;
  return new Date(scheduled).toISOString();
}

module.exports = { restoredMissedSlot, producerTargetSlot, retainedSlotAfterPreflight, requestedImmediateSlot, restoredWaitingQueueSlot };
