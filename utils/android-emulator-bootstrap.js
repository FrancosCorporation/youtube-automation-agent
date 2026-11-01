'use strict';

async function waitForAndroidBoot({
  isBooted,
  reconnect,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now,
  timeoutMs = 240000,
  pollIntervalMs = 5000
}) {
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    if (await isBooted()) return true;
    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;
    await reconnect();
    await wait(Math.min(pollIntervalMs, remainingMs));
  }
  throw new Error(`Android não concluiu o boot em ${Math.ceil(timeoutMs / 1000)} segundos`);
}

async function ensureAndroidBooted({
  isBooted,
  reconnect,
  restartContainer,
  wait,
  now,
  timeoutMs = 240000,
  pollIntervalMs = 5000,
  maxAttempts = 2
}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await waitForAndroidBoot({ isBooted, reconnect, wait, now, timeoutMs, pollIntervalMs });
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await restartContainer();
    }
  }
  throw new Error(`Android indisponível após ${maxAttempts} tentativas: ${lastError?.message || 'boot incompleto'}`, {
    cause: lastError
  });
}

module.exports = { ensureAndroidBooted, waitForAndroidBoot };
