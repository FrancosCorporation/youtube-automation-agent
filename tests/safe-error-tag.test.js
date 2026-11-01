'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { safeErrorTag } = require('../utils/safe-error-tag');

test('known media-generation failures become specific safe tags', () => {
  assert.equal(safeErrorTag(new Error('GEMINI_WEB_NOT_LOGGED_IN')), 'gemini_not_logged_in');
  assert.equal(safeErrorTag(new Error('Gemini web did not return a generated image in time')), 'gemini_image_timeout');
  assert.equal(safeErrorTag(new Error('Gemini web editor not ready for the prompt')), 'gemini_editor_not_ready');
  assert.equal(safeErrorTag(new Error('Gemini web image download failed: 403')), 'gemini_image_http_403');
  assert.equal(safeErrorTag(new Error('screenshot em branco (página não renderizou)')), 'article_screenshot_blank');
  assert.equal(safeErrorTag(new Error('GEMINI_ANDROID_PROMPT_INPUT_FAILED')), 'gemini_android_prompt_input_failed');
  assert.equal(safeErrorTag(new Error('GEMINI_ANDROID_GENERATION_TIMEOUT')), 'gemini_android_generation_timeout');
  assert.equal(safeErrorTag(new Error('GEMINI_ANDROID_PROMPT_FAILED')), 'gemini_android_prompt_failed');
  assert.equal(safeErrorTag(new Error('SCRIPT_GENERATION_UNAVAILABLE')), 'script_generation_unavailable');
  assert.equal(safeErrorTag(new Error('Limites de palavra do Edge TTS não correspondem à narração; sincronização cancelada')),
    'edge_word_timing_mismatch');
});

test('network codes stay useful while unknown error messages remain hidden', () => {
  assert.equal(safeErrorTag(new Error('net::ERR_TIMED_OUT at https://private.example')), 'network_err_timed_out');
  assert.equal(safeErrorTag(Object.assign(new Error('request failed'), { code: 'ECONNRESET' })), 'ECONNRESET');
  assert.equal(safeErrorTag(Object.assign(new Error('nenhuma pauta recente utilizável'), { code: 'no_fresh_topic_candidates' })), 'no_fresh_topic_candidates');

  const tag = safeErrorTag(new Error('Bearer sk-private-key and confidential prompt text'));
  assert.equal(tag, 'Error');
  assert.doesNotMatch(tag, /private|confidential|Bearer|sk-/i);
});

test('timeouts, HTTP responses and wrapped network errors get safe failure categories', () => {
  assert.equal(safeErrorTag(new Error('Connection error.')), 'network_connection_error');
  assert.equal(safeErrorTag(new globalThis.DOMException('private request details', 'TimeoutError')), 'request_timeout');
  assert.equal(safeErrorTag(Object.assign(new Error('private response body'), { response: { status: 503 } })), 'http_503');
  assert.equal(safeErrorTag(Object.assign(new Error('request failed'), { cause: Object.assign(new Error('socket'), { code: 'ECONNRESET' }) })), 'ECONNRESET');
  assert.equal(safeErrorTag(new Error('HTTP 429 private publisher URL')), 'http_429');
  assert.equal(safeErrorTag(new Error('NVIDIA HTTP 503')), 'http_503');
});
