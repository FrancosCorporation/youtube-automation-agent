'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { cleanupDisk, isSafeUnapprovedDeletion } = require('../utils/disk-cleanup');
const { artifactOwnerPublicationProofs, createPublicationResult } = require('../utils/publication-status');
const { assessSourceEvidence, createPublicationReview } = require('../utils/source-evidence');

function approvedSource() {
  const context = 'A fonte oficial descreve fatos verificáveis, apresenta os dados utilizados e explica os limites da análise realizada. '.repeat(5);
  const sourceEvidence = assessSourceEvidence({
    sourceTitle: 'Fonte oficial de evidências verificáveis',
    sourceUrl: 'https://example.test/article',
    context
  });
  return {
    sourceEvidence,
    publicationReview: createPublicationReview({ verdict: 'aprovado', sourceContext: context, reviewer: 'independent-reviewers' })
  };
}

async function writeHashBoundQa(root, assets, id = 'vid_0123456789abcdef01234567') {
  const source = approvedSource();
  const manifest = {
    schemaVersion: 1,
    videoId: id,
    technicalStatus: 'passed',
    sourceReview: { factualReviewStatus: 'approved', sourceHash: source.sourceEvidence.contextHash },
    visualReview: {
      status: 'approved',
      approvedAssets: assets.map(asset => ({ path: asset.path, sha256: asset.sha256 }))
    },
    assets: assets.map(asset => ({ role: asset.role || 'master', path: asset.path, sha256: asset.sha256 }))
  };
  const manifestPath = path.join(root, 'data', 'reports', 'qa', `${id}.json`);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  await fs.writeFile(manifestPath, bytes);
  return {
    ...source,
    publicationEligible: true,
    qaManifestPath: path.relative(root, manifestPath),
    qaManifestSha256: crypto.createHash('sha256').update(bytes).digest('hex')
  };
}

function confirmedYoutube(videoPath, sha256, url) {
  return createPublicationResult({
    platform: 'youtube', videoPath, artifactSha256: sha256,
    status: 'confirmed', url, externalId: new URL(url).searchParams.get('v'), account: 'UCpulso',
    evidence: { kind: 'youtube_insert_response', observed: 'API retornou ID do vídeo' }
  });
}

test('unapproved media retirement requires every owner to be explicitly unapproved', () => {
  assert.equal(isSafeUnapprovedDeletion([{ publicationEligible: false, destinations: [{ platform: 'youtube', status: 'not_attempted' }] }]), true);
  assert.equal(isSafeUnapprovedDeletion([{ publicationEligible: null, publicationReviewStatus: 'rejected', destinations: [] }]), false,
    'an empty destination list is not proof that a rejected file was never submitted');
  assert.equal(isSafeUnapprovedDeletion([
    { publicationEligible: false, destinations: [] },
    { publicationEligible: true, destinations: [] }
  ]), false);
  assert.equal(isSafeUnapprovedDeletion([{ publicationEligible: false, destinations: [{ platform: 'instagram', status: 'unknown' }] }]), false,
    'an uncertain remote submission must be reconciled before local deletion');
  assert.equal(isSafeUnapprovedDeletion([{ publicationEligible: false, destinations: [{ platform: 'instagram', status: 'unconfirmed' }] }]), false,
    'a legacy success string without artifact-bound proof remains uncertain');
  assert.equal(isSafeUnapprovedDeletion([{ publicationEligible: false, destinations: [{ platform: 'x', status: 'legacy_or_unstructured' }] }]), false,
    'an unstructured legacy result is not proof of no submission');
  assert.equal(isSafeUnapprovedDeletion([{ publicationEligible: false, destinations: [{ platform: 'x', status: 'failed' }] }]), false,
    'a failure without explicit confirmed-no-send evidence remains uncertain');
  assert.equal(isSafeUnapprovedDeletion([{ publicationEligible: false, destinations: [{ platform: 'x', status: 'failed', evidenceKind: 'confirmed_no_send' }] }]), true,
    'a failed attempt with explicit pre-submit no-send proof is conclusive');
  const reviewedHash = 'a'.repeat(64);
  assert.equal(isSafeUnapprovedDeletion([{ publicationEligible: false, destinations: [{ platform: 'youtube', status: 'confirmed' }] }]), false,
    'a confirmed legacy outcome without an artifact hash cannot authorize deletion');
  assert.equal(isSafeUnapprovedDeletion([{ publicationEligible: false, reviewedAssetSha256: reviewedHash,
    destinations: [{ platform: 'youtube', status: 'confirmed', artifactSha256: reviewedHash }] }]), true,
  'a confirmed destination for the exact reviewed bytes is conclusive');
  assert.equal(isSafeUnapprovedDeletion([{ publicationEligible: false, reviewedAssetSha256: reviewedHash,
    destinations: [{ platform: 'youtube', status: 'confirmed', artifactSha256: 'b'.repeat(64) }] }]), false,
  'a destination confirmation for different bytes cannot authorize deletion');
  assert.equal(isSafeUnapprovedDeletion([{ publicationEligible: false, reviewedAssetSha256: reviewedHash,
    destinations: [{ platform: 'youtube', status: 'confirmed', artifactSha256: reviewedHash, legacyProof: true }] }]), false,
  'legacy URL proof without artifact binding cannot authorize deletion');
  assert.equal(isSafeUnapprovedDeletion([{ publicationEligible: false, requiredDestinations: [], destinations: [{ platform: 'kwai', status: 'unknown' }] }]), false,
    'uncertainty is preserved even for a rejected artifact');

  const root = path.join(os.tmpdir(), 'pulso-legacy-cleanup');
  const artifactPath = path.join(root, 'data/videos/rejected.mp4');
  const quotaProofs = artifactOwnerPublicationProofs([{
    videoPath: artifactPath, publicationEligible: false, results: { long: { youtube: 'pulado (cota)' } }
  }], artifactPath, { root });
  assert.equal(quotaProofs[0].destinations[0].status, 'quota_skipped_legacy');
  assert.equal(isSafeUnapprovedDeletion(quotaProofs), true,
    'the exact legacy quota-skip marker proves that upload was not attempted');

  const youtubeLimitProofs = artifactOwnerPublicationProofs([{
    videoPath: artifactPath, publicationEligible: false,
    results: { long: { youtube: 'ERRO: The user has exceeded the number of videos they may upload.' } }
  }], artifactPath, { root });
  assert.equal(youtubeLimitProofs[0].destinations[0].status, 'quota_skipped_legacy');
  assert.equal(isSafeUnapprovedDeletion(youtubeLimitProofs), true,
    'the exact YouTube upload-limit rejection proves the upload was not accepted');

  const notLoggedProofs = artifactOwnerPublicationProofs([{
    videoPath: artifactPath, publicationEligible: false,
    results: { long: { youtube: 'pulado (cota)', x: 'não logado' } }
  }], artifactPath, { root });
  assert.equal(notLoggedProofs[0].destinations.find(destination => destination.platform === 'x').status, 'not_logged_legacy');
  assert.equal(isSafeUnapprovedDeletion(notLoggedProofs), true,
    'the exact old uploader marker was written before it skipped the handler');

  const malformedNotLoggedProofs = artifactOwnerPublicationProofs([{
    videoPath: artifactPath, publicationEligible: false,
    results: { long: { youtube: 'pulado (cota)', x: 'não logado depois de publicar' } }
  }], artifactPath, { root });
  assert.equal(malformedNotLoggedProofs[0].destinations.find(destination => destination.platform === 'x').status, 'unconfirmed');
  assert.equal(isSafeUnapprovedDeletion(malformedNotLoggedProofs), false);

  const disabledProofs = artifactOwnerPublicationProofs([{
    videoPath: artifactPath, publicationEligible: false,
    results: { long: {
      youtube: 'pulado (cota)',
      x: 'desativado (X_POST_FULL_VIDEO=1 para habilitar)',
      telegram: 'desativado (TELEGRAM_CHANNEL ausente)'
    } }
  }], artifactPath, { root });
  assert.deepEqual(Object.fromEntries(disabledProofs[0].destinations.map(destination => [destination.platform, destination.status])), {
    youtube: 'quota_skipped_legacy',
    x: 'disabled_or_not_targeted_legacy',
    telegram: 'disabled_or_not_targeted_legacy'
  });
  assert.equal(isSafeUnapprovedDeletion(disabledProofs), true,
    'exact legacy configuration markers prove those destinations were not targeted');

  const malformedDisabledProofs = artifactOwnerPublicationProofs([{
    videoPath: artifactPath, publicationEligible: false,
    results: { long: { x: 'desativado (X_POST_FULL_VIDEO=1 para habilitar) após tentativa' } }
  }], artifactPath, { root });
  assert.equal(malformedDisabledProofs[0].destinations.find(destination => destination.platform === 'x').status, 'unconfirmed',
    'an altered disabled marker must remain uncertain');
  assert.equal(isSafeUnapprovedDeletion(malformedDisabledProofs), false);

  const missingResultProofs = artifactOwnerPublicationProofs([{
    videoPath: artifactPath, publicationEligible: false, results: {}
  }], artifactPath, { root });
  assert.equal(missingResultProofs[0].destinations[0].status, 'legacy_or_unstructured',
    'a missing destination result is not proof that no upload was attempted');
  assert.equal(isSafeUnapprovedDeletion(missingResultProofs), false);

  const opaqueProofs = artifactOwnerPublicationProofs([{
    videoPath: artifactPath, publicationEligible: false, results: { long: { youtube: 'ok' } }
  }], artifactPath, { root });
  assert.equal(opaqueProofs[0].destinations[0].status, 'unconfirmed');
  assert.equal(isSafeUnapprovedDeletion(opaqueProofs), false,
    'an opaque legacy success string cannot establish whether publication occurred');
});

test('preview selects only old confirmed media and preserves queued, unknown, and grace-period masters', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-retention-preview-'));
  const root = path.join(temporaryRoot, 'workspace');
  const mediaRoot = path.join(root, 'data', 'videos');
  const stateRoot = path.join(root, 'data', 'state');
  const now = Date.parse('2026-10-13T19:00:00.000Z');
  const oldDate = new Date(now - 7 * 86400000).toISOString();
  const freshDate = new Date(now - 60 * 60 * 1000).toISOString();
  const confirmedUrl = 'https://www.youtube.com/watch?v=fixture-confirmed';
  const entries = [];
  const outputs = [];
  const environment = Object.fromEntries(['TELEGRAM_CHANNEL', 'X_POST_FULL_VIDEO', 'SOCIALS_DISABLED']
    .map(key => [key, process.env[key]]));

  try {
    delete process.env.TELEGRAM_CHANNEL;
    delete process.env.X_POST_FULL_VIDEO;
    delete process.env.SOCIALS_DISABLED;
    await fs.mkdir(mediaRoot, { recursive: true });
    await fs.mkdir(stateRoot, { recursive: true });
    const contents = new Map();
    for (const name of ['confirmed.mp4', 'unknown.mp4', 'fresh.mp4', 'queued.mp4', 'mismatched-clip.mp4']) {
      const value = `synthetic ${name}`;
      contents.set(name, value);
      await fs.writeFile(path.join(mediaRoot, name), value);
    }
    const confirmedPath = 'data/videos/confirmed.mp4';
    const confirmedHash = crypto.createHash('sha256').update(contents.get('confirmed.mp4')).digest('hex');
    const qa = await writeHashBoundQa(root, [{ path: confirmedPath, sha256: confirmedHash }]);
    entries.push(
      {
        videoPath: confirmedPath, generatedAt: oldDate, ...qa, ytUrl: confirmedUrl,
        results: { long: { youtube: confirmedYoutube(confirmedPath, confirmedHash, confirmedUrl) } }
      },
      { videoPath: 'data/videos/unknown.mp4', generatedAt: oldDate, publicationEligible: true, results: { long: { youtube: { status: 'unknown' } } } },
      { videoPath: 'data/videos/fresh.mp4', generatedAt: freshDate, publicationEligible: true, ytUrl: confirmedUrl, results: { long: { youtube: confirmedUrl } } },
      { videoPath: 'data/videos/queued.mp4', generatedAt: oldDate, publicationEligible: true, ytUrl: confirmedUrl, results: { long: { youtube: confirmedUrl } } },
      {
        videoPath: 'data/videos/mismatched-master.mp4', generatedAt: oldDate, publicationEligible: true,
        clips: [{ path: 'data/videos/mismatched-clip.mp4', kind: 'instagram-narrative-part', platforms: ['instagram'] }],
        results: { clips: { 'data/videos/mismatched-clip.mp4': { instagram: {
          schemaVersion: 1, platform: 'instagram', status: 'confirmed',
          artifact: { path: 'data/videos/unrelated-clip.mp4' }, confirmedAt: oldDate,
          evidence: { kind: 'success_message', observed: 'publicação confirmada' }
        } } } }
      }
    );
    await fs.writeFile(path.join(stateRoot, 'topics.json'), JSON.stringify({ entries }));
    await fs.writeFile(path.join(stateRoot, 'publish-queue.json'), JSON.stringify({
      pending: [],
      inFlight: { outPath: 'data/videos/queued.mp4' }
    }));

    const report = await cleanupDisk({
      root,
      stateDir: 'data/state',
      deleteUploadedMedia: true,
      uploadedGraceHours: 24,
      snapshotRetentionDays: 7,
      imageRetentionDays: 14,
      browserCacheRetentionDays: 7,
      apply: false,
      now,
      log: line => outputs.push(line)
    });
    assert.equal(report.apply, false);
    assert.equal(report.removedFiles, 0);
    assert.equal(report.removedDirectories, 0);
    assert.equal(report.reclaimedBytes, 0);
    assert(outputs.some(line => /confirmed-youtube-master: .* em 1 item/.test(line)));
    assert.equal(outputs.some(line => /confirmed-social-clip: .*mismatched-clip\.mp4/.test(line)), false,
      'clip with confirmation for a different artifact is not eligible for cleanup');
    assert(outputs.some(line => /prévia:/.test(line)));
    for (const name of ['confirmed.mp4', 'unknown.mp4', 'fresh.mp4', 'queued.mp4', 'mismatched-clip.mp4']) {
      assert.equal((await fs.readFile(path.join(mediaRoot, name))).length > 0, true, `${name} remains in place`);
    }

    const applied = await cleanupDisk({
      root,
      stateDir: 'data/state',
      deleteUploadedMedia: true,
      uploadedGraceHours: 24,
      snapshotRetentionDays: 7,
      imageRetentionDays: 14,
      browserCacheRetentionDays: 7,
      apply: true,
      now,
      log: () => {}
    });
    assert.equal(applied.removedFiles, 1);
    assert.deepEqual(applied.deleted.map(item => item.path), [path.join(mediaRoot, 'confirmed.mp4')]);
    await assert.rejects(fs.access(path.join(mediaRoot, 'confirmed.mp4')), { code: 'ENOENT' });
    for (const name of ['unknown.mp4', 'fresh.mp4', 'queued.mp4', 'mismatched-clip.mp4']) {
      assert.equal((await fs.readFile(path.join(mediaRoot, name))).length > 0, true, `${name} is protected during apply`);
    }
  } finally {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('cleanup retains a socially confirmed clip while a targeted destination has failed', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-social-clip-retention-'));
  const root = path.join(temporaryRoot, 'workspace');
  const mediaRoot = path.join(root, 'data', 'videos');
  const stateRoot = path.join(root, 'data', 'state');
  const now = Date.parse('2026-10-13T19:00:00.000Z');
  const oldDate = new Date(now - 7 * 86400000).toISOString();
  const clipPath = path.join(mediaRoot, 'clip.mp4');
  try {
    await fs.mkdir(mediaRoot, { recursive: true });
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(clipPath, 'published clip bytes');
    const entry = {
      videoPath: 'data/videos/master.mp4',
      generatedAt: oldDate,
      publicationEligible: true,
      clips: [{
        path: 'data/videos/clip.mp4',
        kind: 'social-narrative-part',
        platforms: ['instagram', 'tiktok']
      }],
      results: {
        long: { youtube: 'não logado' },
        clips: { 'data/videos/clip.mp4': {
          instagram: {
            schemaVersion: 1,
            platform: 'instagram',
            status: 'confirmed',
            artifact: { path: 'data/videos/clip.mp4' },
            confirmedAt: oldDate,
            evidence: { kind: 'public_profile_post', observed: 'post confirmado no perfil' }
          },
          tiktok: {
            schemaVersion: 1,
            platform: 'tiktok',
            status: 'failed',
            failureCode: 'social_handler_unavailable',
            artifact: { path: 'data/videos/clip.mp4' }
          }
        } }
      }
    };
    await fs.writeFile(path.join(stateRoot, 'topics.json'), JSON.stringify({ entries: [entry] }));
    await fs.writeFile(path.join(stateRoot, 'publish-queue.json'), JSON.stringify({ pending: [], inFlight: null }));

    const result = await cleanupDisk({
      root,
      stateDir: 'data/state',
      deleteUploadedMedia: true,
      uploadedGraceHours: 1,
      snapshotRetentionDays: 3650,
      imageRetentionDays: 3650,
      browserCacheRetentionDays: 3650,
      apply: true,
      now,
      log: () => {}
    });
    assert.equal(result.removedFiles, 0);
    assert.equal(result.deleted.length, 0);
    await fs.access(clipPath);
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});

test('the approved existing episode retains its master while the full QA package is needed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-approved-retain-'));
  try {
    const videoPath = path.join(root, 'data', 'videos', 'master.mp4');
    await fs.mkdir(path.dirname(videoPath), { recursive: true });
    await fs.mkdir(path.join(root, 'data', 'state'), { recursive: true });
    await fs.writeFile(videoPath, 'fixture');
    await fs.writeFile(path.join(root, 'data', 'state', 'topics.json'), JSON.stringify({ entries: [{
      jobId: 'ia-answer-20261023-gps-v2', renderer: 'remotion-gps-v2-narrative-episode',
      qaManifestSha256: '74a2334a5caf38d1d49720267ee58639f718da758f5c519481323fe07eca9d52',
      videoPath, generatedAt: '2020-01-01T00:00:00Z', publicationEligible: true,
      results: { long: { youtube: 'https://youtube.test/confirmed' } }
    }] }));
    await fs.writeFile(path.join(root, 'data', 'state', 'publish-queue.json'), JSON.stringify({ pending: [], inFlight: null }));
    await cleanupDisk({ root, stateDir: 'data/state', deleteUploadedMedia: true, uploadedGraceHours: 0,
      snapshotRetentionDays: 3650, imageRetentionDays: 3650, browserCacheRetentionDays: 3650, apply: true, log: () => {} });
    assert.equal(await fs.readFile(videoPath, 'utf8'), 'fixture');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('zero grace removes a recently generated master only after confirmed required uploads', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-immediate-media-cleanup-'));
  const root = path.join(temporaryRoot, 'workspace');
  const mediaRoot = path.join(root, 'data', 'videos');
  const stateRoot = path.join(root, 'data', 'state');
  const now = Date.parse('2026-10-20T19:00:00.000Z');
  const freshDate = new Date(now - 1000).toISOString();
  const videoPath = path.join(mediaRoot, 'confirmed-now.mp4');
  const url = 'https://www.youtube.com/watch?v=fixture-confirmed-now';
  try {
    await fs.mkdir(mediaRoot, { recursive: true });
    await fs.mkdir(stateRoot, { recursive: true });
    const content = 'confirmed video';
    await fs.writeFile(videoPath, content);
    const relativePath = 'data/videos/confirmed-now.mp4';
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const qa = await writeHashBoundQa(root, [{ path: relativePath, sha256 }]);
    await fs.writeFile(path.join(stateRoot, 'topics.json'), JSON.stringify({ entries: [{
      videoPath: relativePath, generatedAt: freshDate, ...qa, ytUrl: url,
      results: { long: { youtube: confirmedYoutube(relativePath, sha256, url) } }
    }] }));
    await fs.writeFile(path.join(stateRoot, 'publish-queue.json'), JSON.stringify({ pending: [], inFlight: null }));

    const report = await cleanupDisk({
      root, stateDir: 'data/state', deleteUploadedMedia: true, uploadedGraceHours: 0,
      snapshotRetentionDays: 3650, imageRetentionDays: 3650, browserCacheRetentionDays: 3650,
      apply: true, now, log: () => {}
    });
    assert.equal(report.removedFiles, 1);
    await assert.rejects(fs.access(videoPath), { code: 'ENOENT' });
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});

test('shared physical media waits for every ledger reference before removal', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-shared-media-cleanup-'));
  const root = path.join(temporaryRoot, 'workspace');
  const mediaRoot = path.join(root, 'data', 'videos');
  const stateRoot = path.join(root, 'data', 'state');
  const now = Date.parse('2026-10-20T19:00:00.000Z');
  const generatedAt = new Date(now - 1000).toISOString();
  const videoPath = path.join(mediaRoot, 'shared.mp4');
  const url = 'https://www.youtube.com/watch?v=shared-confirmed';
  let entries;
  try {
    await fs.mkdir(mediaRoot, { recursive: true });
    await fs.mkdir(stateRoot, { recursive: true });
    const content = 'shared asset';
    await fs.writeFile(videoPath, content);
    const relativePath = 'data/videos/shared.mp4';
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const qa = await writeHashBoundQa(root, [{ path: relativePath, sha256 }], 'vid_1123456789abcdef01234567');
    const publication = confirmedYoutube(relativePath, sha256, url);
    entries = [
      { videoPath: relativePath, generatedAt, ...qa, ytUrl: url, results: { long: { youtube: publication } } },
      { videoPath: relativePath, generatedAt, ...qa, results: { long: { youtube: { status: 'unknown' } } } }
    ];
    const ledgerPath = path.join(stateRoot, 'topics.json');
    await fs.writeFile(ledgerPath, JSON.stringify({ entries }));
    await fs.writeFile(path.join(stateRoot, 'publish-queue.json'), JSON.stringify({ pending: [], inFlight: null }));
    const options = {
      root, stateDir: 'data/state', deleteUploadedMedia: true, uploadedGraceHours: 0,
      snapshotRetentionDays: 3650, imageRetentionDays: 3650, browserCacheRetentionDays: 3650,
      apply: true, now, log: () => {}
    };

    const waiting = await cleanupDisk(options);
    assert.equal(waiting.removedFiles, 0);
    assert.equal(waiting.deleted.some(item => item.path === videoPath), false);
    await fs.access(videoPath);

    entries[1].ytUrl = url;
    entries[1].results.long.youtube = publication;
    await fs.writeFile(ledgerPath, JSON.stringify({ entries }));
    const completed = await cleanupDisk(options);
    assert.equal(completed.removedFiles, 1);
    await assert.rejects(fs.access(videoPath), { code: 'ENOENT' });
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});

test('QA-unapproved media is previewed and retired with a hash record before recreation', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-unapproved-media-'));
  const root = path.join(temporaryRoot, 'workspace');
  const mediaRoot = path.join(root, 'data', 'videos');
  const stateRoot = path.join(root, 'data', 'state');
  const target = path.join(mediaRoot, 'rejected.mp4');
  const content = 'not approved for publication';
  try {
    await fs.mkdir(mediaRoot, { recursive: true });
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(target, content);
    const artifactSha256 = crypto.createHash('sha256').update(content).digest('hex');
    const entry = {
      jobId: 'job-rejected-1234', videoPath: 'data/videos/rejected.mp4', publicationEligible: false,
      publicationReview: {
        status: 'rejected', assetSha256: artifactSha256, reviewEvidencePath: 'docs/evidencias/review.json'
      }, results: { long: { youtube: { status: 'unknown' } } }
    };
    const ledgerPath = path.join(stateRoot, 'topics.json');
    await fs.writeFile(ledgerPath, JSON.stringify({ entries: [entry] }));
    await fs.writeFile(path.join(stateRoot, 'publish-queue.json'), JSON.stringify({ pending: [], inFlight: null }));

    const sharedOptions = {
      root, stateDir: 'data/state', deleteUploadedMedia: true, deleteUnapprovedMedia: true,
      uploadedGraceHours: 0, snapshotRetentionDays: 3650, imageRetentionDays: 3650,
      browserCacheRetentionDays: 3650, log: () => {}
    };
    const preview = await cleanupDisk({ ...sharedOptions, apply: false });
    assert.equal(preview.candidates.filter(candidate => candidate.category === 'qa-unapproved-media').length, 0);
    assert.equal(preview.candidateBytes, 0);
    await fs.access(target);

    entry.results.long.youtube = createPublicationResult({
      platform: 'youtube', videoPath: entry.videoPath, status: 'failed',
      failureCode: 'pre_submit_ui_error',
      evidence: { kind: 'confirmed_no_send', observed: 'falha antes da submissão; nenhum envio ocorreu' }
    });
    await fs.writeFile(ledgerPath, JSON.stringify({ entries: [entry] }));
    entry.publicationReview.assetSha256 = crypto.createHash('sha256').update('different reviewed bytes').digest('hex');
    await fs.writeFile(ledgerPath, JSON.stringify({ entries: [entry] }));
    const mismatchedReview = await cleanupDisk({ ...sharedOptions, apply: false });
    assert.equal(mismatchedReview.candidates.filter(candidate => candidate.category === 'qa-unapproved-media').length, 0,
      'a rejected review for different bytes cannot authorize deletion of the current file');
    await fs.access(target);

    entry.publicationReview.assetSha256 = artifactSha256;
    await fs.writeFile(ledgerPath, JSON.stringify({ entries: [entry] }));
    const safePreview = await cleanupDisk({ ...sharedOptions, apply: false });
    assert.equal(safePreview.candidates.filter(candidate => candidate.category === 'qa-unapproved-media').length, 1);
    const applied = await cleanupDisk({ ...sharedOptions, apply: true });
    assert.equal(applied.removedFiles, 1);
    assert.equal(applied.deleted[0].sha256, artifactSha256);
    await assert.rejects(fs.access(target), { code: 'ENOENT' });
    const records = (await fs.readFile(path.join(stateRoot, 'media-deletions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.map(record => record.action), ['delete_prepared', 'delete_completed']);
    assert.equal(records[0].ownerProofs[0].publicationReviewStatus, 'rejected');
    assert.equal(records[0].ownerProofs[0].reviewedAssetSha256, artifactSha256);
    assert.equal(records[0].ownerProofs[0].reviewEvidencePath, 'docs/evidencias/review.json');
    assert.equal(records[0].ownerProofs[0].destinations[0].status, 'failed',
      'deletion records the reconciled confirmed no-send state before recreation');
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});
