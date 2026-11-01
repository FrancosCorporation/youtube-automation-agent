'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { withAndroidDeviceLock } = require('./android-device-lock');
const { createAndroidEmulatorControl, inspectAndroidAppSession } = require('./android-emulator-control');
const { createPublicationResult } = require('./publication-status');
const { socialAndroidTarget } = require('./android-social-target');
const { normalizeAccountHandle } = require('./android-session-state');
const { recoverSavedTikTokLogin } = require('./tiktok-login-recovery');

const SOCIAL_PLATFORMS = Object.freeze(['instagram', 'kwai', 'telegram', 'tiktok', 'x']);
const IDENTITY_REQUIRED_PLATFORMS = new Set(['instagram', 'tiktok', 'x']);

function createAndroidSocialPublisher(options = {}) {
  const handlers = options.handlers || {};
  const inspectSession = options.inspectSession || inspectAndroidAppSession;
  const allowUnknownSession = options.allowUnknownSession || (() => false);
  const recoverTikTokLogin = options.recoverTikTokLogin || recoverSavedTikTokLogin;
  const lock = options.withLock || withAndroidDeviceLock;

  return {
    async publish({ platform, videoPath, caption = '', ...metadata } = {}) {
      if (!SOCIAL_PLATFORMS.includes(platform)) throw new Error(`plataforma Android não permitida: ${platform || '(vazia)'}`);
      const target = options.control ? null : socialAndroidTarget(platform, { stateRoot: options.stateDir });
      const control = options.control || target?.control || createAndroidEmulatorControl(options.deviceOptions);
      const lockPath = options.lockPath || target?.lockPath || path.join(options.stateDir || process.env.STATE_DIR || path.join(__dirname, '..', 'data'), 'android-social-upload.lock');
      const source = path.resolve(String(videoPath || ''));
      if (!videoPath || !fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('arquivo de vídeo Android não encontrado');
      if (!/\.mp4$/i.test(source)) throw new Error('publicação Android exige MP4');

      return lock(async () => {
        const handler = handlers[platform];
        if (typeof handler !== 'function') {
          throw new Error(`${platform}: fluxo nativo Android ainda não configurado; nenhum navegador será aberto`);
        }
        let session = await inspectSession({ control, platform });
        if (session.status === 'app_missing') throw new Error(`${platform}: app ${session.packageName} não instalado no emulador; nenhum navegador será aberto`);
        const configuredHandle = options.expectedHandles?.[platform]
          ?? process.env[`ANDROID_SOCIAL_HANDLE_${platform.toUpperCase()}`];
        if (platform === 'tiktok' && session.status === 'login_required' && String(configuredHandle || '').trim()) {
          try {
            if (await recoverTikTokLogin(control, configuredHandle)) session = await inspectSession({ control, platform });
          } catch (_error) {
            return createPublicationResult({ platform, videoPath: source, status: 'failed',
              failureCode: 'android_session_unavailable',
              evidence: { kind: 'confirmed_no_send', observed: 'recuperação da sessão TikTok falhou antes do envio' } });
          }
        }
        if (session.status === 'logged_in' && IDENTITY_REQUIRED_PLATFORMS.has(platform)) {
          let expectedHandle = null;
          let observedHandle = null;
          try {
            expectedHandle = normalizeAccountHandle(configuredHandle);
            observedHandle = normalizeAccountHandle(session.accountHandle);
          } catch (_error) {
            // Invalid or unreadable identities fail closed before the handler.
          }
          if (!expectedHandle || !observedHandle || expectedHandle !== observedHandle) {
            return createPublicationResult({
              platform,
              videoPath: source,
              status: 'failed',
              failureCode: 'android_account_identity_unverified',
              evidence: {
                kind: 'confirmed_no_send',
                observed: 'perfil Android sem correspondência exata com o handle aprovado; envio não iniciado'
              }
            });
          }
        }
        let recovery = null;
        if (session.status === 'unknown') {
          try {
            recovery = await allowUnknownSession({ platform, session, control, videoPath: source, caption: String(caption) });
          } catch (error) {
            return createPublicationResult({
              platform,
              videoPath: source,
              status: 'failed',
              failureCode: 'pre_submit_ui_error',
              evidence: {
                kind: 'confirmed_no_send',
                observed: `retomada Android falhou antes de chamar o handler: ${String(error?.message || error).replace(/[\r\n\t]+/g, ' ').slice(0, 150)}`
              }
            });
          }
        }
        const handlerMayRecoverUnknown = recovery === true || recovery?.allow === true;
        if (session.status !== 'logged_in' && !handlerMayRecoverUnknown) {
          const isTransientUiState = session.status === 'unknown';
          return createPublicationResult({
            platform,
            videoPath: source,
            status: 'failed',
            failureCode: isTransientUiState ? 'pre_submit_ui_error' : 'android_session_unavailable',
            evidence: {
              kind: 'confirmed_no_send',
              observed: `pré-checagem Android terminou em ${session.status}; fluxo de publicação não foi iniciado`
            }
          });
        }

        return handler({
          control,
          platform,
          packageName: session.packageName,
          videoPath: source,
          caption: String(caption),
          ...metadata,
          ...(recovery?.handlerOptions || {})
        });
      }, { lockPath, owner: `android-upload:${platform}` });
    }
  };
}

module.exports = { SOCIAL_PLATFORMS, createAndroidSocialPublisher };
