const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../renders/gps-v2-review');
const url = 'https://francoscorporation.ddns.net/remotion-review/previews/gps-explainer-20261023-v2/';
const studioUrl = 'https://francoscorporation.ddns.net/remotion-review/';
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
(async () => {
  const tech = JSON.parse(await fs.readFile(path.join(root, 'technical-qa.json')));
  const report = { previewUrl: url, checkedAt: new Date().toISOString(), videos: [], browser: [], studios: [], errors: [], httpFailures: [] };
  for (const master of tech.masters) {
    const response = await fetch(`${url}${master.aspect}.mp4`, { signal: AbortSignal.timeout(60000) });
    assert.equal(response.status, 200);
    const remoteSha256 = sha(Buffer.from(await response.arrayBuffer()));
    assert.equal(remoteSha256, master.sha256);
    const range = await fetch(`${url}${master.aspect}.mp4`, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(20000) });
    await range.arrayBuffer(); assert.equal(range.status, 206);
    report.videos.push({ aspect: master.aspect, localSha256: master.sha256, remoteSha256, rangeStatus: range.status, contentRange: range.headers.get('content-range') });
  }
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.on('pageerror', (error) => report.errors.push(error.message));
    page.on('response', (response) => { if (response.status() >= 400) report.httpFailures.push({ status: response.status(), url: response.url() }); });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    for (const aspect of ['landscape', 'portrait']) {
      await page.locator(`#${aspect}`).click();
      await page.waitForFunction((aspect) => { const v = document.querySelector('video'); return v.readyState >= 1 && v.currentSrc.endsWith(`${aspect}.mp4`) && v.videoWidth === (aspect === 'landscape' ? 1920 : 1080); }, aspect);
      const before = await page.locator('video').evaluate((v) => { v.muted = true; return v.currentTime; });
      await page.locator('video').evaluate((v) => v.play());
      await page.waitForFunction((before) => document.querySelector('video').currentTime >= before + 1.5, before, { timeout: 15000 });
      const state = await page.locator('video').evaluate((v) => { v.pause(); return { currentTime: v.currentTime, width: v.videoWidth, height: v.videoHeight, duration: v.duration, muted: v.muted }; });
      assert.equal(state.width, aspect === 'landscape' ? 1920 : 1080);
      assert.equal(state.height, aspect === 'landscape' ? 1080 : 1920);
      assert.ok(state.duration > 37 && state.duration < 38);
      assert.match(await page.locator('#download').getAttribute('href'), new RegExp(`${aspect}\\.mp4$`));
      assert.equal(await page.locator(`#${aspect}`).getAttribute('aria-pressed'), 'true');
      await page.screenshot({ path: path.join(root, `remote-player-${aspect}.png`), fullPage: true });
      report.browser.push({ aspect, ...state, playedAtLeastSeconds: 1.5 });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${url}#vertical`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('video').videoHeight === 1920);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Mobile page must not overflow horizontally');
    await page.screenshot({ path: path.join(root, 'remote-player-mobile.png'), fullPage: true });
    report.mobile = { width: 390, height: 844, horizontalOverflow: false, portraitDeepLink: true };
    await page.setViewportSize({ width: 1440, height: 1100 });
    for (const id of ['GpsExplainerV2Landscape', 'GpsExplainerV2Portrait']) {
      await page.goto(`${studioUrl}?/${id}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForFunction(() => { try { return Boolean(document.querySelector('#studio')?.contentWindow?.document.querySelector('[data-qa="gps-composition"]')); } catch { return false; } }, undefined, { timeout: 90000 });
      const studio = page.frames().find((f) => f.url().includes('/games/play/remotion-review/releases/'));
      assert.ok(studio);
      await studio.waitForFunction(() => window.remotion_renderReady, undefined, { timeout: 90000 });
      assert.equal(await studio.evaluate(() => window.remotion_isReadOnlyStudio), true);
      await studio.evaluate((id) => window.remotion_setFrame(650, id, 1), id);
      await studio.waitForFunction(() => window.remotion_renderReady);
      await studio.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(root, `remote-studio-${id}.png`) });
      report.studios.push({ id, frame: 650, readOnly: true, releaseUrl: studio.url() });
    }
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.httpFailures, []);
    report.status = 'pass';
    await fs.writeFile(path.join(root, 'remote-qa.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
