'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');

// Exercise the real orchestration and filesystem promotion/checkpoint logic.
// Only external rendering, resource probes and episode compilation are fake.
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-render-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'experiments/remotion-motion-review');
  for (const directory of ['node_modules/.bin', 'public/pulso-story']) {
    await fs.mkdir(path.join(project, directory), { recursive: true });
  }
  await fs.writeFile(path.join(project, 'node_modules/.bin/remotion'), 'fixture');
  await fs.writeFile(path.join(project, 'public/pulso-story/approved-robot-rigged.glb'), 'robot');
  const digest = data => String(data) === 'robot'
    ? '6a9eb38d99229ac5519bb2900bda50df462b6d4eed411daa2a872e41fbc48df5'
    : crypto.createHash('sha256').update(data).digest('hex');
  const audioPath = path.join(root, 'audio.mp3');
  await fs.writeFile(audioPath, 'narration');
  const plan = {
    jobId: 'recovery-test', inputSha256: 'a'.repeat(64), narrationSha256: digest('narration'),
    assets: [], scenes: [], chapters: [], fps: 24, durationInFrames: 48,
    speechEnvelope: { levels: [0.5], stepMs: 10 }
  };
  let now = 100000;
  let failingAspect = null;
  const calls = [];
  const mocked = {
    './ffmpeg': { getMediaDuration: async () => 2, getFFmpegPath: () => 'fixture-ffmpeg' },
    './narrative-render-segments': {
      ...require('../utils/narrative-render-segments'),
      renderNarrativeSegments: options => require('../utils/narrative-render-segments').renderNarrativeSegments({
        ...options, durationReader: async () => 2
      })
    },
    './audio-mix': { deriveMood: () => 'calm', buildSfxEvents: () => [],
      mixdownAudio: async ({ workDir }) => {
        const file = path.join(workDir, 'audio.m4a');
        await fs.writeFile(file, 'mixed');
        return { path: file };
      } },
    './process-file-lock': { withProcessFileLock: fn => fn() },
    './render-timing': { probeRenderHardwareGate: () => ({ renderSafe: true, availableMemoryBytes: 8 * 1024 ** 3 }),
      createRenderTimingRecord: value => value, persistRenderTimingRecord: async () => {} },
    './theme-visuals': { selectThemePalette: () => ({ accents: ['red'] }) },
    './narrative-episode-props': { APPROVED_ROBOT_SRC: 'robot', assertNarrativeEpisodeProps() {} },
    './narrative-human-actors': { verifyHumanActorAssets: async () => {} },
    './narrative-episode-plan': { ROOT: root, sha256: digest, stableJson: JSON.stringify,
      narrativePlanInputSha256: () => plan.inputSha256, validateNarrativeEpisodePlan: () => ({ valid: true }),
      verifyNarrativeEpisodeAssets: async () => {} },
    './hyperframes-video-renderer': { runCommand: async (_command, args, options) => {
      calls.push({ args, timeoutMs: options.timeoutMs });
      if (_command === 'fixture-ffmpeg') {
        await fs.writeFile(args.at(-1), Buffer.alloc(70 * 1024, args.at(-1).includes('portrait') ? 2 : 1));
      } else if (args[0] === 'bundle') {
        const directory = args.find(arg => arg.startsWith('--out-dir=')).slice(10);
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, 'index.html'), 'same bundle');
        now += 100;
      } else {
        const props = JSON.parse(await fs.readFile(args.find(arg => arg.startsWith('--props=')).slice(8), 'utf8'));
        now += 950;
        if (props.aspect === failingAspect) throw Object.assign(new Error('renderer stalled'), { code: 'HYPERFRAMES_TIMEOUT' });
        await fs.writeFile(args[3], Buffer.alloc(70 * 1024, props.aspect === 'portrait' ? 2 : 1));
      }
    } }
  };
  const sourcePath = path.resolve(__dirname, '../utils/narrative-episode-renderer.js');
  const localRequire = createRequire(sourcePath);
  const module = { exports: {} };
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(await fs.readFile(sourcePath, 'utf8'), {
    require: name => mocked[name] || localRequire(name), module, exports: module.exports,
    Buffer, Date: Clock, console, process: { env: {}, pid: process.pid, hrtime: process.hrtime }
  }, { filename: sourcePath });
  const renderer = new module.exports.NarrativeEpisodeRenderer({ timeoutMs: 1000, logger: { info() {}, warn() {} } });
  const outputPath = path.join(root, 'data/videos/episode.mp4');
  return { root, calls, outputPath, setFailure: aspect => { failingAspect = aspect; },
    run: () => renderer.renderEpisode({ plan, audioPath, outputPath }) };
}

test('a slow landscape cannot consume the portrait budget; a completed pair resumes by hash', async t => {
  const f = await fixture(t);
  const result = await f.run();
  assert.deepEqual(f.calls.filter(call => call.args[0] === 'render').map(call => call.timeoutMs), [1000, 1000]);
  assert.equal(result.landscape.durationSeconds, 2);
  assert.equal(result.portrait.durationSeconds, 2);
  const before = await fs.readFile(f.outputPath);
  f.calls.length = 0;
  await f.run();
  assert.equal(f.calls.filter(call => call.args[0] === 'render').length, 0);
  assert.deepEqual(await fs.readFile(f.outputPath), before);
});

test('portrait failure preserves the horizontal master and retries only the missing aspect', async t => {
  const f = await fixture(t);
  f.setFailure('portrait');
  await assert.rejects(f.run(), error => error.code === 'HYPERFRAMES_TIMEOUT');
  const before = await fs.readFile(f.outputPath);
  const state = JSON.parse(await fs.readFile(path.join(f.root, 'data/state/narrative-renders/recovery-test.json'), 'utf8'));
  assert(state.completed.landscape);
  assert.equal(state.completed.portrait, undefined);
  f.setFailure(null);
  f.calls.length = 0;
  await f.run();
  const rendered = f.calls.filter(call => call.args[0] === 'render');
  assert.equal(rendered.length, 1);
  assert.match(rendered[0].args[3], /portrait/);
  assert.equal(rendered[0].timeoutMs, 1000);
  assert.deepEqual(await fs.readFile(f.outputPath), before);
});

test('crash between master promotion and completion checkpoint is recovered without rendering again', async t => {
  const f = await fixture(t);
  await f.run();
  const file = path.join(f.root, 'data/state/narrative-renders/recovery-test.json');
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  state.promoting = { inputSha256: state.inputSha256, aspect: 'portrait', record: state.completed.portrait };
  delete state.completed.portrait;
  await fs.writeFile(file, JSON.stringify(state));
  f.calls.length = 0;
  await f.run();
  assert.equal(f.calls.filter(call => call.args[0] === 'render').length, 0);
  const recovered = JSON.parse(await fs.readFile(file, 'utf8'));
  assert(recovered.completed.portrait);
  assert.equal(recovered.promoting, undefined);
});
