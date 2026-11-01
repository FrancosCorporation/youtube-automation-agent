'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ownPostCaptions, scanInstagramPosts } = require('../utils/instagram-reconciliation');
const n = (id, text, x, extra = {}) => ({ resourceId: id ? `com.instagram.android:id/${id}` : '', text, x, y: 600, clickable: true, ...extra });
const post = caption => [n('action_bar_title', 'Posts', 10), n('row_feed_photo_profile_name', 'owner', 11),
  n('action_bar_button_back', '', 9), n('inline_insights_container', '', 12), n('', `owner ${caption}`, 13, { clickable: false })];
test('Instagram proof requires own Posts, insights and complete caption', () => {
  assert.deepEqual(ownPostCaptions(post('Complete caption less'), 'owner'), ['Complete caption']);
  assert.deepEqual(ownPostCaptions(post('Complete… more'), 'owner'), []);
  assert.deepEqual(ownPostCaptions(post('Complete caption'), 'another'), []);
  assert.deepEqual(ownPostCaptions(post('Complete caption less').filter(node => !node.resourceId.endsWith('/row_feed_photo_profile_name')), 'owner'), ['Complete caption']);
  assert.deepEqual(ownPostCaptions(post('Complete caption').filter(node => !node.resourceId.endsWith('/inline_insights_container')), 'owner'), []);
});
test('Instagram reconciles full captions from its own Posts view without sharing', async () => {
  let state = 'profile'; const confirmed = [], actions = [];
  const states = {
    profile: [n('action_bar_title', 'owner', 1), n('button_container', '', 2, { description: 'Edit profile' }),
      n('image_button', '', 3, { description: 'Reel by Owner at row 1, column 1' })],
    post: post('Exact caption… more').concat(n('', '', 4, { description: 'more' })),
    expanded: post('Exact caption with source less')
  };
  const control = { dumpUi: async () => states[state], isPackageInstalled: async () => true,
    getResumedActivity: () => 'com.instagram.android/Main',
    tap: async x => { actions.push(x); state = ({ 3: 'post', 4: 'expanded', 9: 'profile' })[x] || state; } };
  await scanInstagramPosts({ control, accountHandle: 'owner', candidates: [{ id: 'one', caption: 'Exact caption with source' }],
    wait: async () => {}, capture: async () => 'proof.png', onConfirmed: async proof => confirmed.push(proof) });
  assert.equal(confirmed.length, 1); assert.equal(confirmed[0].captionScreenshot, 'proof.png');
  assert.deepEqual(actions, [3, 4, 9]); assert.equal(state, 'profile');
});
test('Instagram refuses a different signed-in account before navigation', async () => {
  const control = { dumpUi: async () => [n('action_bar_title', 'another', 1), n('button_container', 'Edit profile', 2)],
    isPackageInstalled: async () => true, getResumedActivity: () => 'com.instagram.android/Main',
    tap: async () => { throw new Error('must not navigate'); } };
  await assert.rejects(scanInstagramPosts({ control, accountHandle: 'owner', candidates: [] }), /não corresponde/);
});
