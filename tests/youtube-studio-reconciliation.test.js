'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileClickedStudioPublication } = require('../utils/youtube-studio-reconciliation');

test('automatic Studio reconciliation only reads an already-clicked public submission', async () => {
  let reads = 0, checks = 0;
  const options = { readId: async () => { reads++; return 'AbCdEfGh123'; },
    waitForRow: async id => { checks++; return { videoId: id }; } };
  assert.equal(await reconcileClickedStudioPublication({ ...options, publishClicked: false, privacyStatus: 'public' }), null);
  assert.equal(await reconcileClickedStudioPublication({ ...options, publishClicked: true, privacyStatus: 'private' }), null);
  assert.deepEqual([reads, checks], [0, 0]);
  assert.deepEqual(await reconcileClickedStudioPublication({ ...options, publishClicked: true, privacyStatus: 'public' }), { videoId: 'AbCdEfGh123' });
  assert.deepEqual([reads, checks], [1, 1]);
});

test('missing, invalid or different video IDs do not become confirmation', async () => {
  let checks = 0;
  assert.equal(await reconcileClickedStudioPublication({ publishClicked: true, privacyStatus: 'public', readId: async () => 'bad',
    waitForRow: async () => { checks++; } }), null);
  assert.equal(checks, 0);
  assert.equal(await reconcileClickedStudioPublication({ publishClicked: true, privacyStatus: 'public', readId: async () => 'AbCdEfGh123',
    waitForRow: async () => ({ videoId: 'OtherVid123' }) }), null);
  assert.equal(await reconcileClickedStudioPublication({ publishClicked: true, privacyStatus: 'public', readId: async () => 'AbCdEfGh123',
    waitForRow: async () => null }), null);
});
