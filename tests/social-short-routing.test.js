'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { makeVerticalClips } = require('../utils/clip-maker');
const { stageNarrationGroups } = require('../utils/narration-groups');
const { isPlatformTargeted, isShortsTargeted } = require('../utils/platform-video-policy');

test('continuous narration is staged into the group files required by social narrative rendering', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'social-narration-groups-'));
  const audioPath = path.join(root, 'narration.mp3');
  const outputDir = path.join(root, 'groups');
  await fs.writeFile(audioPath, 'continuous narration fixture');
  const calls = [];

  try {
    const files = await stageNarrationGroups({
      audioPath,
      outputDir,
      totalDurationMs: 5_000,
      timings: [
        { audioOffsetMs: 0, durationMs: 1_200 },
        { audioOffsetMs: 1_200, durationMs: 0 },
        { audioOffsetMs: 2_400, durationMs: 1_500 }
      ],
      ffmpegRunner: async args => {
        calls.push(args);
        await fs.writeFile(args.at(-1), 'group audio fixture');
      }
    });

    assert.deepEqual(files.map(file => path.basename(file)), ['g0.mp3', 'g2.mp3']);
    assert.deepEqual(calls.map(args => args.slice(2, 5)), [
      ['0.000', '-t', '1.200'], ['2.400', '-t', '1.500']
    ]);
    assert.deepEqual(await fs.readdir(outputDir), ['g0.mp3', 'g2.mp3']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('automatic video generation uses narrative parts instead of the legacy sentence-cut helper', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'scripts', 'generate-animated-video.js'), 'utf8');
  assert.match(source, /makeNarrativeSocialParts/);
  assert.match(source, /portraitVideoPath: portraitOut/);
  assert.doesNotMatch(source, /makeVerticalClips\s*\(/);
});

test('generic short renders stay out of automatic publishing routes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'social-short-routing-'));
  const ttsDir = path.join(root, 'tts');
  const outDir = path.join(root, 'clips');
  await fs.mkdir(ttsDir, { recursive: true });
  await fs.writeFile(path.join(ttsDir, 'g1.mp3'), 'narration fixture');
  const text = 'O estudo mediu três mudanças e explicou como elas afetam o resultado final.';
  const words = text.split(/\s+/);
  try {
    const clips = await makeVerticalClips({
      script: {
        timings: [
          { durationMs: 4000, sentences: [{ text: 'Abertura do vídeo.', startMs: 0, durationMs: 4000 }] },
          { durationMs: 10_000, sentences: [{ text, words, startMs: 0, durationMs: 10_000 }] }
        ]
      },
      imagesDir: path.join(root, 'no-images'),
      ttsDir,
      outDir,
      rendererFactory: () => ({
        render: async ({ outputPath }) => fs.writeFile(outputPath, 'rendered fixture')
      }),
      ffmpegRunner: async args => fs.writeFile(args.at(-1), 'audio fixture')
    });

    assert.equal(clips.length, 1);
    const [clip] = clips;
    assert.equal(clip.kind, 'social-short-clip');
    assert.deepEqual(clip.platforms, ['shorts', 'kwai', 'x']);
    assert.equal(isPlatformTargeted(clip, 'instagram'), false);
    assert.equal(isPlatformTargeted(clip, 'tiktok'), false);
    assert.equal(isShortsTargeted(clip), false);
    for (const platform of ['kwai', 'x']) assert.equal(isPlatformTargeted(clip, platform), false);
    await assert.rejects(fs.access(path.join(outDir, 'corte_c1.mp3')));
    await fs.access(clip.path);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
