'use strict';

const { PLATFORM_PACKAGES, detectAppSession } = require('./android-emulator-control');

const X_PACKAGE = PLATFORM_PACKAGES.x;
const FIRST_RUN_PERMISSION_ACTIVITY = /(?:^|[/.])GrantPermissionsActivity(?:$|\s)/i;

const X_UPLOAD_UI_UNOBSERVED = 'x_upload_ui_unobserved';

function xUploadGate(state, blockers, extra = {}) {
  return {
    platform: 'x',
    state,
    uploadReady: false,
    accountIdentityVerified: false,
    submissionEnabled: false,
    blockers,
    ...extra
  };
}

function classifyXUploadUi({ packageName, resumedActivity, nodes } = {}) {
  if (packageName !== X_PACKAGE) {
    return xUploadGate('wrong_app', ['x_package_not_verified']);
  }

  const activity = String(resumedActivity || '').trim();
  if (FIRST_RUN_PERMISSION_ACTIVITY.test(activity)) {
    return xUploadGate('first_run_permission_gate', ['user_permission_decision_required']);
  }

  const foregroundPackage = activity.split('/', 1)[0];
  if (foregroundPackage !== X_PACKAGE) {
    return xUploadGate('foreground_unverified', ['x_not_confirmed_in_foreground']);
  }

  const visibleNodes = (Array.isArray(nodes) ? nodes : []).filter(node => node?.visible !== false);
  if (!visibleNodes.length) {
    return xUploadGate('hierarchy_unavailable', ['x_ui_hierarchy_unavailable']);
  }

  const sessionStatus = detectAppSession('x', visibleNodes);
  if (sessionStatus === 'login_required') {
    return xUploadGate('login_required', ['x_session_not_authenticated']);
  }
  if (sessionStatus === 'logged_in') {
    return xUploadGate('profile_signal_only', [
        'x_account_handle_unverified',
        X_UPLOAD_UI_UNOBSERVED
      ], { sessionStatus });
  }

  return xUploadGate('unknown', ['x_session_and_upload_ui_unverified']);
}

async function inspectXUploadUi({ control, packageName = X_PACKAGE } = {}) {
  if (!control || typeof control.isPackageInstalled !== 'function'
      || typeof control.getResumedActivity !== 'function' || typeof control.dumpUi !== 'function') {
    throw new TypeError('controle Android X inválido');
  }

  if (packageName !== X_PACKAGE) {
    return classifyXUploadUi({ packageName });
  }

  try {
    if (!await control.isPackageInstalled(X_PACKAGE)) {
      return xUploadGate('app_missing', ['x_android_app_missing']);
    }

    const before = await control.getResumedActivity();
    const earlyGate = classifyXUploadUi({ packageName, resumedActivity: before, nodes: [] });
    if (earlyGate.state !== 'hierarchy_unavailable') return earlyGate;

    const nodes = await control.dumpUi({ timeout: 15000 });
    const after = await control.getResumedActivity();
    if (String(before || '').trim() !== String(after || '').trim()) {
      return xUploadGate('foreground_changed', ['x_foreground_changed_during_inspection']);
    }
    return classifyXUploadUi({ packageName, resumedActivity: after, nodes });
  } catch (_error) {
    return xUploadGate('inspection_failed', ['x_ui_inspection_failed']);
  }
}

module.exports = {
  X_PACKAGE,
  X_UPLOAD_UI_UNOBSERVED,
  classifyXUploadUi,
  inspectXUploadUi
};
