'use strict';

require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { GeminiAndroidImageGenerator } = require('../utils/gemini-android-image');
const { buildThumbnailArtPrompt } = require('../utils/thumbnail-art');
const { buildThumbnailHtml, buildPortraitThumbnailHtml } = require('../utils/thumbnail-design');

const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'docs/evidencias/ia-como-responde-2026-10-23');
const output = path.join(evidence, 'thumbnail');
const headline = 'PARECE CERTO. MAS É?';
const accent = '#C3AEFF';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function renderCover(html, filename, viewport) {
  const pagePath = path.join(output, filename.replace(/\.png$/i, '.html'));
  await fs.writeFile(pagePath, html);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.goto(`file://${pagePath}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.locator('h1').evaluate(el => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent, left: r.left, top: r.top, right: r.right, bottom: r.bottom,
        overflow: el.scrollWidth > el.clientWidth + 1 };
    });
    if (layout.overflow || layout.left < 0 || layout.top < 0 || layout.right > viewport.width || layout.bottom > viewport.height) {
      throw new Error(`Capa ${filename} excede o quadro`);
    }
    await page.screenshot({ path: path.join(output, filename) });
    return layout;
  } finally { await browser.close(); }
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const script = JSON.parse(await fs.readFile(path.join(evidence, 'script-draft.json'), 'utf8'));
  const priorCover = path.join(output, 'cover.png');
  const priorQa = path.join(output, 'qa.json');
  for (const [source, target] of [[priorCover, path.join(output, 'cover-v1.png')], [priorQa, path.join(output, 'qa-v1.json')]]) {
    await fs.copyFile(source, target, require('node:fs').constants.COPYFILE_EXCL)
      .catch(error => { if (error.code !== 'ENOENT' && error.code !== 'EEXIST') throw error; });
  }

  let landscapeArt = process.argv[2] ? path.resolve(process.argv[2]) : null;
  let portraitArt = process.argv[3] ? path.resolve(process.argv[3]) : null;
  if (Boolean(landscapeArt) !== Boolean(portraitArt)) throw new Error('Informe as duas artes ou nenhuma.');
  let providerName = 'ImageGen do GPT';
  if (!landscapeArt) {
    providerName = 'Gemini via Android Chrome autenticado';
    const context = 'Vídeo explica tokens, contexto, treinamento, respostas sem apoio e verificação de documentos. Uma resposta pode soar convincente sem estar verificada. Metáfora visual: um processador físico ao lado de uma folha de papel limpa, com partículas finas se desfazendo na borda; não é prova de um evento real. Não invente texto, escrita simulada ou cenário não relacionado.';
    const web = new GeminiAndroidImageGenerator({
      androidOptions: { device: 'emulator-5560' },
      browserPackage: 'com.android.chrome',
      cdpUrl: 'http://127.0.0.1:9223',
      timeoutMs: 240000,
      probeTimeoutMs: 25000
    });
    try {
      if (!await web.isAvailable()) throw new Error('Gemini Android não está disponível na sessão autenticada');
      await web.withDeviceSessionLock(async () => {
        landscapeArt = await web.generateImage(buildThumbnailArtPrompt({ topic: script.title, title: script.title,
          hook: script.hook, context, aspectRatio: '16:9', sceneDirection: 'A real silicon accelerator beside one clean blank paper page on a dark desk; tiny ink-like particles fade from the paper edge. Keep the subject on the right and leave dark negative space on the left. No bridge, architecture, or landscape.' }), path.join(output, 'gemini-art-landscape-v2.png'), { aspectRatio: '16:9' });
        portraitArt = await web.generateImage(buildThumbnailArtPrompt({ topic: script.title, title: script.title,
          hook: script.hook, context, aspectRatio: '9:16', sceneDirection: 'The same real silicon accelerator and one clean blank paper page on a dark desk; tiny ink-like particles fade from the paper edge. Place the subject in the upper two thirds and leave the lower third dark and empty for headline text. No bridge, architecture, or landscape.' }), path.join(output, 'gemini-art-portrait-v2.png'), { aspectRatio: '9:16' });
      });
    } finally { await web.close(); }
  }
  for (const artwork of [landscapeArt, portraitArt]) {
    const metadata = await sharp(artwork).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 512 || metadata.height < 512) throw new Error('Arte de capa inválida');
  }

  const landscapeUri = `data:image/png;base64,${(await fs.readFile(landscapeArt)).toString('base64')}`;
  const portraitUri = `data:image/png;base64,${(await fs.readFile(portraitArt)).toString('base64')}`;
  const landscapeHtml = buildThumbnailHtml({ title: script.title, headline, brand: 'Pulso Explica', accent, heroImage: landscapeUri });
  const portraitHtml = buildPortraitThumbnailHtml({ title: script.title, headline, brand: 'Pulso Explica', accent, heroImage: portraitUri });
  const layouts = {
    landscape: await renderCover(landscapeHtml, 'cover.png', { width: 1280, height: 720 }),
    portrait: await renderCover(portraitHtml, 'cover-portrait.png', { width: 1080, height: 1920 })
  };
  const covers = await Promise.all(['cover.png', 'cover-portrait.png'].map(async filename => {
    const bytes = await fs.readFile(path.join(output, filename));
    const metadata = await sharp(bytes).metadata();
    return { path: path.join(output, filename), sha256: sha(bytes), width: metadata.width, height: metadata.height,
      bytes: bytes.length, layout: layouts[filename === 'cover.png' ? 'landscape' : 'portrait'] };
  }));
  await fs.writeFile(priorQa, JSON.stringify({ createdAt: new Date().toISOString(), provider: providerName,
    headline, artwork: { landscape: landscapeArt, portrait: portraitArt }, covers,
    visualReview: { status: 'pending', reviewer: 'Codex', method: 'owner-delegated-automatic' } }, null, 2) + '\n');
  console.log(JSON.stringify({ provider: providerName, headline, covers }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
