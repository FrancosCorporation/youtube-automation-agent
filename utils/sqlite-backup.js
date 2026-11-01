'use strict';

const crypto = require('crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

function runSqliteBackup(database, destination) {
  const backup = database.backup(destination);
  return new Promise((resolve, reject) => {
    backup.step(-1, stepError => {
      backup.finish(finishError => {
        if (stepError) return reject(stepError);
        if (finishError) return reject(finishError);
        resolve();
      });
    });
  });
}

function checkSqliteIntegrity(databasePath) {
  return new Promise((resolve, reject) => {
    const verificationDb = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, openError => {
      if (openError) return reject(openError);
      verificationDb.get('PRAGMA quick_check', (checkError, row) => {
        verificationDb.close(closeError => {
          if (checkError) return reject(checkError);
          if (closeError) return reject(closeError);
          if (row?.quick_check !== 'ok') return reject(new Error(`SQLite quick_check falhou: ${row?.quick_check || 'sem resultado'}`));
          resolve();
        });
      });
    });
  });
}

async function backupSqliteConnection(database, destinationPath) {
  if (!database) throw new Error('conexão SQLite obrigatória para backup consistente');
  const destination = path.resolve(destinationPath);
  const temporaryPath = `${destination}.${crypto.randomUUID()}.partial`;

  try {
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await runSqliteBackup(database, temporaryPath);
    await fs.chmod(temporaryPath, 0o600);
    await checkSqliteIntegrity(temporaryPath);
    await fs.rename(temporaryPath, destination);
    return destination;
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

module.exports = { backupSqliteConnection, checkSqliteIntegrity };
