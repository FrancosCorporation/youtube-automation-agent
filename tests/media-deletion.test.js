'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { deleteMediaWithEvidence } = require('../utils/media-deletion');

test('confirmed media deletion records hash, owners and completion before returning', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-media-delete-'));
  const root = path.join(temporaryRoot, 'workspace');
  const mediaRoot = path.join(root, 'data', 'videos');
  const target = path.join(mediaRoot, 'posted.mp4');
  const ledger = path.join(root, 'data', 'state', 'media-deletions.jsonl');
  const bytes = Buffer.from('already confirmed publication');
  try {
    await fs.mkdir(mediaRoot, { recursive: true });
    await fs.writeFile(target, bytes);
    const result = await deleteMediaWithEvidence({
      root,
      filePath: target,
      allowedRoots: ['data/videos'],
      ledgerPath: ledger,
      disposition: { kind: 'published', reason: 'all required destinations confirmed' },
      ownerProofs: [{
        jobId: 'job-12345678', role: 'clip',
        reviewedAssetSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        reviewEvidencePath: 'docs/evidencias/review.json',
        destinations: [{ platform: 'instagram', status: 'confirmed' }]
      }]
    });
    assert.deepEqual({ deleted: result.deleted, bytes: result.bytes, sha256: result.sha256 }, {
      deleted: true, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    });
    await assert.rejects(fs.access(target), { code: 'ENOENT' });
    const records = (await fs.readFile(ledger, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.map(record => record.action), ['delete_prepared', 'delete_completed']);
    assert.equal(records[0].sha256, result.sha256);
    assert.equal(records[1].deletionId, records[0].deletionId);
    assert.equal(records[1].ownerProofs[0].destinations[0].platform, 'instagram');
    assert.equal(records[0].ownerProofs[0].reviewedAssetSha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(records[0].ownerProofs[0].reviewEvidencePath, 'docs/evidencias/review.json');
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});

test('media deletion rejects symlinks and paths outside explicit roots', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-media-delete-safe-'));
  const root = path.join(temporaryRoot, 'workspace');
  const mediaRoot = path.join(root, 'data', 'videos');
  const ledger = path.join(root, 'data', 'state', 'media-deletions.jsonl');
  const original = path.join(mediaRoot, 'original.mp4');
  const link = path.join(mediaRoot, 'linked.mp4');
  const outside = path.join(temporaryRoot, 'outside.mp4');
  try {
    await fs.mkdir(mediaRoot, { recursive: true });
    await fs.writeFile(original, 'keep');
    await fs.writeFile(outside, 'keep outside');
    await fs.symlink(original, link);
    const options = {
      root, allowedRoots: ['data/videos'], ledgerPath: ledger,
      disposition: { kind: 'authorized_demo', reason: 'disposable demo' }
    };
    await assert.rejects(deleteMediaWithEvidence({ ...options, filePath: link }), /symlink|resolve para fora/);
    await assert.rejects(deleteMediaWithEvidence({ ...options, filePath: outside }), /fora das raízes/);
    await fs.access(original);
    await fs.access(link);
    await fs.access(outside);
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});

test('media deletion refuses to remove bytes that differ from the publication hash', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-media-delete-hash-'));
  const root = path.join(temporaryRoot, 'workspace');
  const target = path.join(root, 'data', 'videos', 'changed.mp4');
  const ledgerPath = path.join(root, 'data', 'state', 'media-deletions.jsonl');
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'replacement bytes');
    await assert.rejects(deleteMediaWithEvidence({
      root,
      filePath: target,
      allowedRoots: ['data/videos'],
      ledgerPath,
      expectedSha256: crypto.createHash('sha256').update('uploaded bytes').digest('hex'),
      disposition: { kind: 'published', reason: 'confirmed artifact' }
    }), /não corresponde ao hash aprovado/);
    await fs.access(target);
    await assert.rejects(fs.access(ledgerPath), { code: 'ENOENT' });
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});
