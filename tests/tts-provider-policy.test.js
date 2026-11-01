'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { isGttsFallbackAllowed, isGttsProviderSelected } = require('../utils/tts-provider-policy');

test('the approved Edge voice does not silently switch to gTTS when Microsoft is unavailable', () => {
  assert.equal(isGttsFallbackAllowed({ provider: 'auto', allowFallback: '' }), false);
  assert.equal(isGttsFallbackAllowed({ provider: undefined, allowFallback: '0' }), false);
});

test('gTTS fallback requires an explicit provider choice or explicit opt-in', () => {
  assert.equal(isGttsFallbackAllowed({ provider: 'gtts' }), true);
  assert.equal(isGttsFallbackAllowed({ provider: 'G-TTS' }), true);
  assert.equal(isGttsFallbackAllowed({ provider: 'auto', allowFallback: '1' }), true);
  assert.equal(isGttsFallbackAllowed({ provider: 'auto', allowFallback: 'true' }), false);
});

test('only explicit gTTS names select that provider', () => {
  assert.equal(isGttsProviderSelected(' gtts '), true);
  assert.equal(isGttsProviderSelected('edge-tts'), false);
});

test('the supervised scheduler explicitly opts into the recovery fallback', () => {
  const dropIn = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'systemd', 'ai-video-scheduler.service.d', '20-training-sharing.conf'), 'utf8');
  assert.match(dropIn, /^Environment=TTS_ALLOW_PROVIDER_FALLBACK=1$/m);
});
