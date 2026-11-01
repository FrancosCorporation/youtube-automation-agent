const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPublicationResult } = require('../utils/publication-status');
const { assessSourceEvidence, createPublicationReview } = require('../utils/source-evidence');
const { retryPendingSocialUploads } = require('../utils/social-retry');

function verifiedSourceEvidence() {
  const context = Array(5).fill('A publicação informa vagas disponíveis, requisitos para inscrição e locais de atendimento aos candidatos interessados.').join(' ');
  const sourceEvidence = assessSourceEvidence({
    sourceTitle: 'Fundat divulga novas vagas de emprego para esta terça-feira, 13',
    sourceUrl: 'https://example.test/vagas',
    context
  });
  return {
    sourceEvidence,
    publicationReview: createPublicationReview({
      verdict: 'aprovado', sourceContext: context, reviewer: 'nvidia/nemotron-3.5-lightning-30b-a3b'
    })
  };
}

test('a retry batch yields to a due queued video after its current upload finishes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-retry-yield-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const videoPath = path.join(root, 'data', 'videos', 'clip.mp4');
  await fs.mkdir(path.dirname(videoPath), { recursive: true });
  await fs.writeFile(videoPath, 'video fixture');
  const entry = { publicationEligible: true, ...verifiedSourceEvidence(), title: 'Teste',
    clips: [{ path: videoPath, title: 'Teste', kind: 'social-narrative-part', partIndex: 1, partCount: 1,
      platforms: ['kwai', 'instagram'] }] };
  let due = false; const calls = [];
  const result = await retryPendingSocialUploads({ entry, root, results: { clips: {} }, maxUploads: 4,
    onPublicationState: async () => {}, isHandlerAvailable: () => true, isLogged: async () => true,
    getMediaDuration: async () => 60, videoLimits: { kwai: 300, instagram: 180 },
    shouldYield: () => due, uploaders: {
      kwai: async () => { calls.push('kwai'); due = true; return 'https://kwai.test/post'; },
      instagram: async () => { calls.push('instagram'); return 'https://instagram.test/post'; }
    } });
  assert.deepEqual(calls, ['kwai']);
  assert.equal(result.uploadsAttempted, 1);
  assert.equal(result.results.clips[videoPath].kwai, 'https://kwai.test/post');
  assert.equal(result.results.clips[videoPath].instagram, undefined);
});

test('a long retry can be deferred for a queued slot while a shorter destination proceeds', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-retry-slot-budget-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const videoPath = path.join(root, 'data', 'videos', 'clip.mp4');
  await fs.mkdir(path.dirname(videoPath), { recursive: true });
  await fs.writeFile(videoPath, 'video fixture');
  const entry = { publicationEligible: true, ...verifiedSourceEvidence(), title: 'Teste',
    clips: [{ path: videoPath, title: 'Teste', kind: 'social-narrative-part', partIndex: 1, partCount: 1,
      platforms: ['kwai', 'instagram'] }] };
  const calls = [];
  const result = await retryPendingSocialUploads({ entry, root, results: { clips: {} }, maxUploads: 2,
    onPublicationState: async () => {}, isHandlerAvailable: () => true, isLogged: async () => true,
    getMediaDuration: async () => 60, videoLimits: { kwai: 300, instagram: 180 },
    canStartPlatform: platform => platform !== 'kwai', uploaders: {
      kwai: async () => { calls.push('kwai'); return 'https://kwai.test/post'; },
      instagram: async () => { calls.push('instagram'); return 'https://instagram.test/post'; }
    } });
  assert.deepEqual(calls, ['instagram']);
  assert.equal(result.uploadsAttempted, 1);
  assert.equal(result.results.clips[videoPath].kwai, undefined);
});

test('série aprovada não envia parte posterior no Kwai enquanto a anterior estiver incerta', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-social-order-'));
  try {
    const clips = [1, 2, 3].map(partIndex => ({ path: path.join(root, 'data', 'videos', `parte-${partIndex}.mp4`),
      title: `Parte ${partIndex}`, kind: 'social-narrative-part', partIndex, partCount: 3, platforms: ['kwai'] }));
    await fs.mkdir(path.dirname(clips[0].path), { recursive: true });
    await Promise.all(clips.map(clip => fs.writeFile(clip.path, 'fixture')));
    const result = (clip, status, kind) => createPublicationResult({ platform: 'kwai', videoPath: clip.path,
      status, evidence: { kind, observed: 'fixture' }, ...(status === 'failed' ? { failureCode: 'pre_submit_ui_error' } : {}) });
    const confirmed = result(clips[0], 'confirmed', 'public_profile_post');
    const unknown = result(clips[1], 'unknown', 'attempt_outcome_unknown');
    const failed = result(clips[2], 'failed', 'confirmed_no_send');
    failed.nextAttemptAt = '2020-01-01T00:00:00.000Z';
    const entry = { jobId: 'ia-answer-20261023-gps-v2', publicationEligible: true, ...verifiedSourceEvidence(), clips };
    const options = { entry, root, onPublicationState: async () => {}, isLogged: async () => true,
      isHandlerAvailable: () => true, getMediaDuration: async () => 65, videoLimits: { kwai: 140 },
      uploaders: { kwai: async () => 'https://kwai.test/post' } };
    const results = { clips: { [clips[0].path]: { kwai: confirmed }, [clips[1].path]: { kwai: unknown }, [clips[2].path]: { kwai: failed } } };
    assert.equal((await retryPendingSocialUploads({ ...options, results })).uploadsAttempted, 0);
    results.clips[clips[1].path].kwai = result(clips[1], 'confirmed', 'public_profile_post');
    assert.equal((await retryPendingSocialUploads({ ...options, results })).uploadsAttempted, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('retries one explicitly eligible no-send destination and preserves sibling states', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-social-retry-'));
  try {
    const clipPath = path.join(root, 'data', 'videos', 'clip.mp4');
    await fs.mkdir(path.dirname(clipPath), { recursive: true });
    await fs.writeFile(clipPath, 'synthetic video fixture');
    const confirmed = createPublicationResult({
      platform: 'kwai', videoPath: clipPath, status: 'confirmed',
      evidence: { kind: 'test_fixture', observed: 'fixture já publicada' }
    });
    const unknown = createPublicationResult({
      platform: 'tiktok', videoPath: clipPath, status: 'unknown',
      evidence: { kind: 'test_fixture', observed: 'resultado ambíguo' }
    });
    const entry = {
      publicationEligible: true,
      ...verifiedSourceEvidence(),
      title: 'Pauta de teste',
      clips: [{ path: 'data/videos/clip.mp4', title: 'Vídeo completo', kind: 'instagram-narrative-part',
        platforms: ['instagram'], partIndex: 1, partCount: 2 }]
    };
    const events = [];
    const calls = [];
    const output = await retryPendingSocialUploads({
      entry,
      root,
      results: { clips: { 'data/videos/clip.mp4': { instagram: 'não logado', kwai: confirmed, tiktok: unknown } } },
      onPublicationState: async event => events.push(event),
      isLogged: async platform => platform === 'instagram',
      getMediaDuration: async () => 90,
      videoLimits: { instagram: 180 },
      uploaders: {
        instagram: async ({ videoPath: uploaded, caption }) => {
          calls.push({ platform: 'instagram', videoPath: uploaded, caption });
          return 'https://instagram.test/reel/123';
        },
        tiktok: async () => { calls.push({ platform: 'tiktok' }); return 'https://tiktok.test/duplicate'; }
      },
      withBudget: async (_platform, promise) => promise,
      maxUploads: 1
    });

    assert.equal(output.uploadsAttempted, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].platform, 'instagram');
    assert.match(calls[0].caption, /Vídeo completo/);
    assert.match(calls[0].caption, /Parte 1\/2/);
    assert.equal(events.length, 2);
    assert.equal(events[0].result.status, 'attempting');
    assert.equal(events[1].result, 'https://instagram.test/reel/123');
    assert.equal(output.results.clips['data/videos/clip.mp4'].instagram, 'https://instagram.test/reel/123');
    assert.equal(output.results.clips['data/videos/clip.mp4'].kwai, confirmed);
    assert.equal(output.results.clips['data/videos/clip.mp4'].tiktok, unknown);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('one retry pass can publish all four ready destinations without retrying unknown outcomes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-social-retry-batch-'));
  try {
    const clipPath = path.join(root, 'data', 'videos', 'clip.mp4');
    await fs.mkdir(path.dirname(clipPath), { recursive: true });
    await fs.writeFile(clipPath, 'synthetic video fixture');
    const unknown = createPublicationResult({
      platform: 'tiktok', videoPath: clipPath, status: 'unknown',
      evidence: { kind: 'test_fixture', observed: 'resultado ambíguo' }
    });
    const entry = {
      publicationEligible: true,
      ...verifiedSourceEvidence(),
      title: 'Pauta de teste',
      clips: [{ path: clipPath, title: 'Vídeo completo', kind: 'social-narrative-part',
        partIndex: 1, partCount: 1, platforms: ['instagram', 'kwai', 'tiktok', 'x'] }]
    };
    const calls = [];
    const output = await retryPendingSocialUploads({
      entry, root, maxUploads: 4,
      results: { clips: { [clipPath]: {
        instagram: 'não logado', kwai: 'não logado', tiktok: unknown, x: 'não logado'
      } } },
      onPublicationState: async () => {},
      isHandlerAvailable: () => true,
      isLogged: async () => true,
      getMediaDuration: async () => 90,
      videoLimits: { instagram: 180, kwai: 300, tiktok: 180, x: 140 },
      uploaders: Object.fromEntries(['instagram', 'kwai', 'tiktok', 'x'].map(platform => [
        platform,
        async () => { calls.push(platform); return `https://${platform}.test/post`; }
      ])),
      withBudget: async (_platform, promise) => promise
    });

    assert.equal(output.uploadsAttempted, 3);
    assert.deepEqual(calls, ['kwai', 'instagram', 'x']);
    assert.deepEqual(output.attemptedPlatforms, calls);
    assert.equal(output.results.clips[clipPath].tiktok, unknown);
    for (const platform of ['kwai', 'instagram', 'x']) {
      assert.equal(output.results.clips[clipPath][platform], `https://${platform}.test/post`);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('first social attempt publishes a targeted clip with no prior result after handler and session checks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-social-first-attempt-'));
  try {
    const clipPath = path.join(root, 'data', 'videos', 'clip.mp4');
    await fs.mkdir(path.dirname(clipPath), { recursive: true });
    await fs.writeFile(clipPath, 'synthetic video fixture');
    const entry = {
      publicationEligible: true,
      ...verifiedSourceEvidence(),
      title: 'Pauta aprovada',
      clips: [{ path: clipPath, title: 'Parte 1', kind: 'social-narrative-part',
        partIndex: 1, partCount: 1, platforms: ['kwai'] }]
    };
    const events = [];
    let uploads = 0;
    const run = isLogged => retryPendingSocialUploads({
      entry, root, results: { clips: {} }, maxUploads: 1,
      onPublicationState: async event => events.push(event),
      isHandlerAvailable: platform => platform === 'kwai',
      isLogged: async platform => platform === 'kwai' && isLogged,
      getMediaDuration: async () => 90,
      videoLimits: { kwai: 299 },
      uploaders: { kwai: async () => { uploads++; return 'https://kwai.test/post/first'; } },
      withBudget: async (_platform, promise) => promise
    });

    const unauthenticated = await run(false);
    assert.equal(unauthenticated.uploadsAttempted, 0);
    assert.equal(events.length, 0);
    const published = await run(true);
    assert.equal(published.uploadsAttempted, 1);
    assert.equal(uploads, 1);
    assert.equal(events[0].result.status, 'attempting');
    assert.equal(events[1].result, 'https://kwai.test/post/first');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a social retry cycle can skip destinations already attempted on other videos', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-social-retry-platform-budget-'));
  try {
    const clipPath = path.join(root, 'data', 'videos', 'clip.mp4');
    await fs.mkdir(path.dirname(clipPath), { recursive: true });
    await fs.writeFile(clipPath, 'synthetic video fixture');
    const calls = [];
    const output = await retryPendingSocialUploads({
      root,
      entry: {
        publicationEligible: true,
        ...verifiedSourceEvidence(),
        title: 'Pauta de teste',
        clips: [{ path: clipPath, kind: 'social-narrative-part', partIndex: 1, partCount: 1,
          platforms: ['instagram', 'kwai'] }]
      },
      results: { clips: { [clipPath]: { instagram: 'não logado', kwai: 'não logado' } } },
      skipPlatforms: ['instagram'],
      onPublicationState: async () => {},
      isLogged: async () => true,
      getMediaDuration: async () => 90,
      videoLimits: { instagram: 180, kwai: 300 },
      uploaders: {
        instagram: async () => { calls.push('instagram'); return 'https://instagram.test/reel'; },
        kwai: async () => { calls.push('kwai'); return 'https://kwai.test/post'; }
      },
      withBudget: async (_platform, promise) => promise,
      maxUploads: 4
    });

    assert.equal(output.uploadsAttempted, 1);
    assert.deepEqual(output.attemptedPlatforms, ['kwai']);
    assert.deepEqual(calls, ['kwai']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('legacy, ambiguous, disabled, and out-of-root clips never reach an uploader', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-social-retry-guard-'));
  try {
    const clipPath = path.join(root, 'data', 'videos', 'clip.mp4');
    const outsidePath = path.join(root, 'outside.mp4');
    await fs.mkdir(path.dirname(clipPath), { recursive: true });
    await fs.writeFile(clipPath, 'synthetic video fixture');
    await fs.writeFile(outsidePath, 'outside fixture');
    const calls = [];
    const dependencies = {
      root,
      onPublicationState: async () => assert.fail('não deve persistir sem envio'),
      isLogged: async () => true,
      getMediaDuration: async () => 45,
      uploaders: { instagram: async () => { calls.push('instagram'); return 'https://example.test/post'; } },
      withBudget: async (_platform, promise) => promise
    };

    const legacy = await retryPendingSocialUploads({
      ...dependencies,
      entry: { clips: [{ path: 'data/videos/clip.mp4' }] },
      results: { clips: { 'data/videos/clip.mp4': { instagram: 'não logado' } } }
    });
    const ambiguous = await retryPendingSocialUploads({
      ...dependencies,
      entry: { publicationEligible: true, ...verifiedSourceEvidence(), clips: [{ path: 'data/videos/clip.mp4' }] },
      results: { clips: { 'data/videos/clip.mp4': { instagram: { status: 'unknown' } } } }
    });
    const mismatchedRetryable = createPublicationResult({
      platform: 'tiktok', videoPath: outsidePath, status: 'skipped', retryable: true,
      failureCode: 'rate_limited', evidence: { kind: 'api_rejected', observed: 'API recusou por limite' },
      nextAttemptAt: new Date(0).toISOString()
    });
    const mismatched = await retryPendingSocialUploads({
      ...dependencies,
      entry: { publicationEligible: true, ...verifiedSourceEvidence(), clips: [{ path: 'data/videos/clip.mp4' }] },
      results: { clips: { 'data/videos/clip.mp4': { instagram: mismatchedRetryable } } },
      now: Date.now()
    });
    const disabled = await retryPendingSocialUploads({
      ...dependencies,
      entry: { publicationEligible: true, ...verifiedSourceEvidence(), clips: [{ path: 'data/videos/clip.mp4' }] },
      results: { clips: { 'data/videos/clip.mp4': { instagram: 'não logado' } } },
      disabledPlatforms: 'instagram'
    });
    const outside = await retryPendingSocialUploads({
      ...dependencies,
      entry: { publicationEligible: true, ...verifiedSourceEvidence(), clips: [{ path: outsidePath }] },
      results: { clips: { [outsidePath]: { instagram: 'não logado' } } }
    });

    assert.equal(legacy.uploadsAttempted, 0);
    assert.equal(ambiguous.uploadsAttempted, 0);
    assert.equal(mismatched.uploadsAttempted, 0);
    assert.equal(disabled.uploadsAttempted, 0);
    assert.equal(outside.uploadsAttempted, 0);
    assert.deepEqual(calls, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a destination held for a missing native handler resumes automatically when that handler is added', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-social-handler-retry-'));
  try {
    const clipPath = path.join(root, 'data', 'videos', 'clip.mp4');
    await fs.mkdir(path.dirname(clipPath), { recursive: true });
    await fs.writeFile(clipPath, 'synthetic video fixture');
    const blocked = createPublicationResult({
      platform: 'instagram', videoPath: clipPath, status: 'failed',
      failureCode: 'social_handler_unavailable',
      evidence: { kind: 'confirmed_no_send', observed: 'handler ausente; publicação não iniciada' }
    });
    const entry = { publicationEligible: true, ...verifiedSourceEvidence(),
      clips: [{ path: 'data/videos/clip.mp4', kind: 'instagram-narrative-part',
        platforms: ['instagram'], partIndex: 1, partCount: 2 }] };
    const events = [];
    let uploads = 0;
    const run = isHandlerAvailable => retryPendingSocialUploads({
      entry, root, results: { clips: { 'data/videos/clip.mp4': { instagram: blocked } } },
      onPublicationState: async event => events.push(event),
      isHandlerAvailable: () => isHandlerAvailable,
      isLogged: async () => true,
      getMediaDuration: async () => 75,
      videoLimits: { instagram: 180 },
      uploaders: { instagram: async () => { uploads++; return 'https://instagram.test/reel/recovered'; } },
      withBudget: async (_platform, promise) => promise
    });

    const held = await run(false);
    assert.equal(held.uploadsAttempted, 0);
    assert.equal(events.length, 0);
    const resumed = await run(true);
    assert.equal(resumed.uploadsAttempted, 1);
    assert.equal(uploads, 1);
    assert.equal(resumed.results.clips['data/videos/clip.mp4'].instagram, 'https://instagram.test/reel/recovered');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an identity-held destination resumes only after the expected account is verified', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-social-identity-retry-'));
  try {
    const clipPath = path.join(root, 'data', 'videos', 'clip.mp4');
    await fs.mkdir(path.dirname(clipPath), { recursive: true });
    await fs.writeFile(clipPath, 'synthetic video fixture');
    const held = createPublicationResult({ platform: 'instagram', videoPath: clipPath, status: 'failed',
      failureCode: 'social_account_identity_unverified',
      evidence: { kind: 'confirmed_no_send', observed: 'handle esperado não aprovado' } });
    const entry = { publicationEligible: true, ...verifiedSourceEvidence(),
      clips: [{ path: 'data/videos/clip.mp4', kind: 'instagram-narrative-part',
        platforms: ['instagram'], partIndex: 1, partCount: 2 }] };
    const events = [];
    let uploads = 0;
    const run = identityVerified => retryPendingSocialUploads({
      entry, root, results: { clips: { 'data/videos/clip.mp4': { instagram: held } } },
      onPublicationState: async event => events.push(event),
      isHandlerAvailable: () => true,
      isLogged: async () => identityVerified,
      getMediaDuration: async () => 75,
      videoLimits: { instagram: 180 },
      uploaders: { instagram: async () => { uploads++; return 'https://instagram.test/reel/approved'; } },
      withBudget: async (_platform, promise) => promise
    });

    const blocked = await run(false);
    assert.equal(blocked.uploadsAttempted, 0);
    assert.equal(uploads, 0);
    const resumed = await run(true);
    assert.equal(resumed.uploadsAttempted, 1);
    assert.equal(uploads, 1);
    assert.equal(events.at(-1).result, 'https://instagram.test/reel/approved');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Instagram-only narrative parts retry only on Instagram and carry the part label', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-instagram-parts-'));
  try {
    const clipPath = path.join(root, 'data', 'videos', 'instagram', 'parte1.mp4');
    await fs.mkdir(path.dirname(clipPath), { recursive: true });
    await fs.writeFile(clipPath, 'synthetic video fixture');
    const calls = [];
    const output = await retryPendingSocialUploads({
      root,
      entry: {
        publicationEligible: true,
        ...verifiedSourceEvidence(),
        title: 'Vídeo completo',
        url: 'https://example.test/source',
        clips: [{ path: 'data/videos/instagram/parte1.mp4', title: 'Vídeo completo', kind: 'instagram-narrative-part',
          platforms: ['instagram'], partIndex: 1, partCount: 2 }]
      },
      results: { clips: { 'data/videos/instagram/parte1.mp4': { instagram: 'não logado' } } },
      onPublicationState: async () => {},
      isLogged: async () => true,
      getMediaDuration: async () => 172,
      videoLimits: { instagram: 180, tiktok: 180, kwai: 300, x: 140 },
      uploaders: {
        instagram: async ({ caption }) => { calls.push({ platform: 'instagram', caption }); return 'https://instagram.test/reel/part1'; },
        tiktok: async () => { calls.push({ platform: 'tiktok' }); return 'https://tiktok.test/part1'; },
        kwai: async () => { calls.push({ platform: 'kwai' }); return 'https://kwai.test/part1'; },
        x: async () => { calls.push({ platform: 'x' }); return 'https://x.test/part1'; }
      },
      withBudget: async (_platform, promise) => promise,
      maxUploads: 1
    });

    assert.equal(output.uploadsAttempted, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].platform, 'instagram');
    assert.match(calls[0].caption, /Parte 1\/2/);
    assert.match(calls[0].caption, /Parte 2/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a nine-second narrative part is blocked from Instagram and TikTok retry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-short-narrative-retry-'));
  try {
    const clipPath = path.join(root, 'data', 'videos', 'parte1.mp4');
    await fs.mkdir(path.dirname(clipPath), { recursive: true });
    await fs.writeFile(clipPath, 'synthetic video fixture');
    const calls = [];
    const output = await retryPendingSocialUploads({
      root,
      entry: {
        publicationEligible: true,
        ...verifiedSourceEvidence(),
        title: 'Explicação completa',
        clips: [{ path: 'data/videos/parte1.mp4', kind: 'instagram-narrative-part',
          platforms: ['instagram', 'tiktok'], partIndex: 1, partCount: 2 }]
      },
      results: { clips: { 'data/videos/parte1.mp4': { instagram: 'não logado', tiktok: 'não logado' } } },
      onPublicationState: async () => assert.fail('não deve iniciar publicação de corte de 9 segundos'),
      isLogged: async () => true,
      getMediaDuration: async () => 9,
      videoLimits: { instagram: 1200, tiktok: 180 },
      uploaders: {
        instagram: async () => { calls.push('instagram'); },
        tiktok: async () => { calls.push('tiktok'); }
      },
      withBudget: async (_platform, promise) => promise,
      maxUploads: 2
    });
    assert.equal(output.uploadsAttempted, 0);
    assert.deepEqual(calls, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an unreviewed clip is excluded from automatic social retries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-visual-scope-social-retry-'));
  try {
    const clipPath = path.join(root, 'data', 'videos', 'clip.mp4');
    await fs.mkdir(path.dirname(clipPath), { recursive: true });
    await fs.writeFile(clipPath, 'synthetic video fixture');
    const calls = [];
    const output = await retryPendingSocialUploads({
      root,
      entry: {
        publicationEligible: true,
        ...verifiedSourceEvidence(),
        title: 'Vídeo completo',
        clips: [{ path: 'data/videos/clip.mp4', platforms: ['instagram'] }]
      },
      results: { clips: { 'data/videos/clip.mp4': { instagram: 'não logado' } } },
      onPublicationState: async () => assert.fail('não deve iniciar publicação de corte não revisado'),
      canPublishArtifact: () => false,
      isLogged: async () => true,
      getMediaDuration: async () => 30,
      videoLimits: { instagram: 180 },
      uploaders: { instagram: async () => { calls.push('instagram'); return 'https://instagram.test/reel'; } },
      withBudget: async (_platform, promise) => promise
    });

    assert.equal(output.uploadsAttempted, 0);
    assert.deepEqual(calls, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
