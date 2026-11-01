'use strict';

async function checkAndroidInternalStorage(control, minimumBytes) {
  try {
    const output = String(await control.shell(['df', '-Pk', '/data'], { timeout: 10000 }));
    const fields = output.trim().split(/\r?\n/).at(-1)?.trim().split(/\s+/) || [];
    const freeKiB = Number(fields[3]);
    if (!Number.isSafeInteger(freeKiB) || freeKiB < 0) return null;
    return freeKiB * 1024 >= minimumBytes;
  } catch (_error) {
    // Device startup and the upload's own preflight still handle unavailable ADB.
    return null;
  }
}

// Caller owns the device lock. Android decides which disposable caches to trim;
// never clear app data, remove apps, drafts, sessions or the staged media archive.
async function recoverAndroidInternalStorage(control, minimumBytes) {
  if (!Number.isSafeInteger(minimumBytes) || minimumBytes <= 0 || minimumBytes > 2 * 1024 ** 3) {
    throw new RangeError('reserva de armazenamento Android inválida');
  }
  const before = await checkAndroidInternalStorage(control, minimumBytes);
  if (before !== false) return before;
  try {
    await control.shell(['pm', 'trim-caches', String(Math.max(1024 ** 3, minimumBytes)), 'internal'], { timeout: 30000 });
  } catch { /* The uploader retains its no-send storage failure if cache reclaim fails. */ }
  return checkAndroidInternalStorage(control, minimumBytes);
}

function createSocialReadiness({ hasHandler, isSessionFresh, inspectSession, preflight = async () => null, disabled = [], now = Date.now } = {}) {
  const pending = new Map();
  const failedChecks = new Map();
  const disabledSet = new Set(disabled);
  return async function ensureSocialReady(platform) {
    if (disabledSet.has(platform)) return { platform, ready: false, status: 'disabled' };
    if (!hasHandler(platform)) return { platform, ready: false, status: 'handler_unavailable' };
    const blocked = await preflight(platform);
    if (blocked) return { platform, ready: false, status: blocked };
    if (isSessionFresh(platform)) return { platform, ready: true, status: 'logged_in' };
    if (pending.has(platform)) return pending.get(platform);
    const cached = failedChecks.get(platform);
    if (cached && now() < cached.until) return cached.result;
    const check = (async () => {
      let result;
      try {
        const inspected = await inspectSession(platform);
        result = { ...inspected, platform, ready: inspected.status === 'logged_in' };
      } catch (error) {
        result = { platform, ready: false, status: 'session_check_failed', errorCode: error.code || 'android_session_check_failed' };
      }
      if (!result.ready) failedChecks.set(platform, { result, until: now() + 60000 });
      else failedChecks.delete(platform);
      return result;
    })();
    pending.set(platform, check);
    try { return await check; }
    finally { pending.delete(platform); }
  };
}

function socialReadinessDescription(status) {
  return ({
    disabled: 'destino excluído da publicação',
    handler_unavailable: 'rotina nativa de publicação ainda indisponível',
    app_missing: 'aplicativo não instalado no Android configurado',
    login_required: 'aplicativo exige autenticação da conta ou conclusão da configuração inicial',
    unknown: 'não foi possível reconhecer uma sessão autenticada no aplicativo',
    identity_unconfirmed: 'sessão aberta, mas o handle esperado ainda não foi aprovado',
    identity_unavailable: 'perfil próprio aberto, mas o handle não pôde ser lido',
    identity_mismatch: 'o handle do perfil não corresponde à conta aprovada',
    storage_insufficient: 'armazenamento interno insuficiente para abrir o aplicativo e processar o vídeo',
    session_check_failed: 'não foi possível consultar a sessão Android'
  })[status] || 'sessão Android não validada';
}

module.exports = { checkAndroidInternalStorage, recoverAndroidInternalStorage, createSocialReadiness, socialReadinessDescription };
