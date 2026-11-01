'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function stageNarrationGroups({ audioPath, timings, outputDir, totalDurationMs, ffmpegRunner }) {
  if (typeof audioPath !== 'string' || !audioPath
    || typeof outputDir !== 'string' || !outputDir
    || !Array.isArray(timings)
    || !Number.isFinite(Number(totalDurationMs)) || Number(totalDurationMs) <= 0
    || typeof ffmpegRunner !== 'function') {
    throw new TypeError('áudio, tempos, diretório, duração e FFmpeg são necessários para separar a narração');
  }

  const audioDurationMs = Number(totalDurationMs);
  await fs.mkdir(outputDir, { recursive: true });
  const outputs = [];
  const expectedNames = new Set();
  let nextOffsetMs = 0;

  for (const [index, timing] of timings.entries()) {
    const durationMs = Number(timing?.durationMs);
    const declaredOffsetMs = Number(timing?.audioOffsetMs);
    const startMs = Number.isFinite(declaredOffsetMs) ? declaredOffsetMs : nextOffsetMs;
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      nextOffsetMs = Math.max(nextOffsetMs, startMs);
      continue;
    }
    if (!Number.isFinite(startMs) || startMs < 0 || startMs >= audioDurationMs) {
      throw new RangeError(`início de áudio inválido no grupo ${index + 1}`);
    }

    const endMs = startMs + durationMs;
    if (endMs - audioDurationMs > 250) {
      throw new RangeError(`grupo ${index + 1} excede a duração da narração`);
    }
    const segmentDurationMs = Math.min(durationMs, audioDurationMs - startMs);
    if (segmentDurationMs < 250) {
      throw new RangeError(`áudio insuficiente no grupo ${index + 1}`);
    }

    const name = `g${index}.mp3`;
    const outputPath = path.join(outputDir, name);
    const stagedPath = `${outputPath}.${process.pid}.tmp.mp3`;
    expectedNames.add(name);
    try {
      await ffmpegRunner([
        '-y', '-ss', (startMs / 1000).toFixed(3), '-t', (segmentDurationMs / 1000).toFixed(3),
        '-i', audioPath, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', stagedPath
      ]);
      const stat = await fs.stat(stagedPath);
      if (!stat.isFile() || stat.size <= 0) throw new Error(`FFmpeg não gerou o grupo ${index + 1}`);
      await fs.rename(stagedPath, outputPath);
      outputs.push(outputPath);
    } finally {
      await fs.unlink(stagedPath).catch(() => {});
    }
    nextOffsetMs = Math.max(nextOffsetMs, startMs + segmentDurationMs);
  }

  for (const name of await fs.readdir(outputDir)) {
    if (/^g\d+\.mp3$/.test(name) && !expectedNames.has(name)) {
      await fs.unlink(path.join(outputDir, name)).catch(() => {});
    }
  }
  return outputs;
}

module.exports = { stageNarrationGroups };
