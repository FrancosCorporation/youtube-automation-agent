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

test('TTS success with a truncated transcript never replaces the existing narration checkpoint', async t => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const { EventEmitter } = require('node:events');
  const { setImmediate } = require('node:timers');
  const childProcess = require('node:child_process');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tts-checkpoint-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.mock.method(require('dotenv'), 'config', () => ({ parsed: {} }));
  t.mock.method(childProcess, 'spawnSync', () => ({ status: 0 }));
  t.mock.method(childProcess, 'spawn', (_command, args) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    const arg = key => args[args.indexOf(key) + 1];
    setImmediate(async () => {
      if (args.includes('--audio')) {
        await fs.writeFile(arg('--audio'), audio);
        await fs.writeFile(arg('--timings'), JSON.stringify({ alignment: 'edge-tts-word-boundary-events',
          events: [{ text: 'Errado', startMs: 0, endMs: 400 }] }));
      } else {
        await fs.writeFile(arg('--write-media'), audio);
        await fs.writeFile(arg('--write-subtitles'), '1\n00:00:00,000 --> 00:00:01,000\nOutro texto.\n');
      }
      child.emit('close', 0);
    });
    return child;
  });
  const { synthesizeNarration, SCRIPT_REVISION } = require('../scripts/generate-animated-video');
  const dir = path.join(root, `test-${SCRIPT_REVISION}_tts`);
  await fs.mkdir(dir);
  const original = { 'narration.mp3': audio, 'narration.srt': subtitles,
    'narration.word-timings.json': wordTimings, 'narration.mp3.meta.json': Buffer.from('{"version":0}') };
  for (const [name, content] of Object.entries(original)) await fs.writeFile(path.join(dir, name), content);
  await assert.rejects(synthesizeNarration({ hook: 'Texto correto.', mainContent: { sections: [] },
    conclusion: { finalThought: '' } }, 'test', root), { code: 'NARRATION_ALIGNMENT_FAILED' });
  for (const [name, content] of Object.entries(original)) assert.deepEqual(await fs.readFile(path.join(dir, name)), content);
  assert.deepEqual((await fs.readdir(dir)).sort(), Object.keys(original).sort());
});
