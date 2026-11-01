const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {createHash} = require('node:crypto');
const {getFFmpegPath} = require('./ffmpeg');
const {resolveExecutable} = require('./resolve-executable');
const exec = promisify(execFile);

function normalizeMouthCues(data) {
  const duration = Number(data.metadata?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || !Array.isArray(data.mouthCues) || data.mouthCues.length > 30000) throw Error('Invalid phonetic timeline');
  let previousEnd = 0;
  const cues = data.mouthCues.map(cue => {
    const start = Number(cue.start), end = Number(cue.end), value = cue.value;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start < previousEnd - .001 || end <= start || end > duration + .02 || !/^[A-FX]$/.test(value)) throw Error('Invalid mouth cue');
    previousEnd = end;
    return {start, end, value};
  });
  if (!cues.length) throw Error('Empty phonetic timeline');
  return {version:1, recognizer:'phonetic', duration, cues};
}

async function extractSpeechVisemes(audioPath, options = {}) {
  const requestedBinary = options.binary || process.env.PULSO_RHUBARB_PATH || 'rhubarb';
  const binary = resolveExecutable(requestedBinary);
  if (!binary) throw new Error('Rhubarb não encontrado; configure PULSO_RHUBARB_PATH ou adicione rhubarb ao PATH');
  const threads = Math.max(1, Math.min(16, Math.floor(Number(options.threads) || 2)));
  const command = options.exec || exec;
  const sourceSha256 = createHash('sha256').update(await fs.readFile(audioPath)).digest('hex');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-visemes-'));
  try {
    const wav = path.join(dir, 'speech.wav');
    await command(options.ffmpegPath || getFFmpegPath(), ['-v','error','-y','-i',audioPath,'-vn','-ac','1','-ar','16000',wav], {timeout:30000, maxBuffer:65536, signal:options.signal});
    const {stdout} = await command(binary, ['-r','phonetic','-f','json','--extendedShapes','X','--threads',String(threads),'--quiet',wav], {timeout:180000, maxBuffer:2*1024*1024, signal:options.signal});
    return {...normalizeMouthCues(JSON.parse(stdout)), sourceSha256};
  } finally {
    await fs.rm(dir, {recursive:true, force:true});
  }
}

module.exports = {extractSpeechVisemes, normalizeMouthCues};
