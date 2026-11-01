const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPublicationResult } = require('../utils/publication-status');
const { recoverPersistedQueue } = require('../utils/publish-queue-recovery');
const { checkpointedPublication } = require('../utils/social-publication-state');

async function isFixtureVideo(root, candidate) {
  const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
  const mediaRoot = path.resolve(root, 'data', 'videos');
  if (!absolute.startsWith(`${mediaRoot}${path.sep}`) || path.extname(absolute).toLowerCase() !== '.mp4') return false;
  try {
    const [realRoot, realTarget, stats] = await Promise.all([
      fs.realpath(mediaRoot), fs.realpath(absolute), fs.lstat(absolute)
    ]);
    return realRoot === mediaRoot && realTarget === absolute && stats.isFile() && !stats.isSymbolicLink();
  } catch (_error) {
    return false;
  }
}

test('persisted in-flight video is restored first and ambiguous destinations cannot resend', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-queue-recovery-'));
  try {
    const mediaRoot = path.join(root, 'data', 'videos');
    await fs.mkdir(mediaRoot, { recursive: true });
    const master = path.join(mediaRoot, 'interrupted-master.mp4');
    const clip = path.join(mediaRoot, 'interrupted-clip.mp4');
    const queued = path.join(mediaRoot, 'queued-master.mp4');
    const missing = path.join(mediaRoot, 'missing-master.mp4');
    for (const file of [master, clip, queued]) await fs.writeFile(file, 'fixture');

    const ledgerPath = path.join(root, 'topics.json');
    const queuePath = path.join(root, 'publish-queue.json');
    const attempting = (platform, videoPath) => createPublicationResult({
      platform,
      videoPath,
      status: 'attempting',
      attemptCount: 1,
      evidence: { kind: 'durable_intent', observed: 'fixture: intenção persistida' }
    });
    const confirmed = createPublicationResult({
      platform: 'kwai',
      videoPath: clip,
      status: 'confirmed',
      evidence: { kind: 'fixture_confirmation', observed: 'fixture: confirmação preservada' }
    });
    await fs.writeFile(ledgerPath, JSON.stringify({ entries: [{
      videoPath: master,
      clips: [{ path: clip }],
      results: {
        long: { youtube: attempting('youtube', master) },
        clips: { [clip]: { instagram: attempting('instagram', clip), kwai: confirmed } }
      }
    }] }));
    await fs.writeFile(queuePath, JSON.stringify({
      version: 1,
      pending: [{ outPath: queued }, { outPath: missing }],
      inFlight: { outPath: master, jobId: 'fixture-job' }
    }));

    const warnings = [];
    const recovered = await recoverPersistedQueue({
      queuePath,
      ledgerPath,
      root,
      isManagedVideo: candidate => isFixtureVideo(root, candidate),
      log: message => warnings.push(message),
      now: Date.parse('2026-10-14T12:00:00.000Z')
    });

    assert.equal(recovered.ok, true);
    assert.equal(recovered.found, true);
    assert.deepEqual(recovered.pending, [
      { outPath: master, jobId: 'fixture-job', recoveredAfterInterruptedPublish: true },
      { outPath: queued }
    ]);
    assert.ok(warnings.some(message => message.includes(missing)));
    assert.ok(warnings.some(message => message.includes('tentativa(s) sem resultado')));

    const ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
    const results = ledger.entries[0].results;
    assert.equal(results.long.youtube.status, 'unknown');
    assert.equal(results.clips[clip].instagram.status, 'unknown');
    assert.equal(results.clips[clip].kwai.status, 'confirmed');

    let sends = 0;
    const result = await checkpointedPublication({
      scope: 'long',
      platform: 'youtube',
      videoPath: master,
      previous: results.long.youtube,
      onPublicationState: async () => assert.fail('destino ambíguo não deve gravar nova tentativa'),
      upload: async () => { sends++; return 'https://youtube.test/duplicate'; }
    });
    assert.equal(result.status, 'unknown');
    assert.equal(sends, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('malformed persisted queue is rejected without changing its bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-queue-invalid-'));
  try {
    const queuePath = path.join(root, 'publish-queue.json');
    const ledgerPath = path.join(root, 'topics.json');
    const original = Buffer.from('{"pending": [\n');
    await fs.writeFile(queuePath, original);

    const recovered = await recoverPersistedQueue({
      queuePath,
      ledgerPath,
      root,
      isManagedVideo: async () => false
    });

    assert.equal(recovered.ok, false);
    assert.match(recovered.message, /fila persistida ilegível/);
    assert.deepEqual(await fs.readFile(queuePath), original);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('missing persisted queue is treated as a clean first start', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-queue-empty-'));
  try {
    const recovered = await recoverPersistedQueue({
      queuePath: path.join(root, 'missing-queue.json'),
      ledgerPath: path.join(root, 'topics.json'),
      root,
      isManagedVideo: async () => false
    });
    assert.deepEqual(recovered, { found: false, ok: true, pending: [] });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
