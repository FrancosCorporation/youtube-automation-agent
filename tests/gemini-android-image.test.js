'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const {
  GeminiAndroidImageGenerator,
  closestWideRatio,
  findEditor,
  GEMINI_URL,
  hasAndroidAppAnr,
  hasGeminiAppPromo,
  hasTouchableBounds,
  hasLoginPrompt,
  listGeminiDownloads
} = require('../utils/gemini-android-image');
const { GeminiImageProvider } = require('../utils/gemini-image-provider');

function makeNode(overrides = {}) {
  return {
    text: '', description: '', hint: '', className: 'android.widget.Button',
    x: 10, y: 10, width: 40, height: 40, visible: true, clickable: true, ...overrides
  };
}

function makeControl({ imageBuffer, login = false } = {}) {
  const state = { typed: false, sent: false, dialog: false, downloaded: false, login, keyboardVisible: true, showPromoAfterSend: false, promo: false, promoDismissed: false, directDownload: false };
  return {
    state,
    isBooted: () => true,
    isKeyboardVisible: () => state.keyboardVisible,
    isPackageInstalled: async () => true,
    getResumedActivity: () => 'org.mozilla.firefox/org.mozilla.fenix.HomeActivity',
    run(args) {
      if (args[0] === 'pull') fs.writeFileSync(args[2], imageBuffer);
      return '';
    },
    shell(args) {
      if (args[0] === 'settings' && args[1] === 'get' && args[2] === 'secure') {
        return 'com.android.adbkeyboard/.AdbIME\n';
      }
      if (args.includes('/sdcard/Download')) return state.downloaded ? 'Gemini_Generated_Image_test.jpg\n' : '';
      return '';
    },
    dumpUi: async () => {
      if (state.login) return [makeNode({ text: 'Sign in', className: 'android.widget.Button' })];
      const nodes = [makeNode({ text: state.typed ? 'Create a premium horizontal 16:9 image for a clean modern semiconductor lab, no text or logo.' : 'Peça ao Gemini', className: 'android.widget.EditText' })];
      if (state.sent && !state.dialog) nodes.push(makeNode({ text: 'Baixar imagem no tamanho original' }));
      if (state.dialog) nodes.push(makeNode({ text: 'Download' }));
      if (state.promo) nodes.push(makeNode({ text: 'Faça mais com o app do Gemini' }));
      return nodes;
    },
    tap(_x, _y) {
      if (state.sent && !state.dialog) {
        if (state.directDownload) state.downloaded = true;
        else state.dialog = true;
      }
      else if (state.dialog) state.downloaded = true;
    },
    inputText() { state.typed = true; return 'Broadcast completed: result=0'; },
    press(key) {
      if (key === 'BACK') state.keyboardVisible = false;
      else {
        state.sent = true;
        if (state.showPromoAfterSend) state.promo = true;
      }
      if (key === 'BACK' && state.promo) {
        state.promo = false;
        state.promoDismissed = true;
      }
    }
  };
}

async function fixtureImage(width, height) {
  return sharp({ create: { width, height, channels: 3, background: '#355577' } }).jpeg().toBuffer();
}

test('normalizes localized UI labels and accepts the real Gemini landscape ratio', () => {
  assert.ok(findEditor([makeNode({ text: 'Peça ao Gemini', className: 'android.widget.EditText' })]));
  assert.ok(findEditor([makeNode({ hint: 'Insira um comando para o Gemini', className: 'android.widget.EditText' })]));
  assert.equal(hasLoginPrompt([makeNode({ text: 'Fazer login' })]), true);
  assert.deepEqual(listGeminiDownloads('Gemini_Generated_Image_abc123.jpg\nnotes.txt\n'), ['Gemini_Generated_Image_abc123.jpg']);
  assert.equal(closestWideRatio({ width: 1376, height: 768 }), true);
  assert.equal(closestWideRatio({ width: 768, height: 1376 }), false);
  assert.equal(hasGeminiAppPromo([makeNode({ text: 'Faça mais com o app do Gemini' })]), true);
  assert.equal(hasTouchableBounds(makeNode({ x: 0, y: 0, width: 0, height: 0 })), false);
  assert.equal(hasTouchableBounds(makeNode({ x: 612, y: 883 })), true);
});

test('prefers the currently visible Gemini tab when Chrome has many Gemini tabs open', async () => {
  const background = { url: () => 'https://gemini.google.com/app', evaluate: async () => false };
  const active = { url: () => 'https://gemini.google.com/app', evaluate: async () => true };
  const provider = new GeminiAndroidImageGenerator({
    cdpUrl: 'http://127.0.0.1:9223',
    env: { GEMINI_ANDROID_FALLBACK: '1' },
    control: makeControl()
  });
  provider._cdpBrowser = { contexts: () => [{ pages: () => [background, active] }] };

  assert.equal(await provider._getBrowserPage(), active);
  assert.equal(provider.activeGeminiUrl, active.url());
});

test('selects only visible Gemini contenteditable nodes, excluding the hidden clipboard', async () => {
  const editor = { async waitFor(options) { assert.equal(options.state, 'visible'); } };
  const page = {
    url: () => 'https://gemini.google.com/app',
    locator(selector) {
      assert.match(selector, /:visible/);
      return { last: () => editor };
    }
  };
  const provider = new GeminiAndroidImageGenerator({
    cdpUrl: 'http://127.0.0.1:9223',
    env: { GEMINI_ANDROID_FALLBACK: '1' },
    control: makeControl()
  });
  provider._getBrowserPage = async () => page;

  assert.deepEqual(await provider._findBrowserEditor(), { cdpPage: page, cdpEditor: editor });
});

test('submits browser prompts through Gemini\'s visible send button instead of Enter', async () => {
  const calls = [];
  const send = {
    last() { return this; },
    async waitFor(options) { calls.push(`wait:${options.state}`); },
    async isDisabled() { return false; },
    async click() { calls.push('send'); }
  };
  const page = {
    getByRole(role, options) {
      assert.equal(role, 'button');
      assert.match(String(options.name), /send message\|enviar mensagem/i);
      return send;
    },
    keyboard: { async press(key) { calls.push(`key:${key}`); } }
  };
  const editor = { async fill(prompt) { calls.push(`fill:${prompt}`); } };
  const provider = new GeminiAndroidImageGenerator({
    env: { GEMINI_ANDROID_FALLBACK: '1' },
    control: makeControl()
  });

  await provider._submitBrowserPrompt(page, editor, 'visual prompt');

  assert.deepEqual(calls, ['fill:visual prompt', 'wait:visible', 'send']);
});

test('resolves the native download action promptly when CDP image capture fails', async () => {
  const provider = new GeminiAndroidImageGenerator({
    env: { GEMINI_ANDROID_FALLBACK: '1' },
    control: makeControl(),
    timeoutMs: 30000,
    probeTimeoutMs: 8000,
    downloadTimeoutMs: 5000
  });
  const action = makeNode({ x: 80, y: 90 });
  let timeoutMs = 0;
  provider._awaitImageDownloadAction = async value => { timeoutMs = value; return action; };

  assert.equal(await provider._resolveDownloadAction(null), action);
  assert.equal(timeoutMs, 8000);
  assert.equal(await provider._resolveDownloadAction(action), action);
  assert.equal(timeoutMs, 8000);
});

test('chooses the visible original-size image action over an empty WebView duplicate', async () => {
  const control = makeControl();
  control.dumpUi = async () => [
    makeNode({ text: 'Baixar imagem no tamanho original', x: 0, y: 0, width: 0, height: 0 }),
    makeNode({ text: 'Baixar imagem no tamanho original', x: 612, y: 883, width: 48, height: 48 })
  ];
  const provider = new GeminiAndroidImageGenerator({
    control,
    env: { GEMINI_ANDROID_FALLBACK: '1' },
    withLock: callback => callback(),
    wait: async () => {},
    pollIntervalMs: 1
  });

  assert.deepEqual(await provider._awaitImageDownloadAction(), {
    ...makeNode({ text: 'Baixar imagem no tamanho original', x: 612, y: 883, width: 48, height: 48 })
  });
});

test('reuses the active Chrome Gemini tab instead of opening another browser tab', async () => {
  const control = makeControl();
  let launches = 0;
  control.getResumedActivity = () => 'com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity';
  const dumpUi = control.dumpUi;
  control.dumpUi = async options => [...await dumpUi(options), makeNode({ text: 'gemini.google.com' })];
  control.run = () => { launches++; };
  const provider = new GeminiAndroidImageGenerator({
    control,
    env: { GEMINI_ANDROID_FALLBACK: '1', GEMINI_ANDROID_BROWSER_PACKAGE: 'com.android.chrome' },
    withLock: callback => callback()
  });

  await provider._openGemini();
  assert.equal(launches, 0);
});

test('shared Android device preserves a social login or unrelated browser page', async () => {
  const control = makeControl();
  let launches = 0;
  control.run = () => { launches++; };
  const provider = new GeminiAndroidImageGenerator({
    control, env: { GEMINI_ANDROID_DEVICE: 'emulator-5560', GEMINI_ANDROID_BROWSER_PACKAGE: 'com.android.chrome' }
  });
  control.getResumedActivity = () => 'com.zhiliaoapp.musically/com.example.LoginActivity';
  await assert.rejects(provider._openGemini(), /GEMINI_ANDROID_SHARED_DEVICE_IN_USE/);
  control.getResumedActivity = () => 'com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity';
  control.dumpUi = async () => [makeNode({ text: 'Continue' })];
  await assert.rejects(provider._openGemini(), /GEMINI_ANDROID_SHARED_BROWSER_IN_USE/);
  control.getResumedActivity = () => '';
  await assert.rejects(provider._openGemini(), /GEMINI_ANDROID_FOREGROUND_UNKNOWN/);
  assert.equal(launches, 0);
});

test('keeps the Android device lock across a whole browser image session', async () => {
  const control = makeControl();
  const owners = [];
  const provider = new GeminiAndroidImageGenerator({
    control,
    env: { GEMINI_ANDROID_FALLBACK: '1' },
    withLock: (callback, options) => { owners.push(options.owner); return callback(); }
  });

  await provider.withDeviceSessionLock(() => provider._withDevice(async () => 'inside session'));
  assert.deepEqual(owners, ['gemini-image-generation-batch']);
  await provider._withDevice(async () => 'single image');
  assert.deepEqual(owners, ['gemini-image-generation-batch', 'gemini-image-generation']);
});

test('blocks Gemini automation when an Android ANR dialog covers the editor', async () => {
  const control = makeControl();
  const dumpUi = control.dumpUi;
  control.dumpUi = async options => [...await dumpUi(options), makeNode({ text: "Instagram isn't responding" })];
  const provider = new GeminiAndroidImageGenerator({
    control,
    env: { GEMINI_ANDROID_FALLBACK: '1' },
    withLock: callback => callback(),
    wait: async () => {},
    probeTimeoutMs: 5000
  });

  assert.equal(hasAndroidAppAnr(await control.dumpUi()), true);
  assert.equal(await provider.isAvailable(), false);
  assert.equal(control.state.typed, false);
});

test('uses Gemini-specific Android device and browser overrides without changing global Android routing', async () => {
  const calls = [];
  const env = {
    GEMINI_ANDROID_DEVICE: 'emulator-5560',
    GEMINI_ANDROID_BROWSER_PACKAGE: 'com.android.chrome',
    ANDROID_DEVICE: '127.0.0.1:5555',
    GEMINI_ANDROID_FALLBACK: '1'
  };
  const provider = new GeminiAndroidImageGenerator({
    env,
    stateDir: '/tmp/gemini-locks',
    autoCdp: false,
    androidOptions: {
      runner: (_exe, args) => {
        calls.push(args);
        if (args.includes('getprop')) return '1\n';
        if (args.includes('pm')) return 'package:/data/app/com.android.chrome/base.apk\n';
        return '';
      }
    }
  });

  assert.equal(provider.control.device, 'emulator-5560');
  assert.equal(provider.browserPackage, 'com.android.chrome');
  assert.equal(provider.lockPath, path.join('/tmp/gemini-locks', 'android-social-emulator-5560.lock'));
  provider.control.getResumedActivity = () => 'com.google.android.apps.nexuslauncher/.NexusLauncherActivity';
  await provider._openGemini();
  assert.deepEqual(calls.find(args => args.includes('am') && args.includes('start')), ['-s', 'emulator-5560', 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', GEMINI_URL, '-p', 'com.android.chrome']);

  const redroidProvider = new GeminiAndroidImageGenerator({
    env: { GEMINI_ANDROID_DEVICE: '127.0.0.1:5555' },
    stateDir: '/tmp/gemini-locks',
    control: makeControl()
  });
  assert.equal(redroidProvider.lockPath, path.join('/tmp/gemini-locks', 'android-social-upload.lock'));
});

test('dismisses the Firefox accessibility tip before probing the Gemini editor', async () => {
  const state = { dismissed: false };
  const control = makeControl();
  const dumpUi = control.dumpUi;
  control.dumpUi = async options => {
    if (!state.dismissed) {
      return [makeNode({
        description: 'Dismiss',
        resourceId: 'cfr.dismiss',
        clickable: true
      })];
    }
    return dumpUi(options);
  };
  control.tap = (x, y) => {
    assert.equal(x, 10);
    assert.equal(y, 10);
    state.dismissed = true;
  };
  const provider = new GeminiAndroidImageGenerator({
    control,
    env: { GEMINI_ANDROID_FALLBACK: '1' },
    withLock: callback => callback(),
    wait: async () => {},
    pollIntervalMs: 1
  });

  const editor = await provider._findEditor(5000);

  assert.equal(state.dismissed, true);
  assert.equal(findEditor([editor]), editor);
});

test('Android Firefox generation downloads, validates and atomically writes a PNG under the shared lock', async () => {
  const imageBuffer = await fixtureImage(1376, 768);
  const control = makeControl({ imageBuffer });
  control.state.showPromoAfterSend = true;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gemini-android-test-'));
  const output = path.join(dir, 'scene.png');
  const locks = [];
  const provider = new GeminiAndroidImageGenerator({
    control,
    env: { GEMINI_ANDROID_FALLBACK: '1' },
    lockPath: path.join(dir, 'android.lock'),
    withLock: (callback, options) => { locks.push(options); return callback(); },
    wait: async () => {},
    pollIntervalMs: 1,
    downloadTimeoutMs: 20,
    timeoutMs: 20
  });
  const result = await provider.generateImage('wide science laboratory scene', output);
  const metadata = await sharp(output).metadata();
  assert.equal(result, output);
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1376);
  assert.equal(metadata.height, 768);
  assert.equal(control.state.downloaded, true);
  assert.equal(control.state.keyboardVisible, false);
  assert.equal(control.state.promoDismissed, true);
  assert.ok(locks.every(lock => lock.owner === 'gemini-image-generation'));
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('Android Chrome generation accepts a direct download without a confirmation dialog', async () => {
  const control = makeControl({ imageBuffer: await fixtureImage(1376, 768) });
  control.state.directDownload = true;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gemini-android-direct-download-'));
  const output = path.join(dir, 'scene.png');
  const provider = new GeminiAndroidImageGenerator({
    control,
    env: { GEMINI_ANDROID_FALLBACK: '1' },
    lockPath: path.join(dir, 'android.lock'),
    withLock: callback => callback(),
    wait: async () => {},
    pollIntervalMs: 1,
    downloadTimeoutMs: 20,
    timeoutMs: 20
  });

  await provider.generateImage('a wide editorial still', output);

  assert.equal(control.state.downloaded, true);
  assert.equal(control.state.dialog, false);
  assert.equal((await sharp(output).metadata()).format, 'png');
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('rejects a portrait image instead of silently cropping the scene', async () => {
  const control = makeControl({ imageBuffer: await fixtureImage(768, 1376) });
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gemini-android-test-'));
  const provider = new GeminiAndroidImageGenerator({
    control,
    env: { GEMINI_ANDROID_FALLBACK: '1' },
    lockPath: path.join(dir, 'android.lock'),
    withLock: callback => callback(),
    wait: async () => {},
    pollIntervalMs: 1,
    downloadTimeoutMs: 20,
    timeoutMs: 20
  });
  await assert.rejects(provider.generateImage('portrait scene', path.join(dir, 'scene.png')), {
    message: 'GEMINI_ANDROID_IMAGE_ASPECT_MISMATCH'
  });
  assert.equal(fs.existsSync(path.join(dir, 'scene.png')), false);
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('maps generic Android failures to a fixed stage tag without exposing the raw message', async () => {
  const control = makeControl({ imageBuffer: await fixtureImage(1376, 768) });
  control.tap = () => { throw new Error('private prompt and device details'); };
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gemini-android-test-'));
  const provider = new GeminiAndroidImageGenerator({
    control,
    env: { GEMINI_ANDROID_FALLBACK: '1' },
    withLock: callback => callback(),
    wait: async () => {},
    pollIntervalMs: 1
  });

  await assert.rejects(provider.generateImage('private prompt', path.join(dir, 'scene.png')), error => {
    assert.equal(error.message, 'GEMINI_ANDROID_PROMPT_FAILED');
    assert.equal(error.code, 'GEMINI_ANDROID_PROMPT_FAILED');
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(error.message, /private prompt|device details/);
    return true;
  });
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('reports Android provider unavailable when Gemini requires sign-in', async () => {
  const provider = new GeminiAndroidImageGenerator({
    control: makeControl({ login: true }),
    env: { GEMINI_ANDROID_FALLBACK: '1' },
    withLock: callback => callback(),
    wait: async () => {},
    probeTimeoutMs: 5000
  });
  assert.equal(await provider.isAvailable(), false);
});

test('rechecks Android availability and recovers after Gemini login becomes valid', async () => {
  const control = makeControl({ login: true });
  const provider = new GeminiAndroidImageGenerator({
    control,
    env: { GEMINI_ANDROID_FALLBACK: '1' },
    withLock: callback => callback(),
    wait: async () => {},
    probeTimeoutMs: 5000,
    availabilityRetryMs: 0
  });
  assert.equal(await provider.isAvailable(), false);
  control.state.login = false;
  assert.equal(await provider.isAvailable(), true);
});

test('image provider selects the configured Android provider and falls back to web after failure', async () => {
  const calls = [];
  const android = {
    isAvailable: async () => true,
    generateImage: async () => { calls.push('android'); throw new Error('android failure'); },
    close: async () => {}
  };
  const web = {
    isAvailable: async () => true,
    generateImage: async (_prompt, output) => { calls.push('web'); return output; },
    close: async () => {}
  };
  const provider = new GeminiImageProvider({ android, web, preferred: 'android' });
  assert.equal(await provider.isAvailable(), true);
  assert.equal(await provider.generateImage('prompt', 'output.png'), 'output.png');
  assert.deepEqual(calls, ['android', 'web']);
  await provider.close();
});

test('a mixed-provider batch does not reserve the Android device while using web', async () => {
  let batchLocked = false;
  const provider = new GeminiImageProvider({
    android: { withDeviceSessionLock: () => { batchLocked = true; throw new Error('unnecessary Android lock'); } },
    web: {}, env: {}
  });
  assert.equal(await provider.withDeviceSessionLock(async () => 'web work'), 'web work');
  assert.equal(batchLocked, false);
});

test('shared Studio CDP is accessed only through the locked Android provider', async () => {
  let webCalls = 0;
  let androidCalls = 0;
  const provider = new GeminiImageProvider({
    env: { YOUTUBE_STUDIO_CDP_URL: 'http://127.0.0.1:9223' },
    web: { cdpUrl: 'http://localhost:9223/', isAvailable: async () => { webCalls++; return true; }, close: async () => {} },
    android: { isAvailable: async () => { androidCalls++; return false; }, close: async () => {} }
  });
  assert.equal(await provider.isAvailable(), false);
  assert.equal(webCalls, 0);
  assert.equal(androidCalls, 1);
  await provider.close();
});
