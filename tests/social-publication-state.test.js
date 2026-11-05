const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPublicationResult, publicationSucceeded } = require('../utils/publication-status');
const { checkpointedPublication, knownRejectedUpload, recordPublicationResult, reconcileInterruptedPublicationAttempts, shouldAttemptPublication, shouldInspectSocialRetry, shouldRetrySocialAutomatically } = require('../utils/social-publication-state');

test('retry policy retries only missing or explicitly known no-send outcomes', () => {
  assert.equal(shouldAttemptPublication(undefined), true);
  assert.equal(shouldAttemptPublication('não logado'), true);
  assert.equal(shouldAttemptPublication('pulado (cota)'), true);
  assert.equal(shouldAttemptPublication('ignorado: duração acima do limite'), true);
  assert.equal(shouldAttemptPublication('desativado'), true);
  assert.equal(shouldAttemptPublication('ok'), false);
  assert.equal(shouldAttemptPublication('ERRO: conexão fechada'), false);
  assert.equal(shouldAttemptPublication(createPublicationResult({ platform: 'x', videoPath: '/tmp/x.mp4', status: 'attempting' })), false);
  assert.equal(shouldAttemptPublication(createPublicationResult({ platform: 'x', videoPath: '/tmp/x.mp4', status: 'submitted' })), false);
  assert.equal(shouldAttemptPublication(createPublicationResult({ platform: 'x', videoPath: '/tmp/x.mp4', status: 'unknown' })), false);

  const identityHold = createPublicationResult({ platform: 'instagram', videoPath: '/tmp/clip.mp4', status: 'failed',
    failureCode: 'social_account_identity_unverified', evidence: { kind: 'confirmed_no_send', observed: 'handle esperado não aprovado' } });
  const target = { platform: 'instagram', artifactPath: '/tmp/clip.mp4', root: '/tmp', handlerAvailable: true };
  assert.equal(shouldRetrySocialAutomatically(undefined), false);
  assert.equal(shouldRetrySocialAutomatically(undefined, Date.now(), { ...target, handlerAvailable: false }), false);
  assert.equal(shouldRetrySocialAutomatically(undefined, Date.now(), target), true);
  assert.equal(shouldRetrySocialAutomatically('', Date.now(), target), true);
  assert.equal(shouldAttemptPublication(identityHold, Date.now(), target), false);
  assert.equal(shouldRetrySocialAutomatically(identityHold, Date.now(), target), false);
  assert.equal(shouldInspectSocialRetry(identityHold, Date.now(), target), true, 'scheduler deve reexaminar uma sessão após login');
  assert.equal(shouldInspectSocialRetry(identityHold, Date.now(), { ...target, handlerAvailable: false }), false);
  assert.equal(shouldInspectSocialRetry(createPublicationResult({ platform: 'instagram', videoPath: '/tmp/clip.mp4', status: 'unknown' }), Date.now(), target), false);
  assert.equal(shouldAttemptPublication(identityHold, Date.now(), { ...target, identityVerified: true }), true);
  assert.equal(shouldRetrySocialAutomatically(identityHold, Date.now(), { ...target, identityVerified: true }), true);
});

test('checkpoint writes durable intent before upload and records returned URL', async () => {
  const events = [];
  const result = await checkpointedPublication({
    scope: 'long', platform: 'youtube', videoPath: '/tmp/master.mp4', previous: undefined,
    onPublicationState: async event => events.push(event),
    upload: async () => {
      assert.equal(events.length, 1);
      assert.equal(events[0].result.status, 'attempting');
      return 'https://youtube.com/watch?v=posted';
    }
  });
  assert.equal(events.length, 2);
  assert.equal(events[1].result, 'https://youtube.com/watch?v=posted');
  assert.equal(result, events[1].result);
});

test('hash-bound checkpoint records the exact asset hash with intent and URL confirmation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-hash-bound-send-'));
  const videoPath = path.join(root, 'clip.mp4');
  const bytes = 'approved clip bytes';
  const artifactSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const events = [];
  try {
    await fs.writeFile(videoPath, bytes);
    const result = await checkpointedPublication({
      scope: 'clip', platform: 'youtube', videoPath, artifactSha256,
      onPublicationState: async event => events.push(event),
      upload: async () => {
        assert.equal(events[0].result.artifact.sha256, artifactSha256);
        return 'https://youtube.com/watch?v=hash-bound-post';
      }
    });
    assert.deepEqual(events.map(event => event.result.status), ['attempting', 'confirmed']);
    assert.equal(result.artifact.sha256, artifactSha256);
    assert.equal(result.url, 'https://youtube.com/watch?v=hash-bound-post');
    assert.equal(result.externalId, 'hash-bound-post');
    assert.equal(result.evidence.kind, 'upload_response');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('hash-binding clones a frozen adapter result instead of mutating its artifact', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-frozen-adapter-'));
  const videoPath = path.join(root, 'clip.mp4');
  const bytes = 'approved immutable clip';
  const artifactSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const events = [];
  try {
    await fs.writeFile(videoPath, bytes);
    const created = createPublicationResult({
      platform: 'youtube', videoPath, status: 'confirmed', url: 'https://youtube.com/watch?v=frozen',
      attemptCount: 1, evidence: { kind: 'upload_response', observed: 'URL pública retornada' }
    });
    const adapterResult = Object.freeze({ ...created, artifact: Object.freeze({ ...created.artifact }) });
    const result = await checkpointedPublication({
      scope: 'long', platform: 'youtube', videoPath, artifactSha256,
      onPublicationState: async event => events.push(event),
      upload: async () => adapterResult
    });
    assert.equal(result.status, 'confirmed');
    assert.equal(result.artifact.sha256, artifactSha256);
    assert.equal(adapterResult.artifact.sha256, undefined);
    assert.equal(Object.isFrozen(adapterResult.artifact), true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('hash mismatch before submission is a durable no-send and blocks upload', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-hash-mismatch-send-'));
  const videoPath = path.join(root, 'clip.mp4');
  const events = [];
  let sends = 0;
  try {
    await fs.writeFile(videoPath, 'current bytes');
    const result = await checkpointedPublication({
      scope: 'clip', platform: 'instagram', videoPath, artifactSha256: 'a'.repeat(64),
      onPublicationState: async event => events.push(event),
      upload: async () => { sends++; return { status: 'confirmed' }; }
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.failureCode, 'qa_asset_hash_mismatch');
    assert.equal(result.evidence.kind, 'confirmed_no_send');
    assert.equal(events.length, 1);
    assert.equal(sends, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('artifact mutation during upload converts a returned URL to unknown', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-mutated-send-'));
  const videoPath = path.join(root, 'clip.mp4');
  const bytes = 'approved bytes';
  const artifactSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const events = [];
  try {
    await fs.writeFile(videoPath, bytes);
    const result = await checkpointedPublication({
      scope: 'clip', platform: 'instagram', videoPath, artifactSha256,
      onPublicationState: async event => events.push(event),
      upload: async () => {
        await fs.writeFile(videoPath, 'replacement bytes');
        return 'https://instagram.test/reel/ambiguous';
      }
    });
    assert.equal(result.status, 'unknown');
    assert.equal(result.failureCode, 'artifact_changed_during_upload');
    assert.equal(result.artifact.sha256, artifactSha256);
    assert.equal(result.evidence.kind, 'artifact_changed_after_submission');
    assert.deepEqual(events.map(event => event.result.status), ['attempting', 'unknown']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('checkpoint binds a structured confirmation to the requested platform and artifact', async () => {
  const correctEvents = [];
  const expectedPath = '/tmp/private-kwai-clip.mp4';
  const confirmed = await checkpointedPublication({
    scope: 'clip', platform: 'kwai', videoPath: expectedPath,
    onPublicationState: async event => correctEvents.push(event),
    upload: async () => createPublicationResult({
      platform: 'kwai', videoPath: expectedPath, account: 'qa-account', status: 'confirmed',
      evidence: { kind: 'private_profile_post', observed: 'legenda e horário visíveis no perfil privado' }
    })
  });
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.attemptCount, 1);
  assert.equal(confirmed.account, 'qa-account');
  assert.equal(publicationSucceeded(confirmed), true);
  assert.equal(correctEvents.at(-1).result, confirmed);

  const mismatchedEvents = [];
  const mismatched = await checkpointedPublication({
    scope: 'clip', platform: 'kwai', videoPath: expectedPath,
    onPublicationState: async event => mismatchedEvents.push(event),
    upload: async () => createPublicationResult({
      platform: 'instagram', videoPath: '/tmp/other-clip.mp4', status: 'confirmed',
      evidence: { kind: 'success_message', observed: 'publicação confirmada' }
    })
  });
  assert.equal(mismatched.status, 'unknown');
  assert.equal(mismatched.platform, 'kwai');
  assert.equal(mismatched.artifact.path, expectedPath);
  assert.equal(mismatched.evidence.kind, 'invalid_adapter_result');
  assert.equal(publicationSucceeded(mismatched), false);
  assert.equal(mismatchedEvents.at(-1).result, mismatched);
});

test('uncertain upload outcome is persisted and cannot be retried automatically', async () => {
  const events = [];
  let sends = 0;
  const unknown = await checkpointedPublication({
    scope: 'clip', platform: 'instagram', videoPath: '/tmp/clip.mp4', previous: undefined,
    onPublicationState: async event => events.push(event),
    upload: async () => { sends++; throw new Error('timeout'); }
  });
  assert.equal(unknown.status, 'unknown');
  assert.equal(events[0].result.status, 'attempting');
  assert.equal(events[1].result.status, 'unknown');

  const retried = await checkpointedPublication({
    scope: 'clip', platform: 'instagram', videoPath: '/tmp/clip.mp4', previous: unknown,
    onPublicationState: async () => assert.fail('não deve gravar nova tentativa'),
    upload: async () => { sends++; return 'https://example.test/reposted'; }
  });
  assert.equal(retried, unknown);
  assert.equal(sends, 1);
});

test('explicit quota rejection is safe to retry and keeps its machine-readable reason', async () => {
  const events = [];
  const result = await checkpointedPublication({
    scope: 'long', platform: 'youtube', videoPath: '/tmp/master.mp4',
    onPublicationState: async event => events.push(event),
    upload: async () => {
      const error = new Error('quota exceeded');
      error.response = { status: 403, data: { error: { errors: [{ reason: 'quotaExceeded' }] } } };
      throw error;
    }
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.retryable, true);
  assert.equal(result.failureCode, 'quota_exceeded');
  assert.equal(result.attemptCount, 1);
  assert(Number.isFinite(Date.parse(result.nextAttemptAt)));
  assert.equal(shouldAttemptPublication(result), false);
  assert.equal(shouldAttemptPublication(result, Date.parse(result.nextAttemptAt)), true);
  assert.equal(events.at(-1).result.failureCode, 'quota_exceeded');
});

test('known API rejection preserves a short safe diagnostic for the ledger', () => {
  const rejected = knownRejectedUpload({
    response: {
      status: 400,
      data: { error: { message: 'Invalid metadata at https://private.example/token', errors: [{ reason: 'invalidVideoMetadata' }] } }
    }
  }, 'youtube', '/tmp/master.mp4');
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.failureCode, 'http_400');
  assert.match(rejected.evidence.observed, /invalidVideoMetadata/);
  assert.match(rejected.evidence.observed, /Invalid metadata/);
  assert.doesNotMatch(rejected.evidence.observed, /private\.example|token/);
});

test('known API rejection retains string or nonstandard response bodies safely', () => {
  const rejected = knownRejectedUpload({
    message: 'Request failed with status code 400',
    response: { status: 400, data: 'Invalid request field: snippet.defaultAudioLanguage' }
  }, 'youtube', '/tmp/master.mp4');
  assert.match(rejected.evidence.observed, /defaultAudioLanguage/);
});

test('revoked YouTube refresh token is classified as an account reauthorization blocker', () => {
  const rejected = knownRejectedUpload({
    response: { status: 400, data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }
  }, 'youtube', '/tmp/master.mp4');
  assert.equal(rejected.status, 'failed');
  assert.notEqual(rejected.retryable, true);
  assert.equal(rejected.failureCode, 'oauth_invalid_grant');
  assert.match(rejected.evidence.observed, /nova autorização da conta/);
  assert.doesNotMatch(rejected.evidence.observed, /token has been expired/i);
});

test('confirmed OAuth rejection can retry after reauthorization only for hash-bound QA media', () => {
  const rejected = knownRejectedUpload({
    response: { status: 400, data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }
  }, 'youtube', '/tmp/master.mp4', 1);
  const target = { platform: 'youtube', artifactPath: '/tmp/master.mp4', qaManifestPath: 'data/reports/qa/video.json' };
  const retryAt = Date.parse(rejected.nextAttemptAt);

  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.failureCode, 'oauth_invalid_grant');
  assert(Number.isFinite(retryAt));
  assert.equal(shouldAttemptPublication(rejected, retryAt - 1, target), false);
  assert.equal(shouldAttemptPublication(rejected, retryAt, target), true);
  assert.equal(shouldAttemptPublication(rejected, retryAt, { ...target, qaManifestPath: undefined }), false);
  assert.equal(shouldAttemptPublication(rejected, retryAt, { ...target, platform: 'kwai' }), false);

  const unknown = createPublicationResult({
    platform: 'youtube', videoPath: '/tmp/master.mp4', status: 'unknown', attemptCount: 1,
    evidence: { kind: 'attempt_outcome_unknown', observed: 'verificar antes de reenviar' }
  });
  assert.equal(shouldAttemptPublication(unknown, retryAt, target), false);
});

test('X stage failures become retryable only after cooldown with explicit no-send evidence', () => {
  const at = Date.parse('2026-11-05T10:00:00Z');
  for (const stage of ['input', 'identity', 'composer', 'existing_draft', 'media_upload', 'media_readiness']) {
    const result = createPublicationResult({ platform: 'x', videoPath: '/tmp/x.mp4', status: 'failed',
      failureCode: `x_${stage}_failed`, evidence: { kind: 'confirmed_no_send', observed: 'failed before Post' } });
    result.submittedAt = new Date(at).toISOString();
    assert.equal(shouldRetrySocialAutomatically(result, at), false);
    assert.equal(shouldRetrySocialAutomatically(result, at + 60000), true);
    assert.equal(shouldRetrySocialAutomatically({ ...result, status: 'unknown' }, at + 60000), false);
    assert.equal(shouldRetrySocialAutomatically({ ...result, platform: 'instagram' }, at + 60000), false);
    assert.equal(shouldRetrySocialAutomatically({ ...result, evidence: { kind: 'submission_unverified', observed: 'uncertain' } }, at + 60000), false);
    assert.equal(shouldRetrySocialAutomatically({ ...result, failureCode: 'x_post_failed' }, at + 60000), false);
  }
});

test('social retry allows only safe no-send or due retryable outcomes', () => {
  assert.equal(shouldRetrySocialAutomatically(undefined), false);
  assert.equal(shouldRetrySocialAutomatically('não logado'), true);
  assert.equal(shouldRetrySocialAutomatically('desativado'), false);
  assert.equal(shouldRetrySocialAutomatically(createPublicationResult({ platform: 'x', videoPath: '/tmp/x.mp4', status: 'submitted' })), false);
  assert.equal(shouldRetrySocialAutomatically(createPublicationResult({ platform: 'x', videoPath: '/tmp/x.mp4', status: 'unknown' })), false);
  const retryable = createPublicationResult({
    platform: 'x', videoPath: '/tmp/x.mp4', status: 'skipped', retryable: true,
    failureCode: 'rate_limited',
    evidence: { kind: 'api_rejected', observed: 'API recusou por limite de requisições' },
    nextAttemptAt: new Date(Date.now() + 60_000).toISOString()
  });
  assert.equal(shouldRetrySocialAutomatically(retryable), false);
  assert.equal(shouldRetrySocialAutomatically(retryable, Date.parse(retryable.nextAttemptAt)), true);
  assert.equal(shouldRetrySocialAutomatically(retryable, Date.parse(retryable.nextAttemptAt), {
    platform: 'x', artifactPath: '/tmp/x.mp4'
  }), true);
  assert.equal(shouldRetrySocialAutomatically(retryable, Date.parse(retryable.nextAttemptAt), {
    platform: 'instagram', artifactPath: '/tmp/x.mp4'
  }), false, 'retryable record for another platform must not trigger upload');
  assert.equal(shouldRetrySocialAutomatically(retryable, Date.parse(retryable.nextAttemptAt), {
    platform: 'x', artifactPath: '/tmp/other.mp4'
  }), false, 'retryable record for another artifact must not trigger upload');

  const missingBackoff = { ...retryable };
  delete missingBackoff.nextAttemptAt;
  assert.equal(shouldRetrySocialAutomatically(missingBackoff), false);
  assert.equal(shouldAttemptPublication(missingBackoff), false);
  assert.equal(shouldRetrySocialAutomatically({ ...retryable, nextAttemptAt: 'invalid' }), false);
  assert.equal(shouldRetrySocialAutomatically({ ...retryable, failureCode: 'temporary_error' }, Date.now() + 120_000), false);
  assert.equal(shouldRetrySocialAutomatically({ ...retryable, evidence: { kind: 'timeout', observed: 'sem resposta' } }, Date.now() + 120_000), false);
  assert.throws(() => createPublicationResult({
    platform: 'x', videoPath: '/tmp/x.mp4', status: 'skipped', retryable: true,
    nextAttemptAt: new Date(Date.now() - 1000).toISOString()
  }), /rejeição explícita/);
  assert.throws(() => createPublicationResult({
    platform: 'x', videoPath: '/tmp/x.mp4', status: 'skipped', retryable: true
  }), /rejeição explícita/);
  assert.throws(() => createPublicationResult({
    platform: 'x', videoPath: '/tmp/x.mp4', status: 'skipped', retryable: true,
    failureCode: 'rate_limited', evidence: { kind: 'api_rejected', observed: 'API recusou por limite' },
    nextAttemptAt: 'invalid'
  }), /retryable exige nextAttemptAt válido/);
});

test('confirmed pre-submit UI failures retry with bounded backoff and preserve ambiguous sends', async () => {
  const result = await checkpointedPublication({
    scope: 'clip', platform: 'kwai', videoPath: '/tmp/kwai-clip.mp4',
    onPublicationState: async () => {},
    upload: async () => createPublicationResult({
      platform: 'kwai', videoPath: '/tmp/kwai-clip.mp4', status: 'failed',
      failureCode: 'pre_submit_ui_error',
      evidence: { kind: 'confirmed_no_send', observed: 'UI caiu antes do toque em publicar' }
    })
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.attemptCount, 1);
  const retryAt = Date.parse(result.nextAttemptAt);
  assert.equal(retryAt, Date.parse(result.submittedAt) + 60_000);
  assert.equal(shouldAttemptPublication(result, retryAt - 1), false);
  assert.equal(shouldRetrySocialAutomatically(result, retryAt - 1), false);
  assert.equal(shouldAttemptPublication(result, retryAt), true);
  assert.equal(shouldRetrySocialAutomatically(result, retryAt), true);
  assert.equal(shouldRetrySocialAutomatically(result, retryAt, {
    platform: 'kwai', artifactPath: '/tmp/other.mp4', root: '/tmp'
  }), false);

  const ambiguous = {
    ...result,
    evidence: { kind: 'attempt_outcome_unknown', observed: 'não sei se publicou' }
  };
  assert.equal(shouldAttemptPublication(ambiguous, retryAt + 60_000), false);
  assert.equal(shouldRetrySocialAutomatically(ambiguous, retryAt + 60_000), false);

  const unrelatedFailure = { ...result, failureCode: 'session_expired' };
  assert.equal(shouldAttemptPublication(unrelatedFailure, retryAt + 60_000), false);
  assert.equal(shouldRetrySocialAutomatically(unrelatedFailure, retryAt + 60_000), false);
});

test('Studio confirmed no-send failures honor the explicit retry time; unknown uploads stay held', () => {
  const now = Date.now();
  const retryAt = now + 24 * 60 * 60 * 1000;
  const refusal = createPublicationResult({
    platform: 'youtube', videoPath: '/tmp/studio-master.mp4', status: 'failed',
    failureCode: 'youtube_upload_limit', nextAttemptAt: new Date(retryAt).toISOString(),
    evidence: { kind: 'confirmed_no_send', observed: 'Studio confirmou que o upload foi recusado por limite diário.' }
  });
  assert.equal(shouldAttemptPublication(refusal, retryAt - 1), false);
  assert.equal(shouldAttemptPublication(refusal, retryAt), true);

  const sessionFailure = createPublicationResult({
    platform: 'youtube', videoPath: '/tmp/studio-master.mp4', status: 'failed',
    failureCode: 'YOUTUBE_STUDIO_SESSION_UNAVAILABLE',
    nextAttemptAt: new Date(now + 5 * 60 * 1000).toISOString(),
    evidence: { kind: 'confirmed_no_send', observed: 'Studio exige login; nenhum vídeo foi selecionado.' }
  });
  assert.equal(shouldAttemptPublication(sessionFailure), false);
  assert.equal(shouldAttemptPublication(sessionFailure, Date.parse(sessionFailure.nextAttemptAt)), true);

  const uncertain = createPublicationResult({
    platform: 'youtube', videoPath: '/tmp/studio-master.mp4', status: 'unknown',
    failureCode: 'youtube_studio_outcome_unknown',
    evidence: { kind: 'attempt_outcome_unknown', observed: 'Upload começou; reconciliar antes de repetir.' }
  });
  assert.equal(shouldAttemptPublication(uncertain, retryAt + 86400000), false);
});

test('erro DNS legado antes do envio pode ser retomado, mantendo outras falhas desconhecidas retidas', () => {
  const result = createPublicationResult({ platform: 'youtube', videoPath: '/tmp/studio.mp4', status: 'failed',
    failureCode: 'youtube_studio_pre_submit_failed', attemptCount: 2,
    evidence: { kind: 'confirmed_no_send', observed: 'page.goto: net::ERR_NAME_NOT_RESOLVED' } });
  const retryAt = Date.parse(result.submittedAt) + 120000;
  assert.equal(shouldAttemptPublication(result, retryAt - 1), false);
  assert.equal(shouldAttemptPublication(result, retryAt), true);
  assert.equal(shouldAttemptPublication({ ...result, evidence: { ...result.evidence, observed: 'outra falha' } }, retryAt), false);
  assert.equal(shouldAttemptPublication({ ...result, status: 'unknown' }, retryAt), false);
});

test('Instagram storage shortages wait for recovery before another confirmed no-send retry', async () => {
  const result = await checkpointedPublication({
    scope: 'clip', platform: 'instagram', videoPath: '/tmp/instagram-clip.mp4',
    onPublicationState: async () => {},
    upload: async () => createPublicationResult({
      platform: 'instagram', videoPath: '/tmp/instagram-clip.mp4', status: 'failed',
      failureCode: 'android_storage_insufficient',
      evidence: { kind: 'confirmed_no_send', observed: '5 MiB livres; 48 MiB necessários' }
    })
  });

  const retryAt = Date.parse(result.nextAttemptAt);
  assert.equal(result.failureCode, 'android_storage_insufficient');
  assert.equal(retryAt, Date.parse(result.submittedAt) + 30 * 60_000);
  assert.equal(shouldRetrySocialAutomatically(result, retryAt - 1), false);
  assert.equal(shouldRetrySocialAutomatically(result, retryAt), true);
});

test('an unavailable handler is held without retry and becomes eligible when the real handler is installed', () => {
  const blocked = createPublicationResult({
    platform: 'instagram', videoPath: '/tmp/instagram-clip.mp4', status: 'failed',
    failureCode: 'social_handler_unavailable',
    evidence: { kind: 'confirmed_no_send', observed: 'handler não configurado; submissão não iniciada' }
  });
  const target = { platform: 'instagram', artifactPath: blocked.artifact.path, root: '/tmp' };

  assert.equal(shouldAttemptPublication(blocked, Date.now(), { ...target, handlerAvailable: false }), false);
  assert.equal(shouldRetrySocialAutomatically(blocked, Date.now(), { ...target, handlerAvailable: false }), false);
  assert.equal(shouldAttemptPublication(blocked, Date.now(), { ...target, handlerAvailable: true }), true);
  assert.equal(shouldRetrySocialAutomatically(blocked, Date.now(), { ...target, handlerAvailable: true }), true);
});

test('checkpoint does not send when retry state belongs to another destination or artifact', async () => {
  const previous = createPublicationResult({
    platform: 'x', videoPath: '/tmp/other.mp4', status: 'skipped', retryable: true,
    failureCode: 'rate_limited', evidence: { kind: 'api_rejected', observed: 'API recusou por limite' },
    nextAttemptAt: new Date(0).toISOString()
  });
  let sends = 0;
  const result = await checkpointedPublication({
    scope: 'clip', platform: 'instagram', videoPath: '/tmp/clip.mp4', previous,
    onPublicationState: async () => assert.fail('mismatched state must not be persisted as an Instagram retry'),
    upload: async () => { sends++; return 'https://instagram.test/reel/duplicate'; }
  });
  assert.equal(result, previous);
  assert.equal(sends, 0);
});

test('ledger integration preserves an interrupted destination and blocks duplicate send', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-publication-interruption-'));
  try {
    const ledgerPath = path.join(root, 'topics.json');
    const master = path.join(root, 'master.mp4');
    const clip = path.join(root, 'clip.mp4');
    await fs.writeFile(ledgerPath, JSON.stringify({ entries: [{ videoPath: master, clips: [{ path: clip }], results: {} }] }));
    const persist = event => recordPublicationResult(ledgerPath, master, event, { root });
    let sends = 0;
    const result = await checkpointedPublication({
      scope: 'clip', platform: 'instagram', videoPath: clip,
      onPublicationState: persist,
      upload: async () => { sends++; throw new Error('worker interrupted after request'); }
    });
    const saved = JSON.parse(await fs.readFile(ledgerPath, 'utf8')).entries[0];
    const previous = saved.results.clips[clip].instagram;
    assert.equal(result.status, 'unknown');
    assert.equal(previous.status, 'unknown');

    await checkpointedPublication({
      scope: 'clip', platform: 'instagram', videoPath: clip, previous,
      onPublicationState: persist,
      upload: async () => { sends++; return 'https://example.test/duplicate'; }
    });
    assert.equal(sends, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('publication intent and outcomes are persisted per destination without overwriting siblings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-publication-ledger-'));
  try {
    const ledgerPath = path.join(root, 'data', 'state', 'topics.json');
    const master = path.join(root, 'data', 'videos', 'master.mp4');
    const clip = path.join(root, 'data', 'videos', 'clip.mp4');
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
    await fs.writeFile(ledgerPath, JSON.stringify({ entries: [{
      videoPath: 'data/videos/master.mp4',
      ytUrl: 'https://youtube.com/watch?v=yt',
      results: { long: { youtube: 'https://youtube.com/watch?v=yt' }, clips: { 'data/videos/clip.mp4': { instagram: 'old-state' } } }
    }] }));

    const intent = createPublicationResult({ platform: 'tiktok', videoPath: clip, status: 'attempting', evidence: { kind: 'intent', observed: 'tentativa registrada antes do envio' } });
    await recordPublicationResult(ledgerPath, master, { scope: 'clip', platform: 'tiktok', artifactPath: clip, result: intent }, { root });
    let saved = JSON.parse(await fs.readFile(ledgerPath, 'utf8')).entries[0];
    assert.equal(saved.results.clips['data/videos/clip.mp4'].tiktok.status, 'attempting');
    assert.equal(saved.results.clips['data/videos/clip.mp4'].instagram, 'old-state');

    const submitted = createPublicationResult({ platform: 'tiktok', videoPath: clip, status: 'unknown', evidence: { kind: 'crash', observed: 'worker terminou sem confirmação' } });
    await recordPublicationResult(ledgerPath, master, { scope: 'clip', platform: 'tiktok', artifactPath: clip, result: submitted }, { root });
    saved = JSON.parse(await fs.readFile(ledgerPath, 'utf8')).entries[0];
    assert.equal(saved.results.clips['data/videos/clip.mp4'].tiktok.status, 'unknown');
    assert.equal(saved.results.long.youtube, 'https://youtube.com/watch?v=yt');

    await recordPublicationResult(ledgerPath, master, { scope: 'long', platform: 'telegram', artifactPath: master, result: 'não logado' }, { root });
    saved = JSON.parse(await fs.readFile(ledgerPath, 'utf8')).entries[0];
    assert.equal(saved.results.long.telegram, 'não logado');
    assert.equal(saved.ytUrl, 'https://youtube.com/watch?v=yt');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ledger rejects result events whose scope, destination, or artifact does not match', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-publication-event-identity-'));
  try {
    const ledgerPath = path.join(root, 'topics.json');
    const master = path.join(root, 'data', 'videos', 'master.mp4');
    const clip = path.join(root, 'data', 'videos', 'clip.mp4');
    const unrelated = path.join(root, 'data', 'videos', 'unrelated.mp4');
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
    const initial = { entries: [{ videoPath: master, clips: [{ path: clip }], results: {} }] };
    await fs.writeFile(ledgerPath, JSON.stringify(initial));
    const invalidEvents = [
      {
        scope: 'clip', platform: 'instagram', artifactPath: unrelated,
        result: createPublicationResult({ platform: 'instagram', videoPath: unrelated, status: 'confirmed', evidence: { kind: 'fixture', observed: 'confirmed' } })
      },
      {
        scope: 'clip', platform: 'instagram', artifactPath: clip,
        result: createPublicationResult({ platform: 'instagram', videoPath: unrelated, status: 'confirmed', evidence: { kind: 'fixture', observed: 'confirmed' } })
      },
      {
        scope: 'clip', platform: 'instagram', artifactPath: clip,
        result: createPublicationResult({ platform: 'x', videoPath: clip, status: 'confirmed', evidence: { kind: 'fixture', observed: 'confirmed' } })
      },
      {
        scope: 'long', platform: 'youtube', artifactPath: master,
        result: createPublicationResult({ platform: 'youtube', videoPath: unrelated, status: 'confirmed', evidence: { kind: 'fixture', observed: 'confirmed' } })
      }
    ];

    for (const event of invalidEvents) {
      await assert.rejects(recordPublicationResult(ledgerPath, master, event, { root }), /não corresponde/);
      assert.deepEqual(JSON.parse(await fs.readFile(ledgerPath, 'utf8')), initial,
        'invalid publication evidence must not mutate the ledger');
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('confirmed publication cannot be downgraded by a stale attempt update', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-publication-merge-'));
  try {
    const ledgerPath = path.join(root, 'topics.json');
    const master = path.join(root, 'master.mp4');
    const clip = path.join(root, 'clip.mp4');
    const confirmed = createPublicationResult({
      platform: 'instagram', videoPath: clip, status: 'confirmed',
      evidence: { kind: 'success_message', observed: 'publicação confirmada' }
    });
    await fs.writeFile(ledgerPath, JSON.stringify({ entries: [{ videoPath: master, results: { clips: { [clip]: { instagram: confirmed } } } }] }));
    const attempted = createPublicationResult({ platform: 'instagram', videoPath: clip, status: 'attempting' });
    await recordPublicationResult(ledgerPath, master, { scope: 'clip', platform: 'instagram', artifactPath: clip, result: attempted }, { root });
    const saved = JSON.parse(await fs.readFile(ledgerPath, 'utf8')).entries[0];
    assert.equal(saved.results.clips[clip].instagram.status, 'confirmed');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('scheduler recovery marks only interrupted attempts for the recovered master as unknown', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-publication-recovery-'));
  try {
    const ledgerPath = path.join(root, 'topics.json');
    const master = path.join(root, 'data', 'videos', 'master.mp4');
    const clip = path.join(root, 'data', 'videos', 'clip.mp4');
    const otherMaster = path.join(root, 'data', 'videos', 'other.mp4');
    const attempting = (platform, artifactPath) => createPublicationResult({
      platform,
      videoPath: artifactPath,
      status: 'attempting',
      attemptCount: 2,
      evidence: { kind: 'durable_intent', observed: 'fixture intent' }
    });
    const confirmed = createPublicationResult({
      platform: 'kwai',
      videoPath: clip,
      status: 'confirmed',
      evidence: { kind: 'test_fixture', observed: 'fixture confirmado' }
    });
    await fs.writeFile(ledgerPath, JSON.stringify({ entries: [
      {
        videoPath: master,
        clips: [{ path: clip }],
        results: {
          long: { youtube: attempting('youtube', master) },
          clips: { [clip]: { instagram: attempting('instagram', clip), kwai: confirmed } }
        }
      },
      { videoPath: otherMaster, clips: [], results: { long: { youtube: attempting('youtube', otherMaster) } } }
    ] }));

    const recovery = await reconcileInterruptedPublicationAttempts(ledgerPath, master, {
      root,
      now: Date.parse('2026-10-13T20:00:00.000Z')
    });
    assert.deepEqual(recovery, { matched: true, reconciled: 2 });
    const saved = JSON.parse(await fs.readFile(ledgerPath, 'utf8')).entries;
    const recovered = saved[0].results;
    assert.equal(recovered.long.youtube.status, 'unknown');
    assert.equal(recovered.long.youtube.attemptCount, 2);
    assert.equal(recovered.long.youtube.reconciledAt, '2026-10-13T20:00:00.000Z');
    assert.equal(recovered.long.youtube.evidence.kind, 'interrupted_attempt_reconciliation');
    assert.equal(recovered.clips[clip].instagram.status, 'unknown');
    assert.equal(recovered.clips[clip].kwai.status, 'confirmed');
    assert.equal(saved[1].results.long.youtube.status, 'attempting');

    let sends = 0;
    const result = await checkpointedPublication({
      scope: 'long', platform: 'youtube', videoPath: master, previous: recovered.long.youtube,
      onPublicationState: async () => assert.fail('não deve gravar nem reenviar estado ambíguo'),
      upload: async () => { sends++; return 'https://youtube.test/duplicate'; }
    });
    assert.equal(result.status, 'unknown');
    assert.equal(sends, 0);

    assert.deepEqual(await reconcileInterruptedPublicationAttempts(ledgerPath, master, { root }), { matched: true, reconciled: 0 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
