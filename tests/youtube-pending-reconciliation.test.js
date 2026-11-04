'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { expectedChannelId } = require('../config/youtube-studio.json');
const { studioReconciliationCandidates, reconcilePendingStudioPublications } = require('../utils/youtube-pending-reconciliation');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-pending-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'data/state'), { recursive: true });
  await fs.mkdir(path.join(root, 'data/videos'), { recursive: true });
  const file = 'data/videos/master.mp4';
  await fs.writeFile(path.join(root, file), 'video bytes');
  const result = { status: 'unknown', platform: 'youtube', account: expectedChannelId,
    externalId: 'AbCdEfGh123', artifact: { path: file, sha256: crypto.createHash('sha256').update('video bytes').digest('hex') },
    submittedAt: new Date().toISOString(), failureCode: 'youtube_studio_outcome_unknown' };
  const entry = { jobId: 'test-job', videoPath: file, results: { long: { youtube: result } } };
  const ledgerPath = path.join(root, 'data/state/topics.json');
  await fs.writeFile(ledgerPath, JSON.stringify({ entries: [entry] }));
  return { root, entry, result, ledgerPath, env: { STATE_DIR: 'data/state' } };
}

test('pending Studio confirmation survives restart, binds channel/hash/ID and never resends', async t => {
  const f = await fixture(t);
  let checks = 0;
  const report = await reconcilePendingStudioPublications({ ...f, inspect: async candidate => {
    checks++; return { videoId: candidate.result.externalId, screenshotPath: 'proof.png' };
  } });
  assert.equal(report.confirmed.length, 1);
  const saved = JSON.parse(await fs.readFile(f.ledgerPath)).entries[0].results.long.youtube;
  assert.equal(saved.status, 'confirmed');
  assert.equal(saved.artifact.sha256, f.result.artifact.sha256);
  assert.equal(saved.submittedAt, f.result.submittedAt);
  assert.equal(saved.failureCode, undefined);
  await reconcilePendingStudioPublications({ ...f, inspect: async () => { checks++; } });
  assert.equal(checks, 1);
});

test('missing or mismatching row, media or identity stays unknown', async t => {
  for (const observation of [null, { videoId: 'OtherVid123' }]) {
    const f = await fixture(t);
    const report = await reconcilePendingStudioPublications({ ...f, inspect: async () => observation });
    assert.equal(report.confirmed.length, 0);
    assert.equal(JSON.parse(await fs.readFile(f.ledgerPath)).entries[0].results.long.youtube.status, 'unknown');
  }
  const f = await fixture(t);
  for (const change of [{ account: 'another' }, { externalId: null }, { platform: 'shorts' }]) {
    const changed = { ...f.entry, results: { long: { youtube: { ...f.result, ...change } } } };
    assert.equal(studioReconciliationCandidates([changed], f.root, expectedChannelId).length, 0);
  }
  await fs.appendFile(path.join(f.root, f.entry.videoPath), 'changed');
  let checks = 0;
  await reconcilePendingStudioPublications({ ...f, inspect: async () => { checks++; } });
  assert.equal(checks, 0);
});
