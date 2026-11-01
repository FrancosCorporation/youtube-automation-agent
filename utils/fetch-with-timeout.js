'use strict';

function fetchWithTimeout(url, init = {}, timeoutMs = 30_000, fetchImpl = globalThis.fetch) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError('timeoutMs precisa ser um inteiro positivo');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch inválido');

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  return fetchImpl(url, { ...init, signal });
}

module.exports = { fetchWithTimeout };
