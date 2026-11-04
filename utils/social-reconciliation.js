'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { withProcessFileLock } = require('./process-file-lock');
const { withAndroidDeviceLock } = require('./android-device-lock');
const { socialAndroidTarget } = require('./android-social-target');
const { recordPublicationResult } = require('./social-publication-state');
const { socialClipCaption } = require('./platform-video-policy');
const { resolveThemeHashtags } = require('./theme-metadata');
const { instagramCaptionForInput } = require('./instagram-upload-flow');
const { sha256StableRegularFile } = require('./video-qa-manifest');
const { scanTikTokPublicPosts } = require('./tiktok-reconciliation');
const { scanInstagramPosts } = require('./instagram-reconciliation');
const { normalizeAccountHandle } = require('./android-session-state');
const { scanXPublicPosts, xCaptionForInput } = require('./x-android-publisher');

function reconciliationCandidates(entries, platform, accountHandle, root) {
  const expected = normalizeAccountHandle(accountHandle);
  if (!expected) return [];
  const candidates = [];
  for (const entry of entries || []) for (const clip of [
    ...(entry.clips || []), ...(platform === 'x' && entry.videoPath ? [{ path: entry.videoPath, reconciliationScope: 'long' }] : [])
  ]) {
    const scope = clip.reconciliationScope || 'clip';
    const previous = scope === 'long' ? entry.results?.long?.[platform] : Object.entries(entry.results?.clips || {})
      .find(([file]) => path.resolve(root, file) === path.resolve(root, clip.path))?.[1]?.[platform];
    if (!['unknown', 'submitted', 'processing'].includes(previous?.status)
      || previous.platform !== platform || !/^[a-f0-9]{64}$/i.test(previous.artifact?.sha256 || '')
      || !Number.isFinite(Date.parse(previous.submittedAt))
      || path.resolve(root, previous.artifact.path) !== path.resolve(root, clip.path)
      || previous.account && normalizeAccountHandle(previous.account) !== expected) continue;
    const caption = scope === 'long' ? `${entry.seo?.youtubeTitle || entry.title}\n\n${entry.url ? `Fonte: ${entry.url}` : ''}`
      : socialClipCaption({ clip, title: clip.title || entry.seo?.youtubeTitle || entry.title,
        hashtags: resolveThemeHashtags(entry.seo?.hashtags, entry.theme), sourceUrl: entry.url || '', platform });
    candidates.push({ id: `${entry.jobId}:${clip.path}`, entry, clip, previous, scope,
      caption: platform === 'x' ? xCaptionForInput(caption) : instagramCaptionForInput(caption) });
  }
  return candidates;
}

function reconciliationPage(state, candidates) {
  // A new submission deserves a head scan rather than waiting for the full
  // backlog rotation. In quiet periods keep advancing through older pages.
  const newlySubmitted = candidates.some(c => Date.parse(c.previous.submittedAt) > Date.parse(state.checkedAt || ''));
  return newlySubmitted ? 0 : Number.isInteger(state.nextPage) ? state.nextPage : 0;
}

// Read-only platform reconciliation. It never calls upload/Post and never
// converts absence into permission to resend. State and evidence survive restarts.
async function reconcileSocialPublications({ root = path.resolve(__dirname, '..'), platform = 'tiktok',
  force = false, maxPosts = 6, env = process.env, lockTimeoutMs = 10000 } = {}) {
  const scan = { tiktok: scanTikTokPublicPosts, instagram: scanInstagramPosts, x: scanXPublicPosts }[platform];
  if (!scan) throw new Error('reconciliador não implementado para esse destino');
  const stateDir = path.resolve(root, env.STATE_DIR || 'data/state');
  const ledgerPath = path.join(stateDir, 'topics.json');
  const statePath = path.join(stateDir, `reconciliation-${platform}.json`);
  return withProcessFileLock(async () => {
    let state = {};
    try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!force && Date.parse(state.nextCheckAt || '') > Date.now()) return { status: 'waiting', nextCheckAt: state.nextCheckAt };
    const entries = JSON.parse(await fs.readFile(ledgerPath, 'utf8')).entries;
    const accountHandle = env[`ANDROID_SOCIAL_HANDLE_${platform.toUpperCase()}`];
    const candidates = reconciliationCandidates(entries, platform, accountHandle, root);
    const eligible = [];
    for (const candidate of candidates) {
      try {
        const current = await sha256StableRegularFile(path.resolve(root, candidate.clip.path));
        if (current.sha256 === candidate.previous.artifact.sha256) eligible.push(candidate);
      } catch { /* Changed/missing media is never attributed to a public post. */ }
    }
    const report = { checkedAt: new Date().toISOString(), nextCheckAt: new Date(Date.now() + 15 * 60000).toISOString(),
      platform, page: reconciliationPage(state, eligible),
      candidates: eligible.length, confirmed: [], status: 'no_candidates' };
    try {
      if (eligible.length) {
        const target = socialAndroidTarget(platform, { env });
        await target.emulator.acquire();
        try {
          await withAndroidDeviceLock(async () => {
            const directory = path.join(root, 'data/reports/social-reconciliation', platform);
            await fs.mkdir(directory, { recursive: true });
            const capture = async label => {
              const file = path.join(directory, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${label}.png`);
              await fs.writeFile(file, target.control.screenshot());
              return path.relative(root, file);
            };
            try { await scan({ target, control: target.control, accountHandle, candidates: eligible, maxPosts, capture, pageOffset: report.page,
              onConfirmed: async proof => {
                const candidate = eligible.find(item => item.id === proof.id);
                const result = { ...candidate.previous, status: 'confirmed', account: proof.account,
                  ...(proof.url ? { url: proof.url, externalId: proof.externalId } : {}),
                  confirmedAt: new Date().toISOString(), reconciledAt: new Date().toISOString(),
                  evidence: { kind: 'public_profile_post', observed: platform === 'tiktok'
                    ? 'Perfil próprio conferido; legenda completa idêntica e privacidade Everyone selecionada.'
                    : platform === 'x' ? 'Conta própria, vídeo, horário posterior ao envio e legenda completa idêntica no X.'
                      : 'Conta própria conferida; publicação presente em Posts com insights e legenda completa idêntica.',
                    captionSha256: crypto.createHash('sha256').update(proof.caption).digest('hex'),
                    screenshotPath: proof.captionScreenshot, privacyScreenshotPath: proof.privacyScreenshot } };
                delete result.failureCode; delete result.nextAttemptAt;
                await recordPublicationResult(ledgerPath, candidate.entry.videoPath,
                  { scope: candidate.scope, platform, artifactPath: candidate.clip.path, result }, { root });
                report.confirmed.push({ jobId: candidate.entry.jobId, artifactPath: candidate.clip.path });
              } }); } catch (error) {
              report.screenshotPath = await capture('deferred').catch(() => null);
              // Preserve the observed accessibility tree for diagnosing an app
              // update or transient screen without inferring an account change.
              report.uiPath = path.relative(root, path.join(directory, `${Date.now()}-deferred-ui.json`));
              await fs.writeFile(path.join(root, report.uiPath), JSON.stringify(await target.control.dumpUi()), { mode: 0o600 })
                .catch(() => { report.uiPath = null; });
              throw error;
            }
          }, { lockPath: target.lockPath, owner: `reconcile:${platform}`, timeoutMs: lockTimeoutMs });
          report.status = 'checked';
          report.nextPage = (report.page + 1) % 8;
        } finally { target.emulator.release(); }
      }
    } catch (error) {
      report.status = 'deferred';
      report.nextPage = report.page;
      report.reason = String(error.message).slice(0, 220);
    }
    const temporary = `${statePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(report, null, 2), { mode: 0o600 });
    await fs.rename(temporary, statePath);
    return report;
  }, { lockPath: `${statePath}.lock`, owner: `reconciliation:${platform}`, timeoutMs: 1000 });
}

module.exports = { reconciliationCandidates, reconciliationPage, reconcileSocialPublications };
