'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { renderPortraitPartCheckpoint } = require('../utils/portrait-part-checkpoint');
const { makeNarrativeSocialParts } = require('../utils/clip-maker');

test('cut checkpoint reuses exact bytes, preserves progress on failure and invalidates changed source/ranges', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portrait-checkpoint-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let renders = 0;
  const options = { sourcePath: path.join(dir, 'source.mp4'), sourceSha256: 'a'.repeat(64),
    outputPath: path.join(dir, 'part.mp4'), ranges: [{ start: 0, end: 100000 }], durationReader: async () => 100,
    run: async args => { renders++; await fs.writeFile(args.at(-1), 'verified video'); } };
  await renderPortraitPartCheckpoint(options);
  await renderPortraitPartCheckpoint(options);
  assert.equal(renders, 1);
  await assert.rejects(renderPortraitPartCheckpoint({ ...options, sourceSha256: 'b'.repeat(64),
    run: async () => { throw new Error('ffmpeg interrupted'); } }), /interrupted/);
  assert.equal(await fs.readFile(options.outputPath, 'utf8'), 'verified video');
  await renderPortraitPartCheckpoint(options);
  assert.equal(renders, 1);
  await fs.appendFile(options.outputPath, 'corrupted');
  await renderPortraitPartCheckpoint(options);
  assert.equal(renders, 2);
  await renderPortraitPartCheckpoint({ ...options, sourceSha256: 'b'.repeat(64) });
  await renderPortraitPartCheckpoint({ ...options, ranges: [{ start: 1000, end: 101000 }] });
  assert.equal(renders, 4);
});

test('truncated clip is not promoted and cannot become a cache hit', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portrait-checkpoint-invalid-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const outputPath = path.join(dir, 'part.mp4');
  await assert.rejects(renderPortraitPartCheckpoint({ sourcePath: 'master.mp4', sourceSha256: 'a'.repeat(64),
    outputPath, ranges: [{ start: 0, end: 100000 }], durationReader: async () => 12,
    run: async args => fs.writeFile(args.at(-1), 'truncated') }), { code: 'GENERATION_SOCIAL_PARTS_PENDING' });
  await assert.rejects(fs.stat(outputPath), { code: 'ENOENT' });
});

test('social-part orchestration keeps the first cut when FFmpeg fails later, then resumes only the missing cut', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'social-parts-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'master.mp4');
  await fs.writeFile(source, 'source video');
  const texts = ['Abertura.', 'Primeira seção.', 'Segunda seção.', 'Conclusão.'];
  const script = { title: 'Teste de retomada', hook: texts[0],
    mainContent: { sections: texts.slice(1, 3).map(content => ({ content })) }, conclusion: { finalThought: texts[3] },
    timings: texts.map((text, i) => ({ audioOffsetMs: i * 60000, durationMs: 60000,
      sentences: [{ text, startMs: 0, durationMs: 60000 }] })) };
  let calls = 0, fail = true;
  const options = { script, portraitVideoPath: source, outDir: path.join(root, 'parts'), platforms: ['shorts'],
    mediaDurationReader: async () => 120, ffmpegRunner: async args => {
      calls++;
      if (args.at(-1).includes('parte2-') && fail) throw new Error('interrupted');
      await fs.writeFile(args.at(-1), 'complete cut');
    } };
  assert.deepEqual(await makeNarrativeSocialParts(options), []);
  assert.equal(calls, 2);
  fail = false;
  const clips = await makeNarrativeSocialParts(options);
  assert.equal(clips.length, 2);
  assert.equal(calls, 3, 'first cut must be reused after the second fails');
});
