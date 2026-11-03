'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { prepareGenerationCacheScope } = require('../utils/generation-cache-scope');
const { loadGenerationTopicReservations } = require('../utils/generation-topic-reservations');

test('resumed job adopts only matching legacy script and narration into its own cache', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gen-cache-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputDir = path.join(root, 'data/videos');
  const scripts = path.join(root, 'data/scripts');
  await fs.mkdir(scripts, { recursive: true });
  const args = { root, outputDir, slug: 'tema', jobId: 'c27297ee-c16c-4cc4-93e7-83664be9a1cb',
    revision: 'v29', topic: 'Tema', formatId: 'direct-answer', targetWords: 950, contextHash: 'hash', allowLegacy: true };
  const oldScript = path.join(scripts, 'tema-v29.json');
  await fs.writeFile(oldScript, '{"title":"old"}');
  await fs.writeFile(`${oldScript}.meta.json`, JSON.stringify(args));
  const oldTts = path.join(outputDir, 'tema-v29_tts');
  await fs.mkdir(oldTts, { recursive: true });
  await fs.writeFile(path.join(oldTts, 'narration.mp3'), 'audio');
  const scoped = await prepareGenerationCacheScope(args);
  assert.equal(scoped, `tema-${args.jobId}`);
  assert.equal(await fs.readFile(path.join(scripts, `${scoped}-v29.json`), 'utf8'), '{"title":"old"}');
  assert.equal(await fs.readFile(path.join(outputDir, `${scoped}-v29_tts`, 'narration.mp3'), 'utf8'), 'audio');
  const other = { ...args, jobId: '38f6980e-f45d-4bd2-a5d4-bf928fa20f98', contextHash: 'different' };
  const otherSlug = await prepareGenerationCacheScope(other);
  await assert.rejects(fs.stat(path.join(scripts, `${otherSlug}-v29.json`)), { code: 'ENOENT' });
});

test('pending topics remain reserved for other jobs across restarts', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gen-reservation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDir = path.join(root, 'state');
  await fs.mkdir(stateDir);
  const jobId = 'c27297ee-c16c-4cc4-93e7-83664be9a1cb';
  const attempt = { version: 1, outPath: 'data/videos/a.mp4', theme: 'ia', jobId,
    startedAt: '2026-11-02T00:00:00Z', article: { title: 'Uma reportagem de teste válida',
      source: 'Jornal', url: 'https://example.test/news', ageHoursAtCapture: 2,
      capturedAt: '2026-11-02T00:00:00Z', contextHash: 'a'.repeat(64) } };
  await fs.writeFile(path.join(stateDir, 'deferred-generation-attempts.json'), JSON.stringify({ version: 1, entries: [attempt] }));
  assert.deepEqual(await loadGenerationTopicReservations({ root, stateDir, jobId: 'another' }),
    [{ title: attempt.article.title, url: attempt.article.url, jobId }]);
  assert.deepEqual(await loadGenerationTopicReservations({ root, stateDir, jobId }), []);
  await fs.writeFile(path.join(stateDir, 'deferred-generation-attempts.json'), '{"version":1,"entries":"invalid"}');
  await assert.rejects(loadGenerationTopicReservations({ root, stateDir, jobId }), /fila de recuperações inválida/);
});
