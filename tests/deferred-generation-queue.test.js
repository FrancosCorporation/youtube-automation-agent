'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createGenerationAttemptStore } = require('../utils/generation-attempt');
const { createDeferredGenerationQueue } = require('../utils/deferred-generation-queue');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-deferred-generation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const attemptStore = createGenerationAttemptStore({ root, filePath: path.join(root, 'state', 'in-flight.json') });
  const filePath = path.join(root, 'state', 'deferred.json');
  const queue = createDeferredGenerationQueue({ root, filePath, attemptStore });
  const attempt = { version: 1, outPath: 'data/videos/reworked.mp4', theme: 'ia',
    jobId: 'c27297ee-c16c-4cc4-93e7-83664be9a1cb', startedAt: '2026-10-27T12:00:00.000Z' };
  return { root, attemptStore, filePath, queue, attempt };
}

test('recuperação aguarda job ativo e é transferida uma vez para o checkpoint', async t => {
  const f = await fixture(t);
  const active = { ...f.attempt, jobId: 'aa72797e-c16c-4cc4-93e7-83664be9a1cb', outPath: 'data/videos/active.mp4' };
  await f.attemptStore.write(active);
  assert.equal(await f.queue.enqueue(f.attempt), true);
  assert.equal(await f.queue.enqueue(f.attempt), false);
  assert.equal(await f.queue.claimNext(), null);
  assert.equal((await f.attemptStore.read()).jobId, active.jobId);
  await f.attemptStore.clear();
  assert.deepEqual(await f.queue.claimNext(), f.attempt);
  assert.deepEqual(await f.attemptStore.read(), f.attempt);
  assert.deepEqual(JSON.parse(await fs.readFile(f.filePath, 'utf8')).entries, []);
});

test('reinício reconcilia checkpoint escrito antes da remoção da fila sem duplicar', async t => {
  const f = await fixture(t);
  await f.queue.enqueue(f.attempt);
  await f.attemptStore.write(f.attempt);
  assert.equal(await f.queue.claimNext(), null);
  await f.attemptStore.clear();
  assert.equal(await f.queue.claimNext(), null);
});

test('fila inválida é preservada e item já enfileirado pode ser ignorado', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.dirname(f.filePath), { recursive: true });
  await fs.writeFile(f.filePath, '{inválido');
  await assert.rejects(f.queue.claimNext());
  assert.equal(await fs.readFile(f.filePath, 'utf8'), '{inválido');
  await fs.unlink(f.filePath);
  await f.queue.enqueue(f.attempt);
  assert.equal(await f.queue.claimNext({ skipCompleted: async () => true }), null);
  assert.equal(await f.attemptStore.read(), null);
});

test('recuperações adiadas não bloqueiam outras pautas e voltam ao vencer o prazo', async t => {
  const f = await fixture(t);
  const other = { ...f.attempt, jobId: 'aa72797e-c16c-4cc4-93e7-83664be9a1cb', outPath: 'data/videos/other.mp4' };
  const due = '2026-11-02T23:30:00.000Z';
  await f.queue.enqueue(f.attempt, { notBefore: due });
  await f.queue.enqueue(other);
  assert.deepEqual(await f.queue.claimNext({ now: Date.parse(due) - 1 }), other);
  await f.attemptStore.clear();
  assert.equal(await f.queue.claimNext({ now: Date.parse(due) - 1 }), null);
  const restarted = createDeferredGenerationQueue({ root: f.root, filePath: f.filePath, attemptStore: f.attemptStore });
  assert.deepEqual(await restarted.claimNext({ now: Date.parse(due) }), f.attempt);
  assert.deepEqual(await f.attemptStore.read(), f.attempt);
});

test('prazo inválido não é aceito nem apagado', async t => {
  const f = await fixture(t);
  await assert.rejects(f.queue.enqueue(f.attempt, { notBefore: 'inválido' }));
  await fs.mkdir(path.dirname(f.filePath), { recursive: true });
  const contents = JSON.stringify({ version: 1, entries: [{ ...f.attempt, notBefore: 'inválido' }] });
  await fs.writeFile(f.filePath, contents);
  await assert.rejects(f.queue.claimNext());
  assert.equal(await fs.readFile(f.filePath, 'utf8'), contents);
});
