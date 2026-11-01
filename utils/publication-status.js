'use strict';

const path = require('node:path');
const { hasSufficientSourceEvidence, isPublicationReviewApproved } = require('./source-evidence');
const { isPlatformTargeted, isShortsTargeted } = require('./platform-video-policy');

function publicationSucceeded(value) {
  if (typeof value === 'string') return /^https?:\/\//i.test(value.trim());
  if (!value || typeof value !== 'object' || value.status !== 'confirmed') return false;
  const timestamp = Date.parse(value.confirmedAt || '');
  return typeof value.platform === 'string' && Boolean(value.platform.trim())
    && typeof value.artifact?.path === 'string' && Boolean(value.artifact.path.trim())
    && Number.isFinite(timestamp)
    && typeof value.evidence?.kind === 'string' && Boolean(value.evidence.kind.trim())
    && typeof value.evidence?.observed === 'string' && Boolean(value.evidence.observed.trim());
}

function isPublicationEligible(entry) {
  return Boolean(entry && entry.publicationEligible === true
    && (!entry.sourceChronologyReview || (entry.sourceChronologyReview.status === 'approved'
      && entry.sourceChronologyReview.sourceHash === entry.sourceEvidence?.contextHash))
    && hasSufficientSourceEvidence(entry.sourceEvidence)
    && isPublicationReviewApproved(entry.publicationReview, entry.sourceEvidence));
}

function isBackgroundRetryEligible(entry) {
  return isPublicationEligible(entry);
}

function youtubeUploadQuotaExceeded(results) {
  const destinations = [results?.long?.youtube,
    ...Object.values(results?.clips || {}).map(clip => clip?.shorts)];
  return destinations.some(result => typeof result === 'string'
    ? /exceeded the number of videos/i.test(result)
    : result?.status === 'skipped' && result?.failureCode === 'quota_exceeded'
      && result?.evidence?.kind === 'api_rejected');
}

function isLegacyYouTubeUploadLimit(value, platform) {
  if (!['youtube', 'shorts'].includes(String(platform || '').trim().toLowerCase()) || typeof value !== 'string') return false;
  return /^(?:erro:\s*)?the user has exceeded the number of videos they may upload\.?$/i
    .test(value.trim());
}

function nextPublicationRetryAt(attemptCount, now = Date.now()) {
  const attempt = Number.isSafeInteger(attemptCount) && attemptCount > 0 ? attemptCount : 1;
  const exponent = Math.min(attempt - 1, 12);
  const delayMs = Math.min(6 * 60 * 60 * 1000, 60 * 1000 * (2 ** exponent));
  return new Date(now + delayMs).toISOString();
}

function createPublicationResult({ platform, videoPath, artifactSha256 = null, status = 'unknown', account = null, url = null, externalId = null, evidence = null, failureCode = null, retryable = false, attemptCount = null, nextAttemptAt = null }) {
  const allowedStatuses = new Set(['attempting', 'submitted', 'processing', 'confirmed', 'unknown', 'failed', 'skipped']);
  if (!allowedStatuses.has(status)) throw new TypeError(`status de publicação inválido: ${status}`);
  if (typeof platform !== 'string' || !platform.trim()) throw new TypeError('plataforma obrigatória');
  if (typeof videoPath !== 'string' || !videoPath.trim()) throw new TypeError('caminho do artefato obrigatório');
  if (artifactSha256 != null && (typeof artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(artifactSha256))) {
    throw new TypeError('hash SHA-256 do artefato inválido');
  }
  if (status === 'confirmed' && (!evidence || typeof evidence.kind !== 'string' || !evidence.kind.trim()
    || typeof evidence.observed !== 'string' || !evidence.observed.trim())) {
    throw new TypeError('confirmação exige evidência observada');
  }
  if (retryable && status !== 'skipped') throw new TypeError('somente um destino pulado pode ser marcado como retryable');
  if (retryable && !['quota_exceeded', 'rate_limited'].includes(failureCode)) {
    throw new TypeError('retryable exige rejeição explícita de cota ou limite da API');
  }
  if (retryable && evidence?.kind !== 'api_rejected') {
    throw new TypeError('retryable exige evidência de rejeição da API');
  }
  const parsedNextAttemptAt = typeof nextAttemptAt === 'string' ? Date.parse(nextAttemptAt) : NaN;
  if (retryable && !Number.isFinite(parsedNextAttemptAt)) {
    throw new TypeError('retryable exige nextAttemptAt válido para respeitar o backoff');
  }
  const result = {
    schemaVersion: 1,
    platform: platform.trim().toLowerCase(),
    status,
    account: typeof account === 'string' && account.trim() ? account.trim() : null,
    artifact: {
      path: videoPath,
      ...(artifactSha256 ? { sha256: artifactSha256.toLowerCase() } : {})
    },
    submittedAt: new Date().toISOString()
  };
  if (status === 'confirmed') result.confirmedAt = new Date().toISOString();
  if (Number.isSafeInteger(attemptCount) && attemptCount > 0) result.attemptCount = attemptCount;
  if (Number.isFinite(parsedNextAttemptAt)) result.nextAttemptAt = new Date(parsedNextAttemptAt).toISOString();
  if (typeof url === 'string' && /^https?:\/\//i.test(url.trim())) result.url = url.trim();
  if (typeof externalId === 'string' && externalId.trim()) result.externalId = externalId.trim();
  if (typeof failureCode === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(failureCode)) result.failureCode = failureCode;
  if (status === 'skipped' && retryable) result.retryable = true;
  if (evidence && typeof evidence === 'object') {
    result.evidence = {
      kind: String(evidence.kind || ''),
      observed: String(evidence.observed || '').slice(0, 240),
      ...(typeof evidence.screenshotPath === 'string' && evidence.screenshotPath.trim()
        ? { screenshotPath: evidence.screenshotPath.trim() } : {})
    };
  }
  return result;
}

function sameProjectPath(root, left, right) {
  if (!left || !right) return false;
  const resolve = value => path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  return resolve(left) === resolve(right);
}

function publicationMatchesTarget(value, platform, artifactPath, root, expectedSha256 = null) {
  if (!publicationSucceeded(value)) return false;
  // Legacy URLs are stored under the destination and artifact keys in the ledger.
  // Structured proofs carry their own identity, so verify it before cleanup.
  if (typeof value === 'string') return !expectedSha256;
  if (value.platform.toLowerCase() !== platform.toLowerCase()
    || !sameProjectPath(root, value.artifact.path, artifactPath)) return false;
  return !expectedSha256 || value.artifact.sha256 === expectedSha256;
}

function disabledPlatforms(options) {
  return new Set(((options.disabledPlatforms ?? process.env.SOCIALS_DISABLED) || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
}

function normalizedClips(entry) {
  return (Array.isArray(entry?.clips) ? entry.clips : []).map(clip => typeof clip === 'string' ? { path: clip } : clip)
    .filter(clip => clip && typeof clip.path === 'string' && clip.path);
}

function shortsLimit(options, clipsLength) {
  const raw = options.maxShorts ?? (process.env.MAX_SHORTS || clipsLength);
  const parsed = Number(raw);
  const count = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 1;
  return Math.min(clipsLength, count);
}

function longUploadsSucceeded(entry, results, options = {}) {
  if (!entry || !results) return false;
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  const youtube = results.long?.youtube || entry.ytUrl;
  if (!publicationMatchesTarget(youtube, 'youtube', entry.videoPath, root, options.expectedSha256)) return false;
  const disabled = disabledPlatforms(options);
  if (process.env.TELEGRAM_CHANNEL && !disabled.has('telegram')
    && !publicationMatchesTarget(results.long?.telegram, 'telegram', entry.videoPath, root, options.expectedSha256)) return false;
  const xFullVideoEnabled = /^(1|true|yes)$/i.test(String(process.env.X_POST_FULL_VIDEO || ''));
  if (xFullVideoEnabled && !disabled.has('x')
    && !publicationMatchesTarget(results.long?.x, 'x', entry.videoPath, root, options.expectedSha256)) return false;
  return true;
}

function clipUploadsSucceeded(entry, results, index, options = {}) {
  if (!entry || !results) return false;
  const clips = normalizedClips(entry);
  const clip = clips[index];
  if (!clip) return false;
  if (!clip.kind || clip.kind === 'social-short-clip') return false;
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  const result = Object.entries(results.clips || {})
    .find(([resultPath]) => sameProjectPath(root, resultPath, clip.path))?.[1];
  if (!result || typeof result !== 'object') return false;

  const disabled = disabledPlatforms(options);
  for (const platform of ['tiktok', 'kwai', 'instagram', 'x']) {
    if (isPlatformTargeted(clip, platform) && !disabled.has(platform)
      && !publicationMatchesTarget(result[platform], platform, clip.path, root, options.expectedSha256)) return false;
  }
  const shortsClips = clips.filter(isShortsTargeted);
  const shortsIndex = shortsClips.findIndex(item => sameProjectPath(root, item.path, clip.path));
  if (shortsIndex >= 0 && shortsIndex < shortsLimit(options, shortsClips.length)
    && !publicationMatchesTarget(result.shorts, 'shorts', clip.path, root, options.expectedSha256)) return false;
  return true;
}

// Keep a local artifact until every configured target has a hash-bound publish
// confirmation. A terminal error is not a publication; it must not free the
// only source copy when the owner asked to post all targeted destinations.
function clipCanBeDeletedAfterPublication(entry, results, index, options = {}) {
  const clips = normalizedClips(entry);
  const clip = clips[index];
  if (!clip) return false;
  const disabled = disabledPlatforms(options);
  const targets = ['tiktok', 'kwai', 'instagram', 'x']
    .filter(platform => !disabled.has(platform) && isPlatformTargeted(clip, platform));
  const shorts = clips.filter(isShortsTargeted);
  const shortsIndex = shorts.findIndex(item => sameProjectPath(
    path.resolve(options.root || path.join(__dirname, '..')), item.path, clip.path
  ));
  if (shortsIndex >= 0 && shortsIndex < shortsLimit(options, shorts.length)
    && !disabled.has('shorts')) targets.push('shorts');
  if (!targets.length) return false;

  const artifactResults = Object.entries(results?.clips || {})
    .find(([candidate]) => sameProjectPath(
      path.resolve(options.root || path.join(__dirname, '..')), candidate, clip.path
    ))?.[1] || {};
  for (const platform of targets) {
    const value = artifactResults[platform];
    if (!publicationMatchesTarget(value, platform, clip.path, options.root || path.join(__dirname, '..'), options.expectedSha256)) return false;
  }
  return targets.length > 0;
}

function allArtifactOwnersConfirmed(entries, artifactPath, options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  let owners = 0;
  for (const entry of entries || []) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.videoPath && sameProjectPath(root, entry.videoPath, artifactPath)) {
      owners++;
      if (options.requirePublicationEligible === true && entry.publicationEligible !== true) return false;
      if (!longUploadsSucceeded(entry, entry.results, { ...options, root })) return false;
    }
    for (const [index, clip] of normalizedClips(entry).entries()) {
      if (!sameProjectPath(root, clip.path, artifactPath)) continue;
      owners++;
      if (options.requirePublicationEligible === true && entry.publicationEligible !== true) return false;
      if (!clipCanBeDeletedAfterPublication(entry, entry.results, index, { ...options, root })) return false;
    }
  }
  return owners > 0;
}

function artifactOwnerPublicationProofs(entries, artifactPath, options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  const disabled = disabledPlatforms(options);
  const maxShorts = shortsLimit(options, Number.MAX_SAFE_INTEGER);
  const proofs = [];
  for (const entry of entries || []) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.videoPath && sameProjectPath(root, entry.videoPath, artifactPath)) {
      const targets = ['youtube'];
      if (process.env.TELEGRAM_CHANNEL && !disabled.has('telegram')) targets.push('telegram');
      if (/^(1|true|yes)$/i.test(String(process.env.X_POST_FULL_VIDEO || '')) && !disabled.has('x')) targets.push('x');
      const observedPlatforms = [...new Set([...targets, ...Object.keys(entry.results?.long || {})])];
      proofs.push({ jobId: entry.jobId || null, role: 'master',
        publicationEligible: typeof entry.publicationEligible === 'boolean' ? entry.publicationEligible : null,
        publicationReviewStatus: entry.publicationReview?.status || null,
        reviewedAssetSha256: typeof entry.publicationReview?.assetSha256 === 'string'
          ? entry.publicationReview.assetSha256 : null,
        reviewEvidencePath: typeof entry.publicationReview?.reviewEvidencePath === 'string'
          ? entry.publicationReview.reviewEvidencePath : entry.factualReviewEvidencePath || null,
        destinations: targetProofs(entry.results?.long, observedPlatforms) });
    }
    const clips = normalizedClips(entry);
    const result = Object.entries(entry.results?.clips || {}).find(([candidate]) =>
      sameProjectPath(root, candidate, artifactPath))?.[1] || {};
    for (const clip of clips) {
      if (!sameProjectPath(root, clip.path, artifactPath)) continue;
      const targets = ['instagram', 'tiktok', 'kwai', 'x']
        .filter(platform => !disabled.has(platform) && isPlatformTargeted(clip, platform));
      const selectedShorts = clips.filter(isShortsTargeted)
        .slice(0, maxShorts);
      if (!disabled.has('shorts') && selectedShorts.some(item => sameProjectPath(root, item.path, clip.path))) targets.push('shorts');
      const observedPlatforms = [...new Set([...targets, ...Object.keys(result)])];
      proofs.push({ jobId: entry.jobId || null, role: clip.kind || 'clip',
        publicationEligible: typeof entry.publicationEligible === 'boolean' ? entry.publicationEligible : null,
        publicationReviewStatus: entry.publicationReview?.status || null,
        reviewedAssetSha256: entry.publicationReview?.clipAssetSha256?.[path.resolve(root, clip.path)] || null,
        reviewEvidencePath: typeof entry.publicationReview?.reviewEvidencePath === 'string'
          ? entry.publicationReview.reviewEvidencePath : entry.factualReviewEvidencePath || null,
        destinations: targetProofs(result, observedPlatforms) });
    }
  }
  return proofs;
}

function targetProofs(results = {}, targets) {
  return targets.map(platform => {
    const value = results[platform];
    if (typeof value === 'string') {
      const legacyStatus = value.trim().toLocaleLowerCase('pt-BR');
      const legacyNoSend = legacyStatus === 'pulado (cota)'
        ? 'quota_skipped_legacy'
        : isLegacyYouTubeUploadLimit(value, platform)
          ? 'quota_skipped_legacy'
        : legacyStatus === 'not_attempted'
          ? 'not_attempted'
        : legacyStatus === 'não logado'
          ? 'not_logged_legacy'
        : [
          'desativado',
          'desativado (telegram_channel ausente)',
          'desativado (x_post_full_video=1 para habilitar)',
          'não alvo',
          'nao alvo'
        ].includes(legacyStatus) ? 'disabled_or_not_targeted_legacy' : null;
      return { platform, status: publicationSucceeded(value) ? 'confirmed' : legacyNoSend || 'unconfirmed',
        url: publicationSucceeded(value) ? value : null, artifactSha256: null, account: null, legacyProof: true };
    }
    return {
      platform,
      status: publicationSucceeded(value) ? 'confirmed' : value?.status || 'legacy_or_unstructured',
      ...(typeof value?.url === 'string' ? { url: value.url } : {}),
      ...(typeof value?.externalId === 'string' ? { externalId: value.externalId } : {}),
      ...(typeof value?.confirmedAt === 'string' ? { confirmedAt: value.confirmedAt } : {}),
      ...(typeof value?.account === 'string' ? { account: value.account } : {}),
      ...(typeof value?.artifact?.sha256 === 'string' ? { artifactSha256: value.artifact.sha256 } : {}),
      ...(typeof value?.evidence?.kind === 'string' ? { evidenceKind: value.evidence.kind } : {})
    };
  });
}

function allRequiredUploadsSucceeded(entry, results, options = {}) {
  if (!longUploadsSucceeded(entry, results, options)) return false;
  return normalizedClips(entry).every((_clip, index) => clipUploadsSucceeded(entry, results, index, options));
}

module.exports = {
  youtubeUploadQuotaExceeded,
  isLegacyYouTubeUploadLimit,
  allRequiredUploadsSucceeded,
  clipUploadsSucceeded,
  clipCanBeDeletedAfterPublication,
  allArtifactOwnersConfirmed,
  artifactOwnerPublicationProofs,
  isBackgroundRetryEligible,
  longUploadsSucceeded,
  nextPublicationRetryAt,
  normalizedClips,
  publicationSucceeded,
  publicationMatchesTarget,
  createPublicationResult,
  isPublicationEligible
};
