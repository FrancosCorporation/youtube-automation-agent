const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { runFFmpeg } = require('../utils/ffmpeg');
const { preserveInstagramVideoFrame, inspectInstagramVideoFrame, assertInstagramVideoFrame } = require('../utils/instagram-video-framing');

(async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'instagram-framing-'));
  let browser;
  try {
    const media = path.join(work, 'vertical.mp4');
    await runFFmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=360x640:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', media]);
    const src = `data:video/mp4;base64,${(await fs.readFile(media)).toString('base64')}`;
    browser = await chromium.launch({ headless: true });
    for (const label of ['Selecionar corte', 'Select crop']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.setContent(`<div role="dialog"><button>Original</button>Ativar notificações</div>
        <video style="display:none"></video>
        <div role="dialog" style="position:absolute;left:300px;top:130px">
          <div id="viewport" style="width:320px;height:320px;overflow:hidden;position:relative">
            <video id="clip" src="${src}" muted autoplay loop
              style="position:absolute;left:0;top:-124.444px;width:320px;height:568.888px;object-fit:cover"></video>
          </div>
          <button id="crop" onclick="menu.hidden=!menu.hidden"><svg aria-label="${label}"></svg></button>
          <div id="menu" hidden><span role="button" onclick="clip.style.cssText='width:180px;height:320px;object-fit:cover'">Original</span></div>
          <button onclick="window.shared=true">Compartilhar</button>
        </div>`);
      await page.waitForFunction(() => document.getElementById('clip').videoWidth === 360);
      const before = await inspectInstagramVideoFrame(page);
      assert.equal(before.fullFrame, false, 'square crop must be rejected');
      assert(Math.abs(before.visibleFraction - 9 / 16) < 0.01);
      const fixed = await preserveInstagramVideoFrame(page);
      assert.equal(fixed.selection, 'Original');
      assert.equal(fixed.fullFrame, true);
      assert(fixed.visibleFraction > 0.99);
      assert.equal(await page.locator('#menu').isVisible(), false);
      assert.equal(await page.evaluate(() => !!window.shared), false, 'framing must never publish');
      // An edit screen can introduce an additional crop after the first Next.
      await page.evaluate(() => { document.getElementById('viewport').style.height = '180px'; });
      await assert.rejects(assertInstagramVideoFrame(page, { timeoutMs: 0 }), /enquadramento cortado/);
      await page.close();
    }
    const page = await browser.newPage();
    await page.setContent(`<div role="dialog"><video id="clip" src="${src}" muted autoplay
      style="width:320px;height:320px;object-fit:cover"></video></div>`);
    await page.waitForFunction(() => document.getElementById('clip').videoWidth > 0);
    assert.equal((await inspectInstagramVideoFrame(page)).fullFrame, false, 'object-fit cover crop must be rejected');
    await assert.rejects(assertInstagramVideoFrame(page, { timeoutMs: 0 }), /enquadramento cortado/);
    await page.evaluate(() => { document.getElementById('clip').style.objectFit = 'fill'; });
    assert.equal((await inspectInstagramVideoFrame(page)).fullFrame, false, 'stretched video must be rejected');
    await page.evaluate(() => { document.getElementById('clip').style.objectFit = 'contain'; });
    assert.equal((await preserveInstagramVideoFrame(page)).fullFrame, true, 'full frame without crop control is valid');
    await page.close();
    console.log('Instagram framing: PT/EN crop corrected; later crop, cover and distortion rejected; no sharing.');
  } finally {
    if (browser) await browser.close();
    await fs.rm(work, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
