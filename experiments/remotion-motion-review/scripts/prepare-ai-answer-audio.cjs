const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
process.env.BGM_GAIN = '0.045';
const { mixdownAudio } = require('../../../utils/audio-mix');
const project = path.resolve(__dirname, '..');
const assets = path.join(project, 'public/ia-answer-20261023');
const workDir = path.join(project, 'renders/ia-answer-20261023/audio');
const timeline = JSON.parse(fs.readFileSync(path.join(assets, 'timeline.json'), 'utf8'));
(async () => {
  fs.mkdirSync(workDir, { recursive: true });
  const sfxEvents = timeline.chapters.flatMap((chapter, index) => [
    { kind: 'whoosh', startMs: chapter.startSeconds * 1000 + 100 },
    { kind: index === 5 ? 'pop' : 'tick', startMs: (chapter.startSeconds + chapter.sentences[6].startSeconds) * 1000 },
  ]);
  const mixed = await mixdownAudio({ narrationPath: path.join(assets, 'narration.wav'), workDir, includeMusic: true, sfxEvents });
  const output = path.join(assets, 'mix.m4a');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mixed.path, '-af', `aformat=channel_layouts=stereo,afade=t=in:d=0.1,afade=t=out:st=${timeline.durationSeconds - 1.25}:d=1.25,loudnorm=I=-14:TP=-2:LRA=11`, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', output]);
  const analysis = spawnSync('ffmpeg', ['-hide_banner', '-i', output, '-af', 'loudnorm=I=-14:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  if (analysis.status !== 0) throw new Error('Audio loudness measurement failed');
  const loudness = JSON.parse(analysis.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/s)[0]);
  const record = { createdAt: new Date().toISOString(), musicGain: .045, musicOriginal: true, sfxEvents, output, sha256: createHash('sha256').update(fs.readFileSync(output)).digest('hex'), durationSeconds: timeline.durationSeconds, voiceTimingUnchanged: true, loudness };
  fs.writeFileSync(path.join(workDir, 'mix-record.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ output, durationSeconds: timeline.durationSeconds, sha256: record.sha256 }));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
