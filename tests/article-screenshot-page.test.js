'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { articleScreenshotBlocked, prepareArticleScreenshotPage } = require('../utils/article-screenshot-page');

test('access verification and CAPTCHA pages cannot become article evidence', async () => {
  assert.equal(articleScreenshotBlocked({ title: 'Just a moment...' }), true);
  assert.equal(articleScreenshotBlocked({ text: 'Performing security verification. Verify you are human.' }), true);
  assert.equal(articleScreenshotBlocked({ title: 'A reportagem', text: 'Informações publicadas pelo veículo.' }), false);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent('<title>Just a moment...</title><h1>Verify you are human</h1>');
    await assert.rejects(prepareArticleScreenshotPage(page), { code: 'ARTICLE_SCREENSHOT_ACCESS_BLOCKED' });
    assert.equal(await page.locator('h1').innerText(), 'Verify you are human');
  } finally { await browser.close(); }
});

test('capture preserves the complete heading and date while omitting a fixed cookie overlay', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent('<title>Uma reportagem verificável</title><div id="cookie" style="position:fixed;inset:0;z-index:9">Cookies e política de privacidade</div><article style="margin:1100px 0 0 70px;width:740px"><h1>Uma reportagem verificável com contexto completo</h1><p id="date">17 de outubro de 2026</p><div style="height:1400px"></div></article>');
    const result = await prepareArticleScreenshotPage(page);
    assert.equal(await page.locator('#cookie').count(), 0);
    assert.equal(await page.locator('#date').innerText(), '17 de outubro de 2026');
    assert.equal(result.headingText, 'Uma reportagem verificável com contexto completo');
    assert(result.readingWords >= 6);
    const bounds = await page.locator('h1').boundingBox();
    assert(bounds.y >= 0 && bounds.y < 200);
    assert(result.clip.width >= 720 && result.clip.x >= 0);
  } finally { await browser.close(); }
});
