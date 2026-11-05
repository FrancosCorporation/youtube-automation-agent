'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { socialAndroidTarget } = require('./android-social-target');
const { withAndroidDeviceLock } = require('./android-device-lock');
const { connectStudioBrowser, adb } = require('./youtube-studio-publisher');
const { normalizeAccountHandle, recordAndroidSession } = require('./android-session-state');
const { createPublicationResult } = require('./publication-status');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalizedText = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();

// Conservative Unicode count (complex emoji can be overcounted), with X's
// documented 23-character URLs: https://docs.x.com/fundamentals/counting-characters
function xTextWeight(text) {
  return [...String(text).normalize('NFC').replace(/https?:\/\/\S+/g, 'x'.repeat(23))]
    .reduce((n, c) => n + (c.codePointAt(0) <= 0x10ff ? 1 : 2), 0);
}
function xCaptionForInput(value) {
  const original = String(value || '').normalize('NFC').trim();
  if (xTextWeight(original) <= 280) return original;
  const source = original.match(/Fonte:\s*https?:\/\/\S+/)?.[0] || '';
  const part = original.match(/^Parte \d+\/\d+/)?.[0] || '';
  const headline = original.replace(source, '').replace(/^Parte \d+\/\d+/, '')
    .replace(/#[\p{L}\p{N}_]+/gu, '').trim();
  let chars = [...headline];
  const build = () => [part, `${chars.join('').trimEnd()}…`, source].filter(Boolean).join('\n\n');
  while (chars.length && xTextWeight(build()) > 280) chars.pop();
  return build();
}
function ownXMenuIdentity({ text, profileHref }, expectedHandle) {
  const expected = normalizeAccountHandle(expectedHandle);
  if (!expected) return { status: 'identity_unconfirmed', accountHandle: null };
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim());
  const handles = lines.filter(s => /^@[A-Za-z\d_]{1,15}$/.test(s));
  if (handles.length !== 1 || !lines.some(s => /^(Log out|Sair)$/i.test(s))) {
    return { status: 'identity_unavailable', accountHandle: null };
  }
  const observed = normalizeAccountHandle(handles[0]);
  if (String(profileHref || '').toLowerCase() !== `/${observed.slice(1)}`) {
    return { status: 'identity_unavailable', accountHandle: null };
  }
  return { status: observed === expected ? 'logged_in' : 'identity_mismatch', accountHandle: observed };
}
async function inspectXPageIdentity(page, accountHandle, timeoutMs = 30000) {
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.getByTestId('DashButton_ProfileIcon_Link').click({ timeout: timeoutMs });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('link', { name: /^(Profile|Perfil)$/ }).waitFor({ state: 'visible', timeout: timeoutMs });
  const result = ownXMenuIdentity({ text: await dialog.innerText(),
    profileHref: await dialog.getByRole('link', { name: /^(Profile|Perfil)$/ }).getAttribute('href') }, accountHandle);
  await page.keyboard.press('Escape');
  return result;
}
async function withXAndroidPage(action, { env = process.env, sessionRoot,
  target = socialAndroidTarget('x', { env, stateRoot: sessionRoot }),
  cdpUrl = require('../config/youtube-studio.json').cdpUrl, withLock = withAndroidDeviceLock,
  connectBrowser = connectStudioBrowser, connect, runAdb = adb, lockTimeoutMs = 10000 } = {}) {
  const endpoint = new URL(cdpUrl);
  if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname) || endpoint.protocol !== 'http:') {
    throw new Error('X exige CDP local encaminhado ao Chrome Android');
  }
  await target.emulator.acquire();
  try {
    return await withLock(async () => {
      const browser = await connectBrowser({ cdpUrl, device: target.device, runAdb,
        connect: connect || ((url, options) => require('playwright').chromium.connectOverCDP(url, options)) });
      let page;
      try {
        const context = browser.contexts()[0];
        if (!context) throw new Error('Chrome Android não expôs contexto autenticado');
        page = await context.newPage();
        page.setDefaultTimeout(30000);
        return await action(page, target);
      } finally {
        if (page) await page.close().catch(() => {});
        await browser.close().catch(() => {});
      }
    }, { lockPath: target.lockPath, owner: 'x-android-web', timeoutMs: lockTimeoutMs });
  } finally { target.emulator.release(); }
}
async function inspectXAndroidSession(options = {}) {
  const accountHandle = options.accountHandle ?? options.env?.ANDROID_SOCIAL_HANDLE_X ?? process.env.ANDROID_SOCIAL_HANDLE_X;
  if (!normalizeAccountHandle(accountHandle)) return { platform: 'x', status: 'identity_unconfirmed' };
  return withXAndroidPage(async (page, target) => {
    const session = await inspectXPageIdentity(page, accountHandle);
    if (session.status === 'logged_in') recordAndroidSession('x', { root: options.sessionRoot,
      device: target.device, accountHandle: session.accountHandle, identityVerified: true });
    return { ...session, platform: 'x', device: target.device };
  }, options);
}
function matchingXPost(posts, { caption, accountHandle, submittedAt, now = Date.now() }) {
  const expected = normalizeAccountHandle(accountHandle), since = Date.parse(submittedAt);
  if (!expected || !Number.isFinite(since)) return null;
  const matches = posts.filter(post => {
    const match = String(post.url || '').match(/^https:\/\/x\.com\/([A-Za-z\d_]+)\/status\/(\d+)(?:\?.*)?$/);
    const at = Date.parse(post.publishedAt);
    return match && /^@?[A-Za-z\d_]{1,15}$/.test(String(post.author || '')) && normalizeAccountHandle(match[1]) === expected
      && normalizeAccountHandle(post.author) === expected && post.hasVideo === true
      && normalizedText(post.caption) === normalizedText(caption)
      && Number.isFinite(at) && at >= since - 1000 && at <= now + 1000;
  });
  const unique = [...new Map(matches.map(post => [post.url, post])).values()];
  return unique.length === 1 ? unique[0] : null;
}
async function readXPosts(page) {
  return page.locator('article[data-testid="tweet"]').evaluateAll(articles => articles.map(article => {
    const text = article.querySelector('[data-testid="tweetText"]');
    const clone = text?.cloneNode(true);
    if (clone) for (const link of clone.querySelectorAll('a')) {
      const full = link.getAttribute('data-expanded-url') || link.getAttribute('title');
      if (full && /^https?:\/\//.test(full)) link.replaceWith(full);
    }
    const time = article.querySelector('time');
    const userLinks = [...article.querySelectorAll('[data-testid="User-Name"] a[href]')];
    const author = userLinks.map(a => a.getAttribute('href')).find(href => /^\/[A-Za-z\d_]{1,15}$/.test(href || ''));
    return { caption: clone?.textContent || '', author: author?.slice(1) || '',
      url: time?.closest('a')?.href || '', publishedAt: time?.getAttribute('datetime') || '',
      hasVideo: Boolean(article.querySelector('video,[data-testid="videoPlayer"]')) };
  }));
}
async function findXPost(page, criteria, { wait = sleep, attempts = 3 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await page.goto(`https://x.com/${normalizeAccountHandle(criteria.accountHandle).slice(1)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('[data-testid="UserName"]').waitFor({ state: 'visible', timeout: 30000 });
    await wait(1500);
    const post = matchingXPost(await readXPosts(page), criteria);
    if (post) return post;
    if (i + 1 < attempts) await wait(3000);
  }
  return null;
}
// X also marks its character counter and idle submission bar as progressbars.
// Only visible, active work blocks readiness; caption text is user content, not
// upload status (a video about "uploading" must still be publishable).
async function readXComposerState(page) {
  return page.evaluate(() => {
    const content = document.body.cloneNode(true);
    for (const node of content.querySelectorAll('[data-testid="tweetTextarea_0"],script,style,noscript,[hidden],[aria-hidden="true"]')) node.remove();
    const pending = [...document.querySelectorAll('[role="progressbar"]')].some(node => {
      if (node.closest('[data-testid="countdown-circle"]') || !node.getClientRects().length
        || window.getComputedStyle(node).visibility === 'hidden') return false;
      const value = node.getAttribute('aria-valuenow'), maximum = node.getAttribute('aria-valuemax');
      // The full-width bar above the composer exists at 0 even while idle.
      // Progress inside attachments is still active at 0.
      if (node.querySelector('[data-testid="progressBar-bar"]') && value === '0'
        && !node.closest('[data-testid="attachments"]')) return false;
      return value === null || maximum === null || Number(value) < Number(maximum);
    });
    return {
      video: Boolean(document.querySelector('video,[data-testid="videoPlayer"]')),
      pending, text: content.textContent || '',
      button: Boolean(document.querySelector('[data-testid="tweetButton"]:not([disabled]):not([aria-disabled="true"])'))
    };
  });
}
async function publishXOnPage({ page, videoPath, caption, accountHandle, timeoutMs = 150000,
  inspect = inspectXPageIdentity, findPost = findXPost, now = Date.now, wait = sleep }) {
  const source = path.resolve(videoPath), expected = normalizeAccountHandle(accountHandle);
  let clickAttempted = false, artifactSha256, submittedAt, stage = 'input';
  const result = (status, failureCode, observed, extra = {}) => createPublicationResult({ platform: 'x', videoPath: source,
    artifactSha256, account: expected, status, failureCode,
    evidence: { kind: clickAttempted ? 'submission_unverified' : 'confirmed_no_send', observed }, ...extra });
  try {
    if (!expected || !/^@[A-Za-z\d_]{1,15}$/.test(expected)) return result('failed', 'social_account_identity_unverified', 'Handle X aprovado ausente ou inválido; envio não iniciado');
    if (!/\.mp4$/i.test(source) || !(await fs.lstat(source)).isFile()) throw new Error('MP4 local ausente');
    const bytes = await fs.readFile(source);
    artifactSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const text = xCaptionForInput(caption);
    if (!text || xTextWeight(text) > 280) throw new Error('Legenda X inválida');
    stage = 'identity';
    const session = await inspect(page, expected);
    if (session.status !== 'logged_in' || normalizeAccountHandle(session.accountHandle) !== expected) {
      return result('failed', 'social_account_identity_unverified', 'Menu próprio do X não corresponde à conta autorizada; envio não iniciado');
    }
    stage = 'composer';
    await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const editor = page.getByTestId('tweetTextarea_0');
    await editor.waitFor({ state: 'visible', timeout: 30000 });
    const editorText = () => editor.evaluate(node => {
      if (['INPUT', 'TEXTAREA'].includes(node.tagName)) return node.value;
      if (node.isContentEditable) return node.innerText;
      throw new Error('Editor X não é um campo de texto reconhecido');
    });
    if ((await editorText()).trim() || await page.locator('[data-testid="attachments"]').count()) {
      stage = 'existing_draft';
      throw new Error('Editor contém rascunho; preservar conteúdo existente');
    }
    await editor.fill(text);
    stage = 'media_upload';
    await page.getByTestId('fileInput').setInputFiles({ name: path.basename(source), mimeType: 'video/mp4', buffer: bytes }, { timeout: 60000 });
    stage = 'media_readiness';
    const deadline = now() + timeoutMs;
    let ready = false;
    while (now() < deadline) {
      const ui = await readXComposerState(page);
      if (/upload failed|could not be uploaded|falha no upload|não foi possível carregar/i.test(ui.text)) throw new Error('X recusou o vídeo antes de publicar');
      ready = ui.video && !ui.pending && ui.button && !/uploading|processing video|carregando|processando vídeo/i.test(ui.text);
      if (ready) break;
      await wait(1000);
    }
    if (!ready || normalizedText(await editorText()) !== normalizedText(text)) throw new Error('Vídeo ou legenda não prontos para publicar');
    // A timeout from click does not prove the server failed to accept the post.
    submittedAt = new Date(now()).toISOString();
    clickAttempted = true;
    await page.getByTestId('tweetButton').click({ timeout: 10000 });
    // Do not navigate away while the client is still sending. This transition
    // permits inspection; it is not evidence that the post is public.
    await page.waitForFunction(() => window.location.pathname !== '/compose/post'
      || /post was sent|post foi enviado|publica[çc][ãa]o.*enviada/i.test(document.querySelector('[data-testid="toast"]')?.textContent || ''),
    null, { timeout: 30000 });
    const post = await findPost(page, { caption: text, accountHandle: expected, submittedAt }, { wait });
    if (post) return result('confirmed', null, 'Publicação própria com legenda completa, vídeo, horário e URL conferidos', {
      url: post.url, externalId: post.url.match(/\/status\/(\d+)/)[1],
      evidence: { kind: 'public_profile_post', observed: 'Autor, legenda, vídeo e horário posterior ao envio conferidos no perfil X' }
    });
    return { ...result('submitted', null, 'Post clicado uma vez; aguarda reconciliação no perfil X'), submittedAt };
  } catch (_error) {
    return { ...result(clickAttempted ? 'unknown' : 'failed', clickAttempted ? null : `x_${stage}_failed`,
      clickAttempted ? 'Resultado do clique no X incerto; reconciliar antes de reenviar' : `X falhou na etapa ${stage} antes do clique de publicação`),
    ...(submittedAt ? { submittedAt } : {}) };
  }
}
async function publishXAndroid(payload, options = {}) {
  let entered = false;
  try {
    return await withXAndroidPage(page => {
      entered = true;
      return publishXOnPage({ ...payload, page, accountHandle: payload.accountHandle ?? process.env.ANDROID_SOCIAL_HANDLE_X });
    }, options);
  } catch (_error) {
    return createPublicationResult({ platform: 'x', videoPath: String(payload.videoPath), status: entered ? 'unknown' : 'failed',
      failureCode: entered ? null : 'pre_submit_ui_error', evidence: {
        kind: entered ? 'submission_unverified' : 'confirmed_no_send',
        observed: entered ? 'Sessão encerrada com resultado incerto; reconciliar' : 'Chrome Android indisponível antes do preparo do envio'
      } });
  }
}
// The periodic reconciler owns the Android lock. This path only reads profiles;
// absence is never converted to a failed/no-send state or an upload retry.
async function scanXPublicPosts({ target, accountHandle, candidates, maxPosts = 6,
  pageOffset = 0, capture = async () => null, onConfirmed = async () => {} }) {
  return withXAndroidPage(async page => {
    const session = await inspectXPageIdentity(page, accountHandle);
    if (session.status !== 'logged_in') throw new Error(`X: sessão ${session.status}`);
    await page.goto(`https://x.com/${session.accountHandle.slice(1)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('[data-testid="UserName"]').waitFor({ state: 'visible', timeout: 30000 });
    const posts = new Map();
    for (let step = 0; step < maxPosts + pageOffset; step++) {
      await sleep(1200);
      for (const post of await readXPosts(page)) posts.set(post.url, post);
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * .8));
    }
    for (const candidate of candidates) {
      const post = matchingXPost([...posts.values()], { caption: xCaptionForInput(candidate.caption),
        accountHandle, submittedAt: candidate.previous.submittedAt });
      if (!post) continue;
      const competing = candidates.filter(item => matchingXPost([post], { caption: xCaptionForInput(item.caption),
        accountHandle, submittedAt: item.previous.submittedAt }));
      if (competing.length !== 1) continue;
      await page.goto(post.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(1500);
      if (!matchingXPost(await readXPosts(page), { caption: xCaptionForInput(candidate.caption),
        accountHandle, submittedAt: candidate.previous.submittedAt })) continue;
      await onConfirmed({ id: candidate.id, account: session.accountHandle, caption: xCaptionForInput(candidate.caption),
        url: post.url, externalId: post.url.match(/\/status\/(\d+)/)[1], captionScreenshot: await capture('x-confirmed') });
    }
  }, { target, withLock: action => action() });
}
module.exports = { xTextWeight, xCaptionForInput, ownXMenuIdentity, inspectXPageIdentity, withXAndroidPage,
  inspectXAndroidSession, matchingXPost, readXPosts, findXPost, readXComposerState, publishXOnPage, publishXAndroid, scanXPublicPosts };
