import { bundle } from '@remotion/bundler';
import { openBrowser, selectComposition, renderStill, renderMedia, makeCancelSignal } from '@remotion/renderer';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { probeRenderHardwareGate } = require('../../../utils/render-timing.js');
const { acquireProcessFileLock } = require('../../../utils/process-file-lock.js');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || 'frames';
if (!['frames', 'bench', 'masters'].includes(mode)) throw new Error('Mode must be frames, bench or masters');
const aspect = process.argv[3] || 'both';
if (!['both', 'landscape', 'portrait'].includes(aspect)) throw new Error('Unknown aspect');
const output = path.join(project, 'renders/ia-answer-20261023');
const timeline = JSON.parse(await readFile(path.join(project, 'public/ia-answer-20261023/timeline.json'), 'utf8'));
const concurrency = 2;
const gl = process.env.PULSO_REMOTION_GL || 'swangle';
if (!['swangle', 'angle-egl'].includes(gl)) throw new Error('Unsupported renderer');
const chromeMode = gl === 'angle-egl' ? 'chrome-for-testing' : 'headless-shell';
const benchmarkSuffix = gl === 'swangle' ? '' : '-gpu';
await mkdir(output, { recursive: true });
const release = await acquireProcessFileLock({ lockPath: path.join(output, 'render.lock'), owner: 'ia-answer-render', timeoutMs: 1000 });
try {
let gate = probeRenderHardwareGate();
while (!gate.renderSafe && process.argv.includes('--wait')) {
  await writeFile(path.join(output, 'latest-gate.json'), JSON.stringify(gate, null, 2) + '\n');
  console.log(JSON.stringify({ event: 'gate-wait', reasons: gate.reasons, load: gate.loadAverage[0], availableGiB: gate.availableMemoryBytes / 1024 ** 3 }));
  await new Promise(resolve => setTimeout(resolve, 30000));
  gate = probeRenderHardwareGate();
}
const stamp = new Date().toISOString().replace(/[^0-9TZ]/g, '');
await writeFile(path.join(output, `${mode}-${aspect}-gate-${stamp}.json`), JSON.stringify(gate, null, 2) + '\n');
if (!gate.renderSafe) throw new Error(`Host resource gate: ${gate.reasons.join(', ')}`);
console.log(JSON.stringify({ event: 'gate-pass', mode, aspect, load: gate.loadAverage[0], availableGiB: gate.availableMemoryBytes / 1024 ** 3 }));
if (mode === 'masters') {
  const approval = JSON.parse(await readFile(path.join(output, 'pre-render-review.json'), 'utf8'));
  const { createHash } = await import('node:crypto');
  const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
  if (approval.status !== 'approved' || approval.gl !== gl || approval.chromeMode !== chromeMode || approval.sourceSha256 !== await digest(path.join(project, 'src/AiAnswerExplainer.tsx')) || approval.mixSha256 !== await digest(path.join(project, 'public/ia-answer-20261023/mix.m4a'))) throw new Error('Current source, renderer and audio need approved visual QA before masters');
}
const serveUrl = await bundle({ entryPoint: path.join(project, 'src/index.ts'), rootDir: project, outDir: path.join(output, 'bundle'), rspack: true, gitSource: null, askAIEnabled: false });
const chromiumOptions = { gl };
const browser = await openBrowser('chrome', { chromiumOptions, chromeMode });
const report = { mode, aspect, startedAt: new Date().toISOString(), backend: `Remotion 4.0.537 / ${chromeMode} / ${gl} / concurrency 2`, gl, chromeMode, gate, jobs: [], errors: [] };
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
    const id = format === 'landscape' ? 'AiAnswerExplainerLandscape' : 'AiAnswerExplainerPortrait';
    const composition = await selectComposition({ serveUrl, id, puppeteerInstance: browser, chromiumOptions, timeoutInMilliseconds: 90000 });
    if (mode === 'frames') {
      const dir = path.join(output, format);
      await mkdir(dir, { recursive: true });
      for (const frame of timeline.chapters.flatMap(chapter => [2, 5, 9].map(beat => chapter.startFrame + Math.round((chapter.sentences[beat].startSeconds + 1.5) * 24)))) {
        const begin = Date.now();
        const filename = path.join(dir, `frame-${String(frame).padStart(3, '0')}.png`);
        await renderStill({ composition, serveUrl, puppeteerInstance: browser, chromiumOptions, frame, imageFormat: 'png', output: filename, timeoutInMilliseconds: 90000, cancelSignal });
        const record = { id, frame, path: filename, elapsedSeconds: (Date.now() - begin) / 1000 };
        report.jobs.push(record);
        console.log(JSON.stringify(record));
      }
    } else {
      const jobs = mode === 'bench'
        ? timeline.chapters.filter((_chapter, index) => [0, 1, 4].includes(index)).map(chapter => { const start = chapter.startFrame + Math.round(chapter.sentences[chapter.index === 0 ? 2 : chapter.index === 1 ? 2 : 5].startSeconds * 24); return { name: chapter.id, frames: [start, start + 47] }; })
        : [{ name: 'master', frames: [0, composition.durationInFrames - 1] }];
      for (const job of jobs) {
        const filename = path.join(output, mode === 'masters' ? `ai-answer-${format}.mp4` : `bench-${format}-${job.name}${benchmarkSuffix}.mp4`);
        const begin = Date.now();
        const record = { id, kind: job.name, width: composition.width, height: composition.height, fps: composition.fps, frames: job.frames, durationSeconds: (job.frames[1] - job.frames[0] + 1) / composition.fps, startedAt: new Date(begin).toISOString(), path: filename, status: 'rendering' };
        report.jobs.push(record);
        let last = 0;
        console.log(JSON.stringify({ event: 'render-start', ...record }));
        try {
          await renderMedia({ composition, serveUrl, puppeteerInstance: browser, chromiumOptions, outputLocation: filename, codec: 'h264', crf: 18, pixelFormat: 'yuv420p', audioCodec: 'aac', audioBitrate: '192k', concurrency, imageFormat: 'jpeg', jpegQuality: 95, frameRange: job.frames, timeoutInMilliseconds: 90000, cancelSignal, onProgress: (progress) => {
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
} finally {
  await release();
}
