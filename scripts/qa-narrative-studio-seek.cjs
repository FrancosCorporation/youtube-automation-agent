#!/usr/bin/env node

const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const { chromium } = require('playwright');
const sharp = require('sharp');

const port = process.argv[2] || process.env.NARRATIVE_STUDIO_PORT || '3188';
const outputPath = path.resolve(process.argv[3] || process.env.NARRATIVE_SEEK_OUTPUT || `docs/evidencias/narrative-studio-seek-${new Date().toISOString().slice(0, 10)}-${port}.json`);
const frames = (process.env.NARRATIVE_SEEK_FRAMES || '1810,1990,2080,2200,2280,2400,2500')
  .split(',').map(value => Number(value.trim())).filter(Number.isInteger);
const maxChangedPixels = Number(process.env.NARRATIVE_SEEK_MAX_CHANGED_PIXELS || 100);
const maxChannelDelta = Number(process.env.NARRATIVE_SEEK_MAX_CHANNEL_DELTA || 8);
const maxRmse = Number(process.env.NARRATIVE_SEEK_MAX_RMSE || 0.002);

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

async function decodePng(bytes) {
  return sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function comparePixels(left, right) {
  if (left.info.width !== right.info.width || left.info.height !== right.info.height) {
    return { changedPixels: Number.POSITIVE_INFINITY, changedRatio: 1, maxChannelDelta: 255, rmse: 1, sameDimensions: false };
  }
  let changedPixels = 0;
  let maxDelta = 0;
  let squaredError = 0;
  for (let index = 0; index < left.data.length; index += 4) {
    let changed = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(left.data[index + channel] - right.data[index + channel]);
      maxDelta = Math.max(maxDelta, delta);
      squaredError += delta * delta;
      if (delta > maxChannelDelta) changed = true;
    }
    if (changed) changedPixels += 1;
  }
  const pixelCount = left.info.width * left.info.height;
  return {
    changedPixels,
    changedRatio: changedPixels / pixelCount,
    maxChannelDelta: maxDelta,
    rmse: Math.sqrt(squaredError / left.data.length) / 255,
    sameDimensions: true,
  };
}

async function captureStablePair(target) {
  await new Promise(resolve => setTimeout(resolve, 600));
  const firstBytes = await target.screenshot({ animations: 'disabled' });
  await new Promise(resolve => setTimeout(resolve, 500));
  const secondBytes = await target.screenshot({ animations: 'disabled' });
  return {
    first: await decodePng(firstBytes),
    second: await decodePng(secondBytes),
    firstSha256: sha256(firstBytes),
    secondSha256: sha256(secondBytes),
  };
}

function pixelPasses(comparison) {
  return comparison.sameDimensions
    && comparison.changedPixels <= maxChangedPixels
    && comparison.maxChannelDelta <= maxChannelDelta
    && comparison.rmse <= maxRmse;
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    url: `http://127.0.0.1:${port}/NarrativeEpisode`,
    port,
    frames,
    tolerances: { maxChangedPixels, maxChannelDelta, maxRmse },
    results: [],
    errors,
  };

  try {
    await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => typeof window.remotion_setFrame === 'function', { timeout: 90000 });
    const target = page.locator('[data-qa="narrative-episode-scene"]');

    for (const frame of frames) {
      const passes = [];
      const decodedPasses = [];
      for (let pass = 0; pass < 2; pass += 1) {
        if (pass === 1) {
          // Exercise a real scene change before returning to the target frame.
          // Repeating setFrame(target) cannot detect a stale Three.js camera.
          const otherFrame = frame === 0 ? Math.max(...frames) : 0;
          await page.evaluate(value => window.remotion_setFrame(value, 'NarrativeEpisode', 0), otherFrame);
          await page.waitForFunction(value => Boolean(document.querySelector(`button[aria-label="${value}"]`)), otherFrame, { timeout: 90000 });
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        await page.evaluate(value => window.remotion_setFrame(value, 'NarrativeEpisode', 0), frame);
        await page.waitForFunction(() => window.remotion_renderReady === true, { timeout: 90000 });
        await page.waitForFunction(value => Boolean(document.querySelector(`button[aria-label="${value}"]`)), frame, { timeout: 90000 });
        await target.waitFor({ state: 'visible', timeout: 90000 });
        const semantic = await target.evaluate((node, expectedFrame) => ({
          cue: node.querySelector('[data-qa="adaptive-illustration"], [data-qa="directed-narrative-scene"], [data-qa="narrative-stage"]')?.getAttribute('data-cue') || null,
          shot: node.querySelector('[data-qa="adaptive-illustration"]')?.getAttribute('data-dimension') || node.querySelector('[data-qa="narrative-stage"]')?.getAttribute('data-shot') || null,
          text: node.innerText,
          selectedFrame: [...document.querySelectorAll('button[aria-label]')]
            .map(button => button.getAttribute('aria-label'))
            .find(label => label === String(expectedFrame)) || null,
        }), frame);
        const pair = await captureStablePair(target);
        decodedPasses.push(pair.second);
        passes.push({
          pass,
          semantic,
          firstSha256: pair.firstSha256,
          secondSha256: pair.secondSha256,
          intraPass: comparePixels(pair.first, pair.second),
        });
      }
      const intraPasses = passes.map(item => pixelPasses(item.intraPass));
      const crossComparison = comparePixels(decodedPasses[0], decodedPasses[1]);
      const semanticsMatch = passes[0].semantic.cue === passes[1].semantic.cue
        && passes[0].semantic.shot === passes[1].semantic.shot
        && passes[0].semantic.text === passes[1].semantic.text
        && passes[0].semantic.selectedFrame === passes[1].semantic.selectedFrame;
      report.results.push({ frame, passes, crossPass: { comparison: crossComparison, passes: pixelPasses(crossComparison) }, semanticsMatch, intraPasses });
    }
  } finally {
    report.errors = errors;
    report.status = errors.length === 0 && report.results.every(item => item.semanticsMatch && item.intraPasses.every(Boolean) && item.crossPass.passes) ? 'pass' : 'fail';
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
    await browser.close();
  }
  console.log(JSON.stringify(process.env.NARRATIVE_SEEK_SUMMARY_ONLY === '1'
    ? { status: report.status, frames: report.frames, failures: report.results.filter(item => !item.semanticsMatch || !item.intraPasses.every(Boolean) || !item.crossPass.passes), errors: report.errors }
    : report, null, 2));
  if (report.status !== 'pass') process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
