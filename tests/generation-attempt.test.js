'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { refreshGenerationAttempt } = require('../utils/generation-attempt');

test('retomada atualiza fonte escolhida pelo filho sem aceitar outro job', async () => {
  const expected = { jobId: 'original', outPath: 'data/videos/a.mp4' };
  const updated = { ...expected, article: { title: 'Fonte fixada pelo gerador' } };
  assert.deepEqual(await refreshGenerationAttempt({
    attemptStore: { read: async () => updated }, expected, root: '/project'
  }), updated);
  await assert.rejects(refreshGenerationAttempt({
    attemptStore: { read: async () => ({ ...updated, jobId: 'outro' }) }, expected, root: '/project'
  }), { code: 'GENERATION_ATTEMPT_IDENTITY_MISMATCH' });
  await assert.rejects(refreshGenerationAttempt({
    attemptStore: { read: async () => null }, expected, root: '/project'
  }), { code: 'GENERATION_ATTEMPT_IDENTITY_MISMATCH' });
});

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createGenerationAttemptStore, isCompletedGenerationAttempt, isCompletedResumeOutput, generationArticleAgeHours } = require('../utils/generation-attempt');

test('generation attempt survives restart and is atomically cleared after enqueue', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'generation-attempt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createGenerationAttemptStore({
    filePath: path.join(root, 'data', 'state', 'generation-in-flight.json'),
    root
  });
  const attempt = {
    version: 1,
    outPath: 'data/videos/auto_restart-fixture.mp4',
    theme: 'ia',
    jobId: 'c27297ee-c16c-4cc4-93e7-83664be9a1cb',
    startedAt: '2026-10-15T15:00:00.000Z',
    slotAt: '2026-10-15T15:24:00.000Z'
  };

  await store.write(attempt);
  assert.deepEqual(await store.read(), attempt);
  assert.equal((await fs.stat(path.join(root, 'data', 'state', 'generation-in-flight.json'))).mode & 0o777, 0o600);
  await store.clear();
  assert.equal(await store.read(), null);
});

test('recovery can preserve the editorial format and use source visuals for a known unavailable provider', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'generation-attempt-source-visuals-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createGenerationAttemptStore({ root, filePath: path.join(root, 'state.json') });
  const attempt = {
    version: 1, outPath: 'data/videos/recovery.mp4', theme: 'psicologia',
    jobId: 'c27297ee-c16c-4cc4-93e7-83664be9a1cb', startedAt: '2026-10-18T04:19:14.724Z',
    sourceVisualsOnly: true, formatId: 'context-change-result',
    article: { title: 'A pauta verificada permanece a mesma', source: 'Veículo', url: 'https://example.test/article',
      ageHoursAtCapture: 11, capturedAt: '2026-10-18T04:19:14.724Z', contextHash: 'a'.repeat(64) }
  };
  await store.write(attempt);
  assert.deepEqual(await store.read(), attempt);
  await assert.rejects(store.write({ ...attempt, sourceVisualsOnly: 'yes' }), /modo visual de retomada inválido/);
  await assert.rejects(store.write({ ...attempt, formatId: 'not-a-format' }), /formato editorial de retomada inválido/);
  await assert.rejects(store.write({ ...attempt, article: { ...attempt.article, url: 'file:///etc/passwd' } }), /fonte de retomada inválida/);
  await assert.rejects(store.write({ ...attempt, article: { ...attempt.article, url: 'https://user:password@example.test/' } }), /fonte de retomada inválida/);
  await assert.rejects(store.write({ ...attempt, article: { ...attempt.article, contextHash: 'invalid' } }), /fonte de retomada inválida/);
  assert.equal(generationArticleAgeHours(attempt.article, Date.parse('2026-10-18T06:19:14.724Z')), 13);
});

test('recap generation checkpoint preserves its theme window and rejects inconsistent metadata', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'generation-attempt-recap-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createGenerationAttemptStore({
    filePath: path.join(root, 'data', 'state', 'generation-in-flight.json'),
    root
  });
  const recapWindow = {
    themeId: 'ia',
    windowIndex: 0,
    key: 'ia:0',
    startAt: '2026-10-03T12:00:00.000Z',
    dueAt: '2026-10-10T12:00:00.000Z',
    endAt: '2026-10-10T12:00:00.000Z'
  };
  const attempt = {
    version: 1,
    outPath: 'data/videos/recap_restart-fixture.mp4',
    theme: 'ia',
    jobId: 'c27297ee-c16c-4cc4-93e7-83664be9a1cb',
    startedAt: '2026-10-15T15:00:00.000Z',
    recap: true,
    recapWindow
  };

  await store.write(attempt);
  assert.deepEqual(await store.read(), attempt);
  await assert.rejects(store.write({ ...attempt, recapWindow: { ...recapWindow, themeId: 'fitness' } }), /janela de recap inválida/);
  await assert.rejects(store.write({ ...attempt, recapWindow: undefined }), /janela de recap inválida/);
});

test('generation attempt rejects malformed and out-of-project media paths', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'generation-attempt-invalid-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createGenerationAttemptStore({
    filePath: path.join(root, 'state', 'generation-in-flight.json'),
    root
  });
  const valid = {
    version: 1,
    outPath: 'data/videos/auto_fixture.mp4',
    theme: 'ia',
    jobId: 'c27297ee-c16c-4cc4-93e7-83664be9a1cb',
    startedAt: '2026-10-15T15:00:00.000Z'
  };

  await assert.rejects(store.write({ ...valid, outPath: '../secrets.mp4' }), /fora de data\/videos/);
  await assert.rejects(store.write({ ...valid, theme: '../ia' }), /tema válido/);

  await fs.mkdir(path.dirname(path.join(root, 'state', 'generation-in-flight.json')), { recursive: true });
  const filePath = path.join(root, 'state', 'generation-in-flight.json');
  await fs.writeFile(filePath, '{broken');
  await assert.rejects(store.read(), error => error.code === 'GENERATION_ATTEMPT_INVALID' && /ilegível/.test(error.message));
  const quarantinedPath = await store.quarantineInvalid();
  assert.match(quarantinedPath, /generation-in-flight\.json\.invalid\./);
  assert.equal(await fs.readFile(quarantinedPath, 'utf8'), '{broken');
  assert.equal(await store.read(), null);
});

test('completed generation recovery requires the same ledger job, managed MP4, and passing video QA', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'generation-attempt-complete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const attempt = {
    version: 1,
    outPath: 'data/videos/auto_completed.mp4',
    theme: 'ia',
    jobId: 'c27297ee-c16c-4cc4-93e7-83664be9a1cb',
    startedAt: '2026-10-15T15:00:00.000Z'
  };
  const outputPath = path.join(root, attempt.outPath);
  const ledgerPath = path.join(root, 'data', 'state', 'topics.json');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  await fs.writeFile(outputPath, 'fixture');
  await fs.writeFile(ledgerPath, JSON.stringify({ entries: [{
    jobId: attempt.jobId,
    videoPath: attempt.outPath,
    generatedAt: '2026-10-15T15:24:00.000Z'
  }] }));
  const options = {
    attempt,
    ledgerPath,
    root,
    isManagedVideo: async candidate => candidate === outputPath && (await fs.stat(candidate)).isFile(),
    probeVideoHealth: async () => ({ ok: true })
  };

  const resume = { ...options, jobId: attempt.jobId, outPath: outputPath };
  assert.equal(await isCompletedResumeOutput(resume), true);
  assert.equal(await isCompletedResumeOutput({ ...resume, jobId: 'different-job' }), false);
  await fs.writeFile(ledgerPath, JSON.stringify({ entries: [] }));
  assert.equal(await isCompletedResumeOutput(resume), false, 'master parcial não comprova o pacote completo');
  await fs.writeFile(ledgerPath, JSON.stringify({ entries: [{ jobId: attempt.jobId,
    videoPath: attempt.outPath, generatedAt: '2026-10-15T15:24:00.000Z' }] }));

  assert.equal(await isCompletedGenerationAttempt(options), true);
  assert.equal(await isCompletedGenerationAttempt({
    ...options,
    attempt: { ...attempt, jobId: 'aa72797e-c16c-4cc4-93e7-83664be9a1cb' }
  }), false);
  assert.equal(await isCompletedGenerationAttempt({ ...options, probeVideoHealth: async () => ({ ok: false }) }), false);
});
