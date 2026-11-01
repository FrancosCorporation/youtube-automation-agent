/** Browser integration: production composition, both aspect ratios, captions and backward seeks. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const { createCompositionHtml } = require('../utils/hyperframes-video-renderer');
const { ScenePlanBuilder, CAPTION_MAX_WORDS } = require('../utils/scene-plan-builder');

(async () => {
  const repo = path.resolve(__dirname, '..');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-framing-test-'));
  const evidenceDir = process.env.PULSO_FRAMING_EVIDENCE_DIR;
  if (evidenceDir) await fs.mkdir(evidenceDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: [
    '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'
  ] });
  let server;
  try {
    const bundle = path.join(root, 'production-presenter.js');
    execFileSync(process.execPath, [path.join(repo, 'experiments/hyperframes-pulso-pilot/scripts/build-production-presenter.js'), bundle], { stdio: 'pipe' });
    const words = 'Todas as palavras continuam visiveis durante a narrativa'.split(' ');
    const photo = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#30495a"/><rect width="40" height="400" fill="#f00"/><rect x="760" width="40" height="400" fill="#0f0"/></svg>');
    const scenes = Array.from({ length: 5 }, (_, index) => ({
      id: 'fixture-' + index, durationMs: 3000, presenter: true, split: index === 3,
      ...(index === 4 ? { presenterShot: { side: 'left', framing: 'close' } } : {}),
      components: [
        { type: index === 3 ? 'image-panel' : 'image-hero', src: photo, side: 'right', durMs: 3000, strong: true },
        { type: 'demo-header', category: 'Pulso IA' },
        { type: 'bento-card', title: 'Uma noticia', subtitle: 'Conteudo editorial legivel' },
        { type: 'caption', words: words.map((w, i) => ({ w, t: i * 300, e: (i + 1) * 300 })) }
      ]
    }));
    const graphWords = ['E depois', 'de encaminhado,', 'como não'];
    scenes.push({
      id: 'diagram-under-presenter', durationMs: 3000, presenter: true,
      presenterShot: { side: 'right', framing: 'full' },
      components: [
        { type: 'demo-header', category: 'Pulso IA' },
        { type: 'node-graph', nodes: graphWords, revealAtMs: 0 },
        { type: 'caption', words: words.map((w, i) => ({ w, t: i * 300, e: (i + 1) * 300 })) }
      ]
    });
    const longText = 'A inteligência artificial mudou a forma como empresas analisam dados, reduzem custos e planejam o futuro. Especialistas dizem que essa transformação exige cuidado, transparência e decisões responsáveis para proteger as pessoas.';
    const expectedLongWords = longText.split(/\s+/);
    const longScenes = new ScenePlanBuilder().buildScenes({
      seed: 310,
      hook: { text: longText },
      forceLayout: 'text',
      channel: 'Pulso IA'
    }, 15000);
    const longCaptionPages = longScenes.flatMap(scene => scene.components.flatMap(component => {
      if (component.type === 'caption') return [component.words];
      if (component.type === 'caption-track') return component.pages.map(page => page.words);
      return [];
    }));
    assert(longCaptionPages.length > 1);
    assert(longCaptionPages.every(page => page.length <= CAPTION_MAX_WORDS));
    assert.deepEqual(longCaptionPages.flatMap(page => page.map(word => word.w)), expectedLongWords);
    const fixtureSentence = (text, startMs, durationMs) => {
      const sentenceWords = text.split(/\s+/);
      return {
        text, words: sentenceWords, startMs, durationMs,
        wordTimes: sentenceWords.map((_, index) => Math.round(durationMs * index / sentenceWords.length))
      };
    };
    const compareCopy = 'O modelo Aurora consome menos energia. O modelo Boreal entrega mais velocidade.';
    const checklistCopy = [
      'Primeiro, confira a origem dos dados publicados.',
      'Segundo, compare os resultados medidos.',
      'Terceiro, registre o que ainda falta confirmar.'
    ];
    const cardsCopy = [
      'Surpreendentemente, 14% admitiram ter deixado de pagar alguma conta básica para conseguir comparecer.',
      'Enquanto 52% gastaram mais de R$600 no último evento, 33% ultrapassaram R$1.000.',
      'Isso mostra que o preço anunciado na bilheteria é apenas a ponta do iceberg.'
    ];
    const componentScript = {
      seed: 2,
      forceLayout: 'text',
      channel: 'Pulso IA',
      hook: { text: 'Este teste verifica quatro componentes visuais.' },
      mainContent: { sections: [
        { title: 'Consumo', content: compareCopy,
          visual: { type: 'compare-table', title: 'Consumo', items: [{ label: 'Aurora', score: 8.5 }, { label: 'Boreal', score: 7.2 }] } },
        { title: 'Verificação', content: checklistCopy.join(' ') },
        { title: 'O experimento', content: cardsCopy.join(' ') }
      ] },
      timings: [
        { audioOffsetMs: 0, durationMs: 6000, sentences: [fixtureSentence('Este teste verifica quatro componentes visuais.', 0, 6000)] },
        { audioOffsetMs: 6000, durationMs: 7000, sentences: [fixtureSentence(compareCopy, 0, 7000)] },
        { audioOffsetMs: 13000, durationMs: 9000, sentences: checklistCopy.map((text, index) => fixtureSentence(text, index * 3000, 3000)) },
        { audioOffsetMs: 22000, durationMs: 9000, sentences: cardsCopy.map((text, index) => fixtureSentence(text, index * 3000, 3000)) }
      ]
    };
    const componentScenes = new ScenePlanBuilder().buildScenes(componentScript, 31000, {});
    const expectedVisuals = [
      ['compare-table', '.compare-table'],
      ['checklist', '.checklist'],
      ['rotation-cards', '.rotation-cards']
    ];
    for (const [type] of expectedVisuals) {
      assert(componentScenes.some(scene => scene.components.some(component => component.type === type)),
        `fixture must contain ${type}`);
    }
    assert(componentScenes.some(scene => scene.components.some(component => component.type === 'timestamp-hud')),
      'fixture must contain timestamp HUD');
    const articleImage = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#e8edf2"/><rect x="36" y="42" width="728" height="12" fill="#26374a"/><rect x="36" y="82" width="510" height="24" fill="#293b52"/><rect x="36" y="130" width="728" height="8" fill="#66788a"/><rect x="36" y="154" width="690" height="8" fill="#66788a"/><rect x="36" y="178" width="710" height="8" fill="#66788a"/><rect x="36" y="220" width="320" height="145" fill="#54a5c7"/><rect x="380" y="220" width="384" height="8" fill="#66788a"/><rect x="380" y="244" width="384" height="8" fill="#66788a"/><rect x="380" y="268" width="350" height="8" fill="#66788a"/></svg>'
    );
    const articleScenes = [{
      id: 'article-print-crop-fixture', durationMs: 4000, presenter: true,
      components: [
        { type: 'demo-header', category: 'Fonte editorial' },
        { type: 'article-print', src: articleImage, source: 'Fonte Exemplo', time: '13 out. 2026', revealAtMs: 0 },
        { type: 'caption', words: words.map((w, i) => ({ w, t: i * 300, e: (i + 1) * 300 })) }
      ]
    }];
    const baseScenesDurationMs = scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
    scenes.push(...longScenes);
    const longScenesDurationMs = longScenes.reduce((sum, scene) => sum + scene.durationMs, 0);
    scenes.push(...componentScenes);
    const componentScenesDurationMs = componentScenes.reduce((sum, scene) => sum + scene.durationMs, 0);
    scenes.push(...articleScenes);
    const sourceScenes = new ScenePlanBuilder().coalesceVisualScenes([
      { id: 'source-window', durationMs: 4000, groupIndex: 0, presenter: true, components: [
        { type: 'news-card', title: 'A fonte explica os resultados do estudo.', source: 'Revista', revealAtMs: 400 }
      ] },
      { durationMs: 12000, groupIndex: 0, components: [
        { type: 'rotation-cards', title: 'Contexto', cards: ['A pesquisa compara dois cenários.', 'Os dados vêm da mesma amostra.', 'As limitações precisam ser consideradas.'], revealAtMs: 260 }
      ] },
      { durationMs: 8000, groupIndex: 0, components: [] }
    ], 24000);
    const sourceSceneOffsetMs = scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
    scenes.push(...sourceScenes);
    const compositionDuration = scenes.reduce((sum, scene) => sum + scene.durationMs, 0) / 1000;
    const kitCss = await fs.readFile(path.join(repo, 'assets/scenes/kit.css'), 'utf8');
    const kitJs = await fs.readFile(path.join(repo, 'assets/scenes/kit.js'), 'utf8');
    for (const [name, width, height] of [['wide', 1920, 1080], ['tall', 1080, 1920]]) {
      const work = path.join(root, name);
      await fs.mkdir(path.join(work, 'assets'), { recursive: true });
      const composition = createCompositionHtml({ width, height, fps: 30, duration: compositionDuration, scenes, imageAssets: [],
        audioFile: 'silent.wav', robotConfig: { seed: 0, script: {}, speechEnvelope: {} }, kitCss, kitJs });
      await fs.writeFile(path.join(work, 'index.html'), composition.html);
      for (const [file, content] of Object.entries(composition.assets)) await fs.writeFile(path.join(work, 'assets', file), content);
      await fs.copyFile(bundle, path.join(work, 'assets/production-presenter.js'));
      await fs.copyFile(path.join(repo, 'experiments/hyperframes-pulso-pilot/assets/pulso-robot.glb'),path.join(work,'assets/pulso-robot.glb'));
      await fs.copyFile(path.join(repo, 'experiments/hyperframes-pulso-pilot/node_modules/gsap/dist/gsap.min.js'), path.join(work, 'assets/gsap.min.js'));
    }
    server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        const target = path.resolve(root, '.' + url.pathname);
        if (!target.startsWith(root + path.sep)) throw new Error('outside root');
        const type = target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html';
        response.setHeader('Content-Type', type);
        response.end(await fs.readFile(target));
      } catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [name, width, height] of [['wide', 1920, 1080], ['tall', 1080, 1920]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/${name}/index.html`);
      await page.waitForFunction(() => window.__pulsoProductionReady,{},{timeout:60000});
      for (const [time, side, hidden] of [[1.5,'right',false],[4.5,'right',false],[7.5,'right',false],[10.5,'right',true],[13.5,'left',false],[16.5,'right',false],[1.5,'right',false],[4.5,'right',false]]) {
        const state = await page.evaluate(time => {
          window.__timelines.main.seek(time, false);
          const root = document.getElementById('root'), canvas = document.getElementById('three-layer');
          const cb = canvas.getBoundingClientRect();
          const bounds = [...document.querySelectorAll('.caption .word')]
            .filter(word => !word.closest('.caption-page')?.hidden)
            .map(word => {
            const r = word.getBoundingClientRect();
            return { text: word.textContent, opacity: getComputedStyle(word).opacity, frameworkStart: word.hasAttribute('data-start'),
              wordStartMs: word.dataset.wordStartMs, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          });
          const nodes = [...document.querySelectorAll('.nodes .node')].map(node => {
            const rect = node.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(node);
            const textRects = [...range.getClientRects()].map(textRect => ({
              left: textRect.left, right: textRect.right, top: textRect.top, bottom: textRect.bottom
            }));
            return { text: node.textContent.trim(), left: rect.left, right: rect.right, top: rect.top,
              bottom: rect.bottom, textRects };
          });
          const image = document.querySelector('.img-hero > img'), panel = document.querySelector('.img-panel');
          const ib = image?.getBoundingClientRect();
          return { side: root.dataset.presenterSide, hidden: getComputedStyle(canvas).display === 'none',
            canvas: { left: cb.left, right: cb.right, top: cb.top, bottom: cb.bottom }, bounds, nodes,
            image: image ? { fit: getComputedStyle(image).objectFit, left: ib.left, right: ib.right, bottom: ib.bottom,
              transform: getComputedStyle(image).transform, count: document.querySelectorAll('.img-hero > img').length,
              backdrop: document.querySelectorAll('.img-hero-backdrop img').length,
              panels: panel ? 1 : 0 } : null };
        }, time);
        assert.equal(state.side, name === 'tall' ? 'right' : side, `${name} t=${time} side`);
        assert.equal(state.hidden, name === 'tall' ? false : hidden);
        if (name === 'tall' && state.image) {
          assert.equal(state.image.fit, 'contain');
          assert.equal(state.image.count, 1);
          assert.equal(state.image.backdrop, 1);
          assert.equal(state.image.panels, 0);
          assert.equal(state.image.transform, 'none', 'zoom must not crop the fitted photo');
          assert.equal(state.image.left, 0);
          assert.equal(state.image.right, width);
          assert(state.image.bottom < state.canvas.top, 'photo and presenter have separate vertical space');
        }
        assert.equal(state.bounds.length, words.length);
        for (const word of state.bounds) {
          assert.equal(word.opacity, '1');
          assert.equal(word.frameworkStart, false, 'karaoke timing must not create a HyperFrames clip');
          assert(Number.isFinite(Number(word.wordStartMs)));
          assert(word.left >= 0 && word.right <= width && word.top >= 0 && word.bottom <= height, `${name} t=${time} caption overflow`);
          const overlap = word.left < state.canvas.right && word.right > state.canvas.left && word.top < state.canvas.bottom && word.bottom > state.canvas.top;
          assert(state.hidden || !overlap, `${name} t=${time} presenter covers ${word.text}: ${JSON.stringify({ word, canvas: state.canvas })}`);
        }
        if (time === 16.5) {
          assert.deepEqual(state.nodes.map(node => node.text), graphWords);
          for (const node of state.nodes) {
            const overlap = node.left < state.canvas.right && node.right > state.canvas.left &&
              node.top < state.canvas.bottom && node.bottom > state.canvas.top;
            assert(!overlap, `${name} presenter covers diagram node ${node.text}: ${JSON.stringify({ node, canvas: state.canvas })}`);
            assert(node.textRects.length > 0, `${name} diagram node ${node.text} has no visible text`);
            for (const textRect of node.textRects) {
              assert(textRect.left >= node.left && textRect.right <= node.right &&
                textRect.top >= node.top && textRect.bottom <= node.bottom,
              `${name} diagram node text escapes its card: ${JSON.stringify({ node, textRect })}`);
              const textOverlap = textRect.left < state.canvas.right && textRect.right > state.canvas.left &&
                textRect.top < state.canvas.bottom && textRect.bottom > state.canvas.top;
              assert(!textOverlap, `${name} presenter covers diagram label ${node.text}: ${JSON.stringify({ textRect, canvas: state.canvas })}`);
            }
          }
        }
        if (name === 'wide' && time === 13.5) {
          const header = await page.evaluate(time => {
            window.__timelines.main.seek(time, false);
            const scene = document.querySelector('.scene.presenter-left');
            const heading = scene?.querySelector('.demo-header');
            const canvas = document.getElementById('three-layer').getBoundingClientRect();
            if (!heading) return null;
            const rect = heading.getBoundingClientRect();
            return {
              left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
              canvas: { left: canvas.left, right: canvas.right, top: canvas.top, bottom: canvas.bottom }
            };
          }, time);
          assert(header, 'mirrored landscape scene exposes its section header');
          const overlapsPresenter = header.left < header.canvas.right && header.right > header.canvas.left
            && header.top < header.canvas.bottom && header.bottom > header.canvas.top;
          assert(!overlapsPresenter,
            `mirrored landscape section header overlaps the presenter: ${JSON.stringify(header)}`);
        }
      }
      let longSceneOffsetMs = baseScenesDurationMs;
      for (const scene of longScenes) {
        const sampleTime = (longSceneOffsetMs + Math.min(scene.durationMs / 2, 1000)) / 1000;
        const state = await page.evaluate(time => {
          window.__timelines.main.seek(time, false);
          const root = document.getElementById('root');
          const canvas = document.getElementById('three-layer');
          const cb = canvas.getBoundingClientRect();
          const bounds = [...document.querySelectorAll('.caption .word')]
            .filter(word => !word.closest('.caption-page')?.hidden)
            .map(word => {
            const r = word.getBoundingClientRect();
            return { text: word.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          });
          const mark = document.querySelector('.watermark')?.getBoundingClientRect();
          return { side: root.dataset.presenterSide, hidden: getComputedStyle(canvas).display === 'none',
            canvas: { left: cb.left, right: cb.right, top: cb.top, bottom: cb.bottom }, bounds,
            watermark: mark ? { left: mark.left, right: mark.right, top: mark.top, bottom: mark.bottom } : null };
        }, sampleTime);
        assert(state.bounds.length > 0 && state.bounds.length <= CAPTION_MAX_WORDS,
          `${name} long caption page size ${state.bounds.length}`);
        for (const word of state.bounds) {
          assert(word.left >= 0 && word.right <= width && word.top >= 0 && word.bottom <= height,
            `${name} long caption overflow: ${JSON.stringify(word)}`);
          const robotOverlap = word.left < state.canvas.right && word.right > state.canvas.left &&
            word.top < state.canvas.bottom && word.bottom > state.canvas.top;
          assert(state.hidden || !robotOverlap, `${name} presenter covers long caption word ${word.text}`);
          if (state.watermark) {
            const brandOverlap = word.left < state.watermark.right && word.right > state.watermark.left &&
              word.top < state.watermark.bottom && word.bottom > state.watermark.top;
            assert(!brandOverlap, `${name} watermark covers long caption word ${word.text}`);
          }
        }
        longSceneOffsetMs += scene.durationMs;
      }
      if (longScenes.length === 1 && longScenes[0].components.some(component => component.type === 'caption-track')) {
        const visualScene = longScenes[0];
        const startSeconds = baseScenesDurationMs / 1000;
        const sampleStates = [];
        for (const time of [startSeconds + 0.5, startSeconds + visualScene.durationMs / 1000 - 0.5]) {
          sampleStates.push(await page.evaluate(time => {
            window.__timelines.main.seek(time, false);
            return {
              side: document.getElementById('root').dataset.presenterSide,
              pages: [...document.querySelectorAll('.caption-page')]
                .filter(page => !page.hidden)
                .map(page => page.textContent.trim())
            };
          }, time));
        }
        assert.equal(sampleStates[0].side, sampleStates[1].side, `${name} presenter stays on one side within a visual scene`);
        assert(sampleStates.every(state => state.pages.length === 1), `${name} shows one timed caption page at a time`);
        assert.notEqual(sampleStates[0].pages[0], sampleStates[1].pages[0], `${name} caption advances without a scene cut`);
      }
      let componentSceneOffsetMs = baseScenesDurationMs + longScenesDurationMs;
      for (const scene of componentScenes) {
        const types = (scene.components || []).map(component => component.type);
        const expected = expectedVisuals.find(([type]) => types.includes(type));
        const hasTimestamp = types.includes('timestamp-hud');
        const expectedComponent = expected && scene.components.find(component => component.type === expected[0]);
        const sampleWindow = expectedComponent?.sceneWindow
          || scene.components.find(component => component.type === 'timestamp-hud')?.sceneWindow;
        const sampleOffsetMs = sampleWindow
          ? sampleWindow.startMs + Math.min(1000, (sampleWindow.endMs - sampleWindow.startMs) / 2)
          : Math.min(scene.durationMs / 2, 1000);
        if (expected || hasTimestamp) {
          const sampleTime = (componentSceneOffsetMs + sampleOffsetMs) / 1000;
          const selectors = [...(expected ? [expected[1]] : []), ...(hasTimestamp ? ['.timestamp-hud'] : [])];
          const state = await page.evaluate(({ time, selectors }) => {
            window.__timelines.main.seek(time, false);
            const canvas = document.getElementById('three-layer').getBoundingClientRect();
            const bounds = selectors.map(selector => {
              const element = selector === '.timestamp-hud'
                ? [...document.querySelectorAll(selector)].find(candidate => !candidate.hidden)
                : document.querySelector(selector);
              if (!element) return { selector, missing: true };
              const rect = element.getBoundingClientRect();
              const cards = selector === '.rotation-cards'
                ? [...element.querySelectorAll('.rc-card')].map(card => {
                    const cardRect = card.getBoundingClientRect();
                    const indexRect = card.querySelector('.rc-index').getBoundingClientRect();
                    const copyRect = card.querySelector('.rc-copy').getBoundingClientRect();
                    return { left: cardRect.left, right: cardRect.right, top: cardRect.top, bottom: cardRect.bottom,
                      index: { left: indexRect.left, right: indexRect.right, top: indexRect.top, bottom: indexRect.bottom },
                      copy: { left: copyRect.left, right: copyRect.right, top: copyRect.top, bottom: copyRect.bottom } };
                  })
                : [];
              const titleRect = selector === '.rotation-cards' ? element.querySelector('.rc-title')?.getBoundingClientRect() : null;
              const checklistMarkers = selector === '.checklist'
                ? [...element.querySelectorAll('.ck-mark')].map(marker => marker.textContent)
                : [];
              return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
                width: rect.width, height: rect.height, cards,
                title: titleRect ? { left: titleRect.left, right: titleRect.right, top: titleRect.top, bottom: titleRect.bottom } : null,
                checklistMarkers };
            });
            return { bounds, canvas: { left: canvas.left, right: canvas.right, top: canvas.top, bottom: canvas.bottom } };
          }, { time: sampleTime, selectors });
          for (const visual of state.bounds) {
            assert.equal(visual.missing, undefined, `${name} ${visual.selector} missing at ${sampleTime}s`);
            assert(visual.width > 0 && visual.height > 0, `${name} ${visual.selector} has no visible area`);
            assert(visual.left >= 0 && visual.right <= width && visual.top >= 0 && visual.bottom <= height,
              `${name} ${visual.selector} outside ${width}x${height}: ${JSON.stringify(visual)}`);
            if (visual.selector !== '.timestamp-hud') {
              const overlap = visual.left < state.canvas.right && visual.right > state.canvas.left &&
                visual.top < state.canvas.bottom && visual.bottom > state.canvas.top;
              assert(!overlap, `${name} presenter covers ${visual.selector}: ${JSON.stringify({ visual, canvas: state.canvas })}`);
            }
            if (visual.selector === '.rotation-cards') {
              assert.equal(visual.cards.length, 3, `${name} must show all three cards`);
              const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
              for (const card of visual.cards) {
                assert(card.copy.left >= card.left && card.copy.right <= card.right &&
                  card.copy.top >= card.top && card.copy.bottom <= card.bottom,
                `${name} card text escapes its card: ${JSON.stringify(card)}`);
                assert(card.index.left >= card.left && card.index.right <= card.right &&
                  card.index.top >= card.top && card.index.bottom <= card.bottom,
                `${name} card index escapes its card: ${JSON.stringify(card)}`);
                assert(!overlaps(card.index, card.copy), `${name} card index overlaps its copy: ${JSON.stringify(card)}`);
              }
              assert(!overlaps(visual.title, visual.cards[0].index),
                `${name} card title overlaps the first card: ${JSON.stringify(visual)}`);
              for (let index = 1; index < visual.cards.length; index += 1) {
                const previous = visual.cards[index - 1], current = visual.cards[index];
                assert(!overlaps(previous.copy, current.index) && !overlaps(previous.copy, current.copy) &&
                  !overlaps(previous.index, current.index) && !overlaps(previous.index, current.copy),
                `${name} adjacent card text overlaps: ${JSON.stringify({ previous, current })}`);
              }
            }
            if (visual.selector === '.checklist') {
              assert.deepEqual(visual.checklistMarkers, ['01', '02', '03'],
                `${name} checklist uses step numbers rather than completion marks`);
            }
          }
          if (evidenceDir && expected) {
            await page.screenshot({ path: path.join(evidenceDir, `${name}-${expected[0]}.png`) });
          }
          const heading = scene.components.find(component => component.type === 'demo-header');
          if (heading?.entries?.length > 1) {
            for (const entry of [heading.entries[0], heading.entries[heading.entries.length - 1]]) {
              const localTimeMs = entry.startMs + Math.min(500, (entry.endMs - entry.startMs) / 2);
              const actualCategory = await page.evaluate(time => {
                window.__timelines.main.seek(time, false);
                return document.querySelector('.demo-header .category')?.textContent || '';
              }, (componentSceneOffsetMs + localTimeMs) / 1000);
              assert.equal(actualCategory, entry.category, `${name} section heading follows the timed narrative`);
            }
          }
        }
        componentSceneOffsetMs += scene.durationMs;
      }
      let articleSceneOffsetMs = baseScenesDurationMs + longScenesDurationMs + componentScenesDurationMs;
      for (const scene of articleScenes) {
        const sampleTime = (articleSceneOffsetMs + 1500) / 1000;
        await page.evaluate(time => { window.__timelines.main.seek(time, false); }, sampleTime);
        await page.waitForFunction(() => {
          const image = document.querySelector('.article-print img');
          return Boolean(image && image.complete && image.naturalWidth > 0);
        }, {}, { timeout: 10000 });
        const article = await page.evaluate(() => {
          const panel = document.querySelector('.article-print');
          const image = panel?.querySelector('img');
          if (!panel || !image) return null;
          const panelRect = panel.getBoundingClientRect();
          const imageRect = image.getBoundingClientRect();
          const source = panel.querySelector('.ap-src')?.getBoundingClientRect();
          const timeLabel = panel.querySelector('.ap-time')?.getBoundingClientRect();
          return {
            naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
            image: { left: imageRect.left, right: imageRect.right, top: imageRect.top, bottom: imageRect.bottom,
              width: imageRect.width, height: imageRect.height },
            panel: { left: panelRect.left, right: panelRect.right, top: panelRect.top, bottom: panelRect.bottom },
            source: source && { left: source.left, right: source.right, top: source.top, bottom: source.bottom,
              text: panel.querySelector('.ap-src').textContent },
            timeLabel: timeLabel && { left: timeLabel.left, right: timeLabel.right, top: timeLabel.top,
              bottom: timeLabel.bottom, text: panel.querySelector('.ap-time').textContent }
          };
        });
        assert(article, `${name} article print did not render`);
        assert.equal(article.naturalWidth / article.naturalHeight, 2, `${name} source fixture aspect ratio`);
        assert(Math.abs(article.image.width / article.image.height - 2) < 0.02,
          `${name} article source was cropped or stretched: ${JSON.stringify(article.image)}`);
        for (const [label, rect] of [['article image', article.image], ['article frame', article.panel],
          ['source attribution', article.source], ['source date', article.timeLabel]]) {
          assert(rect && rect.left >= 0 && rect.right <= width && rect.top >= 0 && rect.bottom <= height,
            `${name} ${label} outside ${width}x${height}: ${JSON.stringify(rect)}`);
        }
        assert.equal(article.source.text, 'Fonte Exemplo');
        assert.equal(article.timeLabel.text, '13 out. 2026');
        if (evidenceDir) await page.screenshot({ path: path.join(evidenceDir, `${name}-article-print.png`) });
        articleSceneOffsetMs += scene.durationMs;
      }
      // Reproduce the production incident: a source holds past its caption
      // beat, and a later card waits for that reading window, including seeks.
      for (const localMs of [1000, 7000, 8200, 18000, 1000, 8200]) {
        const state = await page.evaluate(time => {
          window.__timelines.main.seek(time, false);
          return ['.news-card', '.rotation-cards'].map(selector => {
            const element = document.querySelector(selector);
            const rect = element.getBoundingClientRect();
            return { selector, hidden: element.hidden, display: getComputedStyle(element).display,
              width: rect.width, height: rect.height };
          });
        }, (sourceSceneOffsetMs + localMs) / 1000);
        const sourceVisible = localMs < 7200;
        assert.equal(state[0].hidden, !sourceVisible, `${name} source visibility at ${localMs}`);
        assert.equal(state[1].hidden, sourceVisible, `${name} cards visibility at ${localMs}`);
        const hidden = state[sourceVisible ? 1 : 0];
        const visible = state[sourceVisible ? 0 : 1];
        assert.equal(hidden.display, 'none', `${name} inactive text has no layout box`);
        assert.equal(hidden.width * hidden.height, 0);
        assert(visible.width > 0 && visible.height > 0, `${name} active source/context has visible area`);
      }
      assert.deepEqual(errors, []);
      const contextLost = await page.evaluate(() => {
        window.disposePresenterRobot();
        const canvas = document.getElementById('three-layer');
        const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
        return Boolean(context && context.isContextLost());
      });
      assert.equal(contextLost, true, `${name} presenter WebGL context should be released before page teardown`);
      await page.close();
    }
    console.log('Presenter framing: horizontal/vertical, captions, visual components, cutaways and backward seeks passed.');
  } finally {
    await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
