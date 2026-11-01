#!/usr/bin/env node
/**
 * Emulador Android do Kwai (redroid), usado apenas para uploads.
 * O serviço de boot o prepara depois que Docker fica pronto; o uploader pode
 * derrubá-lo ao terminar para devolver RAM. A geração de vídeo roda no host.
 *
 * O Kwai removeu o upload web (/upload = 404); publicar só pelo app.
 * App: com.kwai.video instalado no volume kwai-data (login persiste entre ciclos).
 *
 * CLI:
 *   node scripts/kwai-emulator.js up       — sobe emulador + conecta adb
 *   node scripts/kwai-emulator.js start-container — inicia o container, sem aguardar Android
 *   node scripts/kwai-emulator.js down     — derruba emulador (libera RAM)
 *   node scripts/kwai-emulator.js status   — estado (container, adb, app, login)
 *   node scripts/kwai-emulator.js login    — sobe + abre app sem navegador no host
 *   node scripts/kwai-emulator.js confirm  — marca app como logado (flag)
 *   node scripts/kwai-emulator.js test     — digita texto de teste (teclado ADB)
 *
 * Módulo: const kwai = require('./kwai-emulator')
 *   await kwai.acquire() / kwai.release()  — refcount: sobe no 1º uso, derruba no último
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveExecutable } = require('../utils/resolve-executable');
const { ensureAndroidBooted } = require('../utils/android-emulator-bootstrap');
const { withAndroidDeviceLock } = require('../utils/android-device-lock');
const { sha256StableRegularFile } = require('../utils/video-qa-manifest');
const { withProcessFileLock, processIsAlive } = require('../utils/process-file-lock');
const { kwaiStagingAlbumName } = require('../utils/kwai-upload-flow');
const { readAndroidHierarchy } = require('../utils/android-ui-hierarchy');
const { parseUiNodes, parseResumedActivity } = require('../utils/android-emulator-control');

const ROOT = path.join(__dirname, '..');
const COMPOSE = path.join(ROOT, 'docker-compose.kwai.yml');
const localAdb = path.join(os.homedir(), '.local', 'bin', 'adb');
const ADB = process.env.ADB_PATH || resolveExecutable('adb') || resolveExecutable(localAdb) || 'adb';
const DEVICE = process.env.ANDROID_DEVICE || '127.0.0.1:5555';
if (!/^\/?[A-Za-z0-9_./-]+$/.test(ADB)) throw new Error('ADB_PATH contém caracteres não permitidos');
if (!/^[\w.:-]+$/.test(DEVICE)) throw new Error('ANDROID_DEVICE inválido');
// Kwai LITE (kwai.lite.video) — instalado via Play Store, logado com a conta
// Google. Mais leve que o Kwai completo = roda liso no emulador x86 (o completo
// fica preso em "resource downloading" + diálogo de update no servidor).
const PACKAGE = process.env.KWAI_PACKAGE || process.env.ANDROID_APP_KWAI_PACKAGE || 'kwai.lite.video';
if (!/^[A-Za-z][A-Za-z\d_]*(?:\.[A-Za-z][A-Za-z\d_]*)+$/.test(PACKAGE)) throw new Error('KWAI_PACKAGE inválido');
const ACTIVITY = `${PACKAGE}/com.yxcorp.gifshow.tiny.TinyLaunchActivity`;
const FLAG_LOGIN = path.join(ROOT, 'data', 'kwai-app.flag');
const SNAP_DIR = path.join(ROOT, 'logs', 'snaps');
const DOWN_GRACE_MS = 90 * 1000; // espera antes de derrubar (permite reuso entre cortes)
const KWAI_STAGING_TIMEOUTS = Object.freeze({ mkdir: 60000, push: 300000, verify: 60000, mediaScan: 120000 });

/* ---------------- infra ---------------- */

function run(cmd, { timeout = 180000, allowFail = false } = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (allowFail) return String(e.stdout || '');
    throw e;
  }
}
const adb = (args, o = {}) => run(`${ADB} -s ${DEVICE} ${args}`, { timeout: 60000, ...o });
const shell = (cmdline, o = {}) => adb(`shell "${cmdline}"`, o);

// O módulo binder_linux do kernel é pré-requisito do redroid.
// Sem sudo: um container docker privilegiado carrega o módulo no kernel do host.
function ensureBinder() {
  const loaded = run('lsmod', { allowFail: true }).includes('binder_linux');
  if (loaded) return;
  run('docker run --rm --privileged -v /lib/modules:/lib/modules:ro ubuntu:24.04 ' +
    'bash -c "apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq kmod >/dev/null 2>&1; ' +
    `modprobe binder_linux devices='binder,hwbinder,vndbinder'"`);
}

function containerRunning() {
  const out = run('docker ps --filter name=kwai-emulator --format {{.Names}}', { allowFail: true }).trim();
  return out === 'kwai-emulator';
}

function adbDeviceState(devicesOutput, device = DEVICE) {
  const line = String(devicesOutput || '').split(/\r?\n/).find(entry => entry.trim().startsWith(`${device}\t`) || entry.trim().startsWith(`${device} `));
  return line ? line.trim().split(/\s+/)[1] || null : null;
}

function adbConnectionAction(state) {
  if (state === 'device') return 'ready';
  if (state === 'offline') return 'wait';
  return 'connect';
}

function connectDevice() {
  const devices = run(`${ADB} devices`, { timeout: 10000, allowFail: true });
  const action = adbConnectionAction(adbDeviceState(devices));
  if (action === 'ready') return devices;
  // Keep an offline transport attached while Android is still booting. Repeated
  // disconnect/connect cycles can prevent adbd from completing its handshake;
  // ensureAndroidBooted applies one controlled container restart after timeout.
  if (action === 'wait') return devices;
  return run(`${ADB} connect ${DEVICE}`, { timeout: 10000, allowFail: true });
}

/* ---------------- ciclo de vida ---------------- */

async function ensureContainerStarted({
  loadBinder = ensureBinder,
  isRunning = containerRunning,
  start = () => run(`docker compose -f ${COMPOSE} up -d`),
  withLock = withAndroidDeviceLock
} = {}) {
  const stateRoot = path.resolve(process.env.STATE_DIR || path.join(ROOT, 'data'));
  const lockTimeoutMs = Number(process.env.KWAI_CONTAINER_START_LOCK_TIMEOUT_MS || 30 * 60 * 1000);
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 1) {
    throw new TypeError('KWAI_CONTAINER_START_LOCK_TIMEOUT_MS inválido');
  }
  return withLock(async () => {
    loadBinder();
    if (!isRunning()) start();
    return true;
  }, {
    lockPath: path.join(stateRoot, 'android-social-upload.lock'),
    timeoutMs: lockTimeoutMs,
    owner: 'kwai-container-startup'
  });
}

async function restartUnavailableContainer({
  withLock = withAndroidDeviceLock,
  isBooted = () => shell('getprop sys.boot_completed', { allowFail: true, timeout: 10000 }).trim() === '1',
  restart = () => run(`docker compose -f ${COMPOSE} restart --timeout 15`)
} = {}) {
  const stateRoot = path.resolve(process.env.STATE_DIR || path.join(ROOT, 'data'));
  return withLock(async () => {
    // Another operator may have recovered the device while we waited for the
    // publisher lock. Never restart a ready Android or an active publication.
    if (await isBooted()) return false;
    await restart();
    return true;
  }, { lockPath: path.join(stateRoot, 'android-social-upload.lock'), owner: 'kwai-container-recovery', timeoutMs: 30 * 60 * 1000 });
}

async function bootAndroid() {
  await ensureContainerStarted();
  // Após reboot do host, o container pode estar parado; `compose up -d` acima
  // o recria. Se o container estiver running mas o Android não bootar, tenta
  // um restart controlado e só libera o publicador quando sys.boot_completed=1.
  const reconnectDevice = () => connectDevice();
  await ensureAndroidBooted({
    isBooted: () => shell('getprop sys.boot_completed', { allowFail: true }).trim() === '1',
    reconnect: reconnectDevice,
    restartContainer: () => restartUnavailableContainer(),
    wait: sleep,
    timeoutMs: 240000,
    pollIntervalMs: 5000,
    maxAttempts: 2
  });
  reconnectDevice();
  // A translator setting is opt-in and serialized with the uploader. Never
  // force-stop an app/draft here; the current composition must survive acquire.
  if (process.env.KWAI_NDK_TRANSLATION_MODE) {
    await withAndroidDeviceLock(() => configureKwaiTranslationMode(), {
      lockPath: path.join(path.resolve(process.env.STATE_DIR || path.join(ROOT, 'data')), 'android-social-upload.lock'),
      owner: 'kwai-native-translation'
    });
  }
  // Habilita ADBKeyboard quando instalado. O login não depende desse teclado,
  // mas o fluxo de publicação precisa dele para preencher legendas Unicode.
  const imeList = shell('ime list -s', { allowFail: true });
  if (imeList.includes('com.android.adbkeyboard/.AdbIME')) {
    shell('ime enable com.android.adbkeyboard/.AdbIME', { allowFail: true });
    shell('ime set com.android.adbkeyboard/.AdbIME', { allowFail: true });
  }
  return true;
}

async function up() {
  return withProcessFileLock(bootAndroid, {
    lockPath: path.join(path.resolve(process.env.STATE_DIR || path.join(ROOT, 'data')), 'android-boot.lock'),
    timeoutMs: 30 * 60 * 1000,
    owner: 'android-boot'
  });
}

function configureKwaiTranslationMode({
  mode = process.env.KWAI_NDK_TRANSLATION_MODE || '',
  readMode = () => run('docker exec kwai-emulator getprop ndk_translation.mode', { timeout: 10000 }).trim(),
  setMode = value => run(`docker exec kwai-emulator setprop ndk_translation.mode ${value}`, { timeout: 10000 })
} = {}) {
  if (!mode) return { configured: false, changed: false };
  if (mode !== 'light-translate-or-interpret') throw new TypeError('modo de tradução Kwai não permitido');
  if (readMode() === mode) return { configured: true, changed: false };
  setMode(mode);
  if (readMode() !== mode) throw new Error('não foi possível confirmar o modo de tradução Kwai');
  return { configured: true, changed: true };
}

async function down({ withLock = withAndroidDeviceLock, isBooting, stop } = {}) {
  const stateRoot = path.resolve(process.env.STATE_DIR || path.join(ROOT, 'data'));
  return withLock(async () => {
    const bootPath = path.join(stateRoot, 'android-boot.lock');
    let booting = false;
    if (isBooting) booting = await isBooting();
    else {
      try { booting = processIsAlive(Number(JSON.parse(fs.readFileSync(bootPath, 'utf8')).pid)); }
      catch (error) {
        if (error.code !== 'ENOENT' && fs.existsSync(bootPath)) {
          booting = Date.now() - fs.statSync(bootPath).mtimeMs < 60000;
        }
      }
    }
    if (booting) return false;
    if (stop) await stop();
    else {
      adb('disconnect ' + DEVICE, { allowFail: true });
      run(`docker compose -f ${COMPOSE} down`, { allowFail: true }); // preserva volume/login
    }
    return true;
  }, { lockPath: path.join(stateRoot, 'android-social-upload.lock'), owner: 'android-stop' });
}

/* ---------------- refcount (sobe/derruba sozinho) ---------------- */

let refs = 0;
let downTimer = null;
let upPromise = null;
let bootInProgress = false;

async function acquire({ isRunning = containerRunning,
  isBooted = () => shell('getprop sys.boot_completed', { allowFail: true, timeout: 10000 }).trim() === '1',
  boot = up } = {}) {
  refs++;
  if (downTimer) { clearTimeout(downTimer); downTimer = null; }
  if (!upPromise || (!bootInProgress && (!isRunning() || !isBooted()))) {
    bootInProgress = true;
    upPromise = Promise.resolve().then(boot)
      .catch(e => { upPromise = null; throw e; })
      .finally(() => { bootInProgress = false; });
  }
  try { return await upPromise; }
  catch (error) { refs = Math.max(0, refs - 1); throw error; }
}

function release() {
  refs = Math.max(0, refs - 1);
  if (refs === 0 && !downTimer) {
    const stopWhenIdle = async () => {
      downTimer = null;
      try {
        if (await down() === false) {
          downTimer = setTimeout(stopWhenIdle, DOWN_GRACE_MS);
          downTimer.unref?.();
          return;
        }
        console.log('  [kwai-emulator] derrubado — RAM liberada');
      }
      catch (_e) { /* tentará de novo no próximo ciclo */ }
      upPromise = null;
    };
    downTimer = setTimeout(stopWhenIdle, DOWN_GRACE_MS);
    downTimer.unref?.();
  }
}

/* ---------------- adb: UI ---------------- */

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function openApp() {
  shell(`am start -n ${ACTIVITY}`, { allowFail: true });
  await sleep(6000);
  const pid = shell('pidof ' + PACKAGE, { allowFail: true }).trim();
  if (!pid) {
    // retry único
    shell(`am start -n ${ACTIVITY}`, { allowFail: true });
    await sleep(10000);
  }
}

async function dumpUI({ timeoutMs = 45000, runner } = {}) {
  const xml = readAndroidHierarchy({ adbPath: ADB, device: DEVICE, timeoutMs, runner });
  // Attribute order differs between shell uiautomator and uiautomator2.
  // Keep the uploader's contract while sharing the tested XML/entity parser.
  return parseUiNodes(xml).filter(node => node.visible).map(node => ({
    text: node.text, rid: node.resourceId, cls: node.className,
    desc: node.description, hint: node.hint, clickable: node.clickable,
    x: node.x, y: node.y, w: node.width, h: node.height
  }));
}

function getResumedActivity() {
  return parseResumedActivity(shell('dumpsys activity activities', { timeout: 20000, allowFail: true }));
}

async function findByText(pattern, { timeoutMs = 45000, alsoDesc = true, alsoRid = false } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const nodes = await dumpUI({ timeoutMs: 15000 });
    const hit = nodes.find(n =>
      (pattern.test(n.text)) ||
      (alsoDesc && pattern.test(n.desc)) ||
      (alsoRid && pattern.test(n.rid)));
    if (hit) return hit;
    await sleep(2500);
  }
  return null;
}

async function tap(x, y) { shell(`input tap ${x} ${y}`, { allowFail: true }); await sleep(1200); }
async function swipe(x1, y1, x2, y2, durationMs = 450) {
  const points = [x1, y1, x2, y2].map(Number);
  const duration = Number(durationMs);
  if (!points.every(point => Number.isSafeInteger(point) && point >= 0 && point <= 10000)
    || !Number.isSafeInteger(duration) || duration < 100 || duration > 3000) {
    throw new TypeError('Kwai: coordenadas/duração de rolagem inválidas');
  }
  shell(`input swipe ${points.join(' ')} ${duration}`);
  await sleep(900);
}
async function tapText(pattern, opts = {}) {
  const n = await findByText(pattern, opts);
  if (!n) return false;
  await tap(n.x, n.y);
  return true;
}
async function key(code) { shell(`input keyevent ${code}`, { allowFail: true }); await sleep(800); }
const KEY = { BACK: 4, HOME: 3, ENTER: 66, TAB: 61 };

// Texto Unicode via ADBKeyboard (broadcast base64). Falha explicitamente se a
// IME não estiver ativa, para não deixar uma legenda parcialmente digitada.
async function text(str) {
  const activeIme = shell('settings get secure default_input_method', { allowFail: true }).trim();
  if (activeIme !== 'com.android.adbkeyboard/.AdbIME') {
    throw new Error('ADBKeyboard não está ativo; legenda não foi digitada');
  }
  const b64 = Buffer.from(String(str), 'utf8').toString('base64');
  const result = shell(`am broadcast -a ADB_INPUT_B64 --es msg ${b64}`, { allowFail: true });
  if (!result.includes('Broadcast completed')) throw new Error('ADBKeyboard não confirmou o comando de texto');
  await sleep(600);
}

// Substitui o conteúdo auto-preenchido pelo app antes de inserir a legenda.
async function replaceText(str) {
  shell('input keycombination KEYCODE_CTRL_LEFT KEYCODE_A');
  await sleep(150);
  await text(str);
}

async function screencap(name) {
  try {
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    const out = path.join(SNAP_DIR, `kwai_${name}_${Date.now()}.png`);
    execSync(`${ADB} -s ${DEVICE} exec-out screencap -p > ${JSON.stringify(out)}`, { shell: '/bin/bash', timeout: 30000 });
    return out;
  } catch (_e) { return null; }
}

function runKwaiStagingCommand(runner, adbPath, device, stage, args, timeout) {
  try {
    return runner(adbPath, ['-s', device, ...args], {
      timeout,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8') : String(error.stderr || '');
    const diagnostic = error.code === 'ETIMEDOUT'
      ? 'timeout'
      : /broken pipe/i.test(stderr) ? 'broken_pipe' : Number.isInteger(error.status) ? `exit_${error.status}` : 'adb_error';
    const wrapped = new Error(`Kwai: etapa ADB ${stage} falhou (${diagnostic})`);
    wrapped.name = 'KwaiStagingAdbError';
    wrapped.code = error.code || 'KWAI_STAGING_ADB_FAILED';
    wrapped.stage = stage;
    wrapped.diagnostic = diagnostic;
    wrapped.cause = error;
    throw wrapped;
  }
}

// Envia o vídeo para a galeria do Android (mídia escaneada).
// Options are injectable so timeout/fallback behavior can be tested without ADB.
async function pushVideo(videoPath, options = {}) {
  // A retry must overwrite one app-private staging path instead of adding
  // another indistinguishable video to Gallery on every attempt.
  const albumName = kwaiStagingAlbumName(videoPath);
  const albumPath = `/sdcard/Movies/${albumName}`;
  const filename = path.basename(videoPath).replace(/[^A-Za-z0-9_.-]/g, '_');
  if (!/\.mp4$/i.test(filename)) throw new Error('Kwai: o arquivo preparado precisa ser MP4');
  const remote = `${albumPath}/${filename}`;
  const runner = options.runner || execFileSync;
  const adbPath = options.adbPath || ADB;
  const device = options.device || DEVICE;
  const wait = options.wait || sleep;
  const warn = options.warn || console.warn;
  const timeouts = { ...KWAI_STAGING_TIMEOUTS, ...(options.timeouts || {}) };
  runKwaiStagingCommand(runner, adbPath, device, 'mkdir', ['shell', 'mkdir', '-p', albumPath], timeouts.mkdir);
  runKwaiStagingCommand(runner, adbPath, device, 'push', ['push', videoPath, remote], timeouts.push);
  const localHash = (await sha256StableRegularFile(videoPath)).sha256;
  const remoteHash = String(runKwaiStagingCommand(runner, adbPath, device, 'verify',
    ['shell', 'toybox', 'sha256sum', remote], timeouts.verify)).trim().split(/\s+/)[0];
  if (remoteHash !== localHash) throw Object.assign(new Error('Kwai: cópia Android diverge do SHA-256 do vídeo'), {
    code: 'KWAI_STAGING_HASH_MISMATCH'
  });

  let mediaScanConfirmed = true;
  try {
    runKwaiStagingCommand(runner, adbPath, device, 'media_scan', [
      'shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${remote}`
    ], timeouts.mediaScan);
  } catch (error) {
    if (error.stage !== 'media_scan' || !['timeout', 'broken_pipe', 'exit_224'].includes(error.diagnostic)) throw error;
    // Gallery lookup below is the authority: it requires one item with the
    // target duration in this isolated album before any publish control is used.
    mediaScanConfirmed = false;
    warn('  [kwai-emulator] MediaScanner não confirmou; o uploader só continuará se a Gallery reconhecer o vídeo isolado.');
  }
  await wait(2000);
  return { albumName, filename, remote, mediaScanConfirmed };
}

/* ---------------- login (flag) ---------------- */

function isLoggedApp() { return fs.existsSync(FLAG_LOGIN); }
function confirmLogin() { fs.mkdirSync(path.dirname(FLAG_LOGIN), { recursive: true }); fs.writeFileSync(FLAG_LOGIN, new Date().toISOString()); }
function revokeLogin() {
  try {
    fs.unlinkSync(FLAG_LOGIN);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function status() {
  const running = containerRunning();
  let adbOk = false, appOk = false, booted = false;
  if (running) {
    connectDevice();
    adbOk = adbDeviceState(run(`${ADB} devices`, { allowFail: true })) === 'device';
    if (adbOk) {
      booted = shell('getprop sys.boot_completed', { allowFail: true }).trim() === '1';
      appOk = shell('pm list packages', { allowFail: true }).includes(PACKAGE);
    }
  }
  return {
    container: running ? 'UP' : 'down',
    adb: adbOk ? 'conectado' : '-',
    android: booted ? 'booted' : '-',
    app: appOk ? 'instalado' : '-',
    login: isLoggedApp() ? 'logado ✓' : 'PENDENTE — rode: node scripts/kwai-emulator.js login'
  };
}

/* ---------------- CLI ---------------- */

if (require.main === module) {
  (async () => {
    const cmd = process.argv[2];
    if (cmd === 'up') {
      await up();
      console.log('emulador UP — adb:', run(`${ADB} devices`, { allowFail: true }).trim());
    } else if (cmd === 'start-container') {
      await ensureContainerStarted();
      console.log('container Kwai iniciado; o Android conclui o boot em segundo plano');
    } else if (cmd === 'down') {
      await down();
      console.log('emulador DOWN — RAM liberada');
    } else if (cmd === 'status') {
      console.log(await status());
    } else if (cmd === 'login') {
      await up();
      await openApp();
      console.log('\nKwai aberto no Android isolado; nenhuma janela de navegador foi iniciada.');
      console.log('Valide a sessão com: node scripts/social-login.js --platform kwai');
      console.log('O envio permanece bloqueado enquanto a tela autenticada não for reconhecida.\n');
    } else if (cmd === 'confirm') {
      confirmLogin();
      console.log('✅ app Kwai marcado como logado — uploader habilitado');
    } else if (cmd === 'revoke') {
      revokeLogin();
      console.log('flag de login removida');
    } else if (cmd === 'test') {
      await up();
      console.log('digitei "Pulso IA ó é çã" num campo de busca do Android:');
      shell('am start -a android.settings.SETTINGS', { allowFail: true });
      await sleep(3000);
      shell('input keyevent KEYCODE_FOCUS', { allowFail: true });
      await text('Pulso IA ó é çã');
    } else {
      console.log('uso: node scripts/kwai-emulator.js up|start-container|down|status|login|confirm|test');
    }
    process.exit(0);
  })().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
}

module.exports = { acquire, release, up, down, openApp, tap, swipe, tapText, key, KEY, text, replaceText, screencap, pushVideo, dumpUI, getResumedActivity, parseResumedActivity, findByText, isLoggedApp, confirmLogin, revokeLogin, status, containerRunning, ensureContainerStarted, restartUnavailableContainer, configureKwaiTranslationMode, adbDeviceState, adbConnectionAction, KWAI_STAGING_TIMEOUTS };
