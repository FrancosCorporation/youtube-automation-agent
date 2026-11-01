'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { sha256File } = require('../utils/video-qa-manifest');
const { videoIdForPath, createJobId } = require('../utils/observability-ids');
const { discardTechnicallyRejectedGeneration } = require('../utils/rejected-generation-cleanup');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rejected-generation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const videoRoot = path.join(root, 'data', 'videos');
  const qaRoot = path.join(root, 'data', 'reports', 'qa');
  await fs.mkdir(videoRoot, { recursive: true });
  await fs.mkdir(qaRoot, { recursive: true });
  const master = path.join(videoRoot, 'auto_rejected.mp4');
  const clip = path.join(videoRoot, 'clips', 'part-1.mp4');
  const thumbnail = path.join(videoRoot, 'thumb_auto_rejected.png');
  await fs.mkdir(path.dirname(clip), { recursive: true });
  await fs.writeFile(master, 'rejected-master');
  await fs.writeFile(clip, 'rejected-clip');
  await fs.writeFile(thumbnail, 'rejected-thumbnail');
  const jobId = createJobId();
  const videoId = videoIdForPath(master);
  const manifest = {
    videoId, jobId, technicalStatus: 'failed',
    assets: [
      { role: 'master', path: path.relative(root, master), sha256: await sha256File(master) },
      { role: 'social_part', path: path.relative(root, clip), sha256: await sha256File(clip) }
    ],
    thumbnail: { path: path.relative(root, thumbnail), sha256: await sha256File(thumbnail) }
  };
  await fs.writeFile(path.join(qaRoot, `${videoId}.json`), JSON.stringify(manifest));
  return { root, master, clip, thumbnail, jobId, videoId };
}

test('remove only hash-matching assets bound to the same failed technical QA job', async t => {
  const state = await fixture(t);
  const result = await discardTechnicallyRejectedGeneration({ ...state, outPath: state.master, failureCode: 'video_technical_qa_failed' });
  assert.equal(result.discarded, true);
  assert.equal(result.removed.length, 3);
  await assert.rejects(fs.access(state.master), { code: 'ENOENT' });
  await assert.rejects(fs.access(state.clip), { code: 'ENOENT' });
  await assert.rejects(fs.access(state.thumbnail), { code: 'ENOENT' });
  await fs.access(path.join(state.root, 'data', 'reports', 'qa', `${state.videoId}.json`));
});

test('keeps media if QA does not bind it to this generation job', async t => {
  const state = await fixture(t);
  const result = await discardTechnicallyRejectedGeneration({
    ...state, outPath: state.master, jobId: createJobId(), failureCode: 'video_technical_qa_failed'
  });
  assert.equal(result.discarded, false);
  await fs.access(state.master);
});

test('does not clean up a failed generation for another failure class', async t => {
  const state = await fixture(t);
  const result = await discardTechnicallyRejectedGeneration({ ...state, outPath: state.master, failureCode: 'tts_unavailable' });
  assert.equal(result.discarded, false);
  await fs.access(state.master);
});

test('preserves any generated file whose bytes changed after the QA manifest', async t => {
  const state = await fixture(t);
  await fs.writeFile(state.master, 'changed-after-qa');
  const result = await discardTechnicallyRejectedGeneration({ ...state, outPath: state.master, failureCode: 'video_technical_qa_failed' });
  assert.equal(result.discarded, false);
  assert.deepEqual(result.retained, [{ path: 'data/videos/auto_rejected.mp4', reason: 'asset_hash_changed' }]);
  await fs.access(state.master);
});
