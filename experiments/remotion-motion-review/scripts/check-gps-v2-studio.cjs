const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const output = path.resolve(__dirname, '../renders/gps-v2-review/studio');
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const errors = [];
  const report = { checkedAt: new Date().toISOString(), compositions: [], errors };
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
    page.on('pageerror', (error) => errors.push(error.message));
    for (const id of ['GpsExplainerV2Landscape', 'GpsExplainerV2Portrait']) {
      await page.goto(`http://localhost:3000/${id}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForFunction(() => typeof window.remotion_setFrame === 'function' && window.remotion_renderReady, undefined, { timeout: 90000 });
      const composition = page.locator('[data-qa="gps-composition"]');
      await composition.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const frames = [];
      for (const frame of [0, 160, 196, 220, 410, 510, 570, 650, 723, 810, 879, 196]) {
        await page.evaluate(({ frame, id }) => window.remotion_setFrame(frame, id, 1), { frame, id });
        await page.waitForFunction(() => window.remotion_renderReady);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const screenshot = await composition.screenshot();
        const sha256 = hash(screenshot);
        const file = path.join(output, `${id}-${frame}-${frames.length}.png`);
        await fs.writeFile(file, screenshot);
        const layout = await composition.evaluate((root) => {
          const rect = root.getBoundingClientRect();
          const keys = ['title', 'caption', 'note'];
          return keys.flatMap((key) => [...root.querySelectorAll(`[data-qa="${key}"]`)].map((element) => {
            const b = element.getBoundingClientRect();
            return { key, inside: b.left >= rect.left - 1 && b.top >= rect.top - 1 && b.right <= rect.right + 1 && b.bottom <= rect.bottom + 1, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, overflow: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1 };
          }));
        });
        assert.ok(layout.every((item) => item.inside && !item.overflow), `Text overflow at ${id}/${frame}: ${JSON.stringify(layout)}`);
        frames.push({ frame, sha256, layout, file });
      }
      const first = frames.find((q) => q.frame === 196);
      const last = frames[frames.length - 1];
      assert.equal(first.sha256, last.sha256, `${id} must be pixel-identical after a backward seek`);
      assert.notEqual(frames.find((q) => q.frame === 160).sha256, first.sha256);
      assert.notEqual(first.sha256, frames.find((q) => q.frame === 220).sha256);
      report.compositions.push({ id, backwardSeekIdentical: true, frames });
      console.log(JSON.stringify({ id, checkedFrames: frames.length, backwardSeekIdentical: true }));
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'qa.json'), JSON.stringify(report, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
