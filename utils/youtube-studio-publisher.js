'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { withAndroidDeviceLock } = require('./android-device-lock');
const { socialAndroidTarget } = require('./android-social-target');
const { createAndroidEmulatorControl } = require('./android-emulator-control');
const { createPublicationResult } = require('./publication-status');
const { reconcileClickedStudioPublication } = require('./youtube-studio-reconciliation');
const studioConfig = require('../config/youtube-studio.json');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000;
const UPLOAD_DIRECTORY = studioConfig.uploadDirectory || '/sdcard/Movies/PulsoStudio';
if (!/^(?:\/sdcard|\/storage\/[A-F0-9-]{1,64})\/Movies\/PulsoStudio$/i.test(UPLOAD_DIRECTORY)) {
  throw new TypeError('diretório de staging Android inválido');
}
const CHANNEL_ID_RE = /(?:^|\/)channel\/(UC[a-zA-Z0-9_-]{22})(?:\/|$)/;
const VIDEO_ID_RE = /(?:youtube\.com\/(?:watch\?.*?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function safeComponent(value, fallback = 'upload') {
  return String(value || fallback).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 72) || fallback;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function studioChannelId(value) {
  try { return new URL(String(value || '')).pathname.match(CHANNEL_ID_RE)?.[1] || null; }
  catch { return null; }
}

function assertStudioChannel(url, expectedChannelId = studioConfig.expectedChannelId) {
  let parsed;
  try { parsed = new URL(String(url || '')); }
  catch { throw Object.assign(new Error('URL do Studio inválida'), { code: 'YOUTUBE_STUDIO_URL_INVALID' }); }
  const actualChannelId = studioChannelId(parsed.href);
  if (parsed.origin !== 'https://studio.youtube.com' || !actualChannelId || actualChannelId !== expectedChannelId) {
    throw Object.assign(new Error('sessão do Studio não corresponde ao canal configurado'), {
      code: 'YOUTUBE_STUDIO_CHANNEL_MISMATCH', expectedChannelId, actualChannelId
    });
  }
  return actualChannelId;
}

function youtubeVideoId(value) {
  return String(value || '').match(VIDEO_ID_RE)?.[1] || null;
}

function makeYoutubeUrl(videoId) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(String(videoId || ''))) throw new TypeError('videoId inválido');
  return `https://youtu.be/${videoId}`;
}

function adb(device, args, { adbPath = process.env.ADB_PATH || 'adb', timeout = 180000 } = {}) {
  try {
    return execFileSync(adbPath, ['-s', device, ...args], {
      encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    const code = error.code || error.status || 'unknown';
    throw Object.assign(new Error(`ADB ${args[0]} falhou (${code})`), { code: 'YOUTUBE_STUDIO_ADB_FAILED', cause: error });
  }
}

function publicationProof({ platform = 'youtube', videoPath, videoId, title, expectedSha256, channelId, privacyStatus, screenshotPath }) {
  return createPublicationResult({
    platform, videoPath, artifactSha256: expectedSha256,
    status: 'confirmed', account: channelId, url: makeYoutubeUrl(videoId), externalId: videoId,
    evidence: {
      kind: 'studio_publication_confirmed',
      observed: `Studio confirmou “${String(title).replace(/[\r\n\t]+/g, ' ').slice(0, 80)}” com visibilidade ${privacyStatus}.`,
      ...(screenshotPath ? { screenshotPath } : {})
    }
  });
}

function preSubmitFailure({ platform = 'youtube', videoPath, expectedSha256, code, message, retryAfterMs = null, screenshotPath = null }) {
  return createPublicationResult({
    platform, videoPath, artifactSha256: expectedSha256,
    status: 'failed', failureCode: code,
    ...(Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? { nextAttemptAt: new Date(Date.now() + retryAfterMs).toISOString() } : {}),
    evidence: { kind: 'confirmed_no_send', observed: String(message || 'Studio interrompeu o envio antes da publicação.').replace(/[\r\n\t]+/g, ' ').slice(0, 220),
      ...(screenshotPath ? { screenshotPath } : {}) }
  });
}

function studioPreSubmitErrorCode(error) {
  if (/net::ERR_(?:NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|NETWORK_CHANGED|CONNECTION_(?:RESET|CLOSED|TIMED_OUT))/i
    .test(String(error?.message || ''))) return 'YOUTUBE_STUDIO_SESSION_UNAVAILABLE';
  return error?.code || (error?.name === 'TimeoutError' ? 'YOUTUBE_STUDIO_SESSION_UNAVAILABLE' : 'youtube_studio_pre_submit_failed');
}

function androidAvailableBytes(output) {
  const fields = String(output || '').trim().split(/\r?\n/).at(-1)?.trim().split(/\s+/) || [];
  const kilobytes = Number(fields[3]);
  if (!Number.isSafeInteger(kilobytes) || kilobytes < 0) throw Object.assign(new Error('espaço Android não pôde ser verificado'), {
    code: 'YOUTUBE_STUDIO_DEVICE_UNAVAILABLE'
  });
  return kilobytes * 1024;
}

function outcomeUnknown({ platform = 'youtube', videoPath, expectedSha256, message, screenshotPath }) {
  return createPublicationResult({
    platform, videoPath, artifactSha256: expectedSha256,
    status: 'unknown', failureCode: 'youtube_studio_outcome_unknown',
    evidence: { kind: 'attempt_outcome_unknown', observed: String(message || 'O upload começou; confira o canal antes de qualquer nova tentativa.').replace(/[\r\n\t]+/g, ' ').slice(0, 220),
      ...(screenshotPath ? { screenshotPath } : {}) }
  });
}

// Chrome 156 no longer declares broad media-read permissions. The native
// document picker grants access to the selected file, unlike a CDP path.
async function selectStudioAndroidDocument({ page, control, filename, kind, onSelecting = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) throw new Error('nome do arquivo de staging inválido');
  const selector = kind === 'video'
    ? 'ytcp-uploads-dialog input[type="file"]'
    : 'ytcp-uploads-dialog input[type="file"][accept*="image"]';
  const input = page.locator(selector).first();
  await input.waitFor({ state: 'attached', timeout: 30000 });
  await input.evaluate(element => element.click());
  let searched = false;
  let lastActivity = '';
  let lastNodes = [];
  const dismissUnresponsiveTikTok = async nodes => {
    const title = nodes.find(node => node.visible !== false && node.resourceId === 'android:id/alertTitle'
      && /^tiktok\s+(?:isn't responding|is not responding|não está respondendo)$/i.test(String(node.text || '').trim()));
    const buttons = nodes.filter(node => node.visible !== false && node.resourceId === 'android:id/aerr_close'
      && node.clickable && Number.isInteger(node.x) && Number.isInteger(node.y));
    if (!title || buttons.length !== 1) return false;
    await control.tap(buttons[0].x, buttons[0].y);
    await wait(500);
    return true;
  };
  for (let attempt = 0; attempt < 25; attempt++) {
    const activity = String(await control.getResumedActivity());
    lastActivity = activity;
    if (/^com\.google\.android\.providers\.media\.module\/.*PhotoPickerGetContentActivity$/.test(activity)) {
      const pickerNodes = await control.dumpUi({ timeout: 5000 });
      if (await dismissUnresponsiveTikTok(pickerNodes)) continue;
      const browse = pickerNodes.filter(n => n.visible !== false && /^(browse…|browse\.\.\.|procurar…|procurar\.\.\.)$/i.test(n.text || '')
        && Number.isInteger(n.x) && Number.isInteger(n.y));
      const more = pickerNodes.filter(n => n.visible !== false && n.clickable
        && /^(more options|mais opções)$/i.test(n.description || '') && Number.isInteger(n.x) && Number.isInteger(n.y));
      if (browse.length === 1) await control.tap(browse[0].x, browse[0].y);
      else if (more.length === 1) await control.tap(more[0].x, more[0].y);
      await wait(500);
      continue;
    }
    if (!/^com\.(?:google|android)\.android\.documentsui\//.test(activity)
      && !/^com\.android\.documentsui\//.test(activity)) {
      await wait(500); continue;
    }
    const nodes = await control.dumpUi({ timeout: 5000 });
    lastNodes = nodes;
    if (await dismissUnresponsiveTikTok(nodes)) continue;
    const matches = nodes.filter(n => n.visible !== false
      && ((n.resourceId === 'android:id/title' && n.text === filename)
        || (!n.resourceId && String(n.description || '').startsWith(`${filename}, `)
          && Number(n.width) >= 100 && Number(n.height) >= 100))
      && Number.isInteger(n.x) && Number.isInteger(n.y));
    if (matches.length > 1) throw new Error('arquivo de staging não é único no seletor Android');
    if (matches.length === 1) {
      // From this point the OS may pass the file to Studio even if a tap fails.
      onSelecting();
      await control.tap(matches[0].x, matches[0].y);
      return;
    }
    // DocumentsUI can leave its overflow menu open after the Photo Picker
    // hands control to the file browser. The menu is modal: the file rows are
    // visible behind it, but are absent from the accessibility hierarchy until
    // BACK dismisses the menu. Re-read the same directory after closing it.
    const overflowMenuOpen = nodes.some(node => node.visible !== false
      && /^(sort by|select all|show hidden files|ordenar por|selecionar tudo|mostrar arquivos ocultos)$/i.test(String(node.text || '').trim()));
    if (overflowMenuOpen && typeof control.press === 'function') {
      await control.press('BACK');
      await wait(350);
      continue;
    }
    const search = nodes.filter(n => n.visible !== false && n.clickable
      && /^(search|pesquisar)$/i.test(n.description || n.text || ''));
    if (!searched && search.length === 1) {
      await control.tap(search[0].x, search[0].y);
      await control.shell(['input', 'text', filename]);
      await control.press('ENTER');
      searched = true;
    }
    await wait(700);
  }
  const error = new Error(`arquivo de staging não encontrado no seletor Android (${lastActivity.slice(0, 100) || 'activity indisponível'})`);
  if (typeof control.screenshot === 'function') {
    try {
      const reportDir = path.join(ROOT, 'data', 'reports', 'youtube-studio');
      await fs.promises.mkdir(reportDir, { recursive: true, mode: 0o700 });
      const screenshotPath = path.join(reportDir, `picker-${crypto.randomUUID()}.png`);
      await fs.promises.writeFile(screenshotPath, control.screenshot(), { mode: 0o600 });
      await fs.promises.writeFile(`${screenshotPath}.json`, JSON.stringify(lastNodes), { mode: 0o600 });
      error.pickerScreenshotPath = screenshotPath;
    } catch { /* a failure to capture must not change submission state */ }
  }
  throw error;
}

async function fillFirst(page, selectors, value) {
  await page.locator(selectors.join(', ')).first().waitFor({ state: 'visible', timeout: 30000 });
  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if (!await field.count().catch(() => 0)) continue;
    await field.fill(String(value), { timeout: 6000 }).catch(() => null);
    const current = await field.inputValue().catch(async () => field.textContent().catch(() => ''));
    if (String(current || '').trim() === String(value).trim()) return true;
  }
  return false;
}

async function clickFirst(page, selectors, label) {
  for (const selector of selectors) {
    const controls = page.locator(selector);
    const count = await controls.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
      const control = controls.nth(index);
      if (!await control.isVisible().catch(() => false)) continue;
      if (await control.isDisabled().catch(() => false)) continue;
      await control.evaluate(element => element.click());
      return true;
    }
  }
  throw Object.assign(new Error(`controle do Studio ausente: ${label}`), { code: 'YOUTUBE_STUDIO_CONTROL_MISSING' });
}

async function clickNext(page) {
  const selectors = ['#next-button', 'ytcp-button#next-button', 'button:has-text("Próximo")', 'button:has-text("Next")'];
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    let dialogText = '';
    try { dialogText = await page.locator('ytcp-uploads-dialog').innerText({ timeout: 1500 }); } catch { /* wait for the dialog */ }
    if (studioExplicitUploadLimit(dialogText)) {
      throw Object.assign(new Error('Studio informou que o limite diário de envios foi alcançado'), {
        code: 'YOUTUBE_STUDIO_UPLOAD_LIMIT'
      });
    }
    for (const selector of selectors) {
      const controls = page.locator(selector);
      const count = await controls.count().catch(() => 0);
      for (let index = 0; index < count; index++) {
        const control = controls.nth(index);
        if (!await control.isVisible().catch(() => false)) continue;
        if (await control.isDisabled().catch(() => true)) continue;
        await control.evaluate(element => element.click());
        await page.waitForTimeout(750);
        return;
      }
    }
    await page.waitForTimeout(250);
  }
  throw Object.assign(new Error('controle Próximo permaneceu indisponível no Studio'), { code: 'YOUTUBE_STUDIO_CONTROL_MISSING' });
}

async function studioRadioIsSelected(locator) {
  return locator.evaluate(element => Boolean(element.checked || element.hasAttribute('checked')
    || element.getAttribute('aria-checked') === 'true')).catch(() => false);
}

async function advanceToVisibility(page) {
  // Shorts can omit the video-elements step; stop at the actual visibility UI.
  for (let step = 0; step < 4; step++) {
    if (await page.locator('tp-yt-paper-radio-button[name="PUBLIC"]').isVisible().catch(() => false)) return;
    await clickNext(page);
  }
  if (await page.locator('tp-yt-paper-radio-button[name="PUBLIC"]').isVisible().catch(() => false)) return;
  throw Object.assign(new Error('etapa de visibilidade não apareceu no Studio'), {
    code: 'YOUTUBE_STUDIO_VISIBILITY_FIELD_MISSING'
  });
}

async function readStudioVideoId(page, expectedTitle) {
  const candidates = await page.locator('a[href*="youtube.com/watch"], a[href*="youtube.com/shorts/"], a[href*="youtu.be/"]').evaluateAll(links => links
    .map(link => ({ href: link.href, text: (link.innerText || '').trim() })));
  const id = candidates
    .filter(item => !item.text || youtubeVideoId(item.text)
      || item.text.toLocaleLowerCase().includes(String(expectedTitle).toLocaleLowerCase()))
    .map(item => youtubeVideoId(item.href)).find(Boolean);
  if (id) return id;
  const body = await page.locator('body').innerText().catch(() => '');
  const titleSeen = body.toLocaleLowerCase().includes(String(expectedTitle).toLocaleLowerCase());
  if (!titleSeen) throw Object.assign(new Error('Studio não exibiu o título enviado após publicar'), { code: 'YOUTUBE_STUDIO_RESULT_UNKNOWN' });
  const textId = body.match(/(?:youtu\.be\/|watch\?v=|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return textId?.[1] || null;
}

async function readPendingStudioVideoId(page, expectedTitle) {
  const dialog = page.locator('ytcp-uploads-dialog');
  if (await dialog.count().catch(() => 0) !== 1) return null;
  const title = await dialog.locator('#title-textarea #textbox').first().textContent().catch(() => '');
  if (String(title || '').trim() !== String(expectedTitle || '').trim()) return null;
  const links = await dialog.locator('a[href*="youtube.com/watch"], a[href*="youtube.com/shorts/"], a[href*="youtu.be/"]')
    .evaluateAll(items => items.map(item => item.href));
  const ids = [...new Set(links.map(youtubeVideoId).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}

function confirmedUploadText(text) {
  return /video (?:is |has been )?published|vídeo (?:foi )?publicado/i.test(String(text || ''));
}

function studioQuotaRejection(text) {
  return /you(?:'|’)ve reached your daily upload limit|daily upload limit|limite diário de envios|limite diário de uploads|exceeded the number of videos/i.test(String(text || ''));
}

function studioExplicitUploadLimit(text) {
  return /limite di[aá]rio de (?:envios|uploads) (?:foi )?alcan[cç]ado|(?:you(?:'|’)ve|you have) reached your daily upload limit|daily upload limit (?:has been )?reached/i.test(String(text || ''));
}

async function savePrivateScreenshot(page, artifactSha256) {
  const reportDir = path.join(ROOT, 'data', 'reports', 'youtube-studio');
  await fs.promises.mkdir(reportDir, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(reportDir, 0o700).catch(() => {});
  const screenshotPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${artifactSha256.slice(0, 12)}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 15000 });
  await fs.promises.chmod(screenshotPath, 0o600).catch(() => {});
  return screenshotPath;
}

async function ensureStudioAndroidDevice(device) {
  const target = socialAndroidTarget('instagram');
  if (target.device !== device) throw Object.assign(new Error('YouTube Studio e o perfil social não apontam para o mesmo Android'), {
    code: 'YOUTUBE_STUDIO_DEVICE_MISMATCH'
  });
  try { await target.emulator.acquire(); }
  catch (error) {
    throw Object.assign(new Error('Android Google Play não ficou disponível para o Studio'), {
      code: 'YOUTUBE_STUDIO_DEVICE_UNAVAILABLE', cause: error
    });
  }
}

// The endpoint can remain reachable even when Android has restricted Chrome's
// background network. Bring the existing Chrome task to the foreground under
// the device lock before connecting, without clearing its tabs or session.
async function connectStudioBrowser({ cdpUrl, device, adbPath, connect, runAdb, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const endpoint = new URL(cdpUrl);
  const local = ['127.0.0.1', 'localhost'].includes(endpoint.hostname);
  const foregroundChrome = () => runAdb(device, ['shell', 'am', 'start', '-a', 'android.intent.action.MAIN',
    '-c', 'android.intent.category.LAUNCHER', '-p', 'com.android.chrome'], { adbPath });
  if (!local) return connect(cdpUrl, { timeout: 10000 });
  let lastError;
  for (const delayMs of [2000, 3500, 5000]) {
    try {
      foregroundChrome();
      await wait(delayMs);
      return await connect(cdpUrl, { timeout: 10000 });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function prepareStudioPage(browser, { expectedChannelId, timeoutMs, listing = 'upload' }) {
  if (!['upload', 'short'].includes(listing)) throw new TypeError('listagem do Studio inválida');
  const contexts = browser.contexts();
  const context = contexts[0];
  if (!context) throw Object.assign(new Error('Chrome Android não expôs um perfil autenticado'), { code: 'YOUTUBE_STUDIO_SESSION_UNAVAILABLE' });
  const page = await context.newPage();
  try {
  await page.goto(`https://studio.youtube.com/channel/${expectedChannelId}/videos/${listing}`, {
    waitUntil: 'domcontentloaded', timeout: timeoutMs
  });
  // Android Chrome can display the Studio app promotion before loading the
  // authenticated web app. Continue on the web without changing accounts.
  await page.waitForFunction(() => Boolean(document.querySelector('ytcp-app'))
    || /continuar para o studio|continue to studio/i.test(document.body?.innerText || ''),
  null, { timeout: Math.min(timeoutMs, 45000) });
  const continueToStudio = page.getByText(/^(continuar para o studio|continue to studio)$/i).first();
  if (await continueToStudio.isVisible().catch(() => false)) await continueToStudio.click();
  await page.waitForFunction(() => Boolean(document.querySelector('ytcp-app'))
    && (document.body?.innerText?.length || 0) > 500, null, { timeout: Math.min(timeoutMs, 45000) });
  const channelId = assertStudioChannel(page.url(), expectedChannelId);
  const signInPrompt = await page.locator('body').innerText().then(text => /sign in|fazer login/i.test(text)).catch(() => true);
  if (signInPrompt) throw Object.assign(new Error('Studio exige login; nenhum vídeo foi selecionado'), {
    code: 'YOUTUBE_STUDIO_SESSION_UNAVAILABLE'
  });
    return { page, channelId };
  } catch (error) {
    await page.close().catch(() => {});
    throw error;
  }
}

function studioProcessingNotice(text) {
  return /a vers[aã]o de defini[cç][aã]o padr[aã]o|standard.definition.*(?:process|finish)|SD version.*(?:process|finish)/is.test(String(text || ''));
}

async function waitForStudioPublishedRow(browser, { videoId, expectedChannelId, platform = 'youtube', artifactSha256,
  timeoutMs = 10 * 60 * 1000, prepare = prepareStudioPage, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now, capture = savePrivateScreenshot } = {}) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(String(videoId || ''))) return null;
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    let page;
    try {
      const prepared = await prepare(browser, { expectedChannelId,
        timeoutMs: Math.min(45000, Math.max(1, deadline - now())), listing: platform === 'shorts' ? 'short' : 'upload' });
      page = prepared.page;
      if (prepared.channelId !== expectedChannelId) return null;
      const rows = await page.locator('ytcp-video-row').evaluateAll((elements, id) => elements
        .filter(row => [...row.querySelectorAll('a[href]')].some(a => a.getAttribute('href')?.includes(`/video/${id}/`)))
        .map(row => row.innerText), videoId);
      if (rows.length === 1) {
        const labels = rows[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\r?\n/).map(s => s.trim());
        const publicRow = labels.some(s => s === 'publico' || s === 'public')
          && labels.some(s => s === 'publicado' || s === 'published')
          && !labels.some(s => /^(?:rascunho|draft|privado|private|nao listado|unlisted|programado|scheduled|processando|processing)$/.test(s));
        if (publicRow) return { videoId, screenshotPath: await capture(page, artifactSha256).catch(() => null) };
      }
    } catch { /* A transient listing error never turns processing into confirmation. */ }
    finally { if (page) await page.close().catch(() => {}); }
    const remaining = deadline - now();
    if (remaining > 0) await wait(Math.min(15000, remaining));
  }
  return null;
}

async function uploadWithStudio({
  platform = 'youtube', videoPath, title, description = '', thumbnailPath = null, privacyStatus = 'public', madeForKids = studioConfig.defaultMadeForKids,
  expectedSha256 = null, expectedChannelId = studioConfig.expectedChannelId,
  device = process.env.ANDROID_DEVICE_YOUTUBE || studioConfig.androidDevice,
  cdpUrl = process.env.YOUTUBE_STUDIO_CDP_URL || studioConfig.cdpUrl,
  adbPath = process.env.ADB_PATH || 'adb', timeoutMs = DEFAULT_TIMEOUT_MS,
  jobId = null, lockPath = null,
  withLock = withAndroidDeviceLock, connect = (url, options) => chromium.connectOverCDP(url, options),
  runAdb = adb, ensureDevice = ensureStudioAndroidDevice
} = {}) {
  if (!['youtube', 'shorts'].includes(platform)) throw new TypeError('destino inválido para YouTube Studio');
  const source = path.resolve(String(videoPath || ''));
  const stat = await fs.promises.lstat(source).catch(() => null);
  const suppliedHash = /^[a-f0-9]{64}$/i.test(String(expectedSha256 || '')) ? expectedSha256 : null;
  if (!stat?.isFile() || stat.isSymbolicLink() || !/\.mp4$/i.test(source)) return preSubmitFailure({
    platform, videoPath: source, expectedSha256: suppliedHash, code: 'youtube_studio_media_invalid',
    message: 'Arquivo MP4 ausente ou não regular; nenhum envio foi iniciado.'
  });
  if (!String(title || '').trim() || String(title).trim().length > 100) return preSubmitFailure({
    platform, videoPath: source, expectedSha256: suppliedHash, code: 'youtube_studio_title_invalid',
    message: 'Título YouTube ausente ou acima de 100 caracteres; nenhum envio foi iniciado.'
  });
  if (!['public', 'unlisted', 'private'].includes(privacyStatus)) return preSubmitFailure({
    platform, videoPath: source, expectedSha256: suppliedHash, code: 'youtube_studio_privacy_invalid',
    message: 'Privacidade YouTube inválida; nenhum envio foi iniciado.'
  });
  if (typeof madeForKids !== 'boolean') return preSubmitFailure({
    platform, videoPath: source, expectedSha256: suppliedHash, code: 'youtube_studio_audience_invalid',
    message: 'Público infantil precisa estar definido explicitamente; nenhum envio foi iniciado.'
  });
  if (thumbnailPath) {
    const thumbnail = await fs.promises.lstat(path.resolve(thumbnailPath)).catch(() => null);
    if (!thumbnail?.isFile() || thumbnail.isSymbolicLink()) return preSubmitFailure({
      platform, videoPath: source, expectedSha256: suppliedHash, code: 'youtube_studio_thumbnail_invalid',
      message: 'Thumbnail ausente ou não regular; nenhum envio foi iniciado.'
    });
  }
  let hash;
  try { hash = sha256File(source); }
  catch {
    return preSubmitFailure({ platform, videoPath: source, expectedSha256: suppliedHash,
      code: 'youtube_studio_media_unreadable', message: 'MP4 não pôde ser lido; nenhum envio foi iniciado.' });
  }
  if (expectedSha256 && hash !== expectedSha256) return preSubmitFailure({
    platform, videoPath: source, expectedSha256: suppliedHash, code: 'youtube_studio_media_hash_mismatch',
    message: 'SHA-256 do MP4 diverge do manifesto QA; nenhum envio foi iniciado.'
  });
  const artifactSha256 = expectedSha256 || hash;
  let thumbnailHash = null;
  if (thumbnailPath) {
    try { thumbnailHash = sha256File(path.resolve(thumbnailPath)); }
    catch {
      return preSubmitFailure({ platform, videoPath: source, expectedSha256: artifactSha256,
        code: 'youtube_studio_thumbnail_unreadable', message: 'Thumbnail não pôde ser lida; nenhum envio foi iniciado.' });
    }
  }
  const safeDevice = String(device).replace(/[^a-z0-9_-]/gi, '_');
  const stateRoot = path.resolve(process.env.STATE_DIR || path.join(ROOT, 'data'));
  const actualLockPath = lockPath || path.join(stateRoot, `android-social-${safeDevice}.lock`);

  return withLock(async () => {
    let browser = null;
    let page = null;
    let studioUploadStarted = false;
    let publishClicked = false;
    let preparedChannelId = null;
    let publicationResult = null;
    const stageId = safeComponent(jobId || artifactSha256.slice(0, 20));
    const extension = path.extname(source).toLowerCase();
    const remotePath = `${UPLOAD_DIRECTORY}/${stageId}-${artifactSha256.slice(0, 12)}${extension}`;
    const remoteThumbnail = thumbnailPath
      ? `${UPLOAD_DIRECTORY}/${stageId}-${artifactSha256.slice(0, 12)}-cover${path.extname(thumbnailPath).toLowerCase() || '.png'}` : null;
    try {
      await ensureDevice(device);
      const internalFree = androidAvailableBytes(runAdb(device, ['shell', 'df', '-Pk', '/data'], { adbPath }));
      const storageRoot = UPLOAD_DIRECTORY.split('/Movies/')[0];
      const mediaFree = androidAvailableBytes(runAdb(device, ['shell', 'df', '-Pk', storageRoot], { adbPath }));
      if (internalFree < 64 * 1024 * 1024 || mediaFree < stat.size + 48 * 1024 * 1024) {
        throw Object.assign(new Error('espaço insuficiente no Android para preparar o Studio'), {
          code: 'YOUTUBE_STUDIO_STORAGE_INSUFFICIENT'
        });
      }
      const endpoint = new URL(cdpUrl);
      if (['127.0.0.1', 'localhost'].includes(endpoint.hostname) && endpoint.port) {
        runAdb(device, ['forward', `tcp:${endpoint.port}`, 'localabstract:chrome_devtools_remote'], { adbPath });
      }
      runAdb(device, ['shell', 'mkdir', '-p', UPLOAD_DIRECTORY], { adbPath });
      runAdb(device, ['push', source, remotePath], { adbPath, timeout: 5 * 60 * 1000 });
      const remoteHashOutput = runAdb(device, ['shell', 'sha256sum', remotePath], { adbPath });
      if (remoteHashOutput.split(/\s+/)[0]?.toLowerCase() !== artifactSha256) {
        return preSubmitFailure({ platform, videoPath: source, expectedSha256: artifactSha256,
          code: 'youtube_studio_staging_hash_mismatch', message: 'O arquivo transferido ao Android não confere com o SHA aprovado.' });
      }
      if (thumbnailPath) {
        runAdb(device, ['push', path.resolve(thumbnailPath), remoteThumbnail], { adbPath, timeout: 60000 });
        const remoteThumbnailHash = runAdb(device, ['shell', 'sha256sum', remoteThumbnail], { adbPath }).split(/\s+/)[0]?.toLowerCase();
        if (remoteThumbnailHash !== thumbnailHash) {
          return preSubmitFailure({ platform, videoPath: source, expectedSha256: artifactSha256,
            code: 'youtube_studio_thumbnail_staging_hash_mismatch', message: 'A capa transferida ao Android não confere com o arquivo local.' });
        }
      }
      for (const mediaPath of [remotePath, remoteThumbnail].filter(Boolean)) {
        runAdb(device, ['shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${mediaPath}`], { adbPath });
      }
      try { browser = await connectStudioBrowser({ cdpUrl, device, adbPath, connect, runAdb }); }
      catch (error) {
        throw Object.assign(new Error('Chrome Android não expôs a sessão remota do Studio'), {
          code: 'YOUTUBE_STUDIO_CDP_UNAVAILABLE', cause: error
        });
      }
      const prepared = await prepareStudioPage(browser, { expectedChannelId, timeoutMs });
      page = prepared.page;
      preparedChannelId = prepared.channelId;

      await clickFirst(page, ['ytcp-button#create-icon', 'button[aria-label="Criar"]', 'button[aria-label="Create"]'], 'Criar');
      await clickFirst(page, ['tp-yt-paper-item:has-text("Enviar vídeos")', 'tp-yt-paper-item:has-text("Upload videos")', 'button:has-text("Enviar vídeos")', 'button:has-text("Upload videos")'], 'Enviar vídeos');
      // Studio's custom-element host can have a zero-sized box even while its
      // upload controls are visible. File inputs are intentionally hidden.
      await page.locator('ytcp-uploads-dialog input[type="file"]').first().waitFor({ state: 'attached', timeout: 30000 });
      const control = createAndroidEmulatorControl({ device, adbPath });
      await selectStudioAndroidDocument({ page, control, filename: path.posix.basename(remotePath), kind: 'video',
        onSelecting: () => { studioUploadStarted = true; } });

      const titleFilled = await fillFirst(page, [
        'ytcp-uploads-dialog #title-textarea #textbox', '#title-textarea #textbox',
        '[contenteditable="true"][aria-label*="título" i]', '[contenteditable="true"][aria-label*="title" i]',
        'textarea[aria-label*="título" i]', 'textarea[aria-label*="title" i]'
      ], String(title).trim());
      if (!titleFilled) throw Object.assign(new Error('campo de título do Studio não foi confirmado'), { code: 'YOUTUBE_STUDIO_TITLE_FIELD_MISSING' });
      const descriptionFilled = await fillFirst(page, [
        'ytcp-uploads-dialog #description-textarea #textbox', '#description-textarea #textbox',
        '[contenteditable="true"][aria-label*="Fale sobre seu vídeo" i]',
        '[contenteditable="true"][aria-label*="Tell viewers about your video" i]',
        'textarea[aria-label*="descrição" i]', 'textarea[aria-label*="description" i]'
      ], String(description || '').slice(0, 5000));
      if (!descriptionFilled) throw Object.assign(new Error('campo de descrição do Studio não foi confirmado'), { code: 'YOUTUBE_STUDIO_DESCRIPTION_FIELD_MISSING' });

      if (remoteThumbnail) {
        await selectStudioAndroidDocument({ page, control, filename: path.posix.basename(remoteThumbnail), kind: 'image' });
      }
      const audienceName = madeForKids ? 'VIDEO_MADE_FOR_KIDS_MFK' : 'VIDEO_MADE_FOR_KIDS_NOT_MFK';
      const audience = page.locator(`tp-yt-paper-radio-button[name="${audienceName}"]`).first();
      if (!await audience.count().catch(() => 0)) throw Object.assign(new Error('seletor obrigatório de público infantil não foi reconhecido'), {
        code: 'YOUTUBE_STUDIO_AUDIENCE_FIELD_MISSING'
      });
      await audience.evaluate(element => element.click());
      if (!await studioRadioIsSelected(audience)) throw Object.assign(new Error('Studio não confirmou o público infantil selecionado'), {
        code: 'YOUTUBE_STUDIO_AUDIENCE_FIELD_MISSING'
      });

      await advanceToVisibility(page);

      const visibility = privacyStatus === 'public' ? /público|public/i
        : privacyStatus === 'unlisted' ? /não listado|unlisted/i : /privado|private/i;
      const visibilityOption = page.locator('tp-yt-paper-radio-button').filter({ hasText: visibility }).first();
      if (!await visibilityOption.count().catch(() => 0)) throw Object.assign(new Error('opção de visibilidade não apareceu no Studio'), {
        code: 'YOUTUBE_STUDIO_VISIBILITY_FIELD_MISSING'
      });
      await visibilityOption.evaluate(element => element.click());
      if (!await studioRadioIsSelected(visibilityOption)) throw Object.assign(new Error('Studio não confirmou a visibilidade selecionada'), {
        code: 'YOUTUBE_STUDIO_VISIBILITY_FIELD_MISSING'
      });
      await clickFirst(page, ['#done-button', 'ytcp-button#done-button', `button:has-text("${privacyStatus === 'public' ? 'Publicar' : 'Salvar'}")`, `button:has-text("${privacyStatus === 'public' ? 'Publish' : 'Save'}")`], 'Publicar');
      publishClicked = true;

      await page.waitForFunction(() => {
        const body = document.body?.innerText || '';
        return /video (?:is |has been )?published|vídeo (?:foi )?publicado/i.test(body)
          || /daily upload limit|limite diário de (envios|uploads)|exceeded the number of videos/i.test(body)
          || /a vers[aã]o de defini[cç][aã]o padr[aã]o|standard.definition.*(?:process|finish)|SD version.*(?:process|finish)/is.test(body);
      }, null, { timeout: Math.min(timeoutMs, 90000) });
      const completionText = await page.locator('body').innerText().catch(() => '');
      if (studioQuotaRejection(completionText)) {
        publicationResult = preSubmitFailure({ platform, videoPath: source, expectedSha256: artifactSha256,
          code: 'youtube_upload_limit', message: 'Studio recusou o envio antes da publicação por limite diário de uploads.',
          retryAfterMs: 24 * 60 * 60 * 1000 });
        return publicationResult;
      }
      if (!confirmedUploadText(completionText) && privacyStatus === 'public' && studioProcessingNotice(completionText)) {
        const pendingVideoId = await readStudioVideoId(page, String(title).trim());
        const proof = await waitForStudioPublishedRow(browser, { videoId: pendingVideoId,
          expectedChannelId: prepared.channelId, platform, artifactSha256,
          timeoutMs: Math.min(timeoutMs, 10 * 60 * 1000) });
        if (proof) {
          publicationResult = publicationProof({ platform, videoPath: source, videoId: proof.videoId, title,
            expectedSha256: artifactSha256, channelId: prepared.channelId, privacyStatus, screenshotPath: proof.screenshotPath });
          return publicationResult;
        }
      }
      if (!confirmedUploadText(completionText)) throw Object.assign(new Error('Studio não apresentou uma confirmação final de publicação'), {
        code: 'YOUTUBE_STUDIO_RESULT_UNKNOWN'
      });
      const videoId = await readStudioVideoId(page, String(title).trim());
      if (!videoId) {
        publicationResult = outcomeUnknown({ platform, videoPath: source, expectedSha256: artifactSha256,
        message: 'Studio marcou o envio como publicado, mas não expôs uma URL identificável; conferir antes de repetir.' });
        return publicationResult;
      }
      const screenshotPath = await savePrivateScreenshot(page, artifactSha256).catch(() => null);
      publicationResult = publicationProof({ platform, videoPath: source, videoId, title, expectedSha256: artifactSha256,
        channelId: prepared.channelId, privacyStatus, screenshotPath });
      return publicationResult;
    } catch (error) {
      const message = String(error?.message || error).replace(/[\r\n\t]+/g, ' ').slice(0, 180);
      if (!publishClicked && error?.code === 'YOUTUBE_STUDIO_UPLOAD_LIMIT') {
        const screenshotPath = page ? await savePrivateScreenshot(page, artifactSha256).catch(() => null) : null;
        publicationResult = preSubmitFailure({ platform, videoPath: source, expectedSha256: artifactSha256,
          code: 'youtube_upload_limit', message: 'Studio recusou o envio antes da publicação por limite diário de uploads.',
          retryAfterMs: 24 * 60 * 60 * 1000, screenshotPath });
        return publicationResult;
      }
      if (publishClicked || studioUploadStarted) {
        const reconciled = await reconcileClickedStudioPublication({ publishClicked, privacyStatus,
          readId: () => page && preparedChannelId ? readPendingStudioVideoId(page, String(title).trim()) : null,
          waitForRow: videoId => waitForStudioPublishedRow(browser, { videoId, expectedChannelId: preparedChannelId,
            platform, artifactSha256, timeoutMs: Math.min(timeoutMs, 120000) }) }).catch(() => null);
        if (reconciled) {
          publicationResult = publicationProof({ platform, videoPath: source, videoId: reconciled.videoId,
            title, expectedSha256: artifactSha256, channelId: preparedChannelId, privacyStatus,
            screenshotPath: reconciled.screenshotPath });
          return publicationResult;
        }
        // Keep a private, hash-associated snapshot of the actual failing UI.
        // A screenshot is evidence for reconciliation, never proof of no send.
        const screenshotPath = error?.pickerScreenshotPath || (page ? await savePrivateScreenshot(page, artifactSha256).catch(() => null) : null);
        publicationResult = outcomeUnknown({ platform, videoPath: source, expectedSha256: artifactSha256,
          message: `Studio iniciou o upload/publicação e a confirmação não foi concluída: ${message}`, screenshotPath });
        return publicationResult;
      }
      const preSubmitCode = studioPreSubmitErrorCode(error);
      publicationResult = preSubmitFailure({ platform, videoPath: source, expectedSha256: artifactSha256,
        code: preSubmitCode,
        message: `Nenhum upload foi iniciado: ${message}`,
        retryAfterMs: preSubmitCode === 'YOUTUBE_STUDIO_STORAGE_INSUFFICIENT' ? 30 * 60 * 1000
          : ['YOUTUBE_STUDIO_CDP_UNAVAILABLE', 'YOUTUBE_STUDIO_SESSION_UNAVAILABLE',
          'YOUTUBE_STUDIO_DEVICE_UNAVAILABLE', 'YOUTUBE_STUDIO_ADB_FAILED'].includes(preSubmitCode)
          ? 5 * 60 * 1000 : null });
      return publicationResult;
    } finally {
      if (page && publicationResult?.status !== 'unknown') await page.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      // Keep staged Android media when the Studio outcome is uncertain so the
      // operator can reconcile that same upload without selecting another file.
      const confirmed = publicationResult?.status === 'confirmed';
      const confirmedNoSend = publicationResult?.evidence?.kind === 'confirmed_no_send';
      if (!studioUploadStarted || confirmed || confirmedNoSend) {
        try { runAdb(device, ['shell', 'rm', '-f', remotePath, ...(remoteThumbnail ? [remoteThumbnail] : [])], { adbPath }); }
        catch { /* preservar o resultado de publicação mesmo se a limpeza falhar */ }
      }
    }
  }, { lockPath: actualLockPath, owner: 'youtube-studio-upload', timeoutMs });
}

module.exports = {
  studioProcessingNotice, waitForStudioPublishedRow,
  advanceToVisibility,
  prepareStudioPage, connectStudioBrowser,
  DEFAULT_TIMEOUT_MS, UPLOAD_DIRECTORY, assertStudioChannel, makeYoutubeUrl,
  publicationProof, safeComponent, sha256File, studioChannelId, uploadWithStudio, youtubeVideoId,
  confirmedUploadText, studioQuotaRejection, studioExplicitUploadLimit, studioPreSubmitErrorCode, androidAvailableBytes,
  selectStudioAndroidDocument
};
