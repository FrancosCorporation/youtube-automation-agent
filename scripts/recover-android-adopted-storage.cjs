'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { withAndroidDeviceLock } = require('../utils/android-device-lock');
const { socialAndroidTarget } = require('../utils/android-social-target');
const root = path.resolve(__dirname, '..');
const target = socialAndroidTarget('instagram');
const volume = '920b1811-3268-4e30-aa62-b1cc1cb80743';
const temporaryPackage = 'com.zhiliaoapp.musically';
const backup = path.join(root, 'data/backups/android-storage-20261029-tiktok');
const evidence = path.join(root, 'docs/evidencias/android-storage-recovery-2026-10-29');

function adb(args, timeout = 30000) {
  return execFileSync('adb', ['-s', target.device, ...args], {
    encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024
  }).trim();
}

function log(event) {
  const item = { at: new Date().toISOString(), ...event };
  fs.appendFileSync(path.join(evidence, 'adopted-storage-migration.jsonl'), JSON.stringify(item) + '\n');
  console.log(JSON.stringify(item));
}

function freeBytes() {
  const line = adb(['shell', 'df', '-Pk', '/data']).split(/\r?\n/).at(-1);
  return Number(line.trim().split(/\s+/)[3]) * 1024;
}

async function migrate() {
  if (!process.argv.includes('--execute')) throw new Error('Use --execute para a recuperação autorizada');
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  fs.mkdirSync(evidence, { recursive: true });
  if (!adb(['shell', 'sm', 'list-volumes', 'all']).includes(`mounted ${volume}`)) {
    throw new Error('Volume adotado esperado não está montado');
  }
  const packageInfo = () => {
    const dump = adb(['shell', 'dumpsys', 'package', temporaryPackage]);
    return { uid: dump.match(/(?:appId|userId)=(\d+)/)?.[1],
      dataDir: dump.match(/dataDir=(\S+)/)?.[1], version: dump.match(/versionName=(\S+)/)?.[1] };
  };
  const before = packageInfo();
  if (!before.uid || !before.dataDir) throw new Error('Identidade original TikTok indisponível');
  log({ operation: 'before', freeBytes: freeBytes(), package: temporaryPackage, ...before });
  const paths = adb(['shell', 'pm', 'path', temporaryPackage]).split(/\r?\n/)
    .filter(line => line.startsWith('package:')).map(line => line.slice(8));
  if (!paths.length || paths.some(file => !file.startsWith('/data/app/') || !file.endsWith('.apk'))) {
    throw new Error('Lista de APKs inesperada');
  }
  const copies = [];
  for (let i = 0; i < paths.length; i++) {
    const remote = paths[i];
    const local = path.join(backup, `${i}-${path.basename(remote)}`);
    adb(['pull', remote, local], 120000);
    const expected = adb(['shell', 'sha256sum', remote]).split(/\s+/)[0];
    const actual = crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex');
    if (expected !== actual) throw new Error('Backup APK não confere');
    copies.push(local);
    log({ operation: 'apk-backup-verified', local, remote, sha256: actual });
  }
  let removed = false;
  const externalPreference = adb(['shell', 'settings', 'get', 'global', 'force_allow_on_external']);
  adb(['shell', 'settings', 'put', 'global', 'force_allow_on_external', '1']);
  const restore = () => {
    log({ operation: 'restore-identical-apks-keep-data', package: temporaryPackage });
    const result = adb(['install-multiple', '-r', '-f', ...copies], 300000);
    log({ operation: 'restore-apks-result', result, freeBytes: freeBytes() });
    if (!result.includes('Success')) throw new Error('Reinstalação TikTok requer recuperação do backup');
    const after = packageInfo();
    if (after.uid !== before.uid || after.version !== before.version) throw new Error('UID/versão TikTok divergente');
    log({ operation: 'original-uid-version-restored', ...after });
  };
  try {
    log({ operation: 'remove-code-keep-data', package: temporaryPackage });
    const result = adb(['shell', 'pm', 'uninstall', '-k', temporaryPackage], 120000);
    if (result !== 'Success') throw new Error(result);
    removed = true;
    log({ operation: 'code-removed-data-retained', freeBytes: freeBytes() });
    // Android's system processes can keep the deleted APKs open. A clean boot
    // releases those descriptors; without it only the native libraries free up.
    if (freeBytes() < 650 * 1024 * 1024) {
      log({ operation: 'reboot-to-release-deleted-package-files' });
      adb(['reboot']);
      const deadline = Date.now() + 180000;
      let booted = false;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
          if (adb(['shell', 'getprop', 'sys.boot_completed'], 10000) === '1') {
            booted = true;
            break;
          }
        } catch { /* The same emulator is rebooting. */ }
      }
      if (!booted) throw new Error('Android não concluiu boot; APKs e dados retidos para recuperação');
      log({ operation: 'after-reboot', freeBytes: freeBytes() });
    }
    for (const app of ['com.instagram.android', 'com.twitter.android']) {
      const result = adb(['shell', 'pm', 'move-package', app, volume], 300000);
      log({ operation: 'move-package', app, result, freeBytes: freeBytes() });
      if (result !== 'Success') throw new Error(`Migração ${app}: ${result}`);
    }
  } finally {
    if (removed) restore();
  }
  const result = adb(['shell', 'pm', 'move-package', temporaryPackage, volume], 300000);
  log({ operation: 'move-package', app: temporaryPackage, result, freeBytes: freeBytes() });
  log({ operation: 'completed', freeBytes: freeBytes(),
    instagram: adb(['shell', 'pm', 'path', 'com.instagram.android']),
    tiktok: adb(['shell', 'pm', 'path', temporaryPackage]),
    x: adb(['shell', 'pm', 'path', 'com.twitter.android']) });
  if (externalPreference === 'null') adb(['shell', 'settings', 'delete', 'global', 'force_allow_on_external']);
  else adb(['shell', 'settings', 'put', 'global', 'force_allow_on_external', externalPreference]);
}

withAndroidDeviceLock(migrate, { lockPath: target.lockPath,
  owner: 'adopted-storage-recovery', timeoutMs: 2000 })
  .catch(error => { console.error(error); process.exitCode = 1; });
