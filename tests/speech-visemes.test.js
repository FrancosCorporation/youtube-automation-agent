const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { extractSpeechVisemes, normalizeMouthCues } = require('../utils/speech-visemes');

const validTimeline = () => ({
  metadata: { duration: 1 },
  mouthCues: [
    { start: 0, end: 0.2, value: 'X' },
    { start: 0.2, end: 0.55, value: 'A' },
    { start: 0.55, end: 1, value: 'F' },
  ],
});

test('normaliza formatos válidos, incluindo silêncio explícito e fronteiras', () => {
  const track = normalizeMouthCues(validTimeline());
  assert.equal(track.version, 1);
  assert.equal(track.recognizer, 'phonetic');
  assert.equal(track.duration, 1);
  assert.deepEqual(track.cues.map(({ value }) => value), ['X', 'A', 'F']);
});

test('aceita apenas tolerância submilissegundo em fronteiras do reconhecedor', () => {
  const timeline = validTimeline();
  timeline.mouthCues[2].start = 0.5495;
  assert.equal(normalizeMouthCues(timeline).cues[2].start, 0.5495);
  timeline.mouthCues[2].start = 0.5489;
  assert.throws(() => normalizeMouthCues(timeline), /Invalid mouth cue/);
});

test('rejeita duração, lista, formato, ordem e valores inválidos', () => {
  for (const input of [
    { metadata: { duration: 0 }, mouthCues: [{ start: 0, end: 1, value: 'A' }] },
    { metadata: { duration: 1 }, mouthCues: [] },
    { metadata: { duration: 1 }, mouthCues: [{ start: 0, end: 1, value: 'Z' }] },
    { metadata: { duration: 1 }, mouthCues: [{ start: 0.1, end: 0.1, value: 'A' }] },
    { metadata: { duration: 1 }, mouthCues: [{ start: 0, end: 1.03, value: 'A' }] },
    { metadata: { duration: 1 }, mouthCues: [{ start: -0.01, end: 0.2, value: 'X' }] },
  ]) assert.throws(() => normalizeMouthCues(input));
});

test('o sampler é determinístico em seeks fora de ordem e retorna repouso no silêncio', async () => {
  const { sampleViseme } = await import('../experiments/hyperframes-pulso-pilot/src/viseme-track.js');
  const track = normalizeMouthCues(validTimeline());
  const sequence = [0.35, 0.1, 1.4, 0.75, 0.35];
  const sampled = sequence.map((time) => sampleViseme(track, time));
  assert.deepEqual(sampled[0], sampled[4]);
  assert.equal(sampleViseme(track, 0.1).value, 'X');
  assert.equal(sampleViseme(track, 0.1).rest, true);
  assert.equal(sampleViseme(track, 0.35).value, 'A');
  assert.equal(sampleViseme(track, 1.4).rest, true);
  assert.equal(sampleViseme(track, 0.35, 0).value, 'X');
  assert.equal(sampleViseme({ cues: [] }, 0.2), null);
});

test('pausas entre cues retornam ao repouso antes de iniciar a próxima transição', async () => {
  const { sampleViseme, MOUTH_SHAPES } = await import('../experiments/hyperframes-pulso-pilot/src/viseme-track.js');
  const track = { cues: [
    { start: 0, end: 0.25, value: 'A' },
    { start: 0.5, end: 0.75, value: 'F' }
  ] };

  assert.equal(sampleViseme(track, 0.4).rest, true);
  assert.equal(sampleViseme(track, 0.5).x, MOUTH_SHAPES.X.x);
  assert.equal(sampleViseme(track, 0.5).y, MOUTH_SHAPES.X.y);
  assert.ok(Math.abs(sampleViseme(track, 0.51).x - (MOUTH_SHAPES.X.x + (MOUTH_SHAPES.F.x - MOUTH_SHAPES.X.x) * 0.2)) < 1e-9);
  assert.equal(sampleViseme(track, 0.5, Number.NaN).rest, true);
  assert.equal(sampleViseme(track, 0.5, Number.POSITIVE_INFINITY).rest, true);
});

test('a extração conserva o hash fonte e executa conversão antes dos visemas', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-viseme-test-'));
  const audioPath = path.join(directory, 'source.wav');
  const audio = Buffer.from('audio fixture; fake command runner');
  await fs.writeFile(audioPath, audio);
  const calls = [];
  const exec = async (binary, args, options) => {
    calls.push({ binary, args, signal: options.signal });
    if (binary === 'fake-ffmpeg') return { stdout: '', stderr: '' };
    return {
      stdout: JSON.stringify({ metadata: { duration: 0.5 }, mouthCues: [{ start: 0, end: 0.5, value: 'X' }] }),
      stderr: '',
    };
  };

  try {
    const result = await extractSpeechVisemes(audioPath, {
      binary: process.execPath,
      ffmpegPath: 'fake-ffmpeg',
      threads: 1,
      exec,
    });
    assert.equal(result.sourceSha256, createHash('sha256').update(audio).digest('hex'));
    assert.equal(result.duration, 0.5);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args.slice(-5, -2), ['-ac', '1', '-ar']);
    assert.ok(calls[1].args.includes('--threads'));
    assert.equal(calls[1].args[calls[1].args.indexOf('--threads') + 1], '1');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a extração cancela o executor ativo quando recebe AbortSignal', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-viseme-abort-'));
  const audioPath = path.join(directory, 'source.wav');
  await fs.writeFile(audioPath, 'fixture');
  const controller = new AbortController();
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  let abortObserved = false;
  const exec = async (binary, _args, options) => {
    if (binary === 'fake-ffmpeg') return { stdout: '', stderr: '' };
    markStarted();
    return new Promise((_resolve, reject) => {
      const onAbort = () => {
        abortObserved = true;
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));
      };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    });
  };

  const pending = extractSpeechVisemes(audioPath, {
    binary: process.execPath,
    ffmpegPath: 'fake-ffmpeg',
    exec,
    signal: controller.signal,
  });
  try {
    await started;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError', code: 'ABORT_ERR' });
    assert.equal(abortObserved, true);
  } finally {
    controller.abort();
    await pending.catch(() => {});
    await fs.rm(directory, { recursive: true, force: true });
  }
});
