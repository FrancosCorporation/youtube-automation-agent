'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { ScenePlanBuilder } = require('../utils/scene-plan-builder');
const { sceneForViewport } = require('../utils/portrait-scene-layout');

async function main() {
  const title = 'Custos por tarefa e limites da comparação entre modelos';
  const text = 'A fonte explica o assunto com dados e mantém explícitos os limites da comparação.';
  const words = text.split(' ');
  const scenes = new ScenePlanBuilder().buildScenes({ minimal: true, steadyNarrative: true, forceLayout: 'hero',
    mainContent: { sections: [{ title, content: text }] },
    timings: [{ durationMs: 44000, sentences: Array.from({ length: 4 }, (_, index) => ({
      text, words, startMs: index * 11000, durationMs: 11000
    })) }]
  }, 44000, { 0: { sources: ['data:image/png;base64,AA=='] } }).map(scene => sceneForViewport(scene, 1080, 1920));
  const scene = scenes.find(scene => scene.components.some(component => component.type === 'bento-card')
    && !scene.components.some(component => component.type === 'image-hero'));
  assert(scene, 'exercise an interlude-only scene, which has no portrait-photo class');
  const card = scene.components.find(component => component.type === 'bento-card');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    const css = await fs.readFile(path.join(__dirname, '../assets/scenes/kit.css'), 'utf8');
    await page.setContent(`<html><head><style>${css}:root{--w:1080px;--h:1920px;}</style></head><body><div id="scene-root"></div></body></html>`);
    await page.addScriptTag({ content: await fs.readFile(path.join(__dirname, '../assets/scenes/kit.js'), 'utf8') });
    await page.evaluate(({ scene, at }) => { window.buildScene(scene); window.renderAt(at); },
      { scene, at: card.sceneWindow.startMs + 600 });
    const bounds = await page.locator('.bento:not([hidden])').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { y: rect.y, height: rect.height, scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight, text: element.textContent };
    });
    assert(bounds.y >= 382 && bounds.y + bounds.height <= 1001, 'interlude stays inside the image area, above the presenter');
    assert(bounds.scrollHeight <= bounds.clientHeight, 'editorial text fits without overflow');
    assert(bounds.text.includes(title));
    const output = process.argv[2] || path.join(os.tmpdir(), 'pulso-one-image-layout.png');
    await page.screenshot({ path: output });
    await fs.writeFile(`${output}.json`, JSON.stringify(bounds, null, 2));

    const [chapterScene] = new ScenePlanBuilder().coalesceVisualScenes([
      { groupIndex: 0, durationMs: 5000, components: [{
        type: 'demo-header', category: 'Abertura', chapterIndex: 1, chapterTotal: 2,
        chapterStartMs: 0, chapterDurationMs: 5000
      }] },
      { groupIndex: 1, durationMs: 5000, components: [{
        type: 'demo-header', category: 'Conclusão', chapterIndex: 2, chapterTotal: 2,
        chapterStartMs: 0, chapterDurationMs: 5000
      }] }
    ], 10000);
    await page.evaluate(({ scene, at }) => { window.buildScene(scene); window.renderAt(at); },
      { scene: chapterScene, at: 7500 });
    const progress = await page.evaluate(() => ({
      category: document.querySelector('.demo-header .category')?.textContent,
      counter: document.querySelector('.chapter-counter')?.textContent,
      segments: Array.from(document.querySelectorAll('.chapter-segment')).map(segment => ({
        complete: segment.classList.contains('complete'),
        active: segment.classList.contains('active'),
        transform: segment.querySelector('.chapter-fill')?.style.transform
      }))
    }));
    assert.deepEqual(progress, {
      category: 'Conclusão',
      counter: '02 / 02',
      segments: [
        { complete: true, active: false, transform: 'scaleX(1)' },
        { complete: false, active: true, transform: 'scaleX(0.5)' }
      ]
    }, 'chapter label and segmented progress track follow the narration timeline');
    await page.screenshot({ path: `${output}.chapters.png` });

    const continuedChunks = new ScenePlanBuilder().coalesceVisualScenes([
      ...Array.from({ length: 2 }, (_, index) => ({ groupIndex: 4, durationMs: 2500, components: [{
        type: 'demo-header', category: 'Explicação', chapterIndex: 2, chapterTotal: 3,
        chapterStartMs: index * 2500, chapterDurationMs: 10000
      }] })),
      ...Array.from({ length: 2 }, (_, index) => ({ groupIndex: 4, durationMs: 2500, components: [{
        type: 'demo-header', category: 'Explicação', chapterIndex: 2, chapterTotal: 3,
        chapterStartMs: 5000 + index * 2500, chapterDurationMs: 10000
      }] }))
    ], 5000);
    await page.evaluate(({ scene, at }) => { window.buildScene(scene); window.renderAt(at); },
      { scene: continuedChunks[1], at: 2500 });
    const continuedProgress = await page.evaluate(() => ({
      fill: document.querySelectorAll('.chapter-fill')[1]?.style.transform,
      label: document.querySelector('.chapter-track')?.getAttribute('aria-label')
    }));
    assert.deepEqual(continuedProgress, { fill: 'scaleX(0.75)', label: 'Seção 2 de 3' },
      'chapter fill continues from the previous coalesced chunk');

    const motionScene = { durationMs: 1500, components: [{
      type: 'bento-card', title: 'Dado confirmado', subtitle: 'Fonte identificada', revealAtMs: 300,
      sceneWindow: { startMs: 300, endMs: 1500 }
    }] };
    await page.evaluate(scene => { window.buildScene(scene); window.renderAt(500); }, motionScene);
    const entrance = await page.locator('.bento').evaluate(node => ({
      opacity: window.getComputedStyle(node).opacity,
      transform: window.getComputedStyle(node).transform,
      hidden: node.hidden
    }));
    await page.screenshot({ path: `${output}.motion.png` });
    await page.evaluate(() => window.renderAt(1410));
    const exit = await page.locator('.bento').evaluate(node => ({
      opacity: window.getComputedStyle(node).opacity,
      transform: window.getComputedStyle(node).transform
    }));
    await page.evaluate(() => window.renderAt(500));
    const reseek = await page.locator('.bento').evaluate(node => ({
      opacity: window.getComputedStyle(node).opacity,
      transform: window.getComputedStyle(node).transform,
      hidden: node.hidden
    }));
    assert(Number(entrance.opacity) > 0.6, 'entrance reaches readable opacity');
    assert(Number(exit.opacity) < 0.1, 'exit is shorter and clears the visual before its window ends');
    assert.equal(entrance.hidden, false);
    assert.deepEqual(reseek, entrance, 'backward seek reproduces the same entrance frame');
    await page.evaluate(() => window.renderAt(1500));
    assert.equal(await page.locator('.bento').evaluate(node => node.hidden), true,
      'visual hides exactly at the end of its scene window');

    await page.evaluate(() => {
      window.buildScene({ durationMs: 1000, components: [{ type: 'kinetic-number', value: '35%', label: 'medição' }] });
      window.renderAt(260);
    });
    const springMidpoint = await page.locator('.kinetic').evaluate(node => new window.DOMMatrixReadOnly(
      window.getComputedStyle(node).transform
    ).a);
    await page.evaluate(() => window.renderAt(520));
    const springEnd = await page.locator('.kinetic').evaluate(node => new window.DOMMatrixReadOnly(
      window.getComputedStyle(node).transform
    ).a);
    assert(springMidpoint > 1 && springMidpoint < 1.03, 'spring entrance has restrained spatial overshoot');
    assert.equal(springEnd, 1, 'spring reaches its exact terminal scale');

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.setContent(`<html><head><style>${css}:root{--w:1920px;--h:1080px;}</style></head><body><div id="scene-root"></div></body></html>`);
    await page.addScriptTag({ content: await fs.readFile(path.join(__dirname, '../assets/scenes/kit.js'), 'utf8') });
    await page.evaluate(scene => { window.buildScene(scene); window.renderAt(7500); }, chapterScene);
    const wideLayout = await page.evaluate(() => {
      const category = document.querySelector('.demo-header .category').getBoundingClientRect();
      const progress = document.querySelector('.chapter-progress').getBoundingClientRect();
      return { categoryRight: category.right, progressLeft: progress.left, progressRight: progress.right };
    });
    assert(wideLayout.categoryRight < wideLayout.progressLeft, 'wide chapter HUD does not cover the section title');
    assert(wideLayout.progressRight <= 1920 - 96, 'wide chapter HUD stays inside the video safe area');
    await page.screenshot({ path: `${output}.chapters-wide.png` });
    console.log('PASS: portrait interlude, chapter progress, spring entrance, faster exit, and backward seek validated.');
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
