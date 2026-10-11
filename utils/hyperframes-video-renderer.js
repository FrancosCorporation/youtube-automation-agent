const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { fileURLToPath } = require('node:url');
const { spawn } = require('child_process');
const { getMediaDuration } = require('./ffmpeg');
const { mixdownAudio, deriveMood } = require('./audio-mix');
const { extractSpeechEnvelope } = require('./speech-envelope');
const { ScenePlanBuilder, resolveVisualTheme } = require('./scene-plan-builder');

const ROOT = path.join(__dirname, '..');
const HYPERFRAMES_PROJECT = path.join(ROOT, 'experiments', 'hyperframes-pulso-pilot');
const HYPERFRAMES_VERSION = '0.8.149';
const KIT_DIR = path.join(ROOT, 'assets', 'scenes');
const ROBOT_BUILD_SCRIPT = path.join(HYPERFRAMES_PROJECT, 'scripts', 'build-production-presenter.js');
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_STAGED_IMAGE_BYTES = 180 * 1024 * 1024;

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
          const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 20);
          const fileName = `${hash}${imageExtension(mime, component.src)}`;
          await fs.writeFile(path.join(assetsDir, fileName), bytes);
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
  return [...new Set(cache.values())];
}

function createCompositionHtml({ width, height, fps, duration, scenes, imageAssets, audioFile, robotConfig, kitCss, kitJs }) {
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
  const palettes = paletteConfig?.variants || [];
  const palette = palettes.length ? palettes[robotConfig.seed % palettes.length] : null;
  const accents = Array.isArray(palette?.accents) && palette.accents.length
    ? palette.accents
    : ['#5EEAD4', '#60A5FA', '#A78BFA', '#FBBF24'];
  const stageDuration = Number(duration.toFixed(3));
  const imageUrls = imageAssets;
  const productionData = safeJson({ scenes, sceneStarts, imageUrls, duration: stageDuration });
  const robotData = safeJson({
    seed: robotConfig.seed,
    durationSeconds: stageDuration,
    accents,
    speechEnvelope: robotConfig.speechEnvelope
  });

  const css = `${kitCss}
    :root { --w: ${width}px; --h: ${height}px; --accent: ${accents[0]}; }
    html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
    body { position: relative; }
    #root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: var(--bg); }
    #scene-root { position: absolute; inset: 0; z-index: 1; overflow: hidden; }
    #scene-root > .scene { position: absolute; inset: 0; }
    #three-layer { position: absolute; z-index: 5; right: 0; bottom: 0; height: 87%; width: auto; pointer-events: none; filter: drop-shadow(0 22px 32px rgba(0,0,0,.34)); }
    #narration { display: none; }
    .scene.has-presenter .bento { max-width: 56%; }
    .scene.has-presenter .watermark { left: var(--pad); right: auto; }
    @media (max-aspect-ratio: 1/1) {
      #three-layer { height: 42%; right: 0; bottom: 8%; }
      .scene.has-presenter .bento { max-width: 40%; }
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
    await Promise.all([document.fonts.ready, ...imageLoads]);

    let active = -1;
    function seekComposition(seconds) {
      const timeMs = Math.max(0, Math.min(data.duration * 1000, seconds * 1000));
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
        active = index;
      }
      window.renderAt(timeMs - starts[index].startMs);
      window.seekPresenterRobot(seconds);
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
  <main id="root" data-composition-id="main" data-start="0" data-duration="${stageDuration}" data-width="${width}" data-height="${height}" data-fps="${fps}">
    <div id="scene-root" class="clip" data-start="0" data-duration="${stageDuration}" data-track-index="0"></div>
    <canvas id="three-layer" class="clip" width="710" height="940" data-start="0" data-duration="${stageDuration}" data-track-index="1" aria-hidden="true"></canvas>
    <audio id="narration" data-start="0" data-duration="${stageDuration}" data-track-index="2" src="${audioFile}" preload="auto"></audio>
  </main>
  <script>window.__timelines = window.__timelines || {};</script>
  <script src="assets/production-data.js"></script>
  <script src="assets/scene-kit.js"></script>
  <script src="assets/gsap.min.js"></script>
  <script src="assets/production-presenter.js"></script>
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
    }
  };
}

function runCommand(command, args, { cwd, env, logger, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const consume = chunk => {
      const text = chunk.toString();
      tail = `${tail}${text}`.slice(-8000);
      for (const line of text.split(/\r?\n/).filter(Boolean)) logger.info(`[${label}] ${line}`);
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve()
      : reject(new Error(`${label} saiu com código ${code}: ${tail.slice(-2400)}`)));
  });
}

class HyperFramesVideoRenderer {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.fps = Math.max(12, Number(options.fps || process.env.ANIMATED_FPS || 24));
    this.width = Number(options.width || process.env.ANIMATED_WIDTH || 1920);
    this.height = Number(options.height || process.env.ANIMATED_HEIGHT || 1080);
  }

  async render({ script, audioPath, outputPath, images = {}, validateOnly = false }) {
    outputPath = path.resolve(outputPath);
    audioPath = path.resolve(audioPath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const measuredDuration = await getMediaDuration(audioPath).catch(() => 0);
    const planner = new ScenePlanBuilder();
    const totalMs = Math.max(1000, Math.round((measuredDuration || planner.estimateDuration(script)) * 1000));
    const speechEnvelope = await extractSpeechEnvelope(audioPath);
    const scenes = planner.buildScenes(script, totalMs, images, speechEnvelope);
    if (!scenes.length) throw new Error('HyperFrames recebeu um roteiro sem cenas renderizáveis');

    let cursorMs = 0;
    for (const scene of scenes) {
      scene.durationMs = Math.max(1, Number(scene.durationMs) || 1);
      cursorMs += scene.durationMs;
    }
    const drift = totalMs - cursorMs;
    if (Math.abs(drift) > 1) scenes[scenes.length - 1].durationMs = Math.max(1, scenes.at(-1).durationMs + drift);

    const workDir = await fs.mkdtemp(path.join(path.dirname(outputPath), '.hyperframes-render-'));
    const assetDir = path.join(workDir, 'assets');
    await fs.mkdir(assetDir, { recursive: true });
    let renderedTempPath = null;
    try {
      this.logger.info(`HyperFrames ${HYPERFRAMES_VERSION}: preparando ${scenes.length} cenas, ${this.width}x${this.height} a ${this.fps} fps`);
      const imageAssets = await stageSceneAssets(scenes, workDir, this.logger);
      const { mixdownAudio } = require('./audio-mix');
      const mood = script.mood || deriveMood(script.title || script.hook?.text || '');
      const mixed = await mixdownAudio({ narrationPath: audioPath, mood, seed: script.seed, workDir });
      const audioFileName = 'narration.m4a';
      await fs.copyFile(mixed.path, path.join(assetDir, audioFileName));

      const gsapPath = path.join(HYPERFRAMES_PROJECT, 'node_modules', 'gsap', 'dist', 'gsap.min.js');
      await fs.copyFile(gsapPath, path.join(assetDir, 'gsap.min.js'));
      await runCommand(process.execPath, [ROBOT_BUILD_SCRIPT, path.join(assetDir, 'production-presenter.js')], {
        cwd: HYPERFRAMES_PROJECT,
        env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' },
        logger: this.logger,
        label: 'robot-build'
      });

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
          speechEnvelope
        },
        kitCss,
        kitJs
      });
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
      await runCommand('npx', ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, 'check', '--timeout=15000', workDir], {
        cwd: HYPERFRAMES_PROJECT,
        env,
        logger: this.logger,
        label: 'hyperframes-check'
      });

      if (validateOnly) {
        this.logger.info(`HyperFrames validado sem render: ${scenes.length} cenas`);
        return { valid: true, scenes: scenes.length, durationSeconds: totalMs / 1000 };
      }

      renderedTempPath = path.join(workDir, 'rendered.mp4');
      const renderArgs = [
        '--yes', `hyperframes@${HYPERFRAMES_VERSION}`, 'render', workDir,
        `--fps=${this.fps}`, '--quality=high', '--workers=1', '--low-memory-mode',
        `--resolution=${this.width > this.height ? 'landscape' : 'portrait'}`,
        `--output=${renderedTempPath}`
      ];
      if (process.env.HYPERFRAMES_GPU !== '0' && require('fs').existsSync('/dev/dri/renderD128')) {
        renderArgs.push('--gpu', '--browser-gpu');
      }
      await runCommand('npx', renderArgs, {
        cwd: HYPERFRAMES_PROJECT,
        env,
        logger: this.logger,
        label: 'hyperframes-render'
      });
      await fs.rename(renderedTempPath, outputPath);
      this.logger.info(`HyperFrames terminou: ${outputPath}`);
      return outputPath;
    } finally {
      if (renderedTempPath) await fs.unlink(renderedTempPath).catch(() => {});
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = { HyperFramesVideoRenderer, HYPERFRAMES_VERSION };
