'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createAndroidEmulatorControl,
  detectAppSession,
  extractAppAccountHandle,
  hasRecentPackageCrash,
  inspectAndroidAppSession,
  parseUiNodes,
  resolvePlatformPackage
} = require('../utils/android-emulator-control');

const xmlNode = (attributes) => `<node ${attributes}/>`;

test('TikTok recovers the observed empty camera, then verifies the own profile', async () => {
  const { emptyTikTokCameraClose } = require('../utils/tiktok-navigation');
  const camera = ['upload_hot_area', 'tx8', 'tv_top_text', 'l4u'].map(resource => ({
    resourceId: `com.zhiliaoapp.musically:id/${resource}`, visible: true, clickable: true, x: 68, y: 196
  }));
  assert(emptyTikTokCameraClose(camera));
  assert.equal(emptyTikTokCameraClose([...camera, { resourceId: 'com.zhiliaoapp.musically:id/h9x' }]), null);
  assert.equal(emptyTikTokCameraClose(camera.slice(0, 2)), null);
  let closed = false;
  const control = {
    isPackageInstalled: async () => true,
    getResumedActivity: () => 'com.zhiliaoapp.musically/Main',
    tap: async (x, y) => { assert.deepEqual([x, y], [68, 196]); closed = true; },
    dumpUi: async () => closed ? [
      { resourceId: 'com.zhiliaoapp.musically:id/t4s', text: '@example_owner' },
      { description: 'Profile menu' }, { description: 'Private videos' }
    ] : camera
  };
  const session = await inspectAndroidAppSession({ control, platform: 'tiktok', timeoutMs: 100 });
  assert.equal(session.status, 'logged_in');
  assert.equal(session.accountHandle, '@example_owner');
});

test('identifica apenas crash recente do pacote lançado, sem interpretar texto privado', async () => {
  const log = '1793119904.505 28715 28715 E AndroidRuntime: Process: com.twitter.android, PID: 28715\n';
  assert.equal(hasRecentPackageCrash(log, 'com.twitter.android', 1793119904000), true);
  assert.equal(hasRecentPackageCrash(log, 'com.twitter.android', 1793119905000), false);
  assert.equal(hasRecentPackageCrash(log, 'com.instagram.android', 1793119904000), false);
  const control = {
    isPackageInstalled: async () => true, getResumedActivity: () => 'other.app/Main',
    getDeviceTimeMs: () => 1793119904000, openApp: () => {}, dumpUi: async () => [],
    hadPackageCrashSince: (pkg, since) => hasRecentPackageCrash(log, pkg, since)
  };
  const session = await inspectAndroidAppSession({ control, platform: 'x', timeoutMs: 500, wait: async () => {} });
  assert.equal(session.status, 'app_crashed');
});

test('Android UI parser decodes text and reads attributes independent of order', () => {
  const nodes = parseUiNodes(`<hierarchy>${xmlNode('bounds="[10,20][110,80]" content-desc="Perfil &amp; conta" clickable="true" class="android.widget.Button" text="In&#237;cio" resource-id="app:id/home" visible-to-user="true" selected="true"')}</hierarchy>`);

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].text, 'Início');
  assert.equal(nodes[0].description, 'Perfil & conta');
  assert.equal(nodes[0].resourceId, 'app:id/home');
  assert.deepEqual([nodes[0].x, nodes[0].y, nodes[0].width, nodes[0].height], [60, 50, 100, 60]);
  assert.equal(nodes[0].clickable, true);
  assert.equal(nodes[0].selected, true);
});

test('session detection fails closed for login prompts and unknown screens', () => {
  assert.equal(detectAppSession('instagram', [{ text: 'Entrar', description: 'Iniciar sessão', visible: true }]), 'login_required');
  assert.equal(detectAppSession('tiktok', [{ text: 'When’s your birthdate?', description: 'To use TikTok, you need to enter your birthdate.', visible: true }]), 'login_required');
  assert.equal(detectAppSession('tiktok', [{ text: 'Para você', description: '', visible: true }]), 'unknown');
  assert.equal(detectAppSession('instagram', [{ text: 'Início', description: '', visible: true }]), 'unknown');
  assert.equal(detectAppSession('instagram', [{ text: 'Reels', description: '', visible: true }]), 'unknown');
  assert.equal(detectAppSession('instagram', [{ text: 'Editar perfil', description: '', visible: true }]), 'logged_in');
  assert.equal(detectAppSession('tiktok', [{ text: 'Edit profile', description: '', visible: true }]), 'logged_in');
  assert.equal(detectAppSession('x', [{ text: 'Home', description: '', visible: true }]), 'unknown');
  assert.equal(detectAppSession('x', [{ text: 'Edit profile', description: '', visible: true }]), 'logged_in');
  assert.equal(detectAppSession('instagram', [{ text: 'Número de telefone', description: '', visible: true }]), 'login_required');
  assert.equal(detectAppSession('telegram', [{ text: 'Chats', description: '', visible: true }]), 'logged_in');
  assert.equal(detectAppSession('x', [{ text: 'Configurações', description: '', visible: true }]), 'unknown');
  assert.equal(detectAppSession('tiktok', [{ text: 'Follow', description: 'Follow', visible: true }]), 'unknown');
  assert.equal(detectAppSession('x', [{ text: 'Home', description: '', visible: false }]), 'unknown');
});

test('Instagram account handle is read only from the observed own-profile title node', () => {
  assert.equal(extractAppAccountHandle('instagram', [
    { text: 'pulso_ai_news', resourceId: 'com.instagram.android:id/action_bar_title', visible: true },
    { text: 'another.user', resourceId: '', visible: true }
  ]), '@pulso_ai_news');
  assert.equal(extractAppAccountHandle('instagram', [
    { text: 'another.user', resourceId: '', visible: true }
  ]), null);
  assert.equal(extractAppAccountHandle('instagram', [
    { text: 'pulso_ai_news', resourceId: 'com.instagram.android:id/action_bar_title', visible: false }
  ]), null);
  assert.equal(extractAppAccountHandle('tiktok', [
    { text: '@pulso_ai_news', resourceId: '', visible: true }
  ]), null, 'unobserved platform selectors stay unknown');
});

test('TikTok own profile requires the observed handle, profile menu and private videos tab', () => {
  const profile = [
    { text: '@example_owner', resourceId: 'com.zhiliaoapp.musically:id/t4s', visible: true },
    { description: 'Profile menu', visible: true },
    { description: 'Private videos', visible: true }
  ];
  assert.equal(detectAppSession('tiktok', profile), 'logged_in');
  assert.equal(extractAppAccountHandle('tiktok', profile), '@example_owner');
  assert.equal(detectAppSession('tiktok', profile.slice(0, 2)), 'unknown');
  assert.equal(extractAppAccountHandle('tiktok', profile.slice(0, 2)), null);
  assert.equal(detectAppSession('tiktok', [{ text: 'Data de nascimento', visible: true }]), 'login_required');
});

test('TikTok session probe enters only the observed complete feed navigation', async () => {
  const feed = ['onh', 'ond', 'oni', 'onj'].map((id, index) => ({
    resourceId: `com.zhiliaoapp.musically:id/${id}`, clickable: true, visible: true, x: index * 144 + 72, y: 1188
  }));
  const profile = [
    { text: '@example_owner', resourceId: 'com.zhiliaoapp.musically:id/t4s', visible: true },
    { description: 'Profile menu', visible: true }, { description: 'Private videos', visible: true }
  ];
  const taps = [];
  let reads = 0;
  const result = await inspectAndroidAppSession({ platform: 'tiktok', timeoutMs: 1000, wait: async () => {}, control: {
    isPackageInstalled: async () => true,
    getResumedActivity: () => 'com.zhiliaoapp.musically/.MainActivity',
    dumpUi: async () => reads++ === 0 ? feed : profile,
    tap: async (x, y) => taps.push([x, y])
  } });
  assert.deepEqual(taps, [[504, 1188]]);
  assert.equal(result.status, 'logged_in');
  assert.equal(result.accountHandle, '@example_owner');
});

test('TikTok probe dismisses the observed avatar introduction before reading the profile', async () => {
  const tip = [
    { text: 'Your avatar, your style', resourceId: 'com.zhiliaoapp.musically:id/bxu', visible: true },
    { resourceId: 'com.zhiliaoapp.musically:id/eb0', clickable: true, visible: true, x: 636, y: 418 }
  ];
  const profile = [
    { text: '@example_owner', resourceId: 'com.zhiliaoapp.musically:id/t4s', visible: true },
    { description: 'Profile menu', visible: true }, { description: 'Private videos', visible: true }
  ];
  let reads = 0;
  const taps = [];
  const result = await inspectAndroidAppSession({ platform: 'tiktok', timeoutMs: 1000, control: {
    isPackageInstalled: async () => true, getResumedActivity: () => 'com.zhiliaoapp.musically/.MainActivity',
    dumpUi: async () => reads++ === 0 ? tip : profile, tap: async (x, y) => taps.push([x, y])
  } });
  assert.deepEqual(taps, [[636, 418]]);
  assert.equal(result.accountHandle, '@example_owner');
});

test('Android session probe opens only installed apps and requires own-profile evidence', async () => {
  let opened = 0;
  let launchActivity = '';
  let reads = 0;
  const control = {
    async isPackageInstalled() { return true; },
    openApp(_packageName, activityName) { opened++; launchActivity = activityName; },
    async dumpUi() {
      reads++;
      return reads === 1
        ? [{ text: '', description: '', visible: true }]
        : [{ text: 'Editar perfil', description: '', visible: true }];
    }
  };
  const session = await inspectAndroidAppSession({ control, platform: 'instagram', timeoutMs: 20, pollIntervalMs: 1, wait: async () => {} });
  assert.equal(session.status, 'logged_in');
  assert.equal(session.packageName, 'com.instagram.android');
  assert.equal(opened, 1);

  const kwai = await inspectAndroidAppSession({
    control: { ...control, async dumpUi() { return [{ text: 'Para você', description: '', visible: true }]; } },
    platform: 'kwai', timeoutMs: 0
  });
  assert.equal(kwai.status, 'logged_in');
  assert.equal(launchActivity, 'kwai.lite.video/com.yxcorp.gifshow.tiny.TinyLaunchActivity');

  const missing = await inspectAndroidAppSession({
    control: { async isPackageInstalled() { return false; }, openApp() { throw new Error('não deve abrir app ausente'); }, dumpUi() { return []; } },
    platform: 'x'
  });
  assert.equal(missing.status, 'app_missing');
});

test('Instagram session probe opens the own profile from its authenticated home feed', async () => {
  let opened = 0;
  let reads = 0;
  const taps = [];
  const navIds = ['feed_tab','clips_tab','direct_tab','search_tab','profile_tab'];
  const homeFeed = navIds.map((id, index) => ({
    resourceId: `com.instagram.android:id/${id}`, clickable: true, visible: true,
    x: 72 + index * 144, y: 1188
  }));
  const ownProfile = [
    { text: 'Edit profile', description: '', visible: true },
    { text: 'pulso_ai_news', resourceId: 'com.instagram.android:id/action_bar_title', visible: true }
  ];
  const session = await inspectAndroidAppSession({
    control: {
      async isPackageInstalled() { return true; },
      openApp() { opened++; },
      async dumpUi() { reads++; return reads === 1 ? homeFeed : ownProfile; },
      tap(x, y) { taps.push([x, y]); }
    },
    platform: 'instagram', timeoutMs: 20, pollIntervalMs: 1, wait: async () => {}
  });

  assert.equal(session.status, 'logged_in');
  assert.equal(session.accountHandle, '@pulso_ai_news');
  assert.equal(opened, 1);
  assert.deepEqual(taps, [[648, 1188]], 'only the observed Instagram Profile tab is opened');
});

test('Instagram session probe leaves an active draft and its confirmation dialog untouched', async () => {
  let taps = 0;
  let reads = 0;
  const control = {
    async isPackageInstalled() { return true; },
    getResumedActivity() { return 'com.instagram.android/com.instagram.android.activity.MainTabActivity'; },
    openApp() { throw new Error('must preserve foreground composer'); },
    async dumpUi() {
      reads++;
      return [
        { resourceId: 'com.instagram.android:id/igds_headline_headline', text: 'Keep editing your draft?', visible: true },
        { resourceId: 'com.instagram.android:id/primary_button', text: 'Keep editing', clickable: true, visible: true },
        { resourceId: 'com.instagram.android:id/profile_tab', clickable: true, visible: true, x: 648, y: 1188 }
      ];
    },
    tap() { taps++; }
  };

  const session = await inspectAndroidAppSession({ control, platform: 'instagram', timeoutMs: 45000 });

  assert.equal(session.status, 'unknown');
  assert.equal(reads, 1, 'draft UI is recognized without waiting for a feed');
  assert.equal(taps, 0, 'session probing never navigates away from the unsaved draft');
});

test('Instagram session probe retorna de Reel próprio para confirmar identidade', async () => {
  let reads = 0;
  const keys = [];
  const result = await inspectAndroidAppSession({ platform: 'instagram', timeoutMs: 1000, wait: async () => {}, control: {
    async isPackageInstalled() { return true; },
    getResumedActivity() { return 'com.instagram.android/com.instagram.android.activity.MainTabActivity'; },
    openApp() { throw new Error('não deve reiniciar a tela'); },
    async dumpUi() { return ++reads === 1 ? [
      { resourceId: 'com.instagram.android:id/clips_viewer_action_bar_title', text: 'Your reels', visible: true },
      { resourceId: 'com.instagram.android:id/clips_author_username', text: 'pulso_ai_news', visible: true }
    ] : [
      { text: 'Edit profile', visible: true },
      { resourceId: 'com.instagram.android:id/action_bar_title', text: 'pulso_ai_news', visible: true }
    ]; },
    async press(key) { keys.push(key); }
  } });
  assert.equal(result.status, 'logged_in');
  assert.equal(result.accountHandle, '@pulso_ai_news');
  assert.deepEqual(keys, ['BACK']);
});

test('Android session probe preserves an already-open social profile for read-only inspection', async () => {
  let opened = 0;
  const result = await inspectAndroidAppSession({
    control: {
      async isPackageInstalled() { return true; },
      getResumedActivity() { return 'com.instagram.android/com.instagram.profile.activity.UserProfileActivity'; },
      openApp() { opened++; },
      async dumpUi() { return [
        { text: 'Edit profile', description: '', visible: true },
        { text: 'pulso_ai_news', resourceId: 'com.instagram.android:id/action_bar_title', visible: true }
      ]; }
    },
    platform: 'instagram',
    timeoutMs: 20
  });
  assert.equal(result.status, 'logged_in');
  assert.equal(result.accountHandle, '@pulso_ai_news');
  assert.equal(opened, 0);
});

test('platform app package names are configurable but validated', () => {
  assert.equal(resolvePlatformPackage('instagram'), 'com.instagram.android');
  assert.equal(resolvePlatformPackage('tiktok', { ANDROID_APP_TIKTOK_PACKAGE: 'com.example.tiktok' }), 'com.example.tiktok');
  assert.throws(() => resolvePlatformPackage('x', { ANDROID_APP_X_PACKAGE: '../../tmp/run' }), /inválido/);
  assert.throws(() => resolvePlatformPackage('facebook'), /não suportada/);
});

test('session probe bounds each hierarchy read by its remaining deadline', async () => {
  let budget;
  const result = await inspectAndroidAppSession({ platform: 'kwai', timeoutMs: 20,
    control: { isPackageInstalled: async () => true, openApp() {},
      dumpUi: async options => { budget = options.timeout; return [{ text: 'Para você', visible: true }]; } }
  });
  assert.equal(result.status, 'logged_in');
  assert.ok(budget > 0 && budget <= 20);
});

test('Kwai session inspection preserves its active composer without treating it as authenticated', async () => {
  let opened = 0;
  const control = { isPackageInstalled: async () => true, openApp() { opened++; },
    getResumedActivity: () => 'kwai.lite.video/com.yxcorp.gifshow.publish.ShareActivity',
    dumpUi: async () => [{ text: 'Describe your post', visible: true }] };
  const session = await inspectAndroidAppSession({ control, platform: 'kwai', timeoutMs: 0 });
  assert.equal(opened, 0);
  assert.equal(session.status, 'unknown');
  await inspectAndroidAppSession({ control: { ...control, getResumedActivity: () => 'kwai.lite.video.other/FakeActivity' },
    platform: 'kwai', timeoutMs: 0 });
  assert.equal(opened, 1, 'only the exact package is preserved');
});

test('Android command wrapper uses argv without a host shell and validates UI actions', () => {
  const calls = [];
  const control = createAndroidEmulatorControl({
    adbPath: '/tmp/mock-adb',
    device: '127.0.0.1:5555',
    runner: (_binary, args) => {
      calls.push(args);
      return args.includes('getprop') ? '1\n' : '';
    }
  });

  assert.equal(control.isBooted(), true);
  control.tap(200, 400);
  control.press('ENTER');
  assert.deepEqual(calls[0], ['-s', '127.0.0.1:5555', 'shell', 'getprop', 'sys.boot_completed']);
  assert.deepEqual(calls[1], ['-s', '127.0.0.1:5555', 'shell', 'input', 'tap', '200', '400']);
  assert.throws(() => control.tap(-1, 2), /coordenadas/);
  assert.throws(() => control.press('CTRL+A'), /não permitida/);
});

test('Android text input uses ADB Keyboard when active and a sanitized Gboard fallback otherwise', () => {
  const calls = [];
  const control = createAndroidEmulatorControl({
    adbPath: '/tmp/mock-adb',
    device: '127.0.0.1:5555',
    runner: (_binary, args) => {
      calls.push(args);
      if (args.includes('default_input_method')) return 'com.android.adbkeyboard/.AdbIME\n';
      if (args.includes('ADB_INPUT_B64')) return 'Broadcast completed: result=0\n';
      return '';
    }
  });

  assert.match(control.inputText('ação teste'), /Broadcast completed/);
  const inputCall = calls.find(args => args.includes('ADB_INPUT_B64'));
  assert.equal(Buffer.from(inputCall.at(-1), 'base64').toString('utf8'), 'ação teste');

  const wrongIme = createAndroidEmulatorControl({
    adbPath: '/tmp/mock-adb',
    runner: (_binary, args) => {
      calls.push(args);
      if (args.includes('default_input_method')) return 'com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME\n';
      return '';
    }
  });
  wrongIme.inputText('ação teste; foo | bar');
  const gboardChunks = () => calls.filter(args => args.at(-2) === 'text' && args.at(-3) === 'input').map(args => args.at(-1));
  assert.deepEqual(gboardChunks(), ['acao%steste%sfoo%sbar']);
  wrongIme.inputText(`${'a'.repeat(50)} café ${'b'.repeat(50)}`);
  const longChunks = gboardChunks().slice(1);
  assert.ok(longChunks.length > 1);
  assert.ok(longChunks.every(chunk => chunk.length <= 32));
  assert.equal(longChunks.join(''), `${'a'.repeat(50)}%scafe%s${'b'.repeat(50)}`);
  assert.throws(() => wrongIme.inputText('😀'), { message: 'GEMINI_ANDROID_TEXT_INPUT_EMPTY' });
});

test('Android emulator control detects a visible keyboard from input_method state', () => {
  const control = createAndroidEmulatorControl({
    adbPath: '/tmp/mock-adb',
    runner: (_binary, args) => args.includes('dumpsys') ? 'mInputShown=true\n' : ''
  });
  assert.equal(control.isKeyboardVisible(), true);
});

test('Android command wrapper resolves ADB from a configured PATH without a host-specific path', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-adb-path-'));
  const adb = path.join(directory, 'adb');
  const calls = [];

  try {
    fs.writeFileSync(adb, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(adb, 0o755);
    const control = createAndroidEmulatorControl({
      device: '127.0.0.1:5555',
      env: { PATH: directory, ANDROID_DEVICE: '127.0.0.1:5555' },
      runner: (binary, args) => {
        calls.push({ binary, args });
        return '1\n';
      }
    });

    assert.equal(control.isBooted(), true);
    assert.equal(calls[0].binary, adb);
    assert.deepEqual(calls[0].args.slice(0, 3), ['-s', '127.0.0.1:5555', 'shell']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
