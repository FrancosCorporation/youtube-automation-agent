import { bundle } from '@remotion/bundler';
import { openBrowser, selectComposition, renderStill, renderMedia, makeCancelSignal } from '@remotion/renderer';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { probeRenderHardwareGate } = require('../../../utils/render-timing.js');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || 'frames';
if (!['frames', 'bench', 'masters'].includes(mode)) throw new Error('Mode must be frames, bench or masters');
const aspect = process.argv[3] || 'both';
if (!['both', 'landscape', 'portrait'].includes(aspect)) throw new Error('Unknown aspect');
const output = path.join(project, 'renders/gps-v2-review');
await mkdir(output, { recursive: true });
const gate = probeRenderHardwareGate();
const stamp = new Date().toISOString().replace(/[^0-9TZ]/g, '');
await writeFile(path.join(output, `${mode}-${aspect}-gate-${stamp}.json`), JSON.stringify(gate, null, 2) + '\n');
if (!gate.renderSafe) throw new Error(`Host resource gate: ${gate.reasons.join(', ')}`);
console.log(JSON.stringify({ event: 'gate-pass', mode, aspect, load: gate.loadAverage[0], availableGiB: gate.availableMemoryBytes / 1024 ** 3 }));
const serveUrl = await bundle({ entryPoint: path.join(project, 'src/index.ts'), rootDir: project, outDir: path.join(output, 'bundle'), rspack: true, gitSource: null, askAIEnabled: false });
const chromiumOptions = { gl: 'swangle' };
const browser = await openBrowser('chrome', { chromiumOptions });
const report = { mode, aspect, startedAt: new Date().toISOString(), backend: 'Remotion 4.0.537 / Chrome Headless Shell / ANGLE SwiftShader / concurrency 1', gate, jobs: [], errors: [] };
const { cancel, cancelSignal } = makeCancelSignal();
let monitor;
try {
  monitor = setInterval(async () => {
    const mem = await readFile('/proc/meminfo', 'utf8');
    const available = Number(mem.match(/^MemAvailable:\s+(\d+)/m)?.[1] || 0) * 1024;
    if (available < 3 * 1024 ** 3) {
      report.errors.push(`Resource guard: available memory fell to ${(available / 1024 ** 3).toFixed(2)} GiB`);
      cancel();
    }
  }, 15000);
  for (const format of aspect === 'both' ? ['landscape', 'portrait'] : [aspect]) {
    const id = format === 'landscape' ? 'GpsExplainerV2Landscape' : 'GpsExplainerV2Portrait';
    const composition = await selectComposition({ serveUrl, id, puppeteerInstance: browser, chromiumOptions, timeoutInMilliseconds: 90000 });
    if (mode === 'frames') {
      const dir = path.join(output, format);
      await mkdir(dir, { recursive: true });
      for (const frame of [0, 115, 196, 290, 410, 510, 570, 650, 723, 810, 879]) {
        const begin = Date.now();
        const filename = path.join(dir, `frame-${String(frame).padStart(3, '0')}.png`);
        await renderStill({ composition, serveUrl, puppeteerInstance: browser, chromiumOptions, frame, imageFormat: 'png', output: filename, timeoutInMilliseconds: 90000, cancelSignal });
        const record = { id, frame, path: filename, elapsedSeconds: (Date.now() - begin) / 1000 };
        report.jobs.push(record);
        console.log(JSON.stringify(record));
      }
    } else {
      const jobs = mode === 'bench'
        ? [{ name: 'signal', frames: [160, 207] }, { name: 'sphere', frames: [382, 429] }, { name: 'clock', frames: [635, 682] }]
        : [{ name: 'master', frames: [0, composition.durationInFrames - 1] }];
      for (const job of jobs) {
        const filename = path.join(output, mode === 'masters' ? `gps-explainer-v2-${format}.mp4` : `bench-${format}-${job.name}.mp4`);
        const begin = Date.now();
        const record = { id, kind: job.name, width: composition.width, height: composition.height, fps: composition.fps, frames: job.frames, durationSeconds: (job.frames[1] - job.frames[0] + 1) / composition.fps, startedAt: new Date(begin).toISOString(), path: filename, status: 'rendering' };
        report.jobs.push(record);
        let last = 0;
        console.log(JSON.stringify({ event: 'render-start', ...record }));
        try {
          await renderMedia({ composition, serveUrl, puppeteerInstance: browser, chromiumOptions, outputLocation: filename, codec: 'h264', crf: 18, pixelFormat: 'yuv420p', audioCodec: 'aac', audioBitrate: '192k', concurrency: 1, imageFormat: 'jpeg', jpegQuality: 95, frameRange: job.frames, timeoutInMilliseconds: 90000, cancelSignal, onProgress: (progress) => {
            if (Date.now() - last > 20000 || progress.progress === 1) {
              last = Date.now();
              console.log(JSON.stringify({ id, kind: job.name, frames: progress.renderedFrames, progress: Number(progress.progress.toFixed(3)), elapsedSeconds: (Date.now() - begin) / 1000, estimatedSecondsLeft: progress.renderEstimatedTime / 1000 }));
            }
          } });
          record.status = 'completed';
        } catch (error) {
          record.status = 'failed';
          record.error = error.message;
          throw error;
        } finally {
          record.finishedAt = new Date().toISOString();
          record.elapsedSeconds = (Date.now() - begin) / 1000;
          record.renderSecondsPerVideoSecond = record.elapsedSeconds / record.durationSeconds;
          await writeFile(path.join(output, `${mode}-${aspect}-${stamp}.json`), JSON.stringify(report, null, 2) + '\n');
        }
        console.log(JSON.stringify({ event: 'render-complete', ...record }));
      }
    }
  }
} catch (error) {
  report.errors.push(error.message);
  throw error;
} finally {
  clearInterval(monitor);
  await browser.close({ silent: true });
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, `${mode}-${aspect}-${stamp}.json`), JSON.stringify(report, null, 2) + '\n');
}
