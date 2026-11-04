'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { getMediaDuration } = require('./ffmpeg');

const hashFile = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');

function narrativeFrameRanges(totalFrames, fps) {
  if (!Number.isSafeInteger(totalFrames) || totalFrames <= 0 || !Number.isInteger(fps) || fps <= 0 || fps > 120) {
    throw new TypeError('intervalo narrativo inválido');
  }
  const size = fps * 30;
  const ranges = [];
  for (let start = 0; start < totalFrames; start += size) ranges.push({ start, end: Math.min(totalFrames - 1, start + size - 1) });
  return ranges;
}

async function renderNarrativeSegments({ directory, inputSha256, totalFrames, fps, render,
  durationReader = getMediaDuration, logger = console }) {
  if (!/^[a-f0-9]{64}$/.test(inputSha256)) throw new TypeError('identidade do render inválida');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const files = [];
  for (const range of narrativeFrameRanges(totalFrames, fps)) {
    const stem = `${String(range.start).padStart(8, '0')}-${String(range.end).padStart(8, '0')}`;
    const output = path.join(directory, `${stem}.mp4`), manifest = `${output}.json`;
    const expectedDuration = (range.end - range.start + 1) / fps;
    let saved;
    try { saved = JSON.parse(await fs.readFile(manifest, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    const stat = await fs.lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (saved?.schemaVersion === 1 && saved.inputSha256 === inputSha256 && saved.start === range.start
      && saved.end === range.end && saved.fps === fps && stat?.isFile() && !stat.isSymbolicLink()
      && stat.size === saved.sizeBytes && saved.sha256 === await hashFile(output)
      && Math.abs(await durationReader(output) - expectedDuration) <= 1 / fps) {
      logger.info?.(`quadros ${range.start}-${range.end}: bloco reutilizado por hash`);
      files.push(output);
      continue;
    }
    // Preserve unrecognized/corrupt files for diagnosis, without letting them
    // masquerade as a completed segment or overwrite a valid checkpoint.
    const suffix = `.invalid-${crypto.randomBytes(6).toString('hex')}`;
    for (const file of [output, manifest]) {
      await fs.rename(file, `${file}${suffix}`).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    const temporary = `${output}.${process.pid}.tmp.mp4`;
    const temporaryManifest = `${manifest}.${process.pid}.tmp`;
    try {
      await render({ ...range, outputPath: temporary });
      const rendered = await fs.lstat(temporary);
      const duration = await durationReader(temporary);
      if (!rendered.isFile() || rendered.isSymbolicLink() || rendered.size < 1024
        || !Number.isFinite(duration) || Math.abs(duration - expectedDuration) > 1 / fps) {
        throw Object.assign(new Error(`bloco narrativo ${stem} inválido`), { code: 'NARRATIVE_RENDER_FAILED' });
      }
      const record = { schemaVersion: 1, inputSha256, ...range, fps, sizeBytes: rendered.size,
        sha256: await hashFile(temporary), durationSeconds: duration };
      await fs.writeFile(temporaryManifest, JSON.stringify(record), { mode: 0o600 });
      await fs.rename(temporary, output);
      await fs.rename(temporaryManifest, manifest);
      files.push(output);
    } finally {
      await fs.unlink(temporary).catch(() => {});
      await fs.unlink(temporaryManifest).catch(() => {});
    }
  }
  return files;
}

function buildNarrativeSegmentMuxArgs({ listPath, audioPath, outputPath, durationSeconds }) {
  return ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy',
    '-t', durationSeconds.toFixed(6), '-movflags', '+faststart', outputPath];
}

function narrativeSegmentList(files) {
  if (files.some(file => /[\r\n]/.test(file))) throw new TypeError('caminho de bloco inválido');
  return files.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n');
}

module.exports = { narrativeFrameRanges, renderNarrativeSegments, buildNarrativeSegmentMuxArgs, narrativeSegmentList };
