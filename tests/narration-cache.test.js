'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { narrationInputHash, narrationCacheMetadata, narrationCacheMatches, narrationCacheArtifactsMatch } = require('../utils/narration-cache');

const audio = Buffer.alloc(2000, 12);
const subtitles = Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nUma notícia com contexto.\n');
const wordTimings = Buffer.from('{"alignment":"edge-tts-word-boundary","words":[]}');
const inputHash = narrationInputHash('Uma notícia com contexto.');

test('only a complete pair bound to the current narration input can be reused', () => {
  const metadata = narrationCacheMetadata({ inputHash, provider: 'edge-tts', audio, subtitles, wordTimings });
  assert.equal(narrationCacheMatches(metadata, { inputHash, audio, subtitles, wordTimings }), true);
  assert.equal(narrationCacheMatches({ version: 1, provider: 'edge-tts' }, { inputHash, audio, subtitles }), false);
  assert.equal(narrationCacheMatches(null, { inputHash, audio, subtitles }), false);
  assert.equal(narrationCacheMatches(metadata, { inputHash: narrationInputHash('Texto reparado.'), audio, subtitles }), false);
});

test('voice, provider, pace, and pitch changes invalidate the cache', () => {
  assert.notEqual(inputHash, narrationInputHash('Uma notícia com contexto.', { voice: 'pt-BR-AntonioNeural' }));
  assert.notEqual(inputHash, narrationInputHash('Uma notícia com contexto.', { provider: 'gtts' }));
  assert.notEqual(inputHash, narrationInputHash('Uma notícia com contexto.', { rate: '-3%' }));
  assert.notEqual(inputHash, narrationInputHash('Uma notícia com contexto.', { pitch: '-1Hz' }));
});

test('visual rebuild reuse verifies source audio, subtitles and alignments independent of current TTS settings', () => {
  const metadata = narrationCacheMetadata({ inputHash, provider: 'edge-tts', audio, subtitles, wordTimings });
  assert.equal(narrationCacheArtifactsMatch(metadata, { audio, subtitles, wordTimings }), true);
  assert.equal(narrationCacheArtifactsMatch(metadata, {
    audio: Buffer.alloc(2000, 13), subtitles, wordTimings
  }), false);
  assert.equal(narrationCacheMatches(metadata, {
    inputHash: narrationInputHash('same text', { voice: 'pt-BR-AntonioNeural' }), audio, subtitles, wordTimings
  }), false);
});

test('partial writes and swapped audio or subtitles cannot pass the cache binding', () => {
  const metadata = narrationCacheMetadata({ inputHash, provider: 'gtts', audio, subtitles, wordTimings });
  assert.equal(narrationCacheMatches(metadata, { inputHash, audio: Buffer.alloc(2000, 13), subtitles, wordTimings }), false);
  assert.equal(narrationCacheMatches(metadata, { inputHash, audio, subtitles: Buffer.from('Outro roteiro'), wordTimings }), false);
  assert.equal(narrationCacheMatches(metadata, { inputHash, audio, subtitles, wordTimings: Buffer.from('different alignment') }), false);
  assert.equal(narrationCacheMatches(metadata, { inputHash, audio: Buffer.alloc(0), subtitles, wordTimings }), false);
  assert.equal(narrationCacheMatches({ ...metadata, provider: 'unknown' }, { inputHash, audio, subtitles, wordTimings }), false);
});
