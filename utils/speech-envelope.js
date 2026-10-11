const { spawn } = require('child_process');
const { getFFmpegPath } = require('./ffmpeg');

const DEFAULTS = Object.freeze({ sampleRate: 16000, stepMs: 10, gateDb: -42, fullOpenDb: -12, curve: 1.7 });

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Decode the narration to short-time RMS levels for deterministic lip motion.
 * Silence is gated before the values reach the renderer, so the mouth closes
 * on actual audio pauses even when a caption remains on screen.
 */
function extractSpeechEnvelope(audioPath, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const child = spawn(getFFmpegPath(), [
    '-hide_banner', '-loglevel', 'error', '-i', audioPath,
    '-vn', '-ac', '1', '-ar', String(settings.sampleRate), '-f', 's16le', 'pipe:1'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  let stderr = '';
  let settled = false;

  return new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`FFmpeg não conseguiu analisar a narração (${code}): ${stderr.trim()}`));
        return;
      }

      const pcm = Buffer.concat(chunks);
      const bytesPerStep = Math.max(2, Math.round(settings.sampleRate * settings.stepMs / 1000) * 2);
      const levels = [];
      for (let start = 0; start + 1 < pcm.length; start += bytesPerStep) {
        const end = Math.min(pcm.length - 1, start + bytesPerStep);
        let sumSquares = 0;
        let sampleCount = 0;
        for (let offset = start; offset <= end - 1; offset += 2) {
          const sample = pcm.readInt16LE(offset) / 32768;
          sumSquares += sample * sample;
          sampleCount += 1;
        }
        const rms = Math.sqrt(sumSquares / Math.max(1, sampleCount));
        const db = 20 * Math.log10(Math.max(rms, 1e-8));
        if (db <= settings.gateDb) {
          levels.push(0);
          continue;
        }
        const normalized = clamp((db - settings.gateDb) / (settings.fullOpenDb - settings.gateDb), 0, 1);
        levels.push(Number(Math.pow(normalized, settings.curve).toFixed(4)));
      }

      resolve({
        stepMs: settings.stepMs,
        levels,
        gateDb: settings.gateDb,
        fullOpenDb: settings.fullOpenDb,
        sampleRate: settings.sampleRate
      });
    });
  });
}

module.exports = { extractSpeechEnvelope, DEFAULTS };
