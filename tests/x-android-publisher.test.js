'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ownXMenuIdentity, matchingXPost, xCaptionForInput, xTextWeight, publishXOnPage, withXAndroidPage } = require('../utils/x-android-publisher');
const handle = '@approved';
const time = Date.parse('2026-11-04T12:00:00Z');
const post = { author: handle, url: 'https://x.com/approved/status/1234', caption: 'Texto de teste',
  publishedAt: new Date(time).toISOString(), hasVideo: true };

test('identity requires the own account menu, logout and matching profile link', () => {
  const menu = { text: 'Conta\n@approved\nProfile\nLog out', profileHref: '/approved' };
  assert.equal(ownXMenuIdentity(menu, handle).status, 'logged_in');
  assert.equal(ownXMenuIdentity(menu, '@other').status, 'identity_mismatch');
  assert.equal(ownXMenuIdentity(menu, '').status, 'identity_unconfirmed');
  assert.equal(ownXMenuIdentity({ ...menu, text: '@approved\nProfile' }, handle).status, 'identity_unavailable');
  assert.equal(ownXMenuIdentity({ ...menu, profileHref: '/other' }, handle).status, 'identity_unavailable');
  assert.equal(ownXMenuIdentity({ ...menu, text: `${menu.text}\n@other` }, handle).status, 'identity_unavailable');
});
test('post evidence requires matching author, full caption, video, URL and submission time', () => {
  const criteria = { caption: post.caption, accountHandle: handle, submittedAt: new Date(time).toISOString(), now: time + 2000 };
  assert.deepEqual(matchingXPost([post], criteria), post);
  for (const delta of [{ author: '@other' }, { url: 'https://x.com/other/status/1234' },
    { caption: 'Outra legenda' }, { hasVideo: false }, { publishedAt: new Date(time - 5000).toISOString() },
    { publishedAt: new Date(time + 60000).toISOString() }]) {
    assert.equal(matchingXPost([{ ...post, ...delta }], criteria), null);
  }
  assert.equal(matchingXPost([post, { ...post, url: 'https://x.com/approved/status/5678' }], criteria), null);
});
test('caption shortening preserves the source URL and part number within the weighted limit', () => {
  const source = `https://example.com/${'artigo'.repeat(60)}`;
  const caption = xCaptionForInput(`Parte 2/3\n\n${'Descrição longa e fiel. '.repeat(30)}\n\nFonte: ${source}\n\n#tema`);
  assert(caption.startsWith('Parte 2/3'));
  assert(caption.endsWith(`Fonte: ${source}`));
  assert(xTextWeight(caption) <= 280);
  assert.equal(xCaptionForInput('café'), 'café');
});
function fixture(t, { failUpload = false, failClick = false, residual = false, ready = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-publisher-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const videoPath = path.join(dir, 'test.mp4'); fs.writeFileSync(videoPath, 'local media fixture');
  let value = residual ? 'rascunho do proprietário' : '', clicks = 0, uploads = 0, clock = time;
  const page = { goto: async () => {}, waitForFunction: async () => {}, evaluate: async () => ({ video: ready, pending: false, button: ready, text: '' }),
    locator: () => ({ count: async () => 0 }), getByTestId: id => ({
      waitFor: async () => {}, evaluate: async () => value, fill: async text => { value = text; },
      setInputFiles: async file => { uploads++; assert(Buffer.isBuffer(file.buffer)); if (failUpload) throw Error('upload error'); },
      click: async () => { assert.equal(id, 'tweetButton'); clicks++; if (failClick) throw Error('socket closed after server accepted'); }
    }) };
  const payload = { page, videoPath, caption: post.caption, accountHandle: handle,
    inspect: async () => ({ status: 'logged_in', accountHandle: handle }), findPost: async () => post,
    now: () => clock, wait: async ms => { clock += ms; }, timeoutMs: 2000 };
  return { payload, counts: () => ({ clicks, uploads }) };
}
test('successful submit clicks once and confirms only with observed evidence', async t => {
  const f = fixture(t), result = await publishXOnPage(f.payload);
  assert.equal(result.status, 'confirmed'); assert.equal(result.account, handle);
  assert.equal(result.url, post.url); assert.match(result.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.counts(), { clicks: 1, uploads: 1 });
});
test('wrong or missing account never selects media', async t => {
  const f = fixture(t);
  for (const inspect of [async () => ({ status: 'identity_unavailable' }), async () => ({ status: 'logged_in', accountHandle: '@other' })]) {
    const result = await publishXOnPage({ ...f.payload, inspect });
    assert.equal(result.evidence.kind, 'confirmed_no_send');
  }
  assert.deepEqual(f.counts(), { clicks: 0, uploads: 0 });
});
test('upload failure, unfinished processing and existing draft do not click Post', async t => {
  for (const options of [{ failUpload: true }, { ready: false }, { residual: true }]) {
    const f = fixture(t, options), result = await publishXOnPage(f.payload);
    assert.equal(result.status, 'failed'); assert.equal(result.evidence.kind, 'confirmed_no_send');
    assert.equal(result.failureCode, options.failUpload ? 'x_media_upload_failed'
      : options.residual ? 'x_existing_draft_failed' : 'x_media_readiness_failed');
    assert.equal(f.counts().clicks, 0);
  }
});
test('ambiguous click and failure while confirming never become safe-to-retry failures', async t => {
  for (const failClick of [true, false]) {
    const f = fixture(t, { failClick }), result = await publishXOnPage({ ...f.payload, findPost: async () => { throw Error('navigation failed'); } });
    assert.equal(result.status, 'unknown'); assert.equal(result.evidence.kind, 'submission_unverified');
    assert.equal(f.counts().clicks, 1); assert.equal(result.submittedAt, new Date(time).toISOString());
  }
  const f = fixture(t), result = await publishXOnPage({ ...f.payload, findPost: async () => null });
  assert.equal(result.status, 'submitted'); assert.equal(f.counts().clicks, 1);
});
test('browser connection uses the Android resolver under the shared lock and cleans up on error', async () => {
  const events = [], target = { device: 'emulator-5560', lockPath: '/test/lock',
    emulator: { acquire: async () => events.push('acquire'), release: () => events.push('release') } };
  const page = { setDefaultTimeout: () => {}, close: async () => events.push('close-page') };
  const options = { target, withLock: async (fn, opts) => { assert.equal(opts.lockPath, target.lockPath); events.push('lock'); return fn(); },
    connectBrowser: async opts => { assert.equal(opts.device, target.device); events.push('resolve-android'); return {
      contexts: () => [{ newPage: async () => page }], close: async () => events.push('disconnect') }; } };
  await assert.rejects(withXAndroidPage(async () => { throw Error('test'); }, options), /test/);
  assert.deepEqual(events, ['acquire', 'lock', 'resolve-android', 'close-page', 'disconnect', 'release']);
  events.length = 0;
  await assert.rejects(withXAndroidPage(async () => {}, { ...options, cdpUrl: 'https://remote.example' }), /CDP local/);
  assert.deepEqual(events, []);
});

test('reconciliation includes uncertain X masters and clips but excludes confirmed or changed identities', () => {
  const { reconciliationCandidates } = require('../utils/social-reconciliation');
  const previous = file => ({ platform: 'x', status: 'unknown', account: handle, submittedAt: new Date(time).toISOString(),
    artifact: { path: file, sha256: 'a'.repeat(64) } });
  const master = '/tmp/root/data/videos/main.mp4', clip = '/tmp/root/data/videos/clip.mp4';
  const entry = { videoPath: master, jobId: 'job', title: post.caption, clips: [{ path: clip, title: 'Parte 1' }],
    results: { long: { x: previous(master) }, clips: { [clip]: { x: previous(clip) } } } };
  const found = reconciliationCandidates([entry], 'x', handle, '/tmp/root');
  assert.deepEqual(found.map(c => c.scope).sort(), ['clip', 'long']);
  entry.results.long.x.status = 'confirmed';
  entry.results.clips[clip].x.account = '@other';
  assert.equal(reconciliationCandidates([entry], 'x', handle, '/tmp/root').length, 0);
});
