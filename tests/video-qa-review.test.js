'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const test = require('node:test');
const { recordVideoVisualReview, loadVisualRebuildCritique, resolveVisualRebuildEditorial } = require('../utils/video-qa-review');
const { verifyVideoQaManifest, normalizeScenePlanEvidence } = require('../utils/video-qa-manifest');
const { publicationVisualGate } = require('../utils/publication-visual-gate');
const { buildScenePlanEvidence, applySceneVisualCritique } = require('../utils/scene-visual-critique');
const { hashSourceContext } = require('../utils/source-evidence');

function scenesFixture() {
  return [
    { id: 's0_0', durationMs: 1000, presenter: true, components: [{ type: 'caption', words: [{ w: 'Áudio', t: 0, e: 900 }] }] },
    { id: 's1_0', durationMs: 2000, presenter: true, hero: true, speechEnvelope: { stepMs: 10, levels: [0.2, 0.4] },
      components: [
        { type: 'pulse-glow', revealAtMs: 0 },
        { type: 'caption', words: [{ w: 'continua', t: 10, e: 1900 }] }
      ] }
  ];
}

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-video-qa-review-'));
  const manifestPath = path.join(root, 'data', 'reports', 'qa', 'vid_1123456789abcdef01234567.json');
  const masterPath = path.join(root, 'data', 'videos', 'master.mp4');
  const thumbnailPath = path.join(root, 'data', 'videos', 'thumbnail.png');
  const narrationPath = path.join(root, 'data', 'videos', 'narration', 'narration.mp3');
  const scriptPath = path.join(root, 'data', 'scripts', 'tema.json');
  const scriptMetadataPath = `${scriptPath}.meta.json`;
  const sceneImagePath = path.join(root, 'data', 'images', 'tema', 'g0a.png');
  const ledgerPath = path.join(root, 'data', 'state', 'topics.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.mkdir(path.dirname(masterPath), { recursive: true });
  await fs.mkdir(path.dirname(narrationPath), { recursive: true });
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.mkdir(path.dirname(sceneImagePath), { recursive: true });
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  await fs.writeFile(masterPath, 'fixture master media');
  const narrationBytes = Buffer.alloc(2048, 17);
  await fs.writeFile(narrationPath, narrationBytes);
  const sourceContext = 'Contexto de fonte validado e estável para reproduzir a narrativa original com o mesmo roteiro e os mesmos fatos.';
  const scriptBytes = Buffer.from(JSON.stringify({ hook: 'A pergunta original?', sections: [{ content: 'Texto original.' }] }));
  const scriptMetadataBytes = Buffer.from(JSON.stringify({
    revision: 'retention-emotions-v27-production-motion-word-timing', topic: 'Tema original',
    targetWords: 950, formatId: 'question-payoff', contextHash: hashSourceContext(sourceContext)
  }));
  await fs.writeFile(scriptPath, scriptBytes);
  await fs.writeFile(scriptMetadataPath, scriptMetadataBytes);
  await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#223344' } })
    .png().toFile(thumbnailPath);
  await sharp({ create: { width: 128, height: 128, channels: 3, background: '#6655aa' } })
    .png().toFile(sceneImagePath);
  const masterHash = crypto.createHash('sha256').update(await fs.readFile(masterPath)).digest('hex');
  const thumbnailBytes = await fs.readFile(thumbnailPath);
  const thumbnailHash = crypto.createHash('sha256').update(thumbnailBytes).digest('hex');
  const sceneImageBytes = await fs.readFile(sceneImagePath);
  const inputSha256 = 'b'.repeat(64);
  const videoId = 'vid_1123456789abcdef01234567';
  const scenePlan = buildScenePlanEvidence(scenesFixture());
  const manifest = {
    schemaVersion: 1,
    videoId,
    editorial: {
      themeId: 'ia', topic: 'Tema original', targetWords: 950, formatId: 'question-payoff',
      formatVersion: 1, scriptRevision: 'retention-emotions-v27-production-motion-word-timing',
      seed: 37, hook: 'A pergunta original?', visualMode: 'graphics-and-source-prints'
    },
    scenePlan,
    sourceReview: {
      sourceTitle: 'Tema original', sourceUrl: null,
      sourceName: '', sourceTimeLabel: '', sourceContext,
      sourceHash: hashSourceContext(sourceContext), factualReviewStatus: 'approved', reviewer: 'Factual reviewer'
    },
    narrationAudio: {
      path: 'data/videos/narration/narration.mp3',
      sha256: crypto.createHash('sha256').update(narrationBytes).digest('hex'),
      sizeBytes: narrationBytes.length,
      inputSha256
    },
    scriptCache: {
      script: { path: 'data/scripts/tema.json', sha256: crypto.createHash('sha256').update(scriptBytes).digest('hex') },
      metadata: { path: 'data/scripts/tema.json.meta.json', sha256: crypto.createHash('sha256').update(scriptMetadataBytes).digest('hex') }
    },
    sceneImageAssets: [{ groupIndex: 0, variant: 'a', path: 'data/images/tema/g0a.png',
      sha256: crypto.createHash('sha256').update(sceneImageBytes).digest('hex') }],
    sceneReferences: { schemaVersion: 1, newsItems: [], prints: [] },
    technicalStatus: 'passed',
    visualReview: { status: 'pending', note: 'Human visual review required.' },
    assets: [{ role: 'master', path: 'data/videos/master.mp4', sha256: masterHash, sizeBytes: 20, technical: { status: 'passed' } }],
    thumbnail: {
      path: 'data/videos/thumbnail.png', sha256: thumbnailHash, sizeBytes: thumbnailBytes.length,
      format: 'png', width: 1280, height: 720
    }
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(ledgerPath, JSON.stringify({ entries: [{
    videoId, videoPath: 'data/videos/master.mp4', qaManifestPath: path.relative(root, manifestPath),
    qaManifestSha256: crypto.createHash('sha256').update(await fs.readFile(manifestPath)).digest('hex')
  }] }, null, 2));
  return { root, manifestPath, masterPath, thumbnailPath, ledgerPath, scenePlan, narrationPath, sourceContext };
}

test('records per-artifact visual approval and synchronizes the topic-ledger manifest hash', async () => {
  const fixture = await makeFixture();
  try {
    const result = await recordVideoVisualReview({
      root: fixture.root,
      manifestPath: fixture.manifestPath,
      ledgerPath: fixture.ledgerPath,
      reviewer: 'Visual reviewer',
      approvedPaths: [fixture.masterPath, fixture.thumbnailPath]
    });
    assert.equal(result.visualMode, 'graphics-and-source-prints');
    const ledger = JSON.parse(await fs.readFile(fixture.ledgerPath, 'utf8'));
    const manifest = JSON.parse(await fs.readFile(fixture.manifestPath, 'utf8'));
    const verified = await verifyVideoQaManifest({
      root: fixture.root,
      manifestPath: fixture.manifestPath,
      manifestSha256: result.manifestSha256
    });
    assert.equal(ledger.entries[0].qaManifestSha256, result.manifestSha256);
    assert.equal(manifest.visualReview.status, 'approved');
    assert.equal(manifest.visualReview.reviewer, 'Visual reviewer');
    assert.equal(verified.visualReview, 'approved');
    assert.equal(verified.visualReviewScopeInvalid, false);
    assert.equal(verified.visualReviewAssets.length, 2);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('master approval requires its thumbnail and unknown paths leave production records unchanged', async () => {
  const fixture = await makeFixture();
  const originalManifest = await fs.readFile(fixture.manifestPath);
  const originalLedger = await fs.readFile(fixture.ledgerPath);
  try {
    await assert.rejects(recordVideoVisualReview({
      root: fixture.root,
      manifestPath: fixture.manifestPath,
      ledgerPath: fixture.ledgerPath,
      reviewer: 'Visual reviewer',
      approvedPaths: [fixture.masterPath]
    }), /requires reviewing its hash-bound thumbnail/);
    await assert.rejects(recordVideoVisualReview({
      root: fixture.root,
      manifestPath: fixture.manifestPath,
      ledgerPath: fixture.ledgerPath,
      reviewer: 'Visual reviewer',
      approvedPaths: [path.join(fixture.root, 'outside.mp4')]
    }), /not a hash-bound asset/);
    assert.deepEqual(await fs.readFile(fixture.manifestPath), originalManifest);
    assert.deepEqual(await fs.readFile(fixture.ledgerPath), originalLedger);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('rejection records a required reason without approving any asset', async () => {
  const fixture = await makeFixture();
  try {
    const result = await recordVideoVisualReview({
      root: fixture.root,
      manifestPath: fixture.manifestPath,
      ledgerPath: fixture.ledgerPath,
      reviewer: 'Visual reviewer',
      status: 'rejected',
      note: 'Headline is truncated.'
    });
    const manifest = JSON.parse(await fs.readFile(fixture.manifestPath, 'utf8'));
    assert.equal(result.status, 'rejected');
    assert.equal(manifest.visualReview.note, 'Headline is truncated.');
    assert.deepEqual(manifest.visualReview.approvedAssets, []);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('structured visual critique binds findings to scene IDs, rejects QA and blocks publication', async () => {
  const fixture = await makeFixture();
  try {
    const originalBytes = await fs.readFile(fixture.manifestPath);
    const sourceManifestSha256 = crypto.createHash('sha256').update(originalBytes).digest('hex');
    const critique = {
      schemaVersion: 1,
      findings: [{
        sceneId: 's1_0',
        category: 'composition',
        severity: 'high',
        issue: 'O robô cobre a informação principal.',
        recommendedFix: 'Reposicionar o robô à direita e reduzir sua escala antes de reconstruir a cena.',
        correction: { operation: 'set-layout', layout: 'split' }
      }]
    };
    const result = await recordVideoVisualReview({
      root: fixture.root,
      manifestPath: fixture.manifestPath,
      ledgerPath: fixture.ledgerPath,
      reviewer: 'Visual reviewer',
      status: 'rejected',
      expectedManifestSha256: sourceManifestSha256,
      critique
    });
    const manifest = JSON.parse(await fs.readFile(fixture.manifestPath, 'utf8'));
    const ledger = JSON.parse(await fs.readFile(fixture.ledgerPath, 'utf8'));
    const verified = await verifyVideoQaManifest({
      root: fixture.root,
      manifestPath: fixture.manifestPath,
      manifestSha256: result.manifestSha256
    });
    assert.equal(result.rebuildRequired, true);
    assert.equal(manifest.visualReview.status, 'rejected');
    assert.equal(manifest.visualReview.rebuildRequired, true);
    assert.deepEqual(manifest.visualReview.critique.sceneIds, ['s1_0']);
    assert.equal(manifest.visualReview.critique.sourceQaManifestSha256, sourceManifestSha256);
    assert.equal(ledger.entries[0].qaManifestSha256, result.manifestSha256);
    assert.equal(verified.status, 'verified');
    assert.equal(verified.visualReview, 'rejected');
    assert.deepEqual(publicationVisualGate(verified, fixture.masterPath), {
      allowed: false, reason: 'visual_review_not_approved'
    });
    const loadedCritique = await loadVisualRebuildCritique({
      root: fixture.root,
      manifestPath: fixture.manifestPath,
      expectedManifestSha256: result.manifestSha256
    });
    assert.deepEqual(loadedCritique.sourceEditorial, {
      themeId: 'ia', topic: 'Tema original', targetWords: 950, formatId: 'question-payoff',
      formatVersion: 1, scriptRevision: 'retention-emotions-v27-production-motion-word-timing',
      seed: 37, hook: 'A pergunta original?', visualMode: 'graphics-and-source-prints'
    });
    assert.equal(loadedCritique.sourceContext, fixture.sourceContext);
    assert.equal(loadedCritique.narrationAudio.path, fixture.narrationPath);
    assert.deepEqual(loadedCritique.sceneReferences, { schemaVersion: 1, newsItems: [], prints: [] });
    assert.equal(loadedCritique.sceneImageAssets.length, 1);
    assert.match(loadedCritique.scriptCache.scriptSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(resolveVisualRebuildEditorial(loadedCritique.sourceEditorial, {
      topic: 'Tema original', targetWords: '950', formatId: 'question-payoff', seed: '37'
    }), loadedCritique.sourceEditorial);
    assert.throws(() => resolveVisualRebuildEditorial(loadedCritique.sourceEditorial, { seed: 38 }),
      /seed conflicts with the source QA manifest/);
    assert.throws(() => resolveVisualRebuildEditorial(loadedCritique.sourceEditorial, { formatId: 'three-steps' }),
      /formatId conflicts with the source QA manifest/);
    assert.equal(loadedCritique.sourceMasterPath, fixture.masterPath);
    await assert.rejects(loadVisualRebuildCritique({
      root: fixture.root,
      manifestPath: fixture.manifestPath,
      expectedManifestSha256: 'a'.repeat(64)
    }), /manifest hash changed/);
    const originalScenes = scenesFixture();
    const applied = applySceneVisualCritique(originalScenes, loadedCritique);
    assert.equal(applied.evidence.baseSha256, fixture.scenePlan.sha256);
    assert.notEqual(applied.evidence.sha256, fixture.scenePlan.sha256);
    assert.deepEqual(applied.evidence.rebuild.sceneIds, ['s1_0']);
    assert.equal(applied.evidence.rebuild.correctionSetSha256, crypto.createHash('sha256')
      .update(JSON.stringify([{ sceneId: 's1_0', correction: { operation: 'set-layout', layout: 'split' } }])).digest('hex'));
    assert.equal(applied.scenes[1].split, true);
    assert.equal(applied.scenes[1].hero, undefined);
    assert.equal(applied.scenes[1].durationMs, originalScenes[1].durationMs);
    assert.deepEqual(applied.scenes[1].components.find(component => component.type === 'caption'),
      originalScenes[1].components.find(component => component.type === 'caption'));
    assert.deepEqual(applied.scenes[1].speechEnvelope, originalScenes[1].speechEnvelope);
    assert.deepEqual(normalizeScenePlanEvidence(applied.evidence), applied.evidence);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('visual critique rejects unknown scene IDs and stale source manifest hashes without mutation', async () => {
  const fixture = await makeFixture();
  const originalManifest = await fs.readFile(fixture.manifestPath);
  const originalLedger = await fs.readFile(fixture.ledgerPath);
  const manifestSha256 = crypto.createHash('sha256').update(originalManifest).digest('hex');
  const base = {
    schemaVersion: 1,
    findings: [{ sceneId: 's9_9', category: 'clarity', severity: 'medium',
      issue: 'A relação não está clara.', recommendedFix: 'Adicionar setas com rótulos.',
      correction: { operation: 'set-layout', layout: 'split' } }]
  };
  try {
    await assert.rejects(recordVideoVisualReview({
      root: fixture.root, manifestPath: fixture.manifestPath, ledgerPath: fixture.ledgerPath,
      reviewer: 'Visual reviewer', status: 'rejected', expectedManifestSha256: manifestSha256,
      critique: base
    }), /unknown scene/);
    await assert.rejects(recordVideoVisualReview({
      root: fixture.root, manifestPath: fixture.manifestPath, ledgerPath: fixture.ledgerPath,
      reviewer: 'Visual reviewer', status: 'rejected', expectedManifestSha256: 'a'.repeat(64),
      critique: { ...base, findings: [{ ...base.findings[0], sceneId: 's0_0' }] }
    }), /manifest changed/);
    assert.deepEqual(await fs.readFile(fixture.manifestPath), originalManifest);
    assert.deepEqual(await fs.readFile(fixture.ledgerPath), originalLedger);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test('visual correction allowlist rejects free-text and fails closed on plan hash or ID mismatch', () => {
  const scenes = scenesFixture();
  const base = buildScenePlanEvidence(scenes);
  const critique = {
    schemaVersion: 1,
    sourceQaManifestSha256: 'a'.repeat(64),
    critiqueManifestSha256: 'b'.repeat(64),
    sourceScenePlanSha256: base.sha256,
    sceneIds: ['s1_0'],
    findings: [{ sceneId: 's1_0', correction: { operation: 'remove-component', componentType: 'pulse-glow', componentIndex: 0 } }]
  };
  const removed = applySceneVisualCritique(scenes, critique);
  assert.equal(removed.scenes[1].components.some(component => component.type === 'pulse-glow'), false);
  assert.equal(removed.scenes[1].components.some(component => component.type === 'caption'), true);
  assert.throws(() => applySceneVisualCritique(scenes, { ...critique, sourceScenePlanSha256: 'c'.repeat(64) }),
    error => error.code === 'VISUAL_CRITIQUE_PLAN_MISMATCH');
  assert.throws(() => applySceneVisualCritique(scenes, { ...critique, sceneIds: ['s0_0'] }),
    error => error.code === 'VISUAL_CRITIQUE_SCENE_ID_MISMATCH');
  assert.throws(() => applySceneVisualCritique(scenes, {
    ...critique,
    findings: [{ sceneId: 's1_0', correction: { operation: 'set-component-text', componentType: 'bento-card', componentIndex: 0, field: 'title', value: 'alegação alterada' } }]
  }), /unsupported visual correction operation/);
});

test('visual reveal timing correction leaves narration, captions and scene duration unchanged', () => {
  const scenes = scenesFixture();
  const plan = buildScenePlanEvidence(scenes);
  const result = applySceneVisualCritique(scenes, {
    schemaVersion: 1,
    sourceQaManifestSha256: 'a'.repeat(64),
    critiqueManifestSha256: 'b'.repeat(64),
    sourceScenePlanSha256: plan.sha256,
    sceneIds: ['s1_0'],
    findings: [{ sceneId: 's1_0', correction: {
      operation: 'set-reveal-time', componentType: 'pulse-glow', componentIndex: 0, revealAtMs: 600
    } }]
  });
  assert.equal(result.scenes[1].components[0].revealAtMs, 600);
  assert.equal(result.scenes[1].durationMs, scenes[1].durationMs);
  assert.deepEqual(result.scenes[1].components.find(component => component.type === 'caption'),
    scenes[1].components.find(component => component.type === 'caption'));
  assert.deepEqual(result.scenes[1].speechEnvelope, scenes[1].speechEnvelope);
});

test('restores the original manifest if the topic ledger has no matching entry', async () => {
  const fixture = await makeFixture();
  await fs.writeFile(fixture.ledgerPath, JSON.stringify({ entries: [] }));
  const originalManifest = await fs.readFile(fixture.manifestPath);
  const originalLedger = await fs.readFile(fixture.ledgerPath);
  try {
    await assert.rejects(recordVideoVisualReview({
      root: fixture.root,
      manifestPath: fixture.manifestPath,
      ledgerPath: fixture.ledgerPath,
      reviewer: 'Visual reviewer',
      approvedPaths: [fixture.masterPath, fixture.thumbnailPath]
    }), /expected one matching topic-ledger entry; found 0/);
    assert.deepEqual(await fs.readFile(fixture.manifestPath), originalManifest);
    assert.deepEqual(await fs.readFile(fixture.ledgerPath), originalLedger);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});
