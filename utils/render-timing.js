'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const REQUIRED_ESTIMATE_FIELDS = Object.freeze([
  'width', 'height', 'fps', 'backend', 'captureProfile', 'quality', 'rendererVersion', 'hardwareClass'
]);
const RENDER_STATUSES = new Set(['completed', 'failed', 'timed_out', 'blocked']);
const HARDWARE_GATE_STATUSES = new Set(['pass', 'blocked', 'warning', 'unknown']);

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function timestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampIso(value) {
  const parsed = timestampMs(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

function normalizeHardwareGate(gate) {
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    return {
      status: 'unknown',
      dataAvailable: false,
      reason: 'hardware_gate_not_provided_to_renderer'
    };
  }

  const renderSafe = typeof gate.renderSafe === 'boolean' ? gate.renderSafe : null;
  const requestedStatus = HARDWARE_GATE_STATUSES.has(gate.status) ? gate.status : null;
  const status = requestedStatus || (renderSafe === true ? 'pass' : renderSafe === false ? 'blocked' : 'unknown');
  const activeProcesses = Array.isArray(gate.activeRenderOrPreviewProcesses)
    ? gate.activeRenderOrPreviewProcesses.length
    : finiteNumber(gate.activeRenderProcessCount);
  const loadAverage = Array.isArray(gate.loadAverage)
    ? gate.loadAverage.map(finiteNumber).filter(value => value !== null)
    : null;
  const reasons = Array.isArray(gate.reasons)
    ? gate.reasons.filter(reason => typeof reason === 'string').map(reason => reason.slice(0, 200))
    : null;

  return {
    status,
    dataAvailable: true,
    observedAt: timestampIso(gate.observedAt),
    renderSafe,
    logicalCpus: finiteNumber(gate.logicalCpus),
    loadAverage: loadAverage?.length ? loadAverage : null,
    availableMemoryBytes: finiteNumber(gate.availableMemoryBytes),
    swapFreeBytes: finiteNumber(gate.swapFreeBytes),
    activeRenderProcessCount: activeProcesses,
    gpuBusyPercent: finiteNumber(gate.gpuBusyPercent),
    gpuMemoryUsedBytes: finiteNumber(gate.gpuMemoryUsedBytes),
    gpuMemoryTotalBytes: finiteNumber(gate.gpuMemoryTotalBytes),
    reasons
  };
}

function createRenderTimingRecord(input = {}) {
  const startedAt = timestampIso(input.startedAt);
  const finishedAt = timestampIso(input.finishedAt);
  const startMs = timestampMs(input.startedAt);
  const finishMs = timestampMs(input.finishedAt);
  const derivedWallTime = startMs !== null && finishMs !== null ? finishMs - startMs : null;
  const wallTimeMs = finiteNumber(input.wallTimeMs) ?? derivedWallTime;
  if (wallTimeMs !== null && wallTimeMs < 0) throw new RangeError('wallTimeMs cannot be negative');

  const status = input.status === undefined ? 'completed' : input.status;
  if (!RENDER_STATUSES.has(status)) throw new TypeError(`invalid render status: ${status}`);
  const videoDurationSeconds = positiveNumber(input.videoDurationSeconds);
  const width = positiveNumber(input.width);
  const height = positiveNumber(input.height);
  const fps = positiveNumber(input.fps);
  const backend = typeof input.backend === 'string' && input.backend.trim() ? input.backend.trim() : null;
  const captureProfile = typeof input.captureProfile === 'string' && input.captureProfile.trim()
    ? input.captureProfile.trim() : null;
  const quality = typeof input.quality === 'string' && input.quality.trim() ? input.quality.trim() : null;
  const rendererVersion = typeof input.rendererVersion === 'string' && input.rendererVersion.trim()
    ? input.rendererVersion.trim() : null;
  const hardwareClass = typeof input.hardwareClass === 'string' && input.hardwareClass.trim()
    ? input.hardwareClass.trim() : null;
  const renderSecondsPerVideoSecond = status === 'completed' && wallTimeMs !== null && videoDurationSeconds
    ? (wallTimeMs / 1000) / videoDurationSeconds
    : null;
  const attempts = Array.isArray(input.attempts) ? input.attempts.filter(attempt => attempt && typeof attempt === 'object').map(attempt => ({
    backend: typeof attempt.backend === 'string' ? attempt.backend : null,
    captureProfile: typeof attempt.captureProfile === 'string' ? attempt.captureProfile : null,
    quality: typeof attempt.quality === 'string' ? attempt.quality : null,
    status: RENDER_STATUSES.has(attempt.status) ? attempt.status : 'unknown',
    startedAt: timestampIso(attempt.startedAt),
    finishedAt: timestampIso(attempt.finishedAt),
    wallTimeMs: finiteNumber(attempt.wallTimeMs),
    errorCode: typeof attempt.errorCode === 'string' ? attempt.errorCode.slice(0, 100) : null
  })) : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    jobId: typeof input.jobId === 'string' && input.jobId.trim() ? input.jobId.trim() : null,
    status,
    startedAt,
    finishedAt,
    wallTimeMs,
    videoDurationSeconds,
    width,
    height,
    resolution: width && height ? `${width}x${height}` : null,
    aspectRatio: width && height ? Number((width / height).toFixed(5)) : null,
    fps,
    backend,
    captureProfile,
    quality,
    rendererVersion,
    hardwareClass,
    hardwareGate: normalizeHardwareGate(input.hardwareGate),
    renderSecondsPerVideoSecond,
    attempts
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function compatibilityValue(record, field) {
  if (field === 'width' || field === 'height' || field === 'fps') return finiteNumber(record?.[field]);
  if (typeof record?.[field] !== 'string' || !record[field].trim()) return null;
  const value = record[field].trim();
  if (field === 'hardwareClass' && /^(unknown|unavailable|unobserved)$/i.test(value)) return null;
  return value;
}

function estimateRenderTiming({ history = [], target = {} } = {}) {
  const targetGate = normalizeHardwareGate(target.hardwareGate);
  const missingFields = REQUIRED_ESTIMATE_FIELDS.filter(field => compatibilityValue(target, field) === null);
  const videoDurationSeconds = positiveNumber(target.videoDurationSeconds);
  if (!videoDurationSeconds) missingFields.push('videoDurationSeconds');
  if (targetGate.status !== 'pass') {
    return {
      status: 'hardware_gate_not_passed',
      reason: 'render_time_estimate_requires_a_passed_hardware_gate',
      sampleCount: 0,
      missingFields
    };
  }
  if (missingFields.length) {
    return { status: 'insufficient_target_metadata', sampleCount: 0, missingFields };
  }

  const compatible = history.filter(record => {
    if (!record || record.status !== 'completed' || record.hardwareGate?.status !== 'pass') return false;
    if (!positiveNumber(record.videoDurationSeconds) || finiteNumber(record.wallTimeMs) === null) return false;
    return REQUIRED_ESTIMATE_FIELDS.every(field =>
      compatibilityValue(record, field) === compatibilityValue(target, field));
  });
  const ratios = compatible.map(record => (Number(record.wallTimeMs) / 1000) / Number(record.videoDurationSeconds));
  if (!ratios.length) {
    return {
      status: 'no_compatible_history',
      reason: 'no_completed_render_matches_resolution_fps_backend_capture_quality_renderer_and_hardware',
      sampleCount: 0,
      estimatedWallTimeSeconds: null,
      observedRatioRange: null
    };
  }

  const medianRatio = median(ratios);
  const minimumRatio = Math.min(...ratios);
  const maximumRatio = Math.max(...ratios);
  return {
    status: 'estimated_from_compatible_history',
    sampleCount: compatible.length,
    confidence: compatible.length < 3 ? 'low_sample_count' : 'observed_history',
    estimatedWallTimeSeconds: medianRatio * videoDurationSeconds,
    observedWallTimeRangeSeconds: {
      min: minimumRatio * videoDurationSeconds,
      median: medianRatio * videoDurationSeconds,
      max: maximumRatio * videoDurationSeconds
    },
    observedRatioRange: {
      min: minimumRatio,
      median: medianRatio,
      max: maximumRatio
    },
    compatibleJobIds: compatible.map(record => record.jobId).filter(Boolean)
  };
}

function gpuSnapshot() {
  try {
    const drm = '/sys/class/drm';
    const cards = fs.readdirSync(drm).filter(name => /^card\d+$/.test(name)).sort();
    for (const card of cards) {
      const device = path.join(drm, card, 'device');
      const read = name => {
        const value = Number(fs.readFileSync(path.join(device, name), 'utf8').trim());
        return Number.isFinite(value) ? value : null;
      };
      const busy = read('gpu_busy_percent');
      const used = read('mem_info_vram_used');
      const total = read('mem_info_vram_total');
      if (busy !== null || used !== null || total !== null) {
        return { gpuBusyPercent: busy, gpuMemoryUsedBytes: used, gpuMemoryTotalBytes: total };
      }
    }
  } catch { /* GPU telemetry is optional; the CPU/memory gate remains usable. */ }
  return { gpuBusyPercent: null, gpuMemoryUsedBytes: null, gpuMemoryTotalBytes: null };
}

function isActiveRenderCommand(argv) {
  const args = Array.isArray(argv) ? argv.map(String) : [];
  const action = args.filter(value => value.toLowerCase() === 'render');
  const hasHyperFramesCli = args.some(value => /^hyperframes(?:@[^/]+)?$/i.test(path.basename(value)));
  const hasRemotionCli = args.some(value => path.basename(value).toLowerCase() === 'remotion');
  const isProductionGenerator = args.some(value => /(?:^|\/)generate-animated-video\.js$/i.test(value));
  const isDiagnosticRenderer = args.some(value => /(?:^|\/)check-narrative-render\.js$/i.test(value));
  // Preview/Studio servers can stay open while idle; live load, memory and GPU
  // telemetry gate their actual resource impact. Only competing render jobs block.
  return isProductionGenerator || isDiagnosticRenderer || (hasHyperFramesCli && action.includes('render'))
    || (hasRemotionCli && action.includes('render'));
}

function probeRenderHardwareGate({ excludePids = [process.pid], lowMemoryContinuation = false, preparationOnly = false } = {}) {
  const loadAverage = os.loadavg();
  const logicalCpus = os.availableParallelism?.() || os.cpus().length;
  const hostLogicalCpus = os.cpus().length;
  const constrainedRequested = process.env.PULSO_CONSTRAINED_RENDER === '1';
  const processPriority = os.getPriority();
  // A render pinned to at most six CPUs and running at low priority cannot
  // consume the other host CPUs. Admit it only with ample memory and headroom.
  const constrainedEligible = constrainedRequested && process.platform === 'linux'
    && hostLogicalCpus >= 12 && logicalCpus <= 6 && processPriority >= 10;
  const trainingSharedRequested = process.env.PULSO_RENDER_WITH_TRAINING === '1';
  const trainingSharedEligible = trainingSharedRequested && constrainedEligible;
  // Explicit software rasterization needs no free VRAM. Keep all CPU/RAM,
  // swap and competing-render protections; reject mismatched GPU backends.
  const softwareRequested = process.env.PULSO_RENDER_SOFTWARE_ONLY === '1';
  const softwareEligible = softwareRequested && trainingSharedEligible && process.env.PULSO_REMOTION_GL === 'swangle';
  const configuredLoadRatio = Number(process.env.PULSO_SHARED_RENDER_LOAD_RATIO || 0.95);
  // Honor the installed training-sharing profile (1.10), with a hard ceiling
  // and a conservative default for malformed configuration.
  const sharedLoadRatio = trainingSharedEligible
    ? Math.min(1.10, Math.max(0.80, Number.isFinite(configuredLoadRatio) ? configuredLoadRatio : 0.95))
    : 0.80;
  const loadAverageLimit = constrainedEligible
    ? hostLogicalCpus * sharedLoadRatio
    : Math.max(4, logicalCpus * 0.35);
  const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
  const bytes = key => Number(meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] || 0) * 1024;
  const availableMemoryBytes = bytes('MemAvailable');
  const swapFreeBytes = bytes('SwapFree');
  const excluded = new Set(excludePids.map(Number));
  const activeRenderProcesses = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || excluded.has(Number(entry))) continue;
    try {
      const argv = fs.readFileSync(`/proc/${entry}/cmdline`).toString()
        .split(String.fromCharCode(0)).filter(Boolean);
      if (isActiveRenderCommand(argv)) {
        activeRenderProcesses.push(Number(entry));
      }
    } catch { /* Process ended while sampling. */ }
  }
  const gpu = gpuSnapshot();
  const reasons = [];
  if (constrainedRequested && !constrainedEligible) reasons.push('constrained_render_requires_low_priority_and_six_cpu_affinity');
  if (trainingSharedRequested && !trainingSharedEligible) reasons.push('training_shared_render_requires_constrained_process');
  if (softwareRequested && !softwareEligible) reasons.push('software_render_requires_constrained_training_profile_and_swangle');
  if (loadAverage[0] > loadAverageLimit) reasons.push('load_average_above_limit');
  // The explicitly enabled low-memory profile is restricted to the same
  // low-priority, CPU-limited training-sharing mode and retains swap reserve.
  const lowMemoryProfile = trainingSharedEligible && process.env.PULSO_RENDER_LOW_MEMORY === '1';
  // A job is admitted at 4.5 GiB. Once admitted, allow modest fluctuation
  // between its preparation and render stages; the subprocess watchdog
  // still stops that job if the 2.5 GiB emergency reserve is breached.
  const minimumMemoryGiB = preparationOnly ? 2 : lowMemoryProfile ? (lowMemoryContinuation ? 4 : 4.5)
    : constrainedEligible && !trainingSharedEligible ? 12 : 6;
  if (availableMemoryBytes < minimumMemoryGiB * 1024 ** 3) {
    reasons.push(`available_memory_below_${minimumMemoryGiB}_gib`);
  }
  // CPU rendering still allocates native buffers; retain the existing render
  // reserve. Only the lighter remote-authoring phase has its own admission.
  const minimumSwapGiB = preparationOnly ? 2 : lowMemoryProfile || (constrainedEligible && !trainingSharedEligible) ? 8 : 4;
  if (swapFreeBytes < minimumSwapGiB * 1024 ** 3) {
    reasons.push(`free_swap_below_${minimumSwapGiB}_gib`);
  }
  if (activeRenderProcesses.length) reasons.push('another_render_is_active');
  if (!preparationOnly && trainingSharedEligible && !softwareEligible) {
    // Compute utilization is not VRAM exhaustion. A single low-priority
    // renderer may share the training GPU while reserving two GiB of VRAM.
    const freeVram = gpu.gpuMemoryTotalBytes - gpu.gpuMemoryUsedBytes;
    if (gpu.gpuMemoryTotalBytes === null || gpu.gpuMemoryUsedBytes === null) reasons.push('shared_gpu_memory_unavailable');
    else if (freeVram < 2 * 1024 ** 3) reasons.push('shared_gpu_free_memory_below_2_gib');
  } else if (!preparationOnly && !softwareEligible && gpu.gpuBusyPercent !== null && gpu.gpuBusyPercent >= (constrainedEligible ? 80 : 100)) {
    reasons.push(constrainedEligible ? 'gpu_above_constrained_limit' : 'gpu_at_full_utilization');
  }
  const vendor = fs.existsSync('/sys/class/drm/card0/device/vendor')
    ? fs.readFileSync('/sys/class/drm/card0/device/vendor', 'utf8').trim() : 'gpu-unknown';
  const hardwareClass = `${os.platform()}-${os.arch()}-${logicalCpus}cpu-${vendor}`;
  const renderSafe = reasons.length === 0;
  return {
    status: renderSafe ? 'pass' : 'blocked', renderSafe, observedAt: new Date().toISOString(),
    logicalCpus, hostLogicalCpus, processPriority, constrainedRequested,
    constrainedEligible, trainingSharedRequested, trainingSharedEligible,
    softwareRequested, softwareEligible,
    preparationOnly,
    loadAverageLimit, loadAverage, availableMemoryBytes, swapFreeBytes,
    activeRenderProcesses, ...gpu, hardwareClass, reasons
  };
}

function safeJobId(value) {
  return String(value || 'unassigned').replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '').slice(0, 100) || 'unassigned';
}

async function persistRenderTimingRecord(record, directory = path.join(__dirname, '..', 'data', 'reports', 'performance', 'render-timings')) {
  const dir = path.resolve(directory);
  await fsp.mkdir(dir, { recursive: true });
  const started = Date.parse(record.startedAt || '') || Date.now();
  const file = path.join(dir, `${safeJobId(record.jobId)}-${started}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await fsp.rename(temporary, file);
  return file;
}

async function loadRenderTimingHistory(directory = path.join(__dirname, '..', 'data', 'reports', 'performance', 'render-timings')) {
  const dir = path.resolve(directory);
  const files = await fsp.readdir(dir).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  const records = [];
  for (const file of files.filter(name => name.endsWith('.json')).sort()) {
    try {
      const value = JSON.parse(await fsp.readFile(path.join(dir, file), 'utf8'));
      if (value?.schemaVersion === SCHEMA_VERSION) records.push(value);
    } catch { /* Ignore an incomplete or unrelated report, never fabricate history. */ }
  }
  return records;
}

module.exports = {
  SCHEMA_VERSION,
  createRenderTimingRecord,
  estimateRenderTiming,
  normalizeHardwareGate,
  probeRenderHardwareGate,
  persistRenderTimingRecord,
  loadRenderTimingHistory,
  safeJobId,
  isActiveRenderCommand
};
