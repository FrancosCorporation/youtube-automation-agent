'use strict';

const crypto = require('node:crypto');
const { constants: fsConstants } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const { backupSqliteConnection, checkSqliteIntegrity } = require('./sqlite-backup');

const BACKUP_FORMAT_VERSION = 1;
const SKIP_DIRECTORIES = new Set([
  '.git', '.planning', '.hyperframes', '.agents', 'node_modules', '__pycache__',
  'dist', 'build', 'renders', 'variants', 'logs'
]);
const DEFAULT_SOURCE_PATHS = [
  'plan.md', 'resumo.md', 'CONTAS-E-TEMAS.md',
  'youtube-automation-agent/.env',
  'youtube-automation-agent/package.json', 'youtube-automation-agent/package-lock.json',
  'youtube-automation-agent/requirements-neural.lock',
  'youtube-automation-agent/agents', 'youtube-automation-agent/config',
  'youtube-automation-agent/database', 'youtube-automation-agent/scripts',
  'youtube-automation-agent/utils', 'youtube-automation-agent/docs', 'youtube-automation-agent/data/scripts',
  'youtube-automation-agent/experiments/hyperframes-pulso-pilot',
  'remotion-pilot'
];

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || path.posix.isAbsolute(value)) throw new Error('caminho inválido no manifesto');
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (normalized !== value || normalized === '..' || normalized.startsWith('../')) throw new Error('caminho fora do snapshot');
  return normalized;
}

function backupDirectoryName(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `pulso-backup-${stamp}-${crypto.randomUUID()}`;
}

function isPrivatePath(relativePath) {
  return /(?:^|\/)(?:\.env(?:\.[^/]*)?|credentials\.json|.*(?:cookie|session|token)[^/]*\.json)$/i.test(relativePath);
}

async function collectSourceFiles(root, relativePath, { jsonOnly = false, skippedSymlinks = [] } = {}) {
  const absolutePath = path.resolve(root, relativePath);
  if (!isInside(root, absolutePath)) throw new Error(`caminho de origem fora do workspace: ${relativePath}`);

  try {
    const relativeToRoot = path.relative(root, absolutePath);
    const segments = relativeToRoot.split(path.sep).filter(Boolean);
    let current = root;
    let stat;
    for (const [index, segment] of segments.entries()) {
      current = path.join(current, segment);
      stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        skippedSymlinks.push(path.relative(root, current).split(path.sep).join('/'));
        return [];
      }
      if (index < segments.length - 1 && !stat.isDirectory()) return [];
    }

    if (stat.isFile()) {
      if (jsonOnly && !relativePath.toLowerCase().endsWith('.json')) return [];
      return [{ absolutePath, relativePath: path.relative(root, absolutePath).split(path.sep).join('/') }];
    }
    if (!stat.isDirectory()) return [];

    const files = [];
    for (const entry of await fs.readdir(absolutePath, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      const childPath = path.join(relativePath, entry.name);
      files.push(...await collectSourceFiles(root, childPath, { jsonOnly, skippedSymlinks }));
    }
    return files;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function collectStateFiles(workspaceRoot, stateDirectory, skippedSymlinks) {
  const absoluteState = path.resolve(stateDirectory);
  const stateParent = path.dirname(absoluteState);
  if (await fs.realpath(stateParent).catch(() => stateParent) !== stateParent) {
    skippedSymlinks.push(path.relative(workspaceRoot, absoluteState).split(path.sep).join('/') || 'state-directory');
    return [];
  }
  const relative = isInside(workspaceRoot, absoluteState)
    ? path.relative(workspaceRoot, absoluteState).split(path.sep).join('/')
    : 'youtube-automation-agent/data/state';
  const files = await collectSourceFiles(path.dirname(absoluteState), path.basename(absoluteState), {
    jsonOnly: true,
    skippedSymlinks
  });
  return files.map(file => ({
    ...file,
    operationalState: true,
    relativePath: path.posix.join(relative, path.posix.relative(path.basename(absoluteState), file.relativePath))
  }));
}

function writePrivateFile(destination, content) {
  return fs.writeFile(destination, content, { mode: 0o600, flag: 'wx' });
}

async function hashFile(filePath) {
  const content = await fs.readFile(filePath);
  return { sha256: crypto.createHash('sha256').update(content).digest('hex'), bytes: content.length };
}

async function openReadOnly(databasePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, error => error ? reject(error) : resolve(database));
  });
}

async function closeDatabase(database) {
  return new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve()));
}

async function copyFileEntry(file, stageRoot, manifestFiles) {
  if (file.operationalState) await assertStateUnlocked(file);
  const relativePath = safeRelativePath(file.relativePath);
  const destination = path.join(stageRoot, ...relativePath.split('/'));
  if (!isInside(stageRoot, destination)) throw new Error(`destino de arquivo fora do snapshot: ${relativePath}`);
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const content = await fs.readFile(file.absolutePath);
  if (relativePath.toLowerCase().endsWith('.json')) JSON.parse(content.toString('utf8'));
  await writePrivateFile(destination, content);
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  manifestFiles.push({
    path: relativePath,
    bytes: content.length,
    sha256: digest,
    private: Boolean(file.operationalState) || isPrivatePath(relativePath)
  });
}

async function copyAndVerifySnapshotFile(source, target, manifestFile) {
  await fs.copyFile(source, target, fsConstants.COPYFILE_EXCL);
  try {
    await fs.chmod(target, 0o600);
    const copiedDigest = await hashFile(target);
    if (copiedDigest.bytes !== manifestFile.bytes || copiedDigest.sha256 !== manifestFile.sha256) {
      throw new Error(`restauração cancelada: conteúdo mudou após validar o snapshot (${manifestFile.path})`);
    }
  } catch (error) {
    await fs.rm(target, { force: true }).catch(() => {});
    throw error;
  }
}

async function assertStateUnlocked(file) {
  try {
    await fs.lstat(`${file.absolutePath}.lock`);
    throw new Error(`backup cancelado: há lock ativo no estado ${path.basename(file.absolutePath)}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function verifyStateUnchanged(stateFiles, manifestFiles) {
  const digests = new Map(manifestFiles.map(file => [file.path, file]));
  for (const file of stateFiles) {
    await assertStateUnlocked(file);
    const expected = digests.get(file.relativePath);
    const current = await hashFile(file.absolutePath);
    if (!expected || current.bytes !== expected.bytes || current.sha256 !== expected.sha256) {
      throw new Error(`backup cancelado: estado alterado durante a captura (${path.basename(file.absolutePath)}); tente novamente`);
    }
    await assertStateUnlocked(file);
  }
}

async function createProjectBackup({
  workspaceRoot,
  destinationRoot,
  databasePath,
  stateDirectory,
  sourcePaths = DEFAULT_SOURCE_PATHS,
  now = new Date()
}) {
  const sourceRootPath = path.resolve(workspaceRoot);
  const backupRoot = path.resolve(destinationRoot);
  if (isInside(sourceRootPath, backupRoot)) throw new Error('destino do backup precisa ficar fora do workspace');
  if (!path.isAbsolute(sourceRootPath) || !path.isAbsolute(backupRoot)) throw new Error('caminhos absolutos obrigatórios');
  const sourceRoot = await fs.realpath(sourceRootPath);

  await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const backupRootStat = await fs.lstat(backupRoot);
  if (backupRootStat.isSymbolicLink() || !backupRootStat.isDirectory()) throw new Error('destino do backup precisa ser uma pasta real');
  await fs.chmod(backupRoot, 0o700);
  const realBackupRoot = await fs.realpath(backupRoot);
  if (isInside(sourceRoot, realBackupRoot)) throw new Error('destino real do backup está dentro do workspace');

  const finalName = backupDirectoryName(now);
  const finalPath = path.join(realBackupRoot, finalName);
  const stagePath = path.join(realBackupRoot, `.${finalName}.partial`);
  await fs.mkdir(stagePath, { mode: 0o700 });
  const manifestFiles = [];
  const skippedSymlinks = [];

  try {
    const sources = [];
    for (const sourcePath of sourcePaths) {
      sources.push(...await collectSourceFiles(sourceRoot, sourcePath, { skippedSymlinks }));
    }
    const stateFiles = await collectStateFiles(sourceRoot, stateDirectory, skippedSymlinks);
    const uniqueFiles = new Map();
    for (const file of [...sources, ...stateFiles]) uniqueFiles.set(file.relativePath, file);
    for (const file of [...uniqueFiles.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
      await copyFileEntry(file, stagePath, manifestFiles);
    }
    await verifyStateUnchanged(stateFiles, manifestFiles);

    const databaseRelativePath = 'youtube-automation-agent/data/youtube_automation.db';
    const databaseDestination = path.join(stagePath, ...databaseRelativePath.split('/'));
    const sourceDatabase = await openReadOnly(path.resolve(databasePath));
    try {
      await fs.mkdir(path.dirname(databaseDestination), { recursive: true, mode: 0o700 });
      await backupSqliteConnection(sourceDatabase, databaseDestination);
    } finally {
      await closeDatabase(sourceDatabase);
    }
    const databaseDigest = await hashFile(databaseDestination);
    manifestFiles.push({ path: databaseRelativePath, ...databaseDigest, private: true, kind: 'sqlite' });

    const manifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: now.toISOString(),
      database: { path: databaseRelativePath, integrity: 'quick_check: ok' },
      files: manifestFiles.sort((left, right) => left.path.localeCompare(right.path)),
      skippedSymlinks: skippedSymlinks.sort()
    };
    await writePrivateFile(path.join(stagePath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await fs.rename(stagePath, finalPath);
    return { path: finalPath, manifest };
  } catch (error) {
    await fs.rm(stagePath, { recursive: true, force: true });
    throw error;
  }
}

async function validateSnapshot(backupPath) {
  const snapshotRoot = path.resolve(backupPath);
  const rootStat = await fs.lstat(snapshotRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('snapshot precisa ser um diretório real');
  const manifestPath = path.join(snapshotRoot, 'manifest.json');
  const manifestStat = await fs.lstat(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) throw new Error('manifesto ausente ou inválido no snapshot');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION || !Array.isArray(manifest.files)) throw new Error('formato de backup não suportado');
  const seenPaths = new Set();
  for (const file of manifest.files) {
    const relative = safeRelativePath(file.path);
    if (relative === 'manifest.json' || seenPaths.has(relative)) throw new Error(`caminho duplicado ou reservado no manifesto: ${relative}`);
    seenPaths.add(relative);
    const absolute = path.join(snapshotRoot, ...relative.split('/'));
    if (!isInside(snapshotRoot, absolute)) throw new Error(`caminho inválido no manifesto: ${relative}`);
    let current = snapshotRoot;
    for (const [index, segment] of relative.split('/').entries()) {
      current = path.join(current, segment);
      const ancestorStat = await fs.lstat(current);
      if (ancestorStat.isSymbolicLink()) throw new Error(`symlink não permitido no caminho do snapshot: ${relative}`);
      if (index < relative.split('/').length - 1 && !ancestorStat.isDirectory()) throw new Error(`diretório de payload inválido: ${relative}`);
    }
    const stat = await fs.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`arquivo ausente ou inválido no backup: ${relative}`);
    const digest = await hashFile(absolute);
    if (digest.bytes !== file.bytes || digest.sha256 !== file.sha256) throw new Error(`hash não confere para ${relative}`);
    if (relative.toLowerCase().endsWith('.json')) JSON.parse(await fs.readFile(absolute, 'utf8'));
  }
  const databaseRelativePath = safeRelativePath(manifest.database?.path);
  if (!manifest.files.some(file => file.path === databaseRelativePath && file.kind === 'sqlite')) {
    throw new Error('o manifesto não inclui um arquivo SQLite validável');
  }
  const databasePath = path.join(snapshotRoot, ...databaseRelativePath.split('/'));
  await checkSqliteIntegrity(databasePath);
  return manifest;
}

async function restoreProjectBackup({ backupPath, restoreRoot, workspaceRoot }) {
  const snapshotRoot = path.resolve(backupPath);
  const destinationRoot = path.resolve(restoreRoot);
  if (workspaceRoot && isInside(path.resolve(workspaceRoot), destinationRoot)) {
    throw new Error('restauração isolada exige destino fora do workspace');
  }
  const manifest = await validateSnapshot(snapshotRoot);
  await fs.mkdir(path.dirname(destinationRoot), { recursive: true, mode: 0o700 });
  try {
    await fs.lstat(destinationRoot);
    throw new Error('destino de restauração já existe; use um diretório isolado vazio e novo');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const stageRoot = `${destinationRoot}.${crypto.randomUUID()}.partial`;
  await fs.mkdir(stageRoot, { recursive: false, mode: 0o700 });
  try {
    for (const file of manifest.files) {
      const relative = safeRelativePath(file.path);
      const source = path.join(snapshotRoot, ...relative.split('/'));
      const target = path.join(stageRoot, ...relative.split('/'));
      if (!isInside(stageRoot, target)) throw new Error(`caminho de restauração fora do destino: ${relative}`);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await copyAndVerifySnapshotFile(source, target, file);
    }
    await checkSqliteIntegrity(path.join(stageRoot, ...safeRelativePath(manifest.database.path).split('/')));
    await fs.rename(stageRoot, destinationRoot);
    return { path: destinationRoot, manifest };
  } catch (error) {
    await fs.rm(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

async function listExpiredProjectBackups({ destinationRoot, retentionDays, workspaceRoot, now = new Date() }) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days < 1 || days > 3650) throw new TypeError('retenção deve estar entre 1 e 3650 dias');
  const backupRoot = path.resolve(destinationRoot);
  if (workspaceRoot && isInside(path.resolve(workspaceRoot), backupRoot)) throw new Error('pasta de retenção precisa ficar fora do workspace');
  const backupRootStat = await fs.lstat(backupRoot);
  if (backupRootStat.isSymbolicLink() || !backupRootStat.isDirectory()) throw new Error('pasta de retenção precisa ser uma pasta real');
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const expired = [];
  for (const entry of await fs.readdir(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^pulso-backup-\d{8}T\d{6}Z-[0-9a-f-]{36}$/i.test(entry.name)) continue;
    const candidate = path.join(backupRoot, entry.name);
    const candidateStat = await fs.lstat(candidate);
    if (candidateStat.isSymbolicLink() || !candidateStat.isDirectory()) continue;
    let manifest;
    try {
      const manifestPath = path.join(candidate, 'manifest.json');
      const manifestStat = await fs.lstat(manifestPath);
      if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) continue;
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    }
    catch { continue; }
    const created = Date.parse(manifest.createdAt || '');
    if (manifest.formatVersion !== BACKUP_FORMAT_VERSION || !Number.isFinite(created) || created >= cutoff) continue;
    expired.push(entry.name);
  }
  return expired.sort();
}

async function pruneProjectBackups(options) {
  const expired = await listExpiredProjectBackups(options);
  const backupRoot = path.resolve(options.destinationRoot);
  const removed = [];
  for (const name of expired) {
    const candidate = path.join(backupRoot, name);
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
    await fs.rm(candidate, { recursive: true, force: false });
    removed.push(name);
  }
  return removed;
}

module.exports = {
  BACKUP_FORMAT_VERSION,
  DEFAULT_SOURCE_PATHS,
  copyAndVerifySnapshotFile,
  createProjectBackup,
  listExpiredProjectBackups,
  pruneProjectBackups,
  restoreProjectBackup,
  validateSnapshot
};
