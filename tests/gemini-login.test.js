'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { cloneSession, setupGeminiLogin } = require('../scripts/gemini-login');

function quietOutput() {
  return { log() {}, warn() {} };
}

function openDatabase(filePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filePath, error => error ? reject(error) : resolve(database));
  });
}

function runDatabase(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, error => error ? reject(error) : resolve());
  });
}

function allDatabase(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function closeDatabase(database) {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

test('headless-only Gemini setup reuses an authenticated profile without opening a window', async () => {
  let opened = false;
  const result = await setupGeminiLogin({
    headlessOnly: true,
    verify: async () => true,
    openLoginWindow: async () => { opened = true; },
    output: quietOutput()
  });
  assert.equal(result, true);
  assert.equal(opened, false);
});

test('headless-only Gemini setup never opens a window when no existing session works', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-login-headless-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  await fs.mkdir(path.join(source, 'Default'), { recursive: true });
  let verifyCount = 0;
  let opened = false;
  const result = await setupGeminiLogin({
    headlessOnly: true,
    forceWindow: true,
    forceImport: true,
    getSources: async () => [source],
    importSession: async () => {},
    verify: async () => { verifyCount++; return false; },
    openLoginWindow: async () => { opened = true; },
    output: quietOutput()
  });
  assert.equal(result, false);
  assert.equal(verifyCount, 1);
  assert.equal(opened, false);
});

test('Gemini session import stops at the first profile that passes headless verification', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-login-import-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sources = ['first', 'second'].map(name => path.join(root, name));
  for (const source of sources) await fs.mkdir(path.join(source, 'Default'), { recursive: true });
  const imported = [];
  let verifyCount = 0;
  let opened = false;
  const result = await setupGeminiLogin({
    headlessOnly: true,
    forceImport: true,
    getSources: async () => sources,
    importSession: async source => { imported.push(source); },
    verify: async () => { verifyCount++; return verifyCount === 1; },
    openLoginWindow: async () => { opened = true; },
    output: quietOutput()
  });
  assert.equal(result, true);
  assert.deepEqual(imported, [sources[0]]);
  assert.equal(opened, false);
});

test('a rejected Gemini session candidate leaves the active profile untouched', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-login-candidate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const profileDir = path.join(root, 'active-profile');
  await fs.mkdir(path.join(source, 'Default'), { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(path.join(profileDir, 'existing.txt'), 'keep');

  const result = await setupGeminiLogin({
    headlessOnly: true,
    forceImport: true,
    getSources: async () => [source],
    importSession: async (_source, candidateDir) => {
      await fs.mkdir(candidateDir, { recursive: true });
      await fs.writeFile(path.join(candidateDir, 'candidate.txt'), 'temporary');
    },
    verify: async () => false,
    profileDir,
    openLoginWindow: async () => assert.fail('headless-only setup opened a login window'),
    output: quietOutput()
  });

  assert.equal(result, false);
  assert.equal(await fs.readFile(path.join(profileDir, 'existing.txt'), 'utf8'), 'keep');
  assert.equal((await fs.readdir(root)).filter(name => name.includes('.candidate-')).length, 0);
});

test('Gemini session import copies only live Google cookies and preserves the previous profile', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-login-cookie-import-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const sourceDefault = path.join(source, 'Default');
  const target = path.join(root, 'target');
  await fs.mkdir(sourceDefault, { recursive: true });
  await fs.mkdir(path.join(target, 'Default'), { recursive: true });
  await fs.writeFile(path.join(source, 'Local State'), '{"os_crypt":{}}');
  await fs.writeFile(path.join(target, 'old-profile.txt'), 'preserve me');

  const sourceCookies = path.join(sourceDefault, 'Cookies');
  const sourceDb = await openDatabase(sourceCookies);
  const chromeEpochOffset = 11644473600000000;
  const future = Date.now() * 1000 + chromeEpochOffset + 24 * 60 * 60 * 1000000;
  const past = Date.now() * 1000 + chromeEpochOffset - 24 * 60 * 60 * 1000000;
  await runDatabase(sourceDb, 'CREATE TABLE cookies (host_key TEXT, has_expires INTEGER, expires_utc INTEGER)');
  for (const row of [
    ['.google.com', 0, 0],
    ['.gemini.google.com', 1, future],
    ['accounts.google.com', 1, past],
    ['.youtube.com', 1, future]
  ]) {
    await runDatabase(sourceDb, 'INSERT INTO cookies (host_key, has_expires, expires_utc) VALUES (?, ?, ?)', row);
  }
  await closeDatabase(sourceDb);

  const result = await cloneSession(source, target, 'Default');
  const targetDb = await openDatabase(path.join(target, 'Default', 'Cookies'));
  const hosts = (await allDatabase(targetDb, 'SELECT host_key FROM cookies ORDER BY host_key')).map(row => row.host_key);
  await closeDatabase(targetDb);

  assert.deepEqual(hosts, ['.gemini.google.com', '.google.com']);
  assert.equal(await fs.readFile(path.join(target, 'Local State'), 'utf8'), '{"os_crypt":{}}');
  assert.equal(await fs.readFile(path.join(result.previousProfilePath, 'old-profile.txt'), 'utf8'), 'preserve me');
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(target)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(target, 'Default', 'Cookies'))).mode & 0o777, 0o600);
  }
});
