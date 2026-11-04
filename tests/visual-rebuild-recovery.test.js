'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { enqueueVisualRebuilds, finishVisualRebuild, prepareVisualRebuildOutput } = require('../utils/visual-rebuild-recovery');
const { createGenerationAttemptStore, validateAttempt } = require('../utils/generation-attempt');
const { createDeferredGenerationQueue } = require('../utils/deferred-generation-queue');
const { assessSourceEvidence, createPublicationReview } = require('../utils/source-evidence');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'data/reports/qa'), { recursive: true });
  await fs.mkdir(path.join(root, 'data/state'), { recursive: true });
  const ledgerPath = path.join(root, 'data/state/topics.json');
  const context = 'A reportagem descreve fatos verificáveis e os limites da informação apresentada ao público. '.repeat(20);
  const sourceEvidence = assessSourceEvidence({ sourceTitle: 'Uma fonte verificável', sourceUrl: 'https://example.test/article', context });
  const entry = { videoId: 'vid_1234567890', theme: 'psicologia', publicationEligible: true, sourceEvidence,
    publicationReview: createPublicationReview({ verdict: 'aprovado', sourceContext: context, reviewer: 'fixture' }),
    qaManifestPath: 'data/reports/qa/source.json', qaManifestSha256: 'a'.repeat(64) };
  const manifest = { editorial: { visualMode: 'narrative-episode-v2' }, visualReview: { status: 'rejected', rebuildRequired: true,
    critique: { findings: [{ correction: { operation: 'reauthor-narrative' } }] } } };
  const save = async () => {
    await fs.writeFile(ledgerPath, JSON.stringify({ entries: [entry] }));
    await fs.writeFile(path.join(root, entry.qaManifestPath), JSON.stringify(manifest));
  };
  await save();
  const store = createGenerationAttemptStore({ root, filePath: path.join(root, 'data/state/generation-in-flight.json') });
  const queue = createDeferredGenerationQueue({ root, filePath: path.join(root, 'data/state/deferred.json'), attemptStore: store });
  const options = { root, ledgerPath, queue, activeThemes: ['psicologia'],
    loadCritique: async () => ({ sourceEditorial: { seed: 123, formatId: 'question-payoff' } }) };
  return { root, ledgerPath, entry, manifest, save, store, queue, options };
}

test('a rejected narrative gets one durable replacement and retries preserve the critique hash', async t => {
  const f = await fixture(t);
  assert.equal(await enqueueVisualRebuilds(f.options), 1);
  assert.equal(await enqueueVisualRebuilds(f.options), 0);
  const job = await f.queue.claimNext();
  assert.equal(job.visualRebuild.manifestSha256, f.entry.qaManifestSha256);
  assert.equal(job.visualRebuild.depth, 1);
  assert.deepEqual(validateAttempt(job, f.root), job);
  assert.deepEqual(await f.store.read(), job);
  await finishVisualRebuild({ ledgerPath: f.ledgerPath, jobId: job.jobId, status: 'completed' });
  await f.store.clear();
  assert.equal(await enqueueVisualRebuilds(f.options), 0);
  assert.equal(await f.queue.claimNext(), null);
});

test('reservation survives a crash before queue enqueue and terminal failure stops repetition', async t => {
  const f = await fixture(t);
  await assert.rejects(enqueueVisualRebuilds({ ...f.options, queue: { enqueue: async () => { throw new Error('crash'); } } }), /crash/);
  assert.equal(await enqueueVisualRebuilds(f.options), 0);
  const job = await f.queue.claimNext();
  assert(job);
  await finishVisualRebuild({ ledgerPath: f.ledgerPath, jobId: job.jobId, status: 'failed' });
  await f.store.clear();
  assert.equal(await enqueueVisualRebuilds(f.options), 0);
  assert.equal(await f.queue.claimNext(), null);
});

test('uncertain submissions, exhausted repair depth, non-narrative and unverified critiques are held', async t => {
  const f = await fixture(t);
  f.entry.results = { long: { youtube: { status: 'unknown' } } };
  await f.save(); assert.equal(await enqueueVisualRebuilds(f.options), 0);
  delete f.entry.results; f.entry.visualRecoveryDepth = 2;
  await f.save(); assert.equal(await enqueueVisualRebuilds(f.options), 0);
  delete f.entry.visualRecoveryDepth; f.manifest.editorial.visualMode = 'legacy';
  await f.save(); assert.equal(await enqueueVisualRebuilds(f.options), 0);
  f.manifest.editorial.visualMode = 'narrative-episode-v2'; await f.save();
  let errors = 0;
  assert.equal(await enqueueVisualRebuilds({ ...f.options, loadCritique: async () => { throw new Error('changed hash'); },
    onError: () => errors++ }), 0);
  assert.equal(errors, 1);
  assert.equal(await f.queue.claimNext(), null);
});

test('recovery checkpoint refuses escaped paths and unbounded generations', async t => {
  const f = await fixture(t);
  await enqueueVisualRebuilds(f.options); const job = await f.queue.claimNext();
  assert.throws(() => validateAttempt({ ...job, visualRebuild: { ...job.visualRebuild, manifestPath: '../../secret.json' } }, f.root));
  assert.throws(() => validateAttempt({ ...job, visualRebuild: { ...job.visualRebuild, depth: 3 } }, f.root));
});

test('a replacement resumes after its first master, but never overwrites the source or follows a symlink', async t => {
  const f = await fixture(t);
  await enqueueVisualRebuilds(f.options); const job = await f.queue.claimNext();
  await fs.mkdir(path.join(f.root, 'data/videos'), { recursive: true });
  const sourceMasterPath = path.join(f.root, 'data/videos/original.mp4');
  await fs.writeFile(sourceMasterPath, 'original');
  const args = { root: f.root, stateDir: path.join(f.root, 'data/state'), outPath: job.outPath,
    sourceMasterPath, jobId: job.jobId, manifestPath: job.visualRebuild.manifestPath,
    manifestSha256: job.visualRebuild.manifestSha256, resume: true };
  assert.equal((await prepareVisualRebuildOutput(args)).jobId, job.jobId);
  await fs.writeFile(path.join(f.root, job.outPath), 'partial replacement');
  assert.equal((await prepareVisualRebuildOutput(args)).jobId, job.jobId);
  await assert.rejects(prepareVisualRebuildOutput({ ...args, manifestSha256: 'b'.repeat(64) }), /checkpoint/);
  await assert.rejects(prepareVisualRebuildOutput({ ...args, resume: false }), /nonexistent/);
  await assert.rejects(prepareVisualRebuildOutput({ ...args, sourceMasterPath: path.join(f.root, job.outPath) }), /distinct/);
  await fs.unlink(path.join(f.root, job.outPath));
  await fs.symlink(sourceMasterPath, path.join(f.root, job.outPath));
  await assert.rejects(prepareVisualRebuildOutput(args), /distinct/);
  assert.equal(await fs.readFile(sourceMasterPath, 'utf8'), 'original');
});
