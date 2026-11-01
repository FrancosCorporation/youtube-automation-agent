const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../renders/gps-v2-review');
const finalMasters = process.argv[2] === 'masters';
(async () => {
  const dir = path.join(root, finalMasters ? 'motion-final' : 'motion');
  await fs.mkdir(dir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const report = { checkedAt: new Date().toISOString(), method: 'Actual Chrome video playback, paused for sequential visual samples; no seeks between samples', clips: [], errors: [] };
  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => report.errors.push(err.message));
    for (const aspect of ['landscape', 'portrait']) {
      await page.setViewportSize(aspect === 'landscape' ? { width: 960, height: 540 } : { width: 540, height: 960 });
      for (const shot of ['signal', 'sphere', 'clock']) {
        const filename = finalMasters ? `gps-explainer-v2-${aspect}.mp4` : `bench-${aspect}-${shot}.mp4`;
        const start = finalMasters ? { signal: 160 / 24, sphere: 382 / 24, clock: 635 / 24 }[shot] : 0;
        const data = await fs.readFile(path.join(root, filename));
        await page.setContent(`<style>body{margin:0;background:#081922}video{display:block;width:100vw;height:100vh}</style><video muted playsinline src="data:video/mp4;base64,${data.toString('base64')}"></video>`);
        const video = page.locator('video');
        await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
        if (start) {
          await video.evaluate((v, time) => new Promise((resolve) => { v.addEventListener('seeked', resolve, { once: true }); v.currentTime = time; }), start);
        }
        await video.evaluate((v) => { v.playbackRate = .5; });
        const samples = [];
        for (const target of [.05, .65, 1.25, 1.85]) {
          await video.evaluate((v) => v.play());
          await page.waitForFunction((target) => document.querySelector('video').currentTime >= target, start + target, { timeout: 10000 });
          const state = await video.evaluate((v) => { v.pause(); return { time: v.currentTime, width: v.videoWidth, height: v.videoHeight, duration: v.duration, dropped: v.getVideoPlaybackQuality().droppedVideoFrames }; });
          const screenshot = path.join(dir, `${aspect}-${shot}-${samples.length}.png`);
          await video.screenshot({ path: screenshot });
          samples.push({ ...state, screenshot });
        }
        assert.ok(samples[3].time >= start + 1.85);
        assert.ok(samples.every((s, i) => i === 0 || s.time > samples[i - 1].time));
        report.clips.push({ aspect, shot, filename, start, samples, playbackPassed: true });
        console.log(JSON.stringify({ aspect, shot, playbackPassed: true }));
      }
    }
    assert.deepEqual(report.errors, []);
    await fs.writeFile(path.join(dir, 'qa.json'), JSON.stringify(report, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
