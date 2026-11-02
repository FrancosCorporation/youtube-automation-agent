'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { cachedOptionalMetadata } = require('../utils/optional-metadata-cache');

test('retomada reutiliza metadados ou fallback sem repetir chamadas opcionais', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-seo-cache-'));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  let calls = 0;
  const generate = async () => { calls++; return { youtubeTitle: 'Título revisado' }; };
  const options = { cacheDir, identity: { jobId: 'episode-1', prompt: 'content-a' }, generate };
  assert.deepEqual(await cachedOptionalMetadata(options), { youtubeTitle: 'Título revisado' });
  assert.deepEqual(await cachedOptionalMetadata(options), { youtubeTitle: 'Título revisado' });
  assert.equal(calls, 1);
  const failure = { ...options, identity: { jobId: 'episode-2' }, generate: async () => { calls++; return null; } };
  assert.equal(await cachedOptionalMetadata(failure), null);
  assert.equal(await cachedOptionalMetadata(failure), null);
  assert.equal(calls, 2);
  await cachedOptionalMetadata({ ...options, identity: { jobId: 'episode-1', prompt: 'content-b' } });
  assert.equal(calls, 3, 'conteúdo novo não reutiliza o SEO antigo');
});

test('pedido pendente, resposta corrompida e exceção não autorizam chamada duplicada', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-seo-pending-'));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const options = { cacheDir, identity: 'same-input' };
  let calls = 0;
  await cachedOptionalMetadata({ ...options, generate: async () => {
    calls++;
    assert.equal(await cachedOptionalMetadata({ ...options, generate: () => { assert.fail('pedido duplicado'); } }), null);
    return { youtubeTitle: 'Título' };
  } });
  const [file] = await fs.readdir(cacheDir);
  await fs.writeFile(path.join(cacheDir, file), '{broken');
  assert.equal(await cachedOptionalMetadata({ ...options, generate: () => { assert.fail('cache desconhecido não permite repetir'); } }), null);
  const failure = { ...options, identity: 'failed-input', generate: async () => { calls++; throw new Error('offline'); } };
  await assert.rejects(cachedOptionalMetadata(failure), /offline/);
  assert.equal(await cachedOptionalMetadata(failure), null);
  assert.equal(calls, 2);
});
