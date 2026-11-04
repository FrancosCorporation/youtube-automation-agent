'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { publishXOnPage } = require('../utils/x-android-publisher');

test('X composer reads real textarea and contenteditable text, preserving existing drafts', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'x-composer-dom-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const videoPath = path.join(dir, 'fixture.mp4');
  await fs.writeFile(videoPath, 'local upload fixture');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  // No external navigation or publication: the complete composer runs in HTML
  // on about:blank; identity and post discovery are independent injected seams.
  await page.route('**/*', route => route.abort());
  const localPage = new Proxy(page, { get(target, key) {
    if (key === 'goto') return async () => {};
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  for (const tag of ['textarea', 'div']) for (const draft of [false, true]) {
    await page.setContent(`<${tag} data-testid="tweetTextarea_0" ${tag === 'div' ? 'contenteditable="true" style="white-space:pre-wrap"' : ''}></${tag}>
      <input data-testid="fileInput" type="file"><video></video><button data-testid="tweetButton">Post</button>`);
    await page.evaluate(() => {
      window.postClicks = 0;
      document.querySelector('button').onclick = () => { window.postClicks++; };
    });
    const editor = page.getByTestId('tweetTextarea_0');
    if (draft) await editor.fill('Rascunho existente\nNão sobrescrever');
    const before = await editor.evaluate(node => node.outerHTML);
    const caption = 'Explicação em português\n\nFonte: https://example.com/noticia';
    const result = await publishXOnPage({ page: localPage, videoPath, caption, accountHandle: '@approved',
      inspect: async () => ({ status: 'logged_in', accountHandle: '@approved' }), findPost: async () => null });
    assert.equal(result.status, draft ? 'failed' : 'submitted', `${tag}, draft=${draft}`);
    assert.equal(await page.evaluate(() => window.postClicks), draft ? 0 : 1);
    const text = await editor.evaluate(node => node.tagName === 'TEXTAREA' ? node.value : node.innerText);
    assert.equal(text.replace(/\s+/g, ' '),
      (draft ? 'Rascunho existente\nNão sobrescrever' : caption).replace(/\s+/g, ' '));
    if (draft) assert.equal(await editor.evaluate(node => node.outerHTML), before);
    assert.equal(await page.getByTestId('fileInput').evaluate(node => node.files.length), draft ? 0 : 1);
  }
});
