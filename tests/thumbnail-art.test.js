const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { test } = require('node:test');
const { buildGroundedThumbnailArtInput, buildThumbnailArtPrompt, generateThumbnailArt } = require('../utils/thumbnail-art');

test('cover-art prompt creates a topic-specific, high-impact image without fabricating claims', () => {
  const prompt = buildThumbnailArtPrompt({
    topic: 'inflação e custo de vida',
    title: 'Inflação sobe e pressiona o custo de vida em 2026',
    hook: 'O preço de itens essenciais voltou a subir.',
    context: 'O índice divulgado mostra alta anual de 5,2%, com maior impacto nos alimentos.'
  });

  assert.match(prompt, /inflação e custo de vida/i);
  assert.match(prompt, /5,2%/);
  assert.match(prompt, /honest mobile thumbnail/i);
  assert.match(prompt, /dynamic diagonal composition/i);
  assert.match(prompt, /curiosity-driven/i);
  assert.match(prompt, /strong visual curiosity gap/i);
  assert.match(prompt, /striking symbolic editorial metaphor/i);
  assert.match(prompt, /left third visually calm/i);
  assert.match(prompt, /Do not invent a result, statistic, quote, person, brand, logo, or real event/i);
  assert.match(prompt, /No split screen, collage, montage/i);
  assert.match(prompt, /No text, no letters, no numbers, no logos/i);
  assert.match(prompt, /Never show a screen interface, chat bubble, message, app icon grid/i);
  assert.match(prompt, /plain blank unlit screen/);
  assert.match(prompt, /No people, faces, human forms, hands, or fingers/);
  assert.match(prompt, /most specific verified detail/i);
});

test('cover artwork inputs use original source material and omit generated script hooks', () => {
  const input = buildGroundedThumbnailArtInput({
    topic: 'carreira',
    sourceTitle: 'Fundat divulga novas vagas de emprego para esta terça-feira, 13',
    sourceContext: 'A publicação informa os cargos, requisitos e locais de atendimento aos candidatos.',
    generatedTitle: 'Fundat: 300 vagas somem em minutos',
    generatedHook: 'Como a Fundat preenche centenas de vagas em minutos'
  });
  const prompt = buildThumbnailArtPrompt(input);

  assert.equal(input.title, 'Fundat divulga novas vagas de emprego para esta terça-feira, 13');
  assert.equal(input.hook, '');
  assert.match(prompt, /Fundat divulga novas vagas/);
  assert.doesNotMatch(prompt, /300 vagas|somem em minutos|centenas de vagas/i);
});

test('dedicated cover art is cached and returned as an image without joining video scenes', async () => {
  const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-thumbnail-art-'));
  let generationCount = 0;
  const web = {
    async generateImage(_prompt, outputPath) {
      generationCount++;
      const png = await sharp({
        create: { width: 64, height: 36, channels: 3, background: '#cc3300' }
      }).png().toBuffer();
      await fs.writeFile(outputPath, png);
      return { modelId: 'gemini-3-pro-image', provider: 'gemini-android', modelVerification: 'requested-not-verified', selectedMode: 'Gemini Pro', aspectRatio: '16:9' };
    }
  };
  const input = {
    web,
    cacheDirectory,
    topic: 'robôs domésticos',
    title: 'O novo robô que ajuda nas tarefas de casa',
    hook: 'Modelos recentes já fazem tarefas simples.',
    context: 'O vídeo mostra capacidades demonstradas em materiais oficiais.'
  };

  try {
    const first = await generateThumbnailArt(input);
    const second = await generateThumbnailArt(input);
    const files = await fs.readdir(cacheDirectory);

    assert.match(first, /^data:image\/jpeg;base64,/);
    assert.equal(second, first);
    assert.equal(generationCount, 1);
    assert.equal(files.length, 2);
    assert.match(files[0], /^thumbnail-art-[a-f0-9]{16}\.png$/);
  } finally {
    await fs.rm(cacheDirectory, { recursive: true, force: true });
  }
});
