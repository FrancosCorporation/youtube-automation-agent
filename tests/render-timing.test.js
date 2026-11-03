'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createRenderTimingRecord,
  estimateRenderTiming,
  normalizeHardwareGate,
  probeRenderHardwareGate,
  persistRenderTimingRecord,
  loadRenderTimingHistory,
  safeJobId,
  isActiveRenderCommand
} = require('../utils/render-timing');

const compatibleTarget = {
  videoDurationSeconds: 10,
  width: 1920,
  height: 1080,
  fps: 24,
  backend: 'gpu',
  captureProfile: 'native',
  quality: 'high',
  rendererVersion: '0.8.183',
  hardwareClass: 'linux-x64-rx6750xt',
  hardwareGate: { status: 'pass' }
};

const historyRecord = (jobId, wallTimeMs, overrides = {}) => createRenderTimingRecord({
  jobId,
  status: 'completed',
  startedAt: '2026-10-22T16:00:00.000Z',
  finishedAt: '2026-10-22T16:00:01.000Z',
  wallTimeMs,
  videoDurationSeconds: 5,
  width: compatibleTarget.width,
  height: compatibleTarget.height,
  fps: compatibleTarget.fps,
  backend: compatibleTarget.backend,
  captureProfile: compatibleTarget.captureProfile,
  quality: compatibleTarget.quality,
  rendererVersion: compatibleTarget.rendererVersion,
  hardwareClass: compatibleTarget.hardwareClass,
  hardwareGate: { status: 'pass' },
  ...overrides
});

test('render record derives timing, format, backend, capture and a privacy-safe hardware gate', () => {
  const record = createRenderTimingRecord({
    jobId: 'job-123',
    startedAt: '2026-10-22T16:00:00.000Z',
    finishedAt: '2026-10-22T16:00:04.500Z',
    wallTimeMs: 4475,
    videoDurationSeconds: 2.5,
    width: 1920,
    height: 1080,
    fps: 24,
    backend: 'gpu',
    captureProfile: 'native',
    quality: 'high',
    rendererVersion: '0.8.183',
    hardwareClass: 'linux-x64-rx6750xt',
    hardwareGate: {
      renderSafe: true,
      observedAt: '2026-10-22T15:59:58.000Z',
      logicalCpus: 16,
      loadAverage: [2.1, 2.3, 2.6],
      availableMemoryBytes: 12 * 1024 ** 3,
      swapFreeBytes: 8 * 1024 ** 3,
      activeRenderOrPreviewProcesses: [{ pid: 1234, command: 'private command' }],
      gpuBusyPercent: 28
    }
  });

  assert.equal(record.jobId, 'job-123');
  assert.equal(record.startedAt, '2026-10-22T16:00:00.000Z');
  assert.equal(record.finishedAt, '2026-10-22T16:00:04.500Z');
  assert.equal(record.wallTimeMs, 4475);
  assert.equal(record.videoDurationSeconds, 2.5);
  assert.equal(record.resolution, '1920x1080');
  assert.equal(record.aspectRatio, 1.77778);
  assert.equal(record.backend, 'gpu');
  assert.equal(record.captureProfile, 'native');
  assert.ok(Math.abs(record.renderSecondsPerVideoSecond - 1.79) < 1e-9);
  assert.equal(record.hardwareGate.status, 'pass');
  assert.equal(record.hardwareGate.activeRenderProcessCount, 1);
  assert.equal(JSON.stringify(record).includes('private command'), false);
  assert.equal(JSON.stringify(record).includes('1234'), false);
});

test('renderer-absent gate data is explicit and failed or incomplete runs do not invent a ratio', () => {
  const failed = createRenderTimingRecord({
    status: 'failed',
    startedAt: '2026-10-22T16:00:00.000Z',
    wallTimeMs: 1500,
    videoDurationSeconds: 5
  });
  const unavailable = normalizeHardwareGate(null);

  assert.equal(failed.renderSecondsPerVideoSecond, null);
  assert.equal(failed.width, null);
  assert.equal(failed.fps, null);
  assert.deepEqual(unavailable, {
    status: 'unknown',
    dataAvailable: false,
    reason: 'hardware_gate_not_provided_to_renderer'
  });
});

test('estimate uses only successful history with exact render and hardware compatibility', () => {
  const history = [
    historyRecord('compatible-1', 10000),
    historyRecord('compatible-2', 20000),
    historyRecord('compatible-3', 30000),
    historyRecord('wrong-resolution', 5000, { width: 1080 }),
    historyRecord('wrong-backend', 5000, { backend: 'cpu' }),
    historyRecord('wrong-capture', 5000, { captureProfile: 'safe' }),
    historyRecord('wrong-quality', 5000, { quality: 'draft' }),
    historyRecord('wrong-hardware', 5000, { hardwareClass: 'other-host' }),
    historyRecord('failed-job', 5000, { status: 'failed' }),
    historyRecord('blocked-gate', 5000, { hardwareGate: { status: 'blocked' } })
  ];
  const estimate = estimateRenderTiming({ history, target: compatibleTarget });

  assert.equal(estimate.status, 'estimated_from_compatible_history');
  assert.equal(estimate.sampleCount, 3);
  assert.equal(estimate.confidence, 'observed_history');
  assert.deepEqual(estimate.observedRatioRange, { min: 2, median: 4, max: 6 });
  assert.deepEqual(estimate.observedWallTimeRangeSeconds, { min: 20, median: 40, max: 60 });
  assert.equal(estimate.estimatedWallTimeSeconds, 40);
  assert.deepEqual(estimate.compatibleJobIds, ['compatible-1', 'compatible-2', 'compatible-3']);
});

test('estimation returns no fabricated ETA without a passed gate, complete target metadata, or compatible history', () => {
  const noGate = estimateRenderTiming({ history: [], target: { ...compatibleTarget, hardwareGate: null } });
  const incomplete = estimateRenderTiming({ history: [], target: { ...compatibleTarget, hardwareClass: null } });
  const unknownHardware = estimateRenderTiming({ history: [], target: { ...compatibleTarget, hardwareClass: 'unknown' } });
  const noHistory = estimateRenderTiming({ history: [], target: compatibleTarget });
  const oneSample = estimateRenderTiming({
    history: [historyRecord('one-compatible-sample', 10000)],
    target: compatibleTarget
  });

  assert.equal(noGate.status, 'hardware_gate_not_passed');
  assert.equal(noGate.estimatedWallTimeSeconds, undefined);
  assert.equal(incomplete.status, 'insufficient_target_metadata');
  assert.ok(incomplete.missingFields.includes('hardwareClass'));
  assert.equal(unknownHardware.status, 'insufficient_target_metadata');
  assert.ok(unknownHardware.missingFields.includes('hardwareClass'));
  assert.equal(noHistory.status, 'no_compatible_history');
  assert.equal(noHistory.estimatedWallTimeSeconds, null);
  assert.equal(oneSample.confidence, 'low_sample_count');
  assert.equal(oneSample.sampleCount, 1);
});

test('host gate captures CPU, memory and GPU state without exposing process command lines', () => {
  const gate = probeRenderHardwareGate();
  assert.ok(['pass', 'blocked'].includes(gate.status));
  assert.equal(gate.renderSafe, gate.status === 'pass');
  assert.ok(Number.isFinite(gate.logicalCpus) && gate.logicalCpus > 0);
  assert.ok(Array.isArray(gate.loadAverage));
  assert.ok(Number.isFinite(gate.availableMemoryBytes));
  assert.ok(Number.isFinite(gate.swapFreeBytes));
  assert.ok(Array.isArray(gate.activeRenderProcesses));
  assert.equal(typeof gate.hardwareClass, 'string');
  assert.ok(Array.isArray(gate.reasons));
  assert.equal(JSON.stringify(gate).includes('cmdline'), false);
});

test('timing history persists atomically under a sanitized per-job filename', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'render-timing-test-'));
  try {
    const record = historyRecord('../unsafe job', 10000);
    const file = await persistRenderTimingRecord(record, directory);
    const loaded = await loadRenderTimingHistory(directory);
    assert.match(path.basename(file), /^unsafe_job-\d+\.json$/);
    assert.deepEqual(loaded, [record]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('job IDs cannot introduce paths in runtime reports', () => {
  assert.equal(safeJobId('../../a/b'), 'a_b');
  assert.equal(safeJobId(''), 'unassigned');
});

test('resource gate blocks render jobs but not passive preview servers', () => {
  assert.equal(isActiveRenderCommand(['npx', 'hyperframes@0.8.183', 'render']), true);
  assert.equal(isActiveRenderCommand(['node', '/project/node_modules/.bin/remotion', 'render']), true);
  assert.equal(isActiveRenderCommand(['node', '/project/node_modules/.bin/remotion', 'studio']), false);
  assert.equal(isActiveRenderCommand(['npx', 'hyperframes@0.8.183', 'preview', '.', '--port', '3003']), false);
  assert.equal(isActiveRenderCommand(['node', '/project/scripts/generate-animated-video.js']), true);
  assert.equal(isActiveRenderCommand(['node', '/project/scripts/check-narrative-render.js', '--plan', 'sample.json']), true);
  assert.equal(isActiveRenderCommand(['npx', 'eslint', 'utils/remotion-story-video-renderer.js']), false);
  assert.equal(isActiveRenderCommand(['node', 'tests/hyperframes-video-renderer.test.js']), false);
});

for (const scenario of [
  { name: 'GPU compute busy with spare VRAM', shared: true, nice: 10, memory: 8, vram: 6, allowed: true },
  { name: 'sharing flag without low process priority', shared: true, nice: 0, memory: 8, vram: 6, reason: 'training_shared_render_requires_constrained_process' },
  { name: 'insufficient RAM during training', shared: true, nice: 10, memory: 4, vram: 6, reason: 'available_memory_below_6_gib' },
  { name: 'low-memory profile can share training with 4.5 GiB and swap', shared: true, lowMemory: true, nice: 10, memory: 5, vram: 6, allowed: true },
  { name: 'low-memory profile keeps minimum memory reserve', shared: true, lowMemory: true, nice: 10, memory: 4, vram: 6, reason: 'available_memory_below_4.5_gib' },
  { name: 'continuing job tolerates modest memory fluctuation', shared: true, lowMemory: true, continuation: true, nice: 10, memory: 4.25, vram: 6, allowed: true },
  { name: 'continuing job still requires four GiB', shared: true, lowMemory: true, continuation: true, nice: 10, memory: 3.75, vram: 6, reason: 'available_memory_below_4_gib' },
  { name: 'continuation flag does not relax normal profile', shared: true, continuation: true, nice: 10, memory: 4.25, vram: 6, reason: 'available_memory_below_6_gib' },
  { name: 'training reserves remaining GPU memory', shared: true, nice: 10, memory: 8, vram: 1, reason: 'shared_gpu_free_memory_below_2_gib' },
  { name: 'explicit software rasterization preserves GPU memory', software: true, gl: 'swangle', shared: true, nice: 10, memory: 8, vram: 0, allowed: true },
  { name: 'software request cannot disguise a GPU backend', software: true, gl: 'angle', shared: true, nice: 10, memory: 8, vram: 0, reason: 'software_render_requires_constrained_training_profile_and_swangle' },
  { name: 'software rasterization keeps the RAM reserve', software: true, gl: 'swangle', shared: true, nice: 10, memory: 4, vram: 0, reason: 'available_memory_below_6_gib' },
  { name: 'original constrained policy stays conservative', shared: false, nice: 10, memory: 8, vram: 6, reason: 'gpu_above_constrained_limit' }
]) {
  test(`training/render coexistence: ${scenario.name}`, t => {
    const syncFs = require('node:fs');
    const originalRead = syncFs.readFileSync;
    const originalList = syncFs.readdirSync;
    const keys = ['PULSO_CONSTRAINED_RENDER', 'PULSO_RENDER_WITH_TRAINING', 'PULSO_RENDER_LOW_MEMORY', 'PULSO_RENDER_SOFTWARE_ONLY', 'PULSO_REMOTION_GL'];
    const previous = keys.map(key => process.env[key]);
    t.after(() => {
      for (const [index, key] of keys.entries()) {
        if (previous[index] === undefined) delete process.env[key];
        else process.env[key] = previous[index];
      }
    });
    process.env.PULSO_CONSTRAINED_RENDER = '1';
    process.env.PULSO_RENDER_WITH_TRAINING = scenario.shared ? '1' : '0';
    process.env.PULSO_RENDER_LOW_MEMORY = scenario.lowMemory ? '1' : '0';
    process.env.PULSO_RENDER_SOFTWARE_ONLY = scenario.software ? '1' : '0';
    process.env.PULSO_REMOTION_GL = scenario.gl || 'angle';
    t.mock.method(os, 'availableParallelism', () => 6);
    t.mock.method(os, 'cpus', () => Array(28).fill({}));
    t.mock.method(os, 'getPriority', () => scenario.nice);
    t.mock.method(os, 'loadavg', () => [12, 11, 10]);
    t.mock.method(syncFs, 'readdirSync', (directory, ...args) => directory === '/proc' ? []
      : directory === '/sys/class/drm' ? ['card1'] : originalList(directory, ...args));
    t.mock.method(syncFs, 'readFileSync', (file, ...args) => {
      if (file === '/proc/meminfo') return `MemAvailable: ${scenario.memory * 1024 ** 2} kB\nSwapFree: ${16 * 1024 ** 2} kB\n`;
      if (String(file).endsWith('/gpu_busy_percent')) return '99';
      if (String(file).endsWith('/mem_info_vram_total')) return String(12 * 1024 ** 3);
      if (String(file).endsWith('/mem_info_vram_used')) return String((12 - scenario.vram) * 1024 ** 3);
      return originalRead(file, ...args);
    });
    const gate = probeRenderHardwareGate({ lowMemoryContinuation: scenario.continuation });
    if (scenario.allowed) assert.equal(gate.renderSafe, true, gate.reasons.join(', '));
    else { assert.equal(gate.renderSafe, false); assert(gate.reasons.includes(scenario.reason)); }
  });
}
