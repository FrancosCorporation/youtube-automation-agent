const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createPublicationResult,
  publicationSucceeded,
  youtubeUploadQuotaExceeded,
  isLegacyYouTubeUploadLimit,
  isBackgroundRetryEligible,
  nextPublicationRetryAt,
  longUploadsSucceeded,
  clipUploadsSucceeded,
  clipCanBeDeletedAfterPublication,
  allArtifactOwnersConfirmed,
  artifactOwnerPublicationProofs,
  publicationMatchesTarget,
  allRequiredUploadsSucceeded
} = require('../utils/publication-status');
const { assessSourceEvidence, createPublicationReview } = require('../utils/source-evidence');

test('YouTube quota pause includes Shorts rejection after a confirmed master and ignores other networks/uncertainty', () => {
  const rejection = { status: 'skipped', failureCode: 'quota_exceeded', evidence: { kind: 'api_rejected' } };
  const results = { long: { youtube: 'https://youtube.test/already-published' }, clips: { part: { shorts: rejection } } };
  assert.equal(youtubeUploadQuotaExceeded(results), true);
  assert.equal(youtubeUploadQuotaExceeded({ long: { youtube: rejection } }), true);
  assert.equal(youtubeUploadQuotaExceeded({ clips: { part: { kwai: rejection } } }), false);
  assert.equal(youtubeUploadQuotaExceeded({ long: { youtube: { ...rejection, status: 'unknown' } } }), false);
  assert.equal(youtubeUploadQuotaExceeded({ long: { youtube: { ...rejection, evidence: { kind: 'timeout' } } } }), false);
  assert.equal(youtubeUploadQuotaExceeded({ long: { youtube: 'The user has exceeded the number of videos they may upload.' } }), true);
  assert.equal(isLegacyYouTubeUploadLimit('ERRO: The user has exceeded the number of videos they may upload.', 'youtube'), true);
  assert.equal(isLegacyYouTubeUploadLimit('The user has exceeded the number of videos they may upload.', 'shorts'), true);
  assert.equal(isLegacyYouTubeUploadLimit('ERRO: The user has exceeded the number of videos they may upload.', 'x'), false);
  assert.equal(isLegacyYouTubeUploadLimit('ERRO: The user has exceeded the number of videos they may upload after upload.', 'youtube'), false);
  assert.equal(youtubeUploadQuotaExceeded({}), false);
});

function confirmed(platform, videoPath = '/media/video.mp4') {
  return createPublicationResult({
    platform,
    videoPath,
    status: 'confirmed',
    account: '@pulso',
    evidence: { kind: 'success_message', observed: 'Vídeo publicado com sucesso' }
  });
}

test('publication success requires a URL or a complete confirmation record', () => {
  assert.equal(publicationSucceeded('ok'), false);
  assert.equal(publicationSucceeded('ERRO: timeout'), false);
  assert.equal(publicationSucceeded('https://example.com/posts/123'), true);
  assert.equal(publicationSucceeded({ status: 'submitted' }), false);
  assert.equal(publicationSucceeded({ status: 'confirmed', platform: 'x', confirmedAt: new Date().toISOString() }), false);
  assert.equal(publicationSucceeded(confirmed('instagram')), true);
});

test('a rejected source date cannot be bypassed by factual approval or an eligibility flag', () => {
  const context = 'A reportagem descreve fatos e limites verificáveis para o assunto. '.repeat(8);
  const sourceEvidence = assessSourceEvidence({ sourceTitle: 'Uma fonte com data de publicação verificável', sourceUrl: 'https://example.test/article', context });
  const entry = { publicationEligible: true, sourceEvidence,
    publicationReview: createPublicationReview({ verdict: 'aprovado', sourceContext: context, reviewer: 'independent-reviewers' }) };
  assert.equal(isBackgroundRetryEligible(entry), true);
  entry.sourceChronologyReview = { status: 'rejected', sourceHash: sourceEvidence.contextHash };
  assert.equal(isBackgroundRetryEligible(entry), false);
  entry.sourceChronologyReview.status = 'pending';
  assert.equal(isBackgroundRetryEligible(entry), false);
  entry.sourceChronologyReview.status = 'approved';
  assert.equal(isBackgroundRetryEligible(entry), true);
  entry.sourceChronologyReview.sourceHash = 'b'.repeat(64);
  assert.equal(isBackgroundRetryEligible(entry), false);
});

test('background retry requires explicit eligibility; legacy entries stay untouched', () => {
  assert.equal(isBackgroundRetryEligible({ videoPath: '/media/old.mp4' }), false);
  assert.equal(isBackgroundRetryEligible({ videoPath: '/media/old.mp4', publicationEligible: false }), false);
  assert.equal(isBackgroundRetryEligible({
    videoPath: '/media/new.mp4',
    publicationEligible: true,
    sourceEvidence: assessSourceEvidence({
      sourceTitle: 'Fundat divulga novas vagas de emprego para esta terça-feira, 13',
      sourceUrl: 'https://example.test/vagas',
      context: Array(5).fill('A publicação informa vagas disponíveis, requisitos para inscrição e locais de atendimento aos candidatos interessados.').join(' ')
    }),
    publicationReview: createPublicationReview({
      verdict: 'aprovado',
      sourceContext: Array(5).fill('A publicação informa vagas disponíveis, requisitos para inscrição e locais de atendimento aos candidatos interessados.').join(' '),
      reviewer: 'nvidia/nemotron-3.5-lightning-30b-a3b'
    })
  }), true);
  assert.equal(isBackgroundRetryEligible({ videoPath: '/media/unverified.mp4', publicationEligible: true }), false);
  assert.equal(isBackgroundRetryEligible({
    videoPath: '/media/short-context.mp4',
    publicationEligible: true,
    sourceEvidence: { eligible: true, sourceTitle: 'Título de notícia', contextChars: 1000, contextWords: 200, sourceUrl: 'https://example.test' }
  }), false, 'evidence with no audit timestamp is incomplete');
});

test('retry backoff grows exponentially and is capped', () => {
  const start = Date.parse('2026-10-13T12:00:00.000Z');
  assert.equal(nextPublicationRetryAt(1, start), '2026-10-13T12:01:00.000Z');
  assert.equal(nextPublicationRetryAt(2, start), '2026-10-13T12:02:00.000Z');
  assert.equal(nextPublicationRetryAt(20, start), '2026-10-13T18:00:00.000Z');
});

test('publication result records artifact, account, timestamps and bounded evidence', () => {
  const hash = 'a'.repeat(64);
  const result = createPublicationResult({
    platform: 'TikTok', videoPath: '/media/video.mp4', artifactSha256: hash,
    status: 'confirmed', account: '@pulso',
    evidence: { kind: 'success_message', observed: 'Vídeo publicado com sucesso' }
  });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.platform, 'tiktok');
  assert.equal(result.artifact.path, '/media/video.mp4');
  assert.equal(result.artifact.sha256, hash);
  assert.equal(result.account, '@pulso');
  assert(Number.isFinite(Date.parse(result.submittedAt)));
  assert(Number.isFinite(Date.parse(result.confirmedAt)));
  assert.equal(result.evidence.observed, 'Vídeo publicado com sucesso');
  assert.equal(publicationMatchesTarget(result, 'tiktok', '/media/video.mp4', '/media', hash), true);
  assert.equal(publicationMatchesTarget(result, 'tiktok', '/media/video.mp4', '/media', 'b'.repeat(64)), false);
  assert.equal(publicationMatchesTarget('https://example.test/posts/123', 'tiktok', '/media/video.mp4', '/media', hash), false,
    'legacy URL proof cannot authorize deletion of current bytes without a matching hash');
  assert.throws(() => createPublicationResult({ platform: 'x', videoPath: '/media/video.mp4', status: 'confirmed' }), /exige evidência/);
  assert.throws(() => createPublicationResult({ platform: 'x', videoPath: '/media/video.mp4', status: 'complete' }), /status de publicação inválido/);
});

test('cleanup readiness rejects click-only/unknown social results and accepts explicit evidence', () => {
  const entry = {
    videoPath: '/media/master.mp4',
    clips: [{ path: '/media/clip.mp4', kind: 'social-narrative-part', partIndex: 1, partCount: 1,
      platforms: ['shorts', 'tiktok', 'kwai', 'x'] }]
  };
  const results = {
    long: { youtube: 'https://youtube.com/watch?v=abc' },
    clips: {
      '/media/clip.mp4': {
        shorts: 'desativado',
        tiktok: 'ok',
        kwai: createPublicationResult({ platform: 'kwai', videoPath: '/media/clip.mp4', status: 'submitted', evidence: { kind: 'button_tap', observed: 'Publicar' } }),
        x: confirmed('x', '/media/clip.mp4')
      }
    }
  };
  assert.equal(clipUploadsSucceeded(entry, results, 0, { disabledPlatforms: '', maxShorts: 0 }), false);
  results.clips['/media/clip.mp4'].tiktok = confirmed('tiktok', '/media/clip.mp4');
  results.clips['/media/clip.mp4'].kwai = confirmed('kwai', '/media/clip.mp4');
  assert.equal(clipUploadsSucceeded(entry, results, 0, { disabledPlatforms: '', maxShorts: 0 }), true);

  results.clips['/media/clip.mp4'].x = confirmed('x', '/media/other-clip.mp4');
  assert.equal(clipUploadsSucceeded(entry, results, 0, { disabledPlatforms: '', maxShorts: 0 }), false,
    'structured confirmation for a different artifact must not permit cleanup');
  results.clips['/media/clip.mp4'].x = confirmed('instagram', '/media/clip.mp4');
  assert.equal(clipUploadsSucceeded(entry, results, 0, { disabledPlatforms: '', maxShorts: 0 }), false,
    'structured confirmation for a different platform must not permit cleanup');
});

test('unclassified and legacy micro-clips stay retained for reconciliation instead of being retried or cleaned', () => {
  const entry = {
    videoPath: '/media/master.mp4',
    clips: [{ path: '/media/legacy.mp4', kind: 'social-short-clip', platforms: ['shorts', 'kwai', 'x'] }]
  };
  const results = {
    long: { youtube: 'https://youtube.example/master' },
    clips: { '/media/legacy.mp4': { shorts: 'desativado', kwai: 'não logado', x: 'não logado' } }
  };
  assert.equal(clipUploadsSucceeded(entry, results, 0, { disabledPlatforms: '' }), false);
  assert.equal(allRequiredUploadsSucceeded(entry, results, { disabledPlatforms: '' }), false);
});

test('an Instagram-only part needs confirmation only from its selected destination', () => {
  const entry = {
    videoPath: '/media/master.mp4',
    clips: [{ path: '/media/instagram/part1.mp4', kind: 'instagram-narrative-part', platforms: ['instagram'], partIndex: 1, partCount: 2 }]
  };
  const results = { clips: { '/media/instagram/part1.mp4': {
    instagram: confirmed('instagram', '/media/instagram/part1.mp4')
  } } };
  assert.equal(clipUploadsSucceeded(entry, results, 0, { disabledPlatforms: '', maxShorts: 1 }), true);
});

test('a social part stays on disk until every targeted destination confirms the same asset', () => {
  const clipPath = '/media/instagram-tiktok/part.mp4';
  const entry = {
    videoPath: '/media/master.mp4',
    clips: [{ path: clipPath, kind: 'social-narrative-part', platforms: ['instagram', 'tiktok'] }]
  };
  const terminalFailure = {
    schemaVersion: 1,
    platform: 'tiktok',
    status: 'failed',
    failureCode: 'social_handler_unavailable',
    artifact: { path: clipPath }
  };
  const results = { clips: { [clipPath]: {
    instagram: confirmed('instagram', clipPath),
    tiktok: terminalFailure
  } } };
  assert.equal(clipCanBeDeletedAfterPublication(entry, results, 0, { disabledPlatforms: '' }), false,
    'a terminal handler failure is not a successful publication');

  results.clips[clipPath].tiktok = { ...terminalFailure, status: 'unknown' };
  assert.equal(clipCanBeDeletedAfterPublication(entry, results, 0, { disabledPlatforms: '' }), false,
    'uncertain post outcome must retain the source file');
  results.clips[clipPath].tiktok = {
    ...terminalFailure,
    status: 'failed',
    nextAttemptAt: new Date(Date.now() + 60000).toISOString()
  };
  assert.equal(clipCanBeDeletedAfterPublication(entry, results, 0, { disabledPlatforms: '' }), false,
    'scheduled retry must retain the source file');
  results.clips[clipPath].tiktok = terminalFailure;
  results.clips[clipPath].instagram = confirmed('instagram', '/media/other-part.mp4');
  assert.equal(clipCanBeDeletedAfterPublication(entry, results, 0, { disabledPlatforms: '' }), false,
    'confirmation for a different artifact must not permit deletion');
  results.clips[clipPath].instagram = confirmed('instagram', clipPath);
  results.clips[clipPath].tiktok = confirmed('tiktok', clipPath);
  assert.equal(clipCanBeDeletedAfterPublication(entry, results, 0, { disabledPlatforms: '' }), true,
    'all targeted destinations confirmed the exact clip');
});

test('shared media is deletable only after every ledger owner confirms its own targets', () => {
  const shared = '/media/shared.mp4';
  const ownerA = {
    videoPath: '/media/master-a.mp4',
    clips: [{ path: shared, kind: 'social-narrative-part', platforms: ['instagram'] }],
    results: { clips: { [shared]: { instagram: confirmed('instagram', shared) } } }
  };
  const ownerB = {
    videoPath: '/media/master-b.mp4',
    clips: [{ path: shared, kind: 'social-narrative-part', platforms: ['kwai'] }],
    results: { clips: { [shared]: { kwai: { status: 'unknown' } } } }
  };
  assert.equal(allArtifactOwnersConfirmed([ownerA, ownerB], shared, { disabledPlatforms: '' }), false);
  ownerB.results.clips[shared].kwai = confirmed('kwai', shared);
  assert.equal(allArtifactOwnersConfirmed([ownerA, ownerB], shared, { disabledPlatforms: '' }), true);

  const masterOwner = { videoPath: shared, results: { long: { youtube: 'https://youtube.example/shared' } } };
  assert.equal(allArtifactOwnersConfirmed([masterOwner, { videoPath: shared, results: {} }], shared, { disabledPlatforms: '' }), false);
});

test('deletion evidence retains legacy unknown destinations omitted from current target metadata', () => {
  const clipPath = '/media/legacy.mp4';
  const entry = {
    jobId: 'legacy-job-1234', publicationEligible: false,
    clips: [clipPath],
    results: { clips: { [clipPath]: { kwai: { status: 'unknown', evidence: { kind: 'attempt_outcome_unknown' } } } } }
  };
  const [owner] = artifactOwnerPublicationProofs([entry], clipPath, { root: '/media-root', disabledPlatforms: '' });
  assert.deepEqual(owner.destinations.map(item => [item.platform, item.status]), [['kwai', 'unknown']]);
});

test('a Shorts quota pause retains a social clip even after another destination confirms', () => {
  const clipPath = '/media/part.mp4';
  const entry = {
    videoPath: '/media/master.mp4',
    clips: [{ path: clipPath, kind: 'social-narrative-part', platforms: ['instagram', 'shorts'] }]
  };
  const results = { clips: { [clipPath]: {
    instagram: confirmed('instagram', clipPath),
    shorts: 'pulado (cota)'
  } } };
  assert.equal(clipCanBeDeletedAfterPublication(entry, results, 0, {
    disabledPlatforms: '', maxShorts: 1
  }), false);
});

test('Shorts cleanup confirmation must match the Shorts destination and clip artifact', () => {
  const entry = { videoPath: '/media/master.mp4', clips: [{
    path: '/media/short.mp4', kind: 'social-narrative-part', platforms: ['shorts'], partIndex: 1, partCount: 1
  }] };
  const results = { clips: { '/media/short.mp4': { shorts: confirmed('shorts', '/media/other-short.mp4') } } };
  assert.equal(clipUploadsSucceeded(entry, results, 0, { disabledPlatforms: '', maxShorts: 1 }), false);
  results.clips['/media/short.mp4'].shorts = confirmed('shorts', '/media/short.mp4');
  assert.equal(clipUploadsSucceeded(entry, results, 0, { disabledPlatforms: '', maxShorts: 1 }), true);
});

test('all narrative Shorts parts are required by default when no MAX_SHORTS cap is configured', () => {
  const previousMaxShorts = process.env.MAX_SHORTS;
  delete process.env.MAX_SHORTS;
  try {
    const clips = [1, 2, 3].map(index => ({
      path: `/media/short-part-${index}.mp4`,
      kind: 'social-narrative-part',
      platforms: ['shorts'],
      partIndex: index,
      partCount: 3
    }));
    const entry = { videoPath: '/media/master.mp4', clips };
    const results = {
      long: { youtube: 'https://youtube.example/master' },
      clips: Object.fromEntries(clips.map(clip => [clip.path, { shorts: confirmed('shorts', clip.path) }]))
    };
    results.clips[clips[2].path].shorts = 'pulado (cota)';
    assert.equal(allRequiredUploadsSucceeded(entry, results, { disabledPlatforms: '' }), false,
      'cleanup must retain the master while any eligible narrative part is pending');
    results.clips[clips[2].path].shorts = confirmed('shorts', clips[2].path);
    assert.equal(allRequiredUploadsSucceeded(entry, results, { disabledPlatforms: '' }), true);
  } finally {
    if (previousMaxShorts === undefined) delete process.env.MAX_SHORTS;
    else process.env.MAX_SHORTS = previousMaxShorts;
  }
});

test('long upload cleanup requires Telegram evidence when a channel is configured', () => {
  const original = process.env.TELEGRAM_CHANNEL;
  process.env.TELEGRAM_CHANNEL = '@pulso';
  try {
    const entry = { videoPath: '/media/video.mp4', ytUrl: 'https://youtube.com/watch?v=abc' };
    assert.equal(longUploadsSucceeded(entry, { long: { telegram: 'ok' } }, { disabledPlatforms: '' }), false);
    assert.equal(longUploadsSucceeded(entry, { long: { telegram: confirmed('telegram') } }, { disabledPlatforms: '' }), true);
    assert.equal(longUploadsSucceeded(entry, { long: { telegram: confirmed('telegram', '/media/other-video.mp4') } }, { disabledPlatforms: '' }), false,
      'Telegram confirmation for a different artifact must not permit cleanup');
  } finally {
    if (original === undefined) delete process.env.TELEGRAM_CHANNEL;
    else process.env.TELEGRAM_CHANNEL = original;
  }
});

test('structured YouTube confirmation must match the master artifact', () => {
  const entry = { videoPath: '/media/master.mp4', ytUrl: 'https://youtube.com/watch?v=abc' };
  assert.equal(longUploadsSucceeded(entry, {
    long: { youtube: confirmed('youtube', '/media/other-master.mp4') }
  }, { disabledPlatforms: '' }), false);
  assert.equal(longUploadsSucceeded(entry, {
    long: { youtube: confirmed('youtube', '/media/master.mp4') }
  }, { disabledPlatforms: '' }), true);
  assert.equal(longUploadsSucceeded(entry, {
    long: { youtube: confirmed('x', '/media/master.mp4') }
  }, { disabledPlatforms: '' }), false);
});
