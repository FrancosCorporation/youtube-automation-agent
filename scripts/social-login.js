#!/usr/bin/env node
'use strict';

/**
 * Launch and inspect social apps in the private Redroid emulator.
 * This command intentionally never starts a browser or opens a host window.
 *
 * Usage: npm run social:login -- --platform kwai
 *        npm run social:login -- --all
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { inspectAndroidAppSession, PLATFORM_PACKAGES } = require('../utils/android-emulator-control');
const { socialAndroidTarget } = require('../utils/android-social-target');
const { clearAndroidSession, normalizeAccountHandle, recordAndroidSession } = require('../utils/android-session-state');
const { withAndroidDeviceLock } = require('../utils/android-device-lock');
const { ENABLED_SOCIAL_PLATFORMS } = require('../utils/social-platforms');

const ANDROID_PLATFORMS = Object.keys(PLATFORM_PACKAGES).filter(platform => ENABLED_SOCIAL_PLATFORMS.includes(platform));
const IDENTITY_REQUIRED_PLATFORMS = new Set(['instagram', 'tiktok', 'x']);

const { recoverSavedTikTokLogin } = require('../utils/tiktok-login-recovery');

async function inspectSocialLogin(platform, {
  control,
  emulator,
  timeoutMs = 45000,
  sessionRoot,
  expectedHandle,
  restorePrevious = false,
  withLock = withAndroidDeviceLock,
  lockPath
} = {}) {
  if (!ANDROID_PLATFORMS.includes(platform)) {
    throw new Error(`plataforma desconhecida: ${platform || '(vazia)'}; opções: ${ANDROID_PLATFORMS.join(', ')}`);
  }
  const target = socialAndroidTarget(platform, { stateRoot: sessionRoot });
  control = control || target.control;
  emulator = emulator || target.emulator;
  lockPath = lockPath || target.lockPath;

  await emulator.acquire();
  try {
    const inspected = await withLock(
      async () => {
        const previous = restorePrevious ? control.getResumedActivity?.() : null;
        try {
          let session = await inspectAndroidAppSession({ control, platform, timeoutMs });
          if (platform === 'tiktok' && session.status === 'login_required'
            && await recoverSavedTikTokLogin(control, expectedHandle ?? process.env.ANDROID_SOCIAL_HANDLE_TIKTOK)) {
            session = await inspectAndroidAppSession({ control, platform, timeoutMs });
          }
          return session;
        }
        finally {
          if (previous?.startsWith('org.mozilla.firefox/') && control.shell) {
            control.shell(['am', 'start', '-n', previous, '-f', '0x00020000']);
          }
        }
      },
      { lockPath, owner: `android-login:${platform}` }
    );
    let result = inspected;
    let observedHandle = null;
    let identityVerified = false;
    if (inspected.status === 'logged_in' && IDENTITY_REQUIRED_PLATFORMS.has(platform)) {
      observedHandle = normalizeAccountHandle(inspected.accountHandle);
      const expected = normalizeAccountHandle(expectedHandle ?? process.env[`ANDROID_SOCIAL_HANDLE_${platform.toUpperCase()}`]);
      if (!expected) result = { ...inspected, status: 'identity_unconfirmed' };
      else if (!observedHandle) result = { ...inspected, status: 'identity_unavailable' };
      else if (observedHandle !== expected) result = { ...inspected, status: 'identity_mismatch' };
      else identityVerified = true;
    }
    if (inspected.status === 'logged_in') {
      recordAndroidSession(platform, {
        root: sessionRoot,
        device: control.device,
        accountHandle: observedHandle || inspected.accountHandle,
        ...(IDENTITY_REQUIRED_PLATFORMS.has(platform) ? { identityVerified } : {})
      });
      if (platform === 'kwai') emulator.confirmLogin?.();
    } else if (!['identity_unconfirmed', 'identity_unavailable', 'identity_mismatch'].includes(result.status)) {
      clearAndroidSession(platform, { root: sessionRoot });
      if (platform === 'kwai') emulator.revokeLogin?.();
    }
    return result;
  } catch (error) {
    clearAndroidSession(platform, { root: sessionRoot });
    if (platform === 'kwai') emulator.revokeLogin?.();
    throw error;
  } finally {
    emulator.release();
  }
}

function formatLoginResult(result) {
  const labels = {
    logged_in: IDENTITY_REQUIRED_PLATFORMS.has(result.platform)
      ? 'perfil próprio autenticado e identidade aprovada'
      : 'sessão autenticada no app',
    login_required: 'autenticação ou configuração inicial necessária',
    app_missing: 'app não instalado no emulador',
    app_crashed: 'app encerrou ao abrir; verificar compatibilidade antes de autenticar',
    unknown: 'perfil próprio não confirmado',
    identity_unconfirmed: 'sessão aberta; handle ainda não foi aprovado',
    identity_unavailable: 'perfil próprio aberto, handle não pôde ser lido',
    identity_mismatch: 'handle observado difere da conta aprovada'
  };
  return `${result.platform}: ${labels[result.status] || result.status} (${result.packageName})`;
}

async function main(args = process.argv.slice(2)) {
  const all = args.includes('--all');
  const platformIndex = args.indexOf('--platform');
  const platform = platformIndex >= 0 ? args[platformIndex + 1] : '';
  if (!all && !platform) {
    throw new Error('uso: npm run social:login -- --platform kwai|tiktok|instagram|x|telegram ou --all');
  }

  const results = [];
  for (const item of all ? ANDROID_PLATFORMS : [platform]) {
    results.push(await inspectSocialLogin(item));
  }
  for (const result of results) console.log(formatLoginResult(result));

  const incomplete = results.filter(result => result.status !== 'logged_in');
  if (incomplete.length) {
    console.log('Nenhum navegador foi aberto.');
    if (incomplete.some(result => ['login_required', 'unknown'].includes(result.status))) {
      console.log('Conclua a autenticação ou configuração inicial no Android; se a tela for desconhecida, abra o perfil próprio e rode novamente para confirmar a sessão.');
    }
    if (incomplete.some(result => result.status === 'app_crashed')) {
      console.log('O aplicativo encerrou durante a abertura; corrija a compatibilidade e teste novamente antes de tentar publicar.');
    }
    if (results.some(result => ['identity_unconfirmed', 'identity_unavailable', 'identity_mismatch'].includes(result.status))) {
      console.log('Para Instagram/TikTok/X, configure ANDROID_SOCIAL_HANDLE_<PLATAFORMA> somente com o handle aprovado; a conta não fica liberada sem correspondência exata.');
    }
    return 2;
  }
  return 0;
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; })
    .catch(error => { console.error('ERRO:', error.message); process.exitCode = 1; });
}

module.exports = { ANDROID_PLATFORMS, formatLoginResult, inspectSocialLogin, main, recoverSavedTikTokLogin };
