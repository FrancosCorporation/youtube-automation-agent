'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildCheckArgs,
  buildRenderArgs,
  buildPresenterGestureBeats,
  selectCaptureProfile,
  createCompositionHtml,
  HYPERFRAMES_VERSION,
  runCommand,
  preserveRenderFailure,
  buildScenePlanEvidence,
  assertSafeVisualRebuildOutput,
  commitRenderedOutput
} = require('../utils/hyperframes-video-renderer');
const { buildNarrativeGestureCues } = require('../utils/remotion-story-video-renderer');

const shared = {
  workDir: '/tmp/hyperframes-preview',
  outputPath: '/tmp/instagram-part.mp4',
  fps: 30,
  width: 1080,
  height: 1920
};

test('visual rebuild rejects the source master and every pre-existing output without overwriting', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'hyperframes-visual-rebuild-'));
  const sourcePath = path.join(root, 'source.mp4');
  const existingPath = path.join(root, 'existing.mp4');
  const sourceAliasPath = path.join(root, 'source-alias.mp4');
  const renderedPath = path.join(root, 'rendered.mp4');
  const newPath = path.join(root, 'new-rebuild.mp4');
  await fsp.writeFile(sourcePath, 'rejected source');
  await fsp.writeFile(existingPath, 'keep existing');
  await fsp.writeFile(renderedPath, 'rebuilt render');
  await fsp.symlink(sourcePath, sourceAliasPath);
  try {
    await assert.rejects(assertSafeVisualRebuildOutput(sourcePath, sourcePath), error =>
      error.code === 'VISUAL_REBUILD_OUTPUT_IS_SOURCE');
    await assert.rejects(assertSafeVisualRebuildOutput(sourceAliasPath, sourcePath), error =>
      error.code === 'VISUAL_REBUILD_OUTPUT_IS_SOURCE');
    await assert.rejects(assertSafeVisualRebuildOutput(existingPath, sourcePath), error =>
      error.code === 'VISUAL_REBUILD_OUTPUT_EXISTS');
    await assert.rejects(commitRenderedOutput(renderedPath, existingPath, true), error => error.code === 'EEXIST');
    assert.equal(await fsp.readFile(existingPath, 'utf8'), 'keep existing');
    assert.equal(await assertSafeVisualRebuildOutput(newPath, sourcePath), newPath);
    await commitRenderedOutput(renderedPath, newPath, true);
    assert.equal(await fsp.readFile(newPath, 'utf8'), 'rebuilt render');
    await assert.rejects(fsp.access(renderedPath), error => error.code === 'ENOENT');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
const sceneKitDir = path.join(__dirname, '..', 'assets', 'scenes');

test('scene-plan evidence fingerprints the render plan and rejects unstable IDs', () => {
  const scenes = [{ id: 's0_0', durationMs: 1500, components: [{ type: 'bento-card', title: 'Contexto' }] }];
  const evidence = buildScenePlanEvidence(scenes);
  assert.deepEqual(evidence.sceneIds, ['s0_0']);
  assert.match(evidence.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(buildScenePlanEvidence(scenes), evidence);
  assert.throws(() => buildScenePlanEvidence([{ id: 'bad id' }]), /invalid or duplicate/);
  assert.throws(() => buildScenePlanEvidence([{ id: 's0_0' }, { id: 's0_0' }]), /invalid or duplicate/);
});

test('production uses the local Remotion renderer while pilot commands use their validated HyperFrames pin', () => {
  const pilotDir = path.join(__dirname, '..', 'experiments', 'hyperframes-pulso-pilot');
  const pilotPackage = JSON.parse(fs.readFileSync(path.join(pilotDir, 'package.json'), 'utf8'));
  const makeVideo = fs.readFileSync(path.join(pilotDir, 'scripts', 'make-video.js'), 'utf8');
  const generator = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'generate-animated-video.js'), 'utf8');
  const scriptPins = Object.values(pilotPackage.scripts).join('\n').match(/hyperframes@([\d.]+)/g) || [];

  assert(scriptPins.length > 0);
  assert.match(generator, /new NarrativeEpisodeRenderer\(/);
  assert.match(generator, /remotion-4\.0\.537-narrative-episode-v2-approved-robot/);
  const pilotPins = [...new Set(scriptPins)];
  assert.equal(pilotPins.length, 1);
  assert.equal(pilotPins[0], 'hyperframes@0.8.185');
  assert.match(makeVideo, new RegExp(`${pilotPins[0].replaceAll('.', '\\.')}\\b`));
  assert.equal(HYPERFRAMES_VERSION, '0.8.185');
});

test('production composites the approved 3D rig through Remotion instead of the procedural pilot robot', () => {
  const pilotDir = path.join(__dirname, '..', 'experiments', 'hyperframes-pulso-pilot');
  const builder = fs.readFileSync(path.join(pilotDir, 'scripts', 'build-production-presenter.js'), 'utf8');
  const presenter = fs.readFileSync(path.join(pilotDir, 'src', 'production-presenter.js'), 'utf8');
  const pilotBuilder = fs.readFileSync(path.join(pilotDir, 'scripts', 'build-pilot.js'), 'utf8');
  const pilotHtml = fs.readFileSync(path.join(pilotDir, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'utils', 'hyperframes-video-renderer.js'), 'utf8');
  const remotionRenderer = fs.readFileSync(path.join(__dirname, '..', 'utils', 'remotion-story-video-renderer.js'), 'utf8');
  const productionGenerator = fs.readFileSync(path.join(__dirname, '..', 'utils', 'ai-video-generator.js'), 'utf8');

  assert.match(builder, /src\/production-presenter\.js/);
  assert.match(presenter, /sampleViseme\(mouthCueTrack, t, voiceLevel\)/);
  assert.match(pilotBuilder, /pulso-robot-approved-reference\.png/);
  assert.match(pilotHtml, /pulso-robot-approved-reference\.png/);
  assert.doesNotMatch(pilotHtml, /production-presenter\.js|three-layer/);
  assert.doesNotMatch(builder, /src\/production-presenter-bonito\.js/);
  assert.doesNotMatch(renderer, /pulso-robot\.glb/);
  assert.match(productionGenerator, /RemotionStoryVideoRenderer/);
  assert.match(remotionRenderer, /approved-robot-rigged\.glb/);
  assert.match(remotionRenderer, /includePresenter:\s*false/);
  assert.match(remotionRenderer, /NarrativeComposite/);
});

test('Remotion scene plates reserve matching presenter space and cut sides at story-group boundaries', () => {
  const composition = createCompositionHtml({
    width: 1920,
    height: 1080,
    fps: 24,
    duration: 4,
    scenes: [
      { id: 'hook', groupIndex: 0, groupKind: 'hook', durationMs: 2000, presenter: true, components: [] },
      { id: 'section', groupIndex: 1, groupKind: 'section', durationMs: 2000, presenter: true, components: [] }
    ],
    imageAssets: [],
    audioFile: 'assets/narration.m4a',
    robotConfig: { seed: 41, script: { theme: 'ia' }, speechEnvelope: { levels: [] }, mouthCues: [] },
    kitCss: '',
    kitJs: '',
    includePresenter: false
  });

  assert.doesNotMatch(composition.html, /<canvas id="three-layer"|production-presenter\.js/);
  assert.doesNotMatch(composition.assets['production-composition.js'], /seekPresenterRobot/);
  assert.deepEqual(composition.presenterPlan.map(scene => [scene.startMs, scene.side, scene.presenter]), [
    [0, 'left', true], [2000, 'right', true]
  ]);
  assert.match(composition.assets['production-data.js'], /"presenter":true/);
  assert.match(composition.assets['scene-kit.css'], /\.scene\.has-presenter/);
});

test('portrait Remotion presenter stays below the explanatory panel and above captions', () => {
  const compositePath = path.join(__dirname, '..', 'experiments', 'remotion-motion-review', 'src', 'NarrativeComposite.tsx');
  const composite = fs.readFileSync(compositePath, 'utf8');

  assert.match(composite, /width: Math\.round\(width \* 0\.52\), height: Math\.round\(height \* 0\.34\)/);
  assert.match(composite, /top: "54%", left: side === "left" \? "3%"/);
  assert.doesNotMatch(composite, /width: Math\.round\(width \* 0\.64\), height: Math\.round\(height \* 0\.62\)/);
});

test('production robot gesture cues describe generic story beats, not PulsoStory events', () => {
  const presenterPlan = [
    { startMs: 0, durationMs: 2000, presenter: true, hidden: false, groupKind: 'hook', groupIndex: 0 },
    ...Array.from({ length: 4 }, (_, index) => ({
      startMs: 2000 + index * 1500, durationMs: 1500, presenter: true, hidden: false,
      groupKind: 'section', groupIndex: index + 1
    })),
    { startMs: 8000, durationMs: 2000, presenter: true, hidden: false, groupKind: 'conclusion', groupIndex: 5 }
  ];
  const cues = buildNarrativeGestureCues(presenterPlan, 24, 10000);

  assert.deepEqual(Object.keys(cues), ['hook', 'explain', 'point', 'compare', 'emphasize', 'conclusion']);
  assert.equal(Object.values(cues).every(Number.isFinite), true);
});

test('production presenter gestures follow scene roles and explanatory graphics', () => {
  const scenes = [
    { durationMs: 1200, groupKind: 'hook', presenter: true, components: [] },
    { durationMs: 1400, groupKind: 'section', presenter: true, components: [{ type: 'progressive-comparison' }] },
    { durationMs: 1000, groupKind: 'section', presenter: true, components: [{ type: 'caption' }] },
    { durationMs: 1500, groupKind: 'section', presenter: true, components: [{ type: 'caption' }] },
    { durationMs: 600, groupKind: 'section', presenter: false, components: [{ type: 'node-graph' }] },
    { durationMs: 1100, groupKind: 'conclusion', presenter: true, components: [] }
  ];
  const starts = [];
  let cursorMs = 0;
  for (const scene of scenes) {
    starts.push({ startMs: cursorMs, durationMs: scene.durationMs });
    cursorMs += scene.durationMs;
  }

  assert.deepEqual(buildPresenterGestureBeats(scenes, starts), [
    { startSeconds: 0, endSeconds: 1.2, gesture: 'present' },
    { startSeconds: 1.2, endSeconds: 2.6, gesture: 'point' },
    { startSeconds: 2.6, endSeconds: 5.1, gesture: 'explain' },
    { startSeconds: 5.7, endSeconds: 6.8, gesture: 'present' }
  ]);
});

test('production composition passes derived gesture beats to the presenter runtime', () => {
  const composition = createCompositionHtml({
    width: 1920,
    height: 1080,
    fps: 24,
    duration: 2.5,
    scenes: [
      { id: 'hook', durationMs: 1000, groupKind: 'hook', presenter: true, components: [] },
      { id: 'comparison', durationMs: 1500, groupKind: 'section', presenter: true,
        components: [{ type: 'progressive-comparison' }] }
    ],
    imageAssets: [],
    audioFile: 'assets/narration.m4a',
    robotConfig: {
      seed: 41,
      script: { theme: 'ia' },
      mouthCues: { version: 1, duration: 2.5, cues: [{ start: 0, end: 0.2, value: 'B' }] }
    },
    kitCss: '',
    kitJs: ''
  });
  const dataJs = composition.assets['production-data.js'];
  const configStart = dataJs.indexOf('window.PULSO_ROBOT_CONFIG = ') + 'window.PULSO_ROBOT_CONFIG = '.length;
  const configEnd = dataJs.indexOf('; window.__timelines', configStart);
  const robotConfig = JSON.parse(dataJs.slice(configStart, configEnd));

  assert.deepEqual(robotConfig.gestureBeats, [
    { startSeconds: 0, endSeconds: 1, gesture: 'present' },
    { startSeconds: 1, endSeconds: 2.5, gesture: 'point' }
  ]);
  assert.deepEqual(robotConfig.mouthCues, {
    version: 1,
    duration: 2.5,
    cues: [{ start: 0, end: 0.2, value: 'B' }]
  });
});

test('portrait pilot keeps the full wide evidence reconstruction in frame', () => {
  const portrait = fs.readFileSync(path.join(__dirname, '..', 'experiments', 'hyperframes-pulso-pilot', 'variants', 'portrait', 'index.html'), 'utf8');
  const reconstruction = fs.readFileSync(path.join(__dirname, '..', 'experiments', 'hyperframes-pulso-pilot', 'variants', 'portrait', 'assets', 'tip-portal-reconstruction.svg'), 'utf8');
  const builder = fs.readFileSync(path.join(__dirname, '..', 'experiments', 'hyperframes-pulso-pilot', 'scripts', 'build-pilot.js'), 'utf8');

  assert.match(builder, /tip-portal-reconstruction-portrait\.svg/);
  assert.match(portrait, /html\[data-resolution="portrait"\] \.visual-card \{[^}]*width: 952px; height: 390px;/);
  assert.match(reconstruction, /width="952" height="390" viewBox="0 0 952 390"/);
  assert.match(reconstruction, /An anonymous tip was/);
  assert.match(reconstruction, /July 18, 2026/);
  assert.doesNotMatch(reconstruction, /23:27/);
});

test('renderer check lets HyperFrames probe for host browser GPU acceleration', () => {
  const args = buildCheckArgs(shared.workDir);

  assert.deepEqual(args, [
    '--yes', `hyperframes@${HYPERFRAMES_VERSION}`, 'check', '--timeout=15000', shared.workDir
  ]);
});

test('editorial header stays above the 3D canvas without lifting other scene content', () => {
  const composition = createCompositionHtml({
    width: 1920,
    height: 1080,
    fps: 24,
    duration: 10,
    scenes: [],
    imageAssets: [],
    audioFile: 'assets/narration.m4a',
    robotConfig: { seed: 41, script: { theme: 'ia' } },
    kitCss: '.scene > * { position: relative; z-index: 1; }',
    kitJs: ''
  });

  assert.match(composition.assets['scene-kit.css'], /#scene-root\s*\{[^}]*overflow:\s*hidden;[^}]*\}/);
  assert.doesNotMatch(composition.assets['scene-kit.css'], /#scene-root\s*\{[^}]*z-index:/);
  assert.match(composition.assets['scene-kit.css'], /#scene-root\s*>\s*\.scene\s*>\s*\.demo-header\s*\{\s*z-index:\s*6;\s*\}/);
  assert.match(composition.assets['scene-kit.css'], /#three-layer\s*\{[^}]*z-index:\s*5;/);
  assert.match(composition.assets['scene-kit.css'], /\.scene > \* \{ position: relative; z-index: 1; \}/);
});

test('narrative part indicator is mounted once outside the scene tree', () => {
  const composition = createCompositionHtml({
    width: 1080,
    height: 1920,
    fps: 30,
    duration: 10,
    scenes: [],
    imageAssets: [],
    audioFile: 'assets/narration.m4a',
    robotConfig: { seed: 41, script: { theme: 'ia', partIndicator: { index: 2, count: 2 } } },
    kitCss: fs.readFileSync(path.join(sceneKitDir, 'kit.css'), 'utf8'),
    kitJs: fs.readFileSync(path.join(sceneKitDir, 'kit.js'), 'utf8')
  });

  assert.match(composition.html, /<div class="part-indicator" aria-label="Parte 2 de 2">PARTE 2\/2<\/div>/);
  assert.equal((composition.html.match(/class="part-indicator"/g) || []).length, 1);
  assert.match(composition.assets['scene-kit.css'], /\.part-indicator\s*\{[^}]*z-index:\s*9;/,
    'the persistent root badge stays above the 3D canvas');
});

test('explanatory social clips do not render the part badge over the motion graphics', () => {
  const composition = createCompositionHtml({
    width: 1080,
    height: 1920,
    fps: 30,
    duration: 10,
    scenes: [],
    imageAssets: [],
    audioFile: 'assets/narration.m4a',
    robotConfig: { seed: 41, script: {
      theme: 'ia', explanatorySocial: true, partIndicator: { index: 2, count: 3 }
    } },
    kitCss: fs.readFileSync(path.join(sceneKitDir, 'kit.css'), 'utf8'),
    kitJs: fs.readFileSync(path.join(sceneKitDir, 'kit.js'), 'utf8')
  });

  assert.match(composition.html, /data-explanatory-social="true"/);
  assert.doesNotMatch(composition.html, /class="part-indicator"/);
});

test('portrait story images fill the frame with a subdued backdrop and preserve the full foreground image', () => {
  const kitCss = fs.readFileSync(path.join(sceneKitDir, 'kit.css'), 'utf8');
  const kitJs = fs.readFileSync(path.join(sceneKitDir, 'kit.js'), 'utf8');

  assert.match(kitJs, /if \(props\.fit === 'contain'\)\s*\{[\s\S]*?el\('div', 'img-hero-backdrop'\)/);
  assert.match(kitCss, /\.scene\.portrait-photo \.img-hero\.fitted-photo\s*\{[^}]*inset:\s*0;[^}]*height:\s*100%;/);
  assert.match(kitCss, /\.img-hero\.fitted-photo > \.img-hero-backdrop img\s*\{[^}]*object-fit:\s*cover;[^}]*filter:\s*blur\(/);
  assert.doesNotMatch(kitCss, /\.img-hero\.fitted-photo > \.img-hero-backdrop img\s*\{[^}]*transform:\s*scale\(/,
    'the blurred backdrop fills the frame without escaping the clipping container');
  assert.match(kitCss, /\.img-hero\.fitted-photo > img\s*\{[^}]*object-fit:\s*contain;/);
});

test('portrait kinetic metrics stack and fit long labels inside the frame', () => {
  const kitCss = fs.readFileSync(path.join(sceneKitDir, 'kit.css'), 'utf8');

  assert.match(kitCss, /@media \(max-aspect-ratio:\s*1\/1\)\s*\{[\s\S]*?\.scene \.kinetic\s*\{[^}]*flex-direction:\s*column;[^}]*align-items:\s*center;/);
  assert.match(kitCss, /\.scene \.kinetic \.num\s*\{[^}]*font-size:\s*calc\(var\(--h\) \* 0\.13\)/);
  assert.match(kitCss, /\.scene \.kinetic \.lbl\s*\{[^}]*max-width:\s*94%;[^}]*font-size:\s*calc\(var\(--h\) \* 0\.03\);[^}]*overflow-wrap:\s*anywhere;/);
});

test('long-form master does not receive a part indicator', () => {
  const composition = createCompositionHtml({
    width: 1920,
    height: 1080,
    fps: 24,
    duration: 10,
    scenes: [],
    imageAssets: [],
    audioFile: 'assets/narration.m4a',
    robotConfig: { seed: 41, script: { theme: 'ia' } },
    kitCss: '',
    kitJs: ''
  });

  assert.doesNotMatch(composition.html, /class="part-indicator"/);
});

test('portrait narrative captions with a progress bar use the clear band below the presenter', () => {
  const composition = createCompositionHtml({
    width: 1080,
    height: 1920,
    fps: 30,
    duration: 10,
    scenes: [],
    imageAssets: [],
    audioFile: 'assets/narration.m4a',
    robotConfig: { seed: 41, script: { theme: 'ia' } },
    kitCss: fs.readFileSync(path.join(sceneKitDir, 'kit.css'), 'utf8'),
    kitJs: fs.readFileSync(path.join(sceneKitDir, 'kit.js'), 'utf8')
  });

  assert.match(composition.assets['scene-kit.css'], /\.scene\.steady-narrative\.has-narrative-progress\s+\.caption\s*\{[^}]*bottom:\s*3%;/);
  assert.match(composition.assets['scene-kit.js'], /scene\.steadyNarrative\s*&&\s*\(scene\.components\s*\|\|\s*\[\]\)\.some\(component\s*=>\s*component\.type\s*===\s*'progress-bar'\)/);
  assert.match(composition.assets['scene-kit.js'], /root\.classList\.add\('has-narrative-progress'\)/);
});

test('CPU draft renders explicitly disable browser and encoder GPU flags', () => {
  const args = buildRenderArgs({ ...shared, quality: 'draft' });

  assert(args.includes('--quality=draft'));
  assert(args.includes('--no-browser-gpu'));
  assert.equal(args.includes('--browser-gpu'), false);
  assert.equal(args.includes('--gpu'), false);
  assert(args.includes('--resolution=portrait'));
});

test('GPU renders retain explicit GPU flags and default to production quality', () => {
  const args = buildRenderArgs({ ...shared, useGpu: true });

  assert(args.includes('--quality=high'));
  assert(args.includes('--browser-gpu'));
  assert(args.includes('--gpu'));
  assert.equal(args.includes('--no-browser-gpu'), false);
});

test('native capture keeps full HD quality and frame rate while allowing BeginFrame', () => {
  const args = buildRenderArgs({ ...shared, useGpu: true, captureProfile: 'native' });
  assert(args.includes('--fps=30'));
  assert(args.includes('--quality=high'));
  assert(args.includes('--workers=1'));
  assert(args.includes('--gpu'));
  assert(args.includes('--no-low-memory-mode'));
  assert(!args.some(value => value.startsWith('--resolution=')));
  assert(!args.includes('--browser-gpu'));
  assert.throws(() => buildRenderArgs({ ...shared, captureProfile: 'native' }), /exige GPU/);
});

test('automatic capture keeps the safe profile on CPU, low memory, unknown memory and custom sizes', () => {
  const gib = 1024 ** 3;
  const healthy = { useGpu: true, width: 1080, height: 1920, totalMemory: 30 * gib, freeMemory: 10 * gib };
  assert.equal(selectCaptureProfile(healthy), 'native');
  for (const override of [
    { requested: 'safe' }, { useGpu: false }, { totalMemory: 8 * gib },
    { freeMemory: 4 * gib }, { freeMemory: NaN }, { width: 720, height: 1280 }
  ]) assert.equal(selectCaptureProfile({ ...healthy, ...override }), 'safe');
  assert.throws(() => selectCaptureProfile({ requested: 'unsafe' }), /perfil de captura inválido/);
});

test('renderer rejects unsupported quality values before spawning HyperFrames', () => {
  assert.throws(() => buildRenderArgs({ ...shared, quality: 'ultra' }), /qualidade HyperFrames inválida/);
});

test('failed renderer stages retain a safe reason through the generation log', async () => {
  const { safeErrorTag } = require('../utils/safe-error-tag');
  const { generationFailureCodeFromLog } = require('../utils/generation-errors');
  for (const [label, expected] of [
    ['hyperframes-check', 'HYPERFRAMES_CHECK_FAILED'],
    ['robot-build', 'HYPERFRAMES_BUILD_FAILED'],
    ['hyperframes-render-gpu', 'HYPERFRAMES_RENDER_FAILED']
  ]) {
    await assert.rejects(runCommand(process.execPath, ['-e', "console.error('private provider response'); process.exit(2)"], {
      cwd: process.cwd(), env: process.env, logger: { info() {}, warn() {} }, label, timeoutMs: 5000
    }), error => {
      assert.equal(error.code, expected);
      assert.equal(error.exitCode, 2);
      assert.equal(error.stage, label);
      const log = `FALHA: geração interrompida ${safeErrorTag(error)}`;
      assert.doesNotMatch(log, /private|provider|response/);
      assert.equal(generationFailureCodeFromLog(log), expected.toLowerCase());
      return true;
    });
  }
});

test('renderer diagnostics survive temporary workspace cleanup without saving provider stderr', async t => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pulso-render-failure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workDir = path.join(root, 'work');
  const reportDir = path.join(workDir, '.hyperframes/artifacts/checks');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'check.json'), JSON.stringify({ layout: { errors: 12 } }));
  fs.symlinkSync('/etc/passwd', path.join(reportDir, 'unrelated.json'));
  const outputPath = path.join(root, 'master.mp4');
  const error = Object.assign(new Error('private provider response'), {
    code: 'HYPERFRAMES_CHECK_FAILED', stage: 'hyperframes-check', exitCode: 1
  });
  await preserveRenderFailure({ workDir, outputPath, error, logger: { warn() {} } });
  fs.rmSync(workDir, { recursive: true });
  const saved = fs.readFileSync(`${outputPath}.render-failure.json`, 'utf8');
  const diagnostic = JSON.parse(saved);
  assert.equal(diagnostic.code, error.code);
  assert.equal(diagnostic.stage, error.stage);
  assert.equal(diagnostic.exitCode, 1);
  assert.equal(diagnostic.checkReport.layout.errors, 12);
  assert.doesNotMatch(saved, /private|provider|response|root:x:/);
  assert.equal(fs.statSync(`${outputPath}.render-failure.json`).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(outputPath), false, 'diagnostics never fabricate a successful MP4');
  await preserveRenderFailure({ workDir, outputPath, error, logger: { warn() {} } });
  assert.equal(JSON.parse(fs.readFileSync(`${outputPath}.render-failure.json`)).checkReport, null,
    'a failure without a report replaces stale diagnostics with its own result');
});

test('resource monitor stops its child and reports the resource gate', async () => {
  let polls = 0;
  await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: process.cwd(), env: process.env, logger: { info() {}, warn() {} }, label: 'resource-monitor',
    timeoutMs: 5000, killGraceMs: 20, finalizeGraceMs: 1000, resourceCheckIntervalMs: 100,
    resourceCheck: () => ++polls >= 2 ? Object.assign(new Error('reserva baixa'), { code: 'HOST_RESOURCE_GATE' }) : null
  }), error => error.code === 'HOST_RESOURCE_GATE');
  assert.equal(polls >= 2, true);
});

test('renderer terminates a subprocess group that exceeds its deadline', async () => {
  const messages = [];
  const logger = {
    info: message => messages.push(message),
    warn: message => messages.push(message)
  };
  const childCode = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { detached: true, stdio: 'ignore' });",
    "process.stdout.write('detached_pid=' + child.pid + '\\n');",
    "process.on('SIGTERM', () => {});",
    'setInterval(() => {}, 1000);'
  ].join('\n');

  await assert.rejects(runCommand(process.execPath, ['-e', childCode], {
    cwd: process.cwd(),
    env: process.env,
    logger,
    label: 'test-renderer-timeout',
    // Leave enough startup time on a busy host so this test exercises cleanup
    // of a live detached process instead of racing the fixture launch.
    timeoutMs: 5000,
    killGraceMs: 50,
    finalizeGraceMs: 1000
  }), error => error.code === 'HYPERFRAMES_TIMEOUT');

  assert(messages.some(message => message.includes('encerrando o grupo do subprocesso')));
  const childPid = Number(messages.join('\n').match(/detached_pid=(\d+)/)?.[1]);
  assert(Number.isInteger(childPid) && childPid > 0, 'fixture started a detached descendant');
  const deadline = Date.now() + 2000;
  let descendantRunning = true;
  while (Date.now() < deadline) {
    try {
      const stat = require('node:fs').readFileSync(`/proc/${childPid}/stat`, 'utf8');
      descendantRunning = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[0] !== 'Z';
    } catch {
      descendantRunning = false;
    }
    if (!descendantRunning) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(descendantRunning, false, 'timeout leaves no detached browser-like child behind');
});
