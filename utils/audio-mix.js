/**
 * AudioMix — mixagem profissional de áudio para o vídeo final.
 *
 * 1. Trilha instrumental original e sintetizada, sem samples de terceiros,
 *    limitada a 10% e com ducking enquanto a narração fala.
 * 2. Masterização: normalização de loudness para o padrão de cada
 *    plataforma (YouTube: -14 LUFS) via loudnorm — consistência de volume
 *    entre todos os vídeos do canal.
 *
 * A trilha é sintetizada localmente, sem samples ou licença de terceiros.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runFFmpeg } = require('./ffmpeg');

const MUSIC_ROOT = path.join(__dirname, '..', 'data', 'assets', 'music');
const SFX_ROOT = path.join(__dirname, '..', 'data', 'assets', 'sfx');
const MOODS = ['epic', 'curious', 'tense', 'light'];
const MAX_MUSIC_GAIN = 0.10;
const configuredMusicGain = Number(process.env.BGM_GAIN);
const MUSIC_GAIN = Number.isFinite(configuredMusicGain) && configuredMusicGain >= 0
  ? Math.min(configuredMusicGain, MAX_MUSIC_GAIN) : MAX_MUSIC_GAIN;
const SFX_GAIN = Object.freeze({ whoosh: 0.14, tick: 0.11, pop: 0.10 });
const SFX_MAX_EVENTS = 8;
const SFX_MIN_GAP_MS = 2800;
const SFX_ASSETS = Object.freeze({
  whoosh: 'section-whoosh.wav',
  tick: 'detail-tick.wav',
  pop: 'visual-pop.wav'
});

/**
 * Mood derivado do texto do vídeo (título/hook) — escolhe a pasta de trilha.
 * Heurística simples: palavras-chave → mood; default "curious" (notícia).
 */
function deriveMood(text) {
  const t = String(text || '').toLowerCase();
  if (/(record|históric|impressionante|gigante|massacr|explos|dominínio|guerra|ameaç|acabou de mudar|mudou tudo|revolucion)/.test(t)) return 'epic';
  if (/(polêmica|acusad|process|proibid|ilegal|vazou|escândalo|crise|queda|colaps|risc|perig)/.test(t)) return 'tense';
  if (/(curios|você sabia|impressiona|estranh|bizar|mistério|ninguém)/.test(t)) return 'curious';
  if (/(dica|economiz|grátis|simples|facilit|melhor|ganhar)/.test(t)) return 'light';
  return 'curious';
}

// Não usa arquivos encontrados por acaso nem a antiga biblioteca CC BY:
// as músicas dessa biblioteca têm direitos autorais e exigem atribuição.
const MUSIC_CREDIT = '';
function musicCreditUsed() { return false; }
function listTracks() { return []; }
function pickTrack() { return null; }
async function fetchStarterPack() { return null; }

/** Fundo ambiente original: somente osciladores sintetizados, sem samples. */
async function createOriginalMusicTrack(workDir) {
  const output = path.join(workDir, 'pulso-original-ambient.wav');
  const expression = [
    '0.22*sin(2*PI*131*t)', '0.14*sin(2*PI*165*t)',
    '0.10*sin(2*PI*196*t)', '0.04*sin(2*PI*294*t)'
  ].join('+');
  fs.mkdirSync(workDir, { recursive: true });
  await runFFmpeg([
    '-y', '-f', 'lavfi', '-i', `aevalsrc=${expression}:s=48000:d=32`,
    '-af', 'lowpass=f=3200', '-ac', '2', '-c:a', 'pcm_s16le', output
  ]);
  return output;
}

/** Select a sparse, deterministic set of cues from semantic scene boundaries. */
function buildSfxEvents(scenes, { enabled = process.env.PULSO_SFX_ENABLED !== '0' } = {}) {
  if (!enabled || !Array.isArray(scenes)) return [];
  const candidates = [];
  let cursorMs = 0;
  let previousGroup = null;

  for (const scene of scenes) {
    const sceneDurationMs = Math.max(0, Number(scene?.durationMs) || 0);
    const components = Array.isArray(scene?.components) ? scene.components : [];
    const groupKind = scene?.groupKind || null;
    const groupTitle = scene?.groupTitle || components.find(item => item.type === 'demo-header')?.category || null;
    const groupKey = groupKind && groupTitle ? `${groupKind}:${groupTitle}` : groupKind || groupTitle;
    if (cursorMs >= 5000 && groupKey && groupKey !== previousGroup && groupKind !== 'hook') {
      candidates.push({ kind: groupKind === 'conclusion' ? 'pop' : 'whoosh', startMs: cursorMs, reason: 'group-entry' });
    }
    previousGroup = groupKey || previousGroup;

    for (const item of components) {
      let kind = null;
      if (item.type === 'kinetic-number' || item.type === 'spec-chips' || item.type === 'timestamp-hud') kind = 'tick';
      else if (['article-print', 'news-card', 'compare-table', 'score-chart', 'line-chart', 'donut-chart', 'rank-list'].includes(item.type)) kind = 'pop';
      const requestedOffsetMs = item.revealAtMs == null ? 0 : Number(item.revealAtMs);
      if (kind && sceneDurationMs > 0 && Number.isFinite(requestedOffsetMs)
        && requestedOffsetMs >= 0 && requestedOffsetMs < sceneDurationMs) {
        candidates.push({
          kind,
          startMs: cursorMs + requestedOffsetMs,
          reason: `visual-${item.type}`
        });
      }
    }
    cursorMs += sceneDurationMs;
  }

  const selected = [];
  for (const cue of candidates.sort((a, b) => a.startMs - b.startMs || a.kind.localeCompare(b.kind))) {
    if (!Number.isFinite(cue.startMs) || cue.startMs < 0) continue;
    if (selected.length && cue.startMs - selected.at(-1).startMs < SFX_MIN_GAP_MS) continue;
    selected.push(cue);
    if (selected.length >= SFX_MAX_EVENTS) break;
  }
  return selected;
}

function hasSfxProvenance(manifest, record, filename) {
  return manifest?.schemaVersion === 1
    && Array.isArray(manifest.assets)
    && typeof manifest.rights === 'string' && manifest.rights.trim().length > 0
    && typeof manifest.attribution === 'string' && manifest.attribution.trim().length > 0
    && record?.file === filename
    && ['source', 'recipe', 'rights', 'attribution', 'codec']
      .every(field => typeof record[field] === 'string' && record[field].trim().length > 0)
    && Number.isFinite(record.durationMs) && record.durationMs > 0
    && Number.isFinite(record.sampleRateHz) && record.sampleRateHz > 0
    && Number.isInteger(record.channels) && record.channels > 0;
}

function loadSfxLibrary(sfxRoot = SFX_ROOT) {
  const manifestPath = path.join(sfxRoot, 'manifest.json');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (_error) { return {}; }
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.assets)) return {};
  const files = {};
  for (const [kind, filename] of Object.entries(SFX_ASSETS)) {
    const record = manifest.assets?.find(asset => asset.file === filename);
    if (!hasSfxProvenance(manifest, record, filename) || !/^[a-f0-9]{64}$/i.test(record.sha256 || '')) continue;
    const fullPath = path.join(sfxRoot, filename);
    try {
      const digest = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
      if (digest === record.sha256) files[kind] = { path: fullPath, durationMs: record.durationMs };
    } catch (_error) { /* Optional asset: a missing effect never breaks the render. */ }
  }
  return files;
}

/**
 * Mixdown final: narração (+ trilha com ducking) → arquivo masterizado.
 * Retorna o caminho do áudio pronto para o mux final.
 */
async function mixdownAudio({ narrationPath, mood: _mood, seed: _seed, workDir, sfxEvents = [], includeMusic = true, sfxRoot = SFX_ROOT }) {
  const outputDir = workDir || path.dirname(narrationPath);
  const track = includeMusic ? await createOriginalMusicTrack(outputDir) : null;
  const outPath = path.join(outputDir, `mix_${path.basename(narrationPath, path.extname(narrationPath))}.m4a`);

  const requestedEvents = Array.isArray(sfxEvents) ? sfxEvents : [];
  const library = requestedEvents.length ? loadSfxLibrary(sfxRoot) : {};
  const cues = requestedEvents.slice(0, SFX_MAX_EVENTS).flatMap(event => {
    const asset = library[event?.kind];
    const startMs = Math.round(Number(event?.startMs));
    return asset && Number.isFinite(startMs) && startMs >= 0
      ? [{ ...asset, kind: event.kind, startMs }]
      : [];
  });
  if (!track && !cues.length) {
    // Sem trilha: só masteriza a narração (loudnorm -14 LUFS, YouTube).
    await runFFmpeg(['-y', '-i', narrationPath,
      '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
      '-c:a', 'aac', '-b:a', '192k', outPath]);
    return { path: outPath, music: null, sfxEvents: 0 };
  }

  const args = ['-y', '-i', narrationPath];
  const filters = [];
  const mixInputs = ['[0:a]'];
  let nextInput = 1;
  if (track) {
    args.push('-stream_loop', '-1', '-i', track);
    filters.push(`[${nextInput}:a]volume=${MUSIC_GAIN}[bgm]`);
    filters.push(`[bgm][0:a]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=400[duck]`);
    mixInputs.push('[duck]');
    nextInput += 1;
  }
  cues.forEach((cue, index) => {
    args.push('-i', cue.path);
    const raw = `sfxraw${index}`;
    const ducked = `sfx${index}`;
    filters.push(`[${nextInput}:a]volume=${SFX_GAIN[cue.kind]},adelay=${cue.startMs}:all=1[${raw}]`);
    filters.push(`[${raw}][0:a]sidechaincompress=threshold=0.025:ratio=6:attack=4:release=140[${ducked}]`);
    mixInputs.push(`[${ducked}]`);
    nextInput += 1;
  });
  const inputCount = mixInputs.length;
  filters.push(`${mixInputs.join('')}amix=inputs=${inputCount}:duration=first:dropout_transition=3:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', outPath);
  await runFFmpeg(args);
  return { path: outPath, music: track, sfxEvents: cues.length };
}

module.exports = { mixdownAudio, buildSfxEvents, loadSfxLibrary, deriveMood, pickTrack, listTracks, fetchStarterPack, createOriginalMusicTrack, musicCreditUsed, MUSIC_CREDIT, MUSIC_GAIN, MAX_MUSIC_GAIN, MOODS, MUSIC_ROOT, SFX_ROOT };
