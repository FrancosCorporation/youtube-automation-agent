'use strict';
// An illustrative regression fixture using the production author, scene
// normalizer, audio envelope and NarrativeEpisode composition. Never queued.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { buildChapterInputs, buildDeterministicScene, normalizeScene, authorNarrativeScenes, AUTHOR_REVISION } = require('../utils/narrative-scene-author');
const { sha256, stableJson, narrativePlanInputSha256 } = require('../utils/narrative-episode-plan');
const { extractSpeechEnvelope } = require('../utils/speech-envelope');
const { assertNarrativeEpisodeProps } = require('../utils/narrative-episode-props');
const { withProcessFileLock } = require('../utils/process-file-lock');
const root = path.resolve(__dirname, '..');
const project = path.join(root, 'experiments/remotion-motion-review');
const curated = process.argv.includes('--curated');
const sorting = process.argv.includes('--sorting');
const collisionFix = process.argv.includes('--collision-fix');
const adaptive = process.argv.includes('--adaptive') || curated;
const fixtureId = collisionFix ? 'fruit-sorting-collision-fix-20261101' : sorting ? 'fruit-sorting-motion-20261101' : curated ? '3d-scene-study-20261101' : adaptive ? 'adaptive-scenes-20261101' : 'directed-scenes-20261101';
const output = path.join(root, 'docs/evidencias', fixtureId);
const sourceDir = collisionFix ? path.join(root, 'docs/evidencias/fruit-sorting-motion-20261101') : curated ? path.join(root, 'docs/evidencias/adaptive-scenes-20261101') : output;
const runtime = path.join(project, 'public/_runtime', fixtureId);
const normalize = value => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

async function prepare() {
  await fs.mkdir(runtime, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  const text = (await fs.readFile(path.join(sourceDir, 'narration.txt'), 'utf8')).trim();
  const { events } = JSON.parse(await fs.readFile(path.join(sourceDir, 'timings.json'), 'utf8'));
  if (normalize(events.map(e => e.text).join('')) !== normalize(text)) throw new Error('TTS text alignment mismatch');
  const audio = path.join(runtime, 'episode-audio.m4a');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(sourceDir, 'narration.mp3'), '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', audio]);
  const durationMs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio], { encoding: 'utf8' }).trim()) * 1000;
  const envelope = await extractSpeechEnvelope(audio);
  const fps = 24, durationInFrames = Math.round(durationMs / 1000 * fps);
  let offset = 0, eventIndex = 0;
  const titles = adaptive ? ['A onda se aproxima da costa.', 'A água chega aos prédios.', 'Três modelos dentro do chip.', 'O percurso do sinal.'] : ['Uma pessoa. Uma mensagem.', 'A mensagem faz o caminho.', 'A mesma ação, outro cenário.', 'A fonte entra na história.'];
  const sentences = text.match(/[^.!?]+[.!?]+/g).map((text, index) => {
    const length = normalize(text).length;
    const words = [];
    const end = offset + length;
    let cursor = offset;
    while (eventIndex < events.length && cursor < end) {
      const word = events[eventIndex++]; cursor += normalize(word.text).length;
      words.push({ text: word.text, startFrame: Math.floor(word.startMs * fps / 1000), endFrame: Math.ceil(word.endMs * fps / 1000) });
    }
    if (cursor !== end) throw new Error('sentence alignment mismatch');
    offset = end;
    return { id: `sentence-${index + 1}`, groupId: sorting ? 'chapter-sorting' : `chapter-${index + 1}`, text: text.trim(), startFrame: index ? words[0].startFrame : 0, endFrame: words.at(-1).endFrame, wordTimings: words };
  });
  sentences.forEach((sentence, index) => { sentence.endFrame = sentences[index + 1]?.startFrame || durationInFrames; });
  let episode = { title: 'Encenação da narração — teste', themeId: 'demonstracao', fps, durationMs, durationInFrames,
    source: { eligible: true, sourceTitle: 'Como uma mensagem chega ao destino', sourceName: 'Pulso • Demonstração', sourceUrl: 'https://example.com/demonstracao' },
    assets: [], sentences, chapters: sentences.map((sentence, index) => ({ id: `chapter-${index + 1}`, title: titles[index], kind: index ? 'explanation' : 'hook', sentenceIds: [sentence.id], startFrame: sentence.startFrame, durationInFrames: sentence.endFrame - sentence.startFrame })) };
  if (sorting) {
    episode.title = 'Uma linha de triagem em movimento';
    episode.source = { eligible: false, sourceTitle: 'Demonstração ilustrativa de triagem', sourceUrl: '' };
    episode.chapters = [{ id: 'chapter-sorting', title: 'Cada fruta segue seu caminho.', kind: 'explanation', sentenceIds: sentences.map(s => s.id), startFrame: 0, durationInFrames }];
  }
  const inputs = buildChapterInputs(episode);
  episode.scenes = inputs.map(input => {
    const raw = buildDeterministicScene(input, episode, text);
    raw.presenter.side = 'right';
    return normalizeScene(raw, input, episode, text);
  });
  if (sorting) {
    const { normalizeIllustrations } = require('../utils/narrative-illustration-plan');
    episode.scenes[0].illustrations = normalizeIllustrations(require('./fixtures/fruit-sorting-motion.cjs')(sentences, fps), sentences, fps);
  } else if (curated) {
    const { normalizeIllustrations } = require('../utils/narrative-illustration-plan');
    const illustrations = normalizeIllustrations(require('./fixtures/illustrative-3d-scenes.cjs')(sentences), sentences, fps);
    episode.scenes.forEach((scene, index) => { scene.illustrations = [illustrations[index]]; });
  } else if (adaptive) {
    require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
    process.env.PULSO_DETERMINISTIC_SCENE_FALLBACK = '0';
    process.env.NARRATIVE_ILLUSTRATION_MODEL ||= 'deepseek-ai/deepseek-v4.1-flash';
    episode.schemaVersion = 'pulso.narrative-episode/v2'; episode.jobId = fixtureId; episode.seed = 1101;
    episode.source = { eligible: false, sourceTitle: 'Exemplos hipotéticos de encenação — não é notícia', sourceUrl: '', contextHash: sha256(Buffer.from(text)), reviewStatus: 'unavailable' };
    episode.scriptSha256 = sha256(Buffer.from(text)); episode.narrationSha256 = sha256(await fs.readFile(audio));
    episode.speechEnvelope = envelope; episode.speechEnvelopeSha256 = sha256(Buffer.from(stableJson(envelope)));
    episode.claims = sentences.map(sentence => ({ id: `claim-${sentence.id}`, sentenceId: sentence.id, text: sentence.text, sourceContextHash: episode.source.contextHash }));
    episode.inputSha256 = narrativePlanInputSha256(episode);
    const { requestNvidiaChatCompletion } = require('../utils/nvidia-chat-completions');
    let requestIndex = 0;
    episode = await authorNarrativeScenes({ plan: episode, sourceContext: text, cacheDir: path.join(output, 'author-cache'),
      request: async options => {
        const response = await requestNvidiaChatCompletion(options);
        if (response.ok) {
          const body = await response.clone().json();
          await fs.writeFile(path.join(output, `author-response-${++requestIndex}.json`), JSON.stringify({ model: options.body.model, choices: body.choices }, null, 2));
        }
        return response;
      },
      visualCritique: [{ issue: 'Teste de autoria adaptativa em dois assuntos distintos.', recommendedFix: 'Desenhe mar/costa/prédios em 2D nas frases 1 e 2; use meshes 3D para os três modelos dentro do chip e seu percurso nas frases 3 e 4. Composição própria, elegante e detalhada, sem pictogramas isolados.' }] });
    if (episode.scenes.some(scene => !scene.illustrations?.length)) throw new Error('Author did not generate the adaptive scene; no fixed template substitution allowed in this test');
  }
  const sampleFrames = sentences.map(sentence => Math.min(sentence.startFrame + Math.round((sentence.endFrame - sentence.startFrame) * .6), durationInFrames - 1));
  for (const aspect of ['landscape', 'portrait']) {
    const props = { episode, audioSrc: `_runtime/${fixtureId}/episode-audio.m4a`, robotSrc: 'pulso-story/approved-robot-rigged.glb',
      aspect, width: aspect === 'portrait' ? 1080 : 1920, height: aspect === 'portrait' ? 1920 : 1080, fps, durationInFrames,
      accents: ['#95d7bc', '#ecb47e'], lipSyncEnvelope: envelope.levels, lipSyncStepMs: envelope.stepMs, gestureCues: {} };
    assertNarrativeEpisodeProps(props);
    await fs.writeFile(path.join(output, `${aspect}.json`), JSON.stringify(props));
  }
  await fs.writeFile(path.join(output, 'fixture.json'), JSON.stringify({ status: 'illustrative-test-not-for-publication', durationMs, durationInFrames, sampleFrames,
    directions: episode.scenes.flatMap(scene => scene.direction), illustrations: episode.scenes.flatMap(scene => scene.illustrations || []), author: curated || sorting ? 'agent-directed-reference-fixture' : AUTHOR_REVISION, renderer: 'NarrativeEpisode-v2.16' }, null, 2));
  return sampleFrames;
}

async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(path.join(project, 'node_modules/.bin/remotion'), args, { cwd: project, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    let progressAt = 0;
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      tail = (tail + chunk.toString()).slice(-7000);
      if (Date.now() - progressAt > 15000) {
        const progress = [...tail.matchAll(/(?:Rendered|Encoded)\s+\d+\/\d+/g)].at(-1)?.[0];
        if (progress) { console.log(progress); progressAt = Date.now(); }
      }
    });
    child.once('error', reject);
    child.once('exit', code => code ? reject(new Error(tail)) : resolve());
  });
}
async function main() {
  const frames = await prepare();
  console.log('Prepared', JSON.stringify(frames));
  if (process.argv.includes('--prepare-only')) return;
  await withProcessFileLock(async () => {
    for (const aspect of ['landscape', 'portrait']) {
      const gate = require('../utils/render-timing').probeRenderHardwareGate();
      if (!gate.renderSafe) throw new Error(`Render adiado pelo gate: ${gate.reasons.join(', ')}`);
      const common = ['src/index.ts', 'NarrativeEpisode', '--props', path.join(output, `${aspect}.json`), '--gl=angle', '--concurrency=1'];
      if (process.argv.includes('--stills')) {
        for (const [index, frame] of frames.entries()) {
          await run(['still', ...common, path.join(output, `${aspect}-${index + 1}.png`), `--frame=${frame}`, '--scale=0.6']);
          console.log(`Reviewed frame ready ${aspect} ${frame}`);
        }
      } else {
        await run(['render', ...common, path.join(output, `teste-encenacao-${aspect}.mp4`), '--scale=1', '--codec=h264', '--crf=19']);
        console.log(`Rendered ${aspect}`);
      }
    }
  }, { lockPath: path.join(root, 'data/state/narrative-render.lock'), owner: 'directed-scenes-visual-test', timeoutMs: 60 * 60 * 1000 });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
