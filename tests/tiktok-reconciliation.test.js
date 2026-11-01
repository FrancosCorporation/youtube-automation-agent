'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { publicTikTokPrivacy, uniqueCaptionCandidate, scanTikTokPublicPosts } = require('../utils/tiktok-reconciliation');
const { reconciliationCandidates } = require('../utils/social-reconciliation');
const prefix = 'com.zhiliaoapp.musically:id/';
const node = (id, text, x, y = 1, extra = {}) => ({ resourceId: prefix + id, text, x, y, clickable: true, ...extra });
const privacy = checked => [node('jpv', 'Who can watch this video', 0), node('zhu', 'Everyone', 2, 602),
  node('tss', '', 3, checked ? 602 : 694, { checked: true }), node('', '', 8, 1, { description: 'Close' })];

test('TikTok public proof requires the selected Everyone radio, not its label alone', () => {
  assert.equal(publicTikTokPrivacy(privacy(true)), true);
  assert.equal(publicTikTokPrivacy(privacy(false)), false);
  assert.equal(publicTikTokPrivacy(privacy(true).map(n => ({ ...n, checked: false }))), false);
});
test('TikTok caption proof rejects previews and duplicate candidate captions', () => {
  const candidates = [{ id: 'a', caption: 'Informação completa. Fonte: https://example.org #ia' }];
  assert.equal(uniqueCaptionCandidate(candidates, 'Informacao completa. Fonte: https://example.org #ia ').id, 'a');
  assert.equal(uniqueCaptionCandidate(candidates, 'Informação completa…more'), null);
  assert.equal(uniqueCaptionCandidate([...candidates, { ...candidates[0], id: 'b' }], candidates[0].caption), null);
});
test('TikTok scans an authenticated profile and confirms only exact public posts without Post', async () => {
  for (const isPublic of [true, false]) {
    let state = 'profile'; const taps = [], confirmed = [];
    const states = {
      profile: [node('t4s', '@owner', 0), node('', '', 0, 1, { description: 'Profile menu' }),
        node('', '', 0, 1, { description: 'Private videos' }), node('', '', 1, 1, { description: 'Videos' }), node('f2t', '', 2, 800)],
      detail: [node('desc', 'Exact complete caption', 3), node('syp', 'Privacy settings', 4), node('bs_', '', 5, 1, { description: 'Back' })],
      privacy: privacy(isPublic)
    };
    const control = {
      dumpUi: async () => states[state], isPackageInstalled: async () => true,
      getResumedActivity: () => 'com.zhiliaoapp.musically/Main',
      tap: async x => { taps.push(x); state = ({ 1: 'profile', 2: 'detail', 4: 'privacy', 8: 'detail', 5: 'profile' })[x] || state; }
    };
    await scanTikTokPublicPosts({ control, accountHandle: '@owner', candidates: [{ id: 'a', caption: 'Exact complete caption' }],
      wait: async () => {}, onConfirmed: async proof => confirmed.push(proof) });
    assert.equal(confirmed.length, isPublic ? 1 : 0);
    assert.equal(state, 'profile');
    assert(taps.every(x => [1, 2, 4, 8, 5].includes(x)));
  }
});
test('reconciliation candidates require the same account, artifact hash and uncertain submission', () => {
  const clip = { path: '/tmp/root/data/videos/clip.mp4', title: 'An approved title' };
  const previous = { status: 'unknown', platform: 'tiktok', account: 'owner', submittedAt: new Date().toISOString(),
    artifact: { path: clip.path, sha256: 'a'.repeat(64) } };
  const entry = { jobId: 'job', clips: [clip], results: { clips: { [clip.path]: { tiktok: previous } } } };
  assert.equal(reconciliationCandidates([entry], 'tiktok', '@owner', '/tmp/root').length, 1);
  assert.equal(reconciliationCandidates([entry], 'tiktok', '@different', '/tmp/root').length, 0);
  previous.status = 'attempting';
  assert.equal(reconciliationCandidates([entry], 'tiktok', '@owner', '/tmp/root').length, 0);
  previous.status = 'unknown'; previous.artifact.sha256 = '';
  assert.equal(reconciliationCandidates([entry], 'tiktok', '@owner', '/tmp/root').length, 0);
});
