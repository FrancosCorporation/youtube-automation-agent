'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { adbConnectionAction, adbDeviceState, ensureContainerStarted, restartUnavailableContainer, acquire, release, configureKwaiTranslationMode, parseResumedActivity, pushVideo, KWAI_STAGING_TIMEOUTS } = require('../scripts/kwai-emulator');

const root = path.join(__dirname, '..');

test('nova aquisição verifica ADB após dispositivo ficar offline', async () => {
  let ready = true;
  let boots = 0;
  const options = { isRunning: () => true, isBooted: () => ready, boot: async () => { boots++; } };
  await acquire(options); release();
  await acquire(options); release();
  assert.equal(boots, 1);
  ready = false;
  await acquire(options); release();
  assert.equal(boots, 2);
});

test('aquisições simultâneas compartilham a falha e permitem nova tentativa', async () => {
  let boots = 0;
  const options = { isRunning: () => true, isBooted: () => false,
    boot: async () => { boots++; throw new Error('offline'); } };
  const results = await Promise.allSettled([acquire(options), acquire(options)]);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected']);
  assert.equal(boots, 1);
  await acquire({ ...options, boot: async () => { boots++; } }); release();
  assert.equal(boots, 2);
});

test('recuperação do container usa a trava do publicador e reavalia o dispositivo', async () => {
  const events = [];
  const withLock = async (callback, options) => {
    assert.match(options.lockPath, /android-social-upload\.lock$/);
    events.push('lock'); const result = await callback(); events.push('unlock'); return result;
  };
  const restart = () => events.push('restart');
  assert.equal(await restartUnavailableContainer({ withLock, isBooted: () => true, restart }), false);
  assert.deepEqual(events, ['lock', 'unlock']);
  events.length = 0;
  assert.equal(await restartUnavailableContainer({ withLock, isBooted: () => false, restart }), true);
  assert.deepEqual(events, ['lock', 'restart', 'unlock']);
});

test('idle shutdown shares the Android lock and cannot stop another process during boot', async () => {
  const { down } = require('../scripts/kwai-emulator');
  const events = [];
  const withLock = async (callback, options) => {
    assert.match(options.lockPath, /android-social-upload\.lock$/);
    events.push('lock'); const result = await callback(); events.push('unlock'); return result;
  };
  assert.equal(await down({ withLock, isBooting: () => true, stop: () => events.push('stop') }), false);
  assert.deepEqual(events, ['lock', 'unlock']);
  events.length = 0;
  assert.equal(await down({ withLock, isBooting: () => false, stop: () => events.push('stop') }), true);
  assert.deepEqual(events, ['lock', 'stop', 'unlock']);
});

test('Kwai native translation setting is explicit, allowlisted and read back without restarting the app', () => {
  let value = '';
  let writes = 0;
  const options = { mode: 'light-translate-or-interpret', readMode: () => value,
    setMode: next => { value = next; writes++; } };
  assert.deepEqual(configureKwaiTranslationMode({ mode: '', readMode: () => assert.fail('not configured') }), { configured: false, changed: false });
  assert.throws(() => configureKwaiTranslationMode({ ...options, mode: 'invalid;command' }), /não permitido/);
  assert.deepEqual(configureKwaiTranslationMode(options), { configured: true, changed: true });
  assert.deepEqual(configureKwaiTranslationMode(options), { configured: true, changed: false });
  assert.equal(writes, 1);
  assert.throws(() => configureKwaiTranslationMode({ ...options, readMode: () => '' }), /confirmar/);
});

test('boot do host espera Docker e garante o container Kwai depois do reboot', () => {
  const compose = fs.readFileSync(path.join(root, 'docker-compose.kwai.yml'), 'utf8');
  const unit = fs.readFileSync(path.join(root, 'deploy/systemd/kwai-emulator-boot.service'), 'utf8');

  assert.match(compose, /container_name:\s*kwai-emulator[\s\S]*?restart:\s*unless-stopped/);
  assert.match(unit, /ExecStartPre=.*scripts\/wait-for-docker\.sh/);
  assert.match(unit, /ExecStart=.*scripts\/kwai-emulator\.js up/);
  assert.match(unit, /WantedBy=default\.target/);
});

test('ADB considera pronto apenas o device online exato', () => {
  assert.equal(adbDeviceState('List of devices attached\n127.0.0.1:5555 device product:redroid\n', '127.0.0.1:5555'), 'device');
  assert.equal(adbDeviceState('List of devices attached\n127.0.0.1:5555 offline transport_id:1\n', '127.0.0.1:5555'), 'offline');
  assert.equal(adbDeviceState('List of devices attached\n127.0.0.1:55550 device\n', '127.0.0.1:5555'), null);
  assert.equal(adbConnectionAction('device'), 'ready');
  assert.equal(adbConnectionAction('offline'), 'wait');
  assert.equal(adbConnectionAction(null), 'connect');
});

test('Kwai identifica EditorActivity pela atividade Android retomada sem tocar na interface', () => {
  assert.equal(parseResumedActivity('topResumedActivity=ActivityRecord{10642cc u0 kwai.lite.video/com.yxcorp.gifshow.v3.EditorActivity t321}'),
    'kwai.lite.video/com.yxcorp.gifshow.v3.EditorActivity');
  assert.equal(parseResumedActivity('ResumedActivity: ActivityRecord{10642cc u0 kwai.lite.video/com.yxcorp.gifshow.v3.EditorActivity t321}'),
    'kwai.lite.video/com.yxcorp.gifshow.v3.EditorActivity');
  assert.equal(parseResumedActivity('topResumedActivity=ActivityRecord{10642cc u0 com.android.launcher3/.Launcher t1}'),
    'com.android.launcher3/.Launcher');
  assert.equal(parseResumedActivity('no resumed activity'), null);
});

test('startup do host serializa, garante binder e cria o container Kwai parado', async () => {
  const calls = [];
  const result = await ensureContainerStarted({
    loadBinder: () => calls.push('binder'),
    isRunning: () => false,
    start: () => calls.push('compose-up'),
    withLock: async (operation, options) => {
      calls.push(options.owner);
      return operation();
    }
  });

  assert.equal(result, true);
  assert.deepEqual(calls, ['kwai-container-startup', 'binder', 'compose-up']);
});

test('startup serializado não reinicia o container Kwai que já está ativo', async () => {
  const calls = [];
  await ensureContainerStarted({
    loadBinder: () => calls.push('binder'),
    isRunning: () => true,
    start: () => calls.push('compose-up'),
    withLock: async operation => operation()
  });

  assert.deepEqual(calls, ['binder']);
});

test('Kwai staging distinguishes ADB stages and lets Gallery validate after a MediaScanner broken pipe', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kwai-stage-test-'));
  const videoPath = path.join(temp, 'target.mp4');
  fs.writeFileSync(videoPath, Buffer.from('fixture-video'));
  const calls = [];
  const warnings = [];
  try {
    const staged = await pushVideo(videoPath, {
      adbPath: '/tmp/adb-fixture',
      device: '127.0.0.1:5555',
      wait: async () => {},
      warn: message => warnings.push(message),
      runner: (binary, args, options) => {
        calls.push({ binary, args, timeout: options.timeout });
        if (args.includes('sha256sum')) return Buffer.from(require('node:crypto').createHash('sha256').update('fixture-video').digest('hex') + '  target.mp4');
        if (args.includes('broadcast')) {
          const error = new Error('broadcast failed');
          error.status = 224;
          error.stderr = Buffer.from('cmd: Failure calling service activity: Broken pipe (32)');
          throw error;
        }
        return Buffer.alloc(0);
      }
    });

    assert.equal(staged.mediaScanConfirmed, false);
    assert.equal(staged.remote, `/sdcard/Movies/${staged.albumName}/target.mp4`);
    assert.deepEqual(calls.map(call => call.timeout), [
      KWAI_STAGING_TIMEOUTS.mkdir,
      KWAI_STAGING_TIMEOUTS.push,
      KWAI_STAGING_TIMEOUTS.verify,
      KWAI_STAGING_TIMEOUTS.mediaScan
    ]);
    assert.deepEqual(calls.map(call => call.args[2] === 'shell' ? call.args[3] : call.args[2]), ['mkdir', 'push', 'toybox', 'am']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Gallery reconhecer o vídeo isolado/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Kwai staging labels a timed out push and stops before MediaScanner', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kwai-stage-timeout-test-'));
  const videoPath = path.join(temp, 'target.mp4');
  fs.writeFileSync(videoPath, Buffer.from('fixture-video'));
  const calls = [];
  try {
    await assert.rejects(pushVideo(videoPath, {
      adbPath: '/tmp/adb-fixture',
      device: '127.0.0.1:5555',
      wait: async () => {},
      runner: (_binary, args) => {
        calls.push(args);
        if (args.includes('push')) throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
        return Buffer.alloc(0);
      }
    }), error => error.stage === 'push' && error.diagnostic === 'timeout');
    assert.equal(calls.length, 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Kwai só tolera Scanner exit 224 após confirmar o hash e ainda exige conferência da galeria', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kwai-scan-exit-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'target.mp4');
  fs.writeFileSync(file, 'fixture-video');
  const expected = require('node:crypto').createHash('sha256').update('fixture-video').digest('hex');
  const runner = (_binary, args) => {
    if (args.includes('sha256sum')) return Buffer.from(`${expected} file`);
    if (args.includes('broadcast')) throw Object.assign(new Error('remote failure'), { status: 224, stderr: '' });
    return Buffer.alloc(0);
  };
  const staged = await pushVideo(file, { runner, wait: async () => {}, warn: () => {} });
  assert.equal(staged.mediaScanConfirmed, false);
  await assert.rejects(pushVideo(file, { runner: (_binary, args) => args.includes('sha256sum')
    ? Buffer.from('0'.repeat(64) + ' file') : Buffer.alloc(0), wait: async () => {} }),
  { code: 'KWAI_STAGING_HASH_MISMATCH' });
});
