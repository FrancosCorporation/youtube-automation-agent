'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const test = require('node:test');
const { generateSceneImages } = require('../scripts/generate-animated-video');

test('visual rebuild reads only the exact hash-bound scene images and never calls an image provider', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-rebuild-scenes-'));
  const assets = [];
  try {
    for (let groupIndex = 0; groupIndex < 3; groupIndex++) {
      const filePath = path.join(root, `scene-${groupIndex}.png`);
      const color = ['#6633aa', '#227766', '#bb7733'][groupIndex];
      await sharp({ create: { width: 48, height: 32, channels: 3, background: color } }).png().toFile(filePath);
      assets.push({ groupIndex, variant: 'c', path: filePath,
        sha256: crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex') });
    }
    assets[0].beatSha256 = crypto.createHash('sha256').update('Abertura explicativa.').digest('hex');
    const result = await generateSceneImages({
      hook: 'Abertura explicativa.',
      mainContent: { sections: [{ title: 'Como funciona', content: 'Fluxo de informação.' }] },
      conclusion: { finalThought: 'Resumo visual.' }
    }, 'ignored-cache-key', 'Tema determinístico', {
      cacheDirectory: path.join(root, 'unused-cache'),
      reuseOnly: true,
      replaySceneImages: assets
    });

    assert.equal(result.visualMode, 'ai-generated-scenes');
    assert.deepEqual(result.sceneImageAssets.map(asset => [asset.groupIndex, asset.variant, asset.sha256]),
      assets.map(asset => [asset.groupIndex, asset.variant, asset.sha256]));
    assert.equal(result.sceneImageAssets[0].beatSha256, assets[0].beatSha256);
    assert.equal(result.sceneImageAssets[1].beatSha256, undefined);
    assert.equal(result.scenes[0].sources.length, 1);
    assert.equal(result.scenes[0].thumbnailCandidates[0].variant, 'c');
    assert.equal(result.scenes[2].sources.length, 1);

    await fs.writeFile(assets[0].path, 'changed bytes');
    await assert.rejects(generateSceneImages({
      hook: 'Abertura explicativa.',
      mainContent: { sections: [{ title: 'Como funciona', content: 'Fluxo de informação.' }] },
      conclusion: { finalThought: 'Resumo visual.' }
    }, 'ignored-cache-key', 'Tema determinístico', {
      cacheDirectory: path.join(root, 'unused-cache'), reuseOnly: true, replaySceneImages: assets
    }), { code: 'visual_rebuild_image_cache_mismatch' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
