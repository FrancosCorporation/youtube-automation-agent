#!/usr/bin/env node
/**
 * Emulador Android do Kwai (redroid) — ON-DEMAND.
 * Sobe antes do upload, derruba depois → baseline 0 MB de RAM fora do uso.
 *
 * O Kwai removeu o upload web (/upload = 404); publicar só pelo app.
 * App: com.kwai.video instalado no volume kwai-data (login persiste entre ciclos).
 *
 * CLI:
 *   node scripts/kwai-emulator.js up       — sobe emulador + conecta adb
 *   node scripts/kwai-emulator.js down     — derruba emulador (libera RAM)
 *   node scripts/kwai-emulator.js status   — estado (container, adb, app, login)
 *   node scripts/kwai-emulator.js login    — sobe + abre app + instruções scrcpy
 *   node scripts/kwai-emulator.js confirm  — marca app como logado (flag)
 *   node scripts/kwai-emulator.js test     — digita texto de teste (teclado ADB)
 *
 * Módulo: const kwai = require('./kwai-emulator')
 *   await kwai.acquire() / kwai.release()  — refcount: sobe no 1º uso, derruba no último
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COMPOSE = path.join(ROOT, 'docker-compose.kwai.yml');
const ADB = process.env.ADB_PATH || '/home/servidor/.local/bin/adb';
const DEVICE = '127.0.0.1:5555';
// Kwai LITE (kwai.lite.video) — instalado via Play Store, logado com a conta
// Google. Mais leve que o Kwai completo = roda liso no emulador x86 (o completo
// fica preso em "resource downloading" + diálogo de update no servidor).
const PACKAGE = process.env.KWAI_PACKAGE || 'kwai.lite.video';
const ACTIVITY = `${PACKAGE}/com.yxcorp.gifshow.tiny.TinyLaunchActivity`;
const FLAG_LOGIN = path.join(ROOT, 'data', 'kwai-app.flag');
const SNAP_DIR = path.join(ROOT, 'logs', 'snaps');
const DOWN_GRACE_MS = 90 * 1000; // espera antes de derrubar (permite reuso entre cortes)

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

/* ---------------- ciclo de vida ---------------- */

async function up() {
  ensureBinder();
  if (!containerRunning()) {
    run(`docker compose -f ${COMPOSE} up -d`);
  }
  // espera o Android terminar de bootar
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    const booted = shell('getprop sys.boot_completed', { allowFail: true }).trim() === '1';
    if (booted) break;
    await sleep(5000);
  }
  adb('connect ' + DEVICE, { allowFail: true });
  // garante IME ADBKeyboard (unicode via broadcast) — idempotente
  shell('ime set com.android.adbkeyboard/.AdbIME', { allowFail: true });
  return true;
}

async function down() {
  adb('disconnect ' + DEVICE, { allowFail: true });
  run(`docker compose -f ${COMPOSE} down`, { allowFail: true }); // volume kwai-data persiste (login salvo)
}

/* ---------------- refcount (sobe/derruba sozinho) ---------------- */

let refs = 0;
let downTimer = null;
let upPromise = null;

async function acquire() {
  refs++;
  if (downTimer) { clearTimeout(downTimer); downTimer = null; }
  if (!upPromise) upPromise = up().catch(e => { upPromise = null; refs = Math.max(0, refs - 1); throw e; });
  return upPromise;
}

function release() {
  refs = Math.max(0, refs - 1);
  if (refs === 0 && !downTimer) {
    downTimer = setTimeout(async () => {
      downTimer = null;
      try { await down(); console.log('  [kwai-emulator] derrubado — RAM liberada'); }
      catch (_e) { /* tentará de novo no próximo ciclo */ }
      upPromise = null;
    }, DOWN_GRACE_MS);
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

async function dumpUI({ timeoutMs = 45000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    shell('uiautomator dump /sdcard/ui.xml', { allowFail: true });
    const xml = shell('cat /sdcard/ui.xml', { allowFail: true });
    if (xml.includes('<hierarchy') || xml.includes('<node')) return parseNodes(xml);
    await sleep(2000);
  }
  return [];
}

function parseNodes(xml) {
  const nodes = [];
  const re = /<node[^>]*?text="([^"]*)"[^>]*?resource-id="([^"]*)"[^>]*?class="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?clickable="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, text, rid, cls, desc, clickable, x1, y1, x2, y2] = m;
    const x = (Number(x1) + Number(x2)) / 2 | 0;
    const y = (Number(y1) + Number(y2)) / 2 | 0;
    nodes.push({ text, rid, cls, desc, clickable: clickable === 'true', x, y, w: x2 - x1, h: y2 - y1 });
  }
  return nodes;
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
async function tapText(pattern, opts = {}) {
  const n = await findByText(pattern, opts);
  if (!n) return false;
  await tap(n.x, n.y);
  return true;
}
async function key(code) { shell(`input keyevent ${code}`, { allowFail: true }); await sleep(800); }
const KEY = { BACK: 4, HOME: 3, ENTER: 66, TAB: 61 };

// Texto unicode via ADBKeyboard (broadcast base64). Fallback: input text ASCII.
async function text(str) {
  const b64 = Buffer.from(String(str), 'utf8').toString('base64');
  shell(`am broadcast -a ADB_INPUT_B64 --es msg ${b64}`, { allowFail: true });
  await sleep(600);
}

async function screencap(name) {
  try {
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    const out = path.join(SNAP_DIR, `kwai_${name}_${Date.now()}.png`);
    execSync(`${ADB} -s ${DEVICE} exec-out screencap -p > ${JSON.stringify(out)}`, { shell: '/bin/bash', timeout: 30000 });
    return out;
  } catch (_e) { return null; }
}

// Envia o vídeo para a galeria do Android (mídia escaneada)
async function pushVideo(videoPath) {
  const remote = `/sdcard/Movies/kwai_${Date.now()}${path.extname(videoPath) || '.mp4'}`;
  execSync(`${ADB} -s ${DEVICE} push ${JSON.stringify(videoPath)} ${remote}`, { timeout: 300000 });
  shell(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${remote}`, { allowFail: true });
  await sleep(2000);
  return remote;
}

/* ---------------- login (flag) ---------------- */

function isLoggedApp() { return fs.existsSync(FLAG_LOGIN); }
function confirmLogin() { fs.mkdirSync(path.dirname(FLAG_LOGIN), { recursive: true }); fs.writeFileSync(FLAG_LOGIN, new Date().toISOString()); }
function revokeLogin() { try { fs.unlinkSync(FLAG_LOGIN); } catch (_e) {} }

async function status() {
  const running = containerRunning();
  let adbOk = false, appOk = false, booted = false;
  if (running) {
    adb('connect ' + DEVICE, { allowFail: true });
    adbOk = run(`${ADB} devices`, { allowFail: true }).includes(DEVICE);
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
    } else if (cmd === 'down') {
      await down();
      console.log('emulador DOWN — RAM liberada');
    } else if (cmd === 'status') {
      console.log(await status());
    } else if (cmd === 'login') {
      await up();
      await openApp();
      console.log('\n▶ Faça o login no app Kwai:');
      console.log('  1) No desktop remoto, abra um terminal e rode:  scrcpy -s 127.0.0.1:5555');
      console.log('     (se não tiver scrcpy: sudo apt-get install -y scrcpy)');
      console.log('  2) Complete onboarding + login no espelho do celular que abrir');
      console.log('  3) Depois marque o login:  node scripts/kwai-emulator.js confirm');
      console.log('  4) Libere a RAM com:       node scripts/kwai-emulator.js down\n');
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
      console.log('uso: node scripts/kwai-emulator.js up|down|status|login|confirm|test');
    }
    process.exit(0);
  })().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
}

module.exports = { acquire, release, up, down, openApp, tap, tapText, key, KEY, text, screencap, pushVideo, dumpUI, findByText, isLoggedApp, status, containerRunning };
