'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { publishXOnPage, readXComposerState } = require('../utils/x-android-publisher');

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
      <div role="progressbar" aria-valuemax="100" aria-valuenow="0"><div data-testid="progressBar-bar"></div></div>
      <div data-testid="countdown-circle"><div role="progressbar" aria-valuenow="75" aria-valuemax="100">characters</div></div>
      <input data-testid="fileInput" type="file"><video></video><button data-testid="tweetButton">Post</button>`);
    await page.evaluate(() => {
      window.postClicks = 0;
      document.querySelector('button').onclick = () => { window.postClicks++; };
    });
    const editor = page.getByTestId('tweetTextarea_0');
    if (draft) await editor.fill('Rascunho existente\nNão sobrescrever');
    const before = await editor.evaluate(node => node.outerHTML);
    const caption = 'Explicação sobre uploading: processando vídeo\n\nFonte: https://example.com/noticia';
    const result = await publishXOnPage({ page: localPage, videoPath, caption, accountHandle: '@approved',
      inspect: async () => ({ status: 'logged_in', accountHandle: '@approved' }), findPost: async () => null });
    if (draft) assert.equal(result.failureCode, 'x_existing_draft_failed');
    assert.equal(result.status, draft ? 'failed' : 'submitted', `${tag}, draft=${draft}`);
    assert.equal(await page.evaluate(() => window.postClicks), draft ? 0 : 1);
    const text = await editor.evaluate(node => node.tagName === 'TEXTAREA' ? node.value : node.innerText);
    assert.equal(text.replace(/\s+/g, ' '),
      (draft ? 'Rascunho existente\nNão sobrescrever' : caption).replace(/\s+/g, ' '));
    if (draft) assert.equal(await editor.evaluate(node => node.outerHTML), before);
    assert.equal(await page.getByTestId('fileInput').evaluate(node => node.files.length), draft ? 0 : 1);
  }
});


test('composer waits for active media progress, ignores character counter and idle header', async t => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<textarea data-testid="tweetTextarea_0">upload failed processando vídeo</textarea>
    <script type="application/json">{"message":"upload failed"}</script>
    <video></video><button data-testid="tweetButton">Post</button>
    <div role="progressbar" aria-valuenow="0" aria-valuemax="100"><div data-testid="progressBar-bar"></div></div>
    <div data-testid="countdown-circle"><div role="progressbar" aria-valuenow="75" aria-valuemax="100">75%</div></div>
    <div data-testid="attachments"><div id="media-progress" role="progressbar" style="height:3px" aria-valuenow="0" aria-valuemax="100"></div></div>`);
  assert.equal((await readXComposerState(page)).pending, true);
  await page.locator('#media-progress').evaluate(n => n.setAttribute('aria-valuenow', '100'));
  const ready = await readXComposerState(page);
  assert.equal(ready.pending, false);
  assert.equal(ready.button, true);
  assert.doesNotMatch(ready.text, /upload failed|processando/);
  await page.locator('#media-progress').evaluate(n => n.removeAttribute('aria-valuenow'));
  assert.equal((await readXComposerState(page)).pending, true);
  await page.locator('#media-progress').evaluate(n => { n.style.display = 'none'; });
  assert.equal((await readXComposerState(page)).pending, false);
  await page.getByTestId('tweetButton').evaluate(n => { n.disabled = true; });
  assert.equal((await readXComposerState(page)).button, false);
});
