#!/usr/bin/env node
/** Reproducible, original procedural SFX used by the narrated-video renderer. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SAMPLE_RATE = 48000;
const ASSETS = [
  { id: 'section-whoosh', file: 'section-whoosh.wav', durationMs: 460, recipe: 'downward tonal sweep with shaped deterministic noise' },
  { id: 'detail-tick', file: 'detail-tick.wav', durationMs: 130, recipe: 'short two-partial transient with exponential decay' },
  { id: 'visual-pop', file: 'visual-pop.wav', durationMs: 230, recipe: 'low descending sweep with a soft high-frequency transient' }
];

function seededNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0x80000000) - 1;
  };
}

function sampleAsset(asset) {
  const count = Math.round(SAMPLE_RATE * asset.durationMs / 1000);
  const samples = new Float32Array(count);
  const noise = seededNoise(asset.id.length * 7919);
  let phase = 0;
  let lowPass = 0;
  for (let i = 0; i < count; i += 1) {
    const t = i / SAMPLE_RATE;
    const p = i / Math.max(1, count - 1);
    let value = 0;
    if (asset.id === 'section-whoosh') {
      const frequency = 1450 - 1080 * p;
      phase += 2 * Math.PI * frequency / SAMPLE_RATE;
      const white = noise();
      lowPass += 0.20 * (white - lowPass);
      const airyNoise = white - lowPass;
      const envelope = Math.sin(Math.PI * p) ** 1.45;
      value = envelope * (0.32 * Math.sin(phase) + 0.62 * airyNoise);
    } else if (asset.id === 'detail-tick') {
      const envelope = Math.exp(-31 * t);
      value = envelope * (0.66 * Math.sin(2 * Math.PI * 1680 * t)
        + 0.26 * Math.sin(2 * Math.PI * 2840 * t) + 0.08 * noise());
    } else {
      const frequency = 410 - 250 * p;
      phase += 2 * Math.PI * frequency / SAMPLE_RATE;
      const envelope = Math.exp(-14 * t) * Math.min(1, t / 0.004);
      const transient = t < 0.018 ? 0.12 * noise() * Math.exp(-180 * t) : 0;
      value = envelope * 0.78 * Math.sin(phase) + transient;
    }
    samples[i] = value;
  }

  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0 ? 0.58 / peak : 1;
  const pcm = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i] * gain));
    pcm.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  return pcm;
}

function wavFile(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function makeManifest(files) {
  return {
    schemaVersion: 1,
    generatedBy: 'scripts/generate-sfx-assets.js',
    generation: 'Deterministic procedural synthesis; 48 kHz, mono PCM16; recipe version 1.',
    rights: 'Original sounds created in this repository. No third-party recordings, samples, catalog assets, or provider output are used. No separate open-content license is asserted; project usage follows the repository owner’s rights and policies.',
    attribution: 'No third-party attribution is required for these original generated sounds.',
    assets: files.map(({ asset, bytes }) => ({
      id: asset.id,
      file: asset.file,
      source: 'original-procedural',
      recipe: asset.recipe,
      durationMs: asset.durationMs,
      sampleRateHz: SAMPLE_RATE,
      channels: 1,
      codec: 'PCM signed 16-bit little-endian WAV',
      rights: 'Original project-generated sound; no third-party source or license; no separate open-content license asserted.',
      attribution: 'None required; original generated sound.',
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    }))
  };
}

function buildAssets(outputDir) {
  const files = ASSETS.map(asset => ({ asset, bytes: wavFile(sampleAsset(asset)) }));
  const manifest = makeManifest(files);
  fs.mkdirSync(outputDir, { recursive: true });
  for (const { asset, bytes } of files) fs.writeFileSync(path.join(outputDir, asset.file), bytes);
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'ATTRIBUTION.md'), [
    '# Procedural sound effects',
    '',
    'These three short sounds are generated from deterministic waveform recipes in `scripts/generate-sfx-assets.js`; no third-party recordings or external services are used.',
    '',
    'No outside attribution is required. The files are original project assets. This record does not grant a separate open-content license; use follows the repository owner’s rights and policies. Per-file recipe, technical format, rights note, and SHA-256 are in `manifest.json`.',
    ''
  ].join('\n'));
  return manifest;
}

function checkAssets(outputDir) {
  const expected = makeManifest(ASSETS.map(asset => ({ asset, bytes: wavFile(sampleAsset(asset)) })));
  const actual = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)
    || actual.schemaVersion !== expected.schemaVersion || !Array.isArray(actual.assets)
    || typeof actual.rights !== 'string' || !actual.rights.trim()
    || typeof actual.attribution !== 'string' || !actual.attribution.trim()) {
    throw new Error('manifest SFX sem versão ou procedência geral válida');
  }
  for (const item of expected.assets) {
    const bytes = fs.readFileSync(path.join(outputDir, item.file));
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const row = actual.assets?.find(asset => asset.file === item.file);
    const metadataMatches = row
      && ['id', 'file', 'source', 'recipe', 'durationMs', 'sampleRateHz', 'channels', 'codec']
        .every(field => row[field] === item[field])
      && ['rights', 'attribution'].every(field => typeof row[field] === 'string' && row[field].trim());
    if (!metadataMatches || hash !== item.sha256 || hash !== row.sha256) {
      throw new Error(`SFX ausente, sem procedência ou divergente: ${item.file}`);
    }
  }
  return expected.assets.length;
}

if (require.main === module) {
  const outputArg = process.argv.slice(2).find(arg => !arg.startsWith('--'));
  const outputDir = path.resolve(outputArg || path.join(__dirname, '..', 'data', 'assets', 'sfx'));
  if (process.argv.includes('--check')) {
    const count = checkAssets(outputDir);
    console.log(`${count} SFX locais conferidos por SHA-256.`);
  } else {
    const manifest = buildAssets(outputDir);
    console.log(`${manifest.assets.length} SFX originais gerados em ${outputDir}.`);
  }
}

module.exports = { ASSETS, SAMPLE_RATE, buildAssets, checkAssets, sampleAsset, wavFile };
