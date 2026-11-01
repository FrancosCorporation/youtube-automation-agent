const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const project = path.resolve(__dirname, '..');
const output = path.join(project, 'renders/ia-answer-20261023');
const timeline = require('../public/ia-answer-20261023/timeline.json');
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = args => execFileSync('ffmpeg', ['-v', 'error', ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const probe = file => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
const videoHash = file => run(['-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'hash', '-hash', 'sha256', '-']).trim();
const audioHash = file => run(['-i', file, '-map', '0:a:0', '-c:a', 'pcm_s16le', '-f', 'hash', '-hash', 'sha256', '-']).trim();
const mix = path.join(project, 'public/ia-answer-20261023/mix.m4a');
const record = { processedAt: new Date().toISOString(), method: 'Preserve H264 packets, mux the same measured stereo AAC, and encode six exact chapter cuts from the vertical master.', masters: [], cuts: [] };
fs.mkdirSync(path.join(output, 'cuts'), { recursive: true });
for (const aspect of ['landscape', 'portrait']) {
  const file = path.join(output, `ai-answer-${aspect}.mp4`);
  const original = path.join(output, `ai-answer-${aspect}-rendered.mp4`);
  if (!fs.existsSync(original)) fs.renameSync(file, original);
  const before = videoHash(original);
  const temporary = path.join(output, `ai-answer-${aspect}-audio-finalizing.mp4`);
  run(['-y', '-i', original, '-i', mix, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-t', String(timeline.durationSeconds), '-movflags', '+faststart', temporary]);
  if (before !== videoHash(temporary)) throw new Error('Finalization changed the video stream');
  fs.renameSync(temporary, file);
  record.masters.push({ aspect, file, sha256: sha(file), videoStreamUnchanged: true, videoStreamHash: before, audioPcmHash: audioHash(file) });
}
if (record.masters[0].audioPcmHash !== record.masters[1].audioPcmHash) throw new Error('Masters have different audio');
const portrait = record.masters.find(row => row.aspect === 'portrait').file;
for (const chapter of timeline.chapters) {
  const file = path.join(output, 'cuts', `parte-${String(chapter.index + 1).padStart(2, '0')}.mp4`);
  run(['-y', '-ss', chapter.startSeconds.toFixed(9), '-i', portrait, '-t', chapter.durationSeconds.toFixed(9), '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '2', '-pix_fmt', 'yuv420p', '-r', '24', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', file]);
  record.cuts.push({ part: chapter.index + 1, title: chapter.title, file, sha256: sha(file), startFrame: chapter.startFrame, expectedFrames: chapter.durationFrames, framesCoverEntireNarrative: true });
  console.log(JSON.stringify({ event: 'cut-created', part: chapter.index + 1, file }));
}
const technical = [];
for (const item of [...record.masters, ...record.cuts]) {
  const metadata = probe(item.file), video = metadata.streams.find(s => s.codec_type === 'video'), audio = metadata.streams.find(s => s.codec_type === 'audio');
  const isLandscape = item.aspect === 'landscape';
  if (video.codec_name !== 'h264' || audio.codec_name !== 'aac' || video.r_frame_rate !== '24/1' || video.width !== (isLandscape ? 1920 : 1080) || video.height !== (isLandscape ? 1080 : 1920) || Number(video.nb_frames) !== (item.expectedFrames || timeline.durationFrames)) throw new Error(`Technical mismatch: ${item.file}`);
  run(['-threads', '2', '-i', item.file, '-f', 'null', '-']);
  const result = spawnSync('ffmpeg', ['-hide_banner', '-i', item.file, '-af', 'loudnorm=I=-14:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Could not measure audio');
  const loudness = JSON.parse(result.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/s)[0]);
  if (Number(loudness.input_tp) > -1 || Number(loudness.input_i) < -17 || Number(loudness.input_i) > -12) throw new Error(`Loudness out of range: ${item.file}`);
  const samples = item.part ? [24, Math.floor(item.expectedFrames / 2), item.expectedFrames - 18]
    : timeline.chapters.flatMap(chapter => [0, 5, 9].map(beat => chapter.startFrame + Math.round((chapter.sentences[beat].startSeconds + 1.5) * 24)));
  const sampleDir = path.join(output, 'final-frames-indexed', path.basename(item.file, '.mp4'));
  fs.mkdirSync(sampleDir, { recursive: true });
  const pattern = path.join(sampleDir, 'sample-%02d.jpg');
  const select = samples.map(frame => `eq(n\\,${frame})`).join('+');
  run(['-y', '-i', item.file, '-vf', `select=${select}`, '-fps_mode', 'passthrough', '-q:v', '2', pattern]);
  const extracted = fs.readdirSync(sampleDir).filter(name => /^sample-\d+\.jpg$/.test(name)).sort();
  if (extracted.length !== samples.length) throw new Error(`Could not extract exact visual sample frames: ${item.file}`);
  extracted.forEach((name, index) => fs.renameSync(path.join(sampleDir, name),
    path.join(sampleDir, `frame-${String(samples[index]).padStart(5, '0')}.jpg`)));
  technical.push({ ...item, bytes: fs.statSync(item.file).size, width: video.width, height: video.height, fps: 24, frames: Number(video.nb_frames), durationSeconds: Number(metadata.format.duration), fullDecodePassed: true, loudness, sampledFrames: samples, sampleDir });
  console.log(JSON.stringify({ event: 'technical-qa-pass', file: item.file, durationSeconds: Number(metadata.format.duration), loudness: loudness.input_i }));
}
record.technical = technical;
record.visualReview = 'pending';
record.coverage = { chapters: 6, totalCutFrames: record.cuts.reduce((total, cut) => total + cut.expectedFrames, 0), masterFrames: timeline.durationFrames };
if (record.coverage.totalCutFrames !== timeline.durationFrames) throw new Error('Cuts do not cover the entire narrative');
fs.writeFileSync(path.join(output, 'technical-qa.json'), JSON.stringify(record, null, 2) + '\n');
console.log('Eight videos passed technical QA; final visual review is still required');
