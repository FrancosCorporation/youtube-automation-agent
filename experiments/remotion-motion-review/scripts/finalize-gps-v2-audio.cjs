const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'renders/gps-v2-review');
const audio = path.join(root, 'public/gps-explainer/mix-v2.m4a');
const videoHash = (file) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-c:v', 'copy', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' }).trim();
const report = { finalizedAt: new Date().toISOString(), audio, method: 'Mux normalized stereo AAC while copying the verified H.264 stream unchanged', masters: [] };
for (const aspect of ['landscape', 'portrait']) {
  const file = path.join(output, `gps-explainer-v2-${aspect}.mp4`);
  const original = path.join(output, `gps-explainer-v2-${aspect}-before-audio-finalization.mp4`);
  assert.ok(!fs.existsSync(original), 'Original export already preserved; do not finalize twice');
  const before = videoHash(file);
  const temp = path.join(output, `gps-explainer-v2-${aspect}-finalizing.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-t', String(892 / 24), '-movflags', '+faststart', temp], { stdio: 'pipe' });
  assert.equal(videoHash(temp), before, 'Audio finalization must preserve every video packet');
  const measurement = spawnSync('ffmpeg', ['-hide_banner', '-i', temp, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(measurement.status, 0);
  const loudness = JSON.parse(measurement.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)[0]);
  assert.ok(Number(loudness.input_i) >= -16 && Number(loudness.input_i) <= -13);
  assert.ok(Number(loudness.input_tp) <= -1.5);
  fs.renameSync(file, original);
  fs.renameSync(temp, file);
  report.masters.push({ aspect, original, file, videoStreamHash: before, videoStreamUnchanged: true, integratedLUFS: Number(loudness.input_i), truePeakDbTP: Number(loudness.input_tp), loudnessRange: Number(loudness.input_lra) });
}
fs.writeFileSync(path.join(output, 'audio/finalization.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
