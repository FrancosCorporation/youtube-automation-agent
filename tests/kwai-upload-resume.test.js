'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  advanceKwaiUploadResume,
  archiveUnrelatedKwaiResume,
  clearKwaiUploadResume,
  createKwaiUploadResume,
  matchesKwaiUploadResume,
  readKwaiUploadResume,
  RESUME_FILENAME,
  resolveKwaiUploadResume,
  saveKwaiUploadResume
} = require('../utils/kwai-upload-resume');

test('Kwai fails closed on a stale resume marker before replacing staged media', () => {
  const marker = { stage: 'transcoding', albumName: 'Pulso_0123456789ab' };
  assert.equal(resolveKwaiUploadResume(null, false), null);
  assert.equal(resolveKwaiUploadResume(marker, true), marker);
  assert.throws(() => resolveKwaiUploadResume(marker, false), /marcador persistido não corresponde/);
});

test('a distinct new video can proceed from a confirmed profile while the old uncertain marker remains archived byte for byte', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kwai-resume-archive-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const previous = path.join(root, 'old.mp4');
  const next = path.join(root, 'new.mp4');
  await fs.writeFile(previous, 'old uncertain video');
  await fs.writeFile(next, 'distinct new video');
  const marker = await createKwaiUploadResume({ videoPath: previous, caption: 'old caption', albumName: 'Pulso_0123456789ab', durationSeconds: 95, stage: 'composer' });
  await saveKwaiUploadResume(marker, { stateDir: root });
  const original = await fs.readFile(path.join(root, RESUME_FILENAME));
  const options = { stateDir: root, videoPath: next, activity: 'kwai.lite.video/com.yxcorp.gifshow.tiny.TinyLaunchActivity', nodes: [
    { rid: 'kwai.lite.video.basis:id/tv_user_id' }, { rid: 'kwai.lite.video.basis:id/tabs' },
    { rid: 'kwai.lite.video.basis:id/profile_settings_button' }
  ] };
  await assert.rejects(archiveUnrelatedKwaiResume(marker, { ...options, nodes: [] }), /feed\/perfil/);
  await assert.rejects(archiveUnrelatedKwaiResume(marker, { ...options, videoPath: previous }), /feed\/perfil/);
  await fs.writeFile(next, 'old uncertain video');
  await assert.rejects(archiveUnrelatedKwaiResume(marker, options), /conteúdo idêntico/);
  assert.deepEqual(await fs.readFile(path.join(root, RESUME_FILENAME)), original);
  await fs.writeFile(next, 'distinct new video');
  const archived = await archiveUnrelatedKwaiResume(marker, options);
  assert.deepEqual(await fs.readFile(archived), original);
  assert.equal((await fs.stat(archived)).mode & 0o777, 0o600);
  assert.equal(await readKwaiUploadResume({ stateDir: root }), null);
  assert.equal(await fs.readFile(previous, 'utf8'), 'old uncertain video');
});

test('Kwai resume marker binds the source, caption, duration and isolated album with private atomic state', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kwai-resume-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDir = path.join(root, 'state');
  const videoPath = path.join(root, 'approved.mp4');
  await fs.writeFile(videoPath, 'approved source bytes');
  const caption = 'Treino e resistência à insulina #fitness';
  const albumName = `Pulso_${crypto.createHash('sha256').update(path.resolve(videoPath)).digest('hex').slice(0, 12)}`;
  const marker = await createKwaiUploadResume({ videoPath, caption, albumName, durationSeconds: 293.9 });

  assert.equal(await matchesKwaiUploadResume(marker, { videoPath, caption, albumName, durationSeconds: 293.9 }), true);
  assert.equal(await matchesKwaiUploadResume(marker, { videoPath, caption: `${caption} outra`, albumName, durationSeconds: 293.9 }), false);
  assert.equal(await matchesKwaiUploadResume(marker, { videoPath, caption, albumName: 'Pulso_000000000000', durationSeconds: 293.9 }), false);
  assert.equal(await matchesKwaiUploadResume(marker, { videoPath, caption, albumName, durationSeconds: 299 }), false);

  await saveKwaiUploadResume(marker, { stateDir });
  const resumePath = path.join(stateDir, RESUME_FILENAME);
  assert.equal((await fs.stat(stateDir)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(resumePath)).mode & 0o777, 0o600);
  assert.deepEqual(await readKwaiUploadResume({ stateDir }), marker);

  const transcoding = await advanceKwaiUploadResume(marker, 'transcoding', { stateDir });
  assert.equal(transcoding.stage, 'transcoding');
  const composer = await advanceKwaiUploadResume(transcoding, 'composer', { stateDir });
  assert.equal(composer.stage, 'composer');
  await assert.rejects(advanceKwaiUploadResume(composer, 'selected', { stateDir }), /transição de retomada inválida/);
  assert.equal(await clearKwaiUploadResume({ stateDir }), true);
  assert.equal(await readKwaiUploadResume({ stateDir }), null);
});

test('Kwai resume marker refuses a source file whose bytes changed after selection', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kwai-resume-hash-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const videoPath = path.join(root, 'approved.mp4');
  await fs.writeFile(videoPath, 'before');
  const albumName = `Pulso_${crypto.createHash('sha256').update(path.resolve(videoPath)).digest('hex').slice(0, 12)}`;
  const marker = await createKwaiUploadResume({ videoPath, caption: 'expected caption', albumName, durationSeconds: 5 });
  await fs.writeFile(videoPath, 'after');
  assert.equal(await matchesKwaiUploadResume(marker, {
    videoPath, caption: 'expected caption', albumName, durationSeconds: 5
  }), false);
});
