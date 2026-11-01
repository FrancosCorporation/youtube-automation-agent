'use strict';

/**
 * Bound how long a caller waits for an operation without killing unrelated
 * processes. The operation may still be running after timeout; callers that
 * publish must keep their per-device lock and record the outcome as unknown.
 */
function withOperationBudget(operation, { platform = 'upload', timeoutMs } = {}) {
  const duration = Number(timeoutMs);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new TypeError('orçamento de operação precisa ser positivo');
  }

  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${platform}: tempo limite excedido; resultado da operação é desconhecido`);
      error.code = 'OPERATION_TIMEOUT';
      reject(error);
    }, duration);
  });

  return Promise.race([Promise.resolve(operation), timeout])
    .finally(() => clearTimeout(timer));
}

module.exports = { withOperationBudget };
