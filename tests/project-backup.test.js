'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const sqlite3 = require('sqlite3').verbose();
const { copyAndVerifySnapshotFile, createProjectBackup, listExpiredProjectBackups, pruneProjectBackups, restoreProjectBackup, validateSnapshot } = require('../utils/project-backup');

function run(database, sql, params = []) {
  return new Promise((resolve, reject) => database.run(sql, params, error => error ? reject(error) : resolve()));
}

function open(databasePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, error => error ? reject(error) : resolve(database));
  });
}

test('restore copy rejects payload changes made after snapshot validation', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-ai-restore-copy-'));
  const source = path.join(temp, 'snapshot.json');
  const target = path.join(temp, 'restore', 'snapshot.json');
  const approvedContent = '{"version":1}\n';
  const changedContent = '{"version":2}\n';
  const manifestFile = {
    path: 'snapshot.json',
    bytes: Buffer.byteLength(approvedContent),
    sha256: crypto.createHash('sha256').update(approvedContent).digest('hex')
  };

  try {
    await fs.writeFile(source, approvedContent);
    // Simulates a payload replaced after validateSnapshot returned its manifest.
    await fs.writeFile(source, changedContent);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await assert.rejects(
      copyAndVerifySnapshotFile(source, target, manifestFile),
      /conteúdo mudou após validar o snapshot/
    );
    await assert.rejects(fs.access(target), { code: 'ENOENT' });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('project backup protects private files and restores JSON and SQLite to a new isolated directory', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-ai-project-backup-'));
  const workspaceRoot = path.join(temp, 'workspace');
  const appRoot = path.join(workspaceRoot, 'youtube-automation-agent');
  const stateDirectory = path.join(appRoot, 'data', 'state');
  const databasePath = path.join(appRoot, 'data', 'youtube_automation.db');
  const backupRoot = path.join(temp, 'snapshots');
  const restoreRoot = path.join(temp, 'restored');
  const sourcePaths = [
    'plan.md', 'resumo.md', 'youtube-automation-agent/.env',
    'youtube-automation-agent/config', 'youtube-automation-agent/scripts',
    'youtube-automation-agent/data/scripts'
  ];

  try {
    await fs.mkdir(path.join(appRoot, 'config'), { recursive: true });
    await fs.mkdir(path.join(appRoot, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(appRoot, 'data', 'scripts'), { recursive: true });
    await fs.mkdir(stateDirectory, { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'plan.md'), '# Plan\n');
    await fs.writeFile(path.join(workspaceRoot, 'resumo.md'), '# Session\n');
    await fs.writeFile(path.join(appRoot, '.env'), 'API_TOKEN=private-test-value\n', { mode: 0o600 });
    await fs.writeFile(path.join(appRoot, 'config', 'credentials.json'), '{"key":"private-test-value"}\n');
    await fs.writeFile(path.join(appRoot, 'scripts', 'worker.js'), 'module.exports = true;\n');
    await fs.writeFile(path.join(appRoot, 'data', 'scripts', 'topic.json'), '{"title":"fixture"}\n');
    await fs.writeFile(path.join(stateDirectory, 'topics.json'), '{"entries":[{"id":"fixture"}]}\n');
    await fs.writeFile(path.join(stateDirectory, 'publish-queue.json'), '{"queue":[]}\n');

    const database = await open(databasePath);
    try {
      await run(database, 'PRAGMA journal_mode=WAL');
      await run(database, 'CREATE TABLE sample (value TEXT NOT NULL)');
      await run(database, 'INSERT INTO sample VALUES (?)', ['included in backup']);
    } finally {
      await new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve()));
    }

    const backup = await createProjectBackup({ workspaceRoot, destinationRoot: backupRoot, databasePath, stateDirectory, sourcePaths });
    const validManifestText = await fs.readFile(path.join(backup.path, 'manifest.json'), 'utf8');
    assert.equal(backup.manifest.database.integrity, 'quick_check: ok');
    assert(backup.manifest.files.some(file => file.path === 'youtube-automation-agent/data/state/topics.json' && file.private));
    assert(backup.manifest.files.some(file => file.path === 'youtube-automation-agent/config/credentials.json' && file.private));
    assert(backup.manifest.files.some(file => file.path === 'youtube-automation-agent/.env' && file.private));
    assert.equal((await fs.stat(path.join(backup.path, 'youtube-automation-agent/.env'))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(backup.path)).mode & 0o777, 0o700);
    await validateSnapshot(backup.path);

    const restored = await restoreProjectBackup({ backupPath: backup.path, restoreRoot });
    assert.equal(restored.path, restoreRoot);
    assert.equal(await fs.readFile(path.join(restoreRoot, 'youtube-automation-agent/data/state/topics.json'), 'utf8'), '{"entries":[{"id":"fixture"}]}\n');
    assert.equal((await fs.stat(path.join(restoreRoot, 'youtube-automation-agent/config/credentials.json'))).mode & 0o777, 0o600);

    const restoredDb = await open(path.join(restoreRoot, restored.manifest.database.path));
    try {
      const row = await new Promise((resolve, reject) => restoredDb.get('SELECT value FROM sample', (error, result) => error ? reject(error) : resolve(result)));
      assert.deepEqual(row, { value: 'included in backup' });
    } finally {
      await new Promise((resolve, reject) => restoredDb.close(error => error ? reject(error) : resolve()));
    }

    await assert.rejects(restoreProjectBackup({ backupPath: backup.path, restoreRoot }), /já existe/);
    const manifestPath = path.join(backup.path, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.files[0].path = '../outside.txt';
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(validateSnapshot(backup.path), /fora do snapshot/);
    await assert.rejects(restoreProjectBackup({ backupPath: backup.path, restoreRoot: path.join(temp, 'tampered-restore') }), /fora do snapshot/);

    const expiredManifest = JSON.parse(validManifestText);
    expiredManifest.createdAt = '2020-01-01T00:00:00.000Z';
    await fs.writeFile(manifestPath, JSON.stringify(expiredManifest));
    const eligible = await listExpiredProjectBackups({
      destinationRoot: backupRoot,
      retentionDays: 30,
      now: new Date('2026-10-13T00:00:00.000Z')
    });
    assert.deepEqual(eligible, [path.basename(backup.path)]);
    await fs.access(backup.path);
    const removed = await pruneProjectBackups({
      destinationRoot: backupRoot,
      retentionDays: 30,
      now: new Date('2026-10-13T00:00:00.000Z')
    });
    assert.deepEqual(removed, [path.basename(backup.path)]);
    await assert.rejects(fs.stat(backup.path), { code: 'ENOENT' });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('backup CLI previews expired snapshots and deletes only after explicit --apply', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-ai-backup-prune-cli-'));
  const workspaceRoot = path.join(temp, 'workspace');
  const backupRoot = path.join(temp, 'snapshots');
  const snapshotName = `pulso-backup-20200101T000000Z-${'12345678-1234-4234-9234-123456789abc'}`;
  const snapshotPath = path.join(backupRoot, snapshotName);
  const scriptPath = path.resolve(__dirname, '../scripts/project-backup.js');
  try {
    await fs.mkdir(snapshotPath, { recursive: true });
    await fs.writeFile(path.join(snapshotPath, 'manifest.json'), JSON.stringify({
      formatVersion: 1,
      createdAt: '2020-01-01T00:00:00.000Z',
      files: []
    }));

    const args = [scriptPath, 'prune', '--workspace', workspaceRoot, '--destination', backupRoot, '--days', '30'];
    const preview = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /Prévia de retenção: 1 snapshot\(s\) elegível\(is\); nenhum arquivo foi removido/);
    assert.match(preview.stdout, new RegExp(snapshotName));
    await fs.access(snapshotPath);

    const applied = spawnSync(process.execPath, [...args, '--apply'], { encoding: 'utf8' });
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /Backups antigos removidos: 1/);
    await assert.rejects(fs.access(snapshotPath), { code: 'ENOENT' });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('project backup rejects a destination inside the source workspace', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-ai-backup-boundary-'));
  const workspaceRoot = path.join(temp, 'workspace');
  try {
    await fs.mkdir(workspaceRoot, { recursive: true });
    await assert.rejects(createProjectBackup({
      workspaceRoot,
      destinationRoot: path.join(workspaceRoot, 'backups'),
      databasePath: path.join(workspaceRoot, 'missing.db'),
      stateDirectory: path.join(workspaceRoot, 'state'),
      sourcePaths: []
    }), /fora do workspace/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('project backup stops when the operational ledger lock is active', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-ai-backup-lock-'));
  const workspaceRoot = path.join(temp, 'workspace');
  const stateDirectory = path.join(workspaceRoot, 'state');
  try {
    await fs.mkdir(stateDirectory, { recursive: true });
    await fs.writeFile(path.join(stateDirectory, 'topics.json'), '{"entries":[]}');
    await fs.writeFile(path.join(stateDirectory, 'topics.json.lock'), '{"pid":123}');
    await assert.rejects(createProjectBackup({
      workspaceRoot,
      destinationRoot: path.join(temp, 'backups'),
      databasePath: path.join(workspaceRoot, 'missing.db'),
      stateDirectory,
      sourcePaths: []
    }), /lock ativo/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('snapshot validation rejects symlinked parent directories', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-ai-backup-symlink-'));
  const workspaceRoot = path.join(temp, 'workspace');
  const appRoot = path.join(workspaceRoot, 'youtube-automation-agent');
  const configDirectory = path.join(appRoot, 'config');
  const stateDirectory = path.join(appRoot, 'data', 'state');
  const databasePath = path.join(appRoot, 'data', 'youtube_automation.db');
  const backupRoot = path.join(temp, 'snapshots');
  const outsideConfig = path.join(temp, 'outside-config');

  try {
    await fs.mkdir(configDirectory, { recursive: true });
    await fs.mkdir(stateDirectory, { recursive: true });
    await fs.mkdir(outsideConfig, { recursive: true });
    await fs.writeFile(path.join(configDirectory, 'settings.json'), '{"setting":true}\n');
    await fs.writeFile(path.join(outsideConfig, 'settings.json'), '{"setting":true}\n');
    const database = await open(databasePath);
    await run(database, 'CREATE TABLE sample (value TEXT)');
    await new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve()));

    const backup = await createProjectBackup({
      workspaceRoot,
      destinationRoot: backupRoot,
      databasePath,
      stateDirectory,
      sourcePaths: ['youtube-automation-agent/config']
    });
    const snapshotConfig = path.join(backup.path, 'youtube-automation-agent/config');
    await fs.rm(snapshotConfig, { recursive: true });
    await fs.symlink(outsideConfig, snapshotConfig);
    await assert.rejects(validateSnapshot(backup.path), /symlink não permitido/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
