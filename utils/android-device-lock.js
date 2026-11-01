'use strict';

const { acquireProcessFileLock, withProcessFileLock, processIsAlive } = require('./process-file-lock');

function androidOptions(options = {}) {
  return { ...options, owner: options.owner || 'android-social-upload' };
}

module.exports = {
  acquireAndroidDeviceLock: options => acquireProcessFileLock(androidOptions(options)),
  withAndroidDeviceLock: (callback, options) => withProcessFileLock(callback, androidOptions(options)),
  processIsAlive
};
