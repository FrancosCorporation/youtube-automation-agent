'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sqlite3 = require('sqlite3').verbose();
const { Database } = require('../database/db');

function run(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, error => error ? reject(error) : resolve());
  });
}

function get(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

function open(databasePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, error => error ? reject(error) : resolve(database));
  });
}

function close(database) {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

test('SQLite backup captures WAL data, validates the snapshot and restricts file permissions', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-ai-db-backup-'));
  const sourcePath = path.join(directory, 'source.db');
  const service = new Database();
  service.dbPath = sourcePath;
  service.db = await open(sourcePath);

  try {
    await run(service.db, 'PRAGMA journal_mode=WAL');
    await run(service.db, 'CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    await run(service.db, 'INSERT INTO sample (value) VALUES (?)', ['written to WAL']);

    const backupPath = await service.backup();
    const backupStat = await fs.stat(backupPath);
    assert.equal(path.dirname(backupPath), directory);
    assert.equal(backupStat.mode & 0o777, 0o600);

    const snapshot = await open(backupPath);
    try {
      assert.deepEqual(await get(snapshot, 'SELECT id, value FROM sample'), { id: 1, value: 'written to WAL' });
    } finally {
      await close(snapshot);
    }

    await run(service.db, 'INSERT INTO sample (value) VALUES (?)', ['written after snapshot']);
    const unchangedSnapshot = await open(backupPath);
    try {
      assert.equal((await get(unchangedSnapshot, 'SELECT COUNT(*) AS count FROM sample')).count, 1);
    } finally {
      await close(unchangedSnapshot);
    }
  } finally {
    await service.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('SQLite backup refuses to run before the database is initialized', async () => {
  const service = new Database();
  await assert.rejects(service.backup(), /precisa estar inicializado/);
});
