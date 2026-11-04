'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const test = require('node:test');
const { applyDelegatedPublicationReview } = require('../utils/delegated-publication-review');
const { publicationVisualGate } = require('../utils/publication-visual-gate');
const { verifyVideoQaManifest } = require('../utils/video-qa-manifest');
const { assessSourceEvidence, createPublicationReview } = require('../utils/source-evidence');
const { refreshPendingCovers } = require('../utils/refresh-pending-covers');

const clone = value => JSON.parse(JSON.stringify(value));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-delegated-review-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifestPath = 'data/reports/qa/vid_1123456789abcdef01234567.json';
  const ledgerPath = path.join(root, 'data/state/topics.json');
  const policyPath = path.join(root, 'config/publication-review-policy.json');
  for (const dir of ['config', 'data/videos', 'data/reports/qa', 'data/state']) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }
  await fs.writeFile(path.join(root, 'data/videos/master.mp4'), 'fixture master, not a real render');
  await fs.writeFile(path.join(root, 'data/videos/part.mp4'), 'fixture part, not a real render');
  await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#223344' } })
    .png().toFile(path.join(root, 'data/videos/cover.png'));
  const context = 'A reportagem descreve os fatos verificáveis e os limites da informação apresentada ao público. '.repeat(12);
  const sourceEvidence = assessSourceEvidence({ sourceTitle: 'Uma fonte verificável para o vídeo', sourceUrl: 'https://example.test/article', context });
  const publicationReview = createPublicationReview({ verdict: 'aprovado', sourceContext: context, reviewer: 'fixture-reviewer' });
  const assets = [];
  for (const [role, name] of [['master', 'master.mp4'], ['social_part', 'part.mp4']]) {
    const bytes = await fs.readFile(path.join(root, 'data/videos', name));
    assets.push({ role, path: `data/videos/${name}`, sha256: hash(bytes), sizeBytes: bytes.length,
      technical: { status: 'passed', issues: [], checks: {
        readableDuration: true, durationInRange: true, audioTrack: true, minimumFileSize: true
      } } });
  }
  const cover = await fs.readFile(path.join(root, 'data/videos/cover.png'));
  const manifest = { schemaVersion: 1, videoId: 'vid_1123456789abcdef01234567', technicalStatus: 'passed',
    sourceReview: { factualReviewStatus: 'approved', sourceHash: sourceEvidence.contextHash },
    visualReview: { status: 'pending' }, assets,
    thumbnail: { path: 'data/videos/cover.png', sha256: hash(cover), sizeBytes: cover.length,
      format: 'png', width: 1280, height: 720 } };
  const entry = { videoId: manifest.videoId, videoPath: 'data/videos/master.mp4', clips: [{ path: 'data/videos/part.mp4' }],
    qaManifestPath: manifestPath, publicationEligible: true, sourceEvidence, publicationReview,
    results: { clips: { 'data/videos/part.mp4': { kwai: { status: 'unknown', attemptCount: 14 } } } } };
  const policy = { schemaVersion: 1, id: 'owner-delegated-fixture', enabled: true,
    mode: 'owner-delegated-automatic', authorizedAt: '2026-10-18T14:00:00.000Z', instruction: 'Autorização de teste' };
  const save = async () => {
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    entry.qaManifestSha256 = hash(bytes);
    await fs.writeFile(path.join(root, manifestPath), bytes);
    await fs.writeFile(ledgerPath, JSON.stringify({ entries: [entry] }));
    await fs.writeFile(policyPath, JSON.stringify(policy));
  };
  await save();
  return { root, manifestPath, ledgerPath, policyPath, manifest, entry, policy, save,
    run: () => applyDelegatedPublicationReview({ root, manifestPath, ledgerPath }) };
}

test('owner-delegated policy releases every bound asset, records its basis and preserves uncertain publication', async t => {
  const f = await fixture(t);
  const result = await f.run();
  const ledger = JSON.parse(await fs.readFile(f.ledgerPath));
  const manifest = JSON.parse(await fs.readFile(path.join(f.root, f.manifestPath)));
  const verified = await verifyVideoQaManifest({ root: f.root, manifestPath: f.manifestPath,
    manifestSha256: ledger.entries[0].qaManifestSha256 });
  assert.equal(result.status, 'approved');
  assert.equal(manifest.visualReview.method, 'owner-delegated-automatic');
  assert.equal(manifest.visualReview.authorization.policySha256, hash(await fs.readFile(f.policyPath)));
  assert.equal(verified.visualReviewAssets.length, 3);
  assert.equal(publicationVisualGate(verified, path.join(f.root, f.entry.videoPath)).allowed, true);
  assert.deepEqual(ledger.entries[0].results, f.entry.results);
  assert.equal((await f.run()).status, 'unchanged');
  // Changing even one reviewed asset revokes the upload gate.
  await fs.appendFile(path.join(f.root, f.entry.videoPath), 'changed');
  await assert.rejects(f.run(), /asset_hash_changed/);
});

test('revisão inclui o master vertical registrado e verifica seu hash', async t => {
  const f = await fixture(t);
  const portraitPath = 'data/videos/portrait.mp4';
  const portraitBytes = Buffer.from('vertical master');
  await fs.writeFile(path.join(f.root, portraitPath), portraitBytes);
  const master = f.manifest.assets.find(asset => asset.role === 'master');
  f.manifest.assets.push({ ...clone(master), role: 'portrait_master', path: portraitPath,
    sha256: hash(portraitBytes), sizeBytes: portraitBytes.length });
  f.entry.portraitVideoPath = portraitPath;
  await f.save();
  assert.equal((await f.run()).status, 'approved');
  await fs.appendFile(path.join(f.root, portraitPath), 'changed');
  await assert.rejects(f.run(), /asset_hash_changed/);
});

test('verificação por subconjunto conserva checagem dos demais assets do manifesto', async t => {
  const f = await fixture(t);
  const result = await verifyVideoQaManifest({ root: f.root, manifestPath: f.manifestPath,
    manifestSha256: f.entry.qaManifestSha256, expectedPaths: [f.entry.videoPath], allowAdditionalManifestAssets: true });
  assert.equal(result.status, 'verified');
  await fs.appendFile(path.join(f.root, 'data/videos/part.mp4'), 'changed');
  const changed = await verifyVideoQaManifest({ root: f.root, manifestPath: f.manifestPath,
    manifestSha256: f.entry.qaManifestSha256, expectedPaths: [f.entry.videoPath], allowAdditionalManifestAssets: true });
  assert.deepEqual([changed.status, changed.reason], ['mismatch', 'asset_hash_changed']);
  const absent = await verifyVideoQaManifest({ root: f.root, manifestPath: f.manifestPath,
    manifestSha256: f.entry.qaManifestSha256, expectedPaths: ['data/videos/not-listed.mp4'], allowAdditionalManifestAssets: true });
  assert.deepEqual([absent.status, absent.reason], ['mismatch', 'asset_set_changed']);
});

test('troca de capas preserva o manifesto anterior e bloqueia alteração após tentativa', async t => {
  const f = await fixture(t);
  delete f.entry.results;
  await f.save();
  await fs.mkdir(path.join(f.root, 'data/images'), { recursive: true });
  const source = Buffer.from('source image proof');
  await fs.writeFile(path.join(f.root, 'data/images/source.jpg'), source);
  await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#004433' } })
    .png().toFile(path.join(f.root, 'data/videos/new-cover.png'));
  await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#004433' } })
    .png().toFile(path.join(f.root, 'data/videos/new-cover-portrait.png'));
  const oldHash = f.entry.qaManifestSha256;
  const options = { root: f.root, ledgerPath: f.ledgerPath, videoId: f.entry.videoId, expectedManifestSha256: oldHash,
    landscapePath: 'data/videos/new-cover.png', portraitPath: 'data/videos/new-cover-portrait.png',
    thumbnailSource: { articleUrl: 'https://example.test/a', imageUrl: 'https://example.test/a.jpg',
      imagePath: 'data/images/source.jpg', imageSha256: hash(source) } };
  const refreshed = await refreshPendingCovers(options);
  assert.notEqual(refreshed.manifestSha256, oldHash);
  assert.equal(hash(await fs.readFile(refreshed.backup)), oldHash);
  const entry = JSON.parse(await fs.readFile(f.ledgerPath)).entries[0];
  assert.equal(entry.qaManifestSha256, refreshed.manifestSha256);
  assert.equal((await verifyVideoQaManifest({ root: f.root, manifestPath: f.manifestPath,
    manifestSha256: entry.qaManifestSha256, expectedPaths: [entry.videoPath, entry.clips[0].path] })).status, 'verified');
  await assert.rejects(refreshPendingCovers(options), /mudança de manifesto/);
  entry.results = { long: { youtube: { status: 'unknown' } } };
  await fs.writeFile(f.ledgerPath, JSON.stringify({ entries: [entry] }));
  await assert.rejects(refreshPendingCovers({ ...options, expectedManifestSha256: refreshed.manifestSha256 }), /após tentativa/);
});

test('troca por ilustração não atribui uma imagem de fonte anterior', async t => {
  const f = await fixture(t);
  delete f.entry.results;
  f.entry.thumbnailSource = { articleUrl: 'https://example.test/old' };
  f.manifest.thumbnailSource = f.entry.thumbnailSource;
  await f.save();
  await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#004433' } })
    .png().toFile(path.join(f.root, 'data/videos/illustration.png'));
  await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#004433' } })
    .png().toFile(path.join(f.root, 'data/videos/illustration-portrait.png'));
  const result = await refreshPendingCovers({ root: f.root, ledgerPath: f.ledgerPath, videoId: f.entry.videoId,
    expectedManifestSha256: f.entry.qaManifestSha256, landscapePath: 'data/videos/illustration.png',
    portraitPath: 'data/videos/illustration-portrait.png' });
  const entry = JSON.parse(await fs.readFile(f.ledgerPath)).entries[0];
  const manifest = JSON.parse(await fs.readFile(path.join(f.root, f.manifestPath)));
  assert.equal(entry.thumbnailSource, undefined);
  assert.equal(manifest.thumbnailSource, undefined);
  assert.equal(entry.qaManifestSha256, result.manifestSha256);
});

test('rejeição visual vinculada ao hash impede liberação automática do master', async t => {
  const f = await fixture(t);
  const master = f.manifest.assets.find(asset => asset.role === 'master');
  await fs.writeFile(path.join(f.root, 'data/state/visual-publication-holds.json'), JSON.stringify({
    schemaVersion: 1, entries: [{ sha256: master.sha256, reason: 'sobreposição observada' }]
  }));
  const result = await f.run();
  assert.deepEqual([result.status, result.reason], ['held', 'visual_artifact_rejected']);
  const manifest = JSON.parse(await fs.readFile(path.join(f.root, f.manifestPath)));
  assert.equal(manifest.visualReview.status, 'pending');
  assert.equal(publicationVisualGate(await verifyVideoQaManifest({ root: f.root, manifestPath: f.manifestPath,
    manifestSha256: f.entry.qaManifestSha256 }), path.join(f.root, f.entry.videoPath)).allowed, false);
});

test('vídeo em render pode ser retido pelo job até revisão visual concreta', async t => {
  const f = await fixture(t);
  f.manifest.jobId = 'job-test-20261027';
  await f.save();
  await fs.writeFile(path.join(f.root, 'data/state/visual-publication-holds.json'), JSON.stringify({
    schemaVersion: 1, entries: [{ jobId: 'job-test-20261027', reason: 'revisão de composição pendente' }]
  }));
  const result = await f.run();
  assert.deepEqual([result.status, result.reason], ['held', 'visual_artifact_rejected']);
});

test('missing, disabled or malformed policy cannot release media', async t => {
  const f = await fixture(t);
  await fs.unlink(f.policyPath);
  assert.equal((await f.run()).status, 'disabled');
  f.policy.enabled = false;
  await f.save();
  assert.equal((await f.run()).status, 'disabled');
  f.policy.enabled = true;
  f.policy.mode = 'unrecognized';
  await f.save();
  await assert.rejects(f.run(), /invalid delegated/);
});

test('a critique recorded during rendering becomes a hash-bound rejection once, only for its scene plan', async t => {
  const f = await fixture(t);
  f.manifest.jobId = 'job-test-20261104';
  f.manifest.scenePlan = { schemaVersion: 1, sha256: 'b'.repeat(64), sceneIds: ['scene-02'] };
  await f.save();
  const hold = { jobId: f.manifest.jobId, sourceScenePlanSha256: 'c'.repeat(64), reason: 'personagens ilegíveis',
    critique: { schemaVersion: 1, findings: [{ sceneId: 'scene-02', category: 'composition', severity: 'high',
      issue: 'Personagem muito pequeno', recommendedFix: 'Enquadrar a ação e o personagem de perto',
      correction: { operation: 'reauthor-narrative' } }] } };
  const file = path.join(f.root, 'data/state/visual-publication-holds.json');
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, entries: [hold] }));
  await f.run();
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root, f.manifestPath))).visualReview.status, 'pending');
  hold.sourceScenePlanSha256 = f.manifest.scenePlan.sha256;
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, entries: [hold] }));
  await f.run();
  const reviewed = await fs.readFile(path.join(f.root, f.manifestPath), 'utf8');
  const manifest = JSON.parse(reviewed);
  assert.equal(manifest.visualReview.status, 'rejected');
  assert.equal(manifest.visualReview.rebuildRequired, true);
  assert.deepEqual(manifest.visualReview.critique.sceneIds, ['scene-02']);
  const entry = JSON.parse(await fs.readFile(f.ledgerPath)).entries[0];
  assert.equal(entry.qaManifestSha256, hash(Buffer.from(reviewed)));
  await f.run();
  assert.equal(await fs.readFile(path.join(f.root, f.manifestPath), 'utf8'), reviewed);
});

test('rejected facts, chronology, explicit holds and visual rejection stay held', async t => {
  const f = await fixture(t);
  const original = clone(f.entry);
  for (const patch of [
    { publicationEligible: false },
    { publicationReview: { ...original.publicationReview, status: 'rejected' } },
    { sourceChronologyReview: { status: 'rejected', sourceHash: original.sourceEvidence.contextHash } },
    { publicationHold: { reason: 'operator_hold' } }
  ]) {
    Object.keys(f.entry).forEach(key => delete f.entry[key]);
    Object.assign(f.entry, clone(original), patch);
    await f.save();
    assert.equal((await f.run()).status, 'held');
  }
  Object.keys(f.entry).forEach(key => delete f.entry[key]);
  Object.assign(f.entry, original);
  f.manifest.visualReview.status = 'rejected';
  await f.save();
  assert.equal((await f.run()).reason, 'review_rejected');
});

test('a rebuilt scene plan stays pending for fresh frame review and cannot be auto-approved', async t => {
  const f = await fixture(t);
  f.manifest.scenePlan = {
    schemaVersion: 1,
    sha256: 'a'.repeat(64),
    baseSha256: 'b'.repeat(64),
    sceneIds: ['s0_0'],
    rebuild: {
      sourceQaManifestSha256: 'c'.repeat(64),
      critiqueManifestSha256: 'd'.repeat(64),
      correctionSetSha256: 'e'.repeat(64),
      sourceScenePlanSha256: 'b'.repeat(64),
      sceneIds: ['s0_0'],
      correctionsApplied: 1
    }
  };
  await f.save();
  const result = await f.run();
  const verified = await verifyVideoQaManifest({ root: f.root, manifestPath: f.manifestPath,
    manifestSha256: f.entry.qaManifestSha256 });
  const manifest = JSON.parse(await fs.readFile(path.join(f.root, f.manifestPath)));
  assert.deepEqual([result.status, result.reason], ['held', 'visual_rebuild_requires_fresh_review']);
  assert.equal(manifest.visualReview.status, 'pending');
  assert.equal(verified.visualReview, 'pending');
  assert.equal(publicationVisualGate(verified, path.join(f.root, f.entry.videoPath)).allowed, false);
});

test('stale ledger hashes, a different source, missing thumbnail/checks and omitted parts fail closed', async t => {
  const f = await fixture(t);
  const original = clone(f.manifest);
  for (const mutate of [
    m => { m.sourceReview.sourceHash = 'b'.repeat(64); },
    m => { delete m.thumbnail; },
    m => { delete m.assets[0].technical.checks.audioTrack; },
    m => { m.assets.pop(); }
  ]) {
    Object.keys(f.manifest).forEach(key => delete f.manifest[key]);
    Object.assign(f.manifest, clone(original));
    mutate(f.manifest);
    await f.save();
    await assert.rejects(f.run());
  }
  Object.keys(f.manifest).forEach(key => delete f.manifest[key]);
  Object.assign(f.manifest, original);
  await f.save();
  await fs.appendFile(path.join(f.root, f.manifestPath), ' ');
  await assert.rejects(f.run(), /manifest_hash_changed/);
});
