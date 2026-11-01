'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  X_PACKAGE,
  X_UPLOAD_UI_UNOBSERVED,
  classifyXUploadUi,
  inspectXUploadUi
} = require('../utils/x-upload-flow');

const xActivity = `${X_PACKAGE}/ObservedOnlyAsPackage`;

test('X upload parser fails closed for the observed Android first-run permission gate', () => {
  const result = classifyXUploadUi({
    packageName: X_PACKAGE,
    resumedActivity: 'com.android.permissioncontroller/.GrantPermissionsActivity',
    nodes: []
  });

  assert.equal(result.state, 'first_run_permission_gate');
  assert.equal(result.uploadReady, false);
  assert.deepEqual(result.blockers, ['user_permission_decision_required']);
});

test('X upload parser rejects an unverified package or foreground app', () => {
  assert.deepEqual(classifyXUploadUi({
    packageName: 'com.example.app',
    resumedActivity: xActivity,
    nodes: [{ text: 'Edit profile', visible: true }]
  }), {
    platform: 'x', state: 'wrong_app', uploadReady: false,
    accountIdentityVerified: false, submissionEnabled: false,
    blockers: ['x_package_not_verified']
  });

  assert.equal(classifyXUploadUi({
    packageName: X_PACKAGE,
    resumedActivity: 'com.instagram.android/SomeActivity',
    nodes: [{ text: 'Edit profile', visible: true }]
  }).state, 'foreground_unverified');
});

test('X upload parser leaves missing hierarchy and unknown session blocked', () => {
  assert.equal(classifyXUploadUi({
    packageName: X_PACKAGE,
    resumedActivity: xActivity,
    nodes: []
  }).state, 'hierarchy_unavailable');

  assert.equal(classifyXUploadUi({
    packageName: X_PACKAGE,
    resumedActivity: xActivity,
    nodes: [{ text: 'Home', visible: true }]
  }).state, 'unknown');

  assert.equal(classifyXUploadUi({
    packageName: X_PACKAGE,
    resumedActivity: xActivity,
    nodes: [{ text: 'Log in', visible: true }]
  }).state, 'login_required');

  assert.equal(classifyXUploadUi({
    packageName: X_PACKAGE,
    resumedActivity: xActivity,
    nodes: [{ text: 'Edit profile', visible: false }]
  }).state, 'hierarchy_unavailable');
});

test('an existing session signal is not enough to authorize X upload', () => {
  const result = classifyXUploadUi({
    packageName: X_PACKAGE,
    resumedActivity: xActivity,
    nodes: [{ text: 'Edit profile', visible: true }]
  });

  assert.equal(result.state, 'profile_signal_only');
  assert.equal(result.sessionStatus, 'logged_in');
  assert.equal(result.uploadReady, false);
  assert.deepEqual(result.blockers, ['x_account_handle_unverified', X_UPLOAD_UI_UNOBSERVED]);
});

test('X UI inspection uses only read methods and fails closed on read errors', async () => {
  const calls = [];
  const result = await inspectXUploadUi({
    control: {
      async getResumedActivity() { calls.push('activity'); return xActivity; },
      async dumpUi(options) { calls.push(['hierarchy', options.timeout]); return [{ text: 'Home', visible: true }]; },
      async isPackageInstalled(packageName) { calls.push(['package', packageName]); return true; },
      tap() { throw new Error('must not interact'); },
      openApp() { throw new Error('must not launch'); },
      pushVideo() { throw new Error('must not stage media'); }
    }
  });

  assert.equal(result.state, 'unknown');
  assert.equal(result.uploadReady, false);
  assert.deepEqual(calls, [['package', X_PACKAGE], 'activity', ['hierarchy', 15000], 'activity']);

  let activityReads = 0;
  const changed = await inspectXUploadUi({ control: {
    async isPackageInstalled() { return true; },
    async getResumedActivity() { activityReads++; return `${X_PACKAGE}/Activity${activityReads}`; },
    async dumpUi() { return [{ text: 'Edit profile', visible: true }]; }
  } });
  assert.equal(changed.state, 'foreground_changed');

  const missing = await inspectXUploadUi({ control: {
    async isPackageInstalled() { return false; },
    async getResumedActivity() { throw new Error('must not inspect a missing app'); },
    async dumpUi() { throw new Error('must not inspect a missing app'); }
  } });
  assert.equal(missing.state, 'app_missing');
  assert.equal(missing.submissionEnabled, false);

  const failed = await inspectXUploadUi({ control: {
    async isPackageInstalled() { return true; },
    async getResumedActivity() { throw new Error('sensitive diagnostics hidden'); },
    async dumpUi() { return []; }
  } });
  assert.equal(failed.state, 'inspection_failed');
  assert.deepEqual(failed.blockers, ['x_ui_inspection_failed']);
});
