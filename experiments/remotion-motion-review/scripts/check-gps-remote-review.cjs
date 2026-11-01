const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const previewUrl = 'https://francoscorporation.ddns.net/remotion-review/previews/gps-explainer-20261023-v1/';
const studioUrl = 'https://francoscorporation.ddns.net/remotion-review/?/GpsExplainerReview';
const localVideo = path.join(root, 'renders/gps-explainer-20261023-v1.mp4');

(async () => {
  const localHash = createHash('sha256').update(await fs.readFile(localVideo)).digest('hex');
  const remoteBuffer = Buffer.from(await (await fetch(`${previewUrl}video.mp4`)).arrayBuffer());
  const remoteHash = createHash('sha256').update(remoteBuffer).digest('hex');
  assert.equal(remoteHash, localHash, 'Published preview MP4 must match the local master');

  const rangeResponse = await fetch(`${previewUrl}video.mp4`, { headers: { range: 'bytes=0-1023' } });
  assert.equal(rangeResponse.status, 206, 'MP4 must support byte-range requests');
  assert.match(rangeResponse.headers.get('content-range') || '', /^bytes 0-1023\//);
  await rangeResponse.arrayBuffer();

  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    const errors = [];
    const failed = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) failed.push({ status: response.status(), url: response.url() });
    });

    await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 60000 });
    const video = page.locator('video');
    await video.waitFor();
    const metadata = await video.evaluate((element) => new Promise((resolve, reject) => {
      if (element.readyState >= 1) return resolve({
        duration: element.duration,
        width: element.videoWidth,
        height: element.videoHeight,
      });
      element.addEventListener('loadedmetadata', () => resolve({
        duration: element.duration,
        width: element.videoWidth,
        height: element.videoHeight,
      }), { once: true });
      element.addEventListener('error', () => reject(new Error('Video metadata failed to load')), { once: true });
    }));
    assert.equal(metadata.width, 1080);
    assert.equal(metadata.height, 1920);
    assert.ok(metadata.duration > 37 && metadata.duration < 38);

    await video.evaluate(async (element) => {
      element.muted = true;
      await element.play();
    });
    await page.waitForFunction(() => document.querySelector('video')?.currentTime >= 1.5, { timeout: 15000 });
    const playedSeconds = await video.evaluate((element) => {
      element.pause();
      element.muted = false;
      return element.currentTime;
    });
    assert.ok(playedSeconds >= 1.5, 'Preview video must advance during playback');
    await page.screenshot({ path: path.join(root, 'renders/remote-gps-preview-review.png'), fullPage: true });

    await page.goto(studioUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => {
      const frame = document.querySelector('#studio');
      try {
        return Boolean(frame?.contentWindow?.document?.querySelector('#__remotion-studio-container'));
      } catch {
        return false;
      }
    }, { timeout: 45000 });
    const studio = page.frames().find((frame) => frame.url().includes('/games/play/remotion-review/releases/'));
    assert.ok(studio, 'Remotion Studio must load from its static published release');
    await studio.waitForFunction(() => document.body.innerText.includes('GpsExplainerReview'), { timeout: 45000 });
    await studio.waitForFunction(() => typeof window.remotion_setFrame === 'function' && window.remotion_renderReady, { timeout: 45000 });
    assert.equal(await studio.evaluate(() => window.remotion_isReadOnlyStudio), true);
    await studio.evaluate(() => window.remotion_setFrame(570, 'GpsExplainerReview', 1));
    await studio.waitForFunction(() => window.remotion_renderReady, { timeout: 15000 });
    await page.screenshot({ path: path.join(root, 'renders/remote-gps-studio-review.png'), fullPage: false });

    assert.deepEqual(errors, [], 'Browser must not report uncaught page errors');
    assert.deepEqual(failed, [], 'Published pages/assets must not return HTTP errors');
    const report = {
      previewUrl,
      studioUrl,
      localSha256: localHash,
      remoteSha256: remoteHash,
      rangeStatus: rangeResponse.status,
      rangeContentRange: rangeResponse.headers.get('content-range'),
      metadata,
      playedSeconds,
      selectedStudioComposition: 'GpsExplainerReview',
      studioFrame: 570,
      errors,
      failed,
      checkedAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(root, 'renders/remote-gps-review-qa.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
