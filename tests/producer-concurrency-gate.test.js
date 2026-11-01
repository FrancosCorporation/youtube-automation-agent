'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { producerLeadTimeMs, producerMustWait, producerMustWaitForRetry, backgroundRetryMustWait, queuedPublicationImminent } = require('../utils/producer-concurrency-gate');

test('a queued publication takes priority near its slot, including overdue and invalid slots', () => {
  const now = Date.parse('2026-10-29T23:20:45.433Z');
  assert.equal(queuedPublicationImminent([], now), false);
  assert.equal(queuedPublicationImminent([{ slotAt: new Date(now + 121000).toISOString() }], now), false);
  assert.equal(queuedPublicationImminent([{ slotAt: new Date(now + 120000).toISOString() }], now), true);
  assert.equal(queuedPublicationImminent([{ slotAt: new Date(now - 1000).toISOString() }], now), true);
  assert.equal(queuedPublicationImminent([{ slotAt: new Date(now + 600000).toISOString() }], now, 120000,
    new Date(now - 1000).toISOString()), true);
  assert.equal(queuedPublicationImminent([{}], now), true);
  assert.equal(queuedPublicationImminent([{}], now, 120000, null, new Date(now + 600000).toISOString()), true);
  assert.equal(queuedPublicationImminent([{ slotAt: new Date(now - 1000).toISOString() }], now, 120000,
    null, new Date(now + 600000).toISOString()), false);
  assert.equal(queuedPublicationImminent([{ slotAt: new Date(now - 1000).toISOString() }], now, 120000,
    new Date(now - 1000).toISOString(), new Date(now + 600000).toISOString()), true);
  assert.equal(queuedPublicationImminent([{ slotAt: new Date(now + 600000).toISOString() }], now, 120000,
    null, new Date(now + 120000).toISOString()), true);
});

test('a ready slot is filled without planned idleness throughout the shared publication interval', () => {
  const intervalMs = 24 * 60000;
  const estimatedGenerationMs = 323832; // Measured cold cycle, 29/10.
  const sharedLead = producerLeadTimeMs({ estimatedGenerationMs, intervalMs, allowPublicationOverlap: true });
  for (const timeToNextSlot of [intervalMs, 19 * 60000, 10 * 60000, -60000]) {
    assert(timeToNextSlot <= sharedLead);
  }
  assert(19 * 60000 > producerLeadTimeMs({ estimatedGenerationMs, intervalMs }));
  assert(producerMustWait({ queuedCount: 1, maxQueue: 1, inFlight: true, allowPublicationOverlap: true }));
  assert.throws(() => producerLeadTimeMs({ estimatedGenerationMs: NaN, intervalMs }), /inválida/);
});

test('produtor espera quando o consumidor já retirou um item da fila para publicar', () => {
  assert.equal(producerMustWait({ queuedCount: 0, maxQueue: 1, inFlight: true }), true);
});

test('produtor aguarda a verificação inicial e qualquer publicação de pendências', () => {
  assert.equal(producerMustWaitForRetry({ youtubeRetryPending: true }), true);
  assert.equal(producerMustWaitForRetry({ socialRetryPending: true }), true);
  assert.equal(producerMustWaitForRetry({ youtubeRetryInProgress: true }), true);
  assert.equal(producerMustWaitForRetry({}), false);
});

test('produtor respeita a capacidade da fila e libera quando não há envio', () => {
  assert.equal(producerMustWait({ queuedCount: 1, maxQueue: 1, inFlight: false }), true);
  assert.equal(producerMustWait({ queuedCount: 0, maxQueue: 1, inFlight: false }), false);
});

test('perfil compartilhado prepara só um próximo episódio durante a publicação', () => {
  const profile = { maxQueue: 1, allowPublicationOverlap: true };
  const state = { queuedCount: 0, inFlight: { jobId: 'publishing-A' } };
  assert.equal(producerMustWait({ ...profile, ...state }), false);
  assert.equal(backgroundRetryMustWait({ ...profile, ...state }), true);
  state.queuedCount = 1; // B completed while A is still being published.
  assert.equal(producerMustWait({ ...profile, ...state }), true);
  state.inFlight = null;
  assert.equal(backgroundRetryMustWait({ ...profile, ...state }), false);
  assert.equal(producerMustWait({ ...profile, ...state }), true);
  assert.equal(backgroundRetryMustWait({ ...profile, ...state, retryInProgress: true }), true);
  state.queuedCount = 0;
  state.inFlight = { jobId: 'publishing-B' };
  assert.equal(producerMustWait({ ...profile, ...state }), false);
});

test('retry pendente permite preparar durante envio, mas ganha prioridade quando este termina', () => {
  assert.equal(producerMustWaitForRetry({ youtubeRetryPending: true, socialRetryPending: true,
    inFlight: true, allowPublicationOverlap: true }), false);
  assert.equal(producerMustWaitForRetry({ youtubeRetryPending: true,
    inFlight: false, allowPublicationOverlap: true }), true);
  assert.equal(producerMustWaitForRetry({ youtubeRetryInProgress: true,
    inFlight: true, allowPublicationOverlap: true }), true);
  assert.equal(backgroundRetryMustWait({ generationInProgress: true, allowPublicationOverlap: true }), true);
  assert.equal(backgroundRetryMustWait({ generationInProgress: true }), true);
  assert.equal(backgroundRetryMustWait({ queuedCount: 1 }), true);
  assert.equal(backgroundRetryMustWait({ queuedCount: 1, allowPublicationOverlap: true }), false);
  assert.equal(backgroundRetryMustWait({ inFlight: true, allowPublicationOverlap: true }), true);
  assert.equal(backgroundRetryMustWait({ retryInProgress: true, allowPublicationOverlap: true }), true);
});
