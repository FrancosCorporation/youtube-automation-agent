'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildNarrativeBundleArgs, buildNarrativeRenderArgs, hashBundleDirectory, remainingRenderTimeout, memoryBoundedNodeOptions, lowMemoryRenderCheck, narrativeRenderStatePath
} = require('../utils/narrative-episode-renderer');

test('render checkpoints honor isolated absolute and relative state directories', () => {
  assert.equal(narrativeRenderStatePath('/project', undefined, 'job-1234'), '/project/data/state/narrative-renders/job-1234.json');
  assert.equal(narrativeRenderStatePath('/project', 'sandbox', 'job-1234'), '/project/sandbox/narrative-renders/job-1234.json');
  assert.equal(narrativeRenderStatePath('/project', '/tmp/pulso-test', 'job-1234'), '/tmp/pulso-test/narrative-renders/job-1234.json');
});

test('monitor de render exige reserva de memória e swap, inclusive se a leitura falhar', t => {
  const syncFs = require('node:fs');
  let memoryGiB = 3;
  let swapGiB = 8;
  t.mock.method(syncFs, 'readFileSync', () => `MemAvailable: ${memoryGiB * 1024 ** 2} kB\nSwapFree: ${swapGiB * 1024 ** 2} kB\n`);
  assert.equal(lowMemoryRenderCheck(), null);
  memoryGiB = 2;
  assert.equal(lowMemoryRenderCheck().code, 'HOST_RESOURCE_GATE');
  memoryGiB = 3;
  swapGiB = 3;
  assert.equal(lowMemoryRenderCheck().code, 'HOST_RESOURCE_GATE');
});

test('render junto ao treino limita o heap de cada subprocesso a dois GiB', t => {
  const previous = process.env.PULSO_RENDER_WITH_TRAINING;
  t.after(() => {
    if (previous === undefined) delete process.env.PULSO_RENDER_WITH_TRAINING;
    else process.env.PULSO_RENDER_WITH_TRAINING = previous;
  });
  process.env.PULSO_RENDER_WITH_TRAINING = '1';
  const value = memoryBoundedNodeOptions('--trace-warnings --max-old-space-size=8192', 16 * 1024 ** 3);
  assert.equal(value.heapMiB, 2048);
  assert.match(value.value, /--trace-warnings/);
  assert.doesNotMatch(value.value, /8192/);
});

test('renderer creates one bundle and renders each aspect from that bundle', () => {
  const bundleDir = '/tmp/job/bundle';
  const bundleArgs = buildNarrativeBundleArgs(bundleDir);
  assert.equal(bundleArgs[0], 'bundle');
  assert.equal(bundleArgs[1], 'src/index.ts');
  assert(bundleArgs.includes(`--out-dir=${bundleDir}`));

  const args = buildNarrativeRenderArgs({
    bundleDir, propsPath: '/tmp/job/props.json', outputPath: '/tmp/video.mp4',
    fps: 24, width: 1080, height: 1920, gl: 'angle-egl'
  });
  assert.deepEqual(args.slice(0, 4), ['render', bundleDir, 'NarrativeEpisode', '/tmp/video.mp4']);
  assert(args.includes('--width=1080'));
  assert(args.includes('--height=1920'));
  assert(args.includes('--gl=angle-egl'));
});

test('modo de baixa memória separa renderização e codificação somente durante o treino', t => {
  const keys = ['PULSO_RENDER_WITH_TRAINING', 'PULSO_RENDER_LOW_MEMORY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => keys.forEach(key => {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }));
  const options = { bundleDir: '/tmp/bundle', propsPath: '/tmp/props', outputPath: '/tmp/out.mp4', fps: 24, width: 1920, height: 1080 };
  process.env.PULSO_RENDER_LOW_MEMORY = '1';
  delete process.env.PULSO_RENDER_WITH_TRAINING;
  assert(!buildNarrativeRenderArgs(options).includes('--disallow-parallel-encoding'));
  process.env.PULSO_RENDER_WITH_TRAINING = '1';
  assert(buildNarrativeRenderArgs(options).includes('--disallow-parallel-encoding'));
});

test('bundle identity includes generated code and excludes job-specific staged runtime assets', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-bundle-hash-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '_runtime', 'job-a'), { recursive: true });
  await fs.writeFile(path.join(root, 'index.html'), '<html></html>');
  await fs.writeFile(path.join(root, 'main.js'), 'const revision=1;');
  await fs.writeFile(path.join(root, '_runtime', 'job-a', 'audio.m4a'), 'audio-a');
  const first = await hashBundleDirectory(root);
  await fs.writeFile(path.join(root, '_runtime', 'job-a', 'audio.m4a'), 'audio-b');
  assert.equal(await hashBundleDirectory(root), first);
  await fs.writeFile(path.join(root, 'main.js'), 'const revision=2;');
  assert.notEqual(await hashBundleDirectory(root), first);
  assert.equal(first, crypto.createHash('sha256').update('index.html\0<html></html>\0main.js\0const revision=1;\0').digest('hex'));
});

test('bundle identity ignores only the changing runtime entries in Remotion public inventory', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-bundle-inventory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const html = entries => `<script>window.remotion_staticFiles = ${JSON.stringify(entries)}.map((file) => file);</script>`;
  const stable = { name: 'brand/logo.png', lastModified: 10, sizeInBytes: 20 };
  await fs.writeFile(path.join(root, 'index.html'), html([stable, { name: '_runtime/job-a/audio.m4a', lastModified: 1 }]));
  const first = await hashBundleDirectory(root);
  await fs.writeFile(path.join(root, 'index.html'), html([stable, { name: '_runtime/job-b/audio.m4a', lastModified: 99 }]));
  assert.equal(await hashBundleDirectory(root), first);
  await fs.writeFile(path.join(root, 'index.html'), html([{ ...stable, sizeInBytes: 21 }]));
  assert.notEqual(await hashBundleDirectory(root), first);
});

test('render deadline is shared and expires before launching another stage', () => {
  assert(remainingRenderTimeout(Date.now() + 60_000, 'landscape') > 0);
  assert.throws(() => remainingRenderTimeout(Date.now() - 1, 'portrait'), error => {
    assert.equal(error.code, 'HYPERFRAMES_TIMEOUT');
    assert.equal(error.stage, 'portrait');
    return true;
  });
});
