'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { sceneRoi, sceneFreezeFilter } = require('./media-qa.cjs');

const demo = __dirname;
const root = path.resolve(demo, '../../..');
const benchmark = path.resolve(demo, '..');
const portrait = process.argv.includes('--portrait');
const board = require('./storyboard.json');
const output = path.join(benchmark, portrait ? 'outputs/parcel_delivery_vertical.mp4' : 'outputs/parcel_delivery.mp4');
const reports = path.join(demo, portrait ? 'reports/portrait' : 'reports/landscape');
const framesDir = path.join(demo, portrait ? 'review_frames/portrait' : 'review_frames/landscape');
const fps = 30;
const frameCount = board.durationInFrames;
const sampleSeconds = [3, 9, 16, 24, 31, 37, 41, 48, 53];
const pipelineStarted = Date.now();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} exited ${result.status}:\n${result.stderr || result.stdout}`);
  }
  return { stdout: result.stdout || '', stderr: result.stderr || '' };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function ratio(value) {
  const [numerator, denominator] = String(value).split('/').map(Number);
  return denominator ? numerator / denominator : numerator;
}

function render() {
  const guard = path.join(benchmark, 'shared/guard.cjs');
  const remotion = path.join(benchmark, 'node_modules/.bin/remotion');
  const entry = path.join(demo, 'index.jsx');
  const config = path.join(benchmark, 'remotion.config.js');
  const publicDir = path.join(demo, 'public');
  const renderStarted = Date.now();
  const args = [
    guard, remotion, 'render', entry, portrait ? 'ParcelPortrait' : 'ParcelLandscape', output,
    `--config=${config}`, `--public-dir=${publicDir}`, '--gl=angle',
    '--concurrency=1', '--codec=h264', '--crf=19', '--x264-preset=medium',
    '--enforce-audio-track', '--overwrite', '--log=info',
  ];
  run(process.execPath, args, { stdio: 'inherit', encoding: undefined });
  const renderFinished = Date.now();
  return {
    renderStartedAt: new Date(renderStarted).toISOString(),
    renderFinishedAt: new Date(renderFinished).toISOString(),
    renderSeconds: (renderFinished - renderStarted) / 1000,
  };
}

function validate(renderTiming, preparedAt, previousReport = null) {
  fs.mkdirSync(reports, { recursive: true });
  fs.mkdirSync(framesDir, { recursive: true });
  if (!fs.existsSync(output) || fs.statSync(output).size < 1_000_000) {
    throw new Error('O MP4 final não existe ou ficou pequeno demais para ser válido.');
  }

  const probeText = run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]).stdout;
  const probe = JSON.parse(probeText);
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  const problems = [];
  if (!video || video.codec_name !== 'h264') problems.push('vídeo H.264 ausente');
  if (video && (video.width !== (portrait ? 1080 : 1920) || video.height !== (portrait ? 1920 : 1080))) problems.push('resolução inesperada');
  if (video && ratio(video.avg_frame_rate) !== fps) problems.push('fps inesperado');
  if (video && Number(video.nb_frames) !== frameCount) problems.push('contagem de frames inesperada');
  if (Math.abs(duration - board.durationSeconds) > 0.1) problems.push('duração fora do storyboard ± 0,1 s');
  if (!audio || audio.codec_name !== 'aac') problems.push('trilha AAC ausente');
  if (audio && Math.abs(Number(audio.duration) - duration) > 0.1) problems.push('duração do áudio difere do vídeo');

  run('ffmpeg', ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-']);
  const blackScan = run('ffmpeg', ['-hide_banner', '-i', output, '-vf', 'blackdetect=d=0.1:pix_th=0.08', '-an', '-f', 'null', '-']);
  const blackSegments = `${blackScan.stdout}\n${blackScan.stderr}`.match(/black_start:[^\r\n]*/g) || [];
  if (blackSegments.length) problems.push(`detectados ${blackSegments.length} segmentos pretos`);
  const freezeScan = run('ffmpeg', ['-hide_banner', '-i', output, '-vf', sceneFreezeFilter(portrait), '-an', '-f', 'null', '-']);
  const freezeSegments = `${freezeScan.stdout}\n${freezeScan.stderr}`.match(/freeze_start:[^\r\n]*/g) || [];
  if (freezeSegments.length) problems.push(`detectados ${freezeSegments.length} trechos congelados com 3 s ou mais`);
  const volume = run('ffmpeg', ['-hide_banner', '-i', output, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-']);
  const volumeText = `${volume.stdout}\n${volume.stderr}`;
  const meanVolume = Number(volumeText.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1]);
  if (!Number.isFinite(meanVolume) || meanVolume < -55) problems.push('áudio ausente ou quase silencioso');

  const frameFiles = [];
  for (const seconds of sampleSeconds) {
    const framePath = path.join(framesDir, `frame-${String(seconds).padStart(2, '0')}.png`);
    run('ffmpeg', ['-y', '-v', 'error', '-ss', String(seconds), '-i', output, '-frames:v', '1', framePath]);
    frameFiles.push(path.relative(demo, framePath));
  }
  const select = sampleSeconds.map((seconds) => `eq(n\\,${seconds * fps})`).join('+');
  const contactSheet = path.join(demo, portrait ? 'review-contact-sheet-portrait.png' : 'review-contact-sheet.png');
  run('ffmpeg', [
    '-y', '-v', 'error', '-i', output,
    '-vf', `select='${select}',scale=${portrait ? '270:480' : '640:360'},tile=3x3`,
    '-frames:v', '1', '-update', '1', contactSheet,
  ]);

  const report = {
    ...renderTiming,
    status: problems.length ? 'failed' : 'passed',
    startedAt: previousReport?.startedAt ?? new Date(pipelineStarted).toISOString(),
    preparedAt: previousReport?.preparedAt ?? preparedAt,
    completedAt: new Date().toISOString(),
    pipelineSeconds: previousReport?.pipelineSeconds ?? (Date.now() - pipelineStarted) / 1000,
    ...(previousReport ? { validationRerunAt: new Date().toISOString() } : {}),
    output: path.relative(root, output),
    outputBytes: fs.statSync(output).size,
    sha256: sha256(output),
    media: {
      durationSeconds: duration,
      width: video?.width,
      height: video?.height,
      fps: video ? ratio(video.avg_frame_rate) : null,
      frames: Number(video?.nb_frames),
      videoCodec: video?.codec_name,
      audioCodec: audio?.codec_name,
      audioDurationSeconds: Number(audio?.duration),
      audioMeanVolumeDb: meanVolume,
    },
    checks: {
      fullDecode: 'passed',
      blackFrames: blackSegments.length ? 'failed' : 'passed',
      frozenSegments: freezeSegments.length ? 'failed' : 'passed',
      freezeScan: {region:sceneRoi(portrait),noiseDb:-80,minimumSeconds:3,scope:'scene viewport; presenter and captions cannot hide a frozen scene'},
      voicePresent: Number.isFinite(meanVolume) && meanVolume >= -55 ? 'passed' : 'failed',
      visualFrameSamples: frameFiles,
      contactSheet: path.relative(demo, contactSheet),
      visualReview: {status:'pending', note:'technical scans do not approve human anatomy, contact, continuity or framing'},
      warnings: [
        'React Three Fiber 9.8.2 uses the deprecated THREE.Clock API with Three.js r187; animation is frame-driven and does not read wall-clock time.',
      ],
    },
    problems,
  };
  fs.writeFileSync(path.join(reports, 'render-qa.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (problems.length) throw new Error(`QA do MP4 falhou: ${problems.join('; ')}`);
  console.log(JSON.stringify({ qa: report.status, output: report.output, durationSeconds: duration, renderSeconds: report.renderSeconds, pipelineSeconds: report.pipelineSeconds, sha256: report.sha256 }));
}

function main() {
  const reportPath = path.join(reports, 'render-qa.json');
  if (process.argv.includes('--qa-only')) {
    if (!fs.existsSync(reportPath)) throw new Error('Não existe relatório anterior para atualizar; faça o render completo.');
    const previous = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    validate(previous, previous.preparedAt, previous);
    return;
  }
  run(process.execPath, [path.join(demo, 'staging-qa.cjs')], { stdio: 'inherit', encoding: undefined });
  run(process.execPath, [path.join(demo, 'prepare.cjs')], { stdio: 'inherit', encoding: undefined });
  const preparedAt = new Date().toISOString();
  const timing = render();
  validate(timing, preparedAt);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}
