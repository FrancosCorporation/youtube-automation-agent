'use strict';

const crypto = require('node:crypto');
const nodeFs = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getMediaDuration } = require('./ffmpeg');
const { mixdownAudio, buildSfxEvents, deriveMood } = require('./audio-mix');
const { withProcessFileLock } = require('./process-file-lock');
const { runCommand } = require('./hyperframes-video-renderer');
const { probeRenderHardwareGate, createRenderTimingRecord, persistRenderTimingRecord } = require('./render-timing');
const { selectThemePalette } = require('./theme-visuals');
const { VISUAL_DESIGN_TOKENS } = require('./visual-design-tokens');
const { APPROVED_ROBOT_SRC, assertNarrativeEpisodeProps } = require('./narrative-episode-props');
const {
  ROOT, narrativePlanInputSha256, sha256, stableJson,
  validateNarrativeEpisodePlan, verifyNarrativeEpisodeAssets
} = require('./narrative-episode-plan');

const REMOTION_PROJECT = path.join(ROOT, 'experiments', 'remotion-motion-review');
const REMOTION_PUBLIC = path.join(REMOTION_PROJECT, 'public');
const REMOTION_BIN = path.join(REMOTION_PROJECT, 'node_modules', '.bin', 'remotion');
const ROBOT_ASSET = path.join(REMOTION_PUBLIC, 'pulso-story', 'approved-robot-rigged.glb');
const ROBOT_SHA256 = '6a9eb38d99229ac5519bb2900bda50df462b6d4eed411daa2a872e41fbc48df5';
const REMOTION_VERSION = '4.0.537';
const RENDER_TIMEOUT_MS = 180 * 60 * 1000;
// Component changes alter pixels and timing; do not resume an old-format
// master alongside a newly rendered aspect under the same render identity.
const NARRATIVE_COMPONENT_REVISION = 'NarrativeEpisode-v2.16';

function safeId(value) {
  return String(value || 'episode').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'episode';
}

function narrativeRenderStatePath(root, stateDir, jobId) {
  return path.join(path.resolve(root, stateDir || 'data/state'), 'narrative-renders', `${safeId(jobId)}.json`);
}

async function hashFile(filePath) {
  return sha256(await fs.readFile(filePath));
}

async function atomicJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

async function readState(filePath) {
  try {
    const state = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return state && typeof state === 'object' && !Array.isArray(state) ? state : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw Object.assign(new Error('estado do render narrativo inválido; preservado para revisão'), {
      code: 'NARRATIVE_RENDER_STATE_INVALID', cause: error
    });
  }
}

function assertManagedOutput(filePath) {
  const absolute = path.resolve(filePath);
  const managed = path.join(ROOT, 'data', 'videos');
  const relative = path.relative(managed, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`master narrativo fora de data/videos: ${absolute}`);
  }
  return absolute;
}

function assertRenderCapacity(hardwareGate = probeRenderHardwareGate({ lowMemoryContinuation: true })) {
  if (!hardwareGate?.renderSafe) {
    const reasons = Array.isArray(hardwareGate?.reasons) && hardwareGate.reasons.length
      ? hardwareGate.reasons.join(', ') : 'host_resources_unavailable';
    throw Object.assign(new Error(`render narrativo bloqueado pelo gate: ${reasons}`), {
      code: 'HOST_RESOURCE_GATE', preflight: hardwareGate || null
    });
  }
  return hardwareGate;
}

function memoryBoundedNodeOptions(currentOptions, availableMemoryBytes) {
  const availableMiB = Math.floor(Number(availableMemoryBytes) / 1024 ** 2);
  const heapLimitMiB = process.env.PULSO_RENDER_WITH_TRAINING === '1' ? 2048 : 8192;
  const safeHeapMiB = Math.max(2048, Math.min(heapLimitMiB, availableMiB - 2048));
  const options = String(currentOptions || '').replace(/(?:^|\s)--max-old-space-size(?:=|\s+)\d+/g, ' ').trim();
  return { value: `${options} --max-old-space-size=${safeHeapMiB}`.trim(), heapMiB: safeHeapMiB };
}

function lowMemoryRenderCheck() {
  const info = nodeFs.readFileSync('/proc/meminfo', 'utf8');
  const bytes = key => Number(info.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] || 0) * 1024;
  const memory = bytes('MemAvailable');
  const swap = bytes('SwapFree');
  if (memory >= 2.5 * 1024 ** 3 && swap >= 4 * 1024 ** 3) return null;
  return Object.assign(new Error('reserva de memória ou swap baixa durante render'), { code: 'HOST_RESOURCE_GATE' });
}

function lowMemoryMonitorOptions() {
  return lowMemoryTrainingMode()
    ? { resourceCheck: lowMemoryRenderCheck, resourceCheckIntervalMs: 5000 } : {};
}

function lowMemoryTrainingMode() {
  return process.env.PULSO_RENDER_LOW_MEMORY === '1' && process.env.PULSO_RENDER_WITH_TRAINING === '1';
}

function buildNarrativeBundleArgs(bundleDir) {
  return ['bundle', 'src/index.ts', `--out-dir=${bundleDir}`, `--public-dir=${REMOTION_PUBLIC}`, '--log=info'];
}

function buildNarrativeRenderArgs({ bundleDir, propsPath, outputPath, fps, width, height, gl }) {
  const args = [
    'render', bundleDir, 'NarrativeEpisode', outputPath,
    `--props=${propsPath}`, `--fps=${fps}`, `--width=${width}`,
    `--height=${height}`, '--codec=h264', '--audio-codec=aac',
    '--pixel-format=yuv420p', '--crf=18', '--concurrency=1', '--log=info'
  ];
  if (lowMemoryTrainingMode()) args.push('--disallow-parallel-encoding');
  if (gl) args.push(`--gl=${gl}`);
  return args;
}

async function hashBundleDirectory(bundleDir) {
  const hash = crypto.createHash('sha256');
  const files = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(bundleDir, absolute).split(path.sep).join('/');
      if (relative.split('/').includes('_runtime')) continue;
      if (entry.isSymbolicLink()) throw Object.assign(new Error(`symlink inesperado no bundle: ${relative}`), {
        code: 'NARRATIVE_BUNDLE_INVALID'
      });
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push({ absolute, relative });
    }
  }
  await visit(bundleDir);
  if (!files.length) throw Object.assign(new Error('bundle narrativo vazio'), { code: 'NARRATIVE_BUNDLE_INVALID' });
  for (const file of files) {
    let bytes = await fs.readFile(file.absolute);
    if (file.relative === 'index.html') {
      // Remotion embeds the public-file inventory in index.html, including
      // regenerated _runtime filenames and mtimes. Those assets are staged
      // per job and verified separately; their inventory is not renderer code.
      const html = bytes.toString('utf8').replace(
        /(window\.remotion_staticFiles\s*=\s*)(\[[^\n]*\])(\.map\()/,
        (_match, prefix, json, suffix) => {
          const entries = JSON.parse(json);
          if (!Array.isArray(entries) || entries.some(item => !item || typeof item.name !== 'string')) {
            throw Object.assign(new Error('inventário público Remotion inválido'), { code: 'NARRATIVE_BUNDLE_INVALID' });
          }
          return `${prefix}${JSON.stringify(entries.filter(item => !item.name.startsWith('_runtime/')))}${suffix}`;
        }
      );
      bytes = Buffer.from(html, 'utf8');
    }
    hash.update(file.relative);
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function remainingRenderTimeout(deadlineAt, label) {
  const remaining = deadlineAt - Date.now();
  if (remaining > 0) return remaining;
  throw Object.assign(new Error(`render narrativo excedeu o prazo total durante ${label}`), {
    code: 'HYPERFRAMES_TIMEOUT', stage: label
  });
}

async function copyAsset(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  try { await fs.link(source, destination); }
  catch (error) {
    if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    await fs.copyFile(source, destination, nodeFs.constants.COPYFILE_EXCL);
  }
}

async function readMatchingCompletion(state, aspect, outputPath, inputSha256) {
  const record = state?.completed?.[aspect];
  if (state?.inputSha256 !== inputSha256 || record?.path !== outputPath) return null;
  const stat = await fs.stat(outputPath).catch(() => null);
  if (!stat?.isFile() || stat.size < 64 * 1024) return null;
  const actualHash = await hashFile(outputPath);
  const duration = await getMediaDuration(outputPath).catch(() => null);
  if (actualHash !== record.sha256 || !Number.isFinite(duration) || Math.abs(duration - record.durationSeconds) > 0.35) return null;
  return { ...record, sizeBytes: stat.size };
}

function sfxScenePlan(plan) {
  const chapterById = new Map(plan.chapters.map(chapter => [chapter.id, chapter]));
  const actionComponentType = {
    travel: 'node-graph', 'reveal-part': 'kinetic-number', transform: 'spec-chips',
    rearrange: 'rotation-cards', compare: 'compare-table'
  };
  return plan.scenes.map(scene => ({
    durationMs: scene.durationInFrames * 1000 / plan.fps,
    groupKind: chapterById.get(scene.chapterId)?.kind || 'section',
    groupTitle: scene.title,
    components: scene.actions.map(action => ({
      type: actionComponentType[action.kind] || 'highlight',
      revealAtMs: Math.max(0, (action.startFrame - scene.startFrame) * 1000 / plan.fps)
    }))
  }));
}

class NarrativeEpisodeRenderer {
  constructor({ logger = console, timeoutMs = RENDER_TIMEOUT_MS } = {}) {
    this.logger = logger;
    this.timeoutMs = timeoutMs;
  }

  async renderEpisode({ plan, audioPath, outputPath, portraitOutputPath = null } = {}) {
    const validation = validateNarrativeEpisodePlan(plan);
    if (!validation.valid) throw Object.assign(new Error(`plano narrativo inválido: ${validation.errors.join(', ')}`), {
      code: 'NARRATIVE_EPISODE_PLAN_INVALID', errors: validation.errors
    });
    outputPath = assertManagedOutput(outputPath);
    portraitOutputPath = assertManagedOutput(portraitOutputPath || outputPath.replace(/\.mp4$/i, '-portrait.mp4'));
    if (outputPath === portraitOutputPath) throw new Error('masters horizontal e vertical precisam de caminhos diferentes');
    if (!await fs.stat(REMOTION_BIN).then(stat => stat.isFile()).catch(() => false)) {
      throw new Error(`CLI local do Remotion não está instalado: ${REMOTION_BIN}`);
    }
    await verifyNarrativeEpisodeAssets(plan);
    const audioStat = await fs.lstat(audioPath);
    if (!audioStat.isFile() || audioStat.isSymbolicLink() || await hashFile(audioPath) !== plan.narrationSha256) {
      throw Object.assign(new Error('áudio de narração ausente, alterado ou não regular'), { code: 'NARRATIVE_AUDIO_INTEGRITY_FAILED' });
    }
    const robotHash = await hashFile(ROBOT_ASSET);
    if (robotHash !== ROBOT_SHA256) throw Object.assign(new Error('hash do GLB aprovado não confere'), {
      code: 'NARRATIVE_ROBOT_INTEGRITY_FAILED'
    });
    if (plan.inputSha256 !== narrativePlanInputSha256(plan)) throw Object.assign(new Error('hash das entradas do plano narrativo não confere'), {
      code: 'NARRATIVE_PLAN_HASH_MISMATCH'
    });

    const statePath = narrativeRenderStatePath(ROOT, process.env.STATE_DIR, plan.jobId);
    const lockPath = path.join(ROOT, 'data', 'state', 'narrative-render.lock');
    return withProcessFileLock(() => this.#renderLocked({
      plan, audioPath: path.resolve(audioPath), outputPath, portraitOutputPath, statePath
    }), { lockPath, owner: `narrative-episode-${safeId(plan.jobId)}`, timeoutMs: this.timeoutMs });
  }

  async #renderLocked({ plan, audioPath, outputPath, portraitOutputPath, statePath }) {
    const hardwareGate = probeRenderHardwareGate({ lowMemoryContinuation: true });
    if (!hardwareGate.renderSafe) {
      const now = new Date();
      const reason = Array.isArray(hardwareGate.reasons) && hardwareGate.reasons.length
        ? hardwareGate.reasons.join(', ') : 'host_resources_unavailable';
      const record = createRenderTimingRecord({
        jobId: plan.jobId, status: 'blocked', startedAt: now, finishedAt: now, wallTimeMs: 0,
        videoDurationSeconds: plan.durationInFrames / plan.fps,
        width: 1920, height: 1080, fps: plan.fps, backend: 'remotion-local-narrative-episode',
        captureProfile: process.env.PULSO_REMOTION_GL || 'remotion-default', quality: 'high',
        rendererVersion: `remotion-${REMOTION_VERSION}+${NARRATIVE_COMPONENT_REVISION}`,
        hardwareClass: hardwareGate.hardwareClass, hardwareGate,
        attempts: [{ backend: 'remotion-local-narrative-episode',
          captureProfile: process.env.PULSO_REMOTION_GL || 'remotion-default', quality: 'high',
          status: 'blocked', startedAt: now, finishedAt: now, wallTimeMs: 0, errorCode: 'HOST_RESOURCE_GATE' }]
      });
      await persistRenderTimingRecord(record).catch(error => this.logger.warn?.(`gate fechado; relatório não salvo (${error.code || error.name})`));
      throw Object.assign(new Error(`render narrativo bloqueado pelo gate: ${reason}`), {
        code: 'HOST_RESOURCE_GATE', preflight: hardwareGate
      });
    }
    const deadlineAt = Date.now() + this.timeoutMs;
    const stableRuntimeInput = sha256(Buffer.from(stableJson({
      plan: plan.inputSha256, renderer: REMOTION_VERSION, componentRevision: NARRATIVE_COMPONENT_REVISION
    })));
    const episodePlanSha256 = sha256(Buffer.from(stableJson(plan)));
    const rendererVersion = `remotion-${REMOTION_VERSION}+${NARRATIVE_COMPONENT_REVISION}`;
    const runtimeId = `${safeId(plan.jobId)}-${stableRuntimeInput.slice(0, 12)}`;
    const publicRuntimeDir = path.join(REMOTION_PUBLIC, '_runtime', runtimeId);
    // Sequential encoding writes intermediate frames to TMPDIR. Keep them on
    // disk instead of the host's RAM-backed /tmp when sharing with training.
    const tempRoot = lowMemoryTrainingMode() ? path.join(ROOT, 'data', 'render-tmp') : os.tmpdir();
    await fs.mkdir(tempRoot, { recursive: true, mode: 0o700 });
    const workDir = await fs.mkdtemp(path.join(tempRoot, 'pulso-narrative-remotion-'));
    const propsPath = path.join(workDir, 'props.json');
    const bundleDir = path.join(workDir, 'bundle');
    const stagedEpisode = JSON.parse(JSON.stringify(plan));
    const assetById = new Map();
    const targets = {
      landscape: { path: outputPath, width: 1920, height: 1080 },
      portrait: { path: portraitOutputPath, width: 1080, height: 1920 }
    };
    const startedAt = new Date();
    const startedMonotonic = process.hrtime.bigint();
    let status = 'completed';
    let failure = null;
    let activeHardwareGate = hardwareGate;
    let temporaryOutputPath = null;
    let state = null;
    let outputs = null;
    let inputSha256 = null;
    let bundleSha256 = null;
    let bundleDurationMs = null;
    try {
      await fs.rm(publicRuntimeDir, { recursive: true, force: true });
      await fs.mkdir(publicRuntimeDir, { recursive: true, mode: 0o700 });
      for (const asset of plan.assets || []) {
        const source = path.resolve(ROOT, asset.managedPath);
        const extension = path.extname(asset.managedPath).toLowerCase() || '.bin';
        const targetRel = `_runtime/${runtimeId}/assets/${asset.id}${extension}`;
        await copyAsset(source, path.join(REMOTION_PUBLIC, targetRel));
        assetById.set(asset.id, targetRel);
      }
      stagedEpisode.assets = stagedEpisode.assets.map(asset => ({ ...asset, managedPath: assetById.get(asset.id) }));
      delete stagedEpisode.speechEnvelope;
      delete stagedEpisode.speechEnvelopeSha256;
      const sfxEvents = buildSfxEvents(sfxScenePlan(plan));
      const mixedAudio = await mixdownAudio({
        narrationPath: audioPath, mood: deriveMood(plan.title), seed: plan.seed,
        workDir, sfxEvents
      });
      const mixedDuration = await getMediaDuration(mixedAudio.path);
      if (!Number.isFinite(mixedDuration) || Math.abs(mixedDuration - plan.durationInFrames / plan.fps) > 0.5) {
        throw new Error(`mixagem de áudio divergiu da duração narrada (${mixedDuration}s)`);
      }
      const audioRel = `_runtime/${runtimeId}/episode-audio.m4a`;
      await copyAsset(mixedAudio.path, path.join(REMOTION_PUBLIC, audioRel));

      activeHardwareGate = probeRenderHardwareGate({ lowMemoryContinuation: true });
      assertRenderCapacity(activeHardwareGate);
      const bundleMemory = memoryBoundedNodeOptions(process.env.NODE_OPTIONS, activeHardwareGate.availableMemoryBytes);
      this.logger.info?.(`Remotion bundle: preparando uma revisão compartilhada para os dois formatos; heap ${bundleMemory.heapMiB} MiB`);
      const bundleStartedAt = Date.now();
      await runCommand(REMOTION_BIN, buildNarrativeBundleArgs(bundleDir), {
        cwd: REMOTION_PROJECT,
        env: { ...process.env, NODE_OPTIONS: bundleMemory.value },
        logger: this.logger, label: 'narrative-remotion-bundle',
        ...lowMemoryMonitorOptions(),
        timeoutMs: remainingRenderTimeout(deadlineAt, 'bundle')
      });
      bundleSha256 = await hashBundleDirectory(bundleDir);
      bundleDurationMs = Date.now() - bundleStartedAt;
      inputSha256 = sha256(Buffer.from(stableJson({
        input: plan.inputSha256, scenes: plan.scenes, renderer: REMOTION_VERSION,
        componentRevision: NARRATIVE_COMPONENT_REVISION, bundleSha256
      })));

      const oldState = await readState(statePath);
      const samePlanVersion = oldState?.planInputSha256 === plan.inputSha256
        && oldState?.episodePlanSha256 === episodePlanSha256
        && oldState?.rendererVersion === rendererVersion;
      if (oldState && oldState.inputSha256 !== inputSha256) {
        const oldOutputs = Object.values(oldState.completed || {}).map(record => record?.path).filter(Boolean);
        if (!samePlanVersion && oldOutputs.some(oldPath => oldPath === outputPath || oldPath === portraitOutputPath)) {
          throw Object.assign(new Error('o mesmo caminho contém um render de outra versão; preservar e usar novo caminho'), {
            code: 'NARRATIVE_RENDER_OUTPUT_COLLISION', oldInputSha256: oldState.inputSha256, newInputSha256: inputSha256,
            oldBundleSha256: oldState.bundleSha256, oldOutputs
          });
        }
      }
      state = oldState?.inputSha256 === inputSha256
        ? { ...oldState, planInputSha256: plan.inputSha256, episodePlanSha256, rendererVersion,
          completed: oldState.completed && typeof oldState.completed === 'object' ? oldState.completed : {} }
        : samePlanVersion
          ? { ...oldState, inputSha256, planInputSha256: plan.inputSha256, episodePlanSha256, rendererVersion,
            completed: oldState.completed && typeof oldState.completed === 'object' ? oldState.completed : {} }
          : { schemaVersion: 1, jobId: plan.jobId, inputSha256, planInputSha256: plan.inputSha256,
            episodePlanSha256, rendererVersion, startedAt: new Date().toISOString(), completed: {} };
      state.bundleSha256 = bundleSha256;
      state.bundleDurationMs = bundleDurationMs;
      const landscapeDone = await readMatchingCompletion(state, 'landscape', outputPath, inputSha256);
      const portraitDone = await readMatchingCompletion(state, 'portrait', portraitOutputPath, inputSha256);
      outputs = { landscape: landscapeDone, portrait: portraitDone };
      const palette = selectThemePalette(plan.palette, Number.parseInt(plan.inputSha256.slice(0, 8), 16) || 0);
      const accents = Array.isArray(palette?.accents) && palette.accents.length
        ? palette.accents : VISUAL_DESIGN_TOKENS.presenter.fallbackAccents;
      for (const aspect of ['landscape', 'portrait']) {
        if (outputs[aspect]) {
          this.logger.info?.(`${aspect}: render validado por hash já existe; retomando sem sobrescrever`);
          continue;
        }
        if (await fs.stat(targets[aspect].path).then(() => true).catch(() => false)) {
          throw Object.assign(new Error(`saída existente sem manifesto compatível: ${targets[aspect].path}`), {
            code: 'NARRATIVE_RENDER_OUTPUT_COLLISION'
          });
        }
        activeHardwareGate = probeRenderHardwareGate({ lowMemoryContinuation: true });
        assertRenderCapacity(activeHardwareGate);
        const props = {
          episode: stagedEpisode, audioSrc: audioRel, robotSrc: APPROVED_ROBOT_SRC,
          aspect, width: targets[aspect].width, height: targets[aspect].height,
          fps: plan.fps, durationInFrames: plan.durationInFrames,
          accents, lipSyncEnvelope: plan.speechEnvelope.levels, lipSyncStepMs: plan.speechEnvelope.stepMs, gestureCues: {}
        };
        assertNarrativeEpisodeProps(props);
        await fs.writeFile(propsPath, JSON.stringify(props), { mode: 0o600, flag: 'w' });
        await fs.mkdir(path.dirname(targets[aspect].path), { recursive: true, mode: 0o700 });
        temporaryOutputPath = `${targets[aspect].path}.${runtimeId}.tmp.mp4`;
        await fs.rm(temporaryOutputPath, { force: true });
        this.logger.info?.(`Remotion NarrativeEpisode: ${aspect} ${targets[aspect].width}x${targets[aspect].height}, ${plan.fps} fps, ${(plan.durationInFrames / plan.fps).toFixed(1)} s`);
        const nodeMemory = memoryBoundedNodeOptions(process.env.NODE_OPTIONS, activeHardwareGate.availableMemoryBytes);
        this.logger.info?.(`Remotion heap limitado a ${nodeMemory.heapMiB} MiB para preservar memória do host`);
        await runCommand(REMOTION_BIN, buildNarrativeRenderArgs({
          bundleDir, propsPath, outputPath: temporaryOutputPath, fps: plan.fps,
          width: targets[aspect].width, height: targets[aspect].height, gl: process.env.PULSO_REMOTION_GL
        }), {
          cwd: REMOTION_PROJECT,
          env: { ...process.env, NODE_OPTIONS: nodeMemory.value, ...(lowMemoryTrainingMode() ? { TMPDIR: workDir } : {}) },
          logger: this.logger, label: `narrative-remotion-${aspect}`,
          ...lowMemoryMonitorOptions(),
          timeoutMs: remainingRenderTimeout(deadlineAt, aspect)
        });
        const [stat, durationSeconds, sha] = await Promise.all([
          fs.stat(temporaryOutputPath), getMediaDuration(temporaryOutputPath), hashFile(temporaryOutputPath)
        ]);
        const expectedSeconds = plan.durationInFrames / plan.fps;
        if (!stat.isFile() || stat.size < 64 * 1024 || !Number.isFinite(durationSeconds)
          || Math.abs(durationSeconds - expectedSeconds) > Math.max(0.4, 2 / plan.fps)) {
          throw new Error(`master ${aspect} inválido (${durationSeconds}s; ${stat.size} bytes)`);
        }
        // A same-directory hard link promotes only a fully checked file and
        // fails if another writer created the destination in the meantime.
        await fs.link(temporaryOutputPath, targets[aspect].path);
        await fs.unlink(temporaryOutputPath);
        temporaryOutputPath = null;
        outputs[aspect] = { path: targets[aspect].path, sha256: sha, sizeBytes: stat.size, durationSeconds };
        state.completed[aspect] = outputs[aspect];
        state.updatedAt = new Date().toISOString();
        await atomicJson(statePath, state);
      }
      const result = {
        schemaVersion: 1, jobId: plan.jobId, inputSha256, bundleSha256,
        episodePlanSha256,
        rendererVersion,
        completedAt: new Date().toISOString(), outputs: {
          landscape: state.completed.landscape,
          portrait: state.completed.portrait
        }
      };
      state.outputsSha256 = sha256(Buffer.from(stableJson(result.outputs)));
      state.completedAt = result.completedAt;
      await atomicJson(statePath, state);
      const evidencePath = path.join(ROOT, 'data', 'reports', 'narrative-episodes', `${safeId(plan.jobId)}.json`);
      await atomicJson(evidencePath, { ...result, episodePlan: plan });
      return { ...result.outputs, statePath, evidencePath, inputSha256, bundleSha256, episodePlanSha256: result.episodePlanSha256 };
    } catch (error) {
      status = error.code === 'HYPERFRAMES_TIMEOUT' ? 'timed_out'
        : error.code === 'HOST_RESOURCE_GATE' ? 'blocked' : 'failed';
      failure = error;
      throw error;
    } finally {
      const finishedAt = new Date();
      const wallTimeMs = Number(process.hrtime.bigint() - startedMonotonic) / 1e6;
      const record = createRenderTimingRecord({
        jobId: plan.jobId, status, startedAt, finishedAt, wallTimeMs,
        videoDurationSeconds: plan.durationInFrames / plan.fps,
        width: 1920, height: 1080, fps: plan.fps, backend: 'remotion-local-narrative-episode',
        captureProfile: process.env.PULSO_REMOTION_GL || 'remotion-default', quality: 'high',
        rendererVersion: `remotion-${REMOTION_VERSION}+${NARRATIVE_COMPONENT_REVISION}`,
        hardwareClass: activeHardwareGate.hardwareClass, hardwareGate: activeHardwareGate,
        attempts: [{ backend: 'remotion-local-narrative-episode', captureProfile: process.env.PULSO_REMOTION_GL || 'remotion-default',
          quality: 'high', status, startedAt, finishedAt, wallTimeMs,
          ...(bundleSha256 ? { bundleSha256 } : {}), ...(Number.isFinite(bundleDurationMs) ? { bundleDurationMs } : {}),
          ...(failure ? { errorCode: String(failure.code || failure.name).slice(0, 100) } : {}) }]
      });
      await persistRenderTimingRecord(record).catch(error => this.logger.warn?.(`tempo de render narrativo não registrado (${error.code || error.name})`));
      if (temporaryOutputPath) await fs.rm(temporaryOutputPath, { force: true }).catch(() => {});
      await fs.rm(publicRuntimeDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = {
  NarrativeEpisodeRenderer, REMOTION_PROJECT, REMOTION_PUBLIC, ROBOT_SHA256,
  assertRenderCapacity, buildNarrativeBundleArgs, buildNarrativeRenderArgs, hashBundleDirectory,
  lowMemoryRenderCheck, memoryBoundedNodeOptions, narrativeRenderStatePath, remainingRenderTimeout
};
