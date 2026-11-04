#!/usr/bin/env node
/**
 * Distribui o vídeo principal e formatos sociais próprios por plataforma.
 *
 * YouTube/Shorts: YouTube Studio autenticado no Android (CDP + ADB)
 * Kwai, Instagram e TikTok: aplicativos Android com handlers nativos validados;
 * destinos sem handler falham fechados até estarem disponíveis.
 *
 * API:
 *   const { uploadToAll } = require('./upload-to-socials');
 *   await uploadToAll({ videoPath, clips, title, hashtags, sourceUrl });
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { uploadWithStudio } = require('../utils/youtube-studio-publisher');
const { getMediaDuration } = require('../utils/ffmpeg');
const {
  isPlatformTargeted,
  narrativePartDurationRejection,
  isShortsTargeted,
  socialClipCaption
} = require('../utils/platform-video-policy');
const { createPublicationResult, publicationSucceeded } = require('../utils/publication-status');
const { checkpointedPublication, priorClipResult, recordNoSend, shouldAttemptPublication } = require('../utils/social-publication-state');
const { retryPendingSocialUploads: retrySocialUploads } = require('../utils/social-retry');
const { resolveThemeHashtags } = require('../utils/theme-metadata');
const { createAndroidSocialPublisher } = require('../utils/android-social-publisher');
const { publishTikTok } = require('../utils/tiktok-android-publisher');
const {
  INSTAGRAM_IDS,
  INSTAGRAM_PACKAGE,
  INSTAGRAM_STAGING_HEADROOM_BYTES,
  dismissInstagramPreviewTutorial,
  findInstagramNodes,
  instagramCaptionLooksLikeResume,
  instagramIsCaptionScreen,
  instagramIsDraftDialog,
  instagramIsMediaPicker,
  instagramCanResumeMediaPicker,
  instagramIsPreviewTutorial,
  startInstagramNewVideoFromDraft,
  waitForInstagramMediaPicker,
  publishInstagramReel
} = require('../utils/instagram-upload-flow');
const { verifyVideoQaManifest } = require('../utils/video-qa-manifest');
const { buildShortsTitle, resolvePublicationTitle } = require('../utils/publication-title');
const { assertPublicationVisualGate, publicationVisualGate } = require('../utils/publication-visual-gate');
const { videoIdForPath } = require('../utils/observability-ids');
const { withOperationBudget } = require('../utils/operation-budget');
const { hasRecentAndroidSession } = require('../utils/android-session-state');
const { EXCLUDED_SOCIAL_PLATFORMS } = require('../utils/social-platforms');
const { checkAndroidInternalStorage, createSocialReadiness, socialReadinessDescription } = require('../utils/social-readiness');
const { socialAndroidTarget } = require('../utils/android-social-target');
const {
  isWithinFileSizeLimit,
  platformVideoLimitSeconds,
  telegramFileLimitBytes
} = require('../utils/platform-upload-limits');
const {
  findKwaiCaptionField,
  isEmptyKwaiCaptionField,
  isKwaiPostComposer,
  isKwaiUnsubmittedPostComposer,
  findKwaiComposerExitCancel,
  findKwaiNode,
  kwaiAlbumListSwipe,
  findKwaiUploadAlbumOptionAcrossPages,
  findKwaiPrivacyOption,
  findUniqueKwaiGalleryItem,
  hasKwaiHashtagSuggestions,
  hasKwaiPublicPromotionDialog,
  hasKwaiPublishConfirmation,
  isKwaiNotificationPrompt,
  isKwaiFeedScreen,
  isKwaiPrivacyApplied,
  isKwaiPrivacySettingsScreen,
  isKwaiProfile,
  isKwaiSelectionConfirmed,
  findKwaiSelectedDuration,
  isKwaiSourceGallery,
  isKwaiVideoEditor,
  isKwaiEditorActivity,
  isKwaiVideoDetailActivity,
  readKwaiResumedActivity,
  shouldOpenKwaiAppForResume,
  findKwaiProfileTabs,
  getKwaiProfilePosts,
  matchesKwaiCaption,
  kwaiStagingAlbumName,
  normalizeKwaiPrivacy,
  parseDurationLabel
} = require('../utils/kwai-upload-flow');
const {
  advanceKwaiUploadResume,
  archiveUnrelatedKwaiResume,
  clearKwaiUploadResume,
  createKwaiUploadResume,
  matchesKwaiUploadResume,
  readKwaiUploadResume,
  resolveKwaiUploadResume,
  saveKwaiUploadResume
} = require('../utils/kwai-upload-resume');

// Plataformas desligadas via SOCIALS_DISABLED=kwai,x — não tentam upload e não bloqueiam a limpeza
const DISABLED_PLATFORMS = [...new Set([...EXCLUDED_SOCIAL_PLATFORMS,
  ...(process.env.SOCIALS_DISABLED || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)])];

// O marcador só é criado depois que social-login reconhece a tela autenticada no Android.
// Arquivos de cookies de perfis antigos do Chromium não autorizam publicação.
const kwaiEmu = () => require('./kwai-emulator');
const androidUploadHandlers = {
  kwai: ({ videoPath, caption, privacy }) => uploadKwaiOnDevice({ videoPath, caption, privacy }),
  tiktok: ({ control, videoPath, caption }) => publishTikTok({
    control,
    videoPath,
    caption,
    accountHandle: process.env.ANDROID_SOCIAL_HANDLE_TIKTOK || ''
  }),
  instagram: ({ control, videoPath, caption, resumeCurrentDraft = false, startFromCurrentMediaPicker = false }) => publishInstagramReel({
    control,
    videoPath,
    caption,
    accountHandle: process.env.ANDROID_SOCIAL_HANDLE_INSTAGRAM || '',
    resumeCurrentDraft,
    startFromCurrentMediaPicker
  })
};
const androidSocialPublisher = createAndroidSocialPublisher({
  handlers: androidUploadHandlers,
  // A residual Kwai composer is a transient state, not proof of login. The
  // Kwai handler itself must then recognize the exact target caption before
  // it can reach Post; every other unknown Android screen still fails closed.
  allowUnknownSession: async ({ platform, session, control, caption }) => {
    if (platform === 'kwai') return true;
    return allowUnknownAndroidSession({ platform, session, control, caption });
  }
});
const SOCIAL_IDENTITY_REQUIRED = new Set(['instagram', 'tiktok', 'x']);

function hasNativeUploadHandler(platform) {
  return ['youtube', 'shorts'].includes(platform) || isSocialHandlerAvailable(platform);
}

function isLogged(platform) {
  const { device } = socialAndroidTarget(platform);
  const expectedHandle = process.env[`ANDROID_SOCIAL_HANDLE_${platform.toUpperCase()}`];
  if (SOCIAL_IDENTITY_REQUIRED.has(platform) && !String(expectedHandle || '').trim()) return false;
  return hasRecentAndroidSession(platform, {
    root: process.env.STATE_DIR || path.join(ROOT, 'data'), device,
    ...(SOCIAL_IDENTITY_REQUIRED.has(platform) ? { expectedHandle } : {})
  });
}

async function allowUnknownAndroidSession({ platform, session, control, caption }) {
  // TikTok's For You screen does not expose own-profile evidence in the
  // accessibility tree even when the device- and handle-bound session was
  // approved. Its native handler still fails closed unless it finds the
  // isolated album, exact duration/caption, and explicit Post control.
  if (platform === 'tiktok' && session.status === 'unknown') {
    const nodes = await control.dumpUi();
    // Suggestions and the keyboard can hide Post while a composer remains.
    const hasResidualComposer = nodes.some(node => node.visible !== false
      && node.resourceId === 'com.zhiliaoapp.musically:id/h9x');
    return !hasResidualComposer && isLogged('tiktok');
  }
  if (platform !== 'instagram' || session.packageName !== INSTAGRAM_PACKAGE
    || !String(process.env.ANDROID_SOCIAL_HANDLE_INSTAGRAM || '').trim()) return false;
  let nodes = await control.dumpUi();
  if (instagramIsPreviewTutorial(nodes)) nodes = await dismissInstagramPreviewTutorial(control, nodes);
  if (instagramCanResumeMediaPicker(nodes, {
    packageName: session.packageName,
    accountHandle: process.env.ANDROID_SOCIAL_HANDLE_INSTAGRAM,
    sessionVerified: isLogged('instagram')
  })) {
    return { allow: true, handlerOptions: { startFromCurrentMediaPicker: true } };
  }
  if (instagramIsDraftDialog(nodes)) {
    nodes = await startInstagramNewVideoFromDraft(control, nodes);
    if (!instagramIsMediaPicker(nodes)) nodes = await waitForInstagramMediaPicker(control);
    if (instagramIsMediaPicker(nodes)) {
      return { allow: true, handlerOptions: { startFromCurrentMediaPicker: true } };
    }
  }
  const captionField = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.caption })[0];
  if (!instagramIsCaptionScreen(nodes)
    || !instagramCaptionLooksLikeResume(captionField?.text, caption)) {
    // A recent session record is bound to the device and exact approved
    // handle. The normal publisher still requires exact album, caption, and
    // Share controls before it can submit anything.
    return isLogged('instagram');
  }
  return { allow: true, handlerOptions: { resumeCurrentDraft: true } };
}

const ensureSocialReady = createSocialReadiness({
  hasHandler: platform => isSocialHandlerAvailable(platform),
  preflight: async platform => {
    if (platform !== 'instagram') return null;
    const target = socialAndroidTarget(platform);
    if (await checkAndroidInternalStorage(target.control, INSTAGRAM_STAGING_HEADROOM_BYTES) !== false) return null;
    const { withAndroidDeviceLock } = require('../utils/android-device-lock');
    const { recoverAndroidInternalStorage } = require('../utils/social-readiness');
    try {
      const ready = await withAndroidDeviceLock(() => recoverAndroidInternalStorage(target.control, INSTAGRAM_STAGING_HEADROOM_BYTES),
        { lockPath: target.lockPath, owner: 'android-cache-recovery', timeoutMs: 10000 });
      return ready === true ? null : 'storage_insufficient';
    } catch { return 'storage_insufficient'; }
  },
  isSessionFresh: isLogged,
  inspectSession: platform => require('./social-login').inspectSocialLogin(platform, { restorePrevious: true }),
  disabled: DISABLED_PLATFORMS
});

function isSocialHandlerAvailable(platform) {
  return platform === 'x' || typeof androidUploadHandlers[platform] === 'function';
}

function socialNotReadyResult(platform, videoPath, readiness) {
  const handlerUnavailable = readiness.status === 'handler_unavailable';
  const identityUnverified = ['identity_unconfirmed', 'identity_unavailable', 'identity_mismatch'].includes(readiness.status);
  const storageInsufficient = readiness.status === 'storage_insufficient';
  return createPublicationResult({ platform, videoPath, status: 'failed',
    failureCode: handlerUnavailable ? 'social_handler_unavailable'
      : identityUnverified ? 'social_account_identity_unverified'
        : storageInsufficient ? 'android_storage_insufficient' : 'pre_submit_ui_error',
    ...(!handlerUnavailable && !identityUnverified ? { nextAttemptAt: new Date(Date.now() + (storageInsufficient ? 30 : 5) * 60 * 1000).toISOString() } : {}),
    evidence: { kind: 'confirmed_no_send',
      observed: `pré-checagem Android (${readiness.status}): ${socialReadinessDescription(readiness.status)}; envio não iniciado` }
  });
}

async function publishSocialOnAndroid(platform, payload) {
  if (!isSocialHandlerAvailable(platform)) {
    throw new Error(`${platform}: fluxo nativo Android ainda não configurado; nenhum navegador será aberto`);
  }
  const readiness = await ensureSocialReady(platform);
  if (!readiness.ready) {
    return socialNotReadyResult(platform, payload.videoPath, readiness);
  }
  if (platform === 'x') return require('../utils/x-android-publisher').publishXAndroid(payload);
  const emulator = socialAndroidTarget(platform).emulator;
  await emulator.acquire(); // inicia Redroid para que a sessão possa ser inspecionada por ADB
  try {
    return await androidSocialPublisher.publish({ platform, ...payload });
  } finally {
    emulator.release();
  }
}

// X usa somente CDP encaminhado ao Chrome Android; nunca Chromium do host.
const step = (platform, msg) => console.log(`  [${platform}] ${msg}`);

async function verifyEntryQaManifest(entry, root = ROOT) {
  if (!entry?.qaManifestPath) return { status: 'legacy', reason: 'qa_manifest_not_recorded' };
  const paths = [entry.videoPath, entry.portraitVideoPath, ...(Array.isArray(entry.clips) ? entry.clips : [])]
    .map(item => typeof item === 'string' ? item : item?.path)
    .filter(value => typeof value === 'string' && value)
    .map(value => path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value))
    .filter(value => fs.existsSync(value));
  const masterAlreadyPublished = publicationSucceeded(entry.ytUrl || entry.results?.long?.youtube);
  return verifyVideoQaManifest({
    root,
    manifestPath: entry.qaManifestPath,
    manifestSha256: entry.qaManifestSha256,
    expectedPaths: paths,
    allowMissingManifestAssets: true,
    allowMissingThumbnail: masterAlreadyPublished
  });
}

async function verifyVideoQaForUpload(videoPath, clips = []) {
  const manifestPath = path.join(ROOT, 'data', 'reports', 'qa', videoIdForPath(videoPath) + '.json');
  const expectedPaths = [videoPath, ...clips.map(clip => clip?.path)]
    .filter(value => typeof value === 'string' && value)
    .map(value => path.isAbsolute(value) ? path.resolve(value) : path.resolve(ROOT, value));
  return verifyVideoQaManifest({ root: ROOT, manifestPath, expectedPaths, allowAdditionalManifestAssets: true });
}

function qaAssetSha256(qaManifest, artifactPath) {
  if (!Array.isArray(qaManifest?.assetProofs)) return null;
  const target = path.resolve(artifactPath);
  return qaManifest.assetProofs.find(asset => path.resolve(asset.path) === target)?.sha256 || null;
}

function confirmedAppPublication(platform, videoPath, evidence) {
  return createPublicationResult({ platform, videoPath, status: 'confirmed', account: evidence?.account, evidence });
}

function uncertainAppPublication(platform, videoPath, observed) {
  return createPublicationResult({
    platform,
    videoPath,
    status: 'unknown',
    evidence: { kind: 'attempt_outcome_unknown', observed }
  });
}

/* ---------------- orçamento de tempo por plataforma ---------------- */

const UPLOAD_TIMEOUT_MS = Number(process.env.PLATFORM_UPLOAD_TIMEOUT_MS || 8 * 60 * 1000);
const configuredXTimeout = Number(process.env.X_UPLOAD_TIMEOUT_MS || 20 * 60 * 1000);
const X_UPLOAD_TIMEOUT_MS = Number.isFinite(configuredXTimeout) && configuredXTimeout > 0
  ? configuredXTimeout : 20 * 60 * 1000;
const DEFAULT_KWAI_UPLOAD_TIMEOUT_MS = 23 * 60 * 1000;
const configuredKwaiTimeout = Number(process.env.KWAI_UPLOAD_TIMEOUT_MS || DEFAULT_KWAI_UPLOAD_TIMEOUT_MS);
const KWAI_UPLOAD_TIMEOUT_MS = Number.isFinite(configuredKwaiTimeout) && configuredKwaiTimeout > 0
  ? configuredKwaiTimeout : DEFAULT_KWAI_UPLOAD_TIMEOUT_MS;
const KWAI_EDITOR_TIMEOUT_MS = Math.min(18 * 60 * 1000, Math.max(6 * 60 * 1000, KWAI_UPLOAD_TIMEOUT_MS - 7 * 60 * 1000));
const KWAI_POST_SUBMIT_UI_WAIT_MS = 60 * 1000;
const KWAI_PROFILE_VERIFY_TIMEOUT_MS = Math.max(30 * 1000, Math.min(5 * 60 * 1000,
  KWAI_UPLOAD_TIMEOUT_MS - KWAI_EDITOR_TIMEOUT_MS - KWAI_POST_SUBMIT_UI_WAIT_MS - 30 * 1000));
// TikTok pode recomeçar o fluxo inteiro 2x (crash recovery); YouTube/Telegram
// sobem arquivos grandes pela API — orçamentos maiores para esses casos.
const PLATFORM_BUDGET_MS = {
  tiktok: 14 * 60 * 1000,
  // Kwai Lite transcodifica no aparelho; um clipe de 234 s ainda estava em
  // 76% após a espera anterior, então o limite curto deixava o rascunho preso.
  kwai: KWAI_UPLOAD_TIMEOUT_MS,
  youtube: 15 * 60 * 1000,
  telegram: 15 * 60 * 1000,
  x: X_UPLOAD_TIMEOUT_MS
};

// Limites do caminho de publicação selecionado, não limites universais da rede.
const PLATFORM_VIDEO_LIMIT_SECONDS = {
  youtube: platformVideoLimitSeconds('youtube'),
  shorts: platformVideoLimitSeconds('shorts'),
  tiktok: platformVideoLimitSeconds('tiktok'),
  kwai: platformVideoLimitSeconds('kwai'),
  instagram: platformVideoLimitSeconds('instagram'),
  x: platformVideoLimitSeconds('x')
};
const YOUTUBE_LONGFORM_MIN_SECONDS = 6 * 60;
const TELEGRAM_APP_MAX_FILE_BYTES = telegramFileLimitBytes();
const X_POST_FULL_VIDEO = /^(1|true|yes)$/i.test(String(process.env.X_POST_FULL_VIDEO || ''));

async function durationAllowed(videoPath, platform) {
  const duration = await getMediaDuration(videoPath);
  const maxSeconds = PLATFORM_VIDEO_LIMIT_SECONDS[platform];
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) {
    throw new Error(`limite de duração não definido para ${platform}`);
  }
  const minSeconds = platform === 'youtube' ? YOUTUBE_LONGFORM_MIN_SECONDS : 0;
  return { duration, minSeconds, maxSeconds,
    allowed: duration >= minSeconds && duration <= maxSeconds };
}
function withBudget(promise, platform, ms = UPLOAD_TIMEOUT_MS) {
  return withOperationBudget(promise, { platform, timeoutMs: ms });
}

/* ---------------- Kwai (app no emulador Android on-demand) ---------------- */

async function waitForKwaiUi(kwai, predicate, label, { timeoutMs = 20000, rejectWhen = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  let emptyReads = 0;
  let rejectionReads = 0;
  let lastRejection = null;
  let nodes = [];
  while (Date.now() < deadline) {
    nodes = await kwai.dumpUI({ timeoutMs: Math.min(5000, Math.max(1, deadline - Date.now())) });
    if (nodes.length) {
      emptyReads = 0;
      if (predicate(nodes)) return nodes;
    } else emptyReads++;
    const rejection = nodes.length && rejectWhen ? rejectWhen(nodes) : null;
    rejectionReads = rejection && rejection === lastRejection ? rejectionReads + 1 : rejection ? 1 : 0;
    lastRejection = rejection;
    if (rejectionReads >= 3) {
      await kwai.screencap?.('ui_unexpected_state').catch?.(() => {});
      throw new Error(`Kwai: ${rejection}; envio interrompido antes da publicação`);
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(900, remaining)));
  }
  if (emptyReads >= 2) {
    await kwai.screencap?.('ui_hierarquia_vazia').catch?.(() => {});
    throw new Error(`Kwai: hierarquia Android vazia ao aguardar ${label}; envio interrompido com segurança`);
  }
  await kwai.screencap?.('ui_timeout').catch?.(() => {});
  throw new Error(`Kwai: não confirmou ${label} na interface Android`);
}

async function tapKwaiControl(kwai, node, label) {
  if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
    throw new Error(`Kwai: controle ${label} não identificado na tela`);
  }
  await kwai.tap(node.x, node.y);
}

async function waitForKwaiPostTapTransition(kwai, caption, { timeoutMs = 10000, pollMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let sameComposerObserved = false;
  let lastNodes = [];
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try { lastNodes = await kwai.dumpUI({ timeoutMs: Math.min(5000, remaining) }); }
    catch (_error) { lastNodes = []; }
    if (lastNodes.length) {
      if (!isKwaiUnsubmittedPostComposer(lastNodes, caption)) {
        return { status: 'transitioned', nodes: lastNodes };
      }
      sameComposerObserved = true;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
  }
  return { status: sameComposerObserved ? 'not_submitted' : 'unknown', nodes: lastNodes };
}

async function waitForKwaiPublishResponse(kwai, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    let nodes = [];
    try {
      nodes = await kwai.dumpUI({ timeoutMs: Math.min(8000, remaining) });
    } catch (_error) {
      // Kwai temporarily exposes an empty accessibility tree while processing
      // or uploading a long video. Keep waiting within the bounded upload window.
    }
    if (!nodes.length) {
      await new Promise(resolve => setTimeout(resolve, Math.min(1200, remaining)));
      continue;
    }
    if (hasKwaiPublishConfirmation(nodes) || isKwaiFeedScreen(nodes)) return nodes;
    if (!isKwaiNotificationPrompt(nodes)) {
      await new Promise(resolve => setTimeout(resolve, Math.min(1200, remaining)));
      continue;
    }
    const later = findKwaiNode(nodes, {
      id: 'kwai.lite.video.basis:id/tv_click_cancel', text: /^Maybe Later$/i, clickable: true
    });
    if (!later) throw new Error('Kwai: aviso de notificações sem opção segura para fechar');
    await tapKwaiControl(kwai, later, 'fechar somente o aviso de notificações');
  }
  throw new Error('Kwai: tempo limite aguardando confirmação do envio');
}

async function completeKwaiDraftFromEditor(kwai, {
  videoPath, caption, privacy = 'public', initialNodes = null, resumeMarker = null, resumeStateDir
} = {}) {
  const desiredPrivacy = normalizeKwaiPrivacy(privacy);
  let publishActionStarted = false;
  try {
    if (resumeMarker && !await matchesKwaiUploadResume(resumeMarker, {
      videoPath,
      caption,
      albumName: kwaiStagingAlbumName(videoPath),
      durationSeconds: resumeMarker.durationSeconds
    })) throw new Error('Kwai: marcador não corresponde ao arquivo e legenda atuais; envio interrompido');

    let nodes = initialNodes && (isKwaiVideoEditor(initialNodes) || isKwaiPostComposer(initialNodes))
      ? initialNodes
      : await waitForKwaiUi(kwai, current => isKwaiVideoEditor(current) || isKwaiPostComposer(current),
        'o editor ou compositor do vídeo selecionado', { timeoutMs: KWAI_EDITOR_TIMEOUT_MS });
    await kwai.screencap('05_editor');
    if (!isKwaiPostComposer(nodes)) {
      if (resumeMarker?.stage === 'composer') {
        throw new Error('Kwai: marcador aponta para compositor, mas o editor ainda está aberto; não vou repetir Next');
      }
      if (resumeMarker?.stage !== 'transcoding') {
        const next = findKwaiNode(nodes, {
          id: 'kwai.lite.video.product:id/edit_post_next_step_button', text: /^Next$/i, clickable: true
        });
        if (!next) throw new Error('Kwai: próxima etapa do editor não foi reconhecida');
        if (resumeMarker) {
          resumeMarker = await advanceKwaiUploadResume(resumeMarker, 'transcoding', { stateDir: resumeStateDir });
        }
        await tapKwaiControl(kwai, next, 'avançar para a legenda');
      }
      // Kwai transcodes longer narrative parts after Next. The composer can
      // temporarily expose no accessibility hierarchy while the editor loads.
      // Resume waits use the same bound and never tap Next a second time.
      nodes = await waitForKwaiUi(kwai, current => isKwaiPostComposer(current), 'o compositor de publicação', {
        timeoutMs: KWAI_EDITOR_TIMEOUT_MS,
        rejectWhen: current => isKwaiSourceGallery(current)
          ? 'editor encerrado e retorno à galeria durante a transcodificação' : null
      });
    }
    if (resumeMarker && resumeMarker.stage !== 'composer') {
      resumeMarker = await advanceKwaiUploadResume(resumeMarker, 'composer', { stateDir: resumeStateDir });
    }
    const captionField = findKwaiCaptionField(nodes);
    if (!captionField) throw new Error('Kwai: campo de legenda não encontrado; não vou publicar sem a legenda');
    let captionEdited = false;
    if (!matchesKwaiCaption(captionField, caption)) {
      if (!isEmptyKwaiCaptionField(captionField) && resumeMarker) {
        throw new Error('Kwai: compositor retomado contém legenda parcial/divergente; envio interrompido');
      }
      await tapKwaiControl(kwai, captionField, 'campo de legenda');
      await kwai.replaceText(String(caption).slice(0, 2000));
      captionEdited = true;
    }
    // A retry may reopen an existing composer whose caption already matches,
    // while Kwai's suggestion tray from the previous attempt is still open.
    // Recheck and dismiss overlays even when this invocation did not edit text.
    if (captionEdited || hasKwaiHashtagSuggestions(nodes)) {
      // The Post button remains in the hidden hierarchy while suggestions are
      // open, so a coordinate tap could select a suggestion instead of submit.
      // Hide the IME/tray and verify the final caption before exposing Post.
      const captionedComposer = current => {
        const field = findKwaiCaptionField(current);
        return isKwaiPostComposer(current)
          && field && matchesKwaiCaption(field, caption)
          && Boolean(findKwaiNode(current, { id: 'kwai.lite.video.product:id/rl_set_permission', clickable: true }));
      };
      // Android exposes the IME and Kwai's hashtag tray as separate layers.
      // A first BACK may hide only the keyboard, leaving suggestions over Post.
      // Dismiss each layer once, checking that the captioned composer remains
      // visible after every key event. Any unexpected navigation fails closed.
      for (let layer = 0; layer < 2; layer++) {
        await kwai.key(kwai.KEY.BACK);
        const afterBack = await waitForKwaiUi(kwai, current => captionedComposer(current)
          || Boolean(findKwaiComposerExitCancel(current)),
        'o compositor ou aviso para continuar editando após fechar teclado/sugestões', { timeoutMs: 5000 });
        const cancelExit = findKwaiComposerExitCancel(afterBack);
        if (cancelExit) {
          await tapKwaiControl(kwai, cancelExit, 'cancelar somente a saída do compositor');
          nodes = await waitForKwaiUi(kwai, captionedComposer,
            'o compositor com a legenda após cancelar a saída', { timeoutMs: 5000 });
        } else {
          nodes = afterBack;
        }
        if (!hasKwaiHashtagSuggestions(nodes)) break;
      }
      if (hasKwaiHashtagSuggestions(nodes)) {
        throw new Error('Kwai: sugestões de hashtag permaneceram visíveis após fechar teclado e bandeja');
      }
    }
    await kwai.screencap('06_legenda');
    nodes = await waitForKwaiUi(kwai, current => {
      const field = findKwaiCaptionField(current);
      const privacyControl = findKwaiNode(current, { id: 'kwai.lite.video.product:id/rl_set_permission', clickable: true });
      return isKwaiPostComposer(current) && field && matchesKwaiCaption(field, caption)
        && Boolean(privacyControl) && !hasKwaiHashtagSuggestions(current);
    }, 'a legenda e os controles do compositor');

    if (!isKwaiPrivacyApplied(nodes, desiredPrivacy)) {
      const privacyRow = findKwaiNode(nodes, { id: 'kwai.lite.video.product:id/rl_set_permission', clickable: true });
      if (!privacyRow) throw new Error('Kwai: controle de privacidade não identificado; envio interrompido');
      await tapKwaiControl(kwai, privacyRow, 'abrir privacidade');
      nodes = await waitForKwaiUi(kwai, isKwaiPrivacySettingsScreen, 'a tela de opções de privacidade');
      const privacyOption = findKwaiPrivacyOption(nodes, desiredPrivacy);
      if (!privacyOption) throw new Error('Kwai: opção de privacidade solicitada não aparece');
      await tapKwaiControl(kwai, privacyOption, `selecionar privacidade ${desiredPrivacy}`);
      nodes = await waitForKwaiUi(kwai, current => isKwaiPrivacySettingsScreen(current)
        && (hasKwaiPublicPromotionDialog(current) || !current.some(node => node.rid === 'kwai.lite.video.basis:id/dialog_content')),
      `a seleção de privacidade ${desiredPrivacy}`);
      if (hasKwaiPublicPromotionDialog(nodes)) {
        const recommendation = findKwaiNode(nodes, {
          id: `kwai.lite.video.basis:id/${desiredPrivacy === 'private' ? 'negative' : 'positive'}`,
          text: desiredPrivacy === 'private' ? /^Not now$/i : /^Sure$/i,
          clickable: true
        });
        if (!recommendation) throw new Error('Kwai: recomendação de privacidade sem opção segura identificada');
        await tapKwaiControl(kwai, recommendation, `manter privacidade ${desiredPrivacy}`);
        nodes = await waitForKwaiUi(kwai, current => isKwaiPrivacySettingsScreen(current)
          && !hasKwaiPublicPromotionDialog(current), 'o fechamento da recomendação de privacidade');
      }
      const privacyBack = findKwaiNode(nodes, { id: 'kwai.lite.video.basis:id/left_btn', clickable: true });
      if (!privacyBack) throw new Error('Kwai: botão de retorno da privacidade não identificado');
      await tapKwaiControl(kwai, privacyBack, 'voltar à tela de publicação');
      nodes = await waitForKwaiUi(kwai, current => isKwaiPrivacyApplied(current, desiredPrivacy),
        `privacidade ${desiredPrivacy} aplicada na tela de publicação`);
    }
    const savedCaption = findKwaiCaptionField(nodes);
    if (!savedCaption || !String(savedCaption.text || '').includes(String(caption).trim().slice(0, 12))) {
      throw new Error('Kwai: a legenda deixou de estar visível após definir a privacidade');
    }

    const publish = findKwaiNode(nodes, { id: 'kwai.lite.video.basis:id/post', clickable: true });
    if (!publish) throw new Error('Kwai: botão de publicação explícito não identificado');
    await tapKwaiControl(kwai, publish, 'publicar');
    const postTransition = await waitForKwaiPostTapTransition(kwai, caption);
    if (postTransition.status === 'not_submitted') {
      await kwai.screencap('07_post_nao_submetido');
      throw new Error('Kwai: botão Post continuou ativo com a legenda do job; a submissão não começou');
    }
    publishActionStarted = true;
    step('kwai', 'envio acionado; aguardando confirmação do app…');
    await kwai.screencap('07_publicando');
    let publishResponseError = null;
    try {
      nodes = await waitForKwaiPublishResponse(kwai, KWAI_POST_SUBMIT_UI_WAIT_MS);
      if (hasKwaiPublishConfirmation(nodes)) {
        await kwai.screencap('08_final');
        if (resumeMarker) await clearKwaiUploadResume({ stateDir: resumeStateDir }).catch(error => {
          console.warn(`  [kwai] não foi possível limpar o marcador após confirmação: ${error.message}`);
        });
        return confirmedAppPublication('kwai', videoPath, {
          kind: 'success_message',
          observed: nodes.find(node => /published successfully|video published|post shared|publicado com sucesso|vídeo publicado|publicação concluída/i.test(`${node.text || ''} ${node.desc || ''}`))?.text || 'confirmação do app'
        });
      }
    } catch (error) {
      publishResponseError = error;
    }
    try {
      const profileEvidence = await waitForKwaiPostInProfile(kwai, {
        privacy: desiredPrivacy,
        caption: String(caption).slice(0, 2000),
        timeoutMs: KWAI_PROFILE_VERIFY_TIMEOUT_MS
      });
      await kwai.screencap('08_final');
      if (profileEvidence) {
        step('kwai', `post ${desiredPrivacy} confirmado no perfil (${profileEvidence.postTime})`);
        if (resumeMarker) await clearKwaiUploadResume({ stateDir: resumeStateDir }).catch(error => {
          console.warn(`  [kwai] não foi possível limpar o marcador após confirmação: ${error.message}`);
        });
        return confirmedAppPublication('kwai', videoPath, profileEvidence);
      }
      return uncertainAppPublication('kwai', videoPath, 'botão de publicação acionado; post não apareceu no perfil com a legenda esperada');
    } catch (error) {
      await kwai.screencap('08_final');
      const reason = publishResponseError
        ? `${publishResponseError.message}; verificação do perfil: ${error.message}`
        : error.message;
      return uncertainAppPublication('kwai', videoPath, `botão de publicação acionado; confirmação não observada: ${reason}`);
    }
  } catch (error) {
    if (publishActionStarted) {
      return uncertainAppPublication('kwai', videoPath, `publicação acionada; resultado não confirmado: ${String(error.message || error).slice(0, 160)}`);
    }
    const observed = String(error.message || error).replace(/[\r\n\t]+/g, ' ').slice(0, 180);
    return createPublicationResult({
      platform: 'kwai',
      videoPath,
      status: 'failed',
      failureCode: 'pre_submit_ui_error',
      evidence: { kind: 'confirmed_no_send', observed: `Fluxo interrompido antes do toque em publicar: ${observed}` }
    });
  }
}

async function verifyKwaiPostInProfile(kwai, { privacy, caption, timeoutMs = 30000 } = {}) {
  let enteredProfile = false;
  let openedPost = false;
  let openedCaption = false;
  try {
    let nodes;
    // Kwai may open the newly submitted post directly. Returning from this
    // known detail activity is read-only and lets us inspect the public tab.
    const activity = await readKwaiResumedActivity(kwai);
    if (isKwaiVideoDetailActivity(activity, process.env.KWAI_PACKAGE || process.env.ANDROID_APP_KWAI_PACKAGE || 'kwai.lite.video')) {
      const detailNodes = await kwai.dumpUI();
      const back = findKwaiNode(detailNodes, { id: 'kwai.lite.video.basis:id/inside_stream_back_btn', clickable: true });
      if (!back) throw new Error('Kwai: detalhe aberto sem botão voltar reconhecido; confirmação interrompida');
      await tapKwaiControl(kwai, back, 'voltar do detalhe para verificar o perfil');
      nodes = await waitForKwaiUi(kwai, current => isKwaiProfile(current) || isKwaiFeedScreen(current),
        'o perfil ou feed após fechar o detalhe', { timeoutMs });
    }
    try {
      nodes ||= await waitForKwaiUi(kwai, isKwaiFeedScreen, 'o feed após o envio', { timeoutMs });
    } catch (error) {
      error.code = 'KWAI_POST_NOT_VISIBLE_YET';
      throw error;
    }
    if (!isKwaiProfile(nodes)) {
      const profileTab = findKwaiNode(nodes, { id: 'kwai.lite.video.basis:id/consume_tab_text', text: /^(profile|perfil)$/i });
      if (!profileTab) throw new Error('aba Perfil não identificada após o envio');
      await tapKwaiControl(kwai, profileTab, 'abrir o perfil para verificar o post');
      nodes = await waitForKwaiUi(kwai, isKwaiProfile, 'o perfil da conta', { timeoutMs });
    }
    enteredProfile = true;
    const account = nodes.find(node => node.rid === 'kwai.lite.video.basis:id/tv_user_id')?.text?.trim()
      || nodes.find(node => node.rid === 'kwai.lite.video.basis:id/title_tv')?.text?.trim()
      || null;
    const tabs = findKwaiProfileTabs(nodes);
    if (tabs.length !== 4) throw new Error(`abas do perfil não reconhecidas (${tabs.length}/4)`);
    const privacyTabIndex = privacy === 'private' ? 1 : 0;
    await tapKwaiControl(kwai, tabs[privacyTabIndex], `aba ${privacy} do perfil`);

    try {
      nodes = await waitForKwaiUi(kwai, current => isKwaiProfile(current)
      && (getKwaiProfilePosts(current).length > 0 || current.some(node => /no (private )?(videos|posts)|sem (vídeos|videos|publicações|posts)/i.test(node.text || ''))),
      `a lista de posts ${privacy} do perfil`, { timeoutMs });
    } catch (error) {
      error.code = 'KWAI_POST_NOT_VISIBLE_YET';
      throw error;
    }
    const latestPost = getKwaiProfilePosts(nodes)[0];
    if (!latestPost) {
      const error = new Error(`nenhum post apareceu na aba ${privacy} do perfil`);
      error.code = 'KWAI_POST_NOT_VISIBLE_YET';
      throw error;
    }
    await tapKwaiControl(kwai, latestPost, 'abrir o post mais recente do perfil');
    openedPost = true;

    let postTime = '';
    let observedCaption = null;
    try {
      nodes = await waitForKwaiUi(kwai, current => current.some(node => node.rid === 'kwai.lite.video.basis:id/slide_play_tv_user_info_desc')
        && current.some(node => node.rid === 'kwai.lite.video.basis:id/tv_slide_play_post_time' && Boolean(node.text)),
      'a legenda e data do post no perfil', { timeoutMs });
      postTime = nodes.find(node => node.rid === 'kwai.lite.video.basis:id/tv_slide_play_post_time')?.text || '';
      observedCaption = nodes.find(node => node.rid === 'kwai.lite.video.basis:id/slide_play_tv_user_info_desc'
        && matchesKwaiCaption(node, caption));
      const truncated = nodes.find(node => node.rid === 'kwai.lite.video.basis:id/slide_play_tv_user_info_desc'
        && node.clickable && /(?:\.\.\.|…)\s*(?:more|mais)$/i.test(String(node.text || '')));
      if (!observedCaption && truncated) {
        // On the current Kwai UI, expanding a truncated caption opens the
        // comments panel with the keyboard. Hide the keyboard, then verify the
        // full author caption. Never type or submit a comment.
        await tapKwaiControl(kwai, truncated, 'expandir a legenda para conferência');
        openedCaption = true;
        nodes = await waitForKwaiUi(kwai, current => current.some(node =>
          node.rid === 'kwai.lite.video.basis:id/comment_tab_close_dialog'
          || node.rid === 'kwai.lite.video.basis:id/editor'), 'o painel de legenda', { timeoutMs });
        for (let layer = 0; layer < 2 && !nodes.some(node => node.rid === 'kwai.lite.video.basis:id/comment'); layer++) {
          await kwai.key(kwai.KEY.BACK);
          nodes = await waitForKwaiUi(kwai, current => current.some(node => node.rid === 'kwai.lite.video.basis:id/comment'
            || node.rid === 'kwai.lite.video.basis:id/editor'), 'a legenda ou o teclado', { timeoutMs });
        }
        const normalizeCaption = value => String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
        nodes = await waitForKwaiUi(kwai, current => current.some(node => node.rid === 'kwai.lite.video.basis:id/tv_tag_author'
          && /^(author|autor)$/i.test(String(node.text || '')))
          && current.some(node => node.rid === 'kwai.lite.video.basis:id/comment'
            && normalizeCaption(node.text) === normalizeCaption(caption)), 'a legenda completa do autor', { timeoutMs });
        observedCaption = nodes.find(node => node.rid === 'kwai.lite.video.basis:id/comment'
          && normalizeCaption(node.text) === normalizeCaption(caption));
      }
      if (!observedCaption) throw new Error('legenda não corresponde à publicação esperada');
    } catch (error) {
      error.code = 'KWAI_POST_NOT_VISIBLE_YET';
      throw error;
    }
    const screenshotPath = typeof kwai.screencap === 'function'
      ? await Promise.resolve(kwai.screencap('profile_confirmed')).catch(() => null) : null;
    return {
      kind: privacy === 'private' ? 'private_profile_post' : 'public_profile_post',
      observed: observedCaption?.text || '',
      postTime,
      account,
      ...(screenshotPath ? { screenshotPath } : {})
    };
  } finally {
    if (openedCaption) {
      const current = await kwai.dumpUI().catch(() => []);
      const close = findKwaiNode(current, { id: 'kwai.lite.video.basis:id/comment_tab_close_dialog', clickable: true });
      if (close) await tapKwaiControl(kwai, close, 'fechar o painel de legenda').catch(() => {});
    }
    if (openedPost) {
      await kwai.key(kwai.KEY.BACK).catch(() => {});
      await waitForKwaiUi(kwai, isKwaiProfile, 'o retorno ao perfil', { timeoutMs: 10000 }).catch(() => {});
    }
    if (enteredProfile) {
      await kwai.key(kwai.KEY.BACK).catch(() => {});
      await waitForKwaiUi(kwai, isKwaiFeedScreen, 'o retorno ao feed', { timeoutMs: 10000 }).catch(() => {});
    }
  }
}

async function waitForKwaiPostInProfile(kwai, {
  privacy,
  caption,
  timeoutMs = KWAI_PROFILE_VERIFY_TIMEOUT_MS,
  attemptTimeoutMs = 20000,
  retryDelayMs = 4000
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      return await verifyKwaiPostInProfile(kwai, {
        privacy,
        caption,
        timeoutMs: Math.max(1, Math.min(attemptTimeoutMs, remaining))
      });
    } catch (error) {
      if (error.code !== 'KWAI_POST_NOT_VISIBLE_YET') throw error;
      lastError = error;
    }
    const delay = Math.min(retryDelayMs, deadline - Date.now());
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  }
  const error = new Error(`Kwai: post esperado não ficou visível no perfil dentro do prazo${lastError ? ` (${lastError.message})` : ''}`);
  error.code = 'KWAI_PROFILE_VERIFY_TIMEOUT';
  throw error;
}

async function resumeKwaiComposerIfMatching(kwai, nodes, {
  videoPath, caption, privacy = 'public', resumeMarker = null, resumeStateDir
} = {}) {
  if (!isKwaiPostComposer(nodes)) return null;
  const captionField = findKwaiCaptionField(nodes);
  const markerMatches = resumeMarker && await matchesKwaiUploadResume(resumeMarker, {
    videoPath,
    caption,
    albumName: kwaiStagingAlbumName(videoPath),
    durationSeconds: resumeMarker.durationSeconds
  });
  if (resumeMarker && !markerMatches) throw new Error('Kwai: marcador não corresponde ao rascunho aberto; envio interrompido');
  const captionMatches = captionField && matchesKwaiCaption(captionField, caption);
  const blankCaptionWithVerifiedMarker = markerMatches && isEmptyKwaiCaptionField(captionField);
  if (!captionField || (!captionMatches && !blankCaptionWithVerifiedMarker)) {
    throw new Error('Kwai: compositor já aberto não corresponde à legenda deste job; envio interrompido');
  }
  return completeKwaiDraftFromEditor(kwai, {
    videoPath, caption, privacy, initialNodes: nodes, resumeMarker, resumeStateDir
  });
}

async function uploadKwaiOnDevice({ videoPath, caption, privacy = 'public' }) {
  const kwai = kwaiEmu();
  await kwai.acquire();
  try {
    const duration = await getMediaDuration(videoPath);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Kwai: duração do vídeo não pôde ser verificada');

    let persistedResume = await readKwaiUploadResume();
    const resumeMatches = persistedResume && await matchesKwaiUploadResume(persistedResume, {
      videoPath, caption, albumName: kwaiStagingAlbumName(videoPath), durationSeconds: duration
    });
    if (persistedResume && !resumeMatches) {
      await archiveUnrelatedKwaiResume(persistedResume, {
        videoPath, activity: await readKwaiResumedActivity(kwai), nodes: await kwai.dumpUI(),
        packageName: process.env.KWAI_PACKAGE || process.env.ANDROID_APP_KWAI_PACKAGE || 'kwai.lite.video'
      });
      persistedResume = null;
      step('kwai', 'marcador de outro vídeo preservado no arquivo de recuperação; resultado anterior continua incerto, sem reenvio');
    }
    const resumeMarker = resolveKwaiUploadResume(persistedResume, resumeMatches);
    let staged;
    if (resumeMarker) {
      staged = { albumName: resumeMarker.albumName, reusedExisting: true };
      step('kwai', `retomando ${staged.albumName}; arquivo, duração e legenda conferem, sem substituir a mídia selecionada…`);
    } else {
      step('kwai', 'enviando o arquivo para um álbum Android exclusivo…');
      staged = await kwai.pushVideo(videoPath);
      step('kwai', `arquivo enviado; álbum temporário ${staged.albumName}`);
    }

    const expectedPackage = process.env.KWAI_PACKAGE || process.env.ANDROID_APP_KWAI_PACKAGE || 'kwai.lite.video';
    let resumedActivity = resumeMarker ? await readKwaiResumedActivity(kwai) : null;
    if (resumeMarker && isKwaiEditorActivity(resumedActivity, expectedPackage)) {
      await kwai.screencap('01_aberto');
      step('kwai', 'EditorActivity corresponde ao rascunho verificado; aguardando o compositor sem tocar Next…');
      return await completeKwaiDraftFromEditor(kwai, {
        videoPath, caption, privacy, resumeMarker
      });
    }
    let recoveredStartNodes = null;
    if (isKwaiVideoDetailActivity(resumedActivity, expectedPackage)) {
      const detailNodes = await kwai.dumpUI();
      const back = findKwaiNode(detailNodes, { id: 'kwai.lite.video.basis:id/inside_stream_back_btn', clickable: true });
      if (!back) throw new Error('Kwai: detalhe de vídeo ativo sem botão voltar reconhecido; envio interrompido');
      await tapKwaiControl(kwai, back, 'voltar do detalhe público ao perfil');
      recoveredStartNodes = await waitForKwaiUi(kwai, current => isKwaiProfile(current) || isKwaiFeedScreen(current),
        'perfil/feed após fechar o detalhe público', { timeoutMs: 10000 });
    }
    const shouldOpenApp = shouldOpenKwaiAppForResume({
      resumeMarker, resumedActivity, packageName: expectedPackage
    });
    if (shouldOpenApp) {
      await kwai.openApp();
      resumedActivity = resumeMarker ? await readKwaiResumedActivity(kwai) : null;
    }
    await kwai.screencap('01_aberto');
    if (resumeMarker && isKwaiEditorActivity(resumedActivity, expectedPackage)) {
      step('kwai', 'EditorActivity corresponde ao rascunho verificado; aguardando o compositor sem tocar Next…');
      return await completeKwaiDraftFromEditor(kwai, {
        videoPath, caption, privacy, resumeMarker
      });
    }
    const hasPermissionPrompt = current => current.some(node => /while using the app|only this time|allow all|^(permitir|allow|enquanto usa)/i.test(`${node.text || ''} ${node.desc || ''}`));
    let nodes = recoveredStartNodes || await waitForKwaiUi(kwai, current => current.some(node => /id_record_layout/i.test(node.rid || ''))
      || hasPermissionPrompt(current) || isKwaiPostComposer(current) || isKwaiSourceGallery(current)
      || (resumeMarker && isKwaiVideoEditor(current)),
      'a tela inicial do Kwai, galeria sem seleção, compositor ou permissão do Android');

    if (isKwaiSourceGallery(nodes)) {
      if (findKwaiSelectedDuration(nodes)) {
        throw new Error('Kwai: galeria de retomada contém mídia selecionada; envio interrompido para preservar o rascunho');
      }
      const back = findKwaiNode(nodes, { id: 'kwai.lite.video.product:id/album_left_btn', clickable: true });
      if (!back) throw new Error('Kwai: galeria aberta sem mídia selecionada e sem botão Voltar reconhecido');
      step('kwai', 'fechando apenas a galeria vazia deixada pela tentativa anterior; nenhum rascunho será descartado…');
      await tapKwaiControl(kwai, back, 'voltar da galeria vazia');
      nodes = await waitForKwaiUi(kwai, current => current.some(node => /id_record_layout/i.test(node.rid || ''))
        || hasPermissionPrompt(current) || isKwaiPostComposer(current),
      'a câmera do Kwai após fechar a galeria vazia');
    }

    if (isKwaiPostComposer(nodes)) {
      if (persistedResume && !resumeMarker) {
        throw new Error('Kwai: compositor aberto tem marcador de outro arquivo/legenda; envio interrompido');
      }
      step('kwai', 'compositor existente identificado; conferindo a legenda antes de retomar…');
      return await resumeKwaiComposerIfMatching(kwai, nodes, {
        videoPath, caption, privacy, resumeMarker, resumeStateDir: undefined
      });
    }
    if (resumeMarker && isKwaiVideoEditor(nodes)) {
      step('kwai', `editor do álbum ${staged.albumName} corresponde ao arquivo; aguardando transcodificação sem repetir Next…`);
      return await completeKwaiDraftFromEditor(kwai, {
        videoPath, caption, privacy, initialNodes: nodes, resumeMarker
      });
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const permission = nodes.find(node => /while using the app|only this time|allow all|^(permitir|allow|enquanto usa)/i.test(`${node.text || ''} ${node.desc || ''}`));
      if (!permission) break;
      await tapKwaiControl(kwai, permission, 'permissão');
      nodes = await waitForKwaiUi(kwai, current => current.some(node => /id_record_layout/i.test(node.rid || '')) || hasPermissionPrompt(current),
        'a tela inicial depois das permissões');
    }

    const record = nodes.find(node => /id_record_layout/i.test(node.rid || '') && node.clickable)
      || nodes.find(node => /^(postar|câmera|criar)$/i.test(node.text || node.desc || '') && node.clickable);
    if (!record) throw new Error('Kwai: botão de criação não identificado; nenhum item foi selecionado');
    await tapKwaiControl(kwai, record, 'criar vídeo');
    nodes = await waitForKwaiUi(kwai, current => current.some(node => /^(album|álbum|galeria|gallery)$/i.test(node.text || '')),
      'a tela de câmera com acesso ao álbum');
    await kwai.screencap('02_tela_post');

    const albumButton = nodes.find(node => /^(album|álbum|galeria|gallery)$/i.test(node.text || '') && node.clickable);
    if (!albumButton) throw new Error('Kwai: atalho do álbum não é clicável na tela de câmera');
    await tapKwaiControl(kwai, albumButton, 'abrir álbum');
    nodes = await waitForKwaiUi(kwai, current => current.some(node => node.rid === 'kwai.lite.video.basis:id/album_view_list'),
      'a grade do álbum');
    await kwai.screencap('03_galeria');

    const albumTitle = nodes.find(node => node.rid === 'kwai.lite.video.basis:id/kwai_album_tab_text' && /^Gallery$/i.test(node.text || ''));
    if (!albumTitle) throw new Error('Kwai: seletor de álbum não reconhecido; não vou escolher um vídeo por posição');
    await tapKwaiControl(kwai, albumTitle, 'seletor de álbum');
    nodes = await waitForKwaiUi(kwai, current => current.some(node => node.rid === 'kwai.lite.video.basis:id/kwai_album_list_item_label'),
      'as opções da lista de álbuns');
    const albumSearch = await findKwaiUploadAlbumOptionAcrossPages({
      initialNodes: nodes,
      albumName: staged.albumName,
      advance: async (_currentNodes, container) => {
        const swipe = kwaiAlbumListSwipe(container);
        if (!swipe) throw new Error('Kwai: área rolável de álbuns não tem limites seguros');
        await kwai.swipe(swipe.x1, swipe.y1, swipe.x2, swipe.y2, swipe.durationMs);
        return waitForKwaiUi(kwai,
          current => current.some(node => node.rid === 'kwai.lite.video.basis:id/kwai_album_list_item_label'),
          'a próxima página de álbuns', { timeoutMs: 10000 });
      },
      maxPages: 24
    });
    nodes = albumSearch.nodes;
    const albumOption = albumSearch.option;
    if (!albumOption) throw new Error('Kwai: nem o álbum temporário nem Gallery aparecem como opção selecionável');
    if (albumOption.mode !== 'isolated_album' && !albumSearch.reachedEnd) {
      throw new Error('Kwai: a lista de álbuns não chegou ao fim; seleção pela Gallery foi interrompida');
    }
    if (albumOption.mode === 'gallery_fallback') {
      step('kwai', 'álbum isolado ausente após percorrer a lista; Gallery só será usada com duração única confirmada');
    }
    await tapKwaiControl(kwai, albumOption.node, albumOption.mode === 'isolated_album' ? 'álbum exclusivo' : 'Gallery');
    nodes = await waitForKwaiUi(kwai, current => current.some(node => node.rid === 'kwai.lite.video.basis:id/album_view_list'),
      albumOption.mode === 'isolated_album' ? `a grade isolada ${staged.albumName}` : 'a grade geral da Gallery');
    const videosTab = findKwaiNode(nodes, { text: /^(videos?|vídeos)$/i, clickable: true });
    if (videosTab) await tapKwaiControl(kwai, videosTab, 'filtrar vídeos');
    nodes = await waitForKwaiUi(kwai, current => current.some(node => node.rid === 'kwai.lite.video.basis:id/album_view_list'),
      'a grade de vídeos do álbum');

    const selectionToggle = findKwaiNode(nodes, {
      id: 'kwai.lite.video.product:id/album_multi_select_checkbox',
      text: /^(select|cancel)$/i,
      clickable: true
    });
    if (!selectionToggle) throw new Error('Kwai: estado do modo de seleção não identificado; envio interrompido');
    if (/^select$/i.test(selectionToggle.text || '')) {
      await tapKwaiControl(kwai, selectionToggle, 'ativar seleção');
      nodes = await waitForKwaiUi(kwai, current => findKwaiNode(current, {
        id: 'kwai.lite.video.product:id/album_multi_select_checkbox', text: /^cancel$/i, clickable: true
      }), 'o modo de seleção');
    } else if (isKwaiSelectionConfirmed(nodes) || nodes.some(node => node.rid === 'kwai.lite.video.basis:id/selected_des')) {
      throw new Error('Kwai: já existe seleção anterior na galeria; não vou misturar vídeos');
    }

    const targetItem = findUniqueKwaiGalleryItem(nodes, duration, { isolatedAlbum: albumOption.mode === 'isolated_album' });
    await tapKwaiControl(kwai, targetItem.container, 'selecionar o único vídeo do álbum');
    nodes = await waitForKwaiUi(kwai, isKwaiSelectionConfirmed, 'a seleção única do vídeo enviado');
    const selectedDuration = findKwaiSelectedDuration(nodes);
    if (!selectedDuration || parseDurationLabel(selectedDuration.text) === null
      || Math.abs(parseDurationLabel(selectedDuration.text) - duration) > 1) {
      throw new Error('Kwai: duração do vídeo selecionado diverge do arquivo enviado');
    }
    await kwai.screencap('04_selecionado');

    let selectedResume = await createKwaiUploadResume({
      videoPath,
      caption,
      albumName: staged.albumName,
      durationSeconds: duration,
      stage: 'selected'
    });
    await saveKwaiUploadResume(selectedResume);

    const confirmSelection = findKwaiNode(nodes, {
      id: 'kwai.lite.video.product:id/btn_next_step', text: /^OK\s*\(1\)$/i, clickable: true
    });
    if (!confirmSelection) throw new Error('Kwai: botão OK (1) não confirmou a seleção exata');
    await tapKwaiControl(kwai, confirmSelection, 'confirmar vídeo selecionado');
    return await completeKwaiDraftFromEditor(kwai, {
      videoPath, caption, privacy, resumeMarker: selectedResume
    });
  } catch (error) {
    const observed = String(error.message || error).replace(/[\r\n\t]+/g, ' ').slice(0, 180);
    return createPublicationResult({
      platform: 'kwai',
      videoPath,
      status: 'failed',
      failureCode: 'pre_submit_ui_error',
      evidence: { kind: 'confirmed_no_send', observed: `Fluxo interrompido antes do toque em publicar: ${observed}` }
    });
  } finally {
    kwai.release();
  }
}

// Rotas públicas das redes sociais. TikTok, Instagram e Kwai só avançam quando
// houver sessão Android verificada e um handler nativo implementado; destinos
// sem fluxo nativo falham fechados sem abrir Chromium.
async function uploadTikTok({ videoPath, caption }) {
  return publishSocialOnAndroid('tiktok', { videoPath, caption });
}

async function uploadKwai({ videoPath, caption, privacy = 'public' }) {
  return publishSocialOnAndroid('kwai', { videoPath, caption, privacy });
}

async function uploadInstagram({ videoPath, caption }) {
  return publishSocialOnAndroid('instagram', { videoPath, caption });
}

async function uploadX({ videoPath, caption }) {
  return publishSocialOnAndroid('x', { videoPath, caption });
}

async function uploadTelegram({ videoPath, caption }) {
  return publishSocialOnAndroid('telegram', { videoPath, caption, channel: process.env.TELEGRAM_CHANNEL || '' });
}

/* ---------------- orquestrador ---------------- */

async function uploadToAll({ videoPath, clips = [], title, hashtags, themeId = 'ia', sourceUrl = '', thumbnailCredit = '', skipYouTube = false, skipShorts = skipYouTube, maxShorts = Number(process.env.MAX_SHORTS || Number.MAX_SAFE_INTEGER), seo = null, thumbnailPath = '', previousResults = {}, onPublicationState, qaManifestPath = null, qaManifest: suppliedQaManifest = null }) {
  if (typeof onPublicationState !== 'function') throw new TypeError('uploadToAll exige persistência por destino antes do envio');
  const qaManifest = suppliedQaManifest || await verifyVideoQaForUpload(videoPath, clips);
  if (!['verified', 'legacy'].includes(qaManifest.status)) {
    throw Object.assign(new Error('QA por hash inválido: ' + qaManifest.reason), { code: 'VIDEO_QA_MANIFEST_INVALID' });
  }
  assertPublicationVisualGate(qaManifest);
  const resolvedHashtags = resolveThemeHashtags(hashtags ?? seo?.hashtags, themeId);
  const results = { long: {}, clips: {} };

  const previousLong = platform => previousResults.long?.[platform];
  const persistNoSend = args => recordNoSend({ ...args, onPublicationState });
  const runUpload = async args => {
    const visualGate = publicationVisualGate(qaManifest, args.videoPath);
    if (!visualGate.allowed) {
      step(args.platform, `envio bloqueado: QA visual não aprovado para ${path.basename(args.videoPath)}`);
      return args.previous;
    }
    if (!shouldAttemptPublication(args.previous, Date.now(), {
      platform: args.platform, artifactPath: args.videoPath, root: ROOT, qaManifestPath,
      handlerAvailable: hasNativeUploadHandler(args.platform),
      identityVerified: ['youtube', 'shorts'].includes(args.platform)
        || (SOCIAL_IDENTITY_REQUIRED.has(args.platform) && isLogged(args.platform))
    })) {
      step(args.platform, `envio suspenso: estado anterior ${args.previous?.status || String(args.previous).slice(0, 50)} exige reconciliação`);
    }
    return checkpointedPublication({ ...args, qaManifestPath, onPublicationState,
      artifactSha256: args.artifactSha256 || qaAssetSha256(qaManifest, args.videoPath),
      handlerAvailable: hasNativeUploadHandler(args.platform),
      identityVerified: ['youtube', 'shorts'].includes(args.platform)
        || (SOCIAL_IDENTITY_REQUIRED.has(args.platform) && isLogged(args.platform)) });
  };

  // 1) YouTube — vídeo longo pelo Studio autenticado do Android.
  if (skipYouTube) {
    results.long.youtube = await persistNoSend({ scope: 'long', platform: 'youtube', videoPath, previous: previousLong('youtube'), result: 'pulado (cota)' });
  } else {
    let durationCheck = null;
    try { durationCheck = await durationAllowed(videoPath, 'youtube'); }
    catch (error) {
      results.long.youtube = await persistNoSend({ scope: 'long', platform: 'youtube', videoPath, previous: previousLong('youtube'), result: 'ignorado: duração do vídeo não pôde ser verificada' });
      console.warn(`  [youtube] duração não verificada: ${String(error.message || error).slice(0, 120)}`);
    }
    if (durationCheck && !durationCheck.allowed) {
      const rejection = durationCheck.duration < durationCheck.minSeconds
        ? `ignorado: master YouTube com ${durationCheck.duration.toFixed(1)}s abaixo do mínimo editorial de ${durationCheck.minSeconds}s (6 minutos)`
        : `ignorado: ${durationCheck.duration.toFixed(1)}s excede o limite configurado de ${durationCheck.maxSeconds}s`;
      results.long.youtube = await persistNoSend({
        scope: 'long', platform: 'youtube', videoPath, previous: previousLong('youtube'),
        result: rejection
      });
      if (durationCheck.duration < durationCheck.minSeconds) console.warn(`  [youtube] ${rejection}`);
    } else if (durationCheck) {
      results.long.youtube = await runUpload({
        scope: 'long', platform: 'youtube', videoPath, previous: previousLong('youtube'),
        upload: async () => {
          const ytDescription = [
            seo?.description || title,
            sourceUrl ? `Fonte: ${sourceUrl}` : '',
            thumbnailCredit ? `Imagem da capa: ${thumbnailCredit}` : '',
            resolvedHashtags
          ].filter(Boolean).join('\n\n');
          const r = await withBudget(uploadWithStudio({
            videoPath, title: resolvePublicationTitle({ title }), description: ytDescription,
            expectedSha256: qaAssetSha256(qaManifest, videoPath),
            privacyStatus: process.env.YT_PRIVACY || 'public',
            ...(thumbnailPath ? { thumbnailPath } : {})
          }), 'youtube', PLATFORM_BUDGET_MS.youtube);
          console.log(`  [youtube Studio] ${r.url || `status ${r.status}; sem URL confirmada`}`);
          return r;
        }
      });
    }
  }

  // Relatório completo no X é opcional: habilite apenas com Premium confirmado
  // e limite ajustado ao app Android (máximo documentado de 600 s).
  if (X_POST_FULL_VIDEO) {
    if (DISABLED_PLATFORMS.includes('x')) results.long.x = await persistNoSend({ scope: 'long', platform: 'x', videoPath, previous: previousLong('x'), result: 'desativado em SOCIALS_DISABLED' });
    else if (!(await ensureSocialReady('x')).ready) results.long.x = await persistNoSend({ scope: 'long', platform: 'x', videoPath, previous: previousLong('x'), result: socialNotReadyResult('x', videoPath, await ensureSocialReady('x')) });
    else {
      let durationCheck = null;
      try { durationCheck = await durationAllowed(videoPath, 'x'); }
      catch (error) {
        results.long.x = await persistNoSend({ scope: 'long', platform: 'x', videoPath, previous: previousLong('x'), result: 'ignorado: duração do vídeo não pôde ser verificada' });
        console.warn(`  [x relatório completo] duração não verificada: ${error.message.slice(0, 120)}`);
      }
      if (durationCheck && !durationCheck.allowed) {
        results.long.x = await persistNoSend({ scope: 'long', platform: 'x', videoPath, previous: previousLong('x'), result: `ignorado: ${durationCheck.duration.toFixed(1)}s excede o limite configurado de ${durationCheck.maxSeconds}s` });
      } else if (durationCheck) {
        results.long.x = await runUpload({ scope: 'long', platform: 'x', videoPath, previous: previousLong('x'), upload: () => withBudget(uploadX({ videoPath, caption: `${title}\n\n${sourceUrl ? 'Fonte: ' + sourceUrl : ''}` }), 'x', PLATFORM_BUDGET_MS.x || UPLOAD_TIMEOUT_MS) });
      }
    }
  } else {
    results.long.x = await persistNoSend({ scope: 'long', platform: 'x', videoPath, previous: previousLong('x'), result: 'desativado (X_POST_FULL_VIDEO=1 para habilitar)' });
  }

  // 2) Partes verticais narrativas → Shorts, Kwai, X, Instagram e TikTok
  const parsedMaxShorts = Number(maxShorts);
  const shortsClips = clips.filter(isShortsTargeted);
  const shortsCount = Math.min(shortsClips.length, Math.max(0, Number.isFinite(parsedMaxShorts) ? Math.floor(parsedMaxShorts) : 1));
  const selectedShorts = new Set(shortsClips.slice(0, shortsCount));
  const youtubeChannelLimitReached = results.long.youtube?.failureCode === 'youtube_upload_limit';
  const shortsBlockedByChannelLimit = skipShorts || youtubeChannelLimitReached;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const clipTitle = buildShortsTitle({ title: clip.title, sourceTitle: title, partIndex: clip.partIndex,
      partCount: clip.partCount, hashtags: resolvedHashtags });
    const previousClip = priorClipResult(previousResults, clip.path, ROOT).value || {};
    results.clips[clip.path] = {};
    let clipDuration = null;
    try { clipDuration = await getMediaDuration(clip.path); }
    catch (e) { console.warn(`  [corte ${i + 1}] duração não verificada: ${e.message}`); }

    if (!shortsBlockedByChannelLimit && selectedShorts.has(clip)) {
      if (clipDuration == null) {
        results.clips[clip.path].shorts = await persistNoSend({ scope: 'clip', platform: 'shorts', videoPath: clip.path, previous: previousClip.shorts, result: 'ignorado: duração do corte não pôde ser verificada' });
      } else if (clipDuration > PLATFORM_VIDEO_LIMIT_SECONDS.shorts) {
        results.clips[clip.path].shorts = await persistNoSend({ scope: 'clip', platform: 'shorts', videoPath: clip.path, previous: previousClip.shorts, result: `ignorado: corte de ${clipDuration.toFixed(1)}s acima do limite de ${PLATFORM_VIDEO_LIMIT_SECONDS.shorts}s do Shorts` });
      } else {
        const rejection = narrativePartDurationRejection('shorts', clip, clipDuration, PLATFORM_VIDEO_LIMIT_SECONDS.shorts);
        if (rejection) {
          results.clips[clip.path].shorts = await persistNoSend({ scope: 'clip', platform: 'shorts', videoPath: clip.path, previous: previousClip.shorts, result: `ignorado: ${rejection}` });
        } else {
          const description = socialClipCaption({ clip, title: clip.title, hashtags: resolvedHashtags, sourceUrl, platform: 'shorts' });
          results.clips[clip.path].shorts = await runUpload({ scope: 'clip', platform: 'shorts', videoPath: clip.path, previous: previousClip.shorts, upload: async () => {
            const r = await withBudget(uploadWithStudio({
              platform: 'shorts', videoPath: clip.path, title: clipTitle, description,
              expectedSha256: qaAssetSha256(qaManifest, clip.path),
              privacyStatus: process.env.YT_PRIVACY || 'public'
            }), 'youtube', PLATFORM_BUDGET_MS.youtube);
            console.log(`  [shorts Studio ${i + 1}] ${r.url || `status ${r.status}; sem URL confirmada`}`);
            return r;
          } });
        }
      }
    } else {
      const result = !isShortsTargeted(clip) ? 'não alvo' : selectedShorts.has(clip) ? (shortsBlockedByChannelLimit ? 'pulado (cota)' : 'pulado') : 'desativado';
      results.clips[clip.path].shorts = await persistNoSend({ scope: 'clip', platform: 'shorts', videoPath: clip.path, previous: previousClip.shorts, result });
    }

    for (const [platform, fn] of [['tiktok', uploadTikTok], ['kwai', uploadKwai], ['instagram', uploadInstagram], ['x', uploadX]]) {
      if (!isPlatformTargeted(clip, platform)) {
        results.clips[clip.path][platform] = previousClip[platform] ?? 'não alvo';
        continue;
      }
      if (DISABLED_PLATFORMS.includes(platform)) { results.clips[clip.path][platform] = await persistNoSend({ scope: 'clip', platform, videoPath: clip.path, previous: previousClip[platform], result: 'desativado' }); continue; }
      const readiness = await ensureSocialReady(platform);
      if (!readiness.ready) { results.clips[clip.path][platform] = await persistNoSend({ scope: 'clip', platform, videoPath: clip.path, previous: previousClip[platform], result: socialNotReadyResult(platform, clip.path, readiness) }); continue; }
      if (clipDuration == null) {
        results.clips[clip.path][platform] = await persistNoSend({ scope: 'clip', platform, videoPath: clip.path, previous: previousClip[platform], result: 'ignorado: duração do corte não pôde ser verificada' });
        continue;
      }
      const maxSeconds = PLATFORM_VIDEO_LIMIT_SECONDS[platform];
      if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) {
        results.clips[clip.path][platform] = await persistNoSend({ scope: 'clip', platform, videoPath: clip.path, previous: previousClip[platform], result: 'ignorado: limite de duração não definido para o destino' });
        continue;
      }
      if (clipDuration > maxSeconds) {
        results.clips[clip.path][platform] = await persistNoSend({ scope: 'clip', platform, videoPath: clip.path, previous: previousClip[platform], result: `ignorado: ${clipDuration.toFixed(1)}s acima do limite configurado de ${maxSeconds}s` });
        continue;
      }
      const narrativeRejection = narrativePartDurationRejection(platform, clip, clipDuration, maxSeconds);
      if (narrativeRejection) {
        results.clips[clip.path][platform] = await persistNoSend({
          scope: 'clip', platform, videoPath: clip.path, previous: previousClip[platform],
          result: `ignorado: ${narrativeRejection}`
        });
        continue;
      }
      const platformCaption = socialClipCaption({ clip, title: clip.title, hashtags: resolvedHashtags, sourceUrl, platform });
      results.clips[clip.path][platform] = await runUpload({ scope: 'clip', platform, videoPath: clip.path, previous: previousClip[platform], upload: () => withBudget(fn({ videoPath: clip.path, caption: platformCaption }), platform, PLATFORM_BUDGET_MS[platform] || UPLOAD_TIMEOUT_MS) });
    }
  }

  // 3) Longo nas redes de vídeo longo (Telegram só se configurado no .env)
  if (process.env.TELEGRAM_CHANNEL && !DISABLED_PLATFORMS.includes('telegram')) {
    if (!isLogged('telegram')) { results.long.telegram = await persistNoSend({ scope: 'long', platform: 'telegram', videoPath, previous: previousLong('telegram'), result: 'não logado' }); }
    else {
      const fileSize = await fs.promises.stat(videoPath).then(stat => stat.size).catch(() => null);
      if (!Number.isSafeInteger(fileSize)) {
        results.long.telegram = await persistNoSend({ scope: 'long', platform: 'telegram', videoPath, previous: previousLong('telegram'), result: 'ignorado: tamanho do arquivo não pôde ser verificado' });
      } else if (!isWithinFileSizeLimit(fileSize, TELEGRAM_APP_MAX_FILE_BYTES)) {
        results.long.telegram = await persistNoSend({ scope: 'long', platform: 'telegram', videoPath, previous: previousLong('telegram'), result: `ignorado: arquivo de ${fileSize} bytes excede o limite configurado de ${TELEGRAM_APP_MAX_FILE_BYTES} bytes` });
      } else {
        results.long.telegram = await runUpload({ scope: 'long', platform: 'telegram', videoPath, previous: previousLong('telegram'), upload: () => withBudget(uploadTelegram({ videoPath, caption: `${title}\n\n${sourceUrl ? 'Fonte: ' + sourceUrl : ''}` }), 'telegram', PLATFORM_BUDGET_MS.telegram) });
      }
    }
  } else if (!DISABLED_PLATFORMS.includes('telegram')) {
    results.long.telegram = await persistNoSend({ scope: 'long', platform: 'telegram', videoPath, previous: previousLong('telegram'), result: 'desativado (TELEGRAM_CHANNEL ausente)' });
  } else {
    results.long.telegram = await persistNoSend({ scope: 'long', platform: 'telegram', videoPath, previous: previousLong('telegram'), result: 'desativado' });
  }

  return results;
}

async function retryPendingYouTubeShorts({ entry, results, maxShorts = Number(process.env.MAX_SHORTS || Number.MAX_SAFE_INTEGER), maxUploads = 1, onPublicationState, qaManifest: suppliedQaManifest = null }) {
  const next = {
    ...(results || {}),
    long: { ...(results?.long || {}) },
    clips: { ...(results?.clips || {}) }
  };
  const confirmedLong = /^https?:\/\//i.test(String(next.long.youtube || entry?.ytUrl || '').trim());
  if (!confirmedLong || !entry) return next;
  const qaManifest = suppliedQaManifest || await verifyEntryQaManifest(entry);
  if (!['verified', 'legacy'].includes(qaManifest.status)) throw Object.assign(new Error(`QA por hash inválido: ${qaManifest.reason}`), { code: 'VIDEO_QA_MANIFEST_INVALID' });
  assertPublicationVisualGate(qaManifest);

  const clips = (entry.clips || []).map(clip => typeof clip === 'string' ? { path: clip, title: entry.title } : clip)
    .filter(clip => clip && typeof clip.path === 'string' && clip.path);
  const shortsClips = clips.filter(isShortsTargeted);
  const parsedMaxShorts = Number(maxShorts);
  const shortsCount = Math.min(shortsClips.length, Math.max(0, Number.isFinite(parsedMaxShorts) ? Math.floor(parsedMaxShorts) : 1));
  const parsedMaxUploads = Number(maxUploads);
  const uploadLimit = Math.max(1, Number.isFinite(parsedMaxUploads) ? Math.floor(parsedMaxUploads) : 1);
  const mediaRoot = path.resolve(ROOT, 'data', 'videos');
  const withinMedia = candidate => candidate === mediaRoot || candidate.startsWith(`${mediaRoot}${path.sep}`);
  if (typeof onPublicationState !== 'function') throw new TypeError('retry de Shorts exige persistência por destino');

  let uploadsAttempted = 0;
  for (let index = 0; index < shortsCount; index++) {
    const clip = shortsClips[index];
    const match = Object.entries(next.clips).find(([resultPath]) => {
      const left = path.isAbsolute(resultPath) ? path.resolve(resultPath) : path.resolve(ROOT, resultPath);
      const right = path.isAbsolute(clip.path) ? path.resolve(clip.path) : path.resolve(ROOT, clip.path);
      return left === right;
    });
    const resultKey = match?.[0] || clip.path;
    const clipResult = { ...(match?.[1] || {}) };
    if (!publicationVisualGate(qaManifest, clip.path).allowed) continue;
    if (!shouldAttemptPublication(clipResult.shorts, Date.now(), {
      platform: 'shorts', artifactPath: clip.path, root: ROOT, qaManifestPath: entry.qaManifestPath
    })) continue;

    const videoPath = path.isAbsolute(clip.path) ? path.resolve(clip.path) : path.resolve(ROOT, clip.path);
    if (!withinMedia(videoPath)) {
      clipResult.shorts = 'ERRO: caminho do corte fora de data/videos';
      next.clips[resultKey] = clipResult;
      continue;
    }
    try {
      const realProjectRoot = await fs.promises.realpath(ROOT);
      const realMediaRoot = await fs.promises.realpath(mediaRoot);
      const expectedMediaRoot = path.resolve(realProjectRoot, path.relative(path.resolve(ROOT), mediaRoot));
      const expectedVideoPath = path.resolve(realMediaRoot, path.relative(mediaRoot, videoPath));
      if (realMediaRoot !== expectedMediaRoot || await fs.promises.realpath(videoPath) !== expectedVideoPath
        || !(await fs.promises.lstat(videoPath)).isFile()) {
        throw new Error('arquivo fora da raiz de mídia gerenciada');
      }
    } catch (error) {
      clipResult.shorts = `ERRO: ${String(error.message || error).slice(0, 120)}`;
      next.clips[resultKey] = clipResult;
      continue;
    }

    let duration = null;
    try { duration = await getMediaDuration(videoPath); }
    catch (_error) { /* falha fechada abaixo */ }
    if (!Number.isFinite(duration) || duration <= 0) {
      clipResult.shorts = 'ignorado: duração do corte não pôde ser verificada';
      next.clips[resultKey] = clipResult;
      continue;
    }
    if (duration > PLATFORM_VIDEO_LIMIT_SECONDS.shorts) {
      clipResult.shorts = `ignorado: corte de ${duration.toFixed(1)}s acima do limite de ${PLATFORM_VIDEO_LIMIT_SECONDS.shorts}s do Shorts`;
      next.clips[resultKey] = clipResult;
      continue;
    }
    const narrativeRejection = narrativePartDurationRejection('shorts', clip, duration, PLATFORM_VIDEO_LIMIT_SECONDS.shorts);
    if (narrativeRejection) {
      clipResult.shorts = `ignorado: ${narrativeRejection}`;
      next.clips[resultKey] = clipResult;
      continue;
    }

    const hashtags = resolveThemeHashtags(entry.seo?.hashtags, entry.theme);
    const canonicalTitle = entry.seo?.youtubeTitle || entry.title || 'Pulso IA';
    const clipTitle = buildShortsTitle({ title: clip.title || canonicalTitle,
      sourceTitle: entry.sourceEvidence?.sourceTitle || canonicalTitle, partIndex: clip.partIndex, partCount: clip.partCount });
    const description = socialClipCaption({ clip, title: clip.title || canonicalTitle, hashtags, sourceUrl: entry.url || '', platform: 'shorts' });
    try {
      uploadsAttempted++;
      clipResult.shorts = await checkpointedPublication({
        scope: 'clip', platform: 'shorts', videoPath, previous: clipResult.shorts,
        artifactSha256: qaAssetSha256(qaManifest, videoPath),
        qaManifestPath: entry.qaManifestPath, onPublicationState,
        upload: async () => {
          const uploaded = await withBudget(uploadWithStudio({
            platform: 'shorts',
            videoPath,
            title: clipTitle,
            description,
            expectedSha256: qaAssetSha256(qaManifest, videoPath),
            privacyStatus: process.env.YT_PRIVACY || 'public'
          }), 'youtube', PLATFORM_BUDGET_MS.youtube);
          console.log(`  [shorts retry ${index + 1}] ${uploaded.url || 'envio sem URL confirmada'}`);
          return uploaded;
        }
      });
    } catch (error) {
      clipResult.shorts = `ERRO: ${String(error.message || error).slice(0, 120)}`;
      console.warn(`  [shorts retry ${index + 1}] ${String(error.message || error).slice(0, 120)}`);
    }
    next.clips[resultKey] = clipResult;
    if (uploadsAttempted >= uploadLimit || ['quota_exceeded', 'youtube_upload_limit'].includes(clipResult.shorts?.failureCode)
      || /exceeded the number of videos/i.test(String(clipResult.shorts))) break;
  }
  return next;
}

async function retryPendingSocials(options) {
  const qaManifest = options?.qaManifest || await verifyEntryQaManifest(options?.entry);
  if (!['verified', 'legacy'].includes(qaManifest.status)) throw Object.assign(new Error(`QA por hash inválido: ${qaManifest.reason}`), { code: 'VIDEO_QA_MANIFEST_INVALID' });
  assertPublicationVisualGate(qaManifest);
  return retrySocialUploads({
    ...options,
    root: ROOT,
    expectedSha256ForArtifact: artifactPath => qaAssetSha256(qaManifest, artifactPath),
    canPublishArtifact: artifactPath => publicationVisualGate(qaManifest, artifactPath).allowed,
    disabledPlatforms: [...new Set([
      ...DISABLED_PLATFORMS,
      ...(Array.isArray(options?.skipPlatforms) ? options.skipPlatforms : [])
    ])],
    isHandlerAvailable: isSocialHandlerAvailable,
    isLogged: async platform => (await ensureSocialReady(platform)).ready,
    getMediaDuration,
    videoLimits: PLATFORM_VIDEO_LIMIT_SECONDS,
    uploaders: {
      tiktok: ({ videoPath, caption }) => uploadTikTok({ videoPath, caption }),
      kwai: ({ videoPath, caption }) => uploadKwai({ videoPath, caption }),
      instagram: ({ videoPath, caption }) => uploadInstagram({ videoPath, caption }),
      x: ({ videoPath, caption }) => uploadX({ videoPath, caption })
    },
    withBudget: (platform, promise) => withBudget(promise, platform, PLATFORM_BUDGET_MS[platform] || UPLOAD_TIMEOUT_MS)
  });
}

module.exports = { uploadToAll, retryPendingYouTubeShorts, retryPendingSocials, checkpointedPublication, uploadTikTok, uploadKwai, uploadInstagram, uploadX, uploadTelegram, isLogged, isSocialHandlerAvailable, allowUnknownAndroidSession, verifyKwaiPostInProfile, waitForKwaiPostInProfile, resumeKwaiComposerIfMatching, completeKwaiDraftFromEditor, waitForKwaiUi, waitForKwaiPostTapTransition, PLATFORM_BUDGET_MS, DEFAULT_KWAI_UPLOAD_TIMEOUT_MS, PLATFORM_VIDEO_LIMIT_SECONDS, YOUTUBE_LONGFORM_MIN_SECONDS, TELEGRAM_APP_MAX_FILE_BYTES };
