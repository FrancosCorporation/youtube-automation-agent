'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { narrativeFrameRanges, renderNarrativeSegments, buildNarrativeSegmentMuxArgs, narrativeSegmentList } = require('../utils/narrative-render-segments');

test('frame segments cover a whole long episode exactly once, including its partial tail', () => {
  const ranges = narrativeFrameRanges(11064, 24);
  assert.equal(ranges.length, 16);
  assert.deepEqual(ranges[0], { start: 0, end: 719 });
  assert.deepEqual(ranges.at(-1), { start: 10800, end: 11063 });
  assert.equal(ranges.reduce((total, range) => total + range.end - range.start + 1, 0), 11064);
  for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i].start, ranges[i - 1].end + 1);
  assert.throws(() => narrativeFrameRanges(NaN, 24));
});

test('failure preserves completed segments; retry renders only missing or tampered frames', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-segments-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let fail = true;
  const rendered = [];
  const options = { directory, inputSha256: 'a'.repeat(64), totalFrames: 1440, fps: 24,
    logger: { info() {} }, durationReader: async () => 30,
    render: async ({ start, outputPath }) => {
      rendered.push(start);
      if (start === 720 && fail) throw new Error('simulated process interruption');
      await fs.writeFile(outputPath, Buffer.alloc(2048, start ? 2 : 1));
    } };
  await assert.rejects(renderNarrativeSegments(options), /interruption/);
  const first = path.join(directory, '00000000-00000719.mp4');
  const completed = await fs.readFile(first);
  fail = false;
  rendered.length = 0;
  const files = await renderNarrativeSegments(options);
  assert.deepEqual(rendered, [720]);
  assert.equal(files.length, 2);
  assert.deepEqual(await fs.readFile(first), completed);
  await fs.writeFile(first, Buffer.alloc(2048, 3));
  rendered.length = 0;
  await renderNarrativeSegments(options);
  assert.deepEqual(rendered, [0]);
  assert((await fs.readdir(directory)).some(name => name.includes('.invalid-')));
  rendered.length = 0;
  await renderNarrativeSegments({ ...options, inputSha256: 'b'.repeat(64) });
  assert.deepEqual(rendered, [0, 720]);
});

test('mux keeps exact frame count and continuous audio across video-only segments', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pulso-mux-'"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const ffmpeg = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args]);
  const files = [];
  for (const [i, color] of ['red', 'blue', 'lime'].entries()) {
    const file = path.join(directory, `${i}.mp4`);
    ffmpeg(['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=64x64:r=24`, '-frames:v', String(i === 2 ? 7 : 24),
      '-an', '-c:v', 'libx264', '-threads', '1', '-crf', '18', '-pix_fmt', 'yuv420p', file]);
    files.push(file);
  }
  const audio = path.join(directory, 'audio.m4a'), listPath = path.join(directory, 'segments.txt');
  const output = path.join(directory, 'master.mp4');
  ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:a', 'aac', audio]);
  await fs.writeFile(listPath, narrativeSegmentList(files));
  ffmpeg(buildNarrativeSegmentMuxArgs({ listPath, audioPath: audio, outputPath: output, durationSeconds: 55 / 24 }));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', output]));
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  const sound = probe.streams.find(stream => stream.codec_type === 'audio');
  assert.equal(Number(video.nb_read_frames), 55);
  assert(Math.abs(Number(video.duration) - 55 / 24) < 1 / 24);
  assert(Math.abs(Number(sound.duration) - 55 / 24) < 1 / 24);
  assert.throws(() => narrativeSegmentList(['bad\npath']), /inválido/);
});
