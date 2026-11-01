const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const timeline = require('../public/ia-answer-20261023/timeline.json');
const revisionsOnly = process.argv.includes('--revisions');
const output = path.resolve(__dirname, '../renders/ia-answer-20261023/studio');
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const report = { checkedAt: new Date().toISOString(), sourceSha256: hash(await fs.readFile(path.resolve(__dirname, '../src/AiAnswerExplainer.tsx'))), scope: revisionsOnly ? 'changed-scenes' : 'all-scenes', compositions: [], errors: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1300 } });
    page.on('pageerror', (error) => report.errors.push(error.message));
    for (const id of ['AiAnswerExplainerLandscape', 'AiAnswerExplainerPortrait']) {
      await page.goto(`http://localhost:3000/${id}`, { waitUntil: 'networkidle', timeout: 90000 });
      await page.waitForFunction(() => typeof window.remotion_setFrame === 'function' && window.remotion_renderReady, undefined, { timeout: 90000 });
      const composition = page.locator('[data-qa="ai-composition"]');
      await composition.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const samples = timeline.chapters.flatMap((chapter) => (revisionsOnly ? ({ 0: [0, 1, 2], 1: [0, 1, 2, 5, 9], 3: [5], 4: [7] }[chapter.index] || []) : [0, 2, 5, 7, 9]).map((beat) => ({ frame: Math.min(chapter.startFrame + chapter.durationFrames - 1, chapter.startFrame + Math.round((chapter.sentences[beat].startSeconds + 1.5) * 24)), chapter: chapter.index, beat })));
      samples.push({ ...samples[7], repeat: true });
      const frames = [];
      for (const sample of samples) {
        await page.evaluate(({ frame, id }) => window.remotion_setFrame(frame, id, 1), { frame: sample.frame, id });
        await page.waitForFunction(() => window.remotion_renderReady);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const screenshot = await composition.screenshot();
        const sha256 = hash(screenshot);
        const file = path.join(output, revisionsOnly ? `revision-${id}-chapter${sample.chapter + 1}-beat${sample.beat}-${sample.repeat ? 'repeat' : sample.frame}.png` : `${id}-chapter${sample.chapter + 1}-beat${sample.beat}-${sample.repeat ? 'repeat' : sample.frame}.png`);
        await fs.writeFile(file, screenshot);
        const layout = await composition.evaluate((root) => {
          const rect = root.getBoundingClientRect();
          return ['title', 'caption', 'note'].flatMap((key) => [...root.querySelectorAll(`[data-qa="${key}"]`)].map((element) => {
            const b = element.getBoundingClientRect();
            return { key, inside: b.left >= rect.left - 1 && b.top >= rect.top - 1 && b.right <= rect.right + 1 && b.bottom <= rect.bottom + 1, overflow: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1 };
          }));
        });
        assert.ok(layout.every(item => item.inside && !item.overflow), `Text overflow ${id}/${sample.frame}: ${JSON.stringify(layout)}`);
        frames.push({ ...sample, sha256, layout, file });
        console.log(JSON.stringify({ id, chapter: sample.chapter + 1, beat: sample.beat, frame: sample.frame }));
      }
      assert.equal(frames[7].sha256, frames[frames.length - 1].sha256, 'Backward seek must reproduce the same pixels');
      report.compositions.push({ id, status: 'pass', backwardSeekPixelIdentical: true, frames });
    }
    assert.deepEqual(report.errors, []);
    report.status = 'pass';
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, revisionsOnly ? 'qa-revisions.json' : 'qa.json'), JSON.stringify(report, null, 2) + '\n');
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
