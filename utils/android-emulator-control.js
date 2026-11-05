'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveExecutable } = require('./resolve-executable');
const { readAndroidHierarchy } = require('./android-ui-hierarchy');
const { emptyTikTokCameraClose } = require('./tiktok-navigation');

const PLATFORM_PACKAGES = Object.freeze({
  tiktok: 'com.zhiliaoapp.musically',
  instagram: 'com.instagram.android',
  x: 'com.twitter.android',
  telegram: 'org.telegram.messenger',
  kwai: 'kwai.lite.video'
});
const PLATFORM_LAUNCH_ACTIVITIES = Object.freeze({
  kwai: 'com.yxcorp.gifshow.tiny.TinyLaunchActivity',
  telegram: 'org.telegram.messenger.DefaultIcon'
});

const LOGIN_TEXT = /\b(log ?in|sign ?in|entrar|iniciar sessao|criar conta|create account|phone number|numero de telefone|continue with|start messaging)\b/i;
const HOME_TEXT = {
  telegram: /\b(chats|mensagens|messages|contatos|contacts|buscar|search)\b/i,
  kwai: /\b(para voce|following|seguindo|curtir|perfil|profile)\b/i
};
// A public feed can be visible without signing in. Only controls shown on the
// current account's own profile count as positive evidence for these apps.
const AUTHENTICATED_PROFILE_TEXT = {
  tiktok: /\b(edit profile|editar perfil|share profile|compartilhar perfil)\b/i,
  instagram: /\b(edit profile|editar perfil|professional dashboard|painel profissional|share profile|compartilhar perfil)\b/i,
  x: /\b(edit profile|editar perfil)\b/i
};
const FIRST_USE_TEXT = {
  tiktok: /\b(?:birthdate|date of birth|birthday|data de nascimento|aniversario)\b/i
};
const PROFILE_HANDLE_RESOURCE_IDS = Object.freeze({
  instagram: 'com.instagram.android:id/action_bar_title',
  tiktok: 'com.zhiliaoapp.musically:id/t4s'
});

const KEY_CODES = Object.freeze({ BACK: '4', HOME: '3', ENTER: '66', TAB: '61', ESCAPE: '111' });
const ADB_KEYBOARD_IME = 'com.android.adbkeyboard/.AdbIME';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function encodeGboardTextChunks(value) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9.,:_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const tokens = [...normalized].map(character => character === ' ' ? '%s' : character);
  const chunks = [];
  let chunk = '';
  for (const token of tokens) {
    if (chunk.length && chunk.length + token.length > 32) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += token;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function decodeAndroidText(value) {
  return String(value || '')
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseUiNodes(xml) {
  const nodes = [];
  for (const match of String(xml || '').matchAll(/<node\b([^>]*)\/?\s*>/g)) {
    const attributes = {};
    for (const attribute of match[1].matchAll(/([\w:-]+)="([^"]*)"/g)) {
      attributes[attribute[1]] = decodeAndroidText(attribute[2]);
    }
    const bounds = String(attributes.bounds || '').match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
    if (!bounds) continue;
    const [, left, top, right, bottom] = bounds.map(Number);
    nodes.push({
      text: attributes.text || '',
      resourceId: attributes['resource-id'] || '',
      className: attributes.class || '',
      description: attributes['content-desc'] || '',
      hint: attributes.hint || '',
      clickable: attributes.clickable === 'true' && attributes.enabled !== 'false',
      visible: attributes['visible-to-user'] !== 'false',
      selected: attributes.selected === 'true',
      checked: attributes.checked === 'true',
      left,
      top,
      right,
      bottom,
      x: Math.floor((left + right) / 2),
      y: Math.floor((top + bottom) / 2),
      width: right - left,
      height: bottom - top
    });
  }
  return nodes;
}

function detectAppSession(platform, nodes) {
  const visible = (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false);
  const text = visible.map(node => `${node.text || ''} ${node.description || ''}`).join(' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!text.trim()) return 'unknown';
  if (FIRST_USE_TEXT[platform]?.test(text)) return 'login_required';
  if (LOGIN_TEXT.test(text)) return 'login_required';
  if (platform === 'tiktok' && isTikTokOwnProfile(visible)) return 'logged_in';
  const accountProfileText = AUTHENTICATED_PROFILE_TEXT[platform];
  if (accountProfileText) return accountProfileText.test(text) ? 'logged_in' : 'unknown';
  return HOME_TEXT[platform]?.test(text) ? 'logged_in' : 'unknown';
}

function isTikTokOwnProfile(nodes) {
  const visible = (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false);
  const hasHandle = visible.some(node => node.resourceId === PROFILE_HANDLE_RESOURCE_IDS.tiktok
    && /^@[a-z\d._]{1,30}$/i.test(String(node.text || '').trim()));
  const hasMenu = visible.some(node => /^(profile menu|menu do perfil)$/i.test(String(node.description || '').trim()));
  const hasPrivate = visible.some(node => /^(private videos|videos privados)$/i.test(String(node.description || node.text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()));
  return hasHandle && hasMenu && hasPrivate;
}

function extractAppAccountHandle(platform, nodes) {
  const resourceId = PROFILE_HANDLE_RESOURCE_IDS[platform];
  if (!resourceId || !Array.isArray(nodes)) return null;
  if (platform === 'tiktok' && !isTikTokOwnProfile(nodes)) return null;
  const node = nodes.find(item => item.visible !== false && item.resourceId === resourceId);
  const match = String(node?.text || node?.description || '').trim().match(/^@?([a-z\d._]{1,30})$/i);
  return match ? `@${match[1].toLowerCase()}` : null;
}

function findTikTokProfileTab(nodes) {
  const visible = (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false && node.clickable);
  const ids = ['onh', 'ond', 'oni', 'onj'].map(id => `com.zhiliaoapp.musically:id/${id}`);
  if (!ids.every(id => visible.some(node => node.resourceId === id))) return null;
  return visible.find(node => node.resourceId === ids[3]) || null;
}

function findInstagramProfileTab(nodes) {
  const navIds = ['feed_tab', 'clips_tab', 'direct_tab', 'search_tab', 'profile_tab']
    .map(name => `com.instagram.android:id/${name}`);
  const visible = (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false);
  if (!navIds.every(id => visible.some(node => node.resourceId === id && node.clickable))) return null;
  return visible.find(node => node.resourceId === 'com.instagram.android:id/profile_tab' && node.clickable) || null;
}

function resolvePlatformPackage(platform, env = process.env) {
  const key = String(platform || '').toLowerCase();
  if (!Object.hasOwn(PLATFORM_PACKAGES, key)) throw new Error(`plataforma Android não suportada: ${key || '(vazia)'}`);
  const overrideName = `ANDROID_APP_${key.toUpperCase()}_PACKAGE`;
  const packageName = String(env[overrideName] || PLATFORM_PACKAGES[key]).trim();
  if (!/^[A-Za-z][A-Za-z\d_]*(?:\.[A-Za-z][A-Za-z\d_]*)+$/.test(packageName)) {
    throw new Error(`nome de pacote Android inválido para ${key}`);
  }
  return packageName;
}

function parseResumedActivity(output) {
  const match = String(output || '').match(/topResumedActivity=ActivityRecord\{[^}]*\s([^\s]+)\s+t\d+\}/)
    || String(output || '').match(/ResumedActivity:\s*ActivityRecord\{[^}]*\s([^\s]+)\s+t\d+\}/);
  return match?.[1] || null;
}

function hasRecentPackageCrash(log, packageName, sinceMs) {
  if (!Number.isFinite(sinceMs)) return false;
  return String(log || '').split(/\r?\n/).some(line => {
    const match = line.match(/^\s*(\d+(?:\.\d+)?)\s+\d+\s+\d+\s+E\s+AndroidRuntime:\s+Process:\s+([A-Za-z0-9_.]+),\s*PID:/);
    return Boolean(match && Number(match[1]) * 1000 >= sinceMs && match[2] === packageName);
  });
}

async function inspectAndroidAppSession({ control, platform, timeoutMs = 45000, pollIntervalMs = 1500, wait = sleep } = {}) {
  if (!control || typeof control.isPackageInstalled !== 'function' || typeof control.dumpUi !== 'function') {
    throw new TypeError('controle Android inválido');
  }
  const packageName = resolvePlatformPackage(platform);
  const installed = await control.isPackageInstalled(packageName);
  if (!installed) return { platform, packageName, status: 'app_missing' };

  const activityClass = PLATFORM_LAUNCH_ACTIVITIES[platform];
  const resumed = typeof control.getResumedActivity === 'function'
    ? await control.getResumedActivity() : null;
  let launchTimeMs = null;
  // Preserve the exact foreground screen when already inside this app. This
  // keeps own-profile evidence inspectable and avoids replacing a Kwai draft.
  // An active composer still returns unknown; only its artifact-bound handler
  // is allowed to recover that state after this read-only inspection.
  if (!resumed?.startsWith(packageName + '/')) {
    if (typeof control.getDeviceTimeMs === 'function') launchTimeMs = await control.getDeviceTimeMs();
    control.openApp(packageName, activityClass ? `${packageName}/${activityClass}` : '');
  }
  const deadline = Date.now() + Math.max(0, Number(timeoutMs));
  let status = 'unknown';
  let profileTabTapped = false;
  let profileContentBackPressed = false;
  let emptyCameraClosed = false;
  do {
    const nodes = await control.dumpUi({ timeout: Math.max(1, deadline - Date.now()) });
    const cameraClose = platform === 'tiktok' && !emptyCameraClosed && emptyTikTokCameraClose(nodes);
    if (cameraClose && typeof control.tap === 'function') {
      emptyCameraClosed = true;
      await control.tap(cameraClose.x, cameraClose.y);
      continue; // Reinspect the own profile; a camera is not authentication proof.
    }
    const tiktokAvatarTip = platform === 'tiktok' && nodes.some(node => node.visible !== false
      && node.resourceId === 'com.zhiliaoapp.musically:id/bxu'
      && /^your avatar, your style$/i.test(String(node.text || '').trim()));
    if (tiktokAvatarTip && typeof control.tap === 'function') {
      const close = nodes.find(node => node.visible !== false && node.clickable
        && node.resourceId === 'com.zhiliaoapp.musically:id/eb0');
      if (!close) return { platform, packageName, status: 'unknown' };
      await control.tap(close.x, close.y);
      continue;
    }
    const instagramDraftUi = platform === 'instagram' && nodes.some(node => node.visible !== false
      && (node.resourceId === 'com.instagram.android:id/caption_input_text_view'
        || /keep editing your draft\?|this draft will be saved/i.test(`${node.text || ''} ${node.description || ''}`)));
    // A composer or unsaved-draft dialog must be inspected without tapping the
    // profile tab: navigation there prompts Instagram to discard/resume edits.
    if (instagramDraftUi) return { platform, packageName, status: 'unknown' };
    const instagramOwnReel = platform === 'instagram' && nodes.some(node => node.visible !== false
      && node.resourceId === 'com.instagram.android:id/clips_viewer_action_bar_title'
      && /^(your reels|seus reels)$/i.test(String(node.text || '').trim()))
      && nodes.some(node => node.visible !== false
        && node.resourceId === 'com.instagram.android:id/clips_author_username');
    const instagramPostViewer = platform === 'instagram' && nodes.some(node => node.visible !== false
      && node.resourceId === 'com.instagram.android:id/action_bar_title'
      && /^(posts|publica[cç][oõ]es)$/i.test(String(node.text || '').trim()))
      && nodes.some(node => node.visible !== false && node.resourceId === 'com.instagram.android:id/row_feed_profile_header')
      && nodes.some(node => node.visible !== false && node.clickable
        && node.resourceId === 'com.instagram.android:id/action_bar_button_back');
    // A saved post viewer has no profile tab. Return once, then require the
    // actual own-profile controls and handle; a post's author is not identity.
    if ((instagramOwnReel || instagramPostViewer) && !profileContentBackPressed && typeof control.press === 'function') {
      profileContentBackPressed = true;
      await control.press('BACK');
      continue;
    }
    if (Number.isFinite(launchTimeMs) && typeof control.hadPackageCrashSince === 'function'
      && await control.hadPackageCrashSince(packageName, launchTimeMs)) {
      return { platform, packageName, status: 'app_crashed' };
    }
    status = detectAppSession(platform, nodes);
    if (status !== 'unknown') {
      const accountHandle = status === 'logged_in' ? extractAppAccountHandle(platform, nodes) : null;
      return { platform, packageName, status, ...(accountHandle ? { accountHandle } : {}) };
    }
    if (platform === 'instagram' && !profileTabTapped && typeof control.tap === 'function') {
      const profileTab = findInstagramProfileTab(nodes);
      if (profileTab) {
        profileTabTapped = true;
        await control.tap(profileTab.x, profileTab.y);
      }
    }
    if (platform === 'tiktok' && !profileTabTapped && typeof control.tap === 'function') {
      const profileTab = findTikTokProfileTab(nodes);
      if (profileTab) {
        profileTabTapped = true;
        await control.tap(profileTab.x, profileTab.y);
      }
    }
    if (Date.now() >= deadline) break;
    await wait(Math.min(pollIntervalMs, deadline - Date.now()));
  } while (Date.now() <= deadline);
  return { platform, packageName, status: 'unknown' };
}

function createAndroidEmulatorControl(options = {}) {
  const env = options.env || process.env;
  const localAdb = path.join(os.homedir(), '.local', 'bin', 'adb');
  const adbPath = options.adbPath || env.ADB_PATH || resolveExecutable('adb', env) || resolveExecutable(localAdb, env) || 'adb';
  const device = options.device || env.ANDROID_DEVICE || '127.0.0.1:5555';
  const runner = options.runner || execFileSync;
  if (!/^[\w.:-]+$/.test(device)) throw new Error('identificador do emulador Android inválido');

  function run(args, { timeout = 30000, allowFailure = false, encoding = 'utf8' } = {}) {
    try {
      return runner(adbPath, ['-s', device, ...args.map(String)], {
        encoding,
        timeout,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 4 * 1024 * 1024
      });
    } catch (error) {
      if (allowFailure) return error.stdout || (encoding === 'buffer' ? Buffer.alloc(0) : '');
      throw error;
    }
  }

  const shell = (args, options) => run(['shell', ...args], options);

  return {
    device,
    run,
    shell,
    getResumedActivity() {
      return parseResumedActivity(shell(['dumpsys', 'activity', 'activities'], { timeout: 20000 }));
    },
    getDeviceTimeMs() {
      const value = Number(String(shell(['date', '+%s%3N'], { allowFailure: true })).trim());
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    },
    hadPackageCrashSince(packageName, sinceMs) {
      const log = shell(['logcat', '-b', 'crash', '-d', '-v', 'epoch', '-t', '500', '-s', 'AndroidRuntime:E'], { allowFailure: true });
      return hasRecentPackageCrash(log, packageName, sinceMs);
    },
    isBooted() {
      return String(shell(['getprop', 'sys.boot_completed'], { allowFailure: true, timeout: 5000 })).trim() === '1';
    },
    isKeyboardVisible() {
      const output = String(shell(['dumpsys', 'input_method'], { allowFailure: true }));
      return /\bmInputShown=true\b/.test(output);
    },
    async isPackageInstalled(packageName) {
      const output = String(shell(['pm', 'path', packageName], { allowFailure: true }));
      return output.split(/\r?\n/).some(line => line.startsWith('package:'));
    },
    openApp(packageName, activityName = '') {
      if (!/^[A-Za-z][A-Za-z\d_]*(?:\.[A-Za-z][A-Za-z\d_]*)+$/.test(packageName)) {
        throw new Error('nome de pacote Android inválido');
      }
      if (activityName) {
        if (!/^[A-Za-z][A-Za-z\d_]*(?:\.[A-Za-z][A-Za-z\d_]*)+\/[A-Za-z\d_.$]+$/.test(activityName)) {
          throw new Error('nome de activity Android inválido');
        }
        return shell(['am', 'start', '-n', activityName], { timeout: 30000 });
      }
      return shell(['monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'], { timeout: 30000 });
    },
    pushVideo(videoPath, platform) {
      const filePath = String(videoPath || '');
      const target = String(platform || '').toLowerCase();
      if (!/^[a-z0-9_-]+$/.test(target)) throw new Error('destino Android inválido para o vídeo');
      if (!fs.statSync(filePath).isFile()) throw new Error('arquivo de vídeo não encontrado');
      if (!/\.mp4$/i.test(filePath)) throw new Error('o emulador espera vídeo MP4 validado');
      const remote = `/sdcard/Movies/pulso_${target}_${Date.now()}.mp4`;
      shell(['mkdir', '-p', '/sdcard/Movies']);
      run(['push', filePath, remote], { timeout: 300000 });
      shell(['am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${remote}`], { timeout: 30000 });
      return remote;
    },
    dumpUi({ timeout = 30000 } = {}) {
      return parseUiNodes(readAndroidHierarchy({ adbPath, device, timeoutMs: timeout, env, runner }));
    },
    tap(x, y) {
      const horizontal = Number(x);
      const vertical = Number(y);
      if (!Number.isInteger(horizontal) || !Number.isInteger(vertical) || horizontal < 0 || vertical < 0) {
        throw new Error('coordenadas de toque inválidas');
      }
      return shell(['input', 'tap', horizontal, vertical]);
    },
    press(key) {
      const code = KEY_CODES[String(key || '').toUpperCase()];
      if (!code) throw new Error(`tecla Android não permitida: ${key}`);
      return shell(['input', 'keyevent', code]);
    },
    inputText(value) {
      const activeIme = String(shell(['settings', 'get', 'secure', 'default_input_method'], { allowFailure: true })).trim();
      if (activeIme === ADB_KEYBOARD_IME) {
        const encoded = Buffer.from(String(value || ''), 'utf8').toString('base64');
        const result = String(shell(['am', 'broadcast', '-a', 'ADB_INPUT_B64', '--es', 'msg', encoded]));
        if (!result.includes('Broadcast completed')) throw new Error('GEMINI_ANDROID_TEXT_INPUT_FAILED');
        return result;
      }

      const chunks = encodeGboardTextChunks(value);
      if (!chunks.length) throw new Error('GEMINI_ANDROID_TEXT_INPUT_EMPTY');
      let result = '';
      for (const chunk of chunks) result = shell(['input', 'text', chunk]);
      return result;
    },
    screenshot() {
      return run(['exec-out', 'screencap', '-p'], { timeout: 30000, encoding: 'buffer' });
    }
  };
}

module.exports = {
  PLATFORM_PACKAGES,
  PLATFORM_LAUNCH_ACTIVITIES,
  createAndroidEmulatorControl,
  decodeAndroidText,
  detectAppSession,
  extractAppAccountHandle,
  findInstagramProfileTab,
  hasRecentPackageCrash,
  inspectAndroidAppSession,
  parseUiNodes,
  parseResumedActivity,
  resolvePlatformPackage
};
