#!/usr/bin/env node
/** Offline, transcript-free audit of Rhubarb mouth-cue coverage in an audio excerpt. */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const dotenv = require('dotenv');
const { getMediaDuration, runFFmpeg } = require('../utils/ffmpeg');
const { extractSpeechVisemes } = require('../utils/speech-visemes');
const { resolveExecutable } = require('../utils/resolve-executable');
const { safeErrorTag } = require('../utils/safe-error-tag');

const SHAPES = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'X']);

function summarizeTimeline(timeline) {
  const shapeCounts = Object.fromEntries(SHAPES.map(shape => [
    shape,
    timeline.cues.reduce((count, cue) => count + Number(cue.value === shape), 0)
  ]));
  const transitions = timeline.cues.slice(1).reduce((count, cue, index) =>
    count + Number(cue.value !== timeline.cues[index].value), 0);
  return {
    durationSeconds: Number(timeline.duration.toFixed(3)),
    cueCount: timeline.cues.length,
    transitions,
    shapeCounts,
    coveredShapes: SHAPES.filter(shape => shapeCounts[shape] > 0)
  };
}

function parseArgs(args) {
  let source = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith('--')) {
      if (!['--start', '--duration'].includes(args[index])) throw new Error('Opção desconhecida');
      index += 1;
    } else if (!source) {
      source = args[index];
    } else {
      throw new Error('Forneça somente um arquivo de áudio');
    }
  }
  const value = (name, fallback) => {
    const index = args.indexOf(name);
    return index < 0 ? fallback : Number(args[index + 1]);
  };
  const startSeconds = value('--start', 0);
  const durationSeconds = value('--duration', 30);
  if (!source) throw new Error('Uso: node scripts/audit-speech-visemes.js <audio> [--start 0] [--duration 30]');
  if (!Number.isFinite(startSeconds) || startSeconds < 0) throw new Error('Início inválido');
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 300) throw new Error('Duração precisa estar entre 1 e 300 segundos');
  return { source: path.resolve(source), startSeconds, durationSeconds };
}

async function hashFile(filePath) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest('hex');
}

async function auditAudioExcerpt({ source, startSeconds, durationSeconds, rhubarbPath } = {}) {
  const input = path.resolve(source);
  const stat = await fs.stat(input);
  if (!stat.isFile() || stat.size <= 0) throw new Error('Arquivo de áudio inválido');
  const rhubarb = resolveExecutable(rhubarbPath || process.env.PULSO_RHUBARB_PATH || 'rhubarb');
  if (!rhubarb) throw new Error('Rhubarb não encontrado');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-viseme-audit-'));
  const excerpt = path.join(temp, 'excerpt.wav');
  try {
    await runFFmpeg([
      '-y', '-ss', String(startSeconds), '-i', input,
      '-t', String(durationSeconds), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000',
      '-c:a', 'pcm_s16le', excerpt
    ]);
    const actualDuration = await getMediaDuration(excerpt);
    if (actualDuration < 1) throw new Error('Recorte de áudio vazio');
    const timeline = await extractSpeechVisemes(excerpt, { binary: rhubarb, threads: 1 });
    return {
      sourceSha256: await hashFile(input),
      startOffsetSeconds: startSeconds,
      ...summarizeTimeline(timeline)
    };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function main() {
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const result = await auditAudioExcerpt(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Auditoria fonética falhou: ${safeErrorTag(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { SHAPES, summarizeTimeline, parseArgs, auditAudioExcerpt };
