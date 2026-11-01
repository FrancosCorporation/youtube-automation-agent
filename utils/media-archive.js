'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const MEDIA_EXTENSIONS = new Set(['.mp4', '.mp3', '.wav', '.srt', '.vtt', '.png', '.jpg', '.jpeg', '.webp', '.txt']);
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function inside(parent, candidate) {
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate !== resolvedParent && resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`);
}

function projectPath(root, candidate) {
  return path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
}

function defaultRoot() {
  return path.resolve(__dirname, '..');
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fsSync.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function assertManagedVideoFile(root, candidate) {
  const projectRoot = path.resolve(root);
  const mediaRoot = path.resolve(projectRoot, 'data', 'videos');
  const filePath = projectPath(projectRoot, candidate);
  if (!inside(mediaRoot, filePath)) throw new TypeError('arquivo deve estar dentro de data/videos');
  const extension = path.extname(filePath).toLowerCase();
  if (!MEDIA_EXTENSIONS.has(extension)) throw new TypeError('extensão não permitida para arquivo de mídia');

  const realProjectRoot = await fs.realpath(projectRoot);
  const realMediaRoot = await fs.realpath(mediaRoot);
  const expectedMediaRoot = path.resolve(realProjectRoot, path.relative(projectRoot, mediaRoot));
  if (realMediaRoot !== expectedMediaRoot) throw new TypeError('raiz data/videos inválida ou simbólica');

  const expectedFile = path.resolve(realMediaRoot, path.relative(mediaRoot, filePath));
  const realFile = await fs.realpath(filePath);
  const stat = await fs.lstat(filePath);
  if (realFile !== expectedFile || !stat.isFile()) throw new TypeError('arquivo não é um arquivo regular gerenciado');
  return { projectRoot, mediaRoot, filePath, extension, stat };
}

async function ensureArchiveObjectsRoot(root, archiveRoot) {
  const projectRoot = path.resolve(root);
  const archivePath = path.resolve(archiveRoot);
  await fs.mkdir(archivePath, { recursive: true, mode: 0o700 });
  const [realProjectRoot, realArchiveRoot] = await Promise.all([
    fs.realpath(projectRoot),
    fs.realpath(archivePath)
  ]);
  if (inside(realProjectRoot, realArchiveRoot) || realArchiveRoot === realProjectRoot) {
    throw new TypeError('arquivo deve ficar fora do workspace');
  }

  const objectsRoot = path.join(realArchiveRoot, 'objects');
  await fs.mkdir(objectsRoot, { recursive: true, mode: 0o700 });
  const realObjectsRoot = await fs.realpath(objectsRoot);
  if (realObjectsRoot !== objectsRoot) throw new TypeError('diretório objects não pode ser simbólico');
  await fs.chmod(objectsRoot, 0o700);
  return { realProjectRoot, realArchiveRoot, objectsRoot };
}

async function inspectArchiveDirectory(archiveDirectory, root) {
  const directory = path.resolve(archiveDirectory);
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory()) throw new TypeError('arquivo de mídia inválido');
  const realDirectory = await fs.realpath(directory);
  if (realDirectory !== directory) throw new TypeError('arquivo de mídia não pode usar symlink');
  if (path.basename(path.dirname(directory)) !== 'objects' || !HASH_PATTERN.test(path.basename(directory))) {
    throw new TypeError('localização do arquivo de mídia inválida');
  }
  if (root) {
    const realProjectRoot = await fs.realpath(path.resolve(root));
    if (inside(realProjectRoot, realDirectory) || realDirectory === realProjectRoot) {
      throw new TypeError('arquivo deve estar fora do workspace');
    }
  }

  const manifestPath = path.join(directory, 'manifest.json');
  const manifestStat = await fs.lstat(manifestPath);
  if (!manifestStat.isFile()) throw new TypeError('manifesto inválido');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !HASH_PATTERN.test(String(manifest.sha256 || ''))
    || manifest.sha256 !== path.basename(directory)
    || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 0
    || !MEDIA_EXTENSIONS.has(manifest.extension)
    || !Number.isFinite(Date.parse(manifest.archivedAt))) {
    throw new TypeError('manifesto de mídia inválido');
  }

  const names = (await fs.readdir(directory)).sort();
  const payloadName = `media${manifest.extension}`;
  if (names.length !== 2 || names[0] !== 'manifest.json' || names[1] !== payloadName) {
    throw new TypeError('conteúdo do arquivo não corresponde ao manifesto');
  }
  const payloadPath = path.join(directory, payloadName);
  const payloadStat = await fs.lstat(payloadPath);
  if (!payloadStat.isFile() || payloadStat.size !== manifest.bytes
    || await hashFile(payloadPath) !== manifest.sha256) {
    throw new TypeError('hash ou tamanho do arquivo arquivado não confere');
  }
  return { directory, payloadPath, manifest };
}

async function archiveMediaFile({ root = defaultRoot(), archiveRoot, sourcePath, now = new Date() } = {}) {
  if (typeof archiveRoot !== 'string' || !archiveRoot.trim()) throw new TypeError('archiveRoot é obrigatório');
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) throw new TypeError('sourcePath é obrigatório');
  const source = await assertManagedVideoFile(root, sourcePath);
  const sourceHash = await hashFile(source.filePath);
  const { objectsRoot } = await ensureArchiveObjectsRoot(source.projectRoot, archiveRoot);
  const finalDirectory = path.join(objectsRoot, sourceHash);
  const archivedAt = new Date(now).toISOString();

  try {
    const existing = await inspectArchiveDirectory(finalDirectory, source.projectRoot);
    if (existing.manifest.extension !== source.extension || existing.manifest.bytes !== source.stat.size) {
      throw new TypeError('conteúdo existente diverge do arquivo de origem');
    }
    return { archiveId: sourceHash, archiveDirectory: finalDirectory, sha256: sourceHash, bytes: source.stat.size, alreadyArchived: true };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const stagingDirectory = await fs.mkdtemp(path.join(objectsRoot, '.stage-'));
  try {
    await fs.chmod(stagingDirectory, 0o700);
    const payloadPath = path.join(stagingDirectory, `media${source.extension}`);
    await fs.copyFile(source.filePath, payloadPath, fsSync.constants.COPYFILE_EXCL);
    await fs.chmod(payloadPath, 0o600);
    const [sourceAfter, payloadStat] = await Promise.all([
      fs.stat(source.filePath),
      fs.stat(payloadPath)
    ]);
    if (sourceAfter.size !== source.stat.size || sourceAfter.mtimeMs !== source.stat.mtimeMs
      || payloadStat.size !== source.stat.size || await hashFile(payloadPath) !== sourceHash) {
      throw new Error('arquivo mudou durante o arquivamento; tente novamente');
    }

    const manifest = {
      schemaVersion: 1,
      sha256: sourceHash,
      bytes: payloadStat.size,
      extension: source.extension,
      archivedAt
    };
    const manifestPath = path.join(stagingDirectory, 'manifest.json');
    const handle = await fs.open(manifestPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(stagingDirectory, finalDirectory);
    await fs.chmod(finalDirectory, 0o700);
    return { archiveId: sourceHash, archiveDirectory: finalDirectory, sha256: sourceHash, bytes: payloadStat.size, alreadyArchived: false };
  } catch (error) {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
    if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') {
      const existing = await inspectArchiveDirectory(finalDirectory, source.projectRoot);
      if (existing.manifest.sha256 === sourceHash && existing.manifest.bytes === source.stat.size) {
        return { archiveId: sourceHash, archiveDirectory: finalDirectory, sha256: sourceHash, bytes: source.stat.size, alreadyArchived: true };
      }
    }
    throw error;
  }
}

async function verifyArchivedMedia({ archiveDirectory, root = defaultRoot() } = {}) {
  if (typeof archiveDirectory !== 'string' || !archiveDirectory.trim()) throw new TypeError('archiveDirectory é obrigatório');
  const inspected = await inspectArchiveDirectory(archiveDirectory, root);
  const { sha256, bytes, extension, archivedAt } = inspected.manifest;
  return { sha256, bytes, extension, archivedAt };
}

async function ensureManagedParent(projectRoot, mediaRoot, targetDirectory) {
  const realProjectRoot = await fs.realpath(projectRoot);
  const realMediaRoot = await fs.realpath(mediaRoot);
  const expectedMediaRoot = path.resolve(realProjectRoot, path.relative(projectRoot, mediaRoot));
  if (realMediaRoot !== expectedMediaRoot) throw new TypeError('raiz data/videos inválida ou simbólica');
  const relativeDirectory = path.relative(mediaRoot, targetDirectory);
  let current = realMediaRoot;
  for (const segment of relativeDirectory.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory()) throw new TypeError('destino de restauração contém caminho não permitido');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(current, { mode: 0o700 });
    }
    if (await fs.realpath(current) !== current) throw new TypeError('destino de restauração contém symlink');
  }
}

async function restoreArchivedMedia({ root = defaultRoot(), archiveDirectory, targetPath } = {}) {
  if (typeof archiveDirectory !== 'string' || !archiveDirectory.trim()) throw new TypeError('archiveDirectory é obrigatório');
  if (typeof targetPath !== 'string' || !targetPath.trim()) throw new TypeError('targetPath é obrigatório');
  const projectRoot = path.resolve(root);
  const archive = await inspectArchiveDirectory(archiveDirectory, projectRoot);
  const mediaRoot = path.resolve(projectRoot, 'data', 'videos');
  const target = projectPath(projectRoot, targetPath);
  if (!inside(mediaRoot, target) || path.extname(target).toLowerCase() !== archive.manifest.extension) {
    throw new TypeError('destino deve ser novo e estar em data/videos com extensão compatível');
  }
  await ensureManagedParent(projectRoot, mediaRoot, path.dirname(target));
  try {
    await fs.lstat(target);
    throw new TypeError('destino de restauração já existe');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const temporaryPath = path.join(path.dirname(target), `.restore-${crypto.randomUUID()}.tmp`);
  try {
    await fs.copyFile(archive.payloadPath, temporaryPath, fsSync.constants.COPYFILE_EXCL);
    await fs.chmod(temporaryPath, 0o600);
    if (await fs.stat(temporaryPath).then(stat => stat.size) !== archive.manifest.bytes
      || await hashFile(temporaryPath) !== archive.manifest.sha256) {
      throw new TypeError('cópia de restauração não passou na verificação de integridade');
    }
    await fs.link(temporaryPath, target);
    await fs.unlink(temporaryPath);
    return { sha256: archive.manifest.sha256, bytes: archive.manifest.bytes, targetPath: target };
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

function optionValue(args, key) {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
}

async function runCli(args) {
  const [command] = args;
  if (command === '--help' || command === '-h') {
    console.log('Uso: media-archive.js archive --root <workspace> --archive-root <volume-externo> --file <data/videos/arquivo.mp4>');
    console.log('     media-archive.js verify --root <workspace> --archive-dir <objetos/<sha256>>');
    console.log('     media-archive.js restore --root <workspace> --archive-dir <objetos/<sha256>> --to <data/videos/novo-nome.mp4>');
    return;
  }
  const root = optionValue(args, '--root') || defaultRoot();
  if (command === 'archive') {
    const result = await archiveMediaFile({ root, archiveRoot: optionValue(args, '--archive-root'), sourcePath: optionValue(args, '--file') });
    console.log(JSON.stringify({ archiveId: result.archiveId, sha256: result.sha256, bytes: result.bytes, alreadyArchived: result.alreadyArchived }));
    return;
  }
  if (command === 'verify') {
    console.log(JSON.stringify(await verifyArchivedMedia({ archiveDirectory: optionValue(args, '--archive-dir'), root })));
    return;
  }
  if (command === 'restore') {
    const result = await restoreArchivedMedia({ root, archiveDirectory: optionValue(args, '--archive-dir'), targetPath: optionValue(args, '--to') });
    console.log(JSON.stringify({ sha256: result.sha256, bytes: result.bytes }));
    return;
  }
  throw new TypeError('uso: media-archive.js archive|verify|restore --help');
}

if (require.main === module) {
  runCli(process.argv.slice(2)).catch(error => {
    console.error(`Falha no arquivamento: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { archiveMediaFile, restoreArchivedMedia, verifyArchivedMedia };
