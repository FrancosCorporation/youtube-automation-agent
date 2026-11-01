'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { articleScreenshotCachePath } = require('../utils/article-screenshot-cache');
const { screenshotArticles } = require('../scripts/generate-animated-video');

test('browser indisponível preserva posições sem fabricar prints ou interromper a produção', async () => {
  const shots = [{ url: 'https://example.com/one' }, { url: 'https://example.com/two' }];
  const prints = await screenshotArticles(shots, '/tmp', {
    launchBrowser: async () => { throw new Error('browser unavailable'); }
  });
  assert.deepEqual(prints, [null, null]);
});

test('cacheia screenshot pela URL e configuração de captura, não pela posição do item', () => {
  const directory = path.join('/tmp', 'article-images');
  const date = new Date('2026-10-17T22:00:00.000Z');
  const first = articleScreenshotCachePath(directory, 'https://publisher.example/story?item=1#top', date);
  const sameDocument = articleScreenshotCachePath(directory, 'https://publisher.example/story?item=1#comments', date);
  const otherSource = articleScreenshotCachePath(directory, 'https://publisher.example/story?item=2', date);
  const nextDay = articleScreenshotCachePath(directory, 'https://publisher.example/story?item=1', new Date('2026-10-18T00:00:00.000Z'));

  assert.equal(first, sameDocument);
  assert.notEqual(first, otherSource);
  assert.notEqual(first, nextDay);
  assert.match(path.basename(first), /^print-v3-[a-f0-9]{64}\.png$/);
});

test('recusa URL não HTTP e data inválida para evitar cache ambíguo', () => {
  assert.throws(() => articleScreenshotCachePath('/tmp', 'file:///etc/passwd'), /protocolo inválido/);
  assert.throws(() => articleScreenshotCachePath('/tmp', 'https://publisher.example/story', 'not-a-date'), /data inválida/);
});
