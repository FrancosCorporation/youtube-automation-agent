'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { buildPortraitPartRender } = require('../utils/portrait-part-ranges');

test('contiguous blocks merge, but a repeated opening keeps its separate range and duration', () => {
  const render = ranges => buildPortraitPartRender({ portraitVideoPath: 'source.mp4', outputPath: 'part.mp4', ranges });
  const contiguous = render([{ start: 0, end: 3000 }, { start: 3000, end: 5000 }]);
  assert.equal(contiguous.durationMs, 5000);
  assert.equal(contiguous.ranges.length, 1);
  const laterPart = render([{ start: 0, end: 3000 }, { start: 100000, end: 150000 }]);
  assert.equal(laterPart.durationMs, 53000);
  assert.equal(laterPart.ranges.length, 2);
  const reversed = render([{ start: 100000, end: 150000 }, { start: 0, end: 3000 }]);
  assert.equal(reversed.ranges[0].start, 100000);
  assert.throws(() => render([{ start: -1, end: 10 }]), /inválido/);
  assert.throws(() => render([{ start: 0, end: NaN }]), /inválido/);
});

test('ffmpeg concatenates the opening and later footage without including the skipped middle', {
  skip: spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0
}, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-part-ranges-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.mp4');
  const output = path.join(directory, 'part.mp4');
  const ffmpeg = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-filter_complex_threads', '1', ...args]);
  ffmpeg(['-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=30:d=1',
    '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=30:d=1',
    '-f', 'lavfi', '-i', 'color=c=lime:s=64x64:r=30:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a',
    '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  const render = buildPortraitPartRender({ portraitVideoPath: source, outputPath: output,
    ranges: [{ start: 0, end: 1000 }, { start: 2000, end: 3000 }] });
  ffmpeg(render.args);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name', '-of', 'json', output]));
  assert(Math.abs(Number(probe.format.duration) - 2) < 0.08);
  assert(probe.streams.some(stream => stream.codec_name === 'aac'));
  const pixel = at => ffmpeg(['-ss', String(at), '-i', output, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
  const opening = pixel(0.5), later = pixel(1.5);
  assert(opening[0] > 200 && opening[1] < 30 && opening[2] < 30);
  assert(later[1] > 200 && later[0] < 30 && later[2] < 30);
});
