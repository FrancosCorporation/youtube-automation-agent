'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { Logger } = require('./logger');
const { createAndroidEmulatorControl } = require('./android-emulator-control');
const { withAndroidDeviceLock } = require('./android-device-lock');
const { safeErrorTag } = require('./safe-error-tag');
const socialDevices = require('../config/android-social-devices.json');

const FIREFOX_PACKAGE = 'org.mozilla.firefox';
const GEMINI_URL = 'https://gemini.google.com/app';
const EDITOR_TEXT = /peca ao gemini|ask gemini|message gemini|insira um comando para o gemini/i;
const SIGN_IN_TEXT = /sign in|fazer login|entrar na sua conta|iniciar sessao/i;
const ANDROID_ANR_TEXT = /isn't responding|is not responding|not responding/i;
const GEMINI_APP_PROMO_TEXT = /fa[cç]a mais com o app do gemini|more with the gemini app|accesse o gemini mais r[aá]pido/i;
const IMAGE_DOWNLOAD_TEXT = /baixar imagem no tamanho original|download image at original size/i;
const DOWNLOAD_CONFIRM_TEXT = /^(?:download(?: again)?|baixar(?: novamente)?)$/i;
const FIREFOX_CFR_DISMISS_RESOURCE_ID = 'cfr.dismiss';
const IMAGE_FILE = /^Gemini_Generated_Image_[a-z0-9_-]+\.(?:png|jpe?g|webp)$/i;
const TARGET_RATIO = 16 / 9;
const PORTRAIT_RATIO = 9 / 16;

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function uiText(node) {
  return normalized(`${node.text || ''} ${node.description || ''} ${node.hint || ''}`);
}

function hasLoginPrompt(nodes) {
  return nodes.some(node => node.visible !== false && SIGN_IN_TEXT.test(uiText(node)));
}

function hasAndroidAppAnr(nodes) {
  return nodes.some(node => node.visible !== false && ANDROID_ANR_TEXT.test(uiText(node)));
}

function hasGeminiAppPromo(nodes) {
  return nodes.some(node => node.visible !== false && GEMINI_APP_PROMO_TEXT.test(uiText(node)));
}

function hasTouchableBounds(node) {
  return node?.visible !== false && node?.clickable === true
    && Number(node.width) > 0 && Number(node.height) > 0;
}

function findEditor(nodes) {
  return nodes.find(node => node.visible !== false
    && /edittext|textbox/i.test(node.className || '')
    && EDITOR_TEXT.test(uiText(node)));
}

function listGeminiDownloads(output) {
  return String(output || '').split(/\r?\n/).map(line => line.trim())
    .filter(name => IMAGE_FILE.test(name));
}

function closestWideRatio(metadata) {
  if (!metadata?.width || !metadata?.height) return false;
  const ratio = metadata.width / metadata.height;
  return ratio >= 1.45 && ratio <= 2.05 && Math.abs(ratio - TARGET_RATIO) <= 0.25;
}

function closestPortraitRatio(metadata) {
  if (!metadata?.width || !metadata?.height) return false;
  const ratio = metadata.width / metadata.height;
  return ratio >= 0.45 && ratio <= 0.8 && Math.abs(ratio - PORTRAIT_RATIO) <= 0.23;
}

function imageAspectRatio(value) {
  return String(value || '16:9') === '9:16' ? '9:16' : '16:9';
}

function defaultGeminiLockPath(device, stateDir, env) {
  const kwaiDevice = env.ANDROID_DEVICE_KWAI || env.ANDROID_DEVICE || socialDevices.platforms.kwai.device;
  const sharesKwaiRedroid = socialDevices.platforms.kwai.runtime === 'redroid' && device === kwaiDevice;
  const filename = sharesKwaiRedroid
    ? 'android-social-upload.lock'
    : `android-social-${device.replace(/[^a-z0-9_-]/gi, '_')}.lock`;
  return path.join(stateDir, filename);
}

class GeminiAndroidImageGenerator {
  constructor(options = {}) {
    this.logger = options.logger || new Logger('GeminiAndroidImage');
    this.env = options.env || process.env;
    const androidOptions = { ...(options.androidOptions || {}) };
    androidOptions.env ||= this.env;
    androidOptions.device ||= this.env.GEMINI_ANDROID_DEVICE || this.env.ANDROID_DEVICE || '127.0.0.1:5555';
    this.device = androidOptions.device;
    this.sharedSocialDevice = Object.entries(socialDevices.platforms).some(([platform, config]) =>
      this.device === (this.env[`ANDROID_DEVICE_${platform.toUpperCase()}`] || this.env.ANDROID_DEVICE || config.device));
    this.control = options.control || createAndroidEmulatorControl(androidOptions);
    this.browserPackage = String(options.browserPackage || this.env.GEMINI_ANDROID_BROWSER_PACKAGE || FIREFOX_PACKAGE).trim();
    this.cdpUrl = String(options.cdpUrl || this.env.GEMINI_ANDROID_CDP_URL || '').trim();
    this._cdpBrowser = null;
    if (!/^[A-Za-z][A-Za-z\d_]*(?:\.[A-Za-z][A-Za-z\d_]*)+$/.test(this.browserPackage)) {
      throw new Error('GEMINI_ANDROID_BROWSER_PACKAGE_INVALID');
    }
    this.enabled = options.enabled ?? this.env.GEMINI_ANDROID_FALLBACK !== '0';
    this.stateDir = options.stateDir || this.env.STATE_DIR || path.join(__dirname, '..', 'data');
    this.lockPath = options.lockPath || defaultGeminiLockPath(this.device, this.stateDir, this.env);
    this.withLock = options.withLock || withAndroidDeviceLock;
    this.wait = options.wait || sleep;
    this.timeoutMs = Math.max(30000, Number(options.timeoutMs || this.env.GEMINI_ANDROID_TIMEOUT_MS || 180000));
    this.probeTimeoutMs = Math.max(5000, Number(options.probeTimeoutMs || 35000));
    this.pollIntervalMs = Math.max(500, Number(options.pollIntervalMs || 2500));
    this.downloadTimeoutMs = Math.max(5000, Number(options.downloadTimeoutMs || 20000));
    this.availabilityRetryMs = Math.max(0, Number(options.availabilityRetryMs ?? 15000));
    this._availability = null;
    this._availabilityCheckedAt = 0;
    this._deviceSessionLockHeld = false;
    this._hasConversation = false;
  }

  async _withDevice(callback, timeoutMs = this.timeoutMs) {
    if (this._deviceSessionLockHeld) return callback();
    return this.withLock(callback, {
      lockPath: this.lockPath,
      owner: 'gemini-image-generation',
      timeoutMs
    });
  }

  async withDeviceSessionLock(callback) {
    if (this._deviceSessionLockHeld) return callback();
    return this.withLock(async () => {
      this._deviceSessionLockHeld = true;
      try { return await callback(); }
      finally { this._deviceSessionLockHeld = false; }
    }, { lockPath: this.lockPath, owner: 'gemini-image-generation-batch', timeoutMs: this.timeoutMs });
  }

  async _openGemini() {
    if (!this.control.isBooted()) throw new Error('GEMINI_ANDROID_DEVICE_NOT_READY');
    if (!await this.control.isPackageInstalled(this.browserPackage)) {
      throw new Error(this.browserPackage === FIREFOX_PACKAGE
        ? 'GEMINI_ANDROID_FIREFOX_MISSING' : 'GEMINI_ANDROID_BROWSER_MISSING');
    }
    const activity = String(this.control.getResumedActivity() || '');
    const packageName = activity.split('/')[0];
    if (this.sharedSocialDevice && !activity) throw new Error('GEMINI_ANDROID_FOREGROUND_UNKNOWN');
    if (this.sharedSocialDevice && activity && packageName !== this.browserPackage
      && !['com.google.android.apps.nexuslauncher', 'com.android.launcher3'].includes(packageName)) {
      throw new Error('GEMINI_ANDROID_SHARED_DEVICE_IN_USE');
    }
    if (activity.startsWith(`${this.browserPackage}/`)) {
      const nodes = await this.control.dumpUi({ timeout: 15000 });
      if (hasAndroidAppAnr(nodes)) throw new Error('GEMINI_ANDROID_APP_ANR');
      const urlBar = nodes.find(node => node.resourceId === 'com.android.chrome:id/url_bar'
        && /gemini\.google\.com/i.test(node.text || ''));
      if (urlBar) this.activeGeminiUrl = urlBar.text;
      if (findEditor(nodes) || nodes.some(node => /gemini\.google\.com/i.test(uiText(node)))) return;
      if (this.sharedSocialDevice) throw new Error('GEMINI_ANDROID_SHARED_BROWSER_IN_USE');
    }
    this.control.run(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', GEMINI_URL, '-p', this.browserPackage], {
      timeout: 30000
    });
  }

  async _getBrowserPage(pageUrl = this.activeGeminiUrl) {
    if (!this.cdpUrl) return null;
    const { chromium } = require('playwright');
    this._cdpBrowser ||= await chromium.connectOverCDP(this.cdpUrl, { timeout: 10000 });
    const context = this._cdpBrowser.contexts()[0];
    if (!context) throw new Error('GEMINI_ANDROID_CDP_CONTEXT_MISSING');
    const normalizedUrl = /^https?:\/\//i.test(pageUrl || '') ? pageUrl : (pageUrl ? `https://${pageUrl}` : '');
    const targetUrl = normalizedUrl.split(/[?#]/, 1)[0];
    const pages = context.pages().filter(page => /^https:\/\/gemini\.google\.com\//i.test(page.url()));
    const visibility = await Promise.all(pages.map(page => page.evaluate(() => document.visibilityState === 'visible').catch(() => false)));
    const activePage = pages.find((_page, index) => visibility[index]);
    if (activePage) {
      this.activeGeminiUrl = activePage.url();
      return activePage;
    }
    return pages.find(page => page.url().split(/[?#]/, 1)[0] === targetUrl) || pages[0] || null;
  }

  async _submitBrowserPrompt(page, editor, prompt) {
    await editor.fill(prompt, { timeout: this.probeTimeoutMs });
    const send = page.getByRole('button', { name: /^(send message|enviar mensagem)$/i }).last();
    try {
      await send.waitFor({ state: 'visible', timeout: this.probeTimeoutMs });
      if (await send.isDisabled()) {
        throw Object.assign(new Error('GEMINI_ANDROID_SEND_BUTTON_DISABLED'), { code: 'GEMINI_ANDROID_SEND_BUTTON_DISABLED' });
      }
      await send.click({ timeout: this.probeTimeoutMs });
    } catch (error) {
      if (error?.message === 'GEMINI_ANDROID_SEND_BUTTON_DISABLED') throw error;
      throw Object.assign(new Error('GEMINI_ANDROID_SEND_BUTTON_MISSING'), { code: 'GEMINI_ANDROID_SEND_BUTTON_MISSING' });
    }
  }

  async _findBrowserEditor() {
    if (!this.cdpUrl) return null;
    try {
      const page = await this._getBrowserPage();
      if (!page) return null;
      const editor = page.locator('div.ql-editor[contenteditable="true"]:visible, rich-textarea div[contenteditable="true"]:visible, div[contenteditable="true"][role="textbox"]:visible, div[contenteditable="true"]:visible').last();
      await editor.waitFor({ state: 'visible', timeout: 700 });
      this.activeGeminiUrl = page.url();
      return { cdpPage: page, cdpEditor: editor };
    } catch (_error) {
      return null;
    }
  }

  async _findEditor(timeoutMs = this.probeTimeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastNodes = [];
    let dismissedFirefoxTip = false;
    do {
      lastNodes = await this.control.dumpUi({ timeout: Math.max(5000, deadline - Date.now()) });
      if (hasAndroidAppAnr(lastNodes)) throw new Error('GEMINI_ANDROID_APP_ANR');
      const firefoxTip = this.browserPackage === FIREFOX_PACKAGE && !dismissedFirefoxTip && lastNodes.find(node => node.visible !== false
        && node.clickable && node.resourceId === FIREFOX_CFR_DISMISS_RESOURCE_ID);
      if (firefoxTip) {
        // Firefox can put its contextual feature tip in a separate active
        // accessibility window, hiding the Gemini WebView until it is closed.
        this.control.tap(firefoxTip.x, firefoxTip.y);
        dismissedFirefoxTip = true;
        await this.wait(350);
        continue;
      }
      const urlBar = lastNodes.find(node => node.resourceId === 'com.android.chrome:id/url_bar'
        && /gemini\.google\.com/i.test(node.text || ''));
      if (urlBar) this.activeGeminiUrl = urlBar.text;
      const editor = findEditor(lastNodes);
      if (hasLoginPrompt(lastNodes)) throw new Error('GEMINI_ANDROID_LOGIN_REQUIRED');
      const browserEditor = await this._findBrowserEditor();
      if (browserEditor) return browserEditor;
      if (editor) return editor;
      if (Date.now() >= deadline) break;
      await this.wait(Math.min(this.pollIntervalMs, Math.max(1, deadline - Date.now())));
    } while (Date.now() < deadline);
    throw new Error(lastNodes.length ? 'GEMINI_ANDROID_EDITOR_NOT_READY' : 'GEMINI_ANDROID_UI_UNAVAILABLE');
  }

  async _dismissIntro(nodes) {
    const intro = nodes.find(node => node.visible !== false && /^(let'?s go|vamos la|comecar)$/i.test((node.text || '').trim()));
    if (intro) {
      this.control.tap(intro.x, intro.y);
      await this.wait(700);
    }
  }

  async _startNewChat() {
    let nodes = await this.control.dumpUi({ timeout: 30000 });
    const urlBar = nodes.find(node => node.resourceId === 'com.android.chrome:id/url_bar'
      && /gemini\.google\.com/i.test(node.text || ''));
    if (urlBar) this.activeGeminiUrl = urlBar.text;
    const fresh = nodes.find(node => node.visible !== false && /^(nova conversa|new chat)$/i.test((node.text || '').trim()));
    if (fresh) {
      this.control.tap(fresh.x, fresh.y);
      await this.wait(800);
      nodes = await this.control.dumpUi({ timeout: 30000 });
      this._hasConversation = false;
    } else if (this.cdpUrl) {
      const page = await this._getBrowserPage();
      if (!page) throw new Error('GEMINI_ANDROID_CDP_PAGE_MISSING');
      const editor = page.locator('div.ql-editor[contenteditable="true"], rich-textarea div[contenteditable="true"], div[contenteditable="true"][role="textbox"], div[contenteditable="true"]').last();
      if (this._hasConversation || !await editor.isVisible().catch(() => false)) {
        const newChat = page.getByRole('link', { name: /nova conversa|new chat/i }).first();
        const newChatButton = page.getByRole('button', { name: /nova conversa|new chat/i }).first();
        if (await newChat.isVisible().catch(() => false)) await newChat.click();
        else if (await newChatButton.isVisible().catch(() => false)) await newChatButton.click();
        else await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(900);
        this._hasConversation = false;
      }
      this.activeGeminiUrl = page.url();
    }
    await this._dismissIntro(nodes);
    return this._findEditor();
  }

  async _awaitImageDownloadAction(timeoutMs = this.timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    do {
      const nodes = await this.control.dumpUi({ timeout: Math.max(5000, deadline - Date.now()) });
      if (hasAndroidAppAnr(nodes)) throw new Error('GEMINI_ANDROID_APP_ANR');
      if (hasGeminiAppPromo(nodes)) {
        this.control.press('BACK');
        await this.wait(350);
        continue;
      }
      if (hasLoginPrompt(nodes) && !findEditor(nodes)) throw new Error('GEMINI_ANDROID_LOGIN_EXPIRED');
      // Android's WebView accessibility tree can expose a duplicate action at
      // [0,0][0,0] before the real, visible image action. Tapping that empty
      // node silently does nothing and leaves Chrome's download unfinished.
      const button = nodes.find(node => hasTouchableBounds(node) && IMAGE_DOWNLOAD_TEXT.test(uiText(node)));
      if (button) {
        const urlBar = nodes.find(node => node.resourceId === 'com.android.chrome:id/url_bar' && /gemini\.google\.com/i.test(node.text || ''));
        this.activeGeminiUrl = urlBar?.text || '';
        return button;
      }
      const text = nodes.map(uiText).join(' ');
      if (/something went wrong|algo deu errado|try again|tente novamente|limite atingido|limit reached/.test(text)) {
        throw new Error('GEMINI_ANDROID_GENERATION_FAILED');
      }
      if (Date.now() >= deadline) break;
      await this.wait(this.pollIntervalMs);
    } while (Date.now() < deadline);
    throw new Error('GEMINI_ANDROID_GENERATION_TIMEOUT');
  }

  async _resolveDownloadAction(downloadAction) {
    if (downloadAction) return downloadAction;
    const timeoutMs = Math.min(this.timeoutMs, Math.max(this.downloadTimeoutMs, this.probeTimeoutMs));
    return this._awaitImageDownloadAction(timeoutMs);
  }

  async _confirmDownload(previousNames) {
    const deadline = Date.now() + this.downloadTimeoutMs;
    do {
      const output = this.control.shell(['ls', '-1', '/sdcard/Download'], { allowFailure: true });
      const fresh = listGeminiDownloads(output).filter(name => !previousNames.has(name));
      if (fresh.length) return fresh[fresh.length - 1];
      const nodes = await this.control.dumpUi({ timeout: Math.max(5000, deadline - Date.now()) });
      const confirmation = nodes.find(node => hasTouchableBounds(node)
        && DOWNLOAD_CONFIRM_TEXT.test((node.text || '').trim()));
      if (confirmation) {
        this.control.tap(confirmation.x, confirmation.y);
        return null;
      }
      await this.wait(400);
    } while (Date.now() < deadline);
    throw new Error('GEMINI_ANDROID_DOWNLOAD_CONFIRMATION_MISSING');
  }

  async _waitForNewDownload(previousNames) {
    const deadline = Date.now() + this.downloadTimeoutMs;
    do {
      const output = this.control.shell(['ls', '-1', '/sdcard/Download'], { allowFailure: true });
      const fresh = listGeminiDownloads(output).filter(name => !previousNames.has(name));
      if (fresh.length) return fresh[fresh.length - 1];
      await this.wait(500);
    } while (Date.now() < deadline);
    throw new Error('GEMINI_ANDROID_DOWNLOADED_FILE_MISSING');
  }

  async _browserImageSources(page) {
    return page.evaluate(() => {
      const found = [];
      const walk = root => {
        for (const element of root.querySelectorAll('*')) {
          if (element.tagName === 'IMG' && element.complete && element.naturalWidth >= 512) {
            found.push({ src: element.currentSrc || element.src, width: element.naturalWidth, height: element.naturalHeight });
          }
          if (element.shadowRoot) walk(element.shadowRoot);
        }
      };
      walk(document);
      return found;
    });
  }

  async _waitForBrowserImage(page, previousSources, timeoutMs = this.timeoutMs) {
    const previous = new Set(previousSources || []);
    const deadline = Date.now() + timeoutMs;
    do {
      const fresh = (await this._browserImageSources(page)).filter(image => image.src && !previous.has(image.src));
      if (fresh.length) return fresh.at(-1);
      await page.waitForTimeout(1000);
    } while (Date.now() < deadline);
    throw new Error('GEMINI_ANDROID_CDP_IMAGE_TIMEOUT');
  }

  async _captureImageFromBrowser(pageUrl, pageOverride = null, imageSource = '') {
    if (!this.cdpUrl) return null;
    const { chromium } = require('playwright');
    this._cdpBrowser ||= await chromium.connectOverCDP(this.cdpUrl, { timeout: 10000 });
    const context = this._cdpBrowser.contexts()[0];
    if (!context) throw new Error('GEMINI_ANDROID_CDP_CONTEXT_MISSING');
    const page = pageOverride || await this._getBrowserPage(pageUrl);
    if (!page) throw new Error('GEMINI_ANDROID_CDP_PAGE_MISSING');
    const images = await this._browserImageSources(page);
    const image = images.find(candidate => candidate.src === imageSource) || images.at(-1);
    if (!image?.src) throw new Error('GEMINI_ANDROID_CDP_IMAGE_MISSING');
    if (image.src.startsWith('blob:') || image.src.startsWith('data:image/')) {
      const dataUrl = await page.evaluate(source => {
        const found = [];
        const walk = root => {
          for (const element of root.querySelectorAll('*')) {
            if (element.tagName === 'IMG' && element.complete && (element.currentSrc || element.src) === source) found.push(element);
            if (element.shadowRoot) walk(element.shadowRoot);
          }
        };
        walk(document);
        const element = found.at(-1);
        if (!element) return null;
        const canvas = document.createElement('canvas');
        canvas.width = element.naturalWidth;
        canvas.height = element.naturalHeight;
        try {
          canvas.getContext('2d').drawImage(element, 0, 0);
          return canvas.toDataURL('image/png');
        } catch (_error) { return null; }
      }, image.src);
      if (dataUrl) return Buffer.from(dataUrl.split(',')[1], 'base64');
    }
    const response = await context.request.get(image.src, { timeout: 30000 });
    if (!response.ok()) throw new Error('GEMINI_ANDROID_CDP_IMAGE_FETCH_FAILED');
    return response.body();
  }

  async isAvailable() {
    if (!this.enabled) return false;
    if (this._availability === true) return true;
    if (this._availability === false && Date.now() - this._availabilityCheckedAt < this.availabilityRetryMs) return false;
    try {
      this._availability = await this._withDevice(async () => {
        await this._openGemini();
        await this._findEditor(this.probeTimeoutMs);
        return true;
      }, Math.min(this.probeTimeoutMs + 5000, 45000));
    } catch (error) {
      this._availability = false;
      this.logger.warn(`Gemini Android provider unavailable: ${error.message}`);
    }
    this._availabilityCheckedAt = Date.now();
    return this._availability;
  }

  async generateImage(prompt, outputPath, options = {}) {
    if (!this.enabled) throw new Error('GEMINI_ANDROID_PROVIDER_DISABLED');
    return this._withDevice(async () => {
      let stage = 'OPEN';
      try {
        await this._openGemini();
        stage = 'EDITOR';
        const editor = await this._startNewChat();
        stage = 'DOWNLOAD_SCAN';
        const previousNames = new Set(listGeminiDownloads(this.control.shell(['ls', '-1', '/sdcard/Download'], { allowFailure: true })));
        const aspectRatio = imageAspectRatio(options.aspectRatio);
        const portrait = aspectRatio === '9:16';
        const compositionPrompt = portrait
          ? 'Create one high-quality vertical 9:16 portrait editorial still, 1080x1920 composition. Keep the main subject fully visible in the upper two thirds and preserve a visually calm darker lower third for a separate headline overlay.'
          : 'Create one high-quality horizontal 16:9 landscape editorial still, 1920x1080 widescreen composition. Keep the main subject fully visible within the central safe area.';
        const imagePrompt = `${compositionPrompt} No text, letters, logos, labels, signatures or watermark. ${String(prompt || '').trim()}`;
        const browserPage = editor.cdpPage || null;
        const previousBrowserImages = browserPage
          ? (await this._browserImageSources(browserPage)).map(image => image.src)
          : [];
        stage = 'PROMPT';
        if (browserPage && editor.cdpEditor) {
          await this._submitBrowserPrompt(browserPage, editor.cdpEditor, imagePrompt);
          this._hasConversation = true;
        } else {
          this.control.tap(editor.x, editor.y);
          await this.wait(350);
          this.control.inputText(imagePrompt);
          await this.wait(600);
          if (this.control.isKeyboardVisible?.()) {
            this.control.press('BACK');
            await this.wait(350);
          }
          const nodes = await this.control.dumpUi({ timeout: 30000 });
          const editorAfterTyping = nodes.find(node => node.visible !== false
            && /edittext|textbox/i.test(node.className || ''));
          if (!editorAfterTyping) throw new Error('GEMINI_ANDROID_PROMPT_INPUT_FAILED');
          const send = nodes.find(node => node.visible !== false && /^(enviar mensagem|send message)$/i.test((node.text || '').trim()));
          if (send) this.control.tap(send.x, send.y);
          else this.control.press('ENTER');
          this._hasConversation = true;
        }

        stage = 'GENERATE';
        const downloadAction = browserPage ? null : await this._awaitImageDownloadAction();
        const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-android-'));
        const stagedOutput = `${outputPath}.part-${process.pid}`;
        try {
          let imageBuffer = null;
          let browserImage = null;
          if (this.cdpUrl) {
            stage = 'BROWSER_CAPTURE';
            try {
              if (browserPage) {
                browserImage = await this._waitForBrowserImage(browserPage, previousBrowserImages);
                imageBuffer = await this._captureImageFromBrowser(this.activeGeminiUrl, browserPage, browserImage.src);
              } else {
                imageBuffer = await this._captureImageFromBrowser(this.activeGeminiUrl);
              }
            }
            catch (error) { this.logger.warn(`Gemini browser image capture unavailable (${safeErrorTag(error)}); falling back to Android download`); }
          }
          if (!imageBuffer) {
            stage = 'DOWNLOAD';
            if (browserPage && !browserImage) throw new Error('GEMINI_ANDROID_CDP_CAPTURE_FAILED');
            const fallbackDownloadAction = await this._resolveDownloadAction(downloadAction);
            if (!fallbackDownloadAction) throw new Error('GEMINI_ANDROID_CDP_CAPTURE_FAILED');
            this.control.tap(fallbackDownloadAction.x, fallbackDownloadAction.y);
            const downloadedBeforeConfirm = await this._confirmDownload(previousNames);
            const remoteName = downloadedBeforeConfirm || await this._waitForNewDownload(previousNames);
            const remotePath = `/sdcard/Download/${remoteName}`;
            const downloadedPath = path.join(tempDirectory, remoteName);
            stage = 'TRANSFER';
            this.control.run(['pull', remotePath, downloadedPath], { timeout: 120000 });
            imageBuffer = await fs.readFile(downloadedPath);
            this.control.shell(['rm', '-f', '--', remotePath], { allowFailure: true });
          }
          stage = 'VALIDATE';
          const metadata = await sharp(imageBuffer, { failOn: 'warning' }).metadata();
          if (!metadata.width || !metadata.height || metadata.width < 512 || metadata.height < 512) {
            throw new Error('GEMINI_ANDROID_IMAGE_INVALID');
          }
          const aspectMatches = portrait ? closestPortraitRatio(metadata) : closestWideRatio(metadata);
          if (!aspectMatches) throw new Error('GEMINI_ANDROID_IMAGE_ASPECT_MISMATCH');
          stage = 'SAVE';
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await sharp(imageBuffer, { failOn: 'warning' }).png().toFile(stagedOutput);
          await fs.rename(stagedOutput, outputPath);
        } finally {
          await fs.rm(stagedOutput, { force: true }).catch(() => {});
          await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
        }
        return outputPath;
      } catch (error) {
        if (safeErrorTag(error) !== 'Error') throw error;
        const code = `GEMINI_ANDROID_${stage}_FAILED`;
        // Do not retain the raw provider/ADB exception as `cause`; other loggers
        // may serialize it even though this pipeline only emits safeErrorTag.
        throw Object.assign(new Error(code), { code });
      }
    });
  }

  async close() {
    await this._cdpBrowser?.close().catch(() => {});
    this._cdpBrowser = null;
  }
}

module.exports = {
  DOWNLOAD_CONFIRM_TEXT,
  EDITOR_TEXT,
  FIREFOX_PACKAGE,
  GEMINI_URL,
  GeminiAndroidImageGenerator,
  IMAGE_DOWNLOAD_TEXT,
  IMAGE_FILE,
  closestWideRatio,
  closestPortraitRatio,
  imageAspectRatio,
  findEditor,
  hasLoginPrompt,
  hasAndroidAppAnr,
  hasGeminiAppPromo,
  hasTouchableBounds,
  listGeminiDownloads,
  normalized
};
