'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { canReuseRenderOutput, sameRenderPlan, loadSceneImageAssets, resolveSceneImageAssets,
  parseOptions, loadInputScript, sceneAcceptance, assertCompleteSceneImageAssets, buildSceneImageReplayPlan,
  makeImageGenerationScript, semanticFrameOffsetMs } = require('../scripts/visual-standard-production-e2e');

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

test('parses reusable sample inputs and validates their editorial format', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-e2e-script-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'script.json');
  fs.writeFileSync(file, JSON.stringify({ title: 'Resposta direta', hook: { text: 'A resposta é 42.' },
    mainContent: { sections: [{ title: 'Como', content: 'A fonte explica o caminho.' }] },
    conclusion: { finalThought: 'A fonte responde.' }, editorialFormatId: 'direct-answer',
    visualAcceptance: [{ id: 'hook', expectedComponent: 'node-graph', groupKind: 'hook' }] }));

  assert.deepEqual(parseOptions(['--script=input.json', '--output-dir=out', '--render']), {
    render: true, forceTts: false, generateImages: false, renderTargets: [], scriptPath: 'input.json', outputDir: 'out'
  });
  assert.deepEqual(parseOptions(['--render', '--target=9x16', '--target=9x16']).renderTargets, ['9x16']);
  assert.throws(() => parseOptions(['--target=4x3']), /Formato de render inválido/);
  assert.equal(loadInputScript(file).editorialFormat.id, 'direct-answer');
  fs.writeFileSync(file, JSON.stringify({ title: 'incompleto' }));
  assert.throws(() => loadInputScript(file), /title, hook, sections, conclusion e visualAcceptance/);
});

test('accepts only complete narrative image manifests for the declared number of groups', () => {
  const assets = Array.from({ length: 9 }, (_item, groupIndex) => ({ groupIndex, variant: 'a', path: `g${groupIndex}.png` }));
  assert.equal(assertCompleteSceneImageAssets(assets, 9), assets);
  const withBeatVariant = [...assets, { groupIndex: 7, variant: 'b', path: 'g7b.png' }];
  assert.equal(assertCompleteSceneImageAssets(withBeatVariant, 9), withBeatVariant);
  assert.throws(() => assertCompleteSceneImageAssets(assets.slice(0, 8), 9), /8 imagens em 8\/9 grupos/);
  assert.throws(() => assertCompleteSceneImageAssets([...assets.slice(0, 8), { groupIndex: 7, variant: 'a', path: 'duplicate.png' }], 9), /9 imagens em 8\/9 grupos/);
  assert.throws(() => assertCompleteSceneImageAssets([...assets, assets[0]], 9), /variantes sem repetição/);
});

test('plans enough distinct scene images for long or multi-sentence narration beats and reuses reviewed assets', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-e2e-image-plan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = {
    hook: { text: 'Uma abertura.' },
    mainContent: { sections: [
      { title: 'Longa', content: 'Uma fala longa.' },
      { title: 'Duas frases', content: 'Primeira frase. Segunda frase.' }
    ] },
    conclusion: { finalThought: 'Fecho longo.' },
    timings: [
      { durationMs: 4000, sentences: [{ text: 'Uma abertura.' }] },
      { durationMs: 12500, sentences: [{ text: 'Uma fala longa.' }] },
      { durationMs: 5000, sentences: [{ text: 'Primeira frase.' }, { text: 'Segunda frase.' }] },
      { durationMs: 18000, sentences: [{ text: 'Fecho longo.' }] }
    ]
  };
  const reviewed = [{ groupIndex: 1, variant: 'a', path: 'approved/g1a.png', sha256: 'a'.repeat(64) }];
  const plan = buildSceneImageReplayPlan(script, reviewed, root);
  const byGroup = plan.reduce((map, item) => map.set(item.groupIndex, [...(map.get(item.groupIndex) || []), item]), new Map());

  assert.deepEqual([...byGroup.values()].map(items => items.length), [1, 2, 2, 2]);
  assert.deepEqual(byGroup.get(1).map(item => item.variant), ['a', 'b']);
  assert.equal(byGroup.get(1)[0].path, path.resolve(root, 'approved/g1a.png'));
  assert.equal(byGroup.get(1)[0].sha256, 'a'.repeat(64));
});

test('uses authored image prompts while keeping spoken cues separate for every story group', () => {
  const source = {
    hook: { text: 'A história começa.', visual: { cue: 'começa', imagePrompt: 'Asteroide em espaço profundo, sem texto.' } },
    mainContent: { sections: [{ title: 'Impacto', content: 'A nave colide.', visual: { cue: 'nave colide', imagePrompt: 'Sonda atingindo lua de asteroide, sem letras.' } }] },
    conclusion: { finalThought: 'O teste termina.', visual: { cue: 'teste termina', imagePrompt: 'Duas órbitas douradas, sem rótulos.' } }
  };

  const generated = makeImageGenerationScript(source);

  assert.equal(generated.hook, 'A história começa.');
  assert.equal(generated.imagePrompt, 'Asteroide em espaço profundo, sem texto.');
  assert.equal(generated.mainContent.sections[0].imagePrompt, 'Sonda atingindo lua de asteroide, sem letras.');
  assert.equal(generated.conclusion.imagePrompt, 'Duas órbitas douradas, sem rótulos.');
  assert.equal(source.conclusion.visual.cue, 'teste termina');
});

test('checks caller-defined semantic classes against the production ScenePlanBuilder', () => {
  const script = {
    title: 'Uma resposta', maxCaptionWords: 8,
    hook: { text: 'A requisição chega ao servidor.', visual: { type: 'node-graph', nodes: ['Pedido', 'Servidor'], cue: 'chega ao servidor' } },
    mainContent: { sections: [{ title: 'Resultado', content: 'O servidor devolve uma resposta.',
      visual: { type: 'node-graph', nodes: ['Servidor', 'Resposta'], cue: 'devolve uma resposta' } }] },
    conclusion: { finalThought: 'Pedido e resposta completam o ciclo.',
      visual: { type: 'node-graph', nodes: ['Pedido', 'Resposta'], cue: 'completam o ciclo' } },
    visualAcceptance: [
      { id: 'hook', expectedComponent: 'node-graph', groupKind: 'hook' },
      { id: 'result', expectedComponent: 'node-graph', groupTitle: 'Resultado' },
      { id: 'ending', expectedComponent: 'node-graph', groupKind: 'conclusion' }
    ]
  };
  const result = sceneAcceptance(script, [], 30000);
  assert.deepEqual(result.results.map(item => [item.id, item.present]), [
    ['hook', true], ['result', true], ['ending', true]
  ]);
  assert.deepEqual(result.narrativeCoverage.missing, []);
});

test('semantic acceptance can require the intended Atlas story beat, not only a component type', () => {
  const script = {
    title: 'Busca no Atlas',
    hook: { text: 'A busca saiu do computador.', visual: { type: 'atlas-story-scene', beat: 'retrieval', cue: 'A busca saiu' } },
    mainContent: { sections: [{ title: 'Consulta', content: 'A busca localiza o trecho solicitado.',
      visual: { type: 'atlas-story-scene', beat: 'coverage', cue: 'localiza o trecho' } }] },
    conclusion: { finalThought: 'O trecho voltou à tela.',
      visual: { type: 'atlas-story-scene', beat: 'caveat', cue: 'voltou à tela' } },
    visualAcceptance: [{ id: 'retrieval', expectedComponent: 'atlas-story-scene', expectedBeat: 'result', groupKind: 'hook' }]
  };
  assert.throws(() => sceneAcceptance(script, [], 12000), /componentes esperados: retrieval/);
  script.visualAcceptance[0].expectedBeat = 'retrieval';
  assert.equal(sceneAcceptance(script, [], 12000).results[0].present, true);
});

test('portrait four-node graphs fit full labels inside cards without crossing connector wires', () => {
  const css = fs.readFileSync(path.join(__dirname, '../assets/scenes/kit.css'), 'utf8');
  assert.match(css, /@media \(max-aspect-ratio: 1\/1\)[\s\S]*?\.scene\.has-presenter \.nodes\.compact-four-node-graph \.node\s*\{[^}]*font-size:\s*calc\(var\(--w\) \* 0\.021\)/);
  const rendererCss = fs.readFileSync(path.join(__dirname, '../utils/hyperframes-video-renderer.js'), 'utf8');
  assert.match(rendererCss, /\.scene\.explanatory-social\.has-presenter > \.nodes\.compact-four-node-graph \.node\s*\{\s*font-size:\s*calc\(var\(--w\) \* \.021\);/);
});

test('three-node graph labels stay intact and semantic samples land at the end of the selected caption scene', () => {
  const css = fs.readFileSync(path.join(__dirname, '../assets/scenes/kit.css'), 'utf8');
  const kit = fs.readFileSync(path.join(__dirname, '../assets/scenes/kit.js'), 'utf8');
  assert.match(kit, /length === 3\) wrap\.classList\.add\('compact-three-node-graph'\)/);
  assert.match(css, /\.nodes\.compact-three-node-graph \.node\s*\{[^}]*overflow-wrap:\s*anywhere;\s*word-break:\s*normal;/);
  assert.match(css, /@media \(max-aspect-ratio: 1\/1\)[\s\S]*?\.scene\.has-presenter \.nodes\.compact-three-node-graph \.node\s*\{[^}]*font-size:\s*calc\(var\(--w\) \* 0\.026\)/);
  assert.equal(semanticFrameOffsetMs(5000, 400), 1700);
  assert.equal(semanticFrameOffsetMs(100), 0);
});

test('reuses a completed aspect only while its MP4 and every reviewed frame still match hashes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-e2e-resume-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = { id: '16x9', width: 1920, height: 1080 };
  const outputPath = path.join(root, 'production-16x9.mp4');
  const framePath = path.join(root, 'frames-16x9', 'hook.png');
  fs.mkdirSync(path.dirname(framePath), { recursive: true });
  fs.writeFileSync(outputPath, 'validated-video-bytes');
  fs.writeFileSync(framePath, 'validated-frame-bytes');
  const acceptance = [{ id: 'hook' }];
  const previousRun = { target: target.id, output: {
    path: 'production-16x9.mp4', dimensions: '1920x1080', fps: 24, sha256: sha256(outputPath),
    frames: [{ class: 'hook', path: 'frames-16x9/hook.png', sha256: sha256(framePath) }]
  } };

  assert.equal(canReuseRenderOutput(root, target, previousRun, acceptance), true);
  fs.writeFileSync(framePath, 'changed-frame-bytes');
  assert.equal(canReuseRenderOutput(root, target, previousRun, acceptance), false);
});

test('resumes prior outputs only when narration, scene plan, and renderer inputs still match', () => {
  const previous = {
    schemaVersion: 1, scriptSeed: 5, tts: { audioSha256: 'a', timingSha256: 'b' },
    inputs: { 'utils/scene-plan-builder.js': 'c', 'utils/audio-mix.js': 'm', 'scripts/visual-standard-production-e2e.js': 'old' },
    acceptance: [{ id: 'hook' }]
  };
  const current = {
    schemaVersion: 1, scriptSeed: 5, tts: { audioSha256: 'a', timingSha256: 'b' },
    inputs: { 'utils/scene-plan-builder.js': 'c', 'utils/audio-mix.js': 'm', 'scripts/visual-standard-production-e2e.js': 'new' },
    acceptance: [{ id: 'hook' }]
  };
  assert.equal(sameRenderPlan(previous, { hook: 'x' }, current, { hook: 'x' }), true);
  assert.equal(sameRenderPlan(previous, { hook: 'x' }, current, { hook: 'changed' }), false);
  assert.equal(sameRenderPlan(previous, { hook: 'x' }, {
    ...current, inputs: { ...current.inputs, 'utils/scene-plan-builder.js': 'changed' }
  }, { hook: 'x' }), false);
  assert.equal(sameRenderPlan(previous, { hook: 'x' }, {
    ...current, inputs: { ...current.inputs, 'utils/audio-mix.js': 'changed' }
  }, { hook: 'x' }), false);
  assert.equal(sameRenderPlan(previous, { hook: 'x' }, {
    ...current, visualAssets: { provider: 'Gemini web', assets: [{ groupIndex: 0, sha256: 'image' }] }
  }, { hook: 'x' }), false);
});

test('loads only narrative images that remain inside the evidence folder and match their hashes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-e2e-images-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scene-images'));
  const assets = Array.from({ length: 7 }, (_item, groupIndex) => {
    const imagePath = path.join(root, 'scene-images', `beat-${groupIndex}.png`);
    fs.writeFileSync(imagePath, Buffer.from(`png-image-${groupIndex}`));
    return { groupIndex, path: `scene-images/beat-${groupIndex}.png`, sha256: sha256(imagePath) };
  });
  const imagePath = path.join(root, assets[0].path);
  fs.writeFileSync(path.join(root, 'scene-image-manifest.json'), JSON.stringify({
    assets
  }));

  const loaded = loadSceneImageAssets(root);
  assert.equal(loaded.images[0].sources[0], `data:image/png;base64,${fs.readFileSync(imagePath).toString('base64')}`);
  fs.writeFileSync(imagePath, 'changed-image-bytes');
  assert.throws(() => loadSceneImageAssets(root), /hash divergente/);
});

test('requires one narrative image for every declared script group instead of assuming seven groups', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-e2e-variable-images-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const imageDir = path.join(root, 'scene-images');
  fs.mkdirSync(imageDir);
  const assets = Array.from({ length: 9 }, (_item, groupIndex) => {
    const imagePath = path.join(imageDir, `beat-${groupIndex}.png`);
    fs.writeFileSync(imagePath, Buffer.from(`story-image-${groupIndex}`));
    return { groupIndex, variant: 'a', path: `scene-images/beat-${groupIndex}.png`, sha256: sha256(imagePath) };
  });
  fs.writeFileSync(path.join(root, 'scene-image-manifest.json'), JSON.stringify({ expectedGroupCount: 9, assets }));

  assert.equal(Object.keys(loadSceneImageAssets(root).images).length, 9);
  const manifestPath = path.join(root, 'scene-image-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ expectedGroupCount: 9, assets: assets.slice(0, 8) }));
  assert.throws(() => loadSceneImageAssets(root), /Cobertura visual parcial: 8\/9/);
});

test('regenerates requested narrative images before validating a stale manifest', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-e2e-image-regenerate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scene-images'));
  fs.writeFileSync(path.join(root, 'scene-image-manifest.json'), JSON.stringify({ assets: [
    { groupIndex: 1, path: 'scene-images/missing.png', sha256: '0'.repeat(64) }
  ] }));
  let generated = false;

  const loaded = await resolveSceneImageAssets(root, { story: 'http' }, true, async outDir => {
    generated = true;
    const assets = Array.from({ length: 7 }, (_item, groupIndex) => {
      const imagePath = path.join(outDir, 'scene-images', `replacement-${groupIndex}.png`);
      fs.writeFileSync(imagePath, Buffer.from(`replacement-${groupIndex}`));
      return { groupIndex, path: `scene-images/replacement-${groupIndex}.png`, sha256: sha256(imagePath) };
    });
    fs.writeFileSync(path.join(outDir, 'scene-image-manifest.json'), JSON.stringify({ assets }));
    return loadSceneImageAssets(outDir);
  });

  assert.equal(generated, true);
  assert.equal(Object.keys(loaded.images).length, 7);
});
