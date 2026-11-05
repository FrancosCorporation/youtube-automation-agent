'use strict';

function producerLeadTimeMs({ estimatedGenerationMs, intervalMs, allowPublicationOverlap = false }) {
  if (!Number.isFinite(estimatedGenerationMs) || estimatedGenerationMs < 0
    || !Number.isFinite(intervalMs) || intervalMs <= 0) throw new TypeError('janela de produção inválida');
  const standardLeadMs = estimatedGenerationMs + 5 * 60000;
  // With one bounded ready slot, start filling it immediately. The queue and
  // resource gates still prevent another generation when that slot is full.
  return allowPublicationOverlap ? Math.max(intervalMs, standardLeadMs) : standardLeadMs;
}

function producerMustWait({ queuedCount, maxQueue, inFlight, allowPublicationOverlap = false }) {
  return Number(queuedCount) >= Number(maxQueue) || (Boolean(inFlight) && !allowPublicationOverlap);
}

function producerMustWaitForRetry({ youtubeRetryPending, socialRetryPending, youtubeRetryInProgress,
  allowPublicationOverlap = false }) {
  // The shared profile already permits retries during generation. Apply the
  // same rule when the retry starts first (including the startup scan), or a
  // slow/uncertain social destination can starve the producer indefinitely.
  // The device lock still serializes Android work; this gate grants no upload.
  if (allowPublicationOverlap) return false;
  if (youtubeRetryInProgress) return true;
  return Boolean(youtubeRetryPending || socialRetryPending);
}

function queuedPublicationImminent(queue, now = Date.now(), leadMs = 120000, missedSlotAt = null, scheduledSlotAt = null) {
  if (!Array.isArray(queue) || !queue.length) return false;
  const slot = Date.parse(queue[0]?.slotAt || '');
  const missedSlot = Date.parse(missedSlotAt || '');
  if (!Number.isFinite(slot)) return true;
  // A true missed slot stays urgent. Otherwise the consumer's actual next
  // slot takes precedence over a stale producer timestamp created while the
  // previous publication was still in progress.
  const scheduled = Date.parse(scheduledSlotAt || '');
  if (Number.isFinite(missedSlot)) return Math.min(slot, missedSlot) <= now + leadMs;
  if (Number.isFinite(scheduled)) return scheduled <= now + leadMs;
  return slot <= now + leadMs;
}

function backgroundRetryMustWait({ generationInProgress, queuedCount, inFlight, retryInProgress,
  allowPublicationOverlap = false }) {
  // Publishing stays serial. A retry may inspect other episodes while a
  // ready episode waits for its slot, giving pending retries a turn.
  return Boolean(inFlight || retryInProgress || (generationInProgress && !allowPublicationOverlap))
    || (!allowPublicationOverlap && Number(queuedCount) > 0);
}

module.exports = { producerLeadTimeMs, producerMustWait, producerMustWaitForRetry, backgroundRetryMustWait,
  queuedPublicationImminent };
