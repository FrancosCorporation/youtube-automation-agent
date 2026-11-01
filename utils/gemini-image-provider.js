'use strict';

const { GeminiAndroidImageGenerator } = require('./gemini-android-image');
const { GeminiWebImageGenerator } = require('./gemini-web-image');
const studioConfig = require('../config/youtube-studio.json');

function sameCdpEndpoint(first, second) {
  if (!first || !second) return false;
  try {
    const canonical = value => {
      const url = new URL(value);
      const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
      return `${url.protocol}//${host}:${url.port || (url.protocol === 'https:' ? '443' : '80')}${url.pathname.replace(/\/$/, '')}`;
    };
    return canonical(first) === canonical(second);
  } catch { return false; }
}

class GeminiImageProvider {
  constructor(options = {}) {
    const env = options.env || process.env;
    const androidEnabled = options.androidEnabled ?? env.GEMINI_ANDROID_FALLBACK !== '0';
    this.android = options.android || (androidEnabled ? new GeminiAndroidImageGenerator(options.androidOptions) : null);
    this.web = options.web || new GeminiWebImageGenerator(options.webOptions || {});
    const preferred = String(options.preferred || env.GEMINI_IMAGE_PROVIDER || 'web').toLowerCase();
    // The web provider has no Android device lock and can navigate the shared
    // Chrome while Studio is uploading. The Android provider already owns that
    // lock and checks the foreground screen; use it for this endpoint instead.
    const sharedStudioBrowser = sameCdpEndpoint(this.web.cdpUrl, env.YOUTUBE_STUDIO_CDP_URL || studioConfig.cdpUrl);
    const safeWeb = sharedStudioBrowser ? null : this.web;
    this.providers = preferred === 'android' ? [this.android, safeWeb] : [safeWeb, this.android];
    this.providers = this.providers.filter(Boolean);
    this.active = null;
  }

  async isAvailable() {
    for (const provider of this.providers) {
      try {
        if (await provider.isAvailable()) {
          this.active = provider;
          return true;
        }
      } catch (_error) { /* try the next configured provider */ }
    }
    this.active = null;
    return false;
  }

  async generateImage(prompt, outputPath, options = {}) {
    if (!this.active && !await this.isAvailable()) throw new Error('visual_image_provider_unavailable');
    const attempted = new Set();
    let lastError;
    for (const provider of [this.active, ...this.providers.filter(item => item !== this.active)]) {
      if (!provider || attempted.has(provider)) continue;
      attempted.add(provider);
      try {
        if (provider !== this.active && !await provider.isAvailable()) continue;
        this.active = provider;
        return await provider.generateImage(prompt, outputPath, options);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('visual_image_provider_unavailable');
  }

  withDeviceSessionLock(callback) {
    // Android operations acquire the device lock themselves. Holding it for
    // the entire mixed-provider batch blocks social login even while a web
    // provider is being probed or used; release it between Android operations.
    return callback();
  }

  async close() {
    await Promise.all(this.providers.map(provider => Promise.resolve(provider.close?.()).catch(() => {})));
    this.active = null;
  }
}

module.exports = { GeminiImageProvider, sameCdpEndpoint };
