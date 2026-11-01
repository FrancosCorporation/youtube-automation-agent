'use strict';

function isGttsProviderSelected(provider) {
  return /^(?:gtts|g-tts)$/i.test(String(provider || '').trim());
}

function isGttsFallbackAllowed({ provider, allowFallback } = {}) {
  return isGttsProviderSelected(provider) || String(allowFallback || '').trim() === '1';
}

module.exports = { isGttsFallbackAllowed, isGttsProviderSelected };
