'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const { backupSqliteConnection, checkSqliteIntegrity } = require('./sqlite-backup');

const MIGRATION_ID = 'visual-standard-v3-slideshow-default';
const ANIMATED_DESCRIPTION = 'Slideshow style: animated (HyperFrames visual kit) by default; dynamic and classic remain explicit legacy modes';

function run(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function get(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

function close(database) {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

function openConnection(databasePath, flags) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, flags, error => error ? reject(error) : resolve(database));
  });
}

async function sha256File(filePath) {
  const contents = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(contents).digest('hex');
}

async function applyVisualStandardMigration(databasePath, options = {}) {
  const resolvedDatabasePath = path.resolve(databasePath);
  const stat = await fs.stat(resolvedDatabasePath);
  if (!stat.isFile()) throw new Error(`SQLite não é arquivo regular: ${resolvedDatabasePath}`);

  const database = await openConnection(resolvedDatabasePath, sqlite3.OPEN_READWRITE);

  let transactionOpen = false;
  try {
    await run(database, 'PRAGMA busy_timeout = 0');
    const integrity = await get(database, 'PRAGMA quick_check');
    if (integrity?.quick_check !== 'ok') throw new Error(`SQLite quick_check falhou: ${integrity?.quick_check || 'sem resultado'}`);

    const settingsTable = await get(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'");
    if (!settingsTable) throw new Error('A tabela settings não existe; nenhuma alteração foi feita');
    const preflightSetting = await get(database, "SELECT value FROM settings WHERE key = 'slideshow_style'");
    if (!preflightSetting) throw new Error('A configuração slideshow_style não existe; nenhuma alteração foi feita');

    await run(database, 'BEGIN IMMEDIATE');
    transactionOpen = true;

    const setting = await get(database, "SELECT value FROM settings WHERE key = 'slideshow_style'");
    if (!setting) throw new Error('A configuração slideshow_style desapareceu antes da migração');

    const backupDirectory = options.backupDirectory || path.join(path.dirname(resolvedDatabasePath), 'backups');
    const backupPath = path.join(
      backupDirectory,
      `visual-standard-v3-before-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${crypto.randomUUID()}.sqlite`
    );
    const snapshot = await openConnection(resolvedDatabasePath, sqlite3.OPEN_READONLY);
    try {
      await run(snapshot, 'PRAGMA busy_timeout = 0');
      await backupSqliteConnection(snapshot, backupPath);
    } finally {
      await close(snapshot);
    }
    const backupSha256 = await sha256File(backupPath);

    await run(database, `CREATE TABLE IF NOT EXISTS app_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

    const migration = await get(database, 'SELECT id FROM app_migrations WHERE id = ?', [MIGRATION_ID]);
    let updated = false;
    if (!migration) {
      if (setting.value === 'dynamic') {
        const result = await run(database,
          `UPDATE settings SET value = 'animated', description = ?, updated_at = datetime('now')
           WHERE key = 'slideshow_style' AND value = 'dynamic'`,
          [ANIMATED_DESCRIPTION]
        );
        updated = result.changes === 1;
      }
      await run(database, 'INSERT OR IGNORE INTO app_migrations (id) VALUES (?)', [MIGRATION_ID]);
    }

    await run(database, 'COMMIT');
    transactionOpen = false;

    const finalSetting = await get(database, "SELECT value FROM settings WHERE key = 'slideshow_style'");
    const applied = await get(database, 'SELECT id FROM app_migrations WHERE id = ?', [MIGRATION_ID]);
    if (!applied) throw new Error('Marcador da migração não persistiu');
    if (setting.value === 'dynamic' && !migration && finalSetting?.value !== 'animated') {
      throw new Error(`Migração não aplicou animated; valor final: ${finalSetting?.value || 'ausente'}`);
    }

    const finalIntegrity = await get(database, 'PRAGMA quick_check');
    if (finalIntegrity?.quick_check !== 'ok') throw new Error(`SQLite quick_check pós-migração falhou: ${finalIntegrity?.quick_check || 'sem resultado'}`);
    await checkSqliteIntegrity(backupPath);

    return {
      databasePath: resolvedDatabasePath,
      migrationId: MIGRATION_ID,
      alreadyApplied: Boolean(migration),
      changed: updated,
      styleBefore: setting.value,
      styleAfter: finalSetting.value,
      backupPath,
      backupSha256,
      integrity: finalIntegrity.quick_check
    };
  } catch (error) {
    if (transactionOpen) await run(database, 'ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await close(database);
  }
}

module.exports = { applyVisualStandardMigration, MIGRATION_ID };
