'use strict';

const { fetchWithTimeout } = require('./fetch-with-timeout');

const NVIDIA_API_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_POLL_INTERVAL_MS = 1000;

function pendingRequestId(body, response) {
  const value = body?.requestId || body?.request_id || body?.id || response.headers?.get?.('nvcf-reqid');
  const requestId = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(requestId) ? requestId : '';
}

function pendingResponseError(code) {
  return Object.assign(new Error(code), { code });
}

function timeoutError() {
  return Object.assign(new Error('nvidia_status_poll_timeout'), {
    code: 'NVIDIA_STATUS_POLL_TIMEOUT',
    name: 'TimeoutError'
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Sends one NVIDIA chat completion and polls the documented status endpoint for HTTP 202. */
async function requestNvidiaChatCompletion({
  apiKey,
  body,
  timeoutMs,
  signal,
  fetchImpl = globalThis.fetch,
  sleepImpl = delay,
  now = Date.now,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  baseUrl = NVIDIA_API_BASE_URL
} = {}) {
  if (!String(apiKey || '').trim()) throw new TypeError('apiKey ausente');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('body inválido');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new RangeError('timeoutMs inválido');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch inválido');
  if (typeof sleepImpl !== 'function' || typeof now !== 'function') throw new TypeError('relógio inválido');

  const deadline = now() + timeoutMs;
  const authHeader = `Bearer ${apiKey}`;
  let response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {})
  }, timeoutMs, fetchImpl);
  if (response.status !== 202) return response;

  let pendingBody;
  try { pendingBody = await response.json(); }
  catch { throw pendingResponseError('NVIDIA_PENDING_RESPONSE_INVALID'); }
  const requestId = pendingRequestId(pendingBody, response);
  if (!requestId) throw pendingResponseError('NVIDIA_PENDING_REQUEST_ID_MISSING');
  const statusUrl = `${baseUrl}/status/${encodeURIComponent(requestId)}`;

  while (true) {
    const remainingBeforeDelay = deadline - now();
    if (remainingBeforeDelay <= 0) throw timeoutError();
    await sleepImpl(Math.min(pollIntervalMs, remainingBeforeDelay));
    const remaining = deadline - now();
    if (remaining <= 0) throw timeoutError();
    response = await fetchWithTimeout(statusUrl, {
      method: 'GET',
      headers: { Authorization: authHeader, Accept: 'application/json' },
      ...(signal ? { signal } : {})
    }, remaining, fetchImpl);
    if (response.status !== 202) return response;
    try { await response.json(); }
    catch { throw pendingResponseError('NVIDIA_PENDING_RESPONSE_INVALID'); }
  }
}

module.exports = { NVIDIA_API_BASE_URL, requestNvidiaChatCompletion };
