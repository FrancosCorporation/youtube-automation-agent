'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { withProcessFileLock } = require('./process-file-lock');

const UPLOAD_WAIT_MS = 24 * 60 * 60 * 1000;
const PT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });

function nextPacificMidnight(now) {
  const today = PT_DAY.format(new Date(now));
  let low = now;
  let high = now + 36 * 60 * 60 * 1000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (PT_DAY.format(new Date(middle)) === today) low = middle;
    else high = middle;
  }
  return high;
}

function youtubeQuotaReason(result) {
  const text = [result?.apiReason, result?.evidence?.observed, typeof result === 'string' ? result : ''].filter(Boolean).join(' ');
  if (/uploadLimitExceeded|exceeded the number of videos/i.test(text)) return 'uploadLimitExceeded';
  if (/quotaExceeded|dailyLimitExceeded/i.test(text)) return 'quotaExceeded';
  if (result?.failureCode === 'youtube_upload_limit') return 'uploadLimitExceeded';
  return result?.failureCode === 'quota_exceeded' ? 'uploadLimitExceeded' : null;
}

function youtubeQuotaRetryAt({ reason, now = Date.now(), retryAfter } = {}) {
  const provided = /^\d+(?:\.\d+)?$/.test(String(retryAfter || ''))
    ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter || '');
  if (Number.isFinite(provided) && provided > now) return new Date(provided).toISOString();
  return new Date(reason === 'quotaExceeded' ? nextPacificMidnight(now) : now + UPLOAD_WAIT_MS).toISOString();
}

function normalizeQuotaState(raw = {}) {
  if (raw.schemaVersion === 2 && raw.blocks && typeof raw.blocks === 'object') return raw;
  const state = { schemaVersion: 2, blocks: {} };
  if (Number.isFinite(Date.parse(raw.at || ''))) {
    const reason = youtubeQuotaReason(raw) || 'uploadLimitExceeded';
    const scope = reason === 'quotaExceeded' ? 'youtube_api' : raw.destination || 'youtube';
    state.blocks[scope] = { reason, at: raw.at,
      retryAt: youtubeQuotaRetryAt({ reason, now: Date.parse(raw.at) }),
      retryTimeSource: 'documented_wait_estimate' };
  }
  return state;
}

function quotaBlocked(state, platform, now = Date.now()) {
  const blocks = normalizeQuotaState(state).blocks;
  const isYouTubeSurface = platform === 'youtube' || platform === 'shorts';
  const channelUploadBlocks = isYouTubeSurface
    ? [blocks.youtube, blocks.shorts].filter(block => block?.reason === 'uploadLimitExceeded')
    : [];
  return [
    ...(isYouTubeSurface ? [blocks.youtube_api] : []),
    blocks[platform],
    ...channelUploadBlocks
  ].some(block => Date.parse(block?.retryAt || '') > now);
}

function createYouTubeQuotaStore(filePath) {
  async function read() {
    try { return normalizeQuotaState(JSON.parse(await fs.readFile(filePath, 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return normalizeQuotaState(); throw error; }
  }
  async function recordResults(results) {
    const rejected = [['youtube', results?.long?.youtube],
      ...Object.values(results?.clips || {}).map(clip => ['shorts', clip?.shorts])]
      .filter(([, result]) => (typeof result === 'string' || (result?.status === 'skipped'
      && result?.evidence?.kind === 'api_rejected')
      || (result?.status === 'failed' && result?.failureCode === 'youtube_upload_limit'
        && result?.evidence?.kind === 'confirmed_no_send')) && youtubeQuotaReason(result));
    if (!rejected.length) return false;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    return withProcessFileLock(async () => {
      const state = await read();
      for (const [platform, result] of rejected) {
        const reason = youtubeQuotaReason(result);
        const at = Number.isFinite(Date.parse(result?.submittedAt || '')) ? result.submittedAt : new Date().toISOString();
        const scope = reason === 'quotaExceeded' ? 'youtube_api' : platform;
        const estimated = youtubeQuotaRetryAt({ reason, now: Date.parse(at) });
        const supplied = Date.parse(result?.nextAttemptAt || '');
        const retryAt = (result?.retryTimeSource === 'retry_after_header' || result?.failureCode === 'youtube_upload_limit') && supplied > Date.parse(at)
          ? result.nextAttemptAt : new Date(Math.max(Date.parse(estimated), supplied || 0)).toISOString();
        const block = { reason, platform, at, retryAt,
        retryTimeSource: result?.retryTimeSource || 'documented_wait_estimate' };
        if (Date.parse(state.blocks[scope]?.at || '') > Date.parse(at)) continue;
        state.blocks[scope] = block;
      }
      state.updatedAt = new Date().toISOString();
      const temp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      try {
        await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        await fs.rename(temp, filePath);
      } finally { await fs.unlink(temp).catch(() => {}); }
      return true;
    }, { lockPath: `${filePath}.lock`, owner: 'youtube-quota-state' });
  }
  return { read, recordResults, async blocked(platform = 'youtube') { return quotaBlocked(await read(), platform); } };
}

module.exports = { createYouTubeQuotaStore, normalizeQuotaState, quotaBlocked, youtubeQuotaReason, youtubeQuotaRetryAt };
