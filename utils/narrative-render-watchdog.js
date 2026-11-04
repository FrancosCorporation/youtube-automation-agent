'use strict';

const DEFAULT_STALL_MS = 10 * 60 * 1000;

// A software render can take hours while advancing normally. Only increasing
// Remotion frame counters constitute progress; repeated logs cannot keep a
// stalled renderer alive. The caller retains a separate absolute deadline.
function createNarrativeRenderWatchdog({ logger = console, now = Date.now,
  stallMs = DEFAULT_STALL_MS, resourceCheck = null } = {}) {
  const counters = new Map();
  let lastProgressAt = now();
  const observe = value => {
    for (const match of String(value).matchAll(/\b(Rendered|Encoded)\s+(\d+)\s*\/\s*(\d+)\b/g)) {
      const [, stage, rawCurrent, rawTotal] = match;
      const current = Number(rawCurrent), total = Number(rawTotal);
      const previous = counters.get(stage);
      if (!Number.isSafeInteger(current) || !Number.isSafeInteger(total)
        || total <= 0 || current <= 0 || current > total
        || (previous && (total !== previous.total || current <= previous.current))) continue;
      counters.set(stage, { current, total });
      lastProgressAt = now();
    }
  };
  return {
    logger: {
      info: value => { observe(value); logger.info?.(value); },
      warn: value => logger.warn?.(value)
    },
    resourceCheck() {
      const resourceError = resourceCheck?.();
      if (resourceError) return resourceError;
      if (now() - lastProgressAt < stallMs) return null;
      return Object.assign(new Error(`render narrativo sem avanço de quadros por ${Math.round(stallMs / 60000)} min`), {
        code: 'HYPERFRAMES_TIMEOUT', stage: 'narrative-render-stalled'
      });
    }
  };
}

module.exports = { createNarrativeRenderWatchdog };
