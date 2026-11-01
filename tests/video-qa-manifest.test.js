'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const test = require('node:test');
const {
  buildEditorialMetadata, inspectThumbnailArtifact, inspectScriptCache, inspectSceneImageAssets,
  normalizeReplaySourceContext, normalizeScenePlanEvidence, normalizeSceneReferences,
  verifyArtifactOwnersForPublication, verifyPublicationAssetBinding, verifyVideoQaManifest
} = require('../utils/video-qa-manifest');
const { assessSourceEvidence, createPublicationReview, hashSourceContext } = require('../utils/source-evidence');

test('prova de ritmo visual fica vinculada ao hash do plano validado', () => {
  const sha256 = 'a'.repeat(64);
  const plan = { schemaVersion: 1, sha256, sceneIds: ['scene-01'], visualRhythm: {
    schemaVersion: 1, rule: 'long-cue-shot-variation-v1', status: 'passed', planSha256: sha256 } };
  assert.deepEqual(normalizeScenePlanEvidence(plan).visualRhythm, plan.visualRhythm);
  assert.throws(() => normalizeScenePlanEvidence({ ...plan, visualRhythm: { ...plan.visualRhythm, planSha256: 'b'.repeat(64) } }), /visual rhythm/);
});

test('editorial QA metadata records hook shape without adding runtime identifiers to the speech', () => {
  const metadata = buildEditorialMetadata({
    themeId: 'psicologia',
    topic: 'Sono e memória',
    targetWords: 950,
    formatId: 'context-change-result',
    formatVersion: 1,
    scriptRevision: 'retention-emotions-v24-hook-timing-audit',
    hook: 'Por que o sono muda a forma de guardar memórias?',
    hookStructureId: 'mecanismo-explicado',
    visualMode: 'graphics-and-source-prints'
  });
  assert.equal(metadata.hookWordCount, 10);
  assert.equal(metadata.topic, 'Sono e memória');
  assert.equal(metadata.targetWords, 950);
  assert.equal(metadata.hookStructureId, 'mecanismo-explicado');
  assert.equal(metadata.scriptRevision, 'retention-emotions-v24-hook-timing-audit');
  assert.equal(metadata.experimentId, null);
  assert.equal(metadata.visualMode, 'graphics-and-source-prints');
  assert.equal(buildEditorialMetadata({ visualMode: 'unreviewed-user-input' }).visualMode, 'unknown');
});

test('visual rebuild replay inputs are path-bounded, hash-bound and normalized', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-video-replay-inputs-'));
  const scriptPath = path.join(root, 'data', 'scripts', 'source.json');
  const metadataPath = `${scriptPath}.meta.json`;
  const imagePath = path.join(root, 'data', 'images', 'source', 'g0a.png');
  const context = 'A fonte capturada permanece idêntica para repetir o planejamento visual.';
  try {
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    const script = Buffer.from('{"hook":"Abertura"}');
    const metadata = Buffer.from('{"revision":"v1"}');
    await fs.writeFile(scriptPath, script);
    await fs.writeFile(metadataPath, metadata);
    await sharp({ create: { width: 32, height: 32, channels: 3, background: '#345678' } }).png().toFile(imagePath);
    const imageBytes = await fs.readFile(imagePath);
    const cache = await inspectScriptCache({ root, scriptCache: { path: scriptPath, metadataPath } });
    assert.equal(cache.script.sha256, crypto.createHash('sha256').update(script).digest('hex'));
    assert.equal(cache.metadata.sha256, crypto.createHash('sha256').update(metadata).digest('hex'));
    assert.deepEqual(await inspectSceneImageAssets({ root, assets: [{
      groupIndex: 0, variant: 'a', path: imagePath,
      sha256: crypto.createHash('sha256').update(imageBytes).digest('hex')
    }] }), [{ groupIndex: 0, variant: 'a', path: 'data/images/source/g0a.png',
      sha256: crypto.createHash('sha256').update(imageBytes).digest('hex') }]);
    const beatSha256 = 'b'.repeat(64);
    const [boundImage] = await inspectSceneImageAssets({ root, assets: [{
      groupIndex: 0, variant: 'a', path: imagePath,
      sha256: crypto.createHash('sha256').update(imageBytes).digest('hex'), beatSha256
    }] });
    assert.equal(boundImage.beatSha256, beatSha256);
    await assert.rejects(inspectSceneImageAssets({ root, assets: [{
      groupIndex: 0, variant: 'a', path: imagePath,
      sha256: crypto.createHash('sha256').update(imageBytes).digest('hex'), beatSha256: 'bad'
    }] }), /beat hash is invalid/);
    assert.equal(normalizeReplaySourceContext(context, hashSourceContext(context)), context);
    assert.deepEqual(normalizeSceneReferences({ newsItems: [], prints: [] }), {
      schemaVersion: 1, newsItems: [], prints: []
    });
    await assert.rejects(inspectSceneImageAssets({ root, assets: [{
      groupIndex: 0, variant: 'a', path: imagePath, sha256: 'a'.repeat(64)
    }] }), /hash changed/);
    assert.throws(() => normalizeReplaySourceContext(context, 'a'.repeat(64)), /hash does not match/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-video-qa-'));
  const mediaPath = path.join(root, 'data', 'videos', 'master.mp4');
  const thumbnailPath = path.join(root, 'data', 'videos', 'thumb_master.png');
  const manifestPath = path.join(root, 'data', 'reports', 'qa', 'vid_0123456789abcdef01234567.json');
  await fs.mkdir(path.dirname(mediaPath), { recursive: true });
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(mediaPath, 'fixture media bytes');
  await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#223344' } })
    .png().toFile(thumbnailPath);
  const assetHash = crypto.createHash('sha256').update('fixture media bytes').digest('hex');
  const thumbnailBytes = await fs.readFile(thumbnailPath);
  const thumbnailHash = crypto.createHash('sha256').update(thumbnailBytes).digest('hex');
  const manifest = {
    schemaVersion: 1,
    videoId: 'vid_0123456789abcdef01234567',
    editorial: { formatId: 'case-study', visualMode: 'mixed-generated-scenes' },
    visualReview: { status: 'pending' },
    technicalStatus: 'passed',
    assets: [{ role: 'master', path: 'data/videos/master.mp4', sha256: assetHash, technical: { status: 'passed' } }],
    thumbnail: {
      path: 'data/videos/thumb_master.png',
      sha256: thumbnailHash,
      sizeBytes: thumbnailBytes.length,
      format: 'png',
      width: 1280,
      height: 720
    }
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  const manifestSha256 = crypto.createHash('sha256').update(await fs.readFile(manifestPath)).digest('hex');
  return { root, mediaPath, thumbnailPath, manifestPath, manifest, manifestSha256 };
}

test('verifies manifest, artifact hash and exact expected asset set', async () => {
  const state = await fixture();
  try {
    const result = await verifyVideoQaManifest({
      root: state.root,
      manifestPath: path.relative(state.root, state.manifestPath),
      manifestSha256: state.manifestSha256,
      expectedPaths: [state.mediaPath]
    });
    assert.equal(result.status, 'verified');
    assert.equal(result.visualReview, 'pending');
    assert.equal(result.formatId, 'case-study');
    assert.equal(result.visualMode, 'mixed-generated-scenes');
    assert.equal(result.assets, 1);
    assert.deepEqual(result.assetProofs, [{
      role: 'master', path: state.mediaPath, sha256: state.manifest.assets[0].sha256,
      sizeBytes: state.manifest.assets[0].sizeBytes
    }]);
    assert.equal(result.masterPath, state.mediaPath);
    assert.equal(result.thumbnail.path, state.thumbnailPath);
    assert.equal(result.thumbnail.width, 1280);
    assert.equal(result.thumbnail.height, 720);
  } finally { await fs.rm(state.root, { recursive: true, force: true }); }
});

test('rejects old QA manifests whose narration switched TTS provider mid-video', async () => {
  const state = await fixture();
  try {
    state.manifest.narrationTiming = {
      groupCount: 7,
      providers: { 'edge-tts': 4, gtts: 3 }
    };
    await fs.writeFile(state.manifestPath, `${JSON.stringify(state.manifest)}\n`);
    const bytes = await fs.readFile(state.manifestPath);
    const result = await verifyVideoQaManifest({
      root: state.root,
      manifestPath: path.relative(state.root, state.manifestPath),
      manifestSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      expectedPaths: [state.mediaPath]
    });
    assert.deepEqual([result.status, result.reason], ['invalid', 'narration_provider_mix']);
  } finally { await fs.rm(state.root, { recursive: true, force: true }); }
});

test('publication asset binding requires current eligibility and exact hash-bound factual/visual QA', async () => {
  const state = await fixture();
  try {
    const context = 'A fonte oficial apresenta fatos verificáveis, números observados e limitações claras para a interpretação do estudo. '.repeat(5);
    const sourceEvidence = assessSourceEvidence({
      sourceTitle: 'Fonte oficial com fatos verificáveis', sourceUrl: 'https://example.test/article', context
    });
    state.manifest.sourceReview = {
      factualReviewStatus: 'approved',
      sourceHash: sourceEvidence.contextHash
    };
    state.manifest.visualReview = {
      status: 'approved',
      approvedAssets: [{ path: 'data/videos/master.mp4', sha256: state.manifest.assets[0].sha256 }]
    };
    await fs.writeFile(state.manifestPath, `${JSON.stringify(state.manifest)}\n`);
    const manifestBytes = await fs.readFile(state.manifestPath);
    const entry = {
      videoPath: 'data/videos/master.mp4',
      publicationEligible: true,
      sourceEvidence,
      publicationReview: createPublicationReview({ verdict: 'aprovado', sourceContext: context, reviewer: 'independent-reviewers' }),
      qaManifestPath: path.relative(state.root, state.manifestPath),
      qaManifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex')
    };
    const expectedSha256 = state.manifest.assets[0].sha256;
    const binding = await verifyPublicationAssetBinding({
      root: state.root, entry, artifactPath: state.mediaPath, expectedSha256
    });
    assert.equal(binding.status, 'verified');
    assert.deepEqual(await verifyArtifactOwnersForPublication({
      root: state.root, entries: [entry], artifactPath: state.mediaPath, expectedSha256
    }), { status: 'verified', owners: 1, artifactSha256: expectedSha256 });

    await fs.writeFile(state.mediaPath, 'replacement bytes with a different hash');
    const changed = await verifyPublicationAssetBinding({
      root: state.root, entry, artifactPath: state.mediaPath,
      expectedSha256: crypto.createHash('sha256').update('replacement bytes with a different hash').digest('hex')
    });
    assert.deepEqual([changed.status, changed.reason], ['mismatch', 'asset_hash_changed']);
    entry.publicationEligible = false;
    const ineligible = await verifyPublicationAssetBinding({
      root: state.root, entry, artifactPath: state.mediaPath, expectedSha256
    });
    assert.deepEqual([ineligible.status, ineligible.reason], ['ineligible', 'publication_eligibility_not_current']);
  } finally { await fs.rm(state.root, { recursive: true, force: true }); }
});

test('thumbnail inspection records only managed 1280x720 PNG artifacts', async () => {
  const state = await fixture();
  const wrongSizePath = path.join(state.root, 'data', 'videos', 'wrong-size.png');
  try {
    const result = await inspectThumbnailArtifact({ root: state.root, filePath: state.thumbnailPath });
    assert.equal(result.path, 'data/videos/thumb_master.png');
    assert.equal(result.sha256, state.manifest.thumbnail.sha256);
    assert.equal(result.sizeBytes, state.manifest.thumbnail.sizeBytes);
    assert.equal(result.width, 1280);
    assert.equal(result.height, 720);

    await sharp({ create: { width: 640, height: 360, channels: 3, background: '#223344' } })
      .png().toFile(wrongSizePath);
    await assert.rejects(
      inspectThumbnailArtifact({ root: state.root, filePath: wrongSizePath }),
      /thumbnail must be a 1280x720 PNG/
    );
  } finally { await fs.rm(state.root, { recursive: true, force: true }); }
});

test('returns only hash-bound assets included in an explicit visual-review scope', async () => {
  const state = await fixture();
  try {
    state.manifest.visualReview = {
      status: 'approved',
      approvedAssets: [
        { path: 'data/videos/master.mp4', sha256: state.manifest.assets[0].sha256 },
        { path: 'data/videos/thumb_master.png', sha256: state.manifest.thumbnail.sha256 }
      ]
    };
    await fs.writeFile(state.manifestPath, `${JSON.stringify(state.manifest)}\n`);
    const result = await verifyVideoQaManifest({ root: state.root, manifestPath: state.manifestPath });
    assert.equal(result.status, 'verified');
    assert.equal(result.visualReview, 'approved');
    assert.equal(result.visualReviewScopeInvalid, false);
    assert.deepEqual(result.visualReviewAssets, [
      { path: state.mediaPath, sha256: state.manifest.assets[0].sha256 },
      { path: state.thumbnailPath, sha256: state.manifest.thumbnail.sha256 }
    ]);

    state.manifest.visualReview.approvedAssets[1].sha256 = 'b'.repeat(64);
    await fs.writeFile(state.manifestPath, `${JSON.stringify(state.manifest)}\n`);
    const invalid = await verifyVideoQaManifest({ root: state.root, manifestPath: state.manifestPath });
    assert.equal(invalid.status, 'verified');
    assert.equal(invalid.visualReviewScopeInvalid, true);
    assert.deepEqual(invalid.visualReviewAssets, [{
      path: state.mediaPath,
      sha256: state.manifest.assets[0].sha256
    }]);
  } finally { await fs.rm(state.root, { recursive: true, force: true }); }
});

test('allows cleanup of already published siblings while verifying every remaining asset', async () => {
  const state = await fixture();
  const clipPath = path.join(state.root, 'data', 'videos', 'part.mp4');
  try {
    await fs.writeFile(clipPath, 'published social part');
    const clipHash = crypto.createHash('sha256').update('published social part').digest('hex');
    state.manifest.assets.push({
      role: 'social_part', path: 'data/videos/part.mp4', sha256: clipHash,
      technical: { status: 'passed' }
    });
    state.manifest.visualReview = {
      status: 'approved',
      approvedAssets: [
        { path: 'data/videos/master.mp4', sha256: state.manifest.assets[0].sha256 },
        { path: 'data/videos/part.mp4', sha256: clipHash },
        { path: 'data/videos/thumb_master.png', sha256: state.manifest.thumbnail.sha256 }
      ]
    };
    await fs.writeFile(state.manifestPath, `${JSON.stringify(state.manifest)}\n`);
    await fs.unlink(clipPath);

    const pruned = await verifyVideoQaManifest({
      root: state.root,
      manifestPath: state.manifestPath,
      expectedPaths: [state.mediaPath],
      allowMissingManifestAssets: true
    });
    assert.equal(pruned.status, 'verified');
    assert.equal(pruned.visualReviewScopeInvalid, false);
    assert.deepEqual(pruned.visualReviewAssets.map(asset => asset.path), [state.mediaPath, state.thumbnailPath]);

    await fs.writeFile(clipPath, 'published social part');
    const omittedExisting = await verifyVideoQaManifest({
      root: state.root,
      manifestPath: state.manifestPath,
      expectedPaths: [state.mediaPath],
      allowMissingManifestAssets: true
    });
    assert.deepEqual([omittedExisting.status, omittedExisting.reason], ['mismatch', 'asset_set_changed']);
  } finally { await fs.rm(state.root, { recursive: true, force: true }); }
});

test('a missing thumbnail can be skipped for social retries but cannot approve master publication', async () => {
  const state = await fixture();
  try {
    state.manifest.visualReview = {
      status: 'approved',
      approvedAssets: [
        { path: 'data/videos/master.mp4', sha256: state.manifest.assets[0].sha256 },
        { path: 'data/videos/thumb_master.png', sha256: state.manifest.thumbnail.sha256 }
      ]
    };
    await fs.writeFile(state.manifestPath, `${JSON.stringify(state.manifest)}\n`);
    await fs.unlink(state.thumbnailPath);
    const result = await verifyVideoQaManifest({
      root: state.root,
      manifestPath: state.manifestPath,
      expectedPaths: [state.mediaPath],
      allowMissingThumbnail: true
    });
    assert.equal(result.status, 'verified');
    assert.equal(result.thumbnail, null);
    assert.equal(result.visualReviewScopeInvalid, false);
  } finally { await fs.rm(state.root, { recursive: true, force: true }); }
});

test('rejects a thumbnail whose bytes changed after manifest creation', async () => {
  const state = await fixture();
  try {
    await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#445566' } })
      .png().toFile(state.thumbnailPath);
    state.manifest.thumbnail.sizeBytes = (await fs.stat(state.thumbnailPath)).size;
    await fs.writeFile(state.manifestPath, `${JSON.stringify(state.manifest)}\n`);
    const result = await verifyVideoQaManifest({ root: state.root, manifestPath: state.manifestPath });
    assert.deepEqual([result.status, result.reason], ['mismatch', 'thumbnail_hash_changed']);
  } finally { await fs.rm(state.root, { recursive: true, force: true }); }
});

test('rejects changed video bytes, manifest bytes and asset membership', async () => {
  const state = await fixture();
  try {
    await fs.writeFile(state.mediaPath, 'changed video bytes');
    let result = await verifyVideoQaManifest({ root: state.root, manifestPath: state.manifestPath });
    assert.deepEqual([result.status, result.reason], ['mismatch', 'asset_hash_changed']);

    await fs.writeFile(state.mediaPath, 'fixture media bytes');
    await fs.appendFile(state.manifestPath, ' ');
    result = await verifyVideoQaManifest({
      root: state.root, manifestPath: state.manifestPath, manifestSha256: state.manifestSha256
    });
    assert.deepEqual([result.status, result.reason], ['mismatch', 'manifest_hash_changed']);

    result = await verifyVideoQaManifest({
      root: state.root,
      manifestPath: state.manifestPath,
      expectedPaths: [state.mediaPath, path.join(state.root, 'data/videos/another.mp4')]
    });
    assert.deepEqual([result.status, result.reason], ['mismatch', 'asset_set_changed']);
  } finally { await fs.rm(state.root, { recursive: true, force: true }); }
});

test('rejects media symlinks that resolve outside the managed video directory', async () => {
  const state = await fixture();
  const outside = path.join(state.root, 'outside.mp4');
  const link = path.join(state.root, 'data', 'videos', 'linked.mp4');
  try {
    await fs.writeFile(outside, 'outside media bytes');
    await fs.unlink(state.mediaPath);
    await fs.symlink(outside, link);
    state.manifest.assets[0].path = 'data/videos/linked.mp4';
    state.manifest.assets[0].sha256 = crypto.createHash('sha256').update('outside media bytes').digest('hex');
    await fs.writeFile(state.manifestPath, `${JSON.stringify(state.manifest)}\n`);
    const result = await verifyVideoQaManifest({ root: state.root, manifestPath: state.manifestPath });
    assert.deepEqual([result.status, result.reason], ['invalid', 'asset_resolves_outside_managed_media']);
  } finally { await fs.rm(state.root, { recursive: true, force: true }); }
});
