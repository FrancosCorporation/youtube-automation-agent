'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'docs/evidencias/visual-standard-render-benchmark-2026-10-23');
const FPS = 24;
const WIDTH = 1920;
const HEIGHT = 1080;
const VOICE = process.env.TTS_VOICE || 'pt-BR-FranciscaNeural';
const RATE = process.env.TTS_RATE || '-3%';
const PITCH = process.env.TTS_PITCH || '-1Hz';

const samples = [
  {
    id: 'presenter-gesture',
    title: 'O caminho da mensagem',
    text: 'O apresentador aponta o caminho.',
    kind: 'hook',
    visual: { type: 'node-graph', nodes: ['Origem', 'Caminho', 'Destino'], cue: 'aponta o caminho' }
  },
  {
    id: 'explanatory-graphic',
    text: 'O navegador envia a requisição, cruza a rede e chega ao servidor.',
    kind: 'section',
    title: 'A requisição percorre a rede',
    visual: { type: 'node-graph', nodes: ['Navegador', 'Rede', 'Servidor'], cue: 'cruza a rede' }
  },
  {
    id: 'person-sender',
    text: 'Uma pessoa escreve o pedido no computador antes de enviá-lo.',
    kind: 'section',
    title: 'A pessoa inicia o pedido',
    imagePath: path.join(ROOT, 'experiments/remotion-motion-review/public/pulso-story/human-sender-v1.png')
  }
];

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function buildScript(sample, durationMs, events) {
  const words = sample.text.split(/\s+/).filter(Boolean);
  const wordTimes = words.map((_word, index) => events.length === words.length
    ? Number(events[index].startMs)
    : Math.round((durationMs * index) / words.length));
  const wordEndTimes = words.map((_word, index) => events.length === words.length
    ? Number(events[index].endMs)
    : Math.round((durationMs * (index + 1)) / words.length));
  const sentence = { text: sample.text, words, startMs: 0, durationMs, wordTimes, wordEndTimes };
  const group = { audioOffsetMs: 0, durationMs, sentences: [sentence] };
  const script = {
    title: sample.title || sample.id,
    channel: 'Pulso IA',
    theme: 'ia',
    seed: 20261023 + samples.indexOf(sample),
    steadyNarrative: true,
    watermark: false,
    maxCaptionWords: 8,
    timings: [group]
  };
  if (sample.kind === 'hook') {
    script.hook = { text: sample.text, visual: sample.visual };
    script.hookEmotion = 'confidence';
  } else {
    script.mainContent = { sections: [{ title: sample.title, content: sample.text, visual: sample.visual }] };
  }
  return script;
}

async function synthesize(outDir, sample) {
  const sampleDir = path.join(outDir, sample.id);
  fs.mkdirSync(sampleDir, { recursive: true });
  const textPath = path.join(sampleDir, 'narration.txt');
  const audioPath = path.join(sampleDir, 'narration.mp3');
  const timingPath = path.join(sampleDir, 'word-boundaries.json');
  fs.writeFileSync(textPath, `${sample.text}\n`);
  await execFileAsync('python3', [path.join(ROOT, 'scripts/synthesize-edge-tts-word-boundaries.py'),
    '--text-file', textPath, '--audio', audioPath, '--timings', timingPath,
    '--voice', VOICE, '--rate', RATE, '--pitch', PITCH], { cwd: ROOT, maxBuffer: 1024 * 1024 });
  const timing = JSON.parse(fs.readFileSync(timingPath, 'utf8'));
  if (timing.alignment !== 'edge-tts-word-boundary-events' || !timing.events?.length) {
    throw new Error(`${sample.id}: Edge TTS não produziu limites reais por palavra.`);
  }
  const probe = JSON.parse((await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', audioPath])).stdout);
  const durationMs = Math.round(Number(probe.format.duration) * 1000);
  if (!Number.isFinite(durationMs) || durationMs < 1500 || durationMs > 12000) {
    throw new Error(`${sample.id}: áudio benchmark fora da janela de 1,5–12 s (${durationMs} ms).`);
  }
  return { sampleDir, textPath, audioPath, timingPath, timing, durationMs };
}

async function probeVideo(filePath) {
  const probe = JSON.parse((await execFileAsync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath])).stdout);
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  const audio = probe.streams.find(stream => stream.codec_type === 'audio');
  if (!video || !audio || Number(video.width) !== WIDTH || Number(video.height) !== HEIGHT
    || video.codec_name !== 'h264' || audio.codec_name !== 'aac') {
    throw new Error(`Saída de benchmark inválida: ${filePath}`);
  }
  return {
    dimensions: `${video.width}x${video.height}`,
    fps: video.r_frame_rate,
    durationSeconds: Number(probe.format.duration),
    videoCodec: video.codec_name,
    audioCodec: audio.codec_name,
    sizeBytes: Number(probe.format.size)
  };
}

async function run() {
  const outArg = process.argv.find(value => value.startsWith('--output-dir='));
  const outDir = path.resolve(outArg ? outArg.slice('--output-dir='.length) : DEFAULT_OUT);
  fs.mkdirSync(outDir, { recursive: true });
  const occupied = samples.some(sample => fs.existsSync(path.join(outDir, sample.id, 'benchmark.mp4')));
  if (occupied) throw new Error(`Saídas existentes em ${outDir}; escolha outro --output-dir para preservar evidências.`);
  const { probeRenderHardwareGate } = require(path.join(ROOT, 'utils/render-timing'));
  const firstGate = probeRenderHardwareGate();
  if (!firstGate.renderSafe) throw Object.assign(new Error(`Gate de render bloqueado: ${(firstGate.reasons || []).join(', ')}`), { code: 'HOST_RESOURCE_GATE', gate: firstGate });
  const { RemotionStoryVideoRenderer } = require(path.join(ROOT, 'utils/remotion-story-video-renderer'));
  const { assertNarrativeVisualCoverage } = require(path.join(ROOT, 'utils/narrative-visual-coverage'));
  const results = [];

  for (const sample of samples) {
    const audio = await synthesize(outDir, sample);
    const script = buildScript(sample, audio.durationMs, audio.timing.events);
    const image = sample.imagePath
      ? `data:image/png;base64,${fs.readFileSync(sample.imagePath).toString('base64')}`
      : null;
    const images = image ? { 0: { sources: [image] } } : {};
    const { ScenePlanBuilder } = require(path.join(ROOT, 'utils/scene-plan-builder'));
    const scenes = new ScenePlanBuilder().buildScenes(script, audio.durationMs, images, null, {
      coalesce: false, includeNarrationSentenceIndex: true
    });
    const coverage = assertNarrativeVisualCoverage(scenes);
    if (!scenes.length || coverage.missing.length) throw new Error(`${sample.id}: cobertura narrativa incompleta.`);
    const scriptPath = path.join(audio.sampleDir, 'script.json');
    writeJson(scriptPath, script);
    const outputPath = path.join(audio.sampleDir, 'benchmark.mp4');
    const renderer = new RemotionStoryVideoRenderer({ width: WIDTH, height: HEIGHT, fps: FPS, quality: 'high', captureProfile: 'auto' });
    const startedAt = new Date().toISOString();
    const start = process.hrtime.bigint();
    await renderer.render({ script, audioPath: audio.audioPath, outputPath, images, jobId: `visual-benchmark-${sample.id}-${Date.now()}` });
    const wallTimeMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    const finishedAt = new Date().toISOString();
    const media = await probeVideo(outputPath);
    const framePath = path.join(audio.sampleDir, 'review-frame.png');
    const reviewFrameSeconds = Number((media.durationSeconds * 0.85).toFixed(3));
    await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', reviewFrameSeconds.toFixed(3),
      '-i', outputPath, '-frames:v', '1', '-update', '1', framePath]);
    results.push({
      id: sample.id,
      narrative: sample.text,
      sceneKind: sample.kind,
      component: sample.visual?.type || 'image-hero',
      imageSha256: sample.imagePath ? hashFile(sample.imagePath) : null,
      audioDurationSeconds: audio.durationMs / 1000,
      startedAt,
      finishedAt,
      wallTimeMs,
      renderSecondsPerVideoSecond: Number(((wallTimeMs / 1000) / media.durationSeconds).toFixed(2)),
      media,
      output: path.relative(outDir, outputPath),
      sha256: hashFile(outputPath),
      reviewFrame: path.relative(outDir, framePath),
      reviewFrameSeconds,
      reviewFrameSha256: hashFile(framePath),
      timingEvents: audio.timing.events.length,
      narrativeCoverage: { renderedSceneCount: scenes.length, missing: coverage.missing }
    });
    writeJson(path.join(audio.sampleDir, 'script.json'), script);
    console.log(`[visual-benchmark] ${sample.id}: ${media.durationSeconds.toFixed(2)} s; render ${(wallTimeMs / 1000).toFixed(1)} s; ${results.at(-1).renderSecondsPerVideoSecond}× tempo real.`);
  }

  const evidence = {
    schemaVersion: 1,
    status: 'completed',
    visualReviewStatus: 'pending_manual_review',
    createdAt: new Date().toISOString(),
    renderer: 'RemotionStoryVideoRenderer (HyperFrames scene plate + approved 3D presenter)',
    configuration: { width: WIDTH, height: HEIGHT, fps: FPS, quality: 'high', captureProfile: 'auto', voice: VOICE, rate: RATE, pitch: PITCH },
    firstHostGate: firstGate,
    samples: results
  };
  const evidencePath = path.join(outDir, 'benchmark.json');
  writeJson(evidencePath, evidence);
  const files = ['benchmark.json', '../../../scripts/benchmark-visual-standard-scenes.js',
    '../../../experiments/remotion-motion-review/public/pulso-story/human-sender-v1.png'];
  if (fs.existsSync(path.join(outDir, 'visual-review.json'))) files.push('visual-review.json');
  for (const sample of samples) {
    const base = path.join(sample.id);
    files.push(`${base}/narration.txt`, `${base}/narration.mp3`, `${base}/word-boundaries.json`, `${base}/script.json`,
      `${base}/benchmark.mp4`, `${base}/review-frame.png`);
  }
  const checksums = files.map(file => `${hashFile(path.join(outDir, file))}  ${file}`).join('\n');
  fs.writeFileSync(path.join(outDir, 'SHA256SUMS'), `${checksums}\n`);
  console.log(JSON.stringify({ outDir, status: evidence.status, samples: results.map(({ id, wallTimeMs, renderSecondsPerVideoSecond, sha256 }) => ({ id, wallTimeMs, renderSecondsPerVideoSecond, sha256 })) }, null, 2));
}

run().catch(error => {
  console.error(JSON.stringify({ error: error.message, code: error.code, gate: error.gate }));
  process.exitCode = 1;
});
