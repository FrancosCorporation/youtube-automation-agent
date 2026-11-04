'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const sharp = require('sharp');
const { checkpointNarrativeFrames, verifiedNarrativeFrameRange, buildNarrativeFrameEncodeArgs } = require('../utils/narrative-frame-backup');

test('finished captures survive original workspace removal and require the same identity and bytes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-frame-backup-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'source'), directory = path.join(root, 'backup');
  await fs.mkdir(sourceDir);
  for (let frame = 0; frame < 3; frame++) {
    const file = path.join(sourceDir, `element-0000${frame}.jpeg`);
    await sharp({ create: { width: 64, height: 64, channels: 3, background: ['red', 'blue', 'green'][frame] } }).jpeg().toFile(file);
    await fs.utimes(file, new Date(0), new Date(0));
  }
  const options = { sourceDir, directory, inputSha256: 'a'.repeat(64), fps: 24, width: 64, height: 64 };
  await checkpointNarrativeFrames({ ...options, endFrame: 2 });
  await fs.rm(sourceDir, { recursive: true });
  const inputPattern = await verifiedNarrativeFrameRange({ ...options, start: 1, end: 2 });
  assert(inputPattern);
  assert.equal(await verifiedNarrativeFrameRange({ ...options, inputSha256: 'b'.repeat(64), start: 0, end: 2 }), null);
  assert.equal(await verifiedNarrativeFrameRange({ ...options, width: 1080, start: 0, end: 2 }), null);
  assert.equal(await verifiedNarrativeFrameRange({ ...options, start: 0, end: 3 }), null);
  const outputPath = path.join(root, 'restored.mp4');
  execFileSync('ffmpeg', buildNarrativeFrameEncodeArgs({ inputPattern, start: 1, end: 2, fps: 24, outputPath }));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', outputPath]));
  assert.equal(probe.streams.length, 1);
  assert.equal(probe.streams[0].codec_type, 'video');
  assert.equal(Number(probe.streams[0].nb_frames), 2);
  await fs.writeFile(path.join(directory, 'element-00001.jpeg'), 'changed');
  assert.equal(await verifiedNarrativeFrameRange({ ...options, start: 0, end: 2 }), null);
});

test('a capture still being written cannot be checkpointed', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-frame-active-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'element-00000.jpeg'), 'active');
  await assert.rejects(checkpointNarrativeFrames({ sourceDir: root, directory: path.join(root, 'backup'),
    inputSha256: 'a'.repeat(64), endFrame: 0, fps: 24, width: 64, height: 64 }), /ainda em escrita/);
});
