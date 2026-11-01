'use strict';

// Small, real-pipeline acceptance harness for the production Remotion renderer.
// Default mode synthesizes real Edge TTS narration and validates the production
// scene plan. Pass --render only after the host is idle; renders are sequential.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DIR = path.join(ROOT, 'docs/evidencias/visual-standard-production-e2e-2026-10-21');
const VOICE = process.env.TTS_VOICE || 'pt-BR-FranciscaNeural';
const RATE = process.env.TTS_RATE || '-3%';
const PITCH = process.env.TTS_PITCH || '-1Hz';
const FPS = 24;
const DEFAULT_VISUAL_ACCEPTANCE = [
  { id: 'hook-journey', expectedComponent: 'node-graph', groupKind: 'hook' },
  { id: 'story-process', expectedComponent: 'node-graph', groupTitle: 'A requisição sai do navegador' },
  { id: 'mechanism-object', expectedComponent: 'node-graph', groupTitle: 'A conexão protege o caminho' },
  { id: 'number-comparison-200', category: 'number-comparison', expectedComponent: 'node-graph', groupTitle: 'Resposta de sucesso: código 200' },
  { id: 'number-comparison-404', category: 'number-comparison', expectedComponent: 'node-graph', groupTitle: 'Resposta alternativa: código 404' },
  { id: 'source-evidence', category: 'evidence-news', expectedComponent: 'news-card', componentTitle: 'HTTP: Hypertext Transfer Protocol' },
  { id: 'conclusion-journey', expectedComponent: 'node-graph', groupKind: 'conclusion' }
];

function parseOptions(argv = process.argv.slice(2)) {
  const options = { render: argv.includes('--render'), forceTts: argv.includes('--force-tts'),
    generateImages: argv.includes('--generate-images'), renderTargets: [] };
  for (const arg of argv) {
    if (arg.startsWith('--output-dir=')) options.outputDir = arg.slice('--output-dir='.length);
    if (arg.startsWith('--script=')) options.scriptPath = arg.slice('--script='.length);
    if (arg.startsWith('--target=')) options.renderTargets.push(arg.slice('--target='.length));
  }
  const supportedTargets = new Set(['16x9', '9x16']);
  if (options.renderTargets.some(target => !supportedTargets.has(target))) {
    throw new TypeError('Formato de render inválido; use --target=16x9 ou --target=9x16.');
  }
  options.renderTargets = [...new Set(options.renderTargets)];
  return options;
}

function loadInputScript(scriptPath) {
  if (!scriptPath) return makeScript();
  const resolved = path.resolve(scriptPath);
  const script = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!script || typeof script !== 'object' || !script.title || !script.hook?.text
    || !Array.isArray(script.mainContent?.sections) || !script.mainContent.sections.length
    || !script.conclusion?.finalThought || !Array.isArray(script.visualAcceptance)
    || !script.visualAcceptance.length) {
    throw new TypeError('Roteiro de entrada precisa de title, hook, sections, conclusion e visualAcceptance.');
  }
  const { resolveEditorialFormat } = require(path.join(ROOT, 'utils/editorial-formats'));
  if (script.editorialFormatId) {
    script.editorialFormat = resolveEditorialFormat({ formatId: script.editorialFormatId });
  }
  return script;
}

function assertCompleteSceneImageAssets(assets, expectedGroupCount) {
  const expected = Math.max(1, Math.floor(Number(expectedGroupCount) || 0));
  const rows = Array.isArray(assets) ? assets : [];
  const groups = new Set();
  const variants = new Set();
  let invalidAsset = false;
  for (const asset of rows) {
    if (!Number.isInteger(asset?.groupIndex) || asset.groupIndex < 0 || asset.groupIndex >= expected
      || !String(asset.variant || '').trim() || !String(asset.path || '').trim()) {
      invalidAsset = true;
      continue;
    }
    groups.add(asset.groupIndex);
    const variantKey = `${asset.groupIndex}:${asset.variant}`;
    if (variants.has(variantKey)) invalidAsset = true;
    variants.add(variantKey);
  }
  if (!Array.isArray(assets) || invalidAsset || groups.size !== expected
    || Array.from({ length: expected }, (_item, index) => groups.has(index)).some(present => !present)) {
    throw new Error(`Gemini entregou ${assets?.length || 0} imagens em ${groups.size}/${expected} grupos; cada grupo precisa de uma imagem e variantes sem repetição.`);
  }
  return assets;
}

function buildSceneImageReplayPlan(script, existingAssets = [], outDir = ROOT) {
  const { SOCIAL_IMAGE_TARGET_MS, SOCIAL_IMAGE_MAX_MS } = require(path.join(ROOT, 'utils/scene-plan-builder'));
  const variants = ['a', 'b', 'c', 'd', 'e', 'f'];
  const currentByGroup = new Map();
  for (const asset of existingAssets) {
    const current = currentByGroup.get(asset.groupIndex) || new Map();
    current.set(String(asset.variant || 'a'), asset);
    currentByGroup.set(asset.groupIndex, current);
  }
  return canonicalGroups(script).flatMap((groupText, groupIndex) => {
    const timing = script.timings?.[groupIndex];
    const timedSentences = Array.isArray(timing?.sentences)
      ? timing.sentences.filter(sentence => String(sentence?.text || '').trim())
      : String(groupText || '').split(/(?<=[.!?…])\s+/).filter(Boolean);
    const durationMs = Number(timing?.durationMs);
    const durationImages = durationMs > 0
      ? Math.max(1, Math.round(durationMs / SOCIAL_IMAGE_TARGET_MS), Math.ceil(durationMs / SOCIAL_IMAGE_MAX_MS))
      : 1;
    const existing = currentByGroup.get(groupIndex) || new Map();
    const neededImages = Math.min(variants.length, Math.max(durationImages, timedSentences.length, existing.size, 1));
    const selected = [...existing.entries()].slice(0, neededImages).map(([variant, asset]) => ({
      groupIndex, variant, path: path.resolve(outDir, asset.path), sha256: asset.sha256
    }));
    const selectedVariants = new Set(selected.map(asset => asset.variant));
    for (const variant of variants) {
      if (selected.length >= neededImages) break;
      if (selectedVariants.has(variant)) continue;
      selected.push({ groupIndex, variant });
      selectedVariants.add(variant);
    }
    return selected;
  });
}

function section(title, content, visual, source, news = null) {
  return { title, content, visual, emotion: 'confidence', source, ...(news ? { news } : {}) };
}

function makeScript() {
  return {
    title: 'A viagem de uma página pela web',
    steadyNarrative: true,
    hook: { text: 'Ao abrir uma página, uma mensagem sai do navegador, cruza a rede e volta como resposta.', visual: {
      type: 'node-graph', nodes: ['Navegador', 'Rede', 'Servidor', 'Página'], cue: 'cruza a rede'
    } },
    hookEmotion: 'curiosity',
    theme: 'ia',
    channel: 'Pulso IA',
    seed: 20261021,
    watermark: true,
    maxCaptionWords: 8,
    mainContent: { sections: [
      section(
        'A requisição sai do navegador',
        'Primeiro, o navegador envia uma requisição HTTP ao servidor pedindo o recurso da página.',
        {
          type: 'node-graph',
          nodes: ['Navegador', 'Servidor'],
          cue: 'envia uma requisição HTTP'
        },
        {
          title: 'MDN Web Docs — HTTP',
          url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP'
        }
      ),
      section(
        'A conexão protege o caminho',
        'Quando o endereço usa HTTPS, o protocolo TLS protege os dados enquanto eles viajam entre navegador e servidor.',
        {
          type: 'node-graph',
          nodes: ['Navegador', 'Canal TLS', 'Servidor'],
          cue: 'TLS protege os dados'
        },
        {
          title: 'MDN Web Docs — TLS',
          url: 'https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Transport_Layer_Security'
        }
      ),
      section(
        'Resposta de sucesso: código 200',
        'Se o servidor encontra a página, ele responde com HTTP 200, que indica que a requisição teve sucesso.',
        {
          type: 'node-graph',
          nodes: ['Servidor', 'HTTP 200', 'Página encontrada'],
          cue: 'HTTP 200'
        },
        {
          title: 'MDN Web Docs — códigos de estado HTTP',
          url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status'
        }
      ),
      section(
        'Resposta alternativa: código 404',
        'Se o servidor não encontra o recurso pedido, pode responder com HTTP 404, que informa que ele não foi encontrado.',
        {
          type: 'node-graph',
          nodes: ['Servidor', 'HTTP 404', 'Recurso não encontrado'],
          cue: 'HTTP 404'
        },
        {
          title: 'MDN Web Docs — códigos de estado HTTP',
          url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status'
        }
      ),
      section(
        'A resposta fecha o percurso',
        'A documentação da MDN descreve esse ciclo: o cliente envia uma requisição e aguarda a resposta do servidor.',
        {
          type: 'node-graph', nodes: ['Cliente', 'Requisição', 'Servidor', 'Resposta'],
          cue: 'aguarda a resposta'
        },
        {
          title: 'MDN Web Docs — HTTP',
          url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP'
        },
        { title: 'HTTP: Hypertext Transfer Protocol', source: 'MDN Web Docs', sourceTypeLabel: 'documentação oficial',
          referenceLabel: 'documentação técnica' }
      )
    ] },
    conclusion: { finalThought: 'A página percorre uma história simples: pedido, transporte, resposta e conteúdo de volta ao navegador.', visual: {
      type: 'node-graph', nodes: ['Pedido', 'Transporte', 'Resposta', 'Conteúdo'], cue: 'pedido, transporte, resposta'
    } }
  };
}

function words(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').match(/[\p{L}\p{N}]+/gu) || [];
}

function canonicalGroups(script) {
  return [
    String(script.hook.text),
    ...script.mainContent.sections.map(item => item.content),
    String(script.conclusion.finalThought)
  ];
}

function buildTimings(script, events, audioDurationMs) {
  const groups = canonicalGroups(script);
  const allExpected = groups.flatMap(words);
  const allEvents = events.flatMap(event => {
    const tokens = words(event.text);
    return tokens.map(token => ({ token, startMs: Number(event.startMs), endMs: Number(event.endMs) }));
  });
  if (allExpected.length !== allEvents.length) {
    throw new Error(`TTS/timing incompatível: roteiro tem ${allExpected.length} palavras e Edge TTS retornou ${allEvents.length}`);
  }
  for (let index = 0; index < allExpected.length; index += 1) {
    if (allExpected[index] !== allEvents[index].token) {
      throw new Error(`Alinhamento TTS divergente na palavra ${index + 1}: esperado “${allExpected[index]}”, recebido “${allEvents[index].token}”`);
    }
  }

  let cursor = 0;
  const grouped = groups.map(text => {
    const tokens = words(text);
    const selected = allEvents.slice(cursor, cursor + tokens.length);
    cursor += tokens.length;
    return { text, tokens, events: selected };
  });
  return grouped.map((group, groupIndex) => {
    const startMs = group.events[0]?.startMs;
    const endMs = groupIndex + 1 < grouped.length
      ? grouped[groupIndex + 1].events[0]?.startMs
      : audioDurationMs;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new Error(`Limites de áudio inválidos no grupo ${groupIndex + 1}`);
    }
    let tokenCursor = 0;
    let sentenceStartIndex = 0;
    const sentences = group.text.split(/(?<=[.!?…])\s+/).filter(Boolean).map((text, sentenceIndex, list) => {
      const sentenceWords = words(text);
      const selected = group.events.slice(tokenCursor, tokenCursor + sentenceWords.length);
      tokenCursor += sentenceWords.length;
      if (selected.length !== sentenceWords.length || selected.some((event, index) => event.token !== sentenceWords[index])) {
        throw new Error(`Limites de palavra não correspondem à frase do grupo ${groupIndex + 1}: ${text}`);
      }
      const sentenceStart = selected[0].startMs;
      const sentenceEnd = sentenceIndex + 1 < list.length
        ? group.events.slice(tokenCursor)[0]?.startMs
        : endMs;
      const durationMs = Math.max(1, Math.round(sentenceEnd - sentenceStart));
      const out = {
        text,
        words: text.split(/\s+/).filter(Boolean),
        startMs: Math.max(0, Math.round(sentenceStart - startMs)),
        durationMs,
        wordTimes: selected.map(event => Math.max(0, Math.round(event.startMs - sentenceStart))),
        wordEndTimes: selected.map(event => Math.min(durationMs, Math.max(1, Math.round(event.endMs - sentenceStart))))
      };
      sentenceStartIndex += sentenceWords.length;
      return out;
    });
    if (tokenCursor !== group.tokens.length || sentenceStartIndex !== group.tokens.length) {
      throw new Error(`A frase não consumiu todas as palavras do grupo ${groupIndex + 1}`);
    }
    return {
      durationMs: Math.max(1, Math.round(endMs - startMs)),
      audioOffsetMs: Math.round(startMs),
      alignment: 'edge-tts-word-boundary-events',
      provider: 'edge-tts',
      sentences
    };
  });
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function canReuseRenderOutput(outDir, target, previousRun, acceptance) {
  const output = previousRun?.output;
  if (previousRun?.target !== target.id || output?.dimensions !== `${target.width}x${target.height}`
    || Number(output?.fps) !== FPS || !/^[a-f0-9]{64}$/i.test(String(output?.sha256 || ''))
    || !Array.isArray(output.frames) || output.frames.length !== acceptance.length) return false;
  const outputPath = path.join(outDir, `production-${target.id}.mp4`);
  if (!fs.existsSync(outputPath) || hashFile(outputPath) !== output.sha256) return false;
  const frameByClass = new Map(output.frames.map(frame => [frame.class, frame]));
  for (const semantic of acceptance) {
    const frame = frameByClass.get(semantic.id);
    if (!frame || typeof frame.path !== 'string' || !/^[a-f0-9]{64}$/i.test(String(frame.sha256 || ''))) return false;
    const framePath = path.resolve(outDir, frame.path);
    if (!framePath.startsWith(`${path.resolve(outDir)}${path.sep}`) || !fs.existsSync(framePath)
      || hashFile(framePath) !== frame.sha256) return false;
  }
  return true;
}

function loadSceneImageAssets(outDir) {
  const manifestPath = path.join(outDir, 'scene-image-manifest.json');
  if (!fs.existsSync(manifestPath)) return { manifest: null, images: {} };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const images = {};
  const root = path.resolve(outDir);
  const expectedGroupCount = Number.isInteger(manifest.expectedGroupCount) ? manifest.expectedGroupCount : 7;
  for (const asset of manifest.assets || []) {
    const imagePath = path.resolve(root, asset.path);
    if (!imagePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(imagePath)
      || hashFile(imagePath) !== asset.sha256 || !Number.isInteger(asset.groupIndex)) {
      throw new Error(`Imagem narrativa ausente ou hash divergente: ${asset.path}`);
    }
    const mime = path.extname(imagePath).toLowerCase() === '.jpg' || path.extname(imagePath).toLowerCase() === '.jpeg'
      ? 'image/jpeg' : 'image/png';
    const source = `data:${mime};base64,${fs.readFileSync(imagePath).toString('base64')}`;
    images[asset.groupIndex] = images[asset.groupIndex] || { sources: [] };
    images[asset.groupIndex].sources.push(source);
  }
  if (manifest.assets?.length && (Object.keys(images).length !== expectedGroupCount
    || Array.from({ length: expectedGroupCount }, (_item, index) => images[index]).some(value => !value))) {
    throw new Error(`Cobertura visual parcial: ${Object.keys(images).length}/${expectedGroupCount} grupos com imagens.`);
  }
  return { manifest, images };
}

function makeImageGenerationScript(script) {
  const imagePromptFor = visual => String(visual?.imagePrompt || visual?.cue || '');
  return {
    ...script,
    imagePrompt: imagePromptFor(script.hook.visual),
    hook: script.hook.text,
    mainContent: { sections: script.mainContent.sections.map(item => ({
      ...item, imagePrompt: imagePromptFor(item.visual)
    })) },
    conclusion: { ...script.conclusion, imagePrompt: imagePromptFor(script.conclusion.visual) }
  };
}

async function generateSceneImageAssets(outDir, script) {
  const { GeminiImageProvider } = require(path.join(ROOT, 'utils/gemini-image-provider'));
  const { generateSceneImages } = require(path.join(ROOT, 'scripts/generate-animated-video'));
  process.env.GEMINI_WEB = '0';
  const generationScript = makeImageGenerationScript(script);
  const provider = new GeminiImageProvider({ preferred: 'android', androidEnabled: true,
    androidOptions: { device: process.env.GEMINI_ANDROID_DEVICE || 'emulator-5560', browserPackage: 'com.android.chrome',
      cdpUrl: process.env.GEMINI_ANDROID_CDP_URL || process.env.GEMINI_WEB_CDP_URL || 'http://127.0.0.1:9223',
      probeTimeoutMs: 90000, pollIntervalMs: 1000 } });
  const source = script.sourceEvidence || {};
  const primarySource = source.primary || script.mainContent.sections.map(item => item.source).find(Boolean) || {};
  const storyId = String(script.storyId || script.title).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'pulso-e2e-story';
  const storyFingerprint = crypto.createHash('sha256').update(JSON.stringify({
    title: script.title, groups: canonicalGroups(script), sourceEvidence: script.sourceEvidence || null
  })).digest('hex').slice(0, 10);
  const cacheDirectory = path.join(outDir, 'scene-images', `${storyId}-${storyFingerprint}`);
  const existingAssets = loadSceneImageAssets(outDir).manifest?.assets || [];
  const result = await generateSceneImages(generationScript, `pulso-e2e-${storyId}`,
    script.title, {
      sourceTitle: source.title || primarySource.title || 'Fonte revisada',
      sourceUrl: source.url || primarySource.url || '',
      sourceContext: source.context || '',
      provider,
      cacheDirectory,
      imageLibraryDirectory: path.join(outDir, 'scene-image-library'),
      replaySceneImages: buildSceneImageReplayPlan(script, existingAssets, outDir)
    });
  const assets = result.sceneImageAssets.map(asset => ({
    groupIndex: asset.groupIndex,
    variant: asset.variant,
    path: path.relative(outDir, path.resolve(ROOT, asset.path)),
    sha256: asset.sha256
  }));
  assertCompleteSceneImageAssets(assets, canonicalGroups(script).length);
  const manifest = {
    generatedAt: new Date().toISOString(),
    provider: 'Gemini web no Chrome autenticado do emulador Android via ADB',
    expectedGroupCount: canonicalGroups(script).length,
    storyFingerprint,
    assets
  };
  writeJson(path.join(outDir, 'scene-image-manifest.json'), manifest);
  return loadSceneImageAssets(outDir);
}

async function resolveSceneImageAssets(outDir, script, regenerate, generate = generateSceneImageAssets) {
  return regenerate ? generate(outDir, script) : loadSceneImageAssets(outDir);
}

function sameRenderPlan(previousEvidence, previousScript, evidence, script) {
  if (!previousEvidence || !previousScript || previousEvidence.schemaVersion !== evidence.schemaVersion
    || previousEvidence.scriptSeed !== evidence.scriptSeed
    || previousEvidence.tts?.audioSha256 !== evidence.tts.audioSha256
    || previousEvidence.tts?.timingSha256 !== evidence.tts.timingSha256
    || JSON.stringify(previousScript) !== JSON.stringify(script)) return false;
  const stableInputs = Object.keys(evidence.inputs).filter(file => file !== 'scripts/visual-standard-production-e2e.js');
  if (stableInputs.some(file => previousEvidence.inputs?.[file] !== evidence.inputs[file])) return false;
  const classes = value => (value.acceptance || []).map(item => item.id);
  return JSON.stringify(classes(previousEvidence)) === JSON.stringify(classes(evidence))
    && JSON.stringify(previousEvidence.visualAssets || null) === JSON.stringify(evidence.visualAssets || null);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeChecksums(outDir, audioPath, timingPath) {
  const files = ['script.json', 'evidence.json', path.relative(outDir, audioPath),
    path.relative(outDir, timingPath), 'narration.txt'];
  const imageManifestPath = path.join(outDir, 'scene-image-manifest.json');
  if (fs.existsSync(imageManifestPath)) {
    files.push('scene-image-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(imageManifestPath, 'utf8'));
    files.push(...manifest.assets.map(asset => asset.path));
  }
  const lines = files.map(file => `${hashFile(path.join(outDir, file))}  ${file}`);
  fs.writeFileSync(path.join(outDir, 'SHA256SUMS'), `${lines.join('\n')}\n`);
}

function probeHost() {
  const { probeRenderHardwareGate } = require(path.join(ROOT, 'utils/render-timing'));
  const gate = probeRenderHardwareGate();
  const activeRenderOrPreviewProcesses = gate.activeRenderProcesses.map(pid => {
    try {
      const command = fs.readFileSync(`/proc/${pid}/cmdline`).toString().replaceAll('\0', ' ').trim();
      return { pid, command: command.slice(0, 260) };
    } catch { return { pid, command: 'process ended during probe' }; }
  });
  return { ...gate, activeRenderOrPreviewProcesses };
}

function shellTool(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} falhou (${result.status}): ${result.stderr?.slice(-1200)}`);
  return result.stdout;
}

async function synthesizeTts(outDir, script) {
  const audioPath = path.join(outDir, 'narration-edge-tts.mp3');
  const timingPath = path.join(outDir, 'narration-edge-tts.word-boundaries.json');
  const textPath = path.join(outDir, 'narration.txt');
  const text = canonicalGroups(script).join(' ');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(textPath, `${text}\n`);
  const helper = path.join(ROOT, 'scripts/synthesize-edge-tts-word-boundaries.py');
  shellTool(process.env.PYTHON_PATH || 'python3', [helper,
    '--text-file', textPath, '--audio', audioPath, '--timings', timingPath,
    '--voice', VOICE, '--rate', RATE, '--pitch', PITCH], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
  const timingData = JSON.parse(fs.readFileSync(timingPath, 'utf8'));
  if (timingData.alignment !== 'edge-tts-word-boundary-events' || !timingData.events?.length) {
    throw new Error('Edge TTS não entregou limites reais por palavra. Nenhum render foi iniciado.');
  }
  const probe = JSON.parse(await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', audioPath]).then(result => result.stdout));
  const durationMs = Math.round(Number(probe.format?.duration) * 1000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('ffprobe não encontrou duração válida na narração Edge TTS.');
  return { audioPath, timingPath, textPath, timingData, durationMs };
}

function sceneAcceptance(script, timings, durationMs) {
  const { ScenePlanBuilder } = require(path.join(ROOT, 'utils/scene-plan-builder'));
  const builder = new ScenePlanBuilder();
  const scenes = builder.buildScenes(script, durationMs, {}, null);
  const beatScenes = builder.buildScenes(script, durationMs, {}, null, {
    coalesce: false, includeNarrationSentenceIndex: true
  });
  const { assertNarrativeVisualCoverage } = require(path.join(ROOT, 'utils/narrative-visual-coverage'));
  const narrativeCoverage = assertNarrativeVisualCoverage(beatScenes);
  const classes = script.visualAcceptance || DEFAULT_VISUAL_ACCEPTANCE;
  const results = classes.map(item => {
    const scene = scenes.find(candidate => (!item.groupTitle || candidate.groupTitle === item.groupTitle)
      && (!item.groupKind || candidate.groupKind === item.groupKind)
      && candidate.components?.some(component => component.type === item.expectedComponent
        && (!item.expectedBeat || component.beat === item.expectedBeat)
        && (!item.componentTitle || component.title === item.componentTitle)));
    const component = scene?.components?.find(value => value.type === item.expectedComponent
      && (!item.expectedBeat || value.beat === item.expectedBeat)
      && (!item.componentTitle || value.title === item.componentTitle));
    return { ...item, present: Boolean(scene && component), component,
      sceneGroupTitle: scene?.groupTitle || null, sceneIndex: scene ? scenes.indexOf(scene) : null };
  });
  const missing = results.filter(item => !item.present);
  if (missing.length) throw new Error(`O ScenePlanBuilder de produção não criou componentes esperados: ${missing.map(item => item.id).join(', ')}`);
  return { scenes, results, narrativeCoverage: { coveredSentenceCount: new Set(beatScenes
    .map(scene => `${scene.groupIndex}:${scene.narrationSentenceIndex}`)).size, missing: narrativeCoverage.missing } };
}

async function captureFrame(videoPath, framePath, timestampSeconds) {
  await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', timestampSeconds.toFixed(3),
    '-i', videoPath, '-frames:v', '1', '-update', '1', framePath]);
  if (!fs.existsSync(framePath) || fs.statSync(framePath).size < 5000) throw new Error(`Quadro vazio ou truncado: ${framePath}`);
}

function semanticFrameOffsetMs(sceneDurationMs, latestElementRevealMs = 0) {
  const durationMs = Math.max(1, Math.floor(Number(sceneDurationMs) || 0));
  const latestRevealMs = Math.max(0, Math.floor(Number(latestElementRevealMs) || 0));
  const preferredMs = Math.max(1200, latestRevealMs + 1300);
  return Math.max(0, Math.min(durationMs - 600, preferredMs));
}

async function renderOutputs(outDir, script, audioPath, durationMs, plannedScenes, evidence, images = {}, renderTargets = []) {
  const preflight = probeHost();
  evidence.renderPreflight = preflight;
  writeJson(path.join(outDir, 'evidence.json'), evidence);
  if (!preflight.renderSafe) {
    throw Object.assign(new Error('Render suspenso pelo bloqueio de recursos: aguardar o término de preview/render ativo e memória/carga estáveis.'), {
      code: 'HOST_RESOURCE_GATE', preflight
    });
  }

  const { RemotionStoryVideoRenderer } = require(path.join(ROOT, 'utils/remotion-story-video-renderer'));
  const allTargets = [
    { id: '16x9', width: 1920, height: 1080 },
    { id: '9x16', width: 1080, height: 1920 }
  ];
  const targets = renderTargets.length
    ? allTargets.filter(target => renderTargets.includes(target.id))
    : allTargets;
  for (const target of targets) {
    const previousRun = evidence.renderRuns.find(run => run.target === target.id);
    if (canReuseRenderOutput(outDir, target, previousRun, evidence.acceptance)) {
      console.log(`[visual-standard-production-e2e] ${target.id} preservado: MP4 e ${evidence.acceptance.length} quadros conferem pelos hashes.`);
      continue;
    }
    evidence.renderRuns = evidence.renderRuns.filter(run => run.target !== target.id);
    const preRender = probeHost();
    evidence.renderRuns.push({ target: target.id, before: preRender, renderPlanInputs: evidence.inputs });
    if (!preRender.renderSafe) {
      writeJson(path.join(outDir, 'evidence.json'), evidence);
      throw Object.assign(new Error(`Render ${target.id} suspenso: recursos voltaram acima do limite seguro.`), {
        code: 'HOST_RESOURCE_GATE', preflight: preRender
      });
    }
    const outputPath = path.join(outDir, `production-${target.id}.mp4`);
    const renderScript = target.id === '9x16' ? { ...script, explanatorySocial: true, watermark: false } : script;
    const targetAcceptance = target.id === '9x16'
      ? sceneAcceptance(renderScript, renderScript.timings, durationMs)
      : { scenes: plannedScenes, results: evidence.acceptance };
    const renderer = new RemotionStoryVideoRenderer({
      width: target.width, height: target.height, fps: FPS, quality: 'high', captureProfile: 'auto'
    });
    const result = await renderer.render({ script: renderScript, audioPath, outputPath, images, validateOnly: false,
      jobId: `visual-standard-${target.id}-${Date.now()}` });
    const probe = JSON.parse(await execFileAsync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', outputPath]).then(value => value.stdout));
    const video = probe.streams.find(stream => stream.codec_type === 'video');
    const audio = probe.streams.find(stream => stream.codec_type === 'audio');
    if (!video || !audio || Number(video.width) !== target.width || Number(video.height) !== target.height) {
      throw new Error(`Saída ${target.id} falhou validação de vídeo/áudio/dimensões.`);
    }
    const fps = Number(String(video.avg_frame_rate).split('/')[0]) / Number(String(video.avg_frame_rate).split('/')[1] || 1);
    if (Math.abs(fps - FPS) > 0.01) throw new Error(`FPS inesperado em ${target.id}: ${video.avg_frame_rate}`);
    const frameDir = path.join(outDir, `frames-${target.id}`);
    fs.mkdirSync(frameDir, { recursive: true });
    const frameEvidence = [];
    for (const semantic of targetAcceptance.results) {
      const targetScene = targetAcceptance.scenes[semantic.sceneIndex];
      if (!targetScene?.components?.some(component => component.type === semantic.expectedComponent
        && (!semantic.expectedBeat || component.beat === semantic.expectedBeat)
        && (!semantic.componentTitle || component.title === semantic.componentTitle))) {
        throw new Error(`Cena semântica ${semantic.id} mudou antes da captura ${target.id}.`);
      }
      const startMs = targetAcceptance.scenes.slice(0, targetAcceptance.scenes.indexOf(targetScene))
        .reduce((sum, scene) => sum + scene.durationMs, 0);
      const sceneDuration = Number(targetScene.durationMs) || 1;
      const component = targetScene.components.find(item => item.type === semantic.expectedComponent
        && (!semantic.expectedBeat || item.beat === semantic.expectedBeat)
        && (!semantic.componentTitle || item.title === semantic.componentTitle));
      const latestElementReveal = Math.max(Number(component?.revealAtMs) || 0,
        ...(component?.items || []).map(item => Number(item.revealAfterMs) || 0));
      const localMs = semanticFrameOffsetMs(sceneDuration, latestElementReveal);
      const timestampSeconds = Math.max(0.1, (startMs + localMs) / 1000);
      const framePath = path.join(frameDir, `${semantic.id}.png`);
      await captureFrame(outputPath, framePath, timestampSeconds);
      frameEvidence.push({ class: semantic.id, timestampSeconds, path: path.relative(outDir, framePath), sha256: hashFile(framePath) });
    }
    const outputEvidence = {
      target: target.id,
      path: path.relative(outDir, outputPath),
      sha256: hashFile(outputPath),
      dimensions: `${video.width}x${video.height}`,
      fps,
      durationSeconds: Number(probe.format.duration),
      audioCodec: audio.codec_name,
      videoCodec: video.codec_name,
      frames: frameEvidence,
      rendererResult: typeof result === 'string' ? path.basename(result) : result
    };
    evidence.renderRuns.at(-1).output = outputEvidence;
    writeJson(path.join(outDir, 'evidence.json'), evidence);
  }
}

async function runE2E() {
  const options = parseOptions();
  const renderRequested = options.render;
  const outDir = path.resolve(options.outputDir || DEFAULT_DIR);
  const script = loadInputScript(options.scriptPath);
  const sourceEntries = script.mainContent.sections.map(item => item.source);
  const audioPath = path.join(outDir, 'narration-edge-tts.mp3');
  let tts;
  if (fs.existsSync(audioPath) && !options.forceTts) {
    const timingPath = path.join(outDir, 'narration-edge-tts.word-boundaries.json');
    const timingData = JSON.parse(fs.readFileSync(timingPath, 'utf8'));
    const probe = JSON.parse(await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', audioPath]).then(result => result.stdout));
    tts = { audioPath, timingPath, textPath: path.join(outDir, 'narration.txt'), timingData,
      durationMs: Math.round(Number(probe.format.duration) * 1000) };
  } else {
    tts = await synthesizeTts(outDir, script);
  }
  script.timings = buildTimings(script, tts.timingData.events, tts.durationMs);
  const visualAssets = await resolveSceneImageAssets(outDir, script, options.generateImages);
  const acceptance = sceneAcceptance(script, script.timings, tts.durationMs);
  const inputs = [
    'scripts/visual-standard-production-e2e.js',
    'scripts/generate-animated-video.js',
    'utils/hyperframes-video-renderer.js',
    'utils/remotion-story-video-renderer.js',
    'utils/render-timing.js',
    'utils/scene-plan-builder.js',
    'utils/narrative-visual-coverage.js',
    'utils/audio-mix.js',
    'data/assets/sfx/manifest.json',
    'data/assets/sfx/section-whoosh.wav',
    'data/assets/sfx/detail-tick.wav',
    'data/assets/sfx/visual-pop.wav',
    'assets/scenes/kit.js',
    'assets/scenes/kit.css',
    'config/themes.json',
    'utils/editorial-formats.js',
    'experiments/remotion-motion-review/src/NarrativeComposite.tsx',
    'experiments/remotion-motion-review/src/ApprovedRobotPresenter.tsx'
  ];
  const evidence = {
    schemaVersion: 1,
    state: 'prepared; production renders pending host resource gate',
    preparedAt: new Date().toISOString(),
    renderer: 'utils/remotion-story-video-renderer.js :: RemotionStoryVideoRenderer.render (HyperFrames scene plate + approved Remotion presenter)',
    scriptSeed: script.seed,
    tts: {
      provider: 'Microsoft Edge TTS (real network synthesis)', voice: VOICE, rate: RATE, pitch: PITCH,
      alignment: tts.timingData.alignment, durationMs: tts.durationMs,
      audioPath: path.relative(outDir, tts.audioPath), audioSha256: hashFile(tts.audioPath),
      timingPath: path.relative(outDir, tts.timingPath), timingSha256: hashFile(tts.timingPath),
      textPath: path.relative(outDir, tts.textPath), textSha256: hashFile(tts.textPath),
      boundaryEventCount: tts.timingData.events.length
    },
    editorialFormat: script.editorialFormat || (script.editorialFormatId
      ? require(path.join(ROOT, 'utils/editorial-formats')).resolveEditorialFormat({ formatId: script.editorialFormatId })
      : null),
    sourceEvidence: script.sourceEvidence || null,
    inputs: Object.fromEntries(inputs.map(file => [file, hashFile(path.join(ROOT, file))])),
    sources: sourceEntries,
    formats: [
      { id: '16x9', width: 1920, height: 1080, fps: FPS },
      { id: '9x16', width: 1080, height: 1920, fps: FPS }
    ],
    acceptance: acceptance.results.map(({ id, category, expectedComponent, expectedBeat, groupTitle, componentTitle, present, component, sceneGroupTitle, sceneIndex }) => ({
      id, category, expectedComponent, expectedBeat, groupTitle, componentTitle, present, sceneGroupTitle, sceneIndex, component
    })),
    narrativeCoverage: acceptance.narrativeCoverage,
    visualAssets: visualAssets.manifest ? {
      provider: visualAssets.manifest.provider,
      assets: visualAssets.manifest.assets.map(({ groupIndex, sha256 }) => ({ groupIndex, sha256 }))
    } : null,
    acceptanceCriteria: [
      'Cada classe gera seu componente semântico no ScenePlanBuilder de produção.',
      'Cada frase original narrada tem imagem concreta ou componente explicativo sincronizado; páginas de legenda da mesma frase compartilham essa cobertura.',
      'As saídas finais têm áudio e vídeo H.264/AAC, 24 fps e dimensões 1920x1080 / 1080x1920.',
      'Um PNG por classe e proporção é extraído depois da entrada do elemento visual e recebe SHA-256.',
      'A inspeção visual dos PNGs é manual e fica pendente até existirem quadros renderizados.'
    ],
    visualInspectionStatus: 'pending-render; pixels não avaliados ainda',
    renderRuns: [],
    hostPreflight: probeHost()
  };
  if (renderRequested) {
    try {
      const previousEvidence = JSON.parse(fs.readFileSync(path.join(outDir, 'evidence.json'), 'utf8'));
      const previousScript = JSON.parse(fs.readFileSync(path.join(outDir, 'script.json'), 'utf8'));
      if (sameRenderPlan(previousEvidence, previousScript, evidence, script)) {
        evidence.renderRuns = Array.isArray(previousEvidence.renderRuns) ? previousEvidence.renderRuns : [];
      } else if (options.renderTargets.length && Array.isArray(previousEvidence.renderRuns)) {
        const dimensions = { '16x9': [1920, 1080], '9x16': [1080, 1920] };
        evidence.renderRuns = previousEvidence.renderRuns.filter(run => {
          const size = dimensions[run.target];
          return size && !options.renderTargets.includes(run.target)
            && canReuseRenderOutput(outDir, { id: run.target, width: size[0], height: size[1] }, run, evidence.acceptance);
        }).map(run => ({ ...run, renderPlanStatus: 'preserved_prior_plan', renderPlanInputs: previousEvidence.inputs || null }));
      }
    } catch (_error) { /* a new or incomplete evidence directory starts fresh */ }
  }
  writeJson(path.join(outDir, 'script.json'), script);
  writeJson(path.join(outDir, 'evidence.json'), evidence);

  if (renderRequested) {
    try {
      await renderOutputs(outDir, script, tts.audioPath, tts.durationMs, acceptance.scenes, evidence,
        visualAssets.images, options.renderTargets);
      evidence.state = 'rendered; inspect saved PNG frames before visual acceptance';
    } catch (error) {
      evidence.state = error.code === 'HOST_RESOURCE_GATE' ? 'render blocked by host resource gate' : 'render failed';
      evidence.blocker = { code: error.code || 'RENDER_ERROR', message: error.message, preflight: error.preflight };
      writeJson(path.join(outDir, 'evidence.json'), evidence);
      writeChecksums(outDir, tts.audioPath, tts.timingPath);
      throw error;
    }
    writeJson(path.join(outDir, 'evidence.json'), evidence);
  }
  writeChecksums(outDir, tts.audioPath, tts.timingPath);
  console.log(JSON.stringify({ outDir, state: evidence.state, renderRequested, durationMs: tts.durationMs,
    ttsVoice: VOICE, boundaryEventCount: tts.timingData.events.length,
    acceptance: evidence.acceptance.map(({ id, present }) => ({ id, present })),
    narrativeCoverage: evidence.narrativeCoverage,
    hostPreflight: evidence.hostPreflight }, null, 2));
}

async function main() {
  return runE2E();
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[visual-standard-production-e2e] ${error.code || 'ERROR'}: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { makeScript, parseOptions, loadInputScript, buildTimings, sceneAcceptance, probeHost, canonicalGroups,
  assertCompleteSceneImageAssets, buildSceneImageReplayPlan, makeImageGenerationScript,
  canReuseRenderOutput, sameRenderPlan, loadSceneImageAssets, generateSceneImageAssets, resolveSceneImageAssets,
  semanticFrameOffsetMs };
