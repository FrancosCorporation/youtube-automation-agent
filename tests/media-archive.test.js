'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { archiveMediaFile, restoreArchivedMedia, verifyArchivedMedia } = require('../utils/media-archive');

async function fixture() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-media-archive-'));
  const root = path.join(temporaryRoot, 'workspace');
  const archiveRoot = path.join(temporaryRoot, 'encrypted-volume', 'pulso-media');
  const mediaRoot = path.join(root, 'data', 'videos');
  await fs.mkdir(mediaRoot, { recursive: true });
  return { temporaryRoot, root, archiveRoot, mediaRoot };
}

test('archive verifies and restores a master without deleting or overwriting source files', async () => {
  const f = await fixture();
  try {
    const sourcePath = path.join(f.mediaRoot, 'master.mp4');
    const payload = Buffer.from('synthetic master media fixture\n');
    await fs.writeFile(sourcePath, payload);
    const objectsRoot = path.join(f.archiveRoot, 'objects');
    if (process.platform !== 'win32') {
      await fs.mkdir(objectsRoot, { recursive: true, mode: 0o755 });
      await fs.chmod(objectsRoot, 0o755);
    }
    const archived = await archiveMediaFile({
      root: f.root,
      archiveRoot: f.archiveRoot,
      sourcePath,
      now: '2026-10-13T19:00:00.000Z'
    });
    assert.equal(archived.bytes, payload.length);
    assert.equal(archived.sha256.length, 64);
    assert.equal(archived.alreadyArchived, false);
    assert.deepEqual(await fs.readFile(sourcePath), payload, 'archiving preserves the operational source');
    const duplicateArchive = await archiveMediaFile({ root: f.root, archiveRoot: f.archiveRoot, sourcePath });
    assert.equal(duplicateArchive.archiveDirectory, archived.archiveDirectory);
    assert.equal(duplicateArchive.alreadyArchived, true);

    const verified = await verifyArchivedMedia({ root: f.root, archiveDirectory: archived.archiveDirectory });
    assert.equal(verified.sha256, archived.sha256);
    assert.equal(verified.extension, '.mp4');
    assert.equal(verified.bytes, payload.length);

    const restoredPath = path.join(f.mediaRoot, 'restored', 'master-copy.mp4');
    const restored = await restoreArchivedMedia({
      root: f.root,
      archiveDirectory: archived.archiveDirectory,
      targetPath: restoredPath
    });
    assert.equal(restored.sha256, archived.sha256);
    assert.deepEqual(await fs.readFile(restoredPath), payload);
    assert.deepEqual(await fs.readFile(sourcePath), payload);
    await assert.rejects(
      restoreArchivedMedia({ root: f.root, archiveDirectory: archived.archiveDirectory, targetPath: restoredPath }),
      /já existe/
    );

    if (process.platform !== 'win32') {
      const objectsStat = await fs.stat(objectsRoot);
      assert.equal(objectsStat.mode & 0o777, 0o700);
      const objectStat = await fs.stat(archived.archiveDirectory);
      assert.equal(objectStat.mode & 0o777, 0o700);
      const manifestStat = await fs.stat(path.join(archived.archiveDirectory, 'manifest.json'));
      const payloadStat = await fs.stat(path.join(archived.archiveDirectory, 'media.mp4'));
      assert.equal(manifestStat.mode & 0o777, 0o600);
      assert.equal(payloadStat.mode & 0o777, 0o600);
    }
  } finally {
    await fs.rm(f.temporaryRoot, { recursive: true, force: true });
  }
});

test('archive refuses workspace destinations, unmanaged sources, and corrupted payloads', async () => {
  const f = await fixture();
  try {
    const sourcePath = path.join(f.mediaRoot, 'master.mp4');
    await fs.writeFile(sourcePath, 'fixture');
    await assert.rejects(
      archiveMediaFile({ root: f.root, archiveRoot: path.join(f.root, 'archive'), sourcePath }),
      /outside the workspace|fora do workspace/
    );
    await assert.rejects(
      archiveMediaFile({ root: f.root, archiveRoot: f.archiveRoot, sourcePath: path.join(f.temporaryRoot, 'outside.mp4') }),
      /inside data\/videos|dentro de data\/videos/
    );

    const archived = await archiveMediaFile({ root: f.root, archiveRoot: f.archiveRoot, sourcePath });
    await fs.writeFile(path.join(archived.archiveDirectory, 'media.mp4'), 'tampered');
    await assert.rejects(
      verifyArchivedMedia({ root: f.root, archiveDirectory: archived.archiveDirectory }),
      /hash ou tamanho/
    );
  } finally {
    await fs.rm(f.temporaryRoot, { recursive: true, force: true });
  }
});

test('restore refuses a symlinked data/videos root', async () => {
  const f = await fixture();
  try {
    const sourcePath = path.join(f.mediaRoot, 'master.mp4');
    await fs.writeFile(sourcePath, 'synthetic master fixture');
    const archived = await archiveMediaFile({ root: f.root, archiveRoot: f.archiveRoot, sourcePath });
    const movedMediaRoot = path.join(f.root, 'data', 'videos-original');
    const externalMediaRoot = path.join(f.temporaryRoot, 'external-media');
    await fs.mkdir(externalMediaRoot);
    await fs.rename(f.mediaRoot, movedMediaRoot);
    await fs.symlink(externalMediaRoot, f.mediaRoot, 'dir');
    await assert.rejects(
      restoreArchivedMedia({
        root: f.root,
        archiveDirectory: archived.archiveDirectory,
        targetPath: path.join(f.mediaRoot, 'restored.mp4')
      }),
      /raiz data\/videos inválida/
    );
    assert.deepEqual(await fs.readdir(externalMediaRoot), []);
  } finally {
    await fs.rm(f.temporaryRoot, { recursive: true, force: true });
  }
});
