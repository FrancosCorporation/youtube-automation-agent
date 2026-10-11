const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const { Logger } = require('./logger');

/**
 * Gemini Web image provider — generates images through gemini.google.com using a
 * persistent Playwright/Chromium profile, for accounts whose Gemini API key has
 * no free-tier image quota.
 *
 * One-time setup: run `npm run gemini-login` (opens a visible browser, sign in
 * with the Google account). The profile is reused afterwards, headless.
 *
 * Env:
 *   GEMINI_WEB=0                 disable the provider entirely
 *   GEMINI_WEB_HEADLESS=0        show the browser while generating (debug)
 *   GEMINI_WEB_TIMEOUT_MS=120000 per-image generation timeout
 */
class GeminiWebImageGenerator {
  constructor(options = {}) {
    this.logger = options.logger || new Logger('GeminiWebImage');
    this.profileDir = options.profileDir || path.join(__dirname, '..', 'data', 'browser-profiles', 'gemini');
    this.headless = options.headless ?? (process.env.GEMINI_WEB_HEADLESS !== '0');
    this.timeoutMs = Math.max(15000, Number(options.timeoutMs || process.env.GEMINI_WEB_TIMEOUT_MS || 120000));
    this.enabled = process.env.GEMINI_WEB !== '0';
    this._flashForced = false;
    this._context = null;
    this._available = null;
  }

  async _ensureContext() {
    if (this._context) return this._context;
    const { chromium } = require('playwright');
    this._context = await chromium.launchPersistentContext(this.profileDir, {
      headless: this.headless,
      viewport: { width: 1600, height: 1000 },
      args: ['--disable-blink-features=AutomationControlled']
    });
    return this._context;
  }

  // Reuse one conversation tab across generations: navigating /app from scratch
  // for every image made Gemini throttle subsequent generations into timeouts.
  async _conversationPage() {
    if (this._page && !this._page.isClosed()) return this._page;
    let context = await this._ensureContext();
    try {
      this._page = await context.newPage();
    } catch (_error) {
      // The persistent context died (crash under memory pressure) — relaunch
      // it once with the same logged-in profile and try again.
      this._context = null;
      await this.close();
      context = await this._ensureContext();
      this._page = await context.newPage();
      this.logger.info('Gemini web: contexto do browser relançado após crash');
    }
    await this._page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
    return this._page;
  }

  _editorSelectors() {
    return [
      'div.ql-editor[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]'
    ];
  }

  async _waitForEditor(page) {
    for (const selector of this._editorSelectors()) {
      try {
        const editor = await page.waitForSelector(selector, { timeout: 5000, state: 'visible' });
        if (editor) return editor;
      } catch (_error) { /* try the next selector */ }
    }
    throw new Error('GEMINI_WEB_NOT_LOGGED_IN');
  }

  // Model choice is per-conversation: every new chat starts on "Pro" (or worse,
  // Flash-Lite), so this runs before every prompt.
  async _forceFlashModel(page) {
    try {
      const picker = page.locator('button[aria-label*="seletor de modo" i], button[aria-label*="mode selector" i]').first();
      let label = '';
      try {
        label = (await picker.getAttribute('aria-label', { timeout: 6000 })) || '';
      } catch (_e) {
        return; // no picker on screen — nothing to select
      }
      if (/nano banana|imagen/i.test(label)) return;
      // "No momento: 3.6 Flash" / "Currently: Flash" — already image-capable.
      if (/flash(?![-\s]?lite)/i.test(label)) return;
      await picker.click({ timeout: 5000 });
      await page.waitForTimeout(800);
      // Nano Banana / Imagen primeiro, depois Flash (Lite não gera imagem).
      // Só aceita quando o rótulo CONFIRMA que saiu do Lite — senão tenta o próximo.
      const candidates = [
        page.getByRole('menuitem', { name: /nano\s*banana/i }).first(),
        page.getByRole('menuitem', { name: /imagen/i }).first(),
        page.getByRole('menuitem', { name: /flash/i }).filter({ hasNotText: /lite/i }).first()
      ];
      for (const item of candidates) {
        try {
          await item.click({ timeout: 3500 });
          await page.waitForTimeout(900);
          const now = (await picker.getAttribute('aria-label').catch(() => '')) || '';
          this.logger.info(`Gemini web: modo após seleção — ${now.replace(/^.*?:\s*/, '').slice(0, 40)}`);
          if (!/flash[-\s]?lite/i.test(now)) return;
        } catch (_e) { /* próximo candidato */ }
      }
    } catch (_error) { /* keep whatever model is selected */ }
  }

  async isAvailable() {
    if (this._available !== null) return this._available;
    if (!this.enabled) { this._available = false; return false; }

    // Hard cap: availability probing must never stall the video pipeline.
    const probe = (async () => {
      const page = await this._conversationPage();
      await this._waitForEditor(page);
      // An anonymous Gemini session shows a "Sign in" entry point and cannot
      // generate images — require an authenticated profile instead.
      const signIn = await page.getByRole('link', { name: /sign in|entrar|fazer login/i }).first().isVisible().catch(() => false)
        || await page.getByRole('button', { name: /sign in|entrar|fazer login/i }).first().isVisible().catch(() => false);
      if (signIn) throw new Error('GEMINI_WEB_NOT_LOGGED_IN');
    })();

    const cap = new Promise((_, reject) => setTimeout(() => reject(new Error('availability probe timed out')), 45000));

    try {
      await Promise.race([probe, cap]);
      this._available = true;
    } catch (error) {
      this._available = false;
      this.logger.warn(`Gemini web provider unavailable: ${error.message === 'GEMINI_WEB_NOT_LOGGED_IN'
        ? 'not signed in — run `npm run gemini-login` once to authenticate the browser profile'
        : error.message}`);
      await this.close();
    }
    return this._available;
  }

  async generateImage(prompt, outputPath) {
    if (!await this.isAvailable()) throw new Error('Gemini web provider is not available');

    const page = await this._conversationPage();
    try {
      // Each image needs its own conversation — but only click "New chat" when
      // the session already produced one (fresh loads already start clean).
      if (this._hasConversation) {
        const newChat = page.getByRole('link', { name: /nova conversa|new chat/i }).first();
        if (await newChat.isVisible().catch(() => false)) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
            newChat.click().catch(() => {})
          ]);
          this._hasConversation = false;
        }
      }
      await this._waitForEditor(page);
      // The account may default to the "Pro" (thinking) model, which takes
      // minutes per image. Force "Flash" so each image takes ~20-40s.
      await this._forceFlashModel(page);
      await page.waitForTimeout(1000); // let the chat UI settle before typing

      // Snapshot existing images so we only accept NEW generated ones.
      const before = await page.$$eval('img', imgs => imgs.map(i => i.src)).catch(() => []);

      // Insert the prompt as text — the React/Quill editor re-renders on every
      // keystroke, so typing char-by-char would detach the element mid-typing.
      const fullPrompt = `Create one high-quality 16:9 photorealistic cinematic documentary still, premium editorial photography, believable natural lighting, lifelike faces and materials, crisp subject focus, rich environmental detail. Match the topic and color direction in the prompt; do not add generic technology motifs unless requested. Absolutely NO text, NO letters, NO numbers, NO watermarks inside the image: ${prompt}`;
      let typed = await page.evaluate(text => {
        const editorEl = document.querySelector('div.ql-editor[contenteditable="true"], rich-textarea div[contenteditable="true"], div[contenteditable="true"][role="textbox"], div[contenteditable="true"]');
        if (!editorEl) return false;
        editorEl.focus();
        document.execCommand('insertText', false, text);
        return (editorEl.innerText || '').trim().length > 10;
      }, fullPrompt);
      if (!typed) {
        // Editor re-rendered mid-insert — fall back to keyboard typing.
        const editorEl = await this._waitForEditor(page);
        await editorEl.click();
        await page.keyboard.type(fullPrompt, { delay: 6 });
        typed = await page.evaluate(() => {
          const e = document.querySelector('div[contenteditable="true"]');
          return !!(e && (e.innerText || '').trim().length > 10);
        });
      }
      if (!typed) throw new Error('Gemini web editor not ready for the prompt');
      await page.waitForTimeout(300);
      await page.keyboard.press('Enter');
      this._hasConversation = true;

      // Poll for a newly appeared, reasonably sized image in the response.
      const started = Date.now();
      let src = null;
      while (Date.now() - started < this.timeoutMs) {
        if (await page.getByText(/sign in|fazer login|entrar/i).first().isVisible().catch(() => false)
          && !await page.$('div[contenteditable="true"]')) {
          throw new Error('GEMINI_WEB_NOT_LOGGED_IN');
        }
        const candidates = await page.$$eval('img[src*="googleusercontent"], img[src^="blob:"], img[src^="data:image"]', imgs =>
          imgs.filter(i => i.complete && i.naturalWidth >= 256).map(i => i.src)
        ).catch(() => []);
        const fresh = candidates.filter(url => url && !before.includes(url));
        if (fresh.length) { src = fresh[fresh.length - 1]; break; }
        await page.waitForTimeout(2000);
      }
      if (!src) throw new Error('Gemini web did not return a generated image in time');

      let buffer;
      if (src.startsWith('data:image')) {
        buffer = Buffer.from(src.split(',')[1], 'base64');
      } else if (src.startsWith('blob:')) {
        // Blob URLs belong to the page's blob store: fetch() can fail when the
        // image lives under a nested document. Draw into a canvas instead, and
        // fall back to an element screenshot if the canvas is tainted.
        const dataUrl = await page.evaluate(source => {
          const img = Array.from(document.querySelectorAll('img')).find(el => el.src === source);
          if (!img || !img.naturalWidth) return null;
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          try {
            canvas.getContext('2d').drawImage(img, 0, 0);
            return canvas.toDataURL('image/png');
          } catch (_error) { return null; }
        }, src).catch(() => null);
        if (dataUrl) {
          buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
        } else {
          const escaped = src.replace(/["\\]/g, '\\$&');
          const element = await page.$(`img[src="${escaped}"]`);
          if (element) buffer = await element.screenshot({ type: 'png' });
        }
        if (!buffer) throw new Error('Gemini web image extraction failed (blob)');
      } else {
        // context.request shares the profile cookies and bypasses CORS. Some
        // Gemini image URLs still reject that request with 403 even though
        // Chromium has already loaded the image; capture the rendered element
        // in that case instead of dropping an otherwise usable image.
        const response = await page.context().request.get(src, { timeout: 60000 });
        if (response.ok()) {
          buffer = await response.body();
        } else {
          const imageHandle = await page.evaluateHandle(target =>
            Array.from(document.images).find(image => image.src === target) || null, src);
          const imageElement = imageHandle.asElement();
          if (imageElement && await imageElement.evaluate(image => image.complete && image.naturalWidth >= 256)) {
            buffer = await imageElement.screenshot({ type: 'png' });
            this.logger.warn(`Gemini web image download returned ${response.status()}; saved the rendered image instead`);
          }
          await imageHandle.dispose().catch(() => {});
          if (!buffer) throw new Error(`Gemini web image download failed: ${response.status()}`);
        }
      }

      const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
      if (!metadata.width || !metadata.height) throw new Error('Gemini web returned an invalid image');
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await sharp(buffer).png().toFile(outputPath);

      // Be polite with the consumer UI between generations.
      await page.waitForTimeout(1500);
      return outputPath;
    } catch (error) {
      // A failed generation may leave the chat in a bad state — drop the tab
      // so the next attempt starts from a fresh conversation page.
      await page.close().catch(() => {});
      this._page = null;
      throw error;
    }
  }

  async close() {
    if (this._context) {
      await Promise.race([
        this._context.close().catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 10000))
      ]);
    }
    this._context = null;
    this._page = null;
  }
}

module.exports = { GeminiWebImageGenerator };
