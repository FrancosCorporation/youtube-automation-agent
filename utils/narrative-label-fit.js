'use strict';

function narrativeLabelMaxWidth({ x, width, spacing, margin = 18 }) {
  if (![x, width, spacing, margin].every(Number.isFinite) || width <= 0 || spacing <= 0 || margin < 0) {
    throw new TypeError('geometria de rótulo inválida');
  }
  return Math.max(1, Math.min(spacing - margin, 2 * (x - margin), 2 * (width - x - margin)));
}

module.exports = { narrativeLabelMaxWidth };
