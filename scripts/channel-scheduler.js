#!/usr/bin/env node
/**
 * Channel Scheduler — 24h no ar gerando vídeos de IA.
 *
 *   - VIDEOS_PER_DAY vídeos por dia (padrão 5), espaçados ao longo de 24h
 *   - A cada RECAP_EVERY_DAYS dias, gera o RESUMO SEMANAL (vídeo mais curto)
 *   - Dedup de temas via ledger (data/state/topics.json, escrito pelo gerador)
 *   - Nunca morre: falha → espera e tenta de novo
 *
 * Uso: setsid nohup node scripts/channel-scheduler.js > logs/scheduler.log 2>&1 < /dev/null &
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { notifyFailure } = require('../utils/alerts');
const { probeVideoHealth } = require('../utils/ffmpeg');
const { updateTopicLedger } = require('../utils/topic-ledger');
const { cleanupDisk } = require('../utils/disk-cleanup');
const { clipUploadsSucceeded, longUploadsSucceeded, normalizedClips, publicationSucceeded } = require('../utils/publication-status');

const ROOT = path.join(__dirname, '..');
const VIDEOS_PER_DAY = Math.max(1, Number(process.env.VIDEOS_PER_DAY || 5));
const RECAP_EVERY_DAYS = Math.max(1, Number(process.env.RECAP_EVERY_DAYS || 7));
// Imagens por seção: limita a cota diária do Gemini (5 vídeos × 9 seções × N).
process.env.IMAGES_PER_GROUP = process.env.IMAGES_PER_GROUP || '4';
const INTERVAL_MS = Math.round((24 * 60 * 60 * 1000) / VIDEOS_PER_DAY);
const RETRY_MS = 30 * 60 * 1000;
const configuredDiskCleanupHours = Number(process.env.DISK_CLEANUP_INTERVAL_HOURS || 12);
const DISK_CLEANUP_INTERVAL_MS = Math.max(1, Math.min(168, Number.isFinite(configuredDiskCleanupHours) ? configuredDiskCleanupHours : 12)) * 60 * 60 * 1000;
const configuredYouTubeRetryMinutes = Number(process.env.YOUTUBE_RETRY_INTERVAL_MINUTES || 30);
const YOUTUBE_RETRY_INTERVAL_MS = Math.max(15, Math.min(360, Number.isFinite(configuredYouTubeRetryMinutes) ? configuredYouTubeRetryMinutes : 30)) * 60 * 1000;
// RÉPLICA POR TEMA: cada instância tem estado próprio (STATE_DIR). O default
// mantém a instância original (ia) inalterada.
const STATE_DIR = path.join(ROOT, process.env.STATE_DIR || 'data/state');
const STATE_PATH = path.join(STATE_DIR, 'scheduler.json');
const LEDGER_PATH = path.join(STATE_DIR, 'topics.json');
const QUEUE_PATH = path.join(STATE_DIR, 'publish-queue.json');

const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

// TEMA DA RÉPLICA: esta instância publica com este canal (default: ia).
const THEME = process.env.THEME || 'ia';
// FASE (minutos): deslocamento inicial para ESPALHAR os posts uniformemente
// no dia quando várias réplicas coexistem (conta: total = vídeos/dia × temas;
// intervalo = 24h / total; cada réplica entra defasada pra preencher os slots).
const PHASE_MIN = Number(process.env.SCHEDULER_PHASE_MIN || 0);
let atomicWriteSequence = 0;

async function readState() {
  try {
    const state = JSON.parse(await fsp.readFile(STATE_PATH, 'utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('estrutura inválida');
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`estado do scheduler ilegível; execução cancelada para preservar o calendário: ${error.message}`);
  }
}
async function writeJsonAtomic(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${++atomicWriteSequence}.tmp`;
  try {
    await fsp.writeFile(tempPath, JSON.stringify(value, null, 2));
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.unlink(tempPath).catch(() => {});
    throw error;
  }
}
async function writeState(state) {
  await writeJsonAtomic(STATE_PATH, state);
}

function runGenerator(args, logFile) {
  return new Promise(resolve => {
    const out = fs.createWriteStream(logFile, { flags: 'a' });
    const child = spawn('node', [path.join(ROOT, 'scripts', 'generate-animated-video.js'), ...args], { cwd: ROOT, detached: false });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.on('close', code => { out.end(); resolve(code); });
    child.on('error', error => { out.end(); log(`spawn error: ${error.message}`); resolve(-1); });
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Alguns fluxos de publicação (TikTok/X) precisam de Chromium com janela,
// mas a janela deve existir somente no display virtual, nunca no desktop.
async function ensureInvisibleBrowserDisplay() {
  const display = ':99';
  const canConnect = () => {
    try {
      const env = { ...process.env, DISPLAY: display };
      delete env.XAUTHORITY;
      execFileSync('xdpyinfo', ['-display', display], { env, stdio: 'ignore', timeout: 1000 });
      return true;
    } catch (_error) { return false; }
  };

  if (!canConnect()) {
    const xvfb = spawn('Xvfb', [display, '-screen', '0', '1280x900x24', '-nolisten', 'tcp'], {
      detached: true,
      stdio: 'ignore'
    });
    let startupError = null;
    xvfb.on('error', error => { startupError = error; });
    xvfb.unref();

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !canConnect()) await sleep(250);
    if (!canConnect()) {
      const detail = startupError ? `: ${startupError.message}` : '';
      throw new Error(`não foi possível iniciar o display virtual ${display}${detail}; o scheduler não usará o desktop visível`);
    }
  }

  process.env.DISPLAY = display;
  delete process.env.XAUTHORITY;
  log(`display virtual ${display} ativo — browsers de upload ficam invisíveis`);
}

async function readLedgerEntry(videoPath) {
  try {
    const raw = JSON.parse(await fsp.readFile(LEDGER_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) throw new Error('estrutura de entries inválida');
    const entries = raw.entries;
    return [...entries].reverse().find(entry => sameVideoPath(entry.videoPath, videoPath)) || null;
  } catch (error) {
    if (error.code !== 'ENOENT') log(`⚠️ ledger de pautas ilegível; upload não iniciado: ${error.message}`);
    return null;
  }
}

async function uploadToYouTube(videoPath, overrides = {}) {
  try {
    const entry = await readLedgerEntry(videoPath);
    if (!entry || !entry.title) return null;
    const { uploadVideo } = require('./upload-to-youtube');
    const seo = entry.seo || {};
    const { MUSIC_CREDIT, musicCreditUsed } = require('../utils/audio-mix');
    const description = [
      seo.description || entry.title,
      process.env.CHANNEL_DESCRIPTION || 'Notícias de inteligência artificial com análises rápidas e visuais. Novos vídeos toda semana.',
      `Fonte: ${entry.url || entry.originUrl || ''}`,
      seo.hashtags || '#inteligenciaartificial #ia #tecnologia',
      ...(musicCreditUsed() ? [MUSIC_CREDIT] : [])
    ].filter(Boolean).join('\n\n');
    const result = await uploadVideo({
      videoPath: path.isAbsolute(videoPath) ? videoPath : path.join(ROOT, videoPath),
      title: overrides.title || seo.youtubeTitle || entry.title,
      description,
      tags: ['inteligência artificial', 'notícias', 'IA', 'tecnologia'],
      privacyStatus: process.env.YT_PRIVACY || 'public',
      ...(typeof entry.thumbnailPath === 'string' && entry.thumbnailPath
        ? { thumbnailPath: path.isAbsolute(entry.thumbnailPath) ? entry.thumbnailPath : path.resolve(ROOT, entry.thumbnailPath) }
        : {})
    });
    log(`⬆️ publicado no YouTube: ${result.url}`);
    return result.url;
  } catch (error) {
    log(`⚠️ upload YouTube falhou: ${error.message}`);
    if (/exceeded the number of videos/i.test(String(error.message))) {
      await flagYtQuota().catch(() => {});
      log('⏸️ cota do YouTube atingida durante retry — nova tentativa em ~20h');
    }
    await notifyFailure('Upload YouTube falhou', error.message);
    return null;
  }
}

// Cota do YouTube: quando estoura ("exceeded the number of videos"),
// pausa uploads YT por 24h pra não quebrar o ciclo inteiro.
const YT_QUOTA_PATH = path.join(STATE_DIR, 'yt-quota.json');
async function ytQuotaBlocked() {
  try {
    const flag = JSON.parse(await fsp.readFile(YT_QUOTA_PATH, 'utf8'));
    return Date.now() - new Date(flag.at).getTime() < 20 * 3600000;
  } catch (_e) { return false; }
}
async function flagYtQuota() {
  await writeJsonAtomic(YT_QUOTA_PATH, { at: new Date().toISOString() });
}

// Marca no ledger que o vídeo já subiu no YouTube (evita re-upload).
function sameVideoPath(a, b) {
  return Boolean(a && b) && path.resolve(ROOT, a) === path.resolve(ROOT, b);
}

function managedMediaPath(candidate) {
  if (!candidate || typeof candidate !== 'string') return null;
  const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(ROOT, candidate);
  const mediaRoot = path.resolve(ROOT, 'data', 'videos');
  return absolute.startsWith(`${mediaRoot}${path.sep}`) ? absolute : null;
}

async function safeManagedMediaPath(candidate, extensions = ['.mp4']) {
  const target = managedMediaPath(candidate);
  if (!target) {
    if (candidate) log(`⚠️ limpeza ignorou caminho fora de data/videos: ${candidate}`);
    return null;
  }
  if (!extensions.includes(path.extname(target).toLowerCase())) return null;
  try {
    const projectRoot = await fsp.realpath(ROOT);
    const mediaRoot = path.resolve(ROOT, 'data', 'videos');
    const realMediaRoot = await fsp.realpath(mediaRoot);
    const expectedMediaRoot = path.resolve(projectRoot, path.relative(path.resolve(ROOT), mediaRoot));
    if (realMediaRoot !== expectedMediaRoot) return null;
    const expectedTarget = path.resolve(realMediaRoot, path.relative(mediaRoot, target));
    if (await fsp.realpath(target) !== expectedTarget) return null;
    if (!(await fsp.lstat(target)).isFile()) return null;
    return target;
  } catch (_error) { return null; }
}

async function unlinkManagedMedia(candidate, extensions = ['.mp4']) {
  const target = await safeManagedMediaPath(candidate, extensions);
  if (!target) return false;
  try {
    await fsp.unlink(target);
    return true;
  } catch (_error) { return false; }
}

async function cleanupPublishedMedia(videoPath, entry, results, options = {}) {
  const summary = { master: false, thumbnail: entry.thumbnailPath ? false : null, clipsRemoved: 0, clipsRetained: 0 };
  const ytConfirmed = publicationSucceeded(results?.long?.youtube || entry.ytUrl);
  if (longUploadsSucceeded(entry, results, { root: ROOT })) {
    summary.master = await unlinkManagedMedia(videoPath, ['.mp4']);
    if (ytConfirmed && entry.thumbnailPath) {
      summary.thumbnail = await unlinkManagedMedia(entry.thumbnailPath, ['.jpg', '.jpeg', '.png', '.webp']);
    }
  }

  for (const [index, clip] of normalizedClips(entry).entries()) {
    if (clipUploadsSucceeded(entry, results, index, { root: ROOT, maxShorts: options.maxShorts })) {
      if (await unlinkManagedMedia(clip.path, ['.mp4'])) summary.clipsRemoved++;
      else summary.clipsRetained++;
    }
    else summary.clipsRetained++;
  }
  return summary;
}

async function markYouTubeDone(videoPath, url) {
  try {
    await updateTopicLedger(LEDGER_PATH, raw => {
      for (const e of (raw.entries || []).reverse()) {
        if (sameVideoPath(e.videoPath, videoPath)) { e.ytUrl = url; break; }
      }
      return raw;
    });
  } catch (error) { log(`⚠️ não foi possível registrar sucesso do YouTube no ledger: ${error.message}`); }
}

// Guarda os resultados da publicação no ledger (pra saber depois se algum
// corte deu ERRO, sem re-analisar — decide a limpeza do pendente).
async function markResults(videoPath, results) {
  try {
    await updateTopicLedger(LEDGER_PATH, raw => {
      for (const e of (raw.entries || []).reverse()) {
        if (sameVideoPath(e.videoPath, videoPath)) { e.results = results; break; }
      }
      return raw;
    });
  } catch (error) { log(`⚠️ não foi possível salvar resultados de publicação no ledger: ${error.message}`); }
}

// Fila de pendências: vídeo que não subiu por cota (publish rodou "sem YT")
// é repetido nos ciclos seguintes até subir. Antes ele ficaria para sempre
// sem publicar no YouTube — o publish só roda no momento da geração.
async function retryPendingYouTube() {
  if (await ytQuotaBlocked()) return;
  try {
    const raw = JSON.parse(await fsp.readFile(LEDGER_PATH, 'utf8'));
    // Escaneia TODAS as entradas (o ledger não é estritamente cronológico) e
    // pega a pendência mais recente cujo arquivo ainda existe no disco.
    const protectedPaths = new Set([
      ...queue.map(item => item && item.outPath).filter(Boolean),
      ...(inFlight && inFlight.outPath ? [inFlight.outPath] : [])
    ].map(item => path.resolve(ROOT, item)));
    const maxShorts = Number(process.env.MAX_SHORTS || 1);
    const pendingYoutubeWork = entry => {
      const results = entry.results || {};
      const longDone = publicationSucceeded(entry.ytUrl || results.long?.youtube);
      const clips = normalizedClips(entry);
      const parsedMaxShorts = Number(maxShorts);
      const shortsCount = Math.min(clips.length, Math.max(0, Number.isFinite(parsedMaxShorts) ? Math.floor(parsedMaxShorts) : 1));
      const pendingShort = clips.slice(0, shortsCount).some(clip => {
        const result = Object.entries(results.clips || {})
          .find(([resultPath]) => sameVideoPath(resultPath, clip.path))?.[1];
        return !publicationSucceeded(result?.shorts) && !/^desativado$/i.test(String(result?.shorts || '').trim());
      });
      return !longDone || pendingShort;
    };
    const candidatos = (raw.entries || [])
      .filter(e => e && e.publicationEligible !== false && typeof e.videoPath === 'string' && e.videoPath
        && pendingYoutubeWork(e) && !protectedPaths.has(path.resolve(ROOT, e.videoPath)))
      .sort((a, b) => new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0));
    const pendentes = [];
    for (const entry of candidatos) {
      if (await safeManagedMediaPath(entry.videoPath, ['.mp4'])) pendentes.push(entry);
    }
    for (const e of pendentes) {
      const videoPath = path.isAbsolute(e.videoPath) ? path.resolve(e.videoPath) : path.resolve(ROOT, e.videoPath);
      let updatedResults = { ...(e.results || {}), long: { ...(e.results?.long || {}) }, clips: { ...(e.results?.clips || {}) } };
      if (!publicationSucceeded(e.ytUrl || updatedResults.long.youtube)) {
        log(`🔁 vídeo longo pendente de YouTube: ${path.basename(e.videoPath)}`);
        const url = await uploadToYouTube(videoPath);
        if (!url) break;
        updatedResults.long.youtube = url;
        await markYouTubeDone(e.videoPath, url);
      }
      const { retryPendingYouTubeShorts } = require('./upload-to-socials');
      updatedResults = await retryPendingYouTubeShorts({ entry: e, results: updatedResults, maxShorts });
      for (const clipResults of Object.values(updatedResults.clips || {})) {
        if (/exceeded the number of videos/i.test(String(clipResults?.shorts || ''))) {
          await flagYtQuota();
          log('⏸️ cota do YouTube atingida durante retry dos Shorts — nova tentativa em ~20h');
          break;
        }
      }
      if (publicationSucceeded(e.ytUrl || updatedResults.long.youtube)) {
        await markYouTubeDone(e.videoPath, e.ytUrl || updatedResults.long.youtube);
      }
      await markResults(e.videoPath, updatedResults);
      if (process.env.DELETE_AFTER_UPLOAD === '1') {
        const summary = await cleanupPublishedMedia(e.videoPath, e, updatedResults, { maxShorts });
        const thumbnailState = summary.thumbnail == null ? 'ausente' : summary.thumbnail ? 'removida' : 'preservada';
        log(`🧹 retry concluído: master ${summary.master ? 'removido' : 'preservado'}, thumbnail ${thumbnailState}, ${summary.clipsRemoved} corte(s) removido(s), ${summary.clipsRetained} preservado(s)`);
      }
      break; // um vídeo por ciclo para controlar a cota
    }
  } catch (error) { log(`⚠️ retry do YouTube não conseguiu ler o ledger: ${error.message}`); }
}

async function publishEverywhere(outPath) {
  try {
    const entry = await readLedgerEntry(outPath);
    if (!entry || !entry.title) { log('⚠️ upload: ledger sem entrada'); return; }
    const absoluteOutPath = path.isAbsolute(outPath) ? path.resolve(outPath) : path.resolve(ROOT, outPath);

    // QA de sanidade: nunca publicar um mp4 corrompido/sem áudio/duração absurda.
    const health = await probeVideoHealth(absoluteOutPath);
    if (!health.ok) {
      log(`🚫 vídeo falhou no QA pré-publicação (${health.issues.join('; ')}) — publicação ABORTADA`);
      await notifyFailure('Vídeo reprovado no QA pré-publicação', `${outPath}\n${health.issues.join('\n')}`);
      return;
    }
    log(`✅ QA ok (${health.duration ? health.duration.toFixed(1) + 's' : '?'}, ${(health.sizeBytes / 1e6).toFixed(1)}MB)`);

    const { uploadToAll } = require('./upload-to-socials');
    const clips = normalizedClips(entry).map(item => {
      const clip = { ...item, title: item.title || entry.title };
      if (clip.path) clip.path = path.isAbsolute(clip.path) ? path.resolve(clip.path) : path.resolve(ROOT, clip.path);
      return clip;
    });
    const quotaBlocked = await ytQuotaBlocked();
    if (quotaBlocked) log('⏸️ YouTube pausado (cota diária) — segue só com TikTok/Kwai/IG/X');
    const maxShorts = Number(process.env.MAX_SHORTS || 1); // 1 Short por vídeo: poupa cota
    log(`⬆️ publicando: ${quotaBlocked ? '(sem YT) ' : 'YouTube longo + Shorts, '}${clips.length} cortes (TikTok/Kwai/IG/X)`);
    const results = await uploadToAll({
      videoPath: absoluteOutPath,
      clips,
      title: entry.seo?.youtubeTitle || entry.title,
      hashtags: entry.seo?.hashtags || '#ia #inteligenciaartificial #tecnologia',
      sourceUrl: entry.url || '',
      skipYouTube: quotaBlocked,
      maxShorts,
      ...(entry.seo ? { seo: entry.seo } : {}),
      ...(typeof entry.thumbnailPath === 'string' && entry.thumbnailPath
        ? { thumbnailPath: path.isAbsolute(entry.thumbnailPath) ? entry.thumbnailPath : path.resolve(ROOT, entry.thumbnailPath) }
        : {})
    });
    const longOk = publicationSucceeded(results.long.youtube);
    if (longOk) await markYouTubeDone(outPath, results.long.youtube);
    if (/exceeded the number of videos/i.test(String(results.long.youtube))) {
      await flagYtQuota();
      log('⏸️ cota do YouTube atingida — pausando uploads YT por ~20h');
    }
    for (const [clip, r] of Object.entries(results.clips || {})) {
      log(`   corte ${path.basename(clip)}: ${JSON.stringify(r)}`);
    }

    // Persiste o retorno por plataforma antes de decidir quais cópias locais
    // ainda são necessárias para recuperação.
    await markResults(outPath, results).catch(() => {});
    if (process.env.DELETE_AFTER_UPLOAD === '1') {
      const summary = await cleanupPublishedMedia(outPath, entry, results, { maxShorts });
      const thumbnailState = summary.thumbnail == null ? 'ausente' : summary.thumbnail ? 'removida' : 'preservada';
      log(`🧹 limpeza pós-publicação: master ${summary.master ? 'removido' : 'preservado'}, thumbnail ${thumbnailState}, ${summary.clipsRemoved} corte(s) removido(s), ${summary.clipsRetained} preservado(s)`);
    }
  } catch (error) {
    log(`⚠️ publicação falhou: ${error.message}`);
    await notifyFailure('Publicação falhou', error.message);
  }
}

async function generate({ recap, outPath, theme }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalOutPath = outPath || `data/videos/${recap ? 'recap' : 'auto'}_${stamp}.mp4`;
  const logFile = path.join(ROOT, 'logs', `gen_${stamp}.log`);
  const args = recap
    ? ['--recap', '--words', '400', '--out', finalOutPath]
    : ['--auto', '--words', '950', '--out', finalOutPath, '--theme', theme || THEME];
  // Retry com o mesmo outPath + --resume: etapas com cache (roteiro/narração/
  // prints) são reaproveitadas e, se o render já concluiu, pula direto.
  if (outPath) args.push('--resume');
  log(`▶ gerando ${recap ? 'RESUMO SEMANAL' : `vídeo [tema: ${THEME}]`} → ${finalOutPath}`);
  const code = await runGenerator(args, logFile);
  if (code === 0) {
    log(`✅ pronto: ${finalOutPath}`);
    // A publicação acontece no consumer, no slot programado. Publicar aqui
    // apagaria o arquivo antes da fila e faria o consumer receber um path morto.
    return { ok: true, outPath: finalOutPath };
  }
  log(`❌ falhou (code ${code}) — log: ${logFile}`);
  await notifyFailure('Geração de vídeo falhou', `exit code ${code}\nlog: ${logFile}`);
  return { ok: false, outPath: finalOutPath };
}

// Máximo de vídeos PRONTOS no SSD (não enche o disco à toa). Se a geração
// demora 4min e a cadência é 10min, com MAX_QUEUE=1 o producer só gera
// 1 vídeo por vez e depois para — 6min de máquina ociosa (o máximo possível).
const MAX_QUEUE = Number(process.env.MAX_QUEUE || 1);
let queue = [];
let inFlight = null;
let queueWritePromise = Promise.resolve();
let diskCleanupPromise = null;
let generationInProgress = false;
let youtubeRetryInProgress = false;

async function runScheduledDiskCleanup(reason) {
  if (youtubeRetryInProgress) {
    log(`[disco/${reason}] limpeza adiada enquanto o retry do YouTube está ativo`);
    return null;
  }
  if (diskCleanupPromise) return diskCleanupPromise;
  const protectedVideoPaths = [
    ...queue.map(item => item && item.outPath).filter(Boolean),
    ...(inFlight && inFlight.outPath ? [inFlight.outPath] : [])
  ];
  diskCleanupPromise = cleanupDisk({
    root: ROOT,
    stateDir: STATE_DIR,
    protectedVideoPaths,
    deleteUploadedMedia: process.env.DELETE_AFTER_UPLOAD === '1',
    apply: true,
    log: message => log(`[disco/${reason}] ${message}`)
  });
  try {
    return await diskCleanupPromise;
  } finally {
    diskCleanupPromise = null;
  }
}

function persistQueue() {
  // Serializa snapshots para que producer e consumer não sobrescrevam a fila
  // com estados fora de ordem quando os dois acordam quase ao mesmo tempo.
  const snapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    pending: queue.map(item => ({ ...item })),
    inFlight: inFlight ? { ...inFlight } : null
  };
  queueWritePromise = queueWritePromise.catch(() => {}).then(() => writeJsonAtomic(QUEUE_PATH, snapshot));
  return queueWritePromise;
}

async function restoreQueue() {
  let saved;
  try { saved = JSON.parse(await fsp.readFile(QUEUE_PATH, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return true;
    log(`⚠️ fila persistida ilegível; execução cancelada para preservar os caminhos pendentes: ${error.message}`);
    return false;
  }
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.pending)) {
    log('⚠️ fila persistida tem formato inválido; execução cancelada para preservar os dados');
    return false;
  }
  const exists = async item => Boolean(item && typeof item.outPath === 'string'
    && await safeManagedMediaPath(item.outPath, ['.mp4']));
  const pending = [];
  for (const item of Array.isArray(saved.pending) ? saved.pending : []) {
    if (await exists(item)) pending.push(item);
    else if (item?.outPath) log(`⚠️ fila persistida ignorada: arquivo ausente (${item.outPath})`);
  }
  if (await exists(saved.inFlight)) {
    // Publicação interrompida pode ser repetida. Mantemos o vídeo para não
    // perdê-lo; upload por plataforma ainda não tem idempotência distribuída.
    pending.unshift({ ...saved.inFlight, recoveredAfterInterruptedPublish: true });
    log(`⚠️ retomando vídeo cuja publicação foi interrompida: ${path.basename(saved.inFlight.outPath)}; confira possíveis duplicatas nas redes`);
  }
  queue = pending;
  await persistQueue();
  if (queue.length) log(`📦 ${queue.length} vídeo(s) recuperado(s) da fila persistida`);
  return true;
}

/**
 * JUST-IN-TIME: calcula quando começar a geração para o vídeo ficar
 * pronto ANTES do slot de postagem (com margem de segurança).
 *
 * Fórmula: início_geração = slot_postagem - tempo_estimado - margem
 * Exemplo: postagem às 00:10, geração demora 15min, margem 5min
 *          → começa às 23:50, termina às 00:05, posta às 00:10
 *
 * Assim a máquina fica LIVRE o máximo de tempo possível (a geração
 * só acontece quando é necessária pra encher o próximo slot).
 *
 * O tempo estimado vem do histórico: média das últimas gerações
 * (ou default 20 min até ter histórico suficiente).
 */
const GEN_HISTORY_FILE = path.join(STATE_DIR, 'gen-history.json');

async function readGenHistory() {
  try {
    return JSON.parse(await fsp.readFile(GEN_HISTORY_FILE, 'utf8'));
  } catch (_e) { return { durations: [] }; }
}

async function writeGenHistory(history) {
  await writeJsonAtomic(GEN_HISTORY_FILE, history);
}

// Estimativa: média das últimas gerações (mín. 5min, máx. 60min)
async function estimateGenerationMs() {
  const history = await readGenHistory();
  const durations = (history.durations || []).slice(-5); // últimas 5
  if (durations.length === 0) return 20 * 60000; // default 20 min
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  return Math.max(5 * 60000, Math.min(60 * 60000, Math.round(avg)));
}

async function recordGenerationDuration(ms) {
  const history = await readGenHistory();
  history.durations = (history.durations || []).slice(-9); // guarda últimas 10
  history.durations.push(ms);
  await writeGenHistory(history);
}

/**
 * PRODUCER (just-in-time): só gera quando está perto do próximo slot.
 * Se faltam mais de 5 min para o "ponto de corte" (início da geração),
 * dorme e espera. Só acorda na hora certa pra gerar.
 * Cicla entre os temas habilitados (round-robin): cada vídeo é de um tema.
 */
async function producer() {
  // Temas ativos (round-robin): cada vídeo gerado é de um tema diferente
  const THEMES = require('../config/themes.json').themes.filter(t => t.enabled);
  let themeCursor = 0;
  log(`🔄 ${THEMES.length} tema(s) ativo(s) no rodízio`);

  for (;;) {
    // Se o consumer ainda tá postando (fila não vazia), espera
    if (queue.length >= MAX_QUEUE) {
      await sleep(30000);
      continue;
    }
    if (youtubeRetryInProgress) {
      await sleep(30000);
      continue;
    }

    // Calcula quanto tempo falta pro próximo slot de postagem
    const now = Date.now();
    const genMs = await estimateGenerationMs();
    const safetyMs = 5 * 60000; // margem de segurança (5 min)
    const cutoffMs = genMs + safetyMs; // quanto tempo antes do slot começar

    // Calcula o próximo slot baseado no startedAt + N × intervalo
    const state = await readState();
    const startedAt = state.startedAt ? new Date(state.startedAt).getTime() : now;
    const elapsed = now - startedAt;
    const intervalsPassed = Math.floor(elapsed / INTERVAL_MS);
    const nextSlot = startedAt + (intervalsPassed + 1) * INTERVAL_MS;
    const timeToSlot = nextSlot - now;

    if (timeToSlot > cutoffMs) {
      // Ainda dá tempo: dorme até o "ponto de corte" (o máximo de ociosidade)
      const idleMs = timeToSlot - cutoffMs;
      log(`😴 ocioso por ${(idleMs / 60000).toFixed(1)}min — começo a gerar em ${(cutoffMs / 60000).toFixed(0)}min antes do slot`);
      await sleep(idleMs);
      continue;
    }

    if (youtubeRetryInProgress) {
      await sleep(30000);
      continue;
    }

    // Pega o próximo tema no rodízio (round-robin entre os ativos)
    const currentTheme = THEMES[themeCursor % THEMES.length];
    themeCursor++;

    // Chegou na hora: gera
    log(`▶ [just-in-time] gerando vídeo do tema: ${currentTheme.name} (${(genMs / 60000).toFixed(1)}min estimados)`);
    const t0 = Date.now();
    generationInProgress = true;
    let video;
    try { video = await generate({ recap: false, theme: currentTheme.id }); }
    finally { generationInProgress = false; }
    const durationMs = Date.now() - t0;

    if (video.ok) {
      // Registra o tempo real pra calibrar as próximas estimativas
      await recordGenerationDuration(durationMs);
      queue.push({
        ...video,
        theme: currentTheme.id,
        generatedAt: new Date().toISOString(),
        slotAt: new Date(nextSlot).toISOString()
      });
      await persistQueue();
      log(`📦 pronto em ${(durationMs / 60000).toFixed(1)}min — fila: ${queue.length}/${MAX_QUEUE} vídeo(s) [tema: ${currentTheme.id}]`);
    } else {
      log('⚠️ producer: geração falhou, tentando de novo em 5 min');
      await sleep(300000);
    }
  }
}

/**
 * CONSUMER: posta no slot; se a geração passar do horário, publica assim que
 * ficar pronta em vez de perder mais uma janela inteira da cadência.
 */
async function consumer() {
  const queuedSlot = () => {
    const timestamp = queue[0]?.slotAt ? new Date(queue[0].slotAt).getTime() : NaN;
    return Number.isFinite(timestamp) ? timestamp : null;
  };
  let dueSlot = queue.length ? (queuedSlot() ?? Date.now()) : null;
  let reportedEmptySlot = false;
  for (;;) {
    // Mantém o slot devido enquanto espera a geração atrasada. Sem isso, uma
    // fila vazia fazia o consumer avançar para a próxima janela de 24 min.
    if (dueSlot == null) {
      dueSlot = queuedSlot();
      if (dueSlot == null) {
        const state = await readState();
        const startedAt = state.startedAt ? new Date(state.startedAt).getTime() : Date.now();
        const intervalsPassed = Math.floor((Date.now() - startedAt) / INTERVAL_MS);
        dueSlot = startedAt + (intervalsPassed + 1) * INTERVAL_MS;
      }
      const timeToSlot = dueSlot - Date.now();
      if (timeToSlot > 0) log(`⏰ consumer: aguardando ${(timeToSlot / 60000).toFixed(1)}min até o próximo slot`);
    }

    const timeToSlot = dueSlot - Date.now();
    if (timeToSlot > 0) {
      await sleep(Math.min(timeToSlot, 30000));
      continue;
    }

    if (!queue.length) {
      if (!reportedEmptySlot) log('⚠️ consumer: slot vencido sem vídeo; vai publicar assim que a geração terminar');
      reportedEmptySlot = true;
      await sleep(5000);
      continue;
    }

    if (youtubeRetryInProgress) {
      await sleep(5000);
      continue;
    }

    const video = queue.shift();
    inFlight = video;
    await persistQueue();

    log(`${reportedEmptySlot ? '🎬 [atrasado, publicando assim que ficou pronto]' : '🎬 [slot] postando'}: ${path.basename(video.outPath)}`);
    try {
      if (process.env.DISABLE_YOUTUBE_UPLOAD !== '1') await publishEverywhere(video.outPath);
    } finally {
      inFlight = null;
      await persistQueue();
    }

    // Atualiza o estado (runs + lastRunAt)
    const st = await readState();
    st.runs = (st.runs || 0) + 1;
    st.lastRunAt = new Date().toISOString();
    await writeState(st);
    dueSlot = null;
    reportedEmptySlot = false;
  }
}

async function youtubeRetryWorker() {
  for (;;) {
    await sleep(YOUTUBE_RETRY_INTERVAL_MS);
    if (process.env.DISABLE_YOUTUBE_UPLOAD === '1') continue;
    if (generationInProgress || queue.length || inFlight || youtubeRetryInProgress) continue;
    if (await ytQuotaBlocked()) continue;
    if (generationInProgress || queue.length || inFlight || youtubeRetryInProgress) continue;

    youtubeRetryInProgress = true;
    try { await retryPendingYouTube(); }
    catch (error) { log(`⚠️ retry do YouTube ignorado: ${error.message}`); }
    finally { youtubeRetryInProgress = false; }
  }
}

async function main() {
  log(`Channel Scheduler iniciado — tema: ${THEME} · ${VIDEOS_PER_DAY} vídeos/dia · resumo a cada ${RECAP_EVERY_DAYS} dias`);
  log(`intervalo entre vídeos: ${(INTERVAL_MS / 3600000).toFixed(2)}h${PHASE_MIN ? ` · fase +${PHASE_MIN}min (espalhamento uniforme entre réplicas)` : ''}`);

  let state = await readState();
  if (!state.startedAt) {
    state = { startedAt: new Date().toISOString(), lastRecapAt: null, runs: 0, recaps: 0, lastRunAt: null };
    await writeState(state);
  }

  if (!await restoreQueue()) throw new Error('revise o arquivo data/state/publish-queue.json antes de retomar');

  // Nunca herda o display gráfico do usuário. TikTok/X mantêm o modo headed
  // que já funciona, isolados no Xvfb; as demais automações seguem headless.
  await ensureInvisibleBrowserDisplay();

  // Retenção conservadora em background: preserva o queue e ignora caches
  // de navegador/gerador que estejam em uso. A CLI correspondente é dry-run.
  try { await runScheduledDiskCleanup('startup'); }
  catch (error) { log(`⚠️ limpeza do disco ignorada: ${error.message}`); }
  const diskCleanupTimer = setInterval(() => {
    runScheduledDiskCleanup('periódica').catch(error => log(`⚠️ limpeza do disco ignorada: ${error.message}`));
  }, DISK_CLEANUP_INTERVAL_MS);
  diskCleanupTimer.unref();

  // Fase da réplica: deslocamento fixo no slot (espalha N réplicas no dia).
  if (PHASE_MIN > 0 && !state.phaseApplied) {
    log(`⏳ fase da réplica: +${PHASE_MIN}min (deslocamento uniforme entre réplicas)`);
    await sleep(PHASE_MIN * 60000);
    state.phaseApplied = true;
    await writeState(state);
  }

  // Modelo fábrica: producer gera em paralelo com consumer que posta.
  // O vídeo N+1 já está sendo gerado enquanto o N é postado (sem atraso).
  log('🚀 Modo fábrica just-in-time: producer (gera só no tempo exato) + consumer (posta no slot)');
  await Promise.all([
    producer(),
    consumer(),
    youtubeRetryWorker()
  ]);
}

main().catch(error => { log(`FATAL: ${error.message}`); process.exit(1); });
