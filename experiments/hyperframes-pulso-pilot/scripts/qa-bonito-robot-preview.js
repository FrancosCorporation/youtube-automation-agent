import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const pilot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const variant = path.join(pilot, 'variants/robo-bonito');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(variant, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(variant + path.sep)) throw new Error('Invalid path');
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl'] });
  console.log('QA browser ready');
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + new URL(r.url()).pathname); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('QA page loaded');
  await page.waitForFunction(() => window.generatedRobotReady || window.generatedRobotError, null, { timeout: 60000 });
  const buildError = await page.evaluate(() => window.generatedRobotError);
  if (buildError) throw new Error(buildError);
  console.log('QA model ready');
  await page.evaluate(() => document.fonts.ready);
  // Read the actual WebGL framebuffer in the same task that draws it.
  // Never return GSAP's timeline from evaluate: it contains a large object graph.
  const capture = async time => Buffer.from((await page.evaluate(t => {
    window.generatedRobotTimeline.seek(t);
    window.seekGeneratedRobot(t);
    return document.getElementById('three-layer').toDataURL('image/png');
  }, time)).split(',')[1], 'base64');
  const shots = [ ['frente', 0.5], ['perfil', 2.5], ['costas', 4.5], ['close', 6.5],
    ['antes-2', 47 / 24], ['depois-2', 2], ['antes-4', 95 / 24], ['depois-4', 4],
    ['antes-6', 143 / 24], ['depois-6', 6] ];
  const frames = [];
  for (const [name, time] of shots) {
    const output = path.join(pilot, 'renders', `pulso-robo-bonito-${name}.png`);
    await writeFile(output, await capture(time));
    frames.push({ name, time, file: path.relative(pilot, output) });
  }
  const hash = buffer => createHash('sha256').update(buffer).digest('hex');
  const before = hash(await capture(6.5));
  await page.evaluate(() => { window.generatedRobotTimeline.seek(0.5); });
  const after = hash(await capture(6.5));
  const metrics = await page.evaluate(() => window.generatedRobotMetrics);
  const result = { metrics, errors, frames, capture: '1040x1040 WebGL canvas, immediate read after rendering', deterministicSeek: { times: [6.5, 0.5, 6.5], before, after, identical: before === after } };
  await writeFile(path.join(variant, 'qa-metrics.json'), JSON.stringify(result, null, 2) + '\n');
  if (errors.length || before !== after || !metrics.meshes) throw new Error('Preview QA failed; see qa-metrics.json');
  console.log(JSON.stringify({ ...metrics, errors, deterministicSeek: before === after, frames: frames.length }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
