'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { APPROVED_NARRATIVE_RENDERER, canRunMigrationCanary, isScheduledGenerationPaused,
  isVideoGenerationPaused, migrationCanaryRetryDelayMs, autonomousNarrativePublicationDecision, isApprovedExistingEpisode } = require('../utils/video-generation-control');

test('pausa geração somente quando explicitamente habilitada', () => {
  const absentMarker = path.join(__dirname, `missing-pause-marker-${process.pid}`);
  assert.equal(isVideoGenerationPaused({}, absentMarker), false);
  assert.equal(isVideoGenerationPaused({ PAUSE_VIDEO_GENERATION: '0' }, absentMarker), false);
  assert.equal(isVideoGenerationPaused({ PAUSE_VIDEO_GENERATION: 'true' }, absentMarker), false);
  assert.equal(isVideoGenerationPaused({ PAUSE_VIDEO_GENERATION: '1' }, absentMarker), true);
});

test('marcador da migração também pausa o scheduler sem variável de ambiente', () => {
  assert.equal(isVideoGenerationPaused({}, process.execPath), true);
});

test('canário permite só a geração após o horário previsto, preservando a pausa de publicação', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-migration-canary-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const markerPath = path.join(dir, 'paused');
  const canaryPath = path.join(dir, 'canary.json');
  const options = { env: {}, markerPath, canaryPath, now: Date.parse('2026-10-29T00:00:05Z') };
  fs.writeFileSync(markerPath, 'migration');
  assert.equal(isScheduledGenerationPaused(options), true);
  fs.writeFileSync(canaryPath, JSON.stringify({ version: 1, renderer: APPROVED_NARRATIVE_RENDERER, notBefore: '2026-10-29T00:00:05Z' }));
  assert.equal(canRunMigrationCanary({ ...options, now: options.now - 1 }), false);
  assert.equal(canRunMigrationCanary(options), true);
  assert.equal(isScheduledGenerationPaused(options), false);
  assert.equal(isVideoGenerationPaused(options.env, markerPath), true);
  assert.equal(isScheduledGenerationPaused({ ...options, env: { PAUSE_VIDEO_GENERATION: '1' } }), true);
  fs.writeFileSync(canaryPath, '{corrompido');
  assert.equal(isScheduledGenerationPaused(options), true);
  fs.writeFileSync(canaryPath, JSON.stringify({ version: 1, renderer: 'renderer-antigo', notBefore: '2026-10-29T00:00:05Z' }));
  assert.equal(isScheduledGenerationPaused(options), true);
  fs.unlinkSync(markerPath);
  assert.equal(canRunMigrationCanary(options), false);
});

test('writer indisponível no canário aguarda ao menos meia hora antes de tentar novamente', () => {
  assert.equal(migrationCanaryRetryDelayMs('script_generation_unavailable', 5 * 60000, true), 30 * 60000);
  assert.equal(migrationCanaryRetryDelayMs('script_generation_unavailable', 40 * 60000, true), 40 * 60000);
  assert.equal(migrationCanaryRetryDelayMs('script_generation_unavailable', 5 * 60000, false), 5 * 60000);
  assert.equal(migrationCanaryRetryDelayMs('host_resource_gate', 5 * 60000, true), 5 * 60000);
});

test('episódio anterior continua preservado, mas não é elegível ao novo padrão automático', () => {
  const sourceHash = '96090856f3afa11d6737bfe6b186aa9501579d9a1e083b1c4511c373f182a7ea';
  const entry = { jobId: 'ia-answer-20261023-gps-v2', renderer: 'remotion-gps-v2-narrative-episode',
    qaManifestSha256: '74a2334a5caf38d1d49720267ee58639f718da758f5c519481323fe07eca9d52',
    publicationEligible: true, sourceEvidence: { contextHash: sourceHash }, publicationReview: { status: 'approved', sourceHash } };
  const qa = { status: 'verified', visualReview: 'approved', factualReviewStatus: 'approved', sourceHash };
  assert.equal(isApprovedExistingEpisode(entry), true);
  assert.equal(isApprovedExistingEpisode({ ...entry, jobId: 'outro-job' }), false);
  assert.equal(isApprovedExistingEpisode({ ...entry, qaManifestSha256: '0'.repeat(64) }), false);
  assert.equal(autonomousNarrativePublicationDecision(entry, qa).allowed, false);
  assert.equal(autonomousNarrativePublicationDecision({ ...entry, jobId: 'outro-job' }, qa).allowed, false);
  assert.equal(autonomousNarrativePublicationDecision({ ...entry, qaManifestSha256: '0'.repeat(64) }, qa).allowed, false);
  assert.equal(autonomousNarrativePublicationDecision(entry, { ...qa, status: 'mismatch' }).allowed, false);
  assert.equal(autonomousNarrativePublicationDecision(entry, { ...qa, visualReview: 'pending' }).allowed, false);
  assert.equal(autonomousNarrativePublicationDecision(entry, { ...qa, sourceHash: '0'.repeat(64) }).allowed, false);
});

test('o novo padrão exige renderer, revisão determinística e hashes coerentes', () => {
  const sourceHash = 'a'.repeat(64);
  const renderer = 'remotion-4.0.537-narrative-episode-v2-approved-robot';
  const entry = { renderer, publicationEligible: true, sourceEvidence: { contextHash: sourceHash },
    publicationReview: { status: 'approved', sourceHash } };
  const qa = { status: 'verified', renderer, visualMode: 'narrative-episode-v2',
    factualReviewStatus: 'approved', sourceHash, reviewer: 'deterministic-source-evidence-v1',
    scenePlan: { sha256: 'c'.repeat(64), visualRhythm: { schemaVersion: 1, rule: 'long-cue-shot-variation-v1',
      status: 'passed', planSha256: 'c'.repeat(64) } } };
  assert.equal(autonomousNarrativePublicationDecision(entry, qa).allowed, true);
  assert.equal(autonomousNarrativePublicationDecision({ ...entry, renderer: renderer.replace('-v2-', '-v1-') }, qa).allowed, false);
  assert.equal(autonomousNarrativePublicationDecision(entry, { ...qa, visualMode: 'narrative-episode-v1' }).allowed, false);
  assert.equal(autonomousNarrativePublicationDecision(entry, { ...qa, reviewer: 'model' }).allowed, false);
  assert.equal(autonomousNarrativePublicationDecision(entry, { ...qa, sourceHash: 'b'.repeat(64) }).allowed, false);
  assert.equal(autonomousNarrativePublicationDecision(entry, { ...qa, scenePlan: null }).allowed, false);
  assert.equal(autonomousNarrativePublicationDecision(entry, { ...qa, scenePlan: { ...qa.scenePlan,
    visualRhythm: { ...qa.scenePlan.visualRhythm, planSha256: 'd'.repeat(64) } } }).allowed, false);
});

test('somente a referência exata aprovada usa a auditoria pontual', () => {
  const sourceHash = '34410029c8a61ad66439587fea28ac9e34ace9a1a54b49eae667ef18ed6fa26f';
  const reviewer = 'owner-approved-reference-source-audit-v1';
  const renderer = 'owner-approved-internet-reference-v2';
  const entry = { jobId: 'pulso-internet-reference-20261029', renderer, publicationEligible: true,
    sourceEvidence: { contextHash: sourceHash }, publicationReview: { status: 'approved', reviewer, sourceHash } };
  const qa = { status: 'verified', renderer, visualMode: 'approved-reference-v2', visualReview: 'approved', factualReviewStatus: 'approved', reviewer, sourceHash,
    assetProofs: [
      { role: 'master', sha256: '573ee1802fdac2bc294acc51b101a8e0c7e5e5fababc40aeb5854efe4f3838aa' },
      { role: 'social_part', sha256: '5b902a7348522e466c5be1a203de872a36f1c373f816e7d516cbf9beb8ee2882' }
    ] };
  assert.equal(autonomousNarrativePublicationDecision(entry, qa).allowed, true);
  assert.equal(autonomousNarrativePublicationDecision({ ...entry, jobId: 'outro-video' }, qa).allowed, false);
  assert.equal(autonomousNarrativePublicationDecision(entry, { ...qa, assetProofs: [qa.assetProofs[0]] }).allowed, false);
  assert.equal(autonomousNarrativePublicationDecision(entry, { ...qa, sourceHash: 'b'.repeat(64) }).allowed, false);
  assert.equal(autonomousNarrativePublicationDecision(entry, { ...qa, visualReview: 'pending' }).allowed, false);
});
