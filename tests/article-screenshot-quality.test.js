'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const test = require('node:test');
const { assessArticleScreenshot } = require('../utils/article-screenshot-quality');

test('rejeita captura vazia com ícone isolado mesmo quando o arquivo é grande', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'article-print-blank-'));
  const blank = path.join(directory, 'blank.png');
  try {
    const svg = Buffer.from('<svg width="1280" height="820"><rect width="1280" height="820" fill="#0e0e0e"/><rect x="631" y="402" width="16" height="16" fill="#4285ff"/></svg>');
    await sharp(svg).png({ compressionLevel: 0 }).toFile(blank);
    assert.ok((await fs.stat(blank)).size > 10 * 1024);
    const result = await assessArticleScreenshot(blank);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'insufficient-page-content');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('aceita captura editorial com manchete, linhas de texto e imagem contextual', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'article-print-content-'));
  const valid = path.join(directory, 'article.png');
  try {
    const lines = Array.from({ length: 14 }, (_, index) => {
      const y = 170 + index * 34;
      const width = 360 + ((index * 173) % 520);
      return `<rect x="150" y="${y}" width="${width}" height="12" rx="3" fill="#34383a"/>`;
    }).join('');
    const svg = Buffer.from(`<svg width="1280" height="820"><rect width="1280" height="820" fill="#e7ecea"/><rect x="150" y="60" width="380" height="24" fill="#647a70"/><rect x="150" y="112" width="960" height="28" fill="#171b19"/><rect x="150" y="148" width="740" height="28" fill="#171b19"/>${lines}<rect x="760" y="650" width="350" height="90" fill="#9db4aa"/></svg>`);
    await sharp(svg).png({ compressionLevel: 0 }).toFile(valid);
    const result = await assessArticleScreenshot(valid);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.width, 1280);
    assert.equal(result.height, 820);
    assert.ok(result.detailCoverage >= 0.005);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
