'use strict';

const crypto = require('node:crypto');
const nodeFs = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getMediaDuration } = require('./ffmpeg');
const { HyperFramesVideoRenderer, HYPERFRAMES_VERSION, runCommand, assertSafeVisualRebuildOutput,
  selectCaptureProfile } = require('./hyperframes-video-renderer');
const { selectThemePalette } = require('./theme-visuals');
const { VISUAL_DESIGN_TOKENS } = require('./visual-design-tokens');
const { createRenderTimingRecord, estimateRenderTiming, probeRenderHardwareGate,
  persistRenderTimingRecord, loadRenderTimingHistory } = require('./render-timing');

const ROOT = path.join(__dirname, '..');
const REMOTION_PROJECT = path.join(ROOT, 'experiments', 'remotion-motion-review');
const REMOTION_PUBLIC = path.join(REMOTION_PROJECT, 'public');
const REMOTION_BIN = path.join(REMOTION_PROJECT, 'node_modules', '.bin', 'remotion');
const ROBOT_ASSET = path.join(REMOTION_PUBLIC, 'pulso-story', 'approved-robot-rigged.glb');
const ROBOT_SHA256 = '6a9eb38d99229ac5519bb2900bda50df462b6d4eed411daa2a872e41fbc48df5';
const REMOTION_VERSION = '4.0.537';
const RENDER_TIMEOUT_MS = 180 * 60 * 1000;

function buildNarrativeGestureCues(presenterPlan, fps, durationMs) {
  if (!Array.isArray(presenterPlan) || !presenterPlan.length || !Number.isFinite(fps) || fps <= 0) {
    throw new TypeError('plano do apresentador e fps são obrigatórios para criar cues Remotion');
  }
  const visible = presenterPlan.filter(shot => shot.presenter && !shot.hidden);
  if (!visible.length) return {};
  const frameAt = shot => Math.max(0, Math.round(((Number(shot.startMs) || 0) / 1000) * fps));
  const hook = visible.find(shot => shot.groupKind === 'hook') || visible[0];
  const conclusion = [...visible].reverse().find(shot => shot.groupKind === 'conclusion') || visible.at(-1);
  const sections = visible.filter((shot, index, items) => shot.groupKind === 'section'
    && !items.slice(0, index).some(previous => previous.groupIndex === shot.groupIndex));
  const pickSection = ratio => sections.length
    ? sections[Math.min(sections.length - 1, Math.floor(ratio * sections.length))]
    : visible[Math.round(ratio * (visible.length - 1))];
  const within = shot => Math.min(frameAt(shot) + Math.round(fps * 0.45),
    Math.max(0, Math.round((durationMs / 1000) * fps) - 1));

  const candidates = [
    ['hook', hook],
    ['explain', pickSection(0.12)],
    ['point', pickSection(0.34)],
    ['compare', pickSection(0.56)],
    ['emphasize', pickSection(0.78)],
    ['conclusion', conclusion]
  ];
  const cues = {};
  let lastFrame = -Infinity;
  for (const [name, shot] of candidates) {
    const frame = within(shot);
    if (frame - lastFrame < Math.max(1, Math.round(fps * 0.85))) continue;
    cues[name] = frame;
    lastFrame = frame;
  }
  return cues;
}

function toRemotionShots(presenterPlan, fps) {
  if (!Array.isArray(presenterPlan)) throw new TypeError('presenterPlan deve ser um array');
  return presenterPlan.map(shot => ({
    startFrame: Math.max(0, Math.round((Number(shot.startMs) || 0) * fps / 1000)),
    durationInFrames: Math.max(1, Math.round((Number(shot.durationMs) || 1) * fps / 1000)),
    presenter: Boolean(shot.presenter),
    hidden: Boolean(shot.hidden),
    side: shot.side === 'left' ? 'left' : 'right',
    framing: ['full', 'medium', 'close'].includes(shot.framing) ? shot.framing : 'full'
  }));
}

async function copyOrLink(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.link(source, target);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    await fs.copyFile(source, target);
  }
}

class RemotionStoryVideoRenderer {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.fps = Math.max(12, Number(options.fps || process.env.ANIMATED_FPS || 24));
    this.width = Number(options.width || process.env.ANIMATED_WIDTH || 1920);
    this.height = Number(options.height || process.env.ANIMATED_HEIGHT || 1080);
    this.quality = options.quality || 'high';
    this.sceneRenderer = options.sceneRenderer || new HyperFramesVideoRenderer({
      logger: this.logger, fps: this.fps, width: this.width, height: this.height,
      quality: this.quality, captureProfile: options.captureProfile
    });
  }

  async render({ script, audioPath, outputPath, images = {}, validateOnly = false,
    onScenePlan = null, visualCritiqueManifestPath = null, visualCritiqueManifestSha256 = null,
    jobId = null }) {
    if (Boolean(visualCritiqueManifestPath) !== Boolean(visualCritiqueManifestSha256)) {
      throw new TypeError('visual critique requires both a QA manifest path and SHA-256');
    }
    outputPath = path.resolve(outputPath);
    audioPath = path.resolve(audioPath);
    if (validateOnly) {
      return this.sceneRenderer.render({ script, audioPath, outputPath, images, validateOnly: true,
        includePresenter: false, onScenePlan, visualCritiqueManifestPath, visualCritiqueManifestSha256 });
    }
    if (visualCritiqueManifestPath) {
      const { loadVisualRebuildCritique } = require('./video-qa-review');
      const critique = await loadVisualRebuildCritique({
        root: ROOT,
        manifestPath: visualCritiqueManifestPath,
        expectedManifestSha256: visualCritiqueManifestSha256
      });
      await assertSafeVisualRebuildOutput(outputPath, critique.sourceMasterPath);
    }
    if (!await fs.stat(REMOTION_BIN).then(stat => stat.isFile()).catch(() => false)) {
      throw new Error(`CLI local do Remotion não está instalado: ${REMOTION_BIN}`);
    }
    const robotBytes = await fs.readFile(ROBOT_ASSET);
    const robotHash = crypto.createHash('sha256').update(robotBytes).digest('hex');
    if (robotHash !== ROBOT_SHA256) throw new Error(`hash do GLB aprovado não confere (${robotHash})`);
    if (!robotBytes.length) throw new Error('GLB aprovado está vazio');
    const runtimeId = `${Date.now()}-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
    const renderJobId = jobId || runtimeId;

    let hardwareGate;
    try {
      hardwareGate = probeRenderHardwareGate();
    } catch (error) {
      hardwareGate = { status: 'unknown', renderSafe: null, observedAt: new Date().toISOString(),
        reasons: ['resource_gate_probe_failed'] };
      const finishedAt = new Date();
      const blockedRecord = createRenderTimingRecord({
        jobId: renderJobId, status: 'blocked', startedAt: finishedAt, finishedAt, wallTimeMs: 0,
        videoDurationSeconds: await getMediaDuration(audioPath).catch(() => null),
        width: this.width, height: this.height, fps: this.fps,
        backend: 'remotion-local-cli+hyperframes-scenes',
        captureProfile: this.sceneRenderer.captureProfile || 'auto', quality: this.quality,
        rendererVersion: `remotion-${REMOTION_VERSION}+hyperframes-${HYPERFRAMES_VERSION}`,
        hardwareClass: null, hardwareGate
      });
      await persistRenderTimingRecord(blockedRecord).catch(() => {});
      throw Object.assign(new Error(`Gate local de recursos não pôde ser lido: ${error.message}`), {
        code: 'RENDER_RESOURCE_GATE_UNAVAILABLE', preflight: hardwareGate
      });
    }
    if (!hardwareGate.renderSafe) {
      const now = new Date();
      const blockedRecord = createRenderTimingRecord({
        jobId: renderJobId, status: 'blocked', startedAt: now, finishedAt: now, wallTimeMs: 0,
        videoDurationSeconds: await getMediaDuration(audioPath).catch(() => null),
        width: this.width, height: this.height, fps: this.fps,
        backend: 'remotion-local-cli+hyperframes-scenes',
        captureProfile: this.sceneRenderer.captureProfile || 'auto', quality: this.quality,
        rendererVersion: `remotion-${REMOTION_VERSION}+hyperframes-${HYPERFRAMES_VERSION}`,
        hardwareClass: hardwareGate.hardwareClass, hardwareGate
      });
      await persistRenderTimingRecord(blockedRecord).catch(error =>
        this.logger.warn(`gate fechado; relatório não salvo (${error.code || error.name})`));
      throw Object.assign(new Error(`Render local adiado pelo gate de recursos: ${(hardwareGate.reasons || []).join(', ')}`), {
        code: 'HOST_RESOURCE_GATE', preflight: hardwareGate
      });
    }

    const videoDurationSeconds = await getMediaDuration(audioPath).catch(() => null);
    const gpuExpected = process.env.HYPERFRAMES_GPU !== '0'
      && nodeFs.existsSync('/dev/dri/renderD128')
      && (hardwareGate.gpuBusyPercent === null || hardwareGate.gpuBusyPercent < 100);
    const predictedCapture = selectCaptureProfile({ requested: this.sceneRenderer.captureProfile || 'auto',
      useGpu: gpuExpected, width: this.width, height: this.height, totalMemory: os.totalmem(), freeMemory: os.freemem() });
    const predictedBackend = `remotion-local-cli+hyperframes-${gpuExpected ? 'gpu' : 'cpu'}`;
    const predictedCaptureProfile = `remotion-cli-concurrency-1+hyperframes-${predictedCapture}`;
    const rendererVersion = `remotion-${REMOTION_VERSION}+hyperframes-${HYPERFRAMES_VERSION}`;
    const history = await loadRenderTimingHistory().catch(() => []);
    const estimate = estimateRenderTiming({ history, target: {
      videoDurationSeconds, width: this.width, height: this.height, fps: this.fps,
      backend: predictedBackend, captureProfile: predictedCaptureProfile,
      quality: this.quality, rendererVersion, hardwareClass: hardwareGate.hardwareClass, hardwareGate
    } });
    this.logger.info(estimate.status === 'estimated_from_compatible_history'
      ? `ETA local observada: ${estimate.estimatedWallTimeSeconds.toFixed(1)} s (histórico compatível: ${estimate.sampleCount}; faixa ${estimate.observedWallTimeRangeSeconds.min.toFixed(1)}–${estimate.observedWallTimeRangeSeconds.max.toFixed(1)} s)`
      : 'ETA local indisponível: ainda não há render concluído com configuração e gate compatíveis');

    const startedAt = new Date();
    const startedMonotonic = process.hrtime.bigint();
    let renderStatus = 'failed';
    let renderFailure = null;
    let sceneRenderMetadata = null;
    const jobPublicDir = path.join(REMOTION_PUBLIC, '_runtime', runtimeId);
    const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-remotion-'));
    const platePath = path.join(stageDir, 'scene-plate.mp4');
    const stagedPlatePath = path.join(jobPublicDir, 'scene-plate.mp4');
    const propsPath = path.join(stageDir, 'input-props.json');
    let compositionPlan = null;

    try {
      this.logger.info('HyperFrames: montando a camada narrativa; o apresentador 3D será composto pelo Remotion');
      await this.sceneRenderer.render({
        script, audioPath, outputPath: platePath, images,
        includePresenter: false,
        recordImageUsage: false,
        onScenePlan,
        visualCritiqueManifestPath,
        visualCritiqueManifestSha256,
        onCompositionPlan: plan => { compositionPlan = plan; },
        onRenderMetadata: metadata => { sceneRenderMetadata = metadata; }
      });
      if (!compositionPlan?.presenterPlan?.length) throw new Error('HyperFrames não forneceu o plano temporal do apresentador');

      await copyOrLink(platePath, stagedPlatePath);
      const fps = compositionPlan.fps || this.fps;
      const width = compositionPlan.width || this.width;
      const height = compositionPlan.height || this.height;
      const durationInFrames = Math.max(1, Math.ceil((compositionPlan.durationMs / 1000) * fps));
      const seed = Number.isSafeInteger(script.seed) && script.seed >= 0 ? script.seed : 0;
      const palette = selectThemePalette(script.visualPalettes, seed);
      const accents = Array.isArray(palette?.accents) && palette.accents.length
        ? palette.accents
        : VISUAL_DESIGN_TOKENS.presenter.fallbackAccents;
      const props = {
        backgroundSrc: `_runtime/${runtimeId}/scene-plate.mp4`,
        robotSrc: 'pulso-story/approved-robot-rigged.glb',
        width, height, fps, durationInFrames,
        shots: toRemotionShots(compositionPlan.presenterPlan, fps),
        accents,
        lipSyncEnvelope: compositionPlan.speechEnvelope.levels,
        lipSyncStepMs: compositionPlan.speechEnvelope.stepMs,
        gestureCues: buildNarrativeGestureCues(compositionPlan.presenterPlan, fps, compositionPlan.durationMs)
      };
      await fs.writeFile(propsPath, JSON.stringify(props), { mode: 0o600, flag: 'wx' });
      this.logger.info(`Remotion ${REMOTION_VERSION}: composição final ${width}x${height}, ${fps} fps, ${(durationInFrames / fps).toFixed(2)} s`);
      await runCommand(REMOTION_BIN, [
        'render', 'src/index.ts', 'NarrativeComposite', outputPath,
        `--props=${propsPath}`, `--fps=${fps}`, `--width=${width}`, `--height=${height}`,
        '--codec=h264', '--concurrency=1', '--log=info'
      ], {
        cwd: REMOTION_PROJECT,
        env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=8192' },
        logger: this.logger,
        label: 'remotion-narrative-render',
        timeoutMs: RENDER_TIMEOUT_MS
      });
      const [outputStat, renderedDuration] = await Promise.all([
        fs.stat(outputPath), getMediaDuration(outputPath)
      ]);
      if (outputStat.size < 64 * 1024 || !Number.isFinite(renderedDuration)
        || Math.abs(renderedDuration - compositionPlan.durationMs / 1000) > Math.max(0.35, 2 / fps)) {
        throw new Error(`Remotion produziu um arquivo inválido ou duração incompatível (${renderedDuration}s, ${outputStat.size} bytes)`);
      }
      const { recordImageLibraryUsage } = require('./image-library');
      const imageSha256s = compositionPlan.imageSha256s || [];
      if (imageSha256s.length) {
        await recordImageLibraryUsage({ sha256s: imageSha256s, artifactPath: outputPath })
          .catch(error => this.logger.warn(`uso das imagens não registrado; mídia preservada (${error.code || error.name})`));
      }
      this.logger.info(`Remotion finalizou: ${outputPath} (${renderedDuration.toFixed(2)} s)`);
      renderStatus = 'completed';
      return outputPath;
    } catch (error) {
      renderFailure = error;
      renderStatus = error.code === 'HYPERFRAMES_TIMEOUT' || error.code === 'COMMAND_TIMEOUT' ? 'timed_out' : 'failed';
      throw error;
    } finally {
      await fs.rm(jobPublicDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
      const finishedAt = new Date();
      const wallTimeMs = Number(process.hrtime.bigint() - startedMonotonic) / 1e6;
      const actualBackend = `remotion-local-cli+hyperframes-${sceneRenderMetadata?.backend || (gpuExpected ? 'gpu' : 'cpu')}`;
      const actualCaptureProfile = `remotion-cli-concurrency-1+hyperframes-${sceneRenderMetadata?.captureProfile || predictedCapture}`;
      const record = createRenderTimingRecord({
        jobId: renderJobId, status: renderStatus, startedAt, finishedAt, wallTimeMs,
        videoDurationSeconds: compositionPlan?.durationMs
          ? compositionPlan.durationMs / 1000 : videoDurationSeconds,
        width: compositionPlan?.width || this.width, height: compositionPlan?.height || this.height,
        fps: compositionPlan?.fps || this.fps,
        backend: actualBackend, captureProfile: actualCaptureProfile, quality: this.quality,
        rendererVersion, hardwareClass: hardwareGate.hardwareClass, hardwareGate,
        attempts: [{
          backend: `hyperframes-${sceneRenderMetadata?.backend || (gpuExpected ? 'gpu' : 'cpu')}`,
          captureProfile: sceneRenderMetadata?.captureProfile || predictedCapture,
          quality: this.quality, status: renderStatus, startedAt, finishedAt, wallTimeMs,
          ...(renderFailure ? { errorCode: String(renderFailure.code || renderFailure.name).slice(0, 100) } : {})
        }]
      });
      await persistRenderTimingRecord(record).catch(error =>
        this.logger.warn(`tempo de render não registrado (${error.code || error.name})`));
      this.logger.info(`tempo total de render: ${(wallTimeMs / 1000).toFixed(1)} s; estado ${renderStatus}`);
    }
  }
}

module.exports = {
  RemotionStoryVideoRenderer,
  REMOTION_VERSION,
  buildNarrativeGestureCues,
  toRemotionShots
};
