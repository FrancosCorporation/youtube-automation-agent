'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const test = require('node:test');
const { ImageLibrary, sceneImageHashes, recordImageLibraryUsage } = require('../utils/image-library');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-image-library-'));
  const directory = path.join(root, 'library');
  const library = await new ImageLibrary({ directory }).initialize();
  t.after(async () => { await library.close(); await fs.rm(root, { recursive: true, force: true }); });
  const imagePath = path.join(root, 'source.png');
  await sharp({ create: { width: 96, height: 64, channels: 4, background: { r: 40, g: 80, b: 120, alpha: 0.5 } } })
    .png({ compressionLevel: 0 }).toFile(imagePath);
  return { root, directory, library, imagePath };
}

test('archives with lossless compression, full resolution, identical pixels and intact original', async t => {
  const f = await fixture(t);
  const before = await fs.readFile(f.imagePath);
  const record = await f.library.archive({ imagePath: f.imagePath, theme: 'ia', topic: 'DeepSeek busca web' });
  const saved = await f.library.get(record.id);
  assert.equal(saved.width, 96);
  assert.equal(saved.height, 64);
  assert.equal(saved.format, 'webp');
  assert(saved.stored_bytes < saved.original_bytes);
  assert.deepEqual(await sharp(saved.filePath).ensureAlpha().raw().toBuffer(), await sharp(before).ensureAlpha().raw().toBuffer());
  assert.deepEqual(await fs.readFile(f.imagePath), before);
});

test('deduplicates bytes while retaining separate contexts and isolates search by theme', async t => {
  const f = await fixture(t);
  const metadata = { imagePath: f.imagePath, theme: 'ia', topic: 'DeepSeek busca web', sectionTitle: 'Busca na internet' };
  const first = await f.library.archive(metadata);
  const second = await f.library.archive({ ...metadata, theme: 'fitness', topic: 'Treino de força' });
  assert.equal(first.id, second.id);
  assert.equal((await f.library.stats()).images, 1);
  assert.equal((await f.library.search({ theme: 'ia', query: 'DeepSeek busca' })).length, 1);
  assert.equal((await f.library.search({ theme: 'fitness', query: 'DeepSeek' })).length, 0);
  assert.equal((await f.library.search({ theme: 'fitness', query: 'força' }))[0].topic, 'Treino de força');
  assert.equal((await f.library.search({ theme: 'ia', query: 'DeepSeek' }))[0].reviewRequired, true);
});

test('tracks actual render representations and never labels unobserved historical usage unused', async t => {
  const f = await fixture(t);
  const preview = await sharp(f.imagePath).jpeg().toBuffer();
  const record = await f.library.archive({ imagePath: f.imagePath, theme: 'ia', topic: 'Busca web', renderBytes: preview });
  assert.equal((await f.library.search({ theme: 'ia' }))[0].usage_status, 'unknown');
  assert.equal((await f.library.search({ theme: 'ia', unusedOnly: true })).length, 0);
  const scenes = [{ components: [{ type: 'image-hero', src: `data:image/jpeg;base64,${preview.toString('base64')}` }] }];
  assert.equal(await recordImageLibraryUsage({ directory: f.directory, sha256s: sceneImageHashes(scenes), artifactPath: path.join(f.root, 'render.mp4') }), 1);
  const result = (await f.library.search({ theme: 'ia' }))[0];
  assert.equal(result.id, record.id);
  assert.equal(result.usage_status, 'used');
  assert.equal(await f.library.markUsed({ sha256s: sceneImageHashes(scenes), artifactPath: path.join(f.root, 'render.mp4') }), 0);
});

test('fresh surplus is searchable as unused and corrupt objects cannot be reused', async t => {
  const f = await fixture(t);
  const record = await f.library.archive({ imagePath: f.imagePath, theme: 'saude', topic: 'Atividade física', usageKnown: true });
  assert.equal((await f.library.search({ theme: 'saude', query: 'física', unusedOnly: true })).length, 1);
  const saved = await f.library.get(record.id);
  await fs.appendFile(saved.filePath, 'corrupt');
  await assert.rejects(f.library.get(record.id), /image_library_integrity_failed/);
});

test('JPEG and alpha images keep their decoded pixels without applying a new quality setting', async t => {
  const f = await fixture(t);
  const jpegPath = path.join(f.root, 'photo.jpg');
  await sharp(f.imagePath).jpeg({ quality: 91 }).toFile(jpegPath);
  const before = await sharp(jpegPath).ensureAlpha().raw().toBuffer();
  const record = await f.library.archive({ imagePath: jpegPath, theme: 'carreira', topic: 'Vagas' });
  const saved = await f.library.get(record.id);
  assert.deepEqual(await sharp(saved.filePath).ensureAlpha().raw().toBuffer(), before);
  assert(saved.stored_bytes <= saved.original_bytes);
});

test('scene generation creates only narration-matched images, up to one per visual beat', async t => {
  const f = await fixture(t);
  const { generateSceneImages } = require('../scripts/generate-animated-video');
  let requests = 0;
  const prior = process.env.IMAGES_PER_GROUP;
  const noThumbWasSet = process.argv.includes('--no-thumb');
  delete process.env.IMAGES_PER_GROUP;
  if (!noThumbWasSet) process.argv.push('--no-thumb');
  try {
    const result = await generateSceneImages({ themeId: 'ia', hook: 'Uma abertura.',
      mainContent: { sections: [{ title: 'Busca web', content: [
        'O modelo identifica a pergunta.',
        'A pesquisa consulta a web.',
        'A fonte informa os limites.',
        'O sistema prepara o contexto.',
        'A resposta segue para a aplicação.',
        'O resultado volta ao pedido.'
      ].join(' ') }] },
      conclusion: { finalThought: 'A fonte explica os limites.' },
      timings: [4000, 48000, 3000].map(durationMs => ({ durationMs }))
    }, 'demand-test', 'DeepSeek busca web', {
      cacheDirectory: path.join(f.root, 'cache'), imageLibraryDirectory: f.directory,
      provider: { isAvailable: async () => true, close: async () => {},
        generateImage: async (_prompt, output) => {
          requests++;
          await sharp({ create: { width: 96, height: 64, channels: 3,
            background: { r: requests * 20, g: 40, b: 80 } } }).png().toFile(output);
        } }
    });
    assert.equal(requests, 8, 'short opening/ending need one image; a 48s section has six visual beats');
    assert.deepEqual(Object.values(result.scenes).map(group => group.sources.length), [1, 6, 1]);
    const { narrativeBeatSha256 } = require('../utils/scene-image-prompt');
    assert.equal(result.sceneImageAssets.find(asset => asset.groupIndex === 0).beatSha256, narrativeBeatSha256('Uma abertura.'));
    assert.equal(result.sceneImageAssets.find(asset => asset.groupIndex === 1 && asset.variant === 'a').beatSha256,
      narrativeBeatSha256('O modelo identifica a pergunta.'));
    assert.equal((await f.library.stats()).images, 8);
    const preview = Buffer.from(result.scenes[1].sources[0].split(',')[1], 'base64');
    const previewHash = crypto.createHash('sha256').update(preview).digest('hex');
    assert.equal(await f.library.markUsed({ sha256s: [previewHash], artifactPath: path.join(f.root, 'part.mp4') }), 1);
    assert.equal((await f.library.search({ theme: 'ia', unusedOnly: true })).length, 7);
    const beforeSearch = requests;
    await f.library.search({ theme: 'ia', query: 'DeepSeek web' });
    assert.equal(requests, beforeSearch, 'library lookups never trigger image generation');
  } finally {
    if (prior === undefined) delete process.env.IMAGES_PER_GROUP; else process.env.IMAGES_PER_GROUP = prior;
    if (!noThumbWasSet) process.argv.splice(process.argv.lastIndexOf('--no-thumb'), 1);
  }
});

test('scene image cache changes when the narrated beat changes and preserves unchanged images', async t => {
  const f = await fixture(t);
  const { generateSceneImages } = require('../scripts/generate-animated-video');
  const noThumbWasSet = process.argv.includes('--no-thumb');
  if (!noThumbWasSet) process.argv.push('--no-thumb');
  let requests = 0;
  const provider = { isAvailable: async () => true, close: async () => {}, generateImage: async (_prompt, output) => {
    requests++;
    await sharp({ create: { width: 32, height: 32, channels: 3, background: '#365576' } }).png().toFile(output);
  } };
  const options = { cacheDirectory: path.join(f.root, 'beat-cache'), imageLibraryDirectory: f.directory, provider };
  const script = { themeId: 'ia', hook: 'Uma abertura.', mainContent: { sections: [{ title: 'Pesquisa', content: 'A pessoa lê uma notícia.' }] },
    conclusion: { finalThought: 'Um resumo.' }, timings: [0, 1, 2].map(() => ({ durationMs: 3000 })) };
  try {
    const first = await generateSceneImages(script, 'beat-cache', 'Tema', options);
    assert.equal(requests, 3);
    await generateSceneImages(script, 'beat-cache', 'Tema', options);
    assert.equal(requests, 3);
    script.mainContent.sections[0].content = 'A pessoa escreve uma notícia.';
    const changed = await generateSceneImages(script, 'beat-cache', 'Tema', options);
    assert.equal(requests, 4);
    assert.notEqual(first.sceneImageAssets.find(asset => asset.groupIndex === 1).beatSha256,
      changed.sceneImageAssets.find(asset => asset.groupIndex === 1).beatSha256);
  } finally {
    if (!noThumbWasSet) process.argv.splice(process.argv.lastIndexOf('--no-thumb'), 1);
  }
});
