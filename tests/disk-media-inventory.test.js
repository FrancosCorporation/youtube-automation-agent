'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { scanDiskMediaInventory } = require('../utils/disk-media-inventory');
const { createPublicationResult } = require('../utils/publication-status');

test('inventory scans managed MP4s and separates queued, linked, and untracked files', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-media-inventory-'));
  const root = path.join(temporaryRoot, 'workspace');
  const videoRoot = path.join(root, 'data', 'videos');
  const stateRoot = path.join(root, 'data', 'state');
  try {
    await fs.mkdir(path.join(videoRoot, 'clips'), { recursive: true });
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(videoRoot, 'master.mp4'), 'master');
    await fs.writeFile(path.join(videoRoot, 'clips', 'part.mp4'), 'part');
    await fs.writeFile(path.join(videoRoot, 'orphan.mp4'), 'orphan');
    await fs.writeFile(path.join(videoRoot, 'notes.txt'), 'ignored');
    await fs.writeFile(path.join(stateRoot, 'topics.json'), JSON.stringify({ entries: [
      {
        title: 'Exemplo', jobId: 'job-test-0001', publicationEligible: true,
        qaManifestPath: 'data/reports/qa/example.json',
        videoPath: 'data/videos/master.mp4',
        clips: [{ path: 'data/videos/clips/part.mp4' }],
        results: { clips: { 'data/videos/clips/part.mp4': {
          instagram: 'ok', tiktok: 'success', kwai: 'publicado'
        } } }
      },
      { title: 'Outra referência', jobId: 'job-test-0002', publicationEligible: true, videoPath: 'data/videos/master.mp4' }
    ] }));
    await fs.writeFile(path.join(stateRoot, 'publish-queue.json'), JSON.stringify({
      pending: [{ outPath: 'data/videos/master.mp4' }], inFlight: null
    }));

    const report = await scanDiskMediaInventory({ root, now: Date.parse('2026-10-20T12:00:00Z') });
    assert.deepEqual(report.totals, { files: 3, bytes: 16, queued: 1, 'ledger-linked': 1, untracked: 1 });
    assert.equal(report.files.find(item => item.path.endsWith('master.mp4')).classification, 'queued');
    assert.equal(report.files.find(item => item.path.endsWith('master.mp4')).ledger.length, 2);
    assert.deepEqual(report.files.find(item => item.path.endsWith('master.mp4')).ledger[0].requiredDestinations, ['youtube']);
    assert.equal(report.files.find(item => item.path.endsWith('clips/part.mp4')).classification, 'ledger-linked');
    assert.deepEqual(report.files.find(item => item.path.endsWith('clips/part.mp4')).ledger[0].destinations,
      { instagram: 'unknown', tiktok: 'unknown', kwai: 'unknown' });
    assert.equal(report.files.find(item => item.path.endsWith('orphan.mp4')).classification, 'untracked');
    assert.equal(report.files.find(item => item.path.endsWith('orphan.mp4')).ledger.length, 0);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('inventory covers production outputs, sibling Remotion renders, supported video formats and exclusions', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-media-scope-'));
  const root = path.join(temporaryRoot, 'youtube-automation-agent');
  const files = [
    'data/videos/current.mp4',
    'renders/review.webm',
    'docs/evidencias/capture.mkv',
    'node_modules/pkg/fixture.mp4',
    'data/browser-profiles/default/Extensions/sample/video.mp4'
  ];
  try {
    for (const name of files) {
      const target = path.join(root, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, name);
    }
    const remotionOutput = path.join(temporaryRoot, 'remotion-pilot', 'out', 'review.mov');
    await fs.mkdir(path.dirname(remotionOutput), { recursive: true });
    await fs.writeFile(remotionOutput, 'remotion');
    const topicsPath = path.join(root, 'data', 'state', 'topics.json');
    await fs.mkdir(path.dirname(topicsPath), { recursive: true });
    await fs.writeFile(topicsPath, JSON.stringify({ entries: [{
      title: 'Pauta narrada', jobId: 'job-story-0001', publicationEligible: true,
      videoPath: 'data/videos/current.mp4',
      clips: [{ path: 'renders/review.webm', kind: 'social-narrative', platforms: ['instagram', 'kwai', 'shorts'] }],
      results: { long: { youtube: 'ERRO: The user has exceeded the number of videos they may upload.' },
        clips: { 'renders/review.webm': {
          shorts: 'pulado (cota)', instagram: 'não logado', kwai: 'não logado; confira o perfil'
        } } }
    }] }));

    const report = await scanDiskMediaInventory({ root, now: Date.parse('2026-10-20T12:00:00Z') });
    assert.equal(report.totals.files, 4);
    assert.equal(report.files.reduce((sum, file) => sum + file.sizeBytes, 0),
      Buffer.byteLength('data/videos/current.mp4') + Buffer.byteLength('renders/review.webm')
      + Buffer.byteLength('docs/evidencias/capture.mkv') + Buffer.byteLength('remotion'));
    assert.deepEqual(new Set(report.files.map(file => path.extname(file.path))),
      new Set(['.mp4', '.webm', '.mkv', '.mov']));
    assert.equal(report.files.some(file => file.path.includes('Extensions')), false);
    assert.equal(report.files.some(file => file.path.includes('node_modules')), false);
    assert.equal(report.scanRoots.includes(path.join(temporaryRoot, 'remotion-pilot', 'out')), true);
    const clip = report.files.find(file => file.path.endsWith('review.webm'));
    const master = report.files.find(file => file.path.endsWith('current.mp4'));
    assert.equal(master.ledger[0].destinations.youtube, 'quota_skipped_legacy');
    assert.deepEqual(clip.ledger[0].requiredDestinations, ['instagram', 'kwai', 'shorts']);
    assert.equal(clip.ledger[0].destinations.shorts, 'quota_skipped_legacy');
    assert.equal(clip.ledger[0].destinations.instagram, 'not_logged_legacy');
    assert.equal(clip.ledger[0].destinations.kwai, 'legacy_or_unstructured');
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('inventory exposes account and uploaded artifact hash for each structured destination proof', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-media-evidence-'));
  const clipPath = path.join(root, 'data', 'videos', 'clip.mp4');
  const ledgerPath = path.join(root, 'data', 'state', 'topics.json');
  const bytes = 'hash-bound clip';
  try {
    await fs.mkdir(path.dirname(clipPath), { recursive: true });
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
    await fs.writeFile(clipPath, bytes);
    const result = createPublicationResult({
      platform: 'instagram', videoPath: 'data/videos/clip.mp4',
      artifactSha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
      status: 'confirmed', account: '@pulso_ai_news', url: 'https://instagram.test/reel/123',
      evidence: { kind: 'profile_post', observed: 'post visível no perfil autenticado' }
    });
    await fs.writeFile(ledgerPath, JSON.stringify({ entries: [{
      jobId: 'job-media-proof-01', publicationEligible: true,
      clips: [{ path: 'data/videos/clip.mp4', kind: 'social-narrative-part', platforms: ['instagram'] }],
      url: 'https://lh3.googleusercontent.com/source-thumbnail=w16',
      source: 'Publisher',
      originTitle: 'Publisher article headline',
      originUrl: 'https://news.google.com/rss/articles/source-id?oc=5',
      sourceEvidence: { eligible: true, mode: 'article', sourceUrl: 'https://publisher.test/article',
        contextHash: 'b'.repeat(64), contextChars: 500, contextWords: 70, checkedAt: '2026-10-21T12:00:00Z' },
      results: { clips: { 'data/videos/clip.mp4': { instagram: result } } }
    }] }));

    const inventory = await scanDiskMediaInventory({ root, scanRoots: ['data/videos'] });
    const clip = inventory.files[0];
    assert.equal(clip.ledger[0].destinations.instagram, 'confirmed');
    assert.equal(clip.ledger[0].destinationEvidence.instagram.account, '@pulso_ai_news');
    assert.equal(clip.ledger[0].destinationEvidence.instagram.artifactSha256, result.artifact.sha256);
    assert.equal(clip.ledger[0].destinationEvidence.instagram.url, 'https://instagram.test/reel/123');
    assert.equal(clip.ledger[0].sourceUrl, 'https://publisher.test/article');
    assert.equal(clip.ledger[0].sourceName, 'Publisher');
    assert.equal(clip.ledger[0].originTitle, 'Publisher article headline');
    assert.equal(clip.ledger[0].originUrl, 'https://news.google.com/rss/articles/source-id?oc=5');
    assert.equal(clip.ledger[0].sourceEvidence.contextHash, 'b'.repeat(64));
    assert.equal(clip.ledger[0].sourceEvidence.contextWords, 70);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('legacy image URLs are not reported as sources when a Google News origin is available', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-media-source-origin-'));
  const mediaPath = path.join(root, 'data', 'videos', 'legacy.mp4');
  const ledgerPath = path.join(root, 'data', 'state', 'topics.json');
  try {
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
    await fs.writeFile(mediaPath, 'legacy media');
    await fs.writeFile(ledgerPath, JSON.stringify({ entries: [{
      title: 'Legacy article', videoPath: 'data/videos/legacy.mp4',
      url: 'https://lh3.googleusercontent.com/thumbnail?w=16',
      originUrl: 'https://news.google.com/rss/articles/source-id?oc=5'
    }] }));
    const inventory = await scanDiskMediaInventory({ root, scanRoots: ['data/videos'] });
    assert.equal(inventory.files[0].ledger[0].sourceUrl, null);
    assert.equal(inventory.files[0].ledger[0].originUrl, 'https://news.google.com/rss/articles/source-id?oc=5');
    assert.equal(inventory.files[0].ledger[0].sourceName, null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
