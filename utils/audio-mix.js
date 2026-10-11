/**
 * AudioMix — mixagem profissional de áudio para o vídeo final.
 *
 * 1. Trilha de fundo com DUCKING automático: a música abaixa quando a
 *    narração fala e volta nos intervalos (sidechaincompress).
 * 2. Masterização: normalização de loudness para o padrão de cada
 *    plataforma (YouTube: -14 LUFS) via loudnorm — consistência de volume
 *    entre todos os vídeos do canal.
 *
 * Banco de trilhas (opcional): arquivos .mp3/.m4a/.ogg em
 *   data/assets/music/<mood>/   — moods: epic | curious | tense | light
 * Sem trilhas no disco, aplica só a masterização loudnorm (não falha).
 */
const fs = require('fs');
const path = require('path');
const { runFFmpeg } = require('./ffmpeg');

const MUSIC_ROOT = path.join(__dirname, '..', 'data', 'assets', 'music');
const MOODS = ['epic', 'curious', 'tense', 'light'];
const MUSIC_GAIN = Number(process.env.BGM_GAIN || 0.28); // nível base da trilha

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

function listTracks(mood) {
  const dirs = [mood && path.join(MUSIC_ROOT, mood), MUSIC_ROOT].filter(Boolean);
  const seen = new Set();
  const tracks = [];
  for (const dir of dirs) {
    let files;
    try { files = fs.readdirSync(dir); } catch (_e) { continue; }
    for (const f of files) {
      if (!/\.(mp3|m4a|ogg|wav)$/i.test(f)) continue;
      const full = path.join(dir, f);
      if (!seen.has(full)) { seen.add(full); tracks.push(full); }
    }
  }
  return tracks;
}

/**
 * Pack inicial de trilhas (Kevin MacLeod/incompetech, CC BY 4.0) — baixado
 * AUTOMATICAMENTE na primeira mixagem sem trilhas locais. Nada manual.
 * Crédito obrigatório da licença é acrescentado na descrição dos uploads
 * (ver MUSIC_CREDIT / musicCreditUsed()).
 */
const STARTER_PACK = {
  epic: ['Prelude and Action', 'Rising Tide'],
  curious: ['Daily Beetle', 'Sneaky Snitch'],
  tense: ['Investigations', 'Crypto', 'Thinking Music'],
  light: ['Life of Riley', 'Wallpaper', 'Fluffing a Duck']
};
const MUSIC_CREDIT = 'Música: Kevin MacLeod (incompetech.com), licença CC BY 4.0';
const MUSIC_ATTR_PATH = path.join(MUSIC_ROOT, 'ATTRIBUTION.md');
const packPromise = { current: null };

async function downloadTrack(mood, title) {
  const url = `https://incompetech.com/music/royalty-free/mp3-royaltyfree/${encodeURIComponent(title)}.mp3`;
  const outPath = path.join(MUSIC_ROOT, mood, `${title.replace(/[^\wÀ-ú -]/g, '')}.mp3`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100 * 1024) throw new Error(`arquivo suspeito (${buf.length}B)`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buf);
    return true;
  } catch (error) {
    console.warn(`[audio-mix] trilha "${title}" falhou (seguindo): ${error.message}`);
    return false;
  }
}

async function fetchStarterPack() {
  // Uma tentativa por processo (evita 8 downloads paralelos num vídeo com 8 seções).
  if (!packPromise.current) {
    packPromise.current = (async () => {
      const jobs = [];
      for (const [mood, titles] of Object.entries(STARTER_PACK)) {
        for (const title of titles) {
          const outPath = path.join(MUSIC_ROOT, mood, `${title.replace(/[^\wÀ-ú -]/g, '')}.mp3`);
          if (!fs.existsSync(outPath)) jobs.push(downloadTrack(mood, title));
        }
      }
      if (jobs.length) {
        console.log(`[audio-mix] banco de trilhas vazio — baixando pack inicial CC-BY (${jobs.length} arquivos)…`);
        await Promise.all(jobs);
        try {
          fs.writeFileSync(MUSIC_ATTR_PATH,
            `# Créditos das trilhas (CC BY 4.0)\n\nTodas as músicas deste banco são de **Kevin MacLeod** (incompetech.com),\nlicença Creative Commons BY 4.0 — https://creativecommons.org/licenses/by/4.0/\n\nMoods: epic (Prelude and Action, Rising Tide) · curious (Daily Beetle, Sneaky Snitch)\n· tense (Investigations, Crypto, Thinking Music) · light (Life of Riley, Wallpaper, Fluffing a Duck)\n\nO crédito é acrescentado automaticamente na descrição dos vídeos pelo scheduler.\n`);
        } catch (_e) { /* ignore */ }
      }
      return null;
    })();
  }
  return packPromise.current;
}

/** Crédito deve entrar na descrição quando o canal usa trilhas. */
function musicCreditUsed() {
  return listTracks(null).length > 0 || Object.values(STARTER_PACK).some(t => t.length > 0);
}

function pickTrack(mood, seed = Date.now()) {
  const tracks = listTracks(mood);
  if (!tracks.length) return null;
  return tracks[seed % tracks.length]; // determinístico por seed do vídeo
}

/**
 * Mixdown final: narração (+ trilha com ducking) → arquivo masterizado.
 * Retorna o caminho do áudio pronto para o mux final.
 */
async function mixdownAudio({ narrationPath, mood, seed, workDir }) {
  let track = pickTrack(mood, seed != null ? Number(seed) : Date.now());
  if (!track) {
    // Banco vazio: baixa o pack inicial CC-BY automaticamente (uma vez) e tenta de novo.
    await fetchStarterPack();
    track = pickTrack(mood, seed != null ? Number(seed) : Date.now());
  }
  const outPath = path.join(workDir || path.dirname(narrationPath), `mix_${path.basename(narrationPath, path.extname(narrationPath))}.m4a`);

  if (!track) {
    // Sem trilha: só masteriza a narração (loudnorm -14 LUFS, YouTube).
    await runFFmpeg(['-y', '-i', narrationPath,
      '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
      '-c:a', 'aac', '-b:a', '192k', outPath]);
    return { path: outPath, music: null };
  }

  // Trilha em loop com ducking: música abaixa quando a narração fala.
  const filter = [
    `[1:a]volume=${MUSIC_GAIN}[bgm]`,
    `[bgm][0:a]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=400[duck]`,
    `[0:a][duck]amix=inputs=2:duration=first:dropout_transition=3,loudnorm=I=-14:TP=-1.5:LRA=11[a]`
  ].join(';');

  await runFFmpeg(['-y',
    '-i', narrationPath,
    '-stream_loop', '-1', '-i', track,
    '-filter_complex', filter,
    '-map', '[a]',
    '-c:a', 'aac', '-b:a', '192k', outPath]);
  return { path: outPath, music: track };
}

module.exports = { mixdownAudio, deriveMood, pickTrack, listTracks, fetchStarterPack, musicCreditUsed, MUSIC_CREDIT, MOODS, MUSIC_ROOT };
