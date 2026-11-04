'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const frameName = frame => `element-${String(frame).padStart(5, '0')}.jpeg`;

// Migration aid for an already running pre-segment renderer. This copies only
// finished captures; it never renders, publishes, edits the job or stops it.
async function checkpointNarrativeFrames({ sourceDir, directory, inputSha256, fps, width, height, endFrame }) {
  if (!/^[a-f0-9]{64}$/.test(inputSha256) || !Number.isInteger(endFrame) || endFrame < 0) throw new TypeError('backup narrativo inválido');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const frames = [];
  for (let frame = 0; frame <= endFrame; frame++) {
    const name = frameName(frame), source = path.join(sourceDir, name), target = path.join(directory, name);
    const before = await fs.lstat(source);
    if (!before.isFile() || before.isSymbolicLink() || Date.now() - before.mtimeMs < 5000) {
      throw new Error('captura ainda em escrita ou não regular');
    }
    const bytes = await fs.readFile(source);
    const after = await fs.lstat(source);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== before.size) {
      throw new Error('captura mudou durante o backup');
    }
    const sha256 = digest(bytes);
    try { await fs.link(source, target); }
    catch (error) {
      if (error.code === 'EXDEV') await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
      else if (error.code !== 'EEXIST' || digest(await fs.readFile(target)) !== sha256) throw error;
    }
    frames.push({ frame, sha256, sizeBytes: bytes.length });
  }
  const manifest = { schemaVersion: 1, inputSha256, fps, width, height, frames };
  const temporary = path.join(directory, `manifest.${process.pid}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(manifest), { mode: 0o600 });
  await fs.rename(temporary, path.join(directory, 'manifest.json'));
  return { frames: frames.length, inputSha256 };
}

async function verifiedNarrativeFrameRange({ directory, inputSha256, fps, width, height, start, end }) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  if (manifest.schemaVersion !== 1 || manifest.inputSha256 !== inputSha256 || manifest.fps !== fps
    || manifest.width !== width || manifest.height !== height || !Array.isArray(manifest.frames)) return null;
  for (let frame = start; frame <= end; frame++) {
    const record = manifest.frames[frame];
    if (record?.frame !== frame) return null;
    const file = path.join(directory, frameName(frame));
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== record.sizeBytes || digest(await fs.readFile(file)) !== record.sha256) return null;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  return path.join(directory, 'element-%05d.jpeg');
}

function buildNarrativeFrameEncodeArgs({ inputPattern, start, end, fps, outputPath }) {
  return ['-hide_banner', '-loglevel', 'warning', '-y', '-framerate', String(fps), '-start_number', String(start),
    '-i', inputPattern, '-frames:v', String(end - start + 1), '-an', '-c:v', 'libx264', '-threads', '2',
    '-crf', '18', '-pix_fmt', 'yuv420p', outputPath];
}

module.exports = { checkpointNarrativeFrames, verifiedNarrativeFrameRange, buildNarrativeFrameEncodeArgs };
