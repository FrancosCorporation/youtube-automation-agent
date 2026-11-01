'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const { themes } = require('../config/themes.json');
const { ScenePlanBuilder } = require('../utils/scene-plan-builder');
const { createCompositionHtml } = require('../utils/hyperframes-video-renderer');
const { contrastRatio, selectThemePalette } = require('../utils/theme-visuals');
const { VISUAL_DESIGN_TOKENS } = require('../utils/visual-design-tokens');

function sentenceTiming(text, startMs, durationMs) {
  const words = text.split(/\s+/);
  return {
    text, words, startMs, durationMs,
    wordTimes: words.map((_, index) => Math.round(durationMs * index / words.length))
  };
}

function rgb(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map(value => parseInt(value, 16));
  return `rgb(${channels.join(', ')})`;
}

function silentWave(durationSeconds = 15, sampleRate = 8000) {
  const samples = durationSeconds * sampleRate;
  const wave = Buffer.alloc(44 + samples);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(sampleRate, 24);
  wave.writeUInt32LE(sampleRate, 28);
  wave.writeUInt16LE(1, 32);
  wave.writeUInt16LE(8, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(samples, 40);
  wave.fill(128, 44);
  return wave;
}

function sceneOffsetFor(scenes, type) {
  let offsetMs = 0;
  for (const scene of scenes) {
    if ((scene.components || []).some(component => component.type === type)) {
      return offsetMs + Math.min(scene.durationMs / 2, 1000);
    }
    offsetMs += scene.durationMs;
  }
  throw new Error(`cena com componente ${type} ausente`);
}

async function main() {
  const repo = path.resolve(__dirname, '..');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-theme-matrix-'));
  const evidenceDir = process.env.PULSO_THEME_MATRIX_EVIDENCE_DIR;
  if (evidenceDir) await fs.mkdir(evidenceDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: [
    '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'
  ] });
  const context = await browser.newContext();
  let server;
  try {
    const bundle = path.join(root, 'production-presenter.js');
    execFileSync(process.execPath, [
      path.join(repo, 'experiments/hyperframes-pulso-pilot/scripts/build-production-presenter.js'), bundle
    ], { stdio: 'pipe' });
    const sharedAssets = path.join(root, 'shared-assets');
    await fs.mkdir(sharedAssets, { recursive: true });
    await fs.copyFile(bundle, path.join(sharedAssets, 'production-presenter.js'));
    await fs.symlink(path.join(repo, 'experiments/hyperframes-pulso-pilot/assets/pulso-robot.glb'),
      path.join(sharedAssets, 'pulso-robot.glb'));
    await fs.symlink(path.join(repo, 'experiments/hyperframes-pulso-pilot/node_modules/gsap/dist/gsap.min.js'),
      path.join(sharedAssets, 'gsap.min.js'));

    const content = [
      'Cada tema apresenta uma identidade própria.',
      'As cores de apoio preservam contraste na tela.',
      'A composição mantém espaços consistentes de leitura.'
    ];
    const hook = 'Uma mesma composição pode manter identidades visuais distintas.';
    const seed = 2;
    const dimensions = [['wide', 1920, 1080], ['tall', 1080, 1920]];
    const kitCss = await fs.readFile(path.join(repo, 'assets/scenes/kit.css'), 'utf8');
    const kitJs = await fs.readFile(path.join(repo, 'assets/scenes/kit.js'), 'utf8');
    const enabledThemes = themes.filter(theme => theme.enabled);
    assert.equal(enabledThemes.length, 10, 'matriz de tema espera dez identidades ativas');
    const matrix = [];

    const contentTypes = new Map([
      ['.css', 'text/css; charset=utf-8'],
      ['.glb', 'model/gltf-binary'],
      ['.html', 'text/html; charset=utf-8'],
      ['.js', 'text/javascript; charset=utf-8'],
      ['.json', 'application/json; charset=utf-8'],
      ['.wav', 'audio/wav']
    ]);
    server = http.createServer(async (request, response) => {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      let file;
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
        const sharedAsset = pathname.match(/\/assets\/(production-presenter\.js|pulso-robot\.glb|gsap\.min\.js)$/);
        if (sharedAsset) {
          response.writeHead(302, { Location: `/shared-assets/${sharedAsset[1]}` }).end();
          return;
        }
        file = path.resolve(root, `.${pathname}`);
      } catch {
        response.writeHead(400).end('Bad request');
        return;
      }
      if (!file.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      try {
        const data = await fs.readFile(file);
        response.writeHead(200, {
          'Content-Length': data.length,
          'Content-Type': contentTypes.get(path.extname(file)) || 'application/octet-stream',
          'Cache-Control': file.startsWith(`${sharedAssets}${path.sep}`)
            ? 'public, max-age=86400, immutable'
            : 'no-store'
        });
        if (request.method === 'HEAD') response.end();
        else response.end(data);
      } catch (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    for (const theme of enabledThemes) {
      const script = {
        seed, themeId: theme.id, channel: theme.brand, visualPalettes: theme.visualPalettes,
        hook: { text: hook },
        mainContent: { sections: [{ title: 'Identidade visual', content: content.join(' ') }] },
        timings: [
          { audioOffsetMs: 0, durationMs: 5000, sentences: [sentenceTiming(hook, 0, 5000)] },
          { audioOffsetMs: 5000, durationMs: 9000, sentences: content.map((text, index) =>
            sentenceTiming(text, index * 3000, 3000)) }
        ]
      };
      const scenes = new ScenePlanBuilder().buildScenes(script, 14000, {});
      const sampleTime = sceneOffsetFor(scenes, 'rotation-cards') / 1000;
      const palette = selectThemePalette(theme.visualPalettes, seed);
      assert.ok(palette?.accents?.length >= 4, `${theme.id}: avatar palette is incomplete`);
      assert.ok(contrastRatio(palette.accents[0], VISUAL_DESIGN_TOKENS.color.videoBackground) >= 4.5,
        `${theme.id}: identity accent lacks contrast on video background`);

      for (const [aspect, width, height] of dimensions) {
        const directory = path.join(root, theme.id, aspect);
        const assetsDir = path.join(directory, 'assets');
        await fs.mkdir(assetsDir, { recursive: true });
        await fs.writeFile(path.join(assetsDir, 'silent.wav'), silentWave());
        const composition = createCompositionHtml({
          width, height, fps: 30, duration: 14, scenes, imageAssets: [], audioFile: 'assets/silent.wav',
          robotConfig: { seed, script, speechEnvelope: {} }, kitCss, kitJs
        });
        await fs.writeFile(path.join(directory, 'index.html'), composition.html);
        for (const [file, data] of Object.entries(composition.assets)) {
          await fs.writeFile(path.join(assetsDir, file), data);
        }
        for (const file of ['production-presenter.js', 'pulso-robot.glb', 'gsap.min.js']) {
          await fs.symlink(path.join(sharedAssets, file), path.join(assetsDir, file));
        }

        const page = await context.newPage();
        await page.setViewportSize({ width, height });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/${theme.id}/${aspect}/index.html`);
        await page.waitForFunction(() => window.__pulsoProductionReady, {}, { timeout: 60000 });
        const sample = await page.evaluate(time => {
          window.__timelines.main.seek(time, false);
          const rootStyle = window.getComputedStyle(document.documentElement);
          const cards = document.querySelector('.rotation-cards');
          const cardBounds = [...cards.querySelectorAll('.rc-card')].map(card => {
            const box = card.getBoundingClientRect();
            const copyElement = card.querySelector('.rc-copy');
            const copy = copyElement.getBoundingClientRect();
            return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
              text: card.querySelector('.rc-copy').textContent,
              // Chromium rounds transformed font metrics by up to three pixels.
              overflows: copyElement.scrollHeight > copyElement.clientHeight + 3
                || copyElement.scrollWidth > copyElement.clientWidth + 1,
              copySize: { scrollHeight: copyElement.scrollHeight, clientHeight: copyElement.clientHeight,
                scrollWidth: copyElement.scrollWidth, clientWidth: copyElement.clientWidth },
              copy: { left: copy.left, right: copy.right, top: copy.top, bottom: copy.bottom } };
          });
          const canvas = document.getElementById('three-layer');
          const canvasBounds = canvas?.getBoundingClientRect();
          const card = cards.getBoundingClientRect();
          return {
            accent: rootStyle.getPropertyValue('--accent').trim(),
            markerColor: window.getComputedStyle(cards.querySelector('.rc-index')).color,
            brand: document.querySelector('.watermark')?.textContent
              || document.querySelector('.timestamp-hud .th-label')?.textContent,
            robotAccents: window.PULSO_ROBOT_CONFIG.accents,
            panel: { left: card.left, right: card.right, top: card.top, bottom: card.bottom },
            canvas: canvasBounds ? { width: canvasBounds.width, height: canvasBounds.height,
              display: window.getComputedStyle(canvas).display,
              visibility: window.getComputedStyle(canvas).visibility } : null,
            cards: cardBounds
          };
        }, sampleTime);
        if (evidenceDir) {
          await page.screenshot({ path: path.join(evidenceDir, `${theme.id}-${aspect}.png`) });
        }
        assert.deepEqual(errors, [], `${theme.id}/${aspect}: browser errors`);
        assert(palette.accents.some(accent => accent.toLowerCase() === sample.accent.toLowerCase()),
          `${theme.id}/${aspect}: rendered accent is outside the selected theme palette`);
        assert.equal(sample.markerColor, rgb(sample.accent), `${theme.id}/${aspect}: visual accent mismatch`);
        assert.deepEqual(sample.robotAccents, palette.accents, `${theme.id}/${aspect}: presenter palette mismatch`);
        assert.equal(sample.brand, theme.brand, `${theme.id}/${aspect}: channel identity mismatch`);
        assert(sample.canvas && sample.canvas.width > 0 && sample.canvas.height > 0,
          `${theme.id}/${aspect}: presenter canvas missing`);
        assert.notEqual(sample.canvas.display, 'none', `${theme.id}/${aspect}: presenter canvas hidden`);
        assert.notEqual(sample.canvas.visibility, 'hidden', `${theme.id}/${aspect}: presenter canvas hidden`);
        assert(sample.panel.left >= 0 && sample.panel.right <= width && sample.panel.top >= 0 && sample.panel.bottom <= height,
          `${theme.id}/${aspect}: cards outside viewport`);
        assert.equal(sample.cards.length, 3, `${theme.id}/${aspect}: missing rotation cards`);
        for (const card of sample.cards) {
          assert(card.copy.left >= card.left && card.copy.right <= card.right &&
            card.copy.top >= card.top && card.copy.bottom <= card.bottom,
          `${theme.id}/${aspect}: card text outside panel`);
          assert(card.copy.left >= 0 && card.copy.right <= width && card.copy.top >= 0 && card.copy.bottom <= height,
            `${theme.id}/${aspect}: card text outside viewport`);
          assert.equal(card.overflows, false,
            `${theme.id}/${aspect}: card text overflows its content box (${JSON.stringify(card.copySize)})`);
        }
        matrix.push({ theme: theme.id, name: theme.name, aspect, width, height,
          accents: palette.accents, screenshot: evidenceDir ? `${theme.id}-${aspect}.png` : null });
        await page.close();
      }
    }

    assert.equal(matrix.length, 20, 'all ten themes must render in both aspects');
    if (evidenceDir) {
      await fs.writeFile(path.join(evidenceDir, 'matrix.json'), `${JSON.stringify(matrix, null, 2)}\n`);
    }
    console.log(`Theme visual matrix: ${matrix.length}/20 theme/aspect renders passed.`);
  } finally {
    await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
