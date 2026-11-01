'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createAndroidSocialPublisher } = require('../utils/android-social-publisher');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'android-publisher-'));
  const videoPath = path.join(root, 'clip.mp4');
  fs.writeFileSync(videoPath, 'fixture');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, videoPath };
}

function authenticatedControl({ installed = true, screen = [{ text: 'Para você', description: '', visible: true }] } = {}) {
  return {
    async isPackageInstalled() { return installed; },
    openApp() {},
    async dumpUi() { return screen; }
  };
}

test('Android social publisher holds the device lock and invokes only an authenticated native handler', async t => {
  const { root, videoPath } = fixture(t);
  const lockCalls = [];
  const control = authenticatedControl();
  let payload;
  const publisher = createAndroidSocialPublisher({
    control,
    lockPath: path.join(root, 'device.lock'),
    withLock: async (callback, options) => { lockCalls.push(options); return callback(); },
    handlers: { kwai: async value => { payload = value; return { status: 'submitted' }; } }
  });

  const result = await publisher.publish({ platform: 'kwai', videoPath, caption: 'gancho fiel', title: 'tema' });

  assert.deepEqual(result, { status: 'submitted' });
  assert.equal(payload.packageName, 'kwai.lite.video');
  assert.equal(payload.caption, 'gancho fiel');
  assert.equal(payload.title, 'tema');
  assert.equal(payload.videoPath, videoPath);
  assert.equal(lockCalls.length, 1);
  assert.equal(lockCalls[0].owner, 'android-upload:kwai');
});

test('Android social publisher fails closed for missing apps, login, and unconfigured native flows', async t => {
  const { root, videoPath } = fixture(t);
  const publisher = createAndroidSocialPublisher({
    control: authenticatedControl({ installed: false }),
    lockPath: path.join(root, 'device.lock'),
    withLock: callback => callback(),
    handlers: { instagram: async () => ({ status: 'submitted' }) }
  });
  await assert.rejects(publisher.publish({ platform: 'instagram', videoPath }), /app .* não instalado.*nenhum navegador/);

  const requiresLogin = createAndroidSocialPublisher({
    control: authenticatedControl({ screen: [{ text: 'Entrar', description: '', visible: true }] }),
    lockPath: path.join(root, 'device.lock'),
    withLock: callback => callback(),
    handlers: { tiktok: async () => ({ status: 'submitted' }) }
  });
  const loginRequired = await requiresLogin.publish({ platform: 'tiktok', videoPath });
  assert.equal(loginRequired.status, 'failed');
  assert.equal(loginRequired.failureCode, 'android_session_unavailable');
  assert.equal(loginRequired.evidence.kind, 'confirmed_no_send');

  let handlerInvoked = false;
  const transientSession = createAndroidSocialPublisher({
    control: authenticatedControl(),
    inspectSession: async () => ({ platform: 'kwai', packageName: 'kwai.lite.video', status: 'unknown' }),
    lockPath: path.join(root, 'transient-device.lock'),
    withLock: callback => callback(),
    handlers: { kwai: async () => { handlerInvoked = true; return { status: 'submitted' }; } }
  });
  const transientResult = await transientSession.publish({ platform: 'kwai', videoPath });
  assert.equal(transientResult.status, 'failed');
  assert.equal(transientResult.failureCode, 'pre_submit_ui_error');
  assert.equal(transientResult.evidence.kind, 'confirmed_no_send');
  assert.equal(handlerInvoked, false);

  let recoveredPayload;
  const recoverableKwaiState = createAndroidSocialPublisher({
    control: authenticatedControl(),
    inspectSession: async () => ({ platform: 'kwai', packageName: 'kwai.lite.video', status: 'unknown' }),
    allowUnknownSession: ({ platform, session }) => platform === 'kwai' && session.status === 'unknown',
    lockPath: path.join(root, 'recoverable-device.lock'),
    withLock: callback => callback(),
    handlers: { kwai: async value => { recoveredPayload = value; return { status: 'submitted' }; } }
  });
  const recoveredResult = await recoverableKwaiState.publish({ platform: 'kwai', videoPath, caption: 'same job' });
  assert.equal(recoveredResult.status, 'submitted');
  assert.equal(recoveredPayload.caption, 'same job');

  const recoveryControl = authenticatedControl({ screen: [{ text: 'caption draft', visible: true }] });
  let resumedDraft = false;
  const recoverableInstagramDraft = createAndroidSocialPublisher({
    control: recoveryControl,
    inspectSession: async () => ({ platform: 'instagram', packageName: 'com.instagram.android', status: 'unknown' }),
    allowUnknownSession: async ({ platform, session, control: observedControl, caption }) => {
      assert.equal(platform, 'instagram');
      assert.equal(session.status, 'unknown');
      assert.equal(observedControl, recoveryControl);
      assert.equal(caption, 'expected caption');
      return { allow: true, handlerOptions: { resumeCurrentDraft: true } };
    },
    expectedHandles: { instagram: '@pulso_ai_news' },
    lockPath: path.join(root, 'recoverable-instagram-device.lock'),
    withLock: callback => callback(),
    handlers: { instagram: async value => { resumedDraft = value.resumeCurrentDraft; return { status: 'submitted' }; } }
  });
  const resumedResult = await recoverableInstagramDraft.publish({
    platform: 'instagram', videoPath, caption: 'expected caption'
  });
  assert.equal(resumedResult.status, 'submitted');
  assert.equal(resumedDraft, true);

  let invokedAfterRecoveryError = false;
  const recoveryError = createAndroidSocialPublisher({
    control: recoveryControl,
    inspectSession: async () => ({ platform: 'instagram', packageName: 'com.instagram.android', status: 'unknown' }),
    allowUnknownSession: async () => { throw new Error('draft retomado sem tela final'); },
    lockPath: path.join(root, 'recovery-error-device.lock'),
    withLock: callback => callback(),
    handlers: { instagram: async () => { invokedAfterRecoveryError = true; return { status: 'submitted' }; } }
  });
  const blockedRecovery = await recoveryError.publish({ platform: 'instagram', videoPath, caption: 'expected caption' });
  assert.equal(blockedRecovery.status, 'failed');
  assert.equal(blockedRecovery.evidence.kind, 'confirmed_no_send');
  assert.equal(invokedAfterRecoveryError, false, 'a pre-handler recovery error cannot be misclassified as submitted');

  let openedWithoutHandler = false;
  const missingFlow = createAndroidSocialPublisher({
    control: {
      ...authenticatedControl({ screen: [{ text: 'Home', description: '', visible: true }] }),
      openApp() { openedWithoutHandler = true; }
    },
    lockPath: path.join(root, 'device.lock'),
    withLock: callback => callback()
  });
  await assert.rejects(missingFlow.publish({ platform: 'x', videoPath }), /fluxo nativo Android ainda não configurado.*nenhum navegador/);
  assert.equal(openedWithoutHandler, false);
});

test('Android social publisher refuses an unapproved account and accepts only the exact configured handle', async t => {
  const { root, videoPath } = fixture(t);
  let submissions = 0;
  const common = {
    control: authenticatedControl(),
    inspectSession: async () => ({ platform: 'instagram', packageName: 'com.instagram.android', status: 'logged_in', accountHandle: '@pulso_ai_news' }),
    lockPath: path.join(root, 'identity-device.lock'),
    withLock: callback => callback(),
    handlers: { instagram: async () => { submissions++; return { status: 'submitted' }; } }
  };

  const unapproved = createAndroidSocialPublisher(common);
  const blocked = await unapproved.publish({ platform: 'instagram', videoPath });
  assert.equal(blocked.failureCode, 'android_account_identity_unverified');
  assert.equal(blocked.evidence.kind, 'confirmed_no_send');
  assert.equal(submissions, 0);

  const approved = createAndroidSocialPublisher({ ...common, expectedHandles: { instagram: '@PULSO_AI_NEWS' } });
  assert.deepEqual(await approved.publish({ platform: 'instagram', videoPath }), { status: 'submitted' });
  assert.equal(submissions, 1);
});

test('publicador recupera sessão TikTok expirada e revalida o handle antes do handler', async t => {
  const { root, videoPath } = fixture(t);
  let probes = 0;
  let recovered = 0;
  let submissions = 0;
  let observedHandle = '@approved';
  const publisher = createAndroidSocialPublisher({
    control: authenticatedControl(), lockPath: path.join(root, 'tiktok.lock'), withLock: callback => callback(),
    expectedHandles: { tiktok: '@approved' },
    inspectSession: async () => ({ platform: 'tiktok', packageName: 'com.zhiliaoapp.musically',
      ...(++probes % 2 ? { status: 'login_required' } : { status: 'logged_in', accountHandle: observedHandle }) }),
    recoverTikTokLogin: async (_control, handle) => { assert.equal(handle, '@approved'); recovered++; return true; },
    handlers: { tiktok: async () => { submissions++; return { status: 'submitted' }; } }
  });
  assert.deepEqual(await publisher.publish({ platform: 'tiktok', videoPath }), { status: 'submitted' });
  observedHandle = '@different';
  const blocked = await publisher.publish({ platform: 'tiktok', videoPath });
  assert.equal(blocked.failureCode, 'android_account_identity_unverified');
  assert.equal(blocked.evidence.kind, 'confirmed_no_send');
  assert.equal(recovered, 2);
  assert.equal(submissions, 1);
});

test('Android social publisher rejects invalid destinations and non-MP4 input before touching the emulator', async t => {
  const { root, videoPath } = fixture(t);
  let locked = false;
  const publisher = createAndroidSocialPublisher({
    control: authenticatedControl(),
    lockPath: path.join(root, 'device.lock'),
    withLock: callback => { locked = true; return callback(); }
  });

  await assert.rejects(publisher.publish({ platform: 'facebook', videoPath }), /plataforma Android não permitida/);
  await assert.rejects(publisher.publish({ platform: 'kwai', videoPath: path.join(root, 'image.png') }), /arquivo de vídeo Android não encontrado/);
  assert.equal(locked, false);
});
