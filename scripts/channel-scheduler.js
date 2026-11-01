#!/usr/bin/env node
/**
 * Channel Scheduler — 24h no ar gerando vídeos de IA.
 *
 *   - VIDEOS_PER_DAY vídeos por dia (padrão 5), espaçados ao longo de 24h
 *   - Recap por tema, quando explicitamente habilitado via ENABLE_WEEKLY_RECAP=1
 *   - Dedup de temas via ledger (data/state/topics.json, escrito pelo gerador)
 *   - Nunca morre: falha → espera e tenta de novo
 *
 * Uso: setsid nohup node scripts/channel-scheduler.js > logs/scheduler.log 2>&1 < /dev/null &
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('node:crypto');
const { spawn } = require('child_process');
const { finished } = require('node:stream/promises');
const { getAlertChannelStatus, notifyFailure } = require('../utils/alerts');
const { probeVideoHealth } = require('../utils/ffmpeg');
const { probeRenderHardwareGate } = require('../utils/render-timing');
const { verifyVideoQaManifest, verifyArtifactOwnersForPublication } = require('../utils/video-qa-manifest');
const { publicationVisualGate, assertPublicationVisualGate } = require('../utils/publication-visual-gate');
const { updateTopicLedger } = require('../utils/topic-ledger');
const { createYouTubeQuotaStore } = require('../utils/youtube-quota-state');
const { Logger } = require('../utils/logger');
const { producerLeadTimeMs, producerMustWait, producerMustWaitForRetry, backgroundRetryMustWait, queuedPublicationImminent } = require('../utils/producer-concurrency-gate');
const { restoredMissedSlot, producerTargetSlot, retainedSlotAfterPreflight, requestedImmediateSlot, restoredWaitingQueueSlot } = require('../utils/scheduler-slot');
const { createJobId, videoIdForPath } = require('../utils/observability-ids');
const { createPersistThenObservePublicationState, createPublicationObserver } = require('../utils/publication-observability');
const { logGenerationProcessFinished, logGenerationProcessStarted } = require('../utils/generation-observability');
const { createSanitizedLogStream } = require('../utils/sanitized-log-stream');
const { sanitizeLogText } = require('../utils/log-sanitizer');
const { cleanupDisk } = require('../utils/disk-cleanup');
const { scanDiskMediaInventory } = require('../utils/disk-media-inventory');
const { allArtifactOwnersConfirmed, artifactOwnerPublicationProofs, clipCanBeDeletedAfterPublication, isBackgroundRetryEligible, isPublicationEligible, longUploadsSucceeded, normalizedClips, publicationSucceeded } = require('../utils/publication-status');
const { deleteMediaWithEvidence } = require('../utils/media-deletion');
const { resolveRetryEntryMedia, sortRetryEntriesOldestFirst } = require('../utils/retry-entry-media');
const { recordPublicationResult, shouldAttemptPublication, shouldInspectSocialRetry } = require('../utils/social-publication-state');
const { resolvePublicationTitle } = require('../utils/publication-title');
const { recoverPersistedQueue } = require('../utils/publish-queue-recovery');
const { advanceThemeRotation, validateSchedulerSettings } = require('../utils/theme-rotation');
const { isPlatformTargeted, isShortsTargeted } = require('../utils/platform-video-policy');
const { createGenerationAttemptStore, isCompletedGenerationAttempt, refreshGenerationAttempt } = require('../utils/generation-attempt');
const { createDeferredGenerationQueue, sameAttempt } = require('../utils/deferred-generation-queue');
const { generationFailureCodeFromLog } = require('../utils/generation-errors');
const { discardTechnicallyRejectedGeneration } = require('../utils/rejected-generation-cleanup');
const { formatGenerationRetryDelay, generationRetryDelayMs, isRetryableGenerationFailure, shouldBypassDailyBudgetBackoff } = require('../utils/generation-retry');
const { createSchedulerRuntimeWriter, readPersistedGenerationRetryState } = require('../utils/scheduler-runtime-health');
const { decideRecapGeneration, isValidRecapWindow, recordRecapWindow, weeklyRecapEnabled } = require('../utils/recap-schedule');
const {
  APPROVED_NARRATIVE_RENDERER,
  autonomousNarrativePublicationDecision,
  canRunMigrationCanary,
  isApprovedExistingEpisode,
  isScheduledGenerationPaused,
  isVideoGenerationPaused,
  migrationCanaryRetryDelayMs
} = require('../utils/video-generation-control');

const ROOT = path.join(__dirname, '..');
const schedulerSettings = validateSchedulerSettings({
  videosPerDay: process.env.VIDEOS_PER_DAY ?? 5,
  recapEveryDays: process.env.RECAP_EVERY_DAYS ?? 7,
  phaseMinutes: process.env.SCHEDULER_PHASE_MIN ?? 0,
  themes: require('../config/themes.json').themes
});
const VIDEOS_PER_DAY = schedulerSettings.videosPerDay;
const RECAP_EVERY_DAYS = schedulerSettings.recapEveryDays;
const WEEKLY_RECAP_ENABLED = weeklyRecapEnabled(process.env);
const RECAP_ANCHOR_AT = process.env.RECAP_ANCHOR_AT || null;
const PHASE_MIN = schedulerSettings.phaseMinutes;
const ACTIVE_THEMES = schedulerSettings.themes;
// Imagens por seção: limita a cota diária do Gemini (5 vídeos × 9 seções × N).
process.env.IMAGES_PER_GROUP = process.env.IMAGES_PER_GROUP || '4';
const INTERVAL_MS = Math.round((24 * 60 * 60 * 1000) / VIDEOS_PER_DAY);
const configuredDiskCleanupHours = Number(process.env.DISK_CLEANUP_INTERVAL_HOURS || 12);
const DISK_CLEANUP_INTERVAL_MS = Math.max(1, Math.min(168, Number.isFinite(configuredDiskCleanupHours) ? configuredDiskCleanupHours : 12)) * 60 * 60 * 1000;
const configuredYouTubeRetryMinutes = Number(process.env.YOUTUBE_RETRY_INTERVAL_MINUTES || 30);
const YOUTUBE_RETRY_INTERVAL_MS = Math.max(15, Math.min(360, Number.isFinite(configuredYouTubeRetryMinutes) ? configuredYouTubeRetryMinutes : 30)) * 60 * 1000;
const configuredSocialRetryMinutes = Number(process.env.SOCIAL_RETRY_INTERVAL_MINUTES || 5);
const SOCIAL_RETRY_INTERVAL_MS = Math.max(3, Math.min(60, Number.isFinite(configuredSocialRetryMinutes) ? configuredSocialRetryMinutes : 5)) * 60 * 1000;
const configuredSocialUploadsPerRetry = Number(process.env.SOCIAL_UPLOADS_PER_RETRY || 4);
const SOCIAL_UPLOADS_PER_RETRY = Math.max(1, Math.min(4,
  Number.isFinite(configuredSocialUploadsPerRetry) ? Math.floor(configuredSocialUploadsPerRetry) : 4));
const configuredGenerationTimeoutMs = Number(process.env.GENERATION_JOB_TIMEOUT_MS || 6 * 60 * 60 * 1000);
const GENERATION_JOB_TIMEOUT_MS = Math.max(10 * 60 * 1000,
  Math.min(24 * 60 * 60 * 1000, Number.isFinite(configuredGenerationTimeoutMs)
    ? configuredGenerationTimeoutMs : 6 * 60 * 60 * 1000));
const RESOURCE_GATE_RECHECK_MS = Math.max(15000, Math.min(5 * 60 * 1000,
  Number.isFinite(Number(process.env.RENDER_GATE_RECHECK_MS)) ? Number(process.env.RENDER_GATE_RECHECK_MS) : 30000));
// RÉPLICA POR TEMA: cada instância tem estado próprio (STATE_DIR). O default
// mantém a instância original (ia) inalterada.
const STATE_DIR = path.join(ROOT, process.env.STATE_DIR || 'data/state');
const STATE_PATH = path.join(STATE_DIR, 'scheduler.json');
const LEDGER_PATH = path.join(STATE_DIR, 'topics.json');
const QUEUE_PATH = path.join(STATE_DIR, 'publish-queue.json');
const GENERATION_ATTEMPT_PATH = path.join(STATE_DIR, 'generation-in-flight.json');
const generationAttemptStore = createGenerationAttemptStore({ filePath: GENERATION_ATTEMPT_PATH, root: ROOT });
const deferredGenerationQueue = createDeferredGenerationQueue({ root: ROOT,
  filePath: path.join(STATE_DIR, 'deferred-generation-attempts.json'), attemptStore: generationAttemptStore });
const THEME_ROTATION_PATH = path.join(STATE_DIR, 'theme-rotation.json');
const SCHEDULER_HEALTH_PATH = path.join(STATE_DIR, 'scheduler-health.json');
const runtimeHealthWriter = createSchedulerRuntimeWriter({ filePath: SCHEDULER_HEALTH_PATH });

const log = msg => console.log(`[${new Date().toISOString()}] ${sanitizeLogText(msg)}`);
const observationLogger = new Logger('PipelineObserve');

// TEMA DA RÉPLICA: esta instância publica com este canal (default: ia).
const THEME = process.env.THEME || 'ia';
// FASE (minutos): deslocamento inicial para ESPALHAR os posts uniformemente
// no dia quando várias réplicas coexistem (conta: total = vídeos/dia × temas;
// intervalo = 24h / total; cada réplica entra defasada pra preencher os slots).
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

function runGenerator(args, logFile, { jobId, videoId, timeoutMs = GENERATION_JOB_TIMEOUT_MS }) {
  return new Promise(resolve => {
    const out = fs.createWriteStream(logFile, { flags: 'a' });
    const stdoutFilter = createSanitizedLogStream();
    const stderrFilter = createSanitizedLogStream();
    const startedAt = Date.now();
    logGenerationProcessStarted(observationLogger, { videoId, jobId });
    const child = spawn('node', [path.join(ROOT, 'scripts', 'generate-animated-video.js'), ...args], {
      cwd: ROOT,
      detached: process.platform !== 'win32',
      env: { ...process.env, VIDEO_JOB_ID: jobId }
    });
    child.stdout.pipe(stdoutFilter).pipe(out, { end: false });
    child.stderr.pipe(stderrFilter).pipe(out, { end: false });
    let spawnError = null;
    let timedOut = false;
    let killTimer = null;
    const timeout = setTimeout(() => {
      timedOut = true;
      log(`⏱️ geração excedeu o limite total de ${Math.round(timeoutMs / 60000)} min; encerrando somente a árvore do job ${jobId}`);
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch (_error) { /* Processo já terminou. */ }
      killTimer = setTimeout(() => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch (_error) { /* Processo já terminou. */ }
      }, 15000);
      killTimer.unref();
    }, timeoutMs);
    timeout.unref();
    child.on('error', error => { spawnError = error; });
    child.on('close', async code => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      await Promise.allSettled([finished(stdoutFilter), finished(stderrFilter)]);
      out.end();
      const exitCode = timedOut ? 124 : spawnError ? -1 : code;
      logGenerationProcessFinished(observationLogger, {
        videoId,
        jobId,
        startedAt,
        status: exitCode === 0 ? 'completed' : 'failed',
        ...(exitCode === 0 ? {} : { errorCode: timedOut ? 'generation_worker_timeout' : spawnError?.code || `exit_${exitCode}` })
      });
      if (spawnError) observationLogger.logErrorWithContext({ name: spawnError.name, code: spawnError.code }, {
        jobId, videoId, destination: 'local_render'
      });
      resolve({ code: exitCode, timedOut, spawnError: spawnError?.code || null });
    });
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

async function verifyEntryQaManifest(entry, fallbackVideoPath = '') {
  if (!entry?.qaManifestPath) return { status: 'legacy', reason: 'qa_manifest_not_recorded' };
  const expectedPaths = [entry.videoPath || fallbackVideoPath, entry.portraitVideoPath, ...normalizedClips(entry).map(clip => clip.path)]
    .filter(value => typeof value === 'string' && value)
    .map(value => path.isAbsolute(value) ? path.resolve(value) : path.resolve(ROOT, value))
    .filter(value => fs.existsSync(value));
  const masterAlreadyPublished = publicationSucceeded(entry.ytUrl || entry.results?.long?.youtube);
  return verifyVideoQaManifest({
    root: ROOT,
    manifestPath: entry.qaManifestPath,
    manifestSha256: entry.qaManifestSha256,
    expectedPaths,
    allowMissingManifestAssets: true,
    allowMissingThumbnail: masterAlreadyPublished
  });
}

function qaShaForArtifact(qaManifest, artifactPath) {
  if (!Array.isArray(qaManifest?.assetProofs) || typeof artifactPath !== 'string') return null;
  const target = path.isAbsolute(artifactPath) ? path.resolve(artifactPath) : path.resolve(ROOT, artifactPath);
  return qaManifest.assetProofs.find(asset => path.resolve(asset.path) === target)?.sha256 || null;
}

async function uploadToYouTube(videoPath, overrides = {}) {
  try {
    const entry = await readLedgerEntry(videoPath);
    if (!entry || !entry.title) return null;
    const qa = await verifyEntryQaManifest(entry, videoPath);
    if (!['verified', 'legacy'].includes(qa.status)) throw Object.assign(new Error(`QA por hash inválido: ${qa.reason}`), { code: 'VIDEO_QA_MANIFEST_INVALID' });
    assertPublicationVisualGate(qa, videoPath);
    const { uploadWithStudio } = require('../utils/youtube-studio-publisher');
    const { resolveThemeHashtags, themeDescription } = require('../utils/theme-metadata');
    const themeId = overrides.themeId || entry.theme;
    const seo = entry.seo || {};
    const hashtags = resolveThemeHashtags(seo.hashtags, themeId);
    const { MUSIC_CREDIT, musicCreditUsed } = require('../utils/audio-mix');
    const description = [
      seo.description || entry.title,
      process.env.CHANNEL_DESCRIPTION || themeDescription(themeId),
      `Fonte: ${entry.url || entry.originUrl || ''}`,
      ...(entry.thumbnailSource?.credit ? [`Imagem da capa: ${entry.thumbnailSource.credit}`] : []),
      hashtags,
      ...(musicCreditUsed() ? [MUSIC_CREDIT] : [])
    ].filter(Boolean).join('\n\n');
    const result = await uploadWithStudio({
      videoPath: path.isAbsolute(videoPath) ? videoPath : path.join(ROOT, videoPath),
      expectedSha256: qaShaForArtifact(qa, path.isAbsolute(videoPath) ? videoPath : path.join(ROOT, videoPath)),
      jobId: entry.jobId || entry.videoId,
      title: resolvePublicationTitle({ seoTitle: overrides.title || seo.youtubeTitle, title: entry.title,
        sourceTitle: entry.sourceEvidence?.sourceTitle }),
      description,
      privacyStatus: process.env.YT_PRIVACY || 'public',
      ...(typeof entry.thumbnailPath === 'string' && entry.thumbnailPath
        ? { thumbnailPath: path.isAbsolute(entry.thumbnailPath) ? entry.thumbnailPath : path.resolve(ROOT, entry.thumbnailPath) }
        : {})
    });
    log(`⬆️ Studio YouTube: ${result.url || `status ${result.status}; sem URL confirmada`}`);
    return result;
  } catch (error) {
    log(`⚠️ upload YouTube falhou: ${error.message}`);
    if (/exceeded the number of videos/i.test(String(error.message))) {
      await recordYtQuotaResults({ long: { youtube: String(error.message) } }).catch(() => {});
      log('⏸️ limite de uploads do vídeo longo: aguardar 24h, conforme orientação do YouTube');
    }
    await notifyFailure('Upload YouTube falhou', error.message);
    throw error;
  }
}

// Upload cap (24h) is channel-wide across long videos and Shorts. Keep each
// observed refusal by surface, but gate both YouTube surfaces until the latest
// channel-cap retry time. API project quota is a separate Pacific-day block.
const YT_QUOTA_PATH = path.join(STATE_DIR, 'yt-quota.json');
const youtubeQuotaStore = createYouTubeQuotaStore(YT_QUOTA_PATH);
const ytQuotaBlocked = platform => youtubeQuotaStore.blocked(platform || 'youtube');
const recordYtQuotaResults = results => youtubeQuotaStore.recordResults(results);
async function recordQuotaOnPublicationEvent(event) {
  if (event?.result?.failureCode !== 'youtube_upload_limit' || event.result?.status !== 'failed'
    || event.result?.evidence?.kind !== 'confirmed_no_send') return false;
  if (event.platform === 'youtube' && event.scope === 'long') {
    return recordYtQuotaResults({ long: { youtube: event.result } });
  }
  if (event.platform === 'shorts' && event.scope === 'clip') {
    return recordYtQuotaResults({ clips: { [event.artifactPath]: { shorts: event.result } } });
  }
  return false;
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
  // This approved package shares a manifest across its master, covers and
  // parts; all are needed to reverify the later parts on subsequent retries.
  if (isApprovedExistingEpisode(entry)) return { ...summary, clipsRetained: normalizedClips(entry).length };
  let allEntries;
  try {
    const raw = JSON.parse(await fsp.readFile(LEDGER_PATH, 'utf8'));
    if (!Array.isArray(raw.entries)) throw new Error('ledger sem entries');
    allEntries = raw.entries;
  } catch (error) {
    log(`⏭️ limpeza pós-publicação preservou mídia: ledger indisponível (${error.message})`);
    return { ...summary, clipsRetained: normalizedClips(entry).length };
  }
  const protectedPaths = new Set([
    ...queue.map(item => item && item.outPath).filter(Boolean),
    ...(inFlight?.outPath ? [inFlight.outPath] : []),
    ...(interruptedGeneration?.outPath ? [interruptedGeneration.outPath] : [])
  ].map(candidate => path.resolve(ROOT, candidate)));
  const deletionSha = candidate => qaShaForArtifact(options.qaManifest, candidate);
  const artifactReadyForDeletion = async candidate => {
    const expectedSha256 = deletionSha(candidate);
    if (!expectedSha256) return false;
    const ownersQa = await verifyArtifactOwnersForPublication({
      root: ROOT, entries: allEntries, artifactPath: candidate, expectedSha256
    });
    if (ownersQa.status !== 'verified') return false;
    return allArtifactOwnersConfirmed(allEntries, candidate, {
      root: ROOT, maxShorts: options.maxShorts, expectedSha256, requirePublicationEligible: true
    });
  };
  const deletePublishedArtifact = async (candidate, category, expectedSha256) => {
    const target = await safeManagedMediaPath(candidate, ['.mp4']);
    if (!target || protectedPaths.has(path.resolve(target))) return false;
    await deleteMediaWithEvidence({
      root: ROOT,
      filePath: target,
      allowedRoots: [path.join(ROOT, 'data', 'videos')],
      ledgerPath: path.join(STATE_DIR, 'media-deletions.jsonl'),
      disposition: { kind: category, reason: 'todos os destinos esperados e todas as referências do arquivo foram confirmados' },
      expectedSha256,
      ownerProofs: artifactOwnerPublicationProofs(allEntries, target, { root: ROOT, maxShorts: options.maxShorts })
    });
    return true;
  };
  const masterSha256 = deletionSha(videoPath);
  const masterReady = masterSha256 && await artifactReadyForDeletion(videoPath);
  const ytConfirmed = publicationSucceeded(results?.long?.youtube || entry.ytUrl);
  if (masterReady && longUploadsSucceeded(entry, results, { root: ROOT, expectedSha256: masterSha256 })) {
    summary.master = await deletePublishedArtifact(videoPath, 'confirmed-youtube-master', masterSha256);
    if (summary.master && ytConfirmed && entry.thumbnailPath) {
      summary.thumbnail = await unlinkManagedMedia(entry.thumbnailPath, ['.jpg', '.jpeg', '.png', '.webp']);
    }
  } else if (longUploadsSucceeded(entry, results, { root: ROOT }) && !masterReady) {
    log(`⏭️ master preservado: publicação/QA ainda não está vinculada ao hash atual em todas as referências (${path.basename(videoPath)})`);
  }

  for (const [index, clip] of normalizedClips(entry).entries()) {
    const clipSha256 = deletionSha(clip.path);
    const allClipOwnersPublished = clipSha256 && await artifactReadyForDeletion(clip.path);
    if (allClipOwnersPublished && clipCanBeDeletedAfterPublication(entry, results, index, {
      root: ROOT, maxShorts: options.maxShorts, expectedSha256: clipSha256
    })) {
      if (await deletePublishedArtifact(clip.path, 'confirmed-social-clip', clipSha256)) summary.clipsRemoved++;
      else summary.clipsRetained++;
    } else {
      if (clipCanBeDeletedAfterPublication(entry, results, index, { root: ROOT, maxShorts: options.maxShorts })
        && !allClipOwnersPublished) log(`⏭️ corte preservado: outra referência ao mesmo arquivo ainda tem destino pendente (${path.basename(clip.path)})`);
      summary.clipsRetained++;
    }
  }
  return summary;
}

async function persistDiskMediaInventory(reason) {
  const inventory = await scanDiskMediaInventory({ root: ROOT, stateDir: path.relative(ROOT, STATE_DIR) });
  await writeJsonAtomic(path.join(STATE_DIR, 'disk-media-inventory.json'), inventory);
  const { totals } = inventory;
  log(`[disco/${reason}] inventário: ${totals.files} arquivos de vídeo, ${totals['ledger-linked']} vinculados, ${totals.queued} na fila, ${totals.untracked} sem vínculo`);
  return inventory;
}

async function markYouTubeDone(videoPath, url) {
  const youtubeUrl = typeof url === 'string' ? url : url?.url;
  if (typeof youtubeUrl !== 'string' || !/^https?:\/\//i.test(youtubeUrl)) return false;
  try {
    await updateTopicLedger(LEDGER_PATH, raw => {
      for (const e of (raw.entries || []).reverse()) {
        if (sameVideoPath(e.videoPath, videoPath)) { e.ytUrl = youtubeUrl; break; }
      }
      return raw;
    });
    return true;
  } catch (error) { log(`⚠️ não foi possível registrar sucesso do YouTube no ledger: ${error.message}`); }
}

// Guarda os resultados da publicação no ledger (pra saber depois se algum
// corte deu ERRO, sem re-analisar — decide a limpeza do pendente).
async function markResults(videoPath, results) {
  try {
    await updateTopicLedger(LEDGER_PATH, raw => {
      for (const e of (raw.entries || []).reverse()) {
        if (!sameVideoPath(e.videoPath, videoPath)) continue;
        const current = e.results && typeof e.results === 'object' ? e.results : {};
        const merged = {
          ...current,
          ...results,
          long: { ...(current.long || {}) },
          clips: { ...(current.clips || {}) }
        };
        for (const [platform, value] of Object.entries(results?.long || {})) {
          const previous = current.long?.[platform];
          if (publicationSucceeded(previous) && !publicationSucceeded(value)) continue;
          if (!shouldAttemptPublication(previous) && shouldAttemptPublication(value)) continue;
          merged.long[platform] = value;
        }
        for (const [clipPath, values] of Object.entries(results?.clips || {})) {
          const previousClip = current.clips?.[clipPath] || {};
          merged.clips[clipPath] = { ...previousClip };
          for (const [platform, value] of Object.entries(values || {})) {
            const previous = previousClip[platform];
            if (publicationSucceeded(previous) && !publicationSucceeded(value)) continue;
            if (!shouldAttemptPublication(previous) && shouldAttemptPublication(value)) continue;
            merged.clips[clipPath][platform] = value;
          }
        }
        e.results = merged;
        break;
      }
      return raw;
    });
    return true;
  } catch (error) {
    log(`⚠️ não foi possível salvar resultados de publicação no ledger: ${error.message}`);
    return false;
  }
}

// Fila de pendências: vídeo que não subiu por cota (publish rodou "sem YT")
// é repetido nos ciclos seguintes até subir. Antes ele ficaria para sempre
// sem publicar no YouTube — o publish só roda no momento da geração.
async function retryPendingYouTube({ onlySocial = false } = {}) {
  if (isVideoGenerationPaused()) {
    log('⏸️ retries de publicação aguardam a migração visual');
    return;
  }
  try {
    try { await persistDiskMediaInventory(onlySocial ? 'retry-social' : 'retry-publicação'); }
    catch (error) { log(`⚠️ inventário de mídia indisponível; retries do ledger continuam: ${error.message}`); }
    const youtubeBlocked = await ytQuotaBlocked('youtube');
    const shortsBlocked = await ytQuotaBlocked('shorts');
    const raw = JSON.parse(await fsp.readFile(LEDGER_PATH, 'utf8'));
    // Escaneia TODAS as entradas (o ledger não é estritamente cronológico) e
    // pega a pendência mais recente cujo arquivo ainda existe no disco.
    const protectedPaths = new Set([
      ...queue.map(item => item && item.outPath).filter(Boolean),
      ...(inFlight && inFlight.outPath ? [inFlight.outPath] : []),
      ...(interruptedGeneration?.outPath ? [interruptedGeneration.outPath] : [])
    ].map(item => path.resolve(ROOT, item)));
    const maxShorts = Number(process.env.MAX_SHORTS || Number.MAX_SAFE_INTEGER);
    const pendingYoutubeWork = entry => {
      const results = entry.results || {};
      const longDone = publicationSucceeded(entry.ytUrl || results.long?.youtube);
      const longMayRetry = shouldAttemptPublication(entry.ytUrl || results.long?.youtube, Date.now(), {
        platform: 'youtube', artifactPath: entry.videoPath, root: ROOT, qaManifestPath: entry.qaManifestPath
      });
      const clips = normalizedClips(entry);
      const shortsClips = clips.filter(isShortsTargeted);
      const parsedMaxShorts = Number(maxShorts);
      const shortsCount = Math.min(shortsClips.length, Math.max(0, Number.isFinite(parsedMaxShorts) ? Math.floor(parsedMaxShorts) : 1));
      const pendingShort = shortsClips.slice(0, shortsCount).some(clip => {
        const result = Object.entries(results.clips || {})
          .find(([resultPath]) => sameVideoPath(resultPath, clip.path))?.[1];
        return shouldAttemptPublication(result?.shorts, Date.now(), {
          platform: 'shorts', artifactPath: clip.path, root: ROOT, qaManifestPath: entry.qaManifestPath
        });
      });
      const socialUpload = require('./upload-to-socials');
      const pendingSocial = clips.some(clip => {
        const result = Object.entries(results.clips || {})
          .find(([resultPath]) => sameVideoPath(resultPath, clip.path))?.[1] || {};
        return ['tiktok', 'kwai', 'instagram', 'x'].some(platform => isPlatformTargeted(clip, platform)
          && shouldInspectSocialRetry(result[platform], Date.now(), {
            platform, artifactPath: clip.path, root: ROOT,
            handlerAvailable: socialUpload.isSocialHandlerAvailable(platform)
          }));
      });
      const pendingYoutube = (!youtubeBlocked && !longDone && longMayRetry) || (!shortsBlocked && pendingShort);
      return onlySocial ? pendingSocial : pendingYoutube || pendingSocial;
    };
    const candidatos = sortRetryEntriesOldestFirst((raw.entries || [])
      .filter(e => isBackgroundRetryEligible(e) && typeof e.videoPath === 'string' && e.videoPath
        && (e.renderer === APPROVED_NARRATIVE_RENDERER
          || (e.jobId === 'pulso-internet-reference-20261029' && e.renderer === 'owner-approved-internet-reference-v2'))
        && e.publicationEligible === true
        && pendingYoutubeWork(e) && !protectedPaths.has(path.resolve(ROOT, e.videoPath))));
    const pendentes = [];
    for (const entry of candidatos) {
      const media = await resolveRetryEntryMedia(entry, safeManagedMediaPath);
      if (media) pendentes.push({ entry, media });
    }
    let socialUploadsAttemptedThisCycle = 0;
    const socialPlatformsAttemptedThisCycle = new Set();
    for (const candidate of pendentes) {
      if (publicationImminent()) break;
      let { entry: e } = candidate;
      const { media } = candidate;
      if (onlySocial && socialUploadsAttemptedThisCycle >= SOCIAL_UPLOADS_PER_RETRY) break;
      const videoPath = path.isAbsolute(e.videoPath) ? path.resolve(e.videoPath) : path.resolve(ROOT, e.videoPath);
      let qaManifest = await verifyEntryQaManifest(e, videoPath);
      if (qaManifest.status === 'verified' && qaManifest.visualReview === 'pending') {
        try {
          const { resumeDelegatedReview } = require('../utils/resume-delegated-review');
          const { applyDelegatedPublicationReview } = require('../utils/delegated-publication-review');
          const recovered = await resumeDelegatedReview({ entry: e, verified: qaManifest,
            apply: entry => applyDelegatedPublicationReview({ root: ROOT, manifestPath: entry.qaManifestPath, ledgerPath: LEDGER_PATH }),
            reloadEntry: readLedgerEntry, verifyEntry: entry => verifyEntryQaManifest(entry, videoPath) });
          e = recovered.entry;
          qaManifest = recovered.verified;
          if (recovered.status === 'approved') log(`✅ revisão automática retomada por hash: ${path.basename(videoPath)}`);
        } catch (error) {
          log(`⏸️ revisão automática ainda pendente (${String(error.code || error.name || 'Error').slice(0, 80)}): ${path.basename(videoPath)}`);
          continue;
        }
      }
      const routeDecision = autonomousNarrativePublicationDecision(e, qaManifest);
      if (!routeDecision.allowed) {
        log(`⏸️ retry legado/fora da rota narrativa retido (${routeDecision.reason}): ${path.basename(e.videoPath)}`);
        continue;
      }
      const masterVisualAllowed = Boolean(media.masterPath) && publicationVisualGate(qaManifest, videoPath).allowed;
      const approvedClipExists = media.clipPaths.some(clipPath => publicationVisualGate(qaManifest, clipPath).allowed);
      if (!masterVisualAllowed && !approvedClipExists) {
        log('⏸️ retry suspenso: QA visual ainda não aprovado (' + path.basename(e.videoPath) + ')');
        continue;
      }
      let updatedResults = { ...(e.results || {}), long: { ...(e.results?.long || {}) }, clips: { ...(e.results?.clips || {}) } };
      let didWork = false;
      const videoId = typeof e.videoId === 'string' && /^vid_[a-f0-9]{24}$/.test(e.videoId)
        ? e.videoId : videoIdForPath(videoPath);
      const jobId = typeof e.jobId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(e.jobId)
        ? e.jobId : `legacy_${videoId}`;
      const observePublication = createPublicationObserver({ logger: observationLogger, jobId, videoId });
      const onPublicationState = createPersistThenObservePublicationState({
        persist: async event => {
          await recordPublicationResult(LEDGER_PATH, videoPath, event, { root: ROOT });
          await recordQuotaOnPublicationEvent(event).catch(error => log(`⚠️ estado de limite YouTube não pôde ser salvo (${String(error.code || error.name || 'Error').slice(0, 80)})`));
        },
        observe: observePublication
      });
      if (media.masterPath && masterVisualAllowed && !onlySocial && !youtubeBlocked && !publicationImminent()
        && !publicationSucceeded(e.ytUrl || updatedResults.long.youtube)
        && shouldAttemptPublication(e.ytUrl || updatedResults.long.youtube, Date.now(), {
          platform: 'youtube', artifactPath: videoPath, root: ROOT, qaManifestPath: e.qaManifestPath
        })) {
        log(`🔁 vídeo longo pendente de YouTube: ${path.basename(e.videoPath)}`);
        const { checkpointedPublication } = require('./upload-to-socials');
        const longResult = await checkpointedPublication({
          scope: 'long', platform: 'youtube', videoPath, previous: e.ytUrl || updatedResults.long.youtube,
          artifactSha256: qaShaForArtifact(qaManifest, videoPath),
          qaManifestPath: e.qaManifestPath,
          onPublicationState,
          upload: () => uploadToYouTube(videoPath, { themeId: e.theme })
        });
        updatedResults.long.youtube = longResult;
        didWork = true;
        if (publicationSucceeded(longResult)) await markYouTubeDone(e.videoPath, longResult);
      }
      const { retryPendingYouTubeShorts, retryPendingSocials, PLATFORM_BUDGET_MS } = require('./upload-to-socials');
      if (!onlySocial && !shortsBlocked && !publicationImminent()) {
        const previousClipResults = JSON.stringify(updatedResults.clips || {});
        updatedResults = await retryPendingYouTubeShorts({
          entry: e,
          results: updatedResults,
          qaManifest,
          maxShorts,
          onPublicationState
        });
        if (JSON.stringify(updatedResults.clips || {}) !== previousClipResults) didWork = true;
      }
      {
        const socialRetry = await retryPendingSocials({
          entry: e,
          results: updatedResults,
          qaManifest,
          maxUploads: Math.min(queue.length ? 1 : SOCIAL_UPLOADS_PER_RETRY, onlySocial
            ? SOCIAL_UPLOADS_PER_RETRY - socialUploadsAttemptedThisCycle : SOCIAL_UPLOADS_PER_RETRY),
          shouldYield: () => publicationImminent(),
          // Do not start a long retry that can occupy the serial publisher
          // beyond the next queued slot. Shorter destinations may still run.
          canStartPlatform: platform => !publicationImminent(PLATFORM_BUDGET_MS[platform] || 8 * 60 * 1000),
          skipPlatforms: onlySocial ? [...socialPlatformsAttemptedThisCycle] : [],
          onPublicationState
        });
        updatedResults = socialRetry.results;
        socialUploadsAttemptedThisCycle += socialRetry.uploadsAttempted;
        for (const platform of socialRetry.attemptedPlatforms || []) socialPlatformsAttemptedThisCycle.add(platform);
        if (socialRetry.uploadsAttempted > 0) didWork = true;
      }
      if (!didWork) continue;
      if (await recordYtQuotaResults(updatedResults)) {
        log('⏸️ recusa do YouTube registrada por destino; próxima tentativa respeita o prazo do motivo');
      }
      if (publicationSucceeded(e.ytUrl || updatedResults.long.youtube)) {
        await markYouTubeDone(e.videoPath, e.ytUrl || updatedResults.long.youtube);
      }
      const resultsPersisted = await markResults(e.videoPath, updatedResults);
      if (resultsPersisted) {
        const summary = await cleanupPublishedMedia(e.videoPath, e, updatedResults, { maxShorts, qaManifest });
        const thumbnailState = summary.thumbnail == null ? 'ausente' : summary.thumbnail ? 'removida' : 'preservada';
        log(`🧹 retry concluído: master ${summary.master ? 'removido' : 'preservado'}, thumbnail ${thumbnailState}, ${summary.clipsRemoved} corte(s) removido(s), ${summary.clipsRetained} preservado(s)`);
      }
      if (!onlySocial || socialUploadsAttemptedThisCycle >= SOCIAL_UPLOADS_PER_RETRY) {
        break; // publicação normal conserva um vídeo; retry social distribui o lote sem repetir plataforma no ciclo.
      }
    }
  } catch (error) { log(`⚠️ retry do YouTube não conseguiu ler o ledger: ${error.message}`); }
}

async function publishEverywhere(outPath) {
  let publicationContext = {};
  let submissionStarted = false;
  try {
    const entry = await readLedgerEntry(outPath);
    if (!entry || !entry.title) { log('⚠️ upload: ledger sem entrada'); return { slotConsumed: false }; }
    const absoluteOutPath = path.isAbsolute(outPath) ? path.resolve(outPath) : path.resolve(ROOT, outPath);
    const videoId = typeof entry.videoId === 'string' && /^vid_[a-f0-9]{24}$/.test(entry.videoId)
      ? entry.videoId
      : videoIdForPath(absoluteOutPath);
    const jobId = typeof entry.jobId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(entry.jobId)
      ? entry.jobId
      : `legacy_${videoId}`;
    const observePublication = createPublicationObserver({ logger: observationLogger, jobId, videoId });
    publicationContext = { jobId, videoId };
    observationLogger.logContentPipeline('publication_started', videoId, 'started', {
      jobId, destination: 'social_publish'
    });

    if (!isPublicationEligible(entry)) {
      observationLogger.logContentPipeline('publication_preflight', videoId, 'failed', {
        jobId, destination: 'social_publish', errorCode: 'source_evidence_unverified'
      });
      observationLogger.logContentPipeline('publication_finished', videoId, 'failed', {
        jobId, destination: 'social_publish'
      });
      log(`🚫 publicação bloqueada: fonte sem contexto verificável (${path.basename(outPath)})`);
      return { slotConsumed: false };
    }

    const qaManifest = await verifyEntryQaManifest(entry, absoluteOutPath);
    const routeDecision = autonomousNarrativePublicationDecision(entry, qaManifest);
    if (!routeDecision.allowed) {
      observationLogger.logContentPipeline('publication_preflight', videoId, 'failed', {
        jobId, destination: 'social_publish', errorCode: routeDecision.reason
      });
      observationLogger.logContentPipeline('publication_finished', videoId, 'failed', {
        jobId, destination: 'social_publish'
      });
      log(`⏸️ publicação retida até passar a rota narrativa atual (${routeDecision.reason}): ${path.basename(outPath)}`);
      return { slotConsumed: false };
    }
    if (!['verified', 'legacy'].includes(qaManifest.status)) {
      observationLogger.logContentPipeline('publication_preflight', videoId, 'failed', {
        jobId, destination: 'social_publish', errorCode: 'video_qa_manifest_invalid'
      });
      observationLogger.logContentPipeline('publication_finished', videoId, 'failed', {
        jobId, destination: 'social_publish'
      });
      log(`🚫 QA por hash reprovado (${qaManifest.reason}); artefato não será publicado`);
      return { slotConsumed: false };
    }
    const visualGate = publicationVisualGate(qaManifest, absoluteOutPath);
    if (!visualGate.allowed) {
      observationLogger.logContentPipeline('publication_preflight', videoId, 'failed', {
        jobId, destination: 'social_publish', errorCode: 'publication_visual_review_required'
      });
      observationLogger.logContentPipeline('publication_finished', videoId, 'failed', {
        jobId, destination: 'social_publish'
      });
      log('🚫 publicação bloqueada: QA visual ' + (qaManifest.visualReview || 'sem aprovação') + ' (' + path.basename(outPath) + ')');
      return { slotConsumed: false };
    }
    if (qaManifest.status === 'legacy') log('ℹ️ vídeo legado sem manifesto QA; a verificação técnica FFmpeg abaixo será executada');

    // QA de sanidade: nunca publicar um mp4 corrompido/sem áudio/duração absurda.
    const health = await probeVideoHealth(absoluteOutPath);
    if (!health.ok) {
      observationLogger.logContentPipeline('publication_preflight', videoId, 'failed', {
        jobId, destination: 'social_publish', errorCode: 'video_health_rejected'
      });
      observationLogger.logContentPipeline('publication_finished', videoId, 'failed', {
        jobId, destination: 'social_publish'
      });
      log(`🚫 vídeo falhou no QA pré-publicação (${health.issues.join('; ')}) — publicação ABORTADA`);
      await notifyFailure('Vídeo reprovado no QA pré-publicação', `${outPath}\n${health.issues.join('\n')}`);
      return { slotConsumed: false };
    }
    log(`✅ QA ok (${health.duration ? health.duration.toFixed(1) + 's' : '?'}, ${(health.sizeBytes / 1e6).toFixed(1)}MB)`);

    const { uploadToAll } = require('./upload-to-socials');
    const clips = normalizedClips(entry).map(item => {
      const clip = { ...item, title: item.title || entry.title };
      if (clip.path) clip.path = path.isAbsolute(clip.path) ? path.resolve(clip.path) : path.resolve(ROOT, clip.path);
      return clip;
    });
    const quotaBlocked = await ytQuotaBlocked('youtube');
    const shortsBlocked = await ytQuotaBlocked('shorts');
    if (quotaBlocked || shortsBlocked) log(`⏸️ pausas YouTube: longo=${quotaBlocked}, Shorts=${shortsBlocked}; demais destinos continuam`);
    const maxShorts = Number(process.env.MAX_SHORTS || Number.MAX_SAFE_INTEGER);
    log(`⬆️ publicando: ${quotaBlocked ? '(sem YT) ' : 'YouTube longo + Shorts, '}${clips.length} cortes/partes sociais em rotas habilitadas`);
    submissionStarted = true;
    const results = await uploadToAll({
      videoPath: absoluteOutPath,
      clips,
      qaManifest,
      title: resolvePublicationTitle({ seoTitle: entry.seo?.youtubeTitle, title: entry.title,
        sourceTitle: entry.sourceEvidence?.sourceTitle }),
      hashtags: entry.seo?.hashtags,
      themeId: entry.theme,
      sourceUrl: entry.url || '',
      thumbnailCredit: entry.thumbnailSource?.credit || '',
      skipYouTube: quotaBlocked,
      skipShorts: shortsBlocked,
      maxShorts,
      ...(entry.seo ? { seo: entry.seo } : {}),
      ...(typeof entry.thumbnailPath === 'string' && entry.thumbnailPath
        ? { thumbnailPath: path.isAbsolute(entry.thumbnailPath) ? entry.thumbnailPath : path.resolve(ROOT, entry.thumbnailPath) }
        : {}),
      previousResults: entry.results || {},
      qaManifestPath: entry.qaManifestPath,
      onPublicationState: async event => {
        await recordPublicationResult(LEDGER_PATH, absoluteOutPath, event, { root: ROOT });
        await recordQuotaOnPublicationEvent(event).catch(error => log(`⚠️ estado de limite YouTube não pôde ser salvo (${String(error.code || error.name || 'Error').slice(0, 80)})`));
        observePublication(event);
      }
    });
    const longOk = publicationSucceeded(results.long.youtube);
    if (longOk) await markYouTubeDone(outPath, results.long.youtube);
    if (await recordYtQuotaResults(results)) {
      log('⏸️ limite YouTube registrado por superfície: uploadLimitExceeded bloqueia longo e Shorts por 24h; quota da API respeita o dia Pacific');
    }
    const clipResultCount = Object.keys(results.clips || {}).length;
    if (clipResultCount) log(`   resultados de ${clipResultCount} corte(s) persistidos`);

    // Persiste o retorno por plataforma antes de decidir quais cópias locais
    // ainda são necessárias para recuperação.
    const resultsPersisted = await markResults(outPath, results);
    observationLogger.logContentPipeline('publication_finished', videoId, 'completed', {
      jobId, destination: 'social_publish'
    });
    if (resultsPersisted) {
      const summary = await cleanupPublishedMedia(outPath, entry, results, { maxShorts, qaManifest });
      const thumbnailState = summary.thumbnail == null ? 'ausente' : summary.thumbnail ? 'removida' : 'preservada';
      log(`🧹 limpeza pós-publicação: master ${summary.master ? 'removido' : 'preservado'}, thumbnail ${thumbnailState}, ${summary.clipsRemoved} corte(s) removido(s), ${summary.clipsRetained} preservado(s)`);
    }
    return { slotConsumed: true };
  } catch (error) {
    observationLogger.logErrorWithContext({ name: error.name, code: error.code }, {
      ...publicationContext, destination: 'social_publish', stage: 'publication'
    });
    if (publicationContext.videoId) {
      observationLogger.logContentPipeline('publication_finished', publicationContext.videoId, 'failed', {
        ...publicationContext, destination: 'social_publish'
      });
    }
    log(`⚠️ publicação falhou: ${error.message}`);
    await notifyFailure('Publicação falhou', error.message);
    return { slotConsumed: submissionStarted };
  }
}

async function generate({ recap, recapWindow, outPath, jobId: requestedJobId, seed: requestedSeed,
  attemptStartedAt, attemptCount = 0, theme, slotAt, onStart, sourceVisualsOnly = false, formatId, article }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalOutPath = outPath || `data/videos/${recap ? 'recap' : 'auto'}_${stamp}.mp4`;
  const jobId = requestedJobId || createJobId();
  const seed = Number.isSafeInteger(requestedSeed) && requestedSeed >= 0 && requestedSeed < 1e9
    ? requestedSeed
    : crypto.createHash('sha256').update(jobId).digest().readUInt32BE(0) % 1e9;
  const videoId = videoIdForPath(finalOutPath);
  const logFile = path.join(ROOT, 'logs', `gen_${stamp}.log`);
  if (onStart) {
    await onStart({
      version: 1,
      outPath: finalOutPath,
      theme: theme || THEME,
      jobId,
      startedAt: attemptStartedAt || new Date().toISOString(),
      seed,
      attemptCount: Math.min(1000, Math.max(1, attemptCount + 1)),
      ...(slotAt ? { slotAt } : {}),
      ...(sourceVisualsOnly ? { sourceVisualsOnly: true } : {}),
      ...(formatId ? { formatId } : {}),
      ...(article ? { article } : {}),
      ...(recap && recapWindow ? { recap: true, recapWindow } : {})
    });
  }
  const args = recap
    ? ['--recap', '--words', '950', '--out', finalOutPath, '--theme', theme || THEME, '--days', String(RECAP_EVERY_DAYS), '--seed', String(seed)]
    : ['--auto', '--words', '950', '--out', finalOutPath, '--theme', theme || THEME, '--seed', String(seed)];
  // Retry com o mesmo outPath + --resume: etapas com cache (roteiro/narração/
  // prints) são reaproveitadas e, se o render já concluiu, pula direto.
  if (outPath) args.push('--resume');
  if (sourceVisualsOnly) args.push('--no-images');
  if (formatId) args.push('--format', formatId);
  if (article) args.push('--article', article.url, '--topic', article.title,
    '--source', article.source, '--source-age-hours', String(article.ageHoursAtCapture),
    '--source-captured-at', article.capturedAt, '--source-context-hash', article.contextHash);
  log(`▶ gerando ${recap ? 'RESUMO SEMANAL' : `vídeo [tema: ${theme || THEME}]`} → ${finalOutPath}`);
  const childResult = await runGenerator(args, logFile, { jobId, videoId });
  if (childResult.code === 0) {
    log(`✅ pronto: ${finalOutPath}`);
    // A publicação acontece no consumer, no slot programado. Publicar aqui
    // apagaria o arquivo antes da fila e faria o consumer receber um path morto.
    return { ok: true, outPath: finalOutPath, jobId, videoId };
  }
  let failureCode = null;
  try { failureCode = childResult.timedOut ? 'generation_worker_timeout' : generationFailureCodeFromLog(await fsp.readFile(logFile, 'utf8')); }
  catch (_error) { /* o código da falha permanece desconhecido */ }
  log(`❌ falhou (code ${childResult.code}${failureCode ? `; ${failureCode}` : ''}) — log: ${logFile}`);
  if (failureCode !== 'no_fresh_topic_candidates') {
    await notifyFailure('Geração de vídeo falhou', `motivo: ${failureCode || childResult.spawnError || 'erro_desconhecido'}\nexit code ${childResult.code}\nlog: ${logFile}`);
  }
  return { ok: false, outPath: finalOutPath, jobId, videoId, failureCode, seed,
    retryable: isRetryableGenerationFailure(failureCode) };
}

// The explicit shared profile may prepare one episode during publication.
// The live hardware gate and Android device locks remain mandatory.
const PIPELINED_PRODUCTION = process.env.PULSO_PIPELINED_PRODUCTION === '1'
  && process.env.PULSO_CONSTRAINED_RENDER === '1' && process.env.PULSO_RENDER_WITH_TRAINING === '1';
const MAX_QUEUE = PIPELINED_PRODUCTION ? 1 : Number(process.env.MAX_QUEUE || 1);
let queue = [];
let inFlight = null;
let interruptedGeneration = null;
let queueWritePromise = Promise.resolve();
let diskCleanupPromise = null;
let generationInProgress = false;
let youtubeRetryInProgress = false;
let youtubeRetryPending = true;
let socialRetryPending = false;
let producerRuntimeState = 'starting';
let consumerRuntimeState = 'starting';
let lastGenerationFailure = null;
let nextGenerationRetryAt = null;
let nextConfiguredSlotAt = null;
let lastMissedSlotAt = null;
let pendingMissedSlotAt = null;
let healthWriteWarningLogged = false;
let observedRenderGate = null;
let lastRenderGateLogAt = 0;

function publicationImminent(leadMs = 120000) {
  return queuedPublicationImminent(queue, Date.now(), leadMs, pendingMissedSlotAt, nextConfiguredSlotAt);
}

async function persistRuntimeHealth() {
  try {
    await runtimeHealthWriter.update({
      status: 'active',
      configuredVideosPerDay: VIDEOS_PER_DAY,
      intervalMinutes: INTERVAL_MS / 60000,
      nextConfiguredSlotAt,
      lastGenerationFailure,
      nextGenerationRetryAt,
      renderGate: observedRenderGate,
      producer: { state: producerRuntimeState, slotAt: nextConfiguredSlotAt },
      consumer: { state: consumerRuntimeState, lastMissedSlotAt },
      queue: { pending: queue.length, inFlight: Boolean(inFlight) },
      retry: { inProgress: youtubeRetryInProgress, youtubePending: youtubeRetryPending, socialPending: socialRetryPending }
    });
    healthWriteWarningLogged = false;
  } catch (error) {
    if (!healthWriteWarningLogged) {
      log(`⚠️ estado de saúde do scheduler não pôde ser salvo: ${error.message}`);
      healthWriteWarningLogged = true;
    }
  }
}

function setRuntimeComponent(component, state) {
  if (component === 'producer') producerRuntimeState = state;
  if (component === 'consumer') consumerRuntimeState = state;
  return persistRuntimeHealth();
}

async function waitForRenderResources() {
  for (;;) {
    if (isScheduledGenerationPaused()) {
      await setRuntimeComponent('producer', 'paused_backlog');
      return false;
    }
    const gate = probeRenderHardwareGate();
    observedRenderGate = {
      observedAt: gate.observedAt,
      renderSafe: gate.renderSafe,
      logicalCpus: gate.logicalCpus,
      loadAverage: gate.loadAverage,
      availableMemoryBytes: gate.availableMemoryBytes,
      swapFreeBytes: gate.swapFreeBytes,
      gpuBusyPercent: gate.gpuBusyPercent,
      reasons: gate.reasons
    };
    if (gate.renderSafe) {
      await persistRuntimeHealth();
      return true;
    }
    await setRuntimeComponent('producer', 'waiting_resources');
    const now = Date.now();
    if (now - lastRenderGateLogAt >= 5 * 60 * 1000) {
      log(`⏸️ aguardando recursos de render; próxima checagem em ${Math.round(RESOURCE_GATE_RECHECK_MS / 1000)} s (${(gate.reasons || []).join(', ') || 'gate fechado'})`);
      lastRenderGateLogAt = now;
    }
    await sleep(RESOURCE_GATE_RECHECK_MS);
  }
}

async function runScheduledDiskCleanup(reason) {
  if (youtubeRetryInProgress) {
    log(`[disco/${reason}] limpeza adiada enquanto o retry do YouTube está ativo`);
    return null;
  }
  if (diskCleanupPromise) return diskCleanupPromise;
  const protectedVideoPaths = [
    ...queue.map(item => item && item.outPath).filter(Boolean),
    ...(inFlight && inFlight.outPath ? [inFlight.outPath] : []),
    ...(interruptedGeneration && interruptedGeneration.outPath ? [interruptedGeneration.outPath] : [])
  ];
  diskCleanupPromise = cleanupDisk({
    root: ROOT,
    stateDir: STATE_DIR,
    protectedVideoPaths,
    deleteUploadedMedia: true,
    deleteUnapprovedMedia: true,
    uploadedGraceHours: 0,
    apply: true,
    log: message => log(`[disco/${reason}] ${message}`)
  });
  try {
    const report = await diskCleanupPromise;
    if (report.inventory) {
      await writeJsonAtomic(path.join(STATE_DIR, 'disk-media-inventory.json'), report.inventory);
      const { totals } = report.inventory;
      log(`[disco/${reason}] inventário: ${totals.files} arquivos de vídeo, ${totals['ledger-linked']} vinculados, ${totals.queued} na fila, ${totals.untracked} sem vínculo`);
    }
    return report;
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
  const recovery = await recoverPersistedQueue({
    queuePath: QUEUE_PATH,
    ledgerPath: LEDGER_PATH,
    root: ROOT,
    isManagedVideo: async candidate => Boolean(await safeManagedMediaPath(candidate, ['.mp4'])),
    log
  });
  if (!recovery.ok) {
    log(recovery.message);
    return false;
  }
  if (!recovery.found) return true;
  queue = recovery.pending;
  await persistQueue();
  if (queue.length) log(`📦 ${queue.length} vídeo(s) recuperado(s) da fila persistida`);
  return true;
}

async function quarantineQueueOutsideNarrativeRoute() {
  if (!queue.length) return 0;
  const heldPath = path.join(STATE_DIR, 'migration-held-publish-queue.json');
  let heldState = { version: 1, updatedAt: null, entries: [] };
  try {
    const parsed = JSON.parse(await fsp.readFile(heldPath, 'utf8'));
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) throw new Error('fila de retenção de migração inválida');
    heldState = parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const known = new Set(heldState.entries.map(item => `${item?.jobId || ''}:${item?.outPath || ''}`));
  const keep = [];
  const hold = [];
  for (const item of queue) {
    const entry = await readLedgerEntry(item?.outPath || '');
    const qaManifest = entry ? await verifyEntryQaManifest(entry, item.outPath) : { status: 'missing' };
    const decision = autonomousNarrativePublicationDecision(entry, qaManifest);
    if (decision.allowed) {
      keep.push(item);
      continue;
    }
    const key = `${item?.jobId || ''}:${item?.outPath || ''}`;
    if (!known.has(key)) {
      hold.push({ ...item, migrationHold: { at: new Date().toISOString(), reason: decision.reason || 'outside_narrative_route' } });
      known.add(key);
    }
    log(`⏸️ item antigo preservado fora da fila ativa (${decision.reason}): ${path.basename(item?.outPath || 'saída-desconhecida')}`);
  }
  if (!hold.length && keep.length === queue.length) return 0;
  heldState.entries.push(...hold);
  heldState.updatedAt = new Date().toISOString();
  await writeJsonAtomic(heldPath, heldState);
  queue = keep;
  await persistQueue();
  return hold.length;
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
  log(`🔄 ${ACTIVE_THEMES.length} tema(s) ativo(s) no rodízio`);
  log(`🗓️ recap semanal ${WEEKLY_RECAP_ENABLED ? 'habilitado' : 'desabilitado'}${WEEKLY_RECAP_ENABLED ? ` · cadência ${RECAP_EVERY_DAYS} dia(s)` : ''}`);
  if (PIPELINED_PRODUCTION) log('⚙️ produção compartilhada: até um próximo vídeo pronto enquanto o anterior é publicado; gate de recursos ativo');
  await setRuntimeComponent('producer', 'waiting');

  for (;;) {
    if (isScheduledGenerationPaused()) {
      await setRuntimeComponent('producer', 'paused_backlog');
      await sleep(30000);
      continue;
    }
    if (nextGenerationRetryAt) {
      const remainingMs = Date.parse(nextGenerationRetryAt) - Date.now();
      if (Number.isFinite(remainingMs) && remainingMs > 0) {
        await setRuntimeComponent('producer', 'backoff');
        await sleep(Math.min(remainingMs, 30000));
        continue;
      }
      lastGenerationFailure = null;
      nextGenerationRetryAt = null;
      await persistRuntimeHealth();
    }

    if (producerMustWait({ queuedCount: queue.length, maxQueue: canRunMigrationCanary() ? 1 : MAX_QUEUE,
      inFlight, allowPublicationOverlap: PIPELINED_PRODUCTION })) {
      await setRuntimeComponent('producer', 'waiting_queue');
      await sleep(30000);
      continue;
    }
    if (producerMustWaitForRetry({ youtubeRetryPending, socialRetryPending, youtubeRetryInProgress, inFlight,
      allowPublicationOverlap: PIPELINED_PRODUCTION })) {
      await setRuntimeComponent('producer', 'waiting_social_retry');
      await sleep(30000);
      continue;
    }

    if (!interruptedGeneration) {
      const deferred = await deferredGenerationQueue.claimNext({
        skipCompleted: async candidate => queue.some(item => sameAttempt(item, candidate, ROOT))
      });
      if (deferred) {
        interruptedGeneration = deferred;
        log(`♻️ recuperação pendente retomada (${deferred.jobId}, ${path.basename(deferred.outPath)})`);
      }
    }

    // Calcula quanto tempo falta pro próximo slot de postagem
    const now = Date.now();
    const genMs = await estimateGenerationMs();
    const cutoffMs = producerLeadTimeMs({ estimatedGenerationMs: genMs, intervalMs: INTERVAL_MS,
      allowPublicationOverlap: PIPELINED_PRODUCTION });

    // Calcula o próximo slot baseado no startedAt + N × intervalo
    const state = await readState();
    const startedAt = state.startedAt ? new Date(state.startedAt).getTime() : now;
    const nextSlot = producerTargetSlot({ now, startedAt, intervalMs: INTERVAL_MS, pendingMissedSlotAt });
    nextConfiguredSlotAt = new Date(nextSlot).toISOString();
    const timeToSlot = nextSlot - now;

    if (timeToSlot > cutoffMs && !interruptedGeneration) {
      // Ainda dá tempo: dorme até o "ponto de corte" (o máximo de ociosidade)
      const idleMs = timeToSlot - cutoffMs;
      await setRuntimeComponent('producer', 'waiting_slot');
      log(`😴 ocioso por ${(idleMs / 60000).toFixed(1)}min — começo a gerar em ${(cutoffMs / 60000).toFixed(0)}min antes do slot`);
      await sleep(idleMs);
      continue;
    }

    // O gate roda antes de selecionar uma pauta/chamar o writer. Se o host
    // estiver ocupado, o processo persiste estado e espera sem consumir LLM.
    if (!await waitForRenderResources()) continue;

    if (producerMustWaitForRetry({ youtubeRetryPending, socialRetryPending, youtubeRetryInProgress, inFlight,
      allowPublicationOverlap: PIPELINED_PRODUCTION })) {
      await setRuntimeComponent('producer', 'waiting_social_retry');
      await sleep(30000);
      continue;
    }

    // Após reinício, retoma a mesma identidade de job/arquivo/seed para que os
    // checkpoints do renderer e caches válidos sobrevivam à interrupção.
    let currentTheme;
    let resumingAttempt = interruptedGeneration;
    if (interruptedGeneration?.recap === true && !WEEKLY_RECAP_ENABLED) {
      log('ℹ️ recap interrompido não será retomado porque ENABLE_WEEKLY_RECAP está desabilitado; saída anterior preservada');
      await generationAttemptStore.clear();
      interruptedGeneration = null;
      resumingAttempt = null;
    }
    if (interruptedGeneration) {
      currentTheme = ACTIVE_THEMES.find(item => item.id === interruptedGeneration.theme);
      if (currentTheme) {
        log(`🔁 retomando geração interrompida (${currentTheme.id}) no mesmo job e arquivo: ${path.basename(interruptedGeneration.outPath)}`);
      } else {
        log(`⚠️ tema ${interruptedGeneration.theme} da geração interrompida não está ativo; preservando a saída antiga e seguindo o rodízio atual`);
        await generationAttemptStore.clear();
        interruptedGeneration = null;
      }
    }
    if (!currentTheme) {
      ({ theme: currentTheme } = await advanceThemeRotation(THEME_ROTATION_PATH, ACTIVE_THEMES));
    }

    const resumedRecap = Boolean(resumingAttempt?.recap === true && WEEKLY_RECAP_ENABLED);
    let recapWindow = resumedRecap ? resumingAttempt.recapWindow : null;
    let recap = resumedRecap;
    if (!resumingAttempt && WEEKLY_RECAP_ENABLED) {
      const decision = decideRecapGeneration({
        enabled: WEEKLY_RECAP_ENABLED,
        state,
        queue,
        inFlight,
        anchorAt: RECAP_ANCHOR_AT || state.startedAt,
        now: new Date(now),
        everyDays: RECAP_EVERY_DAYS,
        themeId: currentTheme.id
      });
      recap = decision.recap;
      recapWindow = decision.window;
      if (recap) log(`🗓️ recap devido para ${currentTheme.id}, janela ${recapWindow.key}`);
    }

    // Chegou na hora: gera
    log(`▶ [just-in-time] gerando ${recap ? 'recap' : 'vídeo'} do tema: ${currentTheme.name} (${(genMs / 60000).toFixed(1)}min estimados)`);
    const t0 = Date.now();
    generationInProgress = true;
    lastGenerationFailure = null;
    nextGenerationRetryAt = null;
    await setRuntimeComponent('producer', 'generating');
    let video;
    try {
      video = await generate({
        recap,
        ...(resumingAttempt?.outPath ? { outPath: resumingAttempt.outPath } : {}),
        ...(resumingAttempt?.jobId ? { jobId: resumingAttempt.jobId } : {}),
        ...(resumingAttempt?.seed != null ? { seed: resumingAttempt.seed } : {}),
        ...(resumingAttempt?.startedAt ? { attemptStartedAt: resumingAttempt.startedAt } : {}),
        ...(resumingAttempt?.attemptCount ? { attemptCount: resumingAttempt.attemptCount } : {}),
        ...(resumingAttempt?.sourceVisualsOnly ? { sourceVisualsOnly: true } : {}),
        ...(resumingAttempt?.formatId ? { formatId: resumingAttempt.formatId } : {}),
        ...(resumingAttempt?.article ? { article: resumingAttempt.article } : {}),
        ...(recapWindow ? { recapWindow } : {}),
        theme: currentTheme.id,
        slotAt: resumingAttempt?.slotAt || new Date(nextSlot).toISOString(),
        onStart: async attempt => {
          interruptedGeneration = await generationAttemptStore.write(attempt);
        }
      });
    }
    finally { generationInProgress = false; }
    const durationMs = Date.now() - t0;

    if (video.ok) {
      // Registra o tempo real pra calibrar as próximas estimativas
      await recordGenerationDuration(durationMs);
      queue.push({
        ...video,
        theme: currentTheme.id,
        ...(recap ? { recap: true, recapWindow } : {}),
        generatedAt: new Date().toISOString(),
        slotAt: new Date(nextSlot).toISOString()
      });
      await persistQueue();
      if (recap && isValidRecapWindow(recapWindow)) {
        await writeState(recordRecapWindow(state, recapWindow));
      }
      await persistRuntimeHealth();
      await generationAttemptStore.clear();
      interruptedGeneration = null;
      const migrationCandidate = isVideoGenerationPaused() && canRunMigrationCanary();
      await setRuntimeComponent('producer', migrationCandidate ? 'migration_canary_ready' : 'ready_to_publish');
      log(migrationCandidate
        ? `📦 candidato da migração gerado em ${(durationMs / 60000).toFixed(1)}min; publicação permanece pausada [tema: ${currentTheme.id}]`
        : `📦 pronto em ${(durationMs / 60000).toFixed(1)}min — fila: ${queue.length}/${MAX_QUEUE} vídeo(s) [tema: ${currentTheme.id}]`);
    } else {
      if (video.failureCode === 'video_technical_qa_failed') {
        const cleanup = await discardTechnicallyRejectedGeneration({
          root: ROOT,
          outPath: video.outPath,
          jobId: video.jobId,
          failureCode: video.failureCode
        });
        log(cleanup.discarded
          ? `🗑️ QA técnico reprovou; ${cleanup.removed.length} artefato(s) da geração removido(s), nova geração seguirá após o backoff`
          : `⚠️ QA técnico reprovou; mídia mantida porque a exclusão não foi comprovada (${cleanup.reason})`);
      }
      const retryDelayMs = migrationCanaryRetryDelayMs(video.failureCode, generationRetryDelayMs(video.failureCode), canRunMigrationCanary());
      const retryLabel = formatGenerationRetryDelay(retryDelayMs);
      lastGenerationFailure = { at: new Date().toISOString(), code: video.failureCode || 'generation_failed' };
      nextGenerationRetryAt = new Date(Date.now() + retryDelayMs).toISOString();
      if (video.retryable) {
        // O filho fixa fonte/formato no checkpoint depois de onStart. Releia
        // essas informações antes da próxima tentativa, sem trocar de job.
        interruptedGeneration = await refreshGenerationAttempt({
          attemptStore: generationAttemptStore, expected: interruptedGeneration, root: ROOT
        });
        log(`♻️ tentativa persistida preservada (${video.jobId}, seed ${video.seed})`);
      } else {
        await generationAttemptStore.clear();
        interruptedGeneration = null;
      }
      await setRuntimeComponent('producer', 'backoff');
      log(`⚠️ producer: geração falhou${video.failureCode ? ` (${video.failureCode})` : ''}, tentando outro ciclo em ${retryLabel}`);
      await sleep(retryDelayMs);
      await setRuntimeComponent('producer', 'waiting');
    }
  }
}

/**
 * CONSUMER: posta no slot; se a geração passar do horário, publica assim que
 * ficar pronta em vez de perder mais uma janela inteira da cadência.
 */
async function consumer() {
  await setRuntimeComponent('consumer', 'waiting');
  const queuedSlot = () => {
    const timestamp = queue[0]?.slotAt ? new Date(queue[0].slotAt).getTime() : NaN;
    return Number.isFinite(timestamp) ? timestamp : null;
  };
  const missedAt = Date.parse(pendingMissedSlotAt || '');
  let dueSlot = Number.isFinite(missedAt) ? Math.min(queuedSlot() ?? missedAt, missedAt)
    : queue.length ? (queuedSlot() ?? Date.now()) : null;
  if (dueSlot != null) {
    nextConfiguredSlotAt = new Date(dueSlot).toISOString();
    await persistRuntimeHealth();
  }
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
      nextConfiguredSlotAt = new Date(dueSlot).toISOString();
      await persistRuntimeHealth();
    }

    const timeToSlot = dueSlot - Date.now();
    if (timeToSlot > 0) {
      await sleep(Math.min(timeToSlot, 30000));
      continue;
    }

    if (!queue.length) {
      if (!reportedEmptySlot) {
        lastMissedSlotAt = new Date(dueSlot).toISOString();
        pendingMissedSlotAt = lastMissedSlotAt;
        await setRuntimeComponent('consumer', 'missed_slot_waiting_for_video');
        log('⚠️ consumer: slot vencido sem vídeo; vai publicar assim que a geração terminar');
      }
      reportedEmptySlot = true;
      await sleep(5000);
      continue;
    }

    if (youtubeRetryInProgress) {
      await sleep(5000);
      continue;
    }

    if (process.env.DISABLE_YOUTUBE_UPLOAD === '1') {
      await setRuntimeComponent('consumer', 'publication_disabled');
      await sleep(30000);
      continue;
    }
    if (isVideoGenerationPaused()) {
      await setRuntimeComponent('consumer', 'paused_visual_migration');
      await sleep(30000);
      continue;
    }

    const video = queue.shift();
    inFlight = video;
    pendingMissedSlotAt = null;
    await persistQueue();
    await setRuntimeComponent('consumer', 'publishing');

    log(`${reportedEmptySlot ? '🎬 [atrasado, publicando assim que ficou pronto]' : '🎬 [slot] postando'}: ${path.basename(video.outPath)}`);
    let publication = null;
    try {
      if (process.env.DISABLE_YOUTUBE_UPLOAD !== '1') publication = await publishEverywhere(video.outPath);
    } finally {
      inFlight = null;
      await persistQueue();
    }

    const retainedSlot = retainedSlotAfterPreflight(dueSlot, publication);
    if (retainedSlot) {
      // No destination was touched: keep the overdue slot for the next
      // eligible video, while retaining the rejected artifact in the ledger.
      pendingMissedSlotAt = retainedSlot;
      lastMissedSlotAt = pendingMissedSlotAt;
      reportedEmptySlot = true;
      await setRuntimeComponent('consumer', 'missed_slot_waiting_for_video');
      log('⏰ slot preservado: nenhum envio foi iniciado; próximo vídeo aprovado pode sair assim que estiver pronto');
      continue;
    }

    // Atualiza o estado (runs + lastRunAt)
    const st = await readState();
    st.runs = (st.runs || 0) + 1;
    st.lastRunAt = new Date().toISOString();
    await writeState(st);
    dueSlot = null;
    reportedEmptySlot = false;
    await setRuntimeComponent('consumer', 'waiting');
  }
}

async function youtubeRetryWorker() {
  let startupScanPending = true;
  for (;;) {
    if (!startupScanPending) await sleep(YOUTUBE_RETRY_INTERVAL_MS);
    youtubeRetryPending = true;
    if (process.env.DISABLE_YOUTUBE_UPLOAD === '1') { startupScanPending = false; youtubeRetryPending = false; continue; }
    // Mesmo com ambas as cotas do YouTube bloqueadas, a varredura precisa
    // executar: os demais destinos são independentes dessas cotas.
    while (backgroundRetryMustWait({ generationInProgress, queuedCount: queue.length, inFlight,
      retryInProgress: youtubeRetryInProgress, allowPublicationOverlap: PIPELINED_PRODUCTION })
      || publicationImminent()) await sleep(publicationImminent() ? 5000 : 30000);

    startupScanPending = false;
    youtubeRetryInProgress = true;
    youtubeRetryPending = false;
    await persistRuntimeHealth();
    try { await retryPendingYouTube(); }
    catch (error) { log(`⚠️ retry do YouTube ignorado: ${error.message}`); }
    finally { youtubeRetryInProgress = false; await persistRuntimeHealth(); }
  }
}

async function socialRetryWorker() {
  for (;;) {
    await sleep(SOCIAL_RETRY_INTERVAL_MS);
    if (process.env.DISABLE_YOUTUBE_UPLOAD === '1') continue;
    socialRetryPending = true;
    while (backgroundRetryMustWait({ generationInProgress, queuedCount: queue.length, inFlight,
      retryInProgress: youtubeRetryInProgress, allowPublicationOverlap: PIPELINED_PRODUCTION })
      || publicationImminent()) await sleep(publicationImminent() ? 5000 : 30000);
    youtubeRetryInProgress = true;
    socialRetryPending = false;
    await persistRuntimeHealth();
    try {
      const { reconcileSocialPublications } = require('../utils/social-reconciliation');
      for (const platform of ['tiktok', 'instagram']) {
        try {
          const reconciled = await reconcileSocialPublications({ root: ROOT, platform });
          if (reconciled.confirmed?.length) log(`✅ reconciliação ${platform}: ${reconciled.confirmed.length} publicação(ões) confirmada(s), sem reenvio`);
        } catch (error) { log(`⏸️ reconciliação ${platform} adiada: ${error.code || error.name || 'Error'}`); }
      }
      await retryPendingYouTube({ onlySocial: true });
      // Revisão automática e sem publicação: a próxima rodada normal só tenta
      // os itens aprovados por fonte/factual, com o QA por hash já existente.
      const { reviewHeldLatest } = require('./review-held-publications');
      const review = await reviewHeldLatest({ publish: false });
      if (review.status !== 'no_reviewable_candidate') {
        log(`[revisão automática do backlog] ${review.status}`);
      }
    }
    catch (error) { log(`⚠️ retry social ignorado: ${error.message}`); }
    finally { youtubeRetryInProgress = false; await persistRuntimeHealth(); }
  }
}

async function main() {
  const [persistedRetryState, previousHealth] = await Promise.all([
    readPersistedGenerationRetryState({ filePath: SCHEDULER_HEALTH_PATH }),
    fsp.readFile(SCHEDULER_HEALTH_PATH, 'utf8').then(JSON.parse).catch(() => null)
  ]);
  pendingMissedSlotAt = restoredMissedSlot(previousHealth);
  if (pendingMissedSlotAt) lastMissedSlotAt = pendingMissedSlotAt;
  lastGenerationFailure = persistedRetryState.lastGenerationFailure;
  nextGenerationRetryAt = persistedRetryState.nextGenerationRetryAt;
  if (shouldBypassDailyBudgetBackoff(lastGenerationFailure?.code, process.env)) {
    lastGenerationFailure = null;
    nextGenerationRetryAt = null;
    await persistRuntimeHealth();
    log('♻️ backoff diário ignorado: há outro provedor de roteiro configurado');
  } else if (nextGenerationRetryAt) {
    log(`⏸️ backoff persistido restaurado até ${nextGenerationRetryAt} (${lastGenerationFailure.code})`);
  }
  log(`Channel Scheduler iniciado — tema: ${THEME} · ${VIDEOS_PER_DAY} vídeos/dia · recap ${WEEKLY_RECAP_ENABLED ? `habilitado a cada ${RECAP_EVERY_DAYS} dias` : 'desabilitado'}`);
  if (isVideoGenerationPaused()) log('⏸️ geração pausada por configuração; publicação depende dos gates hash-bound por rota');
  log(`intervalo entre vídeos: ${(INTERVAL_MS / 3600000).toFixed(2)}h${PHASE_MIN ? ` · fase +${PHASE_MIN}min (espalhamento uniforme entre réplicas)` : ''}`);
  const alertChannels = getAlertChannelStatus();
  log(`🔔 destinos de alerta: webhook=${alertChannels.webhook}, Telegram=${alertChannels.telegram}`);

  let state = await readState();
  if (!state.startedAt) {
    state = { startedAt: new Date().toISOString(), lastRecapAt: null, runs: 0, recaps: 0, lastRunAt: null };
    await writeState(state);
  }

  if (!await restoreQueue()) throw new Error('revise o arquivo data/state/publish-queue.json antes de retomar');
  const reconciledSlot = queue.length === 1 && !inFlight
    ? restoredWaitingQueueSlot(previousHealth, queue[0].slotAt) : null;
  if (reconciledSlot) {
    queue[0].slotAt = reconciledSlot;
    await persistQueue();
    log('⏰ horário do vídeo em fila alinhado ao slot que o consumer já aguardava');
  }
  const expeditePath = path.join(STATE_DIR, 'expedite-next-publication.json');
  const expedite = await fsp.readFile(expeditePath, 'utf8').then(JSON.parse).catch(() => null);
  const immediateSlot = requestedImmediateSlot(expedite);
  if (immediateSlot && !inFlight) {
    pendingMissedSlotAt = pendingMissedSlotAt && Date.parse(pendingMissedSlotAt) < Date.parse(immediateSlot)
      ? pendingMissedSlotAt : immediateSlot;
    lastMissedSlotAt = pendingMissedSlotAt;
    consumerRuntimeState = 'missed_slot_waiting_for_video';
    await persistRuntimeHealth();
    await fsp.unlink(expeditePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    log('⏰ pedido pontual de publicação imediata registrado; próximo vídeo elegível mantém os gates');
  }
  let reconciledRecapState = state;
  for (const item of queue) {
    if (item?.recap === true && isValidRecapWindow(item.recapWindow)) {
      reconciledRecapState = recordRecapWindow(reconciledRecapState, item.recapWindow);
    }
  }
  if (reconciledRecapState !== state) {
    await writeState(reconciledRecapState);
    log('✅ janelas de recap reconciliadas com a fila persistida');
  }
  await persistRuntimeHealth();
  const runtimeHeartbeat = setInterval(() => { void persistRuntimeHealth(); }, 30000);
  runtimeHeartbeat.unref();

  try {
    interruptedGeneration = await generationAttemptStore.read();
  } catch (error) {
    if (error.code !== 'GENERATION_ATTEMPT_INVALID') throw error;
    const quarantinedPath = await generationAttemptStore.quarantineInvalid();
    log(`⚠️ checkpoint inválido foi preservado${quarantinedPath ? ` em ${path.basename(quarantinedPath)}` : ''}; o scheduler seguirá com o rodízio normal (${error.message})`);
  }
  // Reconcile a crash after an in-flight checkpoint was written but before
  // its deferred queue entry was removed; never enqueue the same job twice.
  if (interruptedGeneration) await deferredGenerationQueue.claimNext();
  if (interruptedGeneration) {
    const alreadyCompleted = await isCompletedGenerationAttempt({
      attempt: interruptedGeneration,
      ledgerPath: LEDGER_PATH,
      root: ROOT,
      isManagedVideo: async candidate => Boolean(await safeManagedMediaPath(candidate, ['.mp4'])),
      probeVideoHealth
    });
    const outputIdentity = path.resolve(ROOT, interruptedGeneration.outPath);
    const matchingQueueItem = [...queue, ...(inFlight ? [inFlight] : [])]
      .some(item => item?.outPath && path.resolve(ROOT, item.outPath) === outputIdentity);
    if (alreadyCompleted) {
      if (!matchingQueueItem) {
        const completedEntry = await readLedgerEntry(interruptedGeneration.outPath);
        if (!completedEntry || completedEntry.jobId !== interruptedGeneration.jobId
          || !Number.isFinite(Date.parse(completedEntry.generatedAt || ''))) {
          throw new Error('geração concluída não pôde ser reconciliada com uma entrada válida do ledger');
        }
        queue.push({
          ok: true,
          outPath: interruptedGeneration.outPath,
          jobId: interruptedGeneration.jobId,
          videoId: completedEntry.videoId || videoIdForPath(interruptedGeneration.outPath),
          theme: interruptedGeneration.theme,
          generatedAt: completedEntry.generatedAt,
          ...(interruptedGeneration.slotAt ? { slotAt: interruptedGeneration.slotAt } : {}),
          ...(interruptedGeneration.recap ? { recap: true, recapWindow: interruptedGeneration.recapWindow } : {})
        });
        await persistQueue();
        log('📦 MP4 saudável no ledger, mas fora da fila após interrupção; entrada reconciliada para retomar publicação com os gates atuais');
      }
      await generationAttemptStore.clear();
      interruptedGeneration = null;
      log('✅ checkpoint de geração reconciliado: o MP4 existente corresponde ao job do ledger e passou no QA; não será renderizado nem publicado de novo');
    } else if (matchingQueueItem) {
      await generationAttemptStore.clear();
      interruptedGeneration = null;
      log('✅ geração anterior já está na fila persistida; marcador redundante removido');
    } else {
      log(`⚠️ geração interrompida detectada no boot: ${path.basename(interruptedGeneration.outPath)} (${interruptedGeneration.theme}); será refeita antes do rodízio normal`);
    }
  }
  const heldLegacyCount = await quarantineQueueOutsideNarrativeRoute();
  if (heldLegacyCount) log(`🔒 ${heldLegacyCount} item(ns) antigo(s) preservado(s) em migration-held-publish-queue.json; só a rota narrativa hash-bound permanece na fila ativa`);

  // Os fluxos sociais existentes usam Android/ADB e não abrem Chromium local.
  // Limpa variáveis herdadas para impedir que uma integração futura use a tela
  // interativa do usuário sem declarar e fornecer seu próprio display isolado.
  delete process.env.DISPLAY;
  delete process.env.XAUTHORITY;
  log('display interativo removido do ambiente; uploads sociais usam Android/ADB');

  // Inventaria toda a pasta e remove mídia com publicação confirmada; itens na
  // fila, em uso, sem QA ou com resultado remoto incerto permanecem protegidos.
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
    youtubeRetryWorker(),
    socialRetryWorker()
  ]);
}

if (require.main === module) {
  main().catch(error => { log(`FATAL: ${error.message}`); process.exit(1); });
}

module.exports = { publishEverywhere, retryPendingYouTube };
