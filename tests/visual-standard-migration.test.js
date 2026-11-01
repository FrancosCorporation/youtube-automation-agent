'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const test = require('node:test');
const { applyVisualStandardMigration, MIGRATION_ID } = require('../utils/visual-standard-migration');

function openDatabase(databasePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, error => error ? reject(error) : resolve(database));
  });
}

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

function close(database) {
  return new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve()));
}

async function seedSettings(databasePath, style) {
  const database = await openDatabase(databasePath);
  try {
    await run(database, 'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, description TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    await run(database, 'INSERT INTO settings (key, value, description) VALUES (?, ?, ?)', ['slideshow_style', style, 'legacy description']);
    await run(database, 'INSERT INTO settings (key, value, description) VALUES (?, ?, ?)', ['unrelated_setting', 'preserve-me', 'leave untouched']);
  } finally {
    await close(database);
  }
}

test('visual standard migration backs up and changes only legacy dynamic setting', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-visual-migration-'));
  const databasePath = path.join(directory, 'settings.sqlite');
  await seedSettings(databasePath, 'dynamic');

  try {
    const result = await applyVisualStandardMigration(databasePath, { backupDirectory: path.join(directory, 'backups') });
    assert.equal(result.changed, true);
    assert.equal(result.styleBefore, 'dynamic');
    assert.equal(result.styleAfter, 'animated');
    assert.match(result.backupSha256, /^[a-f0-9]{64}$/);

    const database = await openDatabase(databasePath);
    try {
      assert.equal((await get(database, "SELECT value FROM settings WHERE key = 'slideshow_style'")).value, 'animated');
      assert.equal((await get(database, "SELECT value FROM settings WHERE key = 'unrelated_setting'")).value, 'preserve-me');
      assert.ok(await get(database, 'SELECT id FROM app_migrations WHERE id = ?', [MIGRATION_ID]));
    } finally {
      await close(database);
    }

    const backup = await openDatabase(result.backupPath);
    try {
      assert.equal((await get(backup, "SELECT value FROM settings WHERE key = 'slideshow_style'")).value, 'dynamic');
      assert.equal(await get(backup, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_migrations'"), undefined);
    } finally {
      await close(backup);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('visual standard migration preserves explicit style and is one-time', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-visual-migration-preserve-'));
  const databasePath = path.join(directory, 'settings.sqlite');
  await seedSettings(databasePath, 'classic');

  try {
    const first = await applyVisualStandardMigration(databasePath, { backupDirectory: path.join(directory, 'backups') });
    assert.equal(first.changed, false);
    assert.equal(first.styleAfter, 'classic');

    const database = await openDatabase(databasePath);
    try {
      await run(database, "UPDATE settings SET value = 'dynamic' WHERE key = 'slideshow_style'");
    } finally {
      await close(database);
    }

    const second = await applyVisualStandardMigration(databasePath, { backupDirectory: path.join(directory, 'backups') });
    assert.equal(second.alreadyApplied, true);
    assert.equal(second.changed, false);
    assert.equal(second.styleAfter, 'dynamic');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('visual standard migration fails immediately when a writer holds the database', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-visual-migration-lock-'));
  const databasePath = path.join(directory, 'settings.sqlite');
  await seedSettings(databasePath, 'dynamic');
  const writer = await openDatabase(databasePath);

  try {
    await run(writer, 'BEGIN IMMEDIATE');
    await assert.rejects(applyVisualStandardMigration(databasePath, { backupDirectory: path.join(directory, 'backups') }), /SQLITE_BUSY/);
  } finally {
    await run(writer, 'ROLLBACK').catch(() => {});
    await close(writer);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
