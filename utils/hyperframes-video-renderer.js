const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const nodeFs = require('fs');
const crypto = require('crypto');
const { fileURLToPath } = require('node:url');
const { spawn } = require('child_process');
const { getMediaDuration } = require('./ffmpeg');
const { deriveMood } = require('./audio-mix');
const { extractSpeechEnvelope } = require('./speech-envelope');
const { ScenePlanBuilder, resolveVisualTheme } = require('./scene-plan-builder');
const { choosePresenterShot } = require('./presenter-framing');
const { sceneForViewport } = require('./portrait-scene-layout');
const { selectThemePalette } = require('./theme-visuals');
const { VISUAL_DESIGN_TOKENS, sceneCssTokens } = require('./visual-design-tokens');
const { buildScenePlanEvidence, applySceneVisualCritique } = require('./scene-visual-critique');

const ROOT = path.join(__dirname, '..');
const HYPERFRAMES_PROJECT = path.join(ROOT, 'experiments', 'hyperframes-pulso-pilot');
const HYPERFRAMES_VERSION = '0.8.185';
const KIT_DIR = path.join(ROOT, 'assets', 'scenes');
const ROBOT_BUILD_SCRIPT = path.join(HYPERFRAMES_PROJECT, 'scripts', 'build-production-presenter.js');
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_STAGED_IMAGE_BYTES = 180 * 1024 * 1024;
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const ROBOT_BUILD_TIMEOUT_MS = 5 * 60 * 1000;
const CHECK_TIMEOUT_MS = 45 * 60 * 1000;
const RENDER_TIMEOUT_MS = 180 * 60 * 1000;
const PROCESS_KILL_GRACE_MS = 10 * 1000;
const PROCESS_FINALIZE_GRACE_MS = 5 * 1000;
const MAX_CONFIGURED_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const RENDER_QUALITIES = new Set(['draft', 'looks', 'delivery', 'standard', 'high']);
const CAPTURE_PROFILES = new Set(['auto', 'safe', 'native']);
const POINTER_GESTURE_COMPONENTS = new Set([
  'article-print', 'checklist', 'donut-chart', 'kinetic-number', 'line-chart',
  'news-card', 'node-graph', 'progress-bar', 'progressive-comparison',
  'rank-list', 'rotation-cards', 'score-chart', 'spec-chips'
]);

function buildPresenterGestureBeats(scenes, sceneStarts) {
  const beats = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    if (scene.presenter === false) continue;
    const startMs = Number(sceneStarts[index]?.startMs);
    const durationMs = Number(sceneStarts[index]?.durationMs ?? scene.durationMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(durationMs) || durationMs <= 0) continue;

    const pointsAtVisual = (scene.components || []).some(component =>
      POINTER_GESTURE_COMPONENTS.has(component.type));
    const gesture = pointsAtVisual ? 'point'
      : ['hook', 'conclusion'].includes(scene.groupKind) ? 'present' : 'explain';
    const startSeconds = Number((startMs / 1000).toFixed(3));
    const endSeconds = Number(((startMs + durationMs) / 1000).toFixed(3));
    const previous = beats.at(-1);
    if (previous?.gesture === gesture && Math.abs(previous.endSeconds - startSeconds) < 0.001) {
      previous.endSeconds = endSeconds;
    } else {
      beats.push({ startSeconds, endSeconds, gesture });
    }
  }
  return beats;
}

function selectCaptureProfile({ requested = 'auto', useGpu = false, width = 1920, height = 1080,
  totalMemory = os.totalmem(), freeMemory = os.freemem() } = {}) {
  if (!CAPTURE_PROFILES.has(requested)) throw new TypeError(`perfil de captura inválido: ${requested}`);
  const nativeHd = width === 1920 && height === 1080 || width === 1080 && height === 1920;
  if (requested === 'safe' || !useGpu || !nativeHd || !Number.isFinite(totalMemory)
    || !Number.isFinite(freeMemory) || totalMemory < 16 * GIB || freeMemory < 8 * GIB) return 'safe';
  return 'native';
}

function configuredTimeoutMs(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 && value <= MAX_CONFIGURED_TIMEOUT_MS
    ? Math.floor(value)
    : fallback;
}

function buildCheckArgs(workDir) {
  // Let HyperFrames probe the host GPU and fall back when none is available.
  // Forcing SwiftShader makes the robot's WebGL scenes run on CPU during check.
  return ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, 'check', '--timeout=15000', workDir];
}

function buildRenderArgs({ workDir, outputPath, fps, width, height, quality = 'high', useGpu = false, captureProfile = 'safe' }) {
  if (!RENDER_QUALITIES.has(quality)) throw new TypeError(`qualidade HyperFrames inválida: ${quality}`);
  if (!['safe', 'native'].includes(captureProfile)) throw new TypeError(`perfil de captura inválido: ${captureProfile}`);
  if (captureProfile === 'native' && !useGpu) throw new TypeError('captura nativa exige GPU');
  return [
    '--yes', `hyperframes@${HYPERFRAMES_VERSION}`, 'render', workDir,
    `--fps=${fps}`, `--quality=${quality}`, '--workers=1',
    ...(captureProfile === 'native' ? ['--no-low-memory-mode']
      : ['--low-memory-mode', `--resolution=${width > height ? 'landscape' : 'portrait'}`]),
    `--output=${outputPath}`,
    ...(useGpu ? ['--gpu', ...(captureProfile === 'native' ? [] : ['--browser-gpu'])] : ['--no-browser-gpu'])
  ];
}

function processStartTime(pid) {
  try {
    const stat = nodeFs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const commandEnd = stat.lastIndexOf(')');
    return stat.slice(commandEnd + 1).trim().split(/\s+/)[19] || null;
  } catch {
    return null;
  }
}

function childProcessIdentities(rootPid) {
  if (process.platform !== 'linux') return [];
  let entries;
  try {
    entries = nodeFs.readdirSync('/proc').filter(name => /^\d+$/.test(name));
  } catch {
    return [];
  }

  const childrenByParent = new Map();
  for (const name of entries) {
    const pid = Number(name);
    try {
      const status = nodeFs.readFileSync(`/proc/${name}/status`, 'utf8');
      const parentPid = Number(status.match(/^PPid:\s+(\d+)$/m)?.[1]);
      if (!Number.isInteger(parentPid)) continue;
      if (!childrenByParent.has(parentPid)) childrenByParent.set(parentPid, []);
      childrenByParent.get(parentPid).push({ pid, startTime: processStartTime(pid) });
    } catch {
      // Processes can exit while /proc is being scanned.
    }
  }

  const ordered = [];
  const visited = new Set([rootPid]);
  const visit = parentPid => {
    for (const identity of childrenByParent.get(parentPid) || []) {
      if (visited.has(identity.pid)) continue;
      visited.add(identity.pid);
      visit(identity.pid);
      if (identity.startTime) ordered.push(identity);
    }
  };
  visit(rootPid);
  return ordered;
}

function signalProcessIdentities(identities, signal) {
  for (const identity of identities) {
    if (processStartTime(identity.pid) !== identity.startTime) continue;
    try {
      process.kill(identity.pid, signal);
    } catch {
      // A process may exit between checking its identity and signaling it.
    }
  }
}

async function gpuBusyPercent() {
  const drmRoot = '/sys/class/drm';
  let entries;
  try {
    entries = await fs.readdir(drmRoot);
  } catch {
    return null;
  }

  const renderDevice = await fs.realpath(path.join(drmRoot, 'renderD128', 'device')).catch(() => null);
  const readings = [];
  for (const entry of entries.filter(name => /^card\d+$/.test(name))) {
    const deviceRoot = path.join(drmRoot, entry, 'device');
    const [device, vendor, rawBusy] = await Promise.all([
      fs.realpath(deviceRoot).catch(() => null),
      fs.readFile(path.join(deviceRoot, 'vendor'), 'utf8').catch(() => ''),
      fs.readFile(path.join(deviceRoot, 'gpu_busy_percent'), 'utf8').catch(() => '')
    ]);
    const busy = Number.parseFloat(rawBusy.trim());
    if (Number.isFinite(busy) && busy >= 0 && busy <= 100) {
      readings.push({ device, vendor: vendor.trim().toLowerCase(), busy });
    }
  }

  if (!readings.length) return null;
  const matchingRenderNode = renderDevice ? readings.filter(reading => reading.device === renderDevice) : [];
  const amdReadings = readings.filter(reading => reading.vendor === '0x1002');
  const candidates = matchingRenderNode.length ? matchingRenderNode : (amdReadings.length ? amdReadings : readings);
  return Math.max(...candidates.map(reading => reading.busy));
}

async function chooseWorkspaceRoot(outputPath, durationMs, logger) {
  const diskRoot = path.dirname(outputPath);
  const ramRoot = process.env.HYPERFRAMES_TMPDIR || '/dev/shm';
  if (process.env.HYPERFRAMES_RAM_TEMP === '0' || process.platform !== 'linux') return diskRoot;

  try {
    const stat = await fs.statfs(ramRoot);
    const tmpfsFree = Number(stat.bavail) * Number(stat.bsize);
    const estimatedBytes = Math.max(
      768 * MIB,
      Math.ceil((durationMs / 1000) * 2 * MIB) + MAX_STAGED_IMAGE_BYTES + 128 * MIB
    );
    const memoryFree = os.freemem();
    const memoryReserve = 2 * GIB;
    if (tmpfsFree < estimatedBytes || memoryFree < estimatedBytes + memoryReserve) {
      logger.info(`RAM temporária insuficiente (tmpfs ${(tmpfsFree / GIB).toFixed(1)} GiB, memória livre ${(memoryFree / GIB).toFixed(1)} GiB); temporários irão para o disco`);
      return diskRoot;
    }
    logger.info(`temporários HyperFrames em RAM (${ramRoot}; reserva estimada ${(estimatedBytes / GIB).toFixed(1)} GiB)`);
    return ramRoot;
  } catch (error) {
    logger.info(`RAM temporária indisponível (${error.message}); temporários irão para o disco`);
    return diskRoot;
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function imageExtension(mime, source = '') {
  const fromMime = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
  }[mime];
  if (fromMime) return fromMime;
  const extension = path.extname(String(source).split('?')[0]).toLowerCase();
  return /^\.(png|jpe?g|webp)$/.test(extension) ? extension : null;
}

async function imageBytes(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('referência de imagem vazia');
  if (source.startsWith('data:')) {
    const match = source.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/i);
    if (!match) throw new Error('use uma data URI base64 JPEG, PNG ou WebP');
    const encoded = match[2];
    if (encoded.length % 4 !== 0 || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
      throw new Error('imagem excede o limite de 20 MiB ou tem base64 inválido');
    }
    const mime = match[1].toLowerCase();
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('imagem vazia ou acima do limite de 20 MiB');
    return { bytes, mime };
  }
  const filePath = source.startsWith('file:')
    ? fileURLToPath(new URL(source))
    : path.resolve(ROOT, source);
  const root = await fs.realpath(ROOT);
  const resolved = await fs.realpath(filePath);
  if (!isWithin(root, resolved)) throw new Error('imagem local fora da pasta do projeto recusada');
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_IMAGE_BYTES) {
    throw new Error('imagem local vazia ou acima do limite de 20 MiB');
  }
  const mime = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' })[path.extname(resolved).toLowerCase()];
  if (!mime) throw new Error('imagem local precisa ser JPEG, PNG ou WebP');
  return { bytes: await fs.readFile(resolved), mime };
}

async function stageSceneAssets(scenes, workDir, logger) {
  const assetsDir = path.join(workDir, 'assets');
  await fs.mkdir(assetsDir, { recursive: true });
  const cache = new Map();
  const imageHashes = new Set();
  let stagedBytes = 0;

  for (const scene of scenes) {
    const components = [];
    for (const component of scene.components || []) {
      if (!component.src) {
        components.push(component);
        continue;
      }
      try {
        let staged = cache.get(component.src);
        if (!staged) {
          const { bytes, mime } = await imageBytes(component.src);
          if (stagedBytes + bytes.length > MAX_STAGED_IMAGE_BYTES) {
            throw new Error('limite total de imagens da composição excede 180 MiB');
          }
          const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
          const fileName = `${sha256.slice(0, 20)}${imageExtension(mime, component.src)}`;
          await fs.writeFile(path.join(assetsDir, fileName), bytes);
          imageHashes.add(sha256);
          stagedBytes += bytes.length;
          staged = `assets/${fileName}`;
          cache.set(component.src, staged);
        }
        component.src = staged;
        components.push(component);
      } catch (error) {
        logger.warn(`imagem de cena ignorada (${component.type}): ${error.message}`);
      }
    }
    scene.components = components;
  }
  return { paths: [...new Set(cache.values())], sha256s: [...imageHashes] };
}

function createCompositionHtml({ width, height, fps, duration, scenes, imageAssets, audioFile, robotConfig, kitCss, kitJs,
  includePresenter = true }) {
  const sceneStarts = [];
  let cursorMs = 0;
  for (const scene of scenes) {
    sceneStarts.push({ startMs: cursorMs, durationMs: scene.durationMs });
    cursorMs += scene.durationMs;
  }

  const theme = resolveVisualTheme(robotConfig.script);
  const paletteConfig = robotConfig.script.visualPalettes?.variants?.length
    ? robotConfig.script.visualPalettes
    : theme?.visualPalettes;
  const palette = selectThemePalette(paletteConfig, robotConfig.seed);
  const accents = Array.isArray(palette?.accents) && palette.accents.length
    ? palette.accents
    : VISUAL_DESIGN_TOKENS.presenter.fallbackAccents;
  const stageDuration = Number(duration.toFixed(3));
  const partIndex = Number(robotConfig.script.partIndicator?.index);
  const partCount = Number(robotConfig.script.partIndicator?.count);
  const partIndicatorHtml = !robotConfig.script.explanatorySocial && Number.isSafeInteger(partIndex)
    && Number.isSafeInteger(partCount)
    && partIndex > 0
    && partCount > 1
    && partIndex <= partCount
    ? `<div class="part-indicator" aria-label="Parte ${partIndex} de ${partCount}">PARTE ${partIndex}/${partCount}</div>`
    : '';
  const imageUrls = imageAssets;
  const framedScenes = scenes.map(scene => sceneForViewport(scene, width, height)).map((scene, index) => {
    const shot = choosePresenterShot(scene, index, robotConfig.seed, {
      portrait: height > width,
      hideOnDataScenes: Boolean(robotConfig.script.hidePresenterOnLandscapeDataScenes)
    });
    const hasFixedSide = ['left', 'right', 'center'].includes(scene.presenterShot?.side);
    const groupIndex = Number.isSafeInteger(scene.groupIndex) ? scene.groupIndex : index;
    // In the Remotion final composite, change the presenter side only at a
    // narration-group cut. The background reserves the matching side and the
    // 3D layer snaps to it on that same frame (never slides across the copy).
    if (!includePresenter && height <= width && !shot.hidden && !hasFixedSide) {
      shot.side = (groupIndex + (Number(robotConfig.seed) >>> 0)) % 2 ? 'left' : 'right';
    }
    return {
      ...scene,
      // Keep presenter-aware layout reservation even when the model is composited
      // later by Remotion as a separate, real 3D layer.
      presenter: scene.presenter !== false,
      presenterShot: {
        ...shot,
        ...(height > width && !scene.presenterShot?.framing ? { framing: 'full' } : {})
      }
    };
  });
  let framePlanMs = 0;
  const presenterPlan = framedScenes.map((scene, index) => {
    const entry = {
      startMs: framePlanMs,
      durationMs: Number(scene.durationMs) || 0,
      presenter: scene.presenter !== false,
      side: scene.presenterShot.side,
      framing: scene.presenterShot.framing,
      hidden: scene.presenterShot.hidden,
      groupKind: scene.groupKind || null,
      groupIndex: Number.isSafeInteger(scene.groupIndex) ? scene.groupIndex : index
    };
    framePlanMs += entry.durationMs;
    return entry;
  });
  const productionData = safeJson({ scenes: framedScenes, sceneStarts, imageUrls, duration: stageDuration });
  const gestureBeats = Array.isArray(robotConfig.script.gestureBeats) && robotConfig.script.gestureBeats.length
    ? robotConfig.script.gestureBeats
    : buildPresenterGestureBeats(scenes, sceneStarts);
  const robotData = safeJson({
    seed: robotConfig.seed,
    durationSeconds: stageDuration,
    accents,
    speechEnvelope: robotConfig.speechEnvelope,
    mouthCues: robotConfig.mouthCues,
    gestureBeats
  });

  const css = `${sceneCssTokens()}\n${kitCss}
    :root { --w: ${width}px; --h: ${height}px; --accent: ${accents[0]}; }
    html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
    body { position: relative; }
    #root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: var(--bg); }
    /* Keep the scene root out of its own stacking context so the editorial
       header can sit above the 3D canvas when the presenter faces that side.
       Other scene elements keep their existing z-index and stay behind it. */
    #scene-root { position: absolute; inset: 0; overflow: hidden; }
    #scene-root > .scene { position: absolute; inset: 0; }
    #three-layer { position: absolute; z-index: 5; right: 0; bottom: 0; height: 87%; width: auto; pointer-events: none; filter: drop-shadow(0 22px 32px rgba(0,0,0,.34)); }
    #scene-root > .scene > .demo-header { z-index: 6; }
    #root[data-presenter-side="left"] #three-layer { left: 0; right: auto; }
    #root[data-presenter-side="center"] #three-layer { left: 50%; right: auto; transform: translateX(-50%); }
    #narration { display: none; }
    /* Paisagem: legendas longas (uma frase = um bloco) podem transbordar para a
       banda inferior e colidir com a marca d'água (content_overlap). O topo-
       direita é estruturalmente livre (demo-header começa em y=var(--pad));
       retrato mantém a posição original do kit, que o clip-title exige. */
    @media (min-aspect-ratio: 1/1) {
      .scene .watermark, .scene.has-presenter .watermark, .scene.presenter-left .watermark {
        top: calc(var(--h) * 0.028) !important;
        right: var(--pad) !important;
        left: auto !important;
        bottom: auto !important;
      }
    }
    .scene.has-presenter .bento { max-width: 56%; }
    .scene.has-presenter:not(.presenter-left) .caption { max-width: 56%; }
    .scene.has-presenter .watermark { left: var(--pad); right: auto; }
    .scene.has-presenter.presenter-left .watermark { left: auto; right: var(--pad); }
    @media (max-aspect-ratio: 1/1) {
      #three-layer { height: 50%; bottom: 19%; }
      #root:has(.portrait-photo) #three-layer { height: 32%; bottom: 15%; }
      .scene.presenter-left > :not(.demo-header):not(.img-hero):not(.pulse-glow):not(.watermark):not(.clip-title) { margin-left: 0; max-width: 100%; }
      .scene.has-presenter .bento { max-width: 100%; margin-left: 0; padding: calc(var(--h) * .026) calc(var(--w) * .04); }
      .scene.has-presenter .bento .b-title { font-size: calc(var(--h) * .040); overflow-wrap: anywhere; }
      .scene.has-presenter .bento .b-sub { font-size: calc(var(--h) * .025); }
      .scene.has-presenter:not(.presenter-left) .caption, .scene.has-presenter .caption { max-width: 100%; margin-left: 0; font-size: calc(var(--h) * .025); }
      /* Narrativas longas mantêm o texto na faixa superior, acima do canvas 3D
         (que começa em 31% da altura no 9:16), sem cobrir o rosto/robô. */
      .scene.steady-narrative .caption {
        position: absolute; top: 15%; left: var(--pad); right: var(--pad);
        width: auto; max-width: none; margin: 0; justify-content: center;
        text-align: center; font-size: calc(var(--h) * .03); line-height: 1.18;
        z-index: 6;
      }
      #root[data-explanatory-social] #three-layer { height: 38%; bottom: 18%; }
      #root:has(.atlas-story-scene) #three-layer { height: 36%; bottom: 12%; }
      .scene.explanatory-social {
        background: radial-gradient(ellipse at 50% 43%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 64%),
          linear-gradient(145deg, #10151f, #0a0a0f 72%);
      }
      .scene.explanatory-social::before { opacity: .22; }
      .scene.explanatory-social > .demo-header { display: none; }
      .scene.explanatory-social > .watermark {
        top: 2.6%; right: auto; bottom: auto; left: var(--pad); z-index: 8;
        font-size: calc(var(--h) * .016);
      }
      .scene.explanatory-social > .caption {
        top: auto; right: var(--pad); bottom: 6%; left: var(--pad); z-index: 8;
        width: auto; max-width: none; margin: 0; justify-content: center;
        text-align: center; font-size: calc(var(--h) * .027); line-height: 1.16;
      }
      .scene.explanatory-social > .bento,
      .scene.explanatory-social > .nodes,
      .scene.explanatory-social > .news-card,
      .scene.explanatory-social > .rotation-cards,
      .scene.explanatory-social > .compare-table,
      .scene.explanatory-social > .checklist,
      .scene.explanatory-social > .progressive-comparison,
      .scene.explanatory-social > .chart,
      .scene.explanatory-social > .scores,
      .scene.explanatory-social > .kinetic,
      .scene.explanatory-social > .pbar {
        position: absolute; top: 17%; left: var(--pad); right: var(--pad);
        width: auto; max-width: none; margin: 0; z-index: 7;
      }
      .scene.explanatory-social > .bento { padding: calc(var(--h) * .018) calc(var(--w) * .035); }
      .scene.explanatory-social > .bento .b-title { font-size: calc(var(--h) * .034); line-height: 1.12; }
      .scene.explanatory-social > .bento .b-sub { font-size: calc(var(--h) * .02); line-height: 1.2; }
      .scene.explanatory-social > .news-card {
        padding: calc(var(--h) * .022) calc(var(--w) * .03);
      }
      .scene.explanatory-social > .news-card .nc-avatar {
        width: calc(var(--h) * .04); height: calc(var(--h) * .04);
        font-size: calc(var(--h) * .021);
      }
      .scene.explanatory-social > .news-card .nc-name { font-size: calc(var(--h) * .02); }
      .scene.explanatory-social > .news-card .nc-handle { font-size: calc(var(--h) * .015); }
      .scene.explanatory-social > .news-card .nc-text {
        margin-top: calc(var(--h) * .014); font-size: calc(var(--h) * .025); line-height: 1.15;
      }
      .scene.explanatory-social > .news-card .nc-foot { font-size: calc(var(--h) * .013); }
      .scene.explanatory-social > .nodes .node { font-size: calc(var(--h) * .02); line-height: 1.08; }
      /* The shared portrait kit sets presenter graphs to width: 100%. In an
         absolutely positioned cutaway, that adds the left/right insets again
         and pushes the last node past the phone canvas. */
      .scene.explanatory-social.has-presenter > .nodes {
        width: auto !important; max-width: none !important;
      }
      .scene.explanatory-social.has-presenter > .nodes .node {
        flex: 1 1 0; min-width: 0 !important;
        padding: calc(var(--h) * .012) calc(var(--w) * .008);
        font-size: calc(var(--h) * .015); line-height: 1.12;
      }
      .scene.explanatory-social.has-presenter > .nodes.compact-four-node-graph .node {
        font-size: calc(var(--w) * .021);
      }
      .scene.explanatory-social.has-presenter > .nodes .wire {
        flex: .25 1 0; min-width: calc(var(--w) * .025);
      }
      .scene.explanatory-social > .rotation-cards {
        display: flex; flex-direction: column; gap: calc(var(--h) * .009);
        height: auto; perspective: none;
      }
      .scene.explanatory-social > .rotation-cards > .rc-title {
        position: relative; top: auto; left: auto;
        margin-bottom: calc(var(--h) * .004); font-size: calc(var(--h) * .014);
      }
      .scene.explanatory-social > .rotation-cards > .rc-card {
        position: relative; top: auto !important; left: auto !important;
        width: 100%; height: auto; min-height: calc(var(--h) * .085);
        flex: 0 0 auto; padding: calc(var(--h) * .01) calc(var(--w) * .025);
        transform-origin: center;
      }
      .scene.explanatory-social > .rotation-cards .rc-copy {
        font-size: calc(var(--h) * .017); line-height: 1.12;
      }
      /* Barras e rótulos percentuais ocupam a faixa superior. Nas cenas que
         também exibem legenda, use a banda abaixo do canvas do robô para
         preservar os dados, o texto e o enquadramento sem sobreposição. */
      .scene.steady-narrative.has-narrative-progress .caption {
        top: auto; bottom: 3%; left: 8%; right: 8%; width: auto;
        max-width: none; max-height: 16%; margin: 0; justify-content: center;
        text-align: center; font-size: calc(var(--h) * .03); line-height: 1.12;
        z-index: 6;
      }
    }
  `;
  const dataJs = `window.PULSO_PRODUCTION_DATA = ${productionData}; window.PULSO_ROBOT_CONFIG = ${robotData}; window.__timelines = window.__timelines || {};`;
  const runtimeJs = `(async function () {
    const data = window.PULSO_PRODUCTION_DATA;
    const starts = data.sceneStarts;
    const imageLoads = data.imageUrls.map(src => new Promise(resolve => {
      const image = new Image();
      image.onload = image.onerror = () => resolve();
      image.src = src;
      if (image.complete) resolve();
    }));
    await Promise.all([document.fonts.ready, ...imageLoads${includePresenter ? ', window.__hf?.buildReady?.presenter' : ''}]);

    let active = -1;
    const progressFill = document.querySelector('#composition-progress .cp-fill');
    function seekComposition(seconds) {
      const timeMs = Math.max(0, Math.min(data.duration * 1000, seconds * 1000));
      if (progressFill) progressFill.style.width = (data.duration > 0 ? (timeMs / (data.duration * 1000)) * 100 : 0) + '%';
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (starts[mid].startMs <= timeMs) low = mid;
        else high = mid - 1;
      }
      const index = low;
      if (active !== index) {
        window.buildScene(data.scenes[index]);
        ${includePresenter ? `const shot = data.scenes[index].presenterShot;
        const root = document.getElementById('root');
        const canvas = document.getElementById('three-layer');
        root.dataset.presenterSide = shot.side;
        // display:none (não visibility) — o canvas some do layout e o gate de
        // layout/check não pode mais tratar a caixa vazia como oclusora opaca.
        canvas.style.display = shot.hidden ? 'none' : 'block';
        if (window.setPresenterFraming) window.setPresenterFraming(shot.framing);` : ''}
        active = index;
      }
      window.renderAt(timeMs - starts[index].startMs);
      ${includePresenter ? 'window.seekPresenterRobot(seconds);' : ''}
    }

    const clock = { time: 0 };
    let timeline;
    timeline = gsap.timeline({ paused: true, onUpdate: () => seekComposition(timeline.time()) });
    timeline.to(clock, { time: data.duration, duration: data.duration, ease: 'none' }, 0);
    window.__timelines.main = timeline;
    seekComposition(0);
    window.__pulsoProductionReady = true;
  })().catch(error => {
    window.__pulsoProductionError = String(error && error.stack || error);
    console.error('[Pulso HyperFrames]', error);
  });`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${width},height=${height},initial-scale=1">
  <title>Pulso IA — produção HyperFrames</title>
  <link rel="stylesheet" href="assets/scene-kit.css">
</head>
<body>
  <main id="root" ${robotConfig.script.explanatorySocial ? 'data-explanatory-social="true"' : ''} data-composition-id="main" data-start="0" data-duration="${stageDuration}" data-width="${width}" data-height="${height}" data-fps="${fps}">
    <div id="scene-root" class="clip" data-start="0" data-duration="${stageDuration}" data-track-index="0"></div>
    ${includePresenter ? `<canvas id="three-layer" class="clip" width="710" height="940" data-start="0" data-duration="${stageDuration}" data-track-index="1" aria-hidden="true"></canvas>` : ''}
    ${robotConfig.script.minimal ? '<div id="composition-progress" class="composition-progress" aria-hidden="true"><div class="cp-fill"></div></div>' : ''}
    ${partIndicatorHtml}
    <audio id="narration" data-start="0" data-duration="${stageDuration}" data-track-index="2" src="${audioFile}" preload="auto"></audio>
  </main>
  <script>window.__timelines = window.__timelines || {};</script>
  <script src="assets/production-data.js"></script>
  <script src="assets/scene-kit.js"></script>
  <script src="assets/gsap.min.js"></script>
  ${includePresenter ? '<script src="assets/production-presenter.js"></script>' : ''}
  <script src="assets/production-composition.js"></script>
</body>
</html>`;
  return {
    html,
    assets: {
      'scene-kit.css': css,
      'scene-kit.js': kitJs,
      'production-data.js': dataJs,
      'production-composition.js': runtimeJs
    },
    presenterPlan,
    palette: { accents }
  };
}

function runCommand(command, args, {
  cwd,
  env,
  logger,
  label,
  timeoutMs,
  resourceCheck = null,
  resourceCheckIntervalMs = 5000,
  killGraceMs = PROCESS_KILL_GRACE_MS,
  finalizeGraceMs = PROCESS_FINALIZE_GRACE_MS
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let tail = '';
    let timedOut = false;
    let settled = false;
    let killTimer = null;
    let finalizeTimer = null;
    let childClosed = false;
    let timeoutCleanupComplete = false;
    let timeoutProcessIdentities = [];
    let resourceError = null;
    let resourceTimer = null;
    const timeoutError = () => {
      const error = new Error(`${label} excedeu o prazo de ${timeoutMs}ms`);
      error.code = 'HYPERFRAMES_TIMEOUT';
      return error;
    };
    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      clearTimeout(finalizeTimer);
      clearInterval(resourceTimer);
      if (error) reject(error);
      else resolve();
    };
    const signalProcessGroup = signal => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (error.code !== 'ESRCH') logger.warn(`[${label}] não foi possível enviar ${signal} ao subprocesso (${error.code || error.name})`);
      }
    };
    const interrupt = error => {
      if (timedOut || settled) return;
      timedOut = true;
      resourceError = error;
      logger.warn(`[${label}] ${error.message}; encerrando o grupo do subprocesso`);
      timeoutProcessIdentities = childProcessIdentities(child.pid);
      signalProcessIdentities(timeoutProcessIdentities, 'SIGTERM');
      signalProcessGroup('SIGTERM');
      killTimer = setTimeout(() => {
        signalProcessIdentities(timeoutProcessIdentities, 'SIGKILL');
        signalProcessIdentities(childProcessIdentities(child.pid), 'SIGKILL');
        signalProcessGroup('SIGKILL');
        timeoutCleanupComplete = true;
        if (childClosed) settle(resourceError);
        else finalizeTimer = setTimeout(() => settle(resourceError), finalizeGraceMs);
      }, killGraceMs);
    };
    const timeoutTimer = setTimeout(() => interrupt(timeoutError()), timeoutMs);
    if (typeof resourceCheck === 'function') {
      resourceTimer = setInterval(() => {
        try { const error = resourceCheck(); if (error) interrupt(error); }
        catch (error) { interrupt(Object.assign(new Error('monitor de recursos indisponível'), { code: 'HOST_RESOURCE_GATE', cause: error })); }
      }, Math.max(100, resourceCheckIntervalMs));
      resourceTimer.unref();
    }
    const consume = chunk => {
      const text = chunk.toString();
      tail = `${tail}${text}`.slice(-8000);
      for (const line of text.split(/\r?\n/).filter(Boolean)) logger.info(`[${label}] ${line}`);
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.on('error', error => {
      if (!timedOut) settle(error);
    });
    child.on('close', (code, signal) => {
      childClosed = true;
      if (timedOut) {
        if (timeoutCleanupComplete) settle(resourceError);
      } else if (code === 0) settle();
      else {
        const error = new Error(`${label} saiu com código ${code}${signal ? ` (${signal})` : ''}: ${tail.slice(-2400)}`);
        error.code = label === 'hyperframes-check' ? 'HYPERFRAMES_CHECK_FAILED'
          : label === 'robot-build' ? 'HYPERFRAMES_BUILD_FAILED' : 'HYPERFRAMES_RENDER_FAILED';
        error.stage = label;
        error.exitCode = code;
        error.signal = signal;
        settle(error);
      }
    });
  });
}

async function resolvePotentialRealPath(candidatePath) {
  let probePath = path.resolve(candidatePath);
  const unresolvedParts = [];
  while (true) {
    try {
      const realProbePath = await fs.realpath(probePath);
      return path.resolve(realProbePath, ...unresolvedParts);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parentPath = path.dirname(probePath);
      if (parentPath === probePath) throw error;
      unresolvedParts.unshift(path.basename(probePath));
      probePath = parentPath;
    }
  }
}

async function assertSafeVisualRebuildOutput(outputPath, sourceMasterPath) {
  if (typeof sourceMasterPath !== 'string' || !sourceMasterPath.trim()) {
    throw new Error('visual rebuild source master path is missing');
  }
  const resolvedOutput = path.resolve(outputPath);
  const [canonicalOutput, canonicalSource] = await Promise.all([
    resolvePotentialRealPath(resolvedOutput),
    resolvePotentialRealPath(sourceMasterPath)
  ]);
  if (canonicalOutput === canonicalSource) {
    const error = new Error('visual rebuild output must be distinct from the source master');
    error.code = 'VISUAL_REBUILD_OUTPUT_IS_SOURCE';
    throw error;
  }
  try {
    await fs.lstat(resolvedOutput);
  } catch (error) {
    if (error.code === 'ENOENT') return resolvedOutput;
    throw error;
  }
  const error = new Error('visual rebuild output must be a new, nonexistent path');
  error.code = 'VISUAL_REBUILD_OUTPUT_EXISTS';
  throw error;
}

async function commitRenderedOutput(renderedPath, outputPath, exclusive = false) {
  if (!exclusive) {
    try {
      await fs.rename(renderedPath, outputPath);
    } catch (error) {
      if (error.code !== 'EXDEV') throw error;
      const partialPath = `${outputPath}.partial-${process.pid}`;
      try {
        await fs.copyFile(renderedPath, partialPath);
        await fs.rename(partialPath, outputPath);
      } finally {
        await fs.unlink(partialPath).catch(() => {});
      }
    }
    return;
  }

  try {
    await fs.link(renderedPath, outputPath);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    try {
      await fs.copyFile(renderedPath, outputPath, nodeFs.constants.COPYFILE_EXCL);
    } catch (copyError) {
      if (copyError.code !== 'EEXIST') await fs.unlink(outputPath).catch(() => {});
      throw copyError;
    }
  }
  await fs.unlink(renderedPath);
}

async function preserveRenderFailure({ workDir, outputPath, error, logger = console }) {
  const diagnosticPath = `${outputPath}.render-failure.json`;
  const diagnostic = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    code: error.code || 'HYPERFRAMES_RENDER_FAILED',
    stage: error.stage || null,
    exitCode: Number.isInteger(error.exitCode) ? error.exitCode : null,
    signal: error.signal || null,
    checkReport: null
  };
  try {
    const checkDir = path.join(workDir, '.hyperframes', 'artifacts', 'checks');
    const names = await fs.readdir(checkDir).catch(() => []);
    const reports = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => {
      const reportPath = path.join(checkDir, name);
      const stat = await fs.lstat(reportPath);
      return stat.isFile() && stat.size <= 2 * MIB ? { reportPath, mtimeMs: stat.mtimeMs } : null;
    }));
    const latest = reports.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (latest) diagnostic.checkReport = JSON.parse(await fs.readFile(latest.reportPath, 'utf8'));
  } catch {
    // A missing or incomplete report must not replace the original failure.
  }
  const tempPath = `${diagnosticPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(diagnostic, null, 2), { mode: 0o600, flag: 'wx' });
    await fs.rename(tempPath, diagnosticPath);
    logger.warn(`diagnóstico do render preservado: ${diagnosticPath}`);
  } catch {
    await fs.unlink(tempPath).catch(() => {});
    logger.warn('não foi possível preservar o diagnóstico do render');
  }
}

class HyperFramesVideoRenderer {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.fps = Math.max(12, Number(options.fps || process.env.ANIMATED_FPS || 24));
    this.width = Number(options.width || process.env.ANIMATED_WIDTH || 1920);
    this.height = Number(options.height || process.env.ANIMATED_HEIGHT || 1080);
    this.quality = options.quality || 'high';
    if (!RENDER_QUALITIES.has(this.quality)) throw new TypeError(`qualidade HyperFrames inválida: ${this.quality}`);
    this.captureProfile = options.captureProfile || process.env.HYPERFRAMES_CAPTURE_PROFILE || 'auto';
    if (!CAPTURE_PROFILES.has(this.captureProfile)) throw new TypeError(`perfil de captura inválido: ${this.captureProfile}`);
  }

  async render({
    script, audioPath, outputPath, images = {}, validateOnly = false, onScenePlan = null,
    visualCritiqueManifestPath = null, visualCritiqueManifestSha256 = null,
    includePresenter = true, usageArtifactPath = null, recordImageUsage = true,
    onCompositionPlan = null, onRenderMetadata = null
  }) {
    outputPath = path.resolve(outputPath);
    audioPath = path.resolve(audioPath);
    if (Boolean(visualCritiqueManifestPath) !== Boolean(visualCritiqueManifestSha256)) {
      throw new TypeError('visual critique requires both a QA manifest path and SHA-256');
    }
    if (onRenderMetadata !== null && typeof onRenderMetadata !== 'function') {
      throw new TypeError('onRenderMetadata must be a function');
    }
    let visualCritique = null;
    if (visualCritiqueManifestPath) {
      const { loadVisualRebuildCritique } = require('./video-qa-review');
      visualCritique = await loadVisualRebuildCritique({
        root: ROOT,
        manifestPath: visualCritiqueManifestPath,
        expectedManifestSha256: visualCritiqueManifestSha256
      });
      await assertSafeVisualRebuildOutput(outputPath, visualCritique.sourceMasterPath);
    }
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const measuredDuration = await getMediaDuration(audioPath).catch(() => 0);
    const planner = new ScenePlanBuilder();
    const totalMs = Math.max(1000, Math.round((measuredDuration || planner.estimateDuration(script)) * 1000));
    const {extractSpeechVisemes} = require('./speech-visemes');
    const [speechEnvelope, mouthCues] = await Promise.all([
      extractSpeechEnvelope(audioPath), includePresenter ? extractSpeechVisemes(audioPath) : Promise.resolve([])
    ]);
    let scenes = planner.buildScenes(script, totalMs, images, speechEnvelope);
    if (!scenes.length) throw new Error('HyperFrames recebeu um roteiro sem cenas renderizáveis');
    const { recordImageLibraryUsage } = require('./image-library');

    let cursorMs = 0;
    for (const scene of scenes) {
      scene.durationMs = Math.max(1, Number(scene.durationMs) || 1);
      cursorMs += scene.durationMs;
    }
    const drift = totalMs - cursorMs;
    if (Math.abs(drift) > 1) scenes[scenes.length - 1].durationMs = Math.max(1, scenes.at(-1).durationMs + drift);
    const appliedCritique = applySceneVisualCritique(scenes, visualCritique);
    scenes = appliedCritique.scenes;
    const scenePlanEvidence = appliedCritique.evidence;
    if (onScenePlan !== null) {
      if (typeof onScenePlan !== 'function') throw new TypeError('onScenePlan must be a function');
      onScenePlan(scenePlanEvidence);
    }

    const workspaceRoot = await chooseWorkspaceRoot(outputPath, totalMs, this.logger);
    const workDir = await fs.mkdtemp(path.join(workspaceRoot, '.hyperframes-render-'));
    const assetDir = path.join(workDir, 'assets');
    await fs.mkdir(assetDir, { recursive: true });
    let renderedTempPath = null;
    try {
      this.logger.info(`HyperFrames ${HYPERFRAMES_VERSION}: preparando ${scenes.length} cenas, ${this.width}x${this.height} a ${this.fps} fps`);
      const stagedImages = await stageSceneAssets(scenes, workDir, this.logger);
      const imageAssets = stagedImages.paths;
      const { mixdownAudio, buildSfxEvents } = require('./audio-mix');
      const mood = script.mood || deriveMood(script.title || script.hook?.text || '');
      const sfxEvents = buildSfxEvents(scenes);
      const mixed = await mixdownAudio({ narrationPath: audioPath, mood, seed: script.seed, workDir, sfxEvents });
      this.logger.info(`Mixagem de áudio pronta: ${mixed.sfxEvents} eventos SFX incorporados à faixa única`);
      const audioFileName = 'narration.m4a';
      await fs.copyFile(mixed.path, path.join(assetDir, audioFileName));

      const gsapPath = path.join(HYPERFRAMES_PROJECT, 'node_modules', 'gsap', 'dist', 'gsap.min.js');
      await fs.copyFile(gsapPath, path.join(assetDir, 'gsap.min.js'));
      if (includePresenter) {
        await runCommand(process.execPath, [ROBOT_BUILD_SCRIPT, path.join(assetDir, 'production-presenter.js')], {
          cwd: HYPERFRAMES_PROJECT,
          env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' },
          logger: this.logger,
          label: 'robot-build',
          timeoutMs: ROBOT_BUILD_TIMEOUT_MS
        });
      }

      const kitCss = await fs.readFile(path.join(KIT_DIR, 'kit.css'), 'utf8');
      const kitJs = await fs.readFile(path.join(KIT_DIR, 'kit.js'), 'utf8');
      const composition = createCompositionHtml({
        width: this.width,
        height: this.height,
        fps: this.fps,
        duration: totalMs / 1000,
        scenes,
        imageAssets,
        audioFile: `assets/${audioFileName}`,
        robotConfig: {
          script,
          seed: Number(script.seed) >>> 0,
          speechEnvelope,
          mouthCues
        },
        kitCss,
        kitJs,
        includePresenter
      });
      if (onCompositionPlan !== null) {
        if (typeof onCompositionPlan !== 'function') throw new TypeError('onCompositionPlan must be a function');
        onCompositionPlan({
          durationMs: totalMs,
          fps: this.fps,
          width: this.width,
          height: this.height,
          presenterPlan: composition.presenterPlan,
          speechEnvelope,
          palette: composition.palette,
          imageSha256s: stagedImages.sha256s
        });
      }
      await fs.writeFile(path.join(workDir, 'index.html'), composition.html);
      await Promise.all(Object.entries(composition.assets).map(([fileName, contents]) =>
        fs.writeFile(path.join(assetDir, fileName), contents)
      ));
      await fs.copyFile(path.join(HYPERFRAMES_PROJECT, 'hyperframes.json'), path.join(workDir, 'hyperframes.json'));
      await fs.copyFile(path.join(HYPERFRAMES_PROJECT, 'meta.json'), path.join(workDir, 'meta.json'));

      const env = {
        ...process.env,
        HYPERFRAMES_NO_TELEMETRY: '1',
        HYPERFRAMES_SKIP_UPDATE_CHECK: '1'
      };
      // The scheduler uses Xvfb for uploader browsers; forwarding that display
      // forces Chromium onto llvmpipe. HyperFrames runs headless and can use the
      // host AMD render node directly when DISPLAY is absent.
      delete env.DISPLAY;
      delete env.XAUTHORITY;
      await runCommand('npx', buildCheckArgs(workDir), {
        cwd: HYPERFRAMES_PROJECT,
        env,
        logger: this.logger,
        label: 'hyperframes-check',
        timeoutMs: configuredTimeoutMs('HYPERFRAMES_CHECK_TIMEOUT_MS', CHECK_TIMEOUT_MS)
      });

      if (validateOnly) {
        this.logger.info(`HyperFrames validado sem render: ${scenes.length} cenas`);
        return { valid: true, scenes: scenes.length, durationSeconds: totalMs / 1000 };
      }

      const runRender = async (targetPath, useGpu) => {
        const captureProfile = selectCaptureProfile({ requested: this.captureProfile, useGpu,
          width: this.width, height: this.height });
        const invoke = profile => runCommand('npx', buildRenderArgs({
          workDir, outputPath: targetPath, fps: this.fps, width: this.width,
          height: this.height, quality: this.quality, useGpu, captureProfile: profile
        }), {
          cwd: HYPERFRAMES_PROJECT, env, logger: this.logger,
          label: useGpu ? 'hyperframes-render-gpu' : 'hyperframes-render-cpu',
          timeoutMs: configuredTimeoutMs('HYPERFRAMES_RENDER_TIMEOUT_MS', RENDER_TIMEOUT_MS)
        });
        this.logger.info(`perfil de captura: ${captureProfile} (1 worker, ${this.width}x${this.height}, ${this.fps} fps)`);
        let actualCaptureProfile = captureProfile;
        try { await invoke(captureProfile); }
        catch (error) {
          if (captureProfile !== 'native' || error.code === 'HYPERFRAMES_TIMEOUT') throw error;
          await fs.rm(targetPath, { force: true }).catch(() => {});
          this.logger.warn('captura nativa falhou; retomando pelo perfil seguro com a mesma qualidade');
          await invoke('safe');
          actualCaptureProfile = 'safe';
        }
        return { backend: useGpu ? 'gpu' : 'cpu', captureProfile: actualCaptureProfile };
      };

      const gpuNodeAvailable = process.env.HYPERFRAMES_GPU !== '0'
        && nodeFs.existsSync('/dev/dri/renderD128');
      let useGpu = false;
      let renderedWithGpu = false;
      let renderMetadata = null;
      if (!gpuNodeAvailable) {
        this.logger.info('GPU indisponível ou desativada; render seguirá pela CPU');
      } else {
        const busy = await gpuBusyPercent();
        if (busy !== null && busy >= 100) {
          this.logger.info('GPU em 100% de uso; render seguirá pela CPU para não disputar a placa');
        } else {
          useGpu = true;
          this.logger.info(busy === null
            ? 'uso da GPU não pôde ser lido; tentando render pela GPU, com fallback automático para CPU'
            : `GPU em ${busy.toFixed(0)}% de uso; tentando render pela GPU`);
        }
      }

      if (useGpu) {
        const gpuOutputPath = path.join(workDir, 'rendered-gpu.mp4');
        try {
          renderMetadata = await runRender(gpuOutputPath, true);
          renderedTempPath = gpuOutputPath;
          renderedWithGpu = true;
        } catch (gpuError) {
          await fs.rm(gpuOutputPath, { force: true }).catch(() => {});
          if (gpuError.code === 'HYPERFRAMES_TIMEOUT') throw gpuError;
          this.logger.warn(`render pela GPU falhou; tentando novamente pela CPU: ${gpuError.message}`);
          const cpuOutputPath = path.join(workDir, 'rendered-cpu.mp4');
          renderedTempPath = cpuOutputPath;
          try {
            renderMetadata = await runRender(cpuOutputPath, false);
          } catch (cpuError) {
            throw new Error(`render GPU falhou (${gpuError.message}); fallback CPU também falhou (${cpuError.message})`, { cause: cpuError });
          }
        }
      } else {
        renderedTempPath = path.join(workDir, 'rendered-cpu.mp4');
        renderMetadata = await runRender(renderedTempPath, false);
      }

      if (onRenderMetadata) onRenderMetadata(renderMetadata);
      await commitRenderedOutput(renderedTempPath, outputPath, Boolean(visualCritique));
      this.logger.info(`HyperFrames terminou pela ${renderedWithGpu ? 'GPU' : 'CPU'}: ${outputPath}`);
      if (recordImageUsage) {
        await recordImageLibraryUsage({ sha256s: stagedImages.sha256s, artifactPath: usageArtifactPath || outputPath })
          .catch(error => this.logger.warn(`uso das imagens não registrado; mídia preservada (${error.code || error.name})`));
      }
      return outputPath;
    } catch (error) {
      await preserveRenderFailure({ workDir, outputPath, error, logger: this.logger });
      throw error;
    } finally {
      if (renderedTempPath) await fs.unlink(renderedTempPath).catch(() => {});
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = { HyperFramesVideoRenderer, HYPERFRAMES_VERSION, buildCheckArgs, buildRenderArgs,
  buildPresenterGestureBeats, selectCaptureProfile, createCompositionHtml, runCommand, preserveRenderFailure,
  buildScenePlanEvidence, assertSafeVisualRebuildOutput, commitRenderedOutput };
