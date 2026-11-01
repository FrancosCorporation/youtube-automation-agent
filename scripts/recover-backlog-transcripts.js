'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_INPUT = 'docs/evidencias/backlog-source-resolution-2026-10-21.json';
const DEFAULT_OUTPUT = 'docs/evidencias/backlog-transcript-lineage-2026-10-21.json';
const SAMPLE_RATE = 12000;
const WINDOW_SECONDS = 15;
const MAX_PCM_BYTES = 64 * 1024 * 1024;
const WORD = /[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function timestampToMilliseconds(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(String(value || '').trim());
  if (!match) return null;
  const [, hours, minutes, seconds, milliseconds] = match;
  return (((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000) + Number(milliseconds);
}

function parseSrtText(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const cues = [];
  for (let index = 0; index < lines.length; index += 1) {
    const timing = /^\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/.exec(lines[index]);
    if (!timing) continue;
    const startMs = timestampToMilliseconds(timing[1]);
    const endMs = timestampToMilliseconds(timing[2]);
    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs < startMs) continue;
    const caption = [];
    for (let cursor = index + 1; cursor < lines.length && lines[cursor].trim(); cursor += 1) {
      if (/^\s*\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(lines[cursor])) break;
      caption.push(lines[cursor].trim());
    }
    const value = caption.join(' ').replace(/\s+/g, ' ').trim();
    if (value) cues.push({ startMs, endMs, text: value });
  }
  return cues;
}

function buildTranscript(parts) {
  const orderedParts = Array.isArray(parts) ? parts : [];
  const transcript = orderedParts.flatMap(part => part.cues || []).map(cue => cue.text)
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const segmentDurationMs = orderedParts.reduce((sum, part) => sum + Number(part.durationMs || 0), 0);
  return {
    transcript,
    transcriptSha256: sha256(transcript),
    wordCount: transcript.match(WORD)?.length || 0,
    parts: orderedParts.map(part => ({
      path: part.path,
      sha256: part.sha256,
      captionCount: (part.cues || []).length,
      durationMs: Number(part.durationMs || 0)
    })),
    segmentDurationMs
  };
}

function readInt16(buffer, sampleIndex) {
  return buffer.readInt16LE(sampleIndex * 2);
}

function pcmCorrelation(leftBuffer, rightBuffer, { sampleRate = SAMPLE_RATE, windowSeconds = WINDOW_SECONDS } = {}) {
  if (!Buffer.isBuffer(leftBuffer) || !Buffer.isBuffer(rightBuffer)) {
    throw new TypeError('PCM precisa ser recebido como Buffer');
  }
  if (leftBuffer.length % 2 || rightBuffer.length % 2) throw new Error('PCM s16le truncado');
  const leftCount = leftBuffer.length / 2;
  const rightCount = rightBuffer.length / 2;
  const count = Math.min(leftCount, rightCount);
  if (!count) throw new Error('PCM sem amostras de áudio');

  const correlateRange = (start, end) => {
    const length = end - start;
    let sumLeft = 0;
    let sumRight = 0;
    let sumLeftSquared = 0;
    let sumRightSquared = 0;
    let sumProduct = 0;
    for (let index = start; index < end; index += 1) {
      const left = readInt16(leftBuffer, index);
      const right = readInt16(rightBuffer, index);
      sumLeft += left;
      sumRight += right;
      sumLeftSquared += left * left;
      sumRightSquared += right * right;
      sumProduct += left * right;
    }
    const covariance = sumProduct - (sumLeft * sumRight / length);
    const leftVariance = sumLeftSquared - (sumLeft * sumLeft / length);
    const rightVariance = sumRightSquared - (sumRight * sumRight / length);
    const denominator = Math.sqrt(leftVariance * rightVariance);
    return denominator > 0 ? covariance / denominator : 0;
  };

  const fullCorrelation = correlateRange(0, count);
  const windowSamples = Math.max(1, Math.trunc(sampleRate * windowSeconds));
  const windows = [];
  for (let start = 0; start < count; start += windowSamples) {
    const end = Math.min(count, start + windowSamples);
    if (end - start < Math.min(sampleRate, windowSamples)) continue;
    windows.push(correlateRange(start, end));
  }
  return {
    sampleRate,
    videoSamples: leftCount,
    narrationSamples: rightCount,
    comparedSamples: count,
    durationDeltaSeconds: Math.abs(leftCount - rightCount) / sampleRate,
    fullCorrelation,
    windowSeconds,
    windowCount: windows.length,
    minWindowCorrelation: windows.length ? Math.min(...windows) : fullCorrelation,
    maxWindowCorrelation: windows.length ? Math.max(...windows) : fullCorrelation
  };
}

function audioLineageConfirmed(metrics, transcript, {
  maxDurationDeltaSeconds = 0.75,
  minFullCorrelation = 0.95,
  minWindowCorrelation = 0.9,
  minTranscriptCoverage = 0.9,
  minTranscriptWords = 150
} = {}) {
  if (!metrics || !transcript) return false;
  const narrationDurationMs = metrics.narrationSamples / metrics.sampleRate * 1000;
  const transcriptCoverage = narrationDurationMs > 0 ? transcript.segmentDurationMs / narrationDurationMs : 0;
  return metrics.durationDeltaSeconds <= maxDurationDeltaSeconds
    && metrics.fullCorrelation >= minFullCorrelation
    && metrics.minWindowCorrelation >= minWindowCorrelation
    && transcript.wordCount >= minTranscriptWords
    && transcriptCoverage >= minTranscriptCoverage;
}

function resolveReportPath(root, candidate) {
  if (path.isAbsolute(candidate)) return path.resolve(candidate);
  const parts = candidate.split(/[\\/]+/);
  if (parts[0] === path.basename(path.resolve(root))) parts.shift();
  return path.resolve(root, ...parts);
}

function runFfmpeg(ffmpegPath, filePath, { sampleRate = SAMPLE_RATE, maxBytes = MAX_PCM_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-v', 'error', '-i', filePath, '-map', '0:a:0', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', 'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    const errors = [];
    let bytes = 0;
    let stderrBytes = 0;
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        child.kill('SIGTERM');
        reject(new Error(`PCM excedeu limite de ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', chunk => {
      if (stderrBytes >= 4096) return;
      const kept = chunk.subarray(0, 4096 - stderrBytes);
      errors.push(kept);
      stderrBytes += kept.length;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(Buffer.concat(chunks, bytes));
      else reject(new Error(`ffmpeg terminou com código ${code}: ${Buffer.concat(errors).toString('utf8').trim().slice(-300)}`));
    });
  });
}

async function readSubtitleParts(directory) {
  const dir = path.resolve(directory);
  const listPath = path.join(dir, 'list.txt');
  const ordered = [];
  const listText = await fsp.readFile(listPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  for (const line of listText.split(/\r?\n/)) {
    const match = /^\s*file\s+['"]?(.+?)['"]?\s*$/.exec(line);
    if (!match) continue;
    const basename = path.basename(match[1]).replace(/\.mp3$/i, '.srt');
    const filePath = path.resolve(dir, basename);
    if (filePath.startsWith(`${dir}${path.sep}`) && !ordered.includes(filePath)) ordered.push(filePath);
  }
  if (!ordered.length) {
    const names = (await fsp.readdir(dir)).filter(name => /^g\d+\.srt$/i.test(name))
      .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
    ordered.push(...names.map(name => path.join(dir, name)));
  }

  const parts = [];
  for (const filePath of ordered) {
    let text;
    try { text = await fsp.readFile(filePath, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const cues = parseSrtText(text);
    if (!cues.length) continue;
    parts.push({
      path: path.relative(ROOT, filePath),
      sha256: sha256(text),
      cues,
      durationMs: Math.max(...cues.map(cue => cue.endMs))
    });
  }
  return buildTranscript(parts);
}

async function inspectCandidate(entry, match, { root = ROOT, ffmpegPath = 'ffmpeg' } = {}) {
  const projectRoot = path.resolve(root);
  const videoPath = resolveReportPath(projectRoot, entry.path);
  const scriptName = path.basename(match.scriptPath || '').replace(/\.json$/i, '');
  if (!scriptName) return { path: entry.path, status: 'script_cache_path_missing' };
  const narrationPath = path.join(projectRoot, 'data', 'videos', `${scriptName}_narracao.mp3`);
  const subtitleDirectory = path.join(projectRoot, 'data', 'videos', `${scriptName}_tts`);
  const transcript = await readSubtitleParts(subtitleDirectory).catch(error => ({ error: String(error.message || error) }));
  const base = {
    path: entry.path,
    currentSha256: entry.currentSha256 || null,
    scriptCacheCandidate: {
      scriptPath: match.scriptPath,
      status: entry.scriptCache?.status || 'candidate',
      candidateBasis: match.candidateBasis || null,
      contextEmpty: match.contextEmpty === true,
      reviewerPresent: match.reviewerPresent === true
    },
    narrationPath: path.relative(projectRoot, narrationPath),
    subtitleDirectory: path.relative(projectRoot, subtitleDirectory)
  };
  const videoStat = await fsp.stat(videoPath).catch(() => null);
  const narrationStat = await fsp.stat(narrationPath).catch(() => null);
  if (!videoStat?.isFile() || !narrationStat?.isFile()) {
    return { ...base, status: 'narration_or_video_missing', transcript: transcript.error ? undefined : {
      wordCount: transcript.wordCount, transcriptSha256: transcript.transcriptSha256,
      segmentDurationMs: transcript.segmentDurationMs, parts: transcript.parts
    } };
  }

  const [videoSha256, narrationSha256] = await Promise.all([hashFile(videoPath), hashFile(narrationPath)]);
  const expectedVideoHash = String(entry.currentSha256 || '').toLowerCase();
  const videoHashMatchesSourceReport = /^[a-f0-9]{64}$/.test(expectedVideoHash) && videoSha256 === expectedVideoHash;
  const metrics = pcmCorrelation(
    await runFfmpeg(ffmpegPath, videoPath),
    await runFfmpeg(ffmpegPath, narrationPath)
  );
  const confirmed = !transcript.error && audioLineageConfirmed(metrics, transcript);
  const narrationDurationMs = metrics.narrationSamples / metrics.sampleRate * 1000;
  const transcriptCoverage = narrationDurationMs > 0 ? transcript.segmentDurationMs / narrationDurationMs : 0;

  return {
    ...base,
    status: confirmed && videoHashMatchesSourceReport ? 'transcript_bound_to_media_audio' : 'lineage_unconfirmed',
    videoSha256,
    videoHashMatchesSourceReport,
    videoSizeBytes: videoStat.size,
    narrationSha256,
    narrationSizeBytes: narrationStat.size,
    audioMatch: metrics,
    transcript: transcript.error ? { status: 'unavailable', reason: transcript.error } : {
      status: confirmed ? 'sidecar_transcript_audio_bound' : 'sidecar_transcript_unconfirmed',
      transcriptSha256: transcript.transcriptSha256,
      wordCount: transcript.wordCount,
      partCount: transcript.parts.length,
      segmentDurationMs: transcript.segmentDurationMs,
      narrationDurationMs,
      durationCoverage: transcriptCoverage,
      parts: transcript.parts
    },
    cacheLineageNote: 'O vínculo de áudio confirma a transcrição SRT ao master. O JSON candidato por título não é tratado como roteiro do master.'
  };
}

async function recoverBacklogTranscripts(sourceReport, { root = ROOT, ffmpegPath = 'ffmpeg', resolvedAt = new Date().toISOString() } = {}) {
  if (!sourceReport || !Array.isArray(sourceReport.entries)) throw new TypeError('relatório de fontes inválido');
  const entries = [];
  for (const item of sourceReport.entries) {
    const matches = item.scriptCache?.matches || [];
    if (matches.length !== 1) {
      entries.push({ path: item.path, status: matches.length ? 'script_cache_ambiguous' : 'script_cache_not_found', candidateCount: matches.length });
      continue;
    }
    try {
      entries.push(await inspectCandidate(item, matches[0], { root, ffmpegPath }));
    } catch (error) {
      entries.push({ path: item.path, status: 'lineage_check_failed', reason: String(error.message || error).slice(0, 300) });
    }
  }
  return {
    schemaVersion: 1,
    resolvedAt,
    sourceReportPath: DEFAULT_INPUT,
    criteria: {
      sampleRate: SAMPLE_RATE,
      audioWindowSeconds: WINDOW_SECONDS,
      maximumDurationDeltaSeconds: 0.75,
      minimumFullAudioCorrelation: 0.95,
      minimumAudioWindowCorrelation: 0.9,
      minimumTranscriptCoverage: 0.9,
      minimumTranscriptWords: 150
    },
    entries,
    totals: {
      candidates: entries.length,
      transcriptsBoundToMedia: entries.filter(entry => entry.status === 'transcript_bound_to_media_audio').length,
      lineageUnconfirmed: entries.filter(entry => entry.status !== 'transcript_bound_to_media_audio').length
    }
  };
}

async function writeJsonAtomic(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function main(argv = process.argv.slice(2)) {
  const inputPath = path.resolve(ROOT, argv[0] || DEFAULT_INPUT);
  const outputPath = path.resolve(ROOT, argv[1] || DEFAULT_OUTPUT);
  const sourceReport = JSON.parse(await fsp.readFile(inputPath, 'utf8'));
  const report = await recoverBacklogTranscripts(sourceReport);
  report.sourceReportPath = path.relative(ROOT, inputPath);
  await writeJsonAtomic(outputPath, report);
  console.log(JSON.stringify({
    outputPath: path.relative(ROOT, outputPath),
    candidates: report.totals.candidates,
    transcriptsBoundToMedia: report.totals.transcriptsBoundToMedia,
    lineageUnconfirmed: report.totals.lineageUnconfirmed
  }));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  audioLineageConfirmed,
  buildTranscript,
  parseSrtText,
  pcmCorrelation,
  readSubtitleParts,
  recoverBacklogTranscripts,
  resolveReportPath,
  timestampToMilliseconds
};
