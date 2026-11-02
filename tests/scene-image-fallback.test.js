'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { generateSceneImages: realGenerateSceneImages, sceneVisualMode, shouldStopSceneImageAttempts } = require('../scripts/generate-animated-video');
const generateSceneImages = (script, slug, topic, options) => realGenerateSceneImages(script, slug, topic,
  { ...options, browserSessionLockHeld: true });
const noThumbWasSet = process.argv.includes('--no-thumb');
test.before(() => { if (!noThumbWasSet) process.argv.push('--no-thumb'); });
test.after(() => { if (!noThumbWasSet) process.argv.splice(process.argv.lastIndexOf('--no-thumb'), 1); });

test('uses source-led graphics when Gemini is unavailable without making an image request', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-image-fallback-'));
  let closeCalled = false;
  try {
    const result = await generateSceneImages({
      hook: 'Abertura baseada na fonte.',
      mainContent: { sections: [{ title: 'Evidência', content: 'O dado vem da fonte citada.' }] },
      conclusion: { finalThought: 'O que não está confirmado permanece em aberto.' }
    }, 'fallback-test', 'Pauta verificada', {
      cacheDirectory: path.join(root, 'cache'),
      provider: {
        isAvailable: async () => false,
        close: async () => { closeCalled = true; }
      }
    });

    assert.deepEqual(result, {
      scenes: {},
      thumbnailImage: '',
      portraitThumbnailImage: '',
      thumbnailArtProvenance: null,
      sceneImageAssets: [],
      visualMode: 'graphics-and-source-prints'
    });
    assert.equal(closeCalled, true);
    assert.deepEqual(await fs.readdir(path.join(root, 'cache')), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('cached scene images survive an offline provider, including caches after a missing image', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-cache-offline-'));
  const sharp = require('sharp');
  const script = { themeId: 'ia', hook: 'O sinal parte.', mainContent: { sections: [] },
    conclusion: { finalThought: 'O sinal chega.' } };
  const provider = { isAvailable: async () => true, close: async () => {},
    generateImage: async (_prompt, output) => sharp({ create: {
      width: 96, height: 64, channels: 3, background: '#95d7bc'
    } }).png().toFile(output) };
  const options = { cacheDirectory: path.join(root, 'cache'), imageLibraryDirectory: path.join(root, 'library'), provider };
  try {
    const first = await generateSceneImages(script, 'offline', 'Um sinal', options);
    assert.equal(first.sceneImageAssets.length, 2);
    let probes = 0;
    provider.isAvailable = async () => { probes++; return false; };
    provider.generateImage = async () => assert.fail('não gerar imagens com o provedor indisponível');
    const cached = await generateSceneImages(script, 'offline', 'Um sinal', options);
    assert.deepEqual(cached.sceneImageAssets, first.sceneImageAssets);
    assert.equal(probes, 0, 'cache completo não exige abrir o navegador');
    await fs.unlink(path.resolve(__dirname, '..', first.sceneImageAssets[0].path));
    const partial = await generateSceneImages(script, 'offline', 'Um sinal', options);
    assert.deepEqual(partial.sceneImageAssets, [first.sceneImageAssets[1]]);
    assert.equal(probes, 1, 'somente o cache ausente exige verificar o provedor');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('records whether generated scene images are complete, partial or absent', () => {
  assert.equal(sceneVisualMode({}, 3), 'graphics-and-source-prints');
  assert.equal(sceneVisualMode({ 0: { sources: ['image-a'] } }, 3), 'mixed-generated-scenes');
  assert.equal(sceneVisualMode({
    0: { sources: ['image-a'] },
    1: { sources: ['image-b'] },
    2: { sources: ['image-c'] }
  }, 3), 'ai-generated-scenes');
});

test('a failed Gemini availability probe also uses grounded graphics and closes the provider', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-image-probe-'));
  let closed = false;
  try {
    const result = await generateSceneImages({
      hook: 'Uma abertura baseada na reportagem.',
      mainContent: { sections: [] },
      conclusion: { finalThought: 'A conclusão mantém os limites da fonte.' }
    }, 'probe-failure', 'Pauta', {
      cacheDirectory: root,
      provider: {
        isAvailable: async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); },
        close: async () => { closed = true; }
      }
    });
    assert.equal(result.visualMode, 'graphics-and-source-prints');
    assert.deepEqual(result.scenes, {});
    assert.equal(closed, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a broken Gemini session or download ends attempts immediately and skips thumbnail requests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-image-download-'));
  let requests = 0;
  let closed = false;
  try {
    const result = await generateSceneImages({
      hook: 'A fonte explica o resultado.', mainContent: { sections: [] },
      conclusion: { finalThought: 'A conclusão preserva os limites.' }
    }, 'download-failure', 'Resultado verificado', {
      cacheDirectory: root,
      provider: {
        isAvailable: async () => true,
        generateImage: async () => {
          requests++;
          throw new Error('GEMINI_ANDROID_DOWNLOAD_CONFIRMATION_MISSING');
        },
        close: async () => { closed = true; }
      }
    });
    assert.equal(requests, 1);
    assert.equal(closed, true);
    assert.equal(result.visualMode, 'graphics-and-source-prints');
    assert.equal(result.thumbnailImage, '');
    assert.equal(shouldStopSceneImageAttempts(new Error('transient'), 1), false);
    assert.equal(shouldStopSceneImageAttempts(new Error('transient'), 2), true);
    assert.equal(shouldStopSceneImageAttempts(new Error('Gemini web did not return a generated image in time'), 1), true);
    assert.equal(shouldStopSceneImageAttempts(new Error('GEMINI_ANDROID_GENERATION_TIMEOUT'), 1), true);
    assert.equal(shouldStopSceneImageAttempts(new Error('GEMINI_ANDROID_CDP_IMAGE_TIMEOUT'), 1), true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
