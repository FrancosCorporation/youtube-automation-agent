'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { restoredMissedSlot, producerTargetSlot, retainedSlotAfterPreflight, requestedImmediateSlot, restoredWaitingQueueSlot } = require('../utils/scheduler-slot');

test('retomada alinha slot antigo da fila ao horário futuro já aguardado, sem perder slot vencido', () => {
  const now = Date.parse('2026-10-30T15:40:00Z');
  const health = { producer: { state: 'waiting_queue' }, consumer: { state: 'waiting' },
    queue: { pending: 1, inFlight: false }, heartbeatAt: '2026-10-30T15:39:30Z', nextConfiguredSlotAt: '2026-10-30T15:44:45Z' };
  assert.equal(restoredWaitingQueueSlot(health, '2026-10-30T15:20:45Z', now), '2026-10-30T15:44:45.000Z');
  assert.equal(restoredWaitingQueueSlot({ ...health, consumer: { state: 'missed_slot_waiting_for_video' } }, '2026-10-30T15:20:45Z', now), null);
  assert.equal(restoredWaitingQueueSlot({ ...health, heartbeatAt: '2026-10-30T15:00:00Z' }, '2026-10-30T15:20:45Z', now), null);
  assert.equal(restoredWaitingQueueSlot({ ...health, queue: { pending: 1, inFlight: true } }, '2026-10-30T15:20:45Z', now), null);
  assert.equal(restoredWaitingQueueSlot(health, '2026-10-30T15:45:45Z', now), null);
});

test('pedido pontual de publicação imediata expira e não aceita horário futuro', () => {
  const now = Date.parse('2026-10-30T14:40:00Z');
  assert.equal(requestedImmediateSlot({ version: 1, requestedAt: '2026-10-30T14:39:00Z' }, now), '2026-10-30T14:39:00.000Z');
  assert.equal(requestedImmediateSlot({ version: 1, requestedAt: '2026-10-30T13:39:00Z' }, now), null);
  assert.equal(requestedImmediateSlot({ version: 1, requestedAt: '2026-10-30T14:41:00Z' }, now), null);
  assert.equal(requestedImmediateSlot({ version: 2, requestedAt: '2026-10-30T14:39:00Z' }, now), null);
});

test('uma reprovação antes do envio preserva o horário, mas envio incerto não é repetido', () => {
  const due = Date.parse('2026-10-30T01:20:45.433Z');
  assert.equal(retainedSlotAfterPreflight(due, { slotConsumed: false }), '2026-10-30T01:20:45.433Z');
  assert.equal(retainedSlotAfterPreflight(due, { slotConsumed: true }), null);
  assert.equal(retainedSlotAfterPreflight(due, null), null);
  assert.throws(() => retainedSlotAfterPreflight(NaN, { slotConsumed: false }), /inválido/);
});

test('a missed publication slot triggers generation immediately instead of another just-in-time wait', () => {
  const startedAt = Date.parse('2026-10-29T18:08:45.433Z');
  const now = Date.parse('2026-10-29T18:33:15.094Z');
  const intervalMs = 24 * 60000;
  const health = { consumer: { state: 'missed_slot_waiting_for_video', lastMissedSlotAt: '2026-10-29T18:32:45.433Z' },
    queue: { pending: 0, inFlight: false } };
  const pendingMissedSlotAt = restoredMissedSlot(health, now);
  const target = producerTargetSlot({ now, startedAt, intervalMs, pendingMissedSlotAt });
  assert.equal(target, Date.parse(health.consumer.lastMissedSlotAt));
  assert(target < now);
  assert.equal(producerTargetSlot({ now, startedAt, intervalMs, pendingMissedSlotAt: null }),
    Date.parse('2026-10-29T18:56:45.433Z'));
});

test('historical or future misses and an active publication cannot cause duplicate catch-up', () => {
  const now = Date.parse('2026-10-29T18:33:15Z');
  const state = { consumer: { state: 'missed_slot_waiting_for_video', lastMissedSlotAt: '2026-10-29T18:32:45Z' }, queue: { inFlight: false } };
  assert.equal(restoredMissedSlot({ ...state, consumer: { state: 'waiting' } }, now), null);
  assert.equal(restoredMissedSlot({ ...state, queue: { inFlight: true } }, now), null);
  assert.equal(restoredMissedSlot({ ...state, consumer: { ...state.consumer, lastMissedSlotAt: '2026-10-30T18:32:45Z' } }, now), null);
  assert.equal(restoredMissedSlot({ ...state, consumer: { ...state.consumer, lastMissedSlotAt: 'bad' } }, now), null);
});
