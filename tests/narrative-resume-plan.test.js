'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadPinnedNarrativePlan, resumePlanPath, savePinnedNarrativePlan } = require('../utils/narrative-resume-plan');
const { isRetryableGenerationFailure } = require('../utils/generation-retry');
const { sha256 } = require('../utils/narrative-episode-plan');

test('a referência criativa aprovada isola planos v2 anteriores sem apagá-los', async t => {
  const { SCHEMA_VERSION } = require('../utils/narrative-episode-plan');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-creative-resume-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDir = path.join(root, 'state'), outputPath = 'videos/episode.mp4';
  const oldFile = path.join(stateDir, 'narrative-resume-plans', `${sha256(Buffer.from(`${SCHEMA_VERSION}\0${outputPath}`))}.json`);
  await fs.mkdir(path.dirname(oldFile), { recursive: true });
  await fs.writeFile(oldFile, 'plano v2 anterior à aprovação de 01/11');
  assert.notEqual(resumePlanPath(root, stateDir, outputPath).file, oldFile);
  assert.equal(await loadPinnedNarrativePlan({ root, stateDir, outputPath, basePlan: {} }), null);
  assert.equal(await fs.readFile(oldFile, 'utf8'), 'plano v2 anterior à aprovação de 01/11');
});

test('plano visual anterior fica preservado e não é reutilizado na nova versão', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-old-plan-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDir = path.join(root, 'state');
  const outputPath = 'videos/episode.mp4';
  const oldFile = path.join(stateDir, 'narrative-resume-plans', `${sha256(Buffer.from(outputPath))}.json`);
  await fs.mkdir(path.dirname(oldFile), { recursive: true });
  await fs.writeFile(oldFile, 'plano anterior preservado');
  assert.notEqual(resumePlanPath(root, stateDir, outputPath).file, oldFile);
  assert.equal(await loadPinnedNarrativePlan({ root, stateDir, outputPath, basePlan: {} }), null);
  assert.equal(await fs.readFile(oldFile, 'utf8'), 'plano anterior preservado');
});

test('retomada reutiliza cenas com mesma narração e fonte mesmo se referências externas mudarem', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-resume-plan-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDir = path.join(root, 'state');
  const outputPath = 'videos/episode.mp4';
  const plan = { schemaVersion: 'v1', jobId: 'job-1', themeId: 'ia', title: 'A pauta',
    fps: 24, durationMs: 1000, durationInFrames: 24, seed: 9,
    narrationSha256: 'a', speechEnvelopeSha256: 'b', source: { contextHash: 'c', reviewStatus: 'approved' },
    chapters: [{ id: 'c1' }], sentences: [{ text: 'Fala aprovada' }], claims: [{ text: 'Fala aprovada' }],
    scriptSha256: 'referencia-antiga', scenes: [{ label: 'A pauta' }], assets: [] };
  const options = { root, stateDir, outputPath, validate: () => ({ valid: true }), verifyAssets: async () => true };
  assert.equal(await loadPinnedNarrativePlan({ ...options, basePlan: plan }), null);
  await savePinnedNarrativePlan({ ...options, plan });
  const refreshed = { ...plan, scriptSha256: 'referencia-nova', scenes: [] };
  assert.deepEqual(await loadPinnedNarrativePlan({ ...options, basePlan: refreshed }), plan);
  await assert.rejects(loadPinnedNarrativePlan({ ...options, basePlan: { ...refreshed, narrationSha256: 'outra' } }),
    error => error.code === 'NARRATIVE_RESUME_PLAN_MISMATCH');
  await assert.rejects(loadPinnedNarrativePlan({ ...options, basePlan: { ...refreshed, sentences: [{ text: 'Outra fala' }] } }),
    error => error.code === 'NARRATIVE_RESUME_PLAN_MISMATCH');
  await assert.rejects(savePinnedNarrativePlan({ ...options, plan }), error => error.code === 'NARRATIVE_RESUME_PLAN_MISMATCH');
  const file = resumePlanPath(root, stateDir, outputPath).file;
  const record = JSON.parse(await fs.readFile(file, 'utf8'));
  record.plan.scenes[0].label = 'alterado';
  await fs.writeFile(file, JSON.stringify(record));
  await assert.rejects(loadPinnedNarrativePlan({ ...options, basePlan: refreshed }),
    error => error.code === 'NARRATIVE_RESUME_PLAN_MISMATCH');
  await fs.writeFile(file, '{malformed');
  await assert.rejects(loadPinnedNarrativePlan({ ...options, basePlan: refreshed }),
    error => error.code === 'NARRATIVE_RESUME_PLAN_MISMATCH');
  assert.equal(isRetryableGenerationFailure('NARRATIVE_RESUME_PLAN_MISMATCH'), true);
  assert.equal(isRetryableGenerationFailure('NARRATIVE_ASSET_INTEGRITY_FAILED'), true);
  assert.equal(isRetryableGenerationFailure('NARRATIVE_RENDER_OUTPUT_COLLISION'), true);
  assert.throws(() => resumePlanPath(root, stateDir, '../fora.mp4'), /fora do projeto/);
});
