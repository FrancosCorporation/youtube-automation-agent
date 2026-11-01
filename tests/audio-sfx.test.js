const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');

const { ASSETS, buildAssets, checkAssets } = require('../scripts/generate-sfx-assets');
const { buildSfxEvents, loadSfxLibrary, mixdownAudio, MUSIC_GAIN, MAX_MUSIC_GAIN, musicCreditUsed } = require('../utils/audio-mix');
const { createCompositionHtml } = require('../utils/hyperframes-video-renderer');
const { getFFmpegPath, getMediaDuration } = require('../utils/ffmpeg');

test('SFX procedural assets are deterministic and carry per-file provenance', () => {
  const firstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-sfx-first-'));
  const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-sfx-second-'));
  try {
    const first = buildAssets(firstDir);
    const second = buildAssets(secondDir);
    assert.equal(first.assets.length, 3);
    assert.equal(checkAssets(firstDir), 3);
    for (const asset of ASSETS) {
      const firstBytes = fs.readFileSync(path.join(firstDir, asset.file));
      const secondBytes = fs.readFileSync(path.join(secondDir, asset.file));
      assert.deepEqual(firstBytes, secondBytes);
      const digest = crypto.createHash('sha256').update(firstBytes).digest('hex');
      assert.equal(first.assets.find(item => item.file === asset.file).sha256, digest);
      assert.equal(second.assets.find(item => item.file === asset.file).sha256, digest);
      const record = first.assets.find(item => item.file === asset.file);
      assert.equal(record.source, 'original-procedural');
      assert.match(record.rights, /no third-party source or license/);
      assert.ok(record.attribution);
    }
    assert.match(fs.readFileSync(path.join(firstDir, 'ATTRIBUTION.md'), 'utf8'), /No outside attribution is required/);
  } finally {
    fs.rmSync(firstDir, { recursive: true, force: true });
    fs.rmSync(secondDir, { recursive: true, force: true });
  }
});

test('composition keeps one seekable audio element for the baked master', () => {
  const composition = createCompositionHtml({
    width: 1280,
    height: 720,
    fps: 24,
    duration: 5,
    scenes: [],
    imageAssets: [],
    audioFile: 'assets/mix-with-sfx.m4a',
    robotConfig: { seed: 0, script: {}, speechEnvelope: {} },
    kitCss: '',
    kitJs: ''
  });
  assert.equal((composition.html.match(/<audio\b/g) || []).length, 1);
  assert.match(composition.html, /id="narration"[^>]+src="assets\/mix-with-sfx\.m4a"/);
});

test('SFX loader and asset checker reject manifests without source and rights metadata', () => {
  const sfxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-sfx-provenance-'));
  try {
    buildAssets(sfxRoot);
    assert.equal(Object.keys(loadSfxLibrary(sfxRoot)).length, 3);

    const manifestPath = path.join(sfxRoot, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.assets[0].attribution = '';
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    assert.equal(Object.keys(loadSfxLibrary(sfxRoot)).length, 2);
    assert.throws(() => checkAssets(sfxRoot), /sem procedência/);

    manifest.assets = {};
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.deepEqual(loadSfxLibrary(sfxRoot), {});
    assert.throws(() => checkAssets(sfxRoot), /sem versão ou procedência/);
  } finally {
    fs.rmSync(sfxRoot, { recursive: true, force: true });
  }
});

test('SFX cues are sparse, semantic, deterministic, and can be disabled', () => {
  const scenes = [
    { groupKind: 'hook', groupTitle: 'Abertura', durationMs: 6000, components: [{ type: 'demo-header' }] },
    { groupKind: 'section', groupTitle: 'Primeiro tema', durationMs: 4000, components: [{ type: 'demo-header' }, { type: 'kinetic-number', revealAtMs: 300 }] },
    { groupKind: 'section', groupTitle: 'Primeiro tema', durationMs: 4000, components: [{ type: 'demo-header' }, { type: 'kinetic-number', revealAtMs: 100 }] },
    { groupKind: 'section', groupTitle: 'Primeiro tema', durationMs: 4000, components: [{ type: 'demo-header' }, { type: 'news-card', revealAtMs: 400 }] },
    { groupKind: 'section', groupTitle: 'Segundo tema', durationMs: 5000, components: [{ type: 'demo-header' }, { type: 'compare-table', revealAtMs: 250 }] },
    { groupKind: 'conclusion', groupTitle: 'Conclusão', durationMs: 3000, components: [{ type: 'demo-header' }] }
  ];
  const cues = buildSfxEvents(scenes);
  assert.deepEqual(cues, buildSfxEvents(scenes));
  assert.equal(cues[0].kind, 'whoosh');
  assert.equal(cues[0].startMs, 6000);
  assert.ok(cues.some(cue => cue.kind === 'tick'));
  assert.ok(cues.some(cue => cue.kind === 'pop'));
  assert.ok(cues.every((cue, index) => index === 0 || cue.startMs - cues[index - 1].startMs >= 2800));
  assert.deepEqual(buildSfxEvents(scenes, { enabled: false }), []);
});

test('narrative section transitions retain sparse SFX when visual components are minimal', () => {
  const scenes = [
    { groupKind: 'section', groupTitle: 'Início', durationMs: 4000, minimal: true, components: [{ type: 'demo-header' }] },
    { groupKind: 'section', groupTitle: 'Início', durationMs: 4000, minimal: true, components: [{ type: 'demo-header' }] },
    { groupKind: 'section', groupTitle: 'Exercício', durationMs: 4000, minimal: true, components: [{ type: 'demo-header' }] },
    { groupKind: 'section', groupTitle: 'Exercício', durationMs: 4000, minimal: true, components: [{ type: 'demo-header' }] },
    { groupKind: 'section', groupTitle: 'Conclusão', durationMs: 4000, minimal: true, components: [{ type: 'demo-header' }] }
  ];
  const cues = buildSfxEvents(scenes);

  assert.deepEqual(cues.map(({ kind, startMs }) => ({ kind, startMs })), [
    { kind: 'whoosh', startMs: 8000 },
    { kind: 'whoosh', startMs: 16000 }
  ]);
  assert.ok(cues.every((cue, index) => index === 0 || cue.startMs - cues[index - 1].startMs >= 2800));
});

test('visual SFX cues outside their scene duration are dropped instead of spilling into the next scene', () => {
  const scenes = [
    { groupKind: 'section', groupTitle: 'Primeiro tema', durationMs: 6000, components: [{ type: 'kinetic-number', revealAtMs: 1000 }] },
    { groupKind: 'section', groupTitle: 'Segundo tema', durationMs: 4000, components: [{ type: 'news-card', revealAtMs: 5000 }] }
  ];

  assert.deepEqual(buildSfxEvents(scenes).map(({ kind, startMs }) => ({ kind, startMs })), [
    { kind: 'tick', startMs: 1000 },
    { kind: 'whoosh', startMs: 6000 }
  ]);
});

test('mixdown bakes timed SFX into the single audio master without clipping', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-sfx-mix-'));
  try {
    const sfxRoot = path.join(workDir, 'sfx');
    buildAssets(sfxRoot);
    const narration = path.join(workDir, 'narration.wav');
    execFileSync(getFFmpegPath(), [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5',
      '-c:a', 'pcm_s16le', narration
    ], { stdio: 'ignore' });
    const { path: outputPath, sfxEvents } = await mixdownAudio({
      narrationPath: narration,
      mood: 'curious',
      seed: 7,
      workDir,
      sfxRoot,
      includeMusic: false,
      sfxEvents: [
        { kind: 'whoosh', startMs: 1200 },
        { kind: 'tick', startMs: 2800 },
        { kind: 'pop', startMs: 4100 }
      ]
    });
    assert.equal(sfxEvents, 3);
    assert.ok(fs.statSync(outputPath).size > 1000);
    const probe = spawnSync(getFFmpegPath(), [
      '-hide_banner', '-i', outputPath, '-af', 'volumedetect', '-f', 'null', '-'
    ], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
    assert.equal(probe.status, 0, probe.stderr);
    const duration = await getMediaDuration(outputPath);
    const maxVolume = Number(probe.stderr.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]);
    assert.ok(duration >= 4.9 && duration <= 5.1, `duração inesperada: ${duration}`);
    assert.ok(Number.isFinite(maxVolume) && maxVolume <= -0.5, `pico inesperado: ${maxVolume} dBFS`);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('background music is original, has no third-party license, and stays at or below ten percent', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-original-bgm-'));
  try {
    const narration = path.join(workDir, 'voice.wav');
    execFileSync(getFFmpegPath(), [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
      '-c:a', 'pcm_s16le', narration
    ], { stdio: 'ignore' });
    const mixed = await mixdownAudio({ narrationPath: narration, mood: 'curious', workDir });
    assert.equal(MUSIC_GAIN, MAX_MUSIC_GAIN);
    assert.equal(MAX_MUSIC_GAIN, 0.10);
    assert.equal(musicCreditUsed(), false);
    assert.match(mixed.music, /pulso-original-ambient\.wav$/);
    assert.ok(fs.statSync(mixed.music).size > 1000);
    assert.ok(fs.statSync(mixed.path).size > 1000);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
