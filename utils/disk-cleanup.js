'use strict';

const fs = require('fs').promises;
const path = require('path');
const { allArtifactOwnersConfirmed, artifactOwnerPublicationProofs, clipCanBeDeletedAfterPublication, longUploadsSucceeded, normalizedClips, publicationSucceeded } = require('./publication-status');
const { deleteMediaWithEvidence } = require('./media-deletion');
const { scanDiskMediaInventory } = require('./disk-media-inventory');
const { sha256StableRegularFile, verifyArtifactOwnersForPublication } = require('./video-qa-manifest');
const { isApprovedExistingEpisode } = require('./video-generation-control');

const DAY_MS = 24 * 60 * 60 * 1000;

function isSafeUnapprovedDeletion(ownerProofs) {
  if (!Array.isArray(ownerProofs) || !ownerProofs.length) return false;
  const conclusivelyNotSubmitted = new Set([
    'not_attempted', 'not_logged_legacy', 'skipped', 'disabled_or_not_targeted_legacy', 'quota_skipped_legacy'
  ]);
  return ownerProofs.every(owner => {
    if (!(owner.publicationEligible === false || owner.publicationReviewStatus === 'rejected')
      || !Array.isArray(owner.destinations) || !owner.destinations.length) return false;
    return owner.destinations.every(destination => {
      if (destination.status === 'confirmed') {
        const reviewedHash = String(owner.reviewedAssetSha256 || '').toLowerCase();
        const destinationHash = String(destination.artifactSha256 || '').toLowerCase();
        return /^[a-f0-9]{64}$/.test(reviewedHash) && destination.legacyProof !== true
          && destinationHash === reviewedHash;
      }
      return conclusivelyNotSubmitted.has(destination.status)
        || (destination.status === 'failed' && destination.evidenceKind === 'confirmed_no_send');
    });
  });
}

function positiveDays(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.min(Math.floor(number), 3650) : fallback;
}

function inside(base, candidate) {
  const resolvedBase = path.resolve(base);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedBase || resolvedCandidate.startsWith(`${resolvedBase}${path.sep}`);
}

async function safeManagedTarget(root, allowedRoot, candidate, type) {
  const projectRoot = path.resolve(root);
  const managedRoot = path.resolve(allowedRoot);
  const target = path.resolve(candidate);
  if (!inside(managedRoot, target)) return false;

  try {
    const realProjectRoot = await fs.realpath(projectRoot);
    const realManagedRoot = await fs.realpath(managedRoot);
    const expectedManagedRoot = path.resolve(realProjectRoot, path.relative(projectRoot, managedRoot));
    if (realManagedRoot !== expectedManagedRoot) return false;

    const relativeTarget = path.relative(managedRoot, target);
    const expectedTarget = path.resolve(realManagedRoot, relativeTarget);
    const realTarget = await fs.realpath(target);
    if (realTarget !== expectedTarget) return false;

    const stat = await fs.lstat(target);
    return type === 'directory' ? stat.isDirectory() : stat.isFile();
  } catch (_error) {
    return false;
  }
}

function projectPath(root, candidate) {
  return path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
}

async function readProcessList() {
  const procRoot = '/proc';
  let names;
  try { names = await fs.readdir(procRoot); } catch (_error) { return []; }
  const processes = [];
  for (const name of names) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    try {
      const command = (await fs.readFile(path.join(procRoot, name, 'cmdline'))).toString().replace(/\0/g, ' ');
      if (command) processes.push({ pid: Number(name), command });
    } catch (_error) { /* process exited or is not readable */ }
  }
  return processes;
}

async function directoryStats(dir) {
  let bytes = 0;
  let latestMtime = 0;
  const files = [];
  const directories = [dir];
  while (directories.length) {
    const current = directories.pop();
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch (_error) { continue; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        directories.push(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath);
          bytes += stat.size;
          latestMtime = Math.max(latestMtime, stat.mtimeMs);
          files.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch (_error) { /* file was rotated or removed */ }
      }
    }
  }
  return { bytes, latestMtime, files };
}

async function findNamedDirectories(baseDir, names) {
  const wanted = new Set(names);
  const found = [];
  const pending = [baseDir];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch (_error) { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(current, entry.name);
      if (wanted.has(entry.name)) found.push(fullPath);
      else pending.push(fullPath);
    }
  }
  return found;
}

async function stateDirectories(root, configuredStateDir) {
  const dirs = new Set([path.resolve(root, configuredStateDir || 'data/state')]);
  const dataDir = path.join(root, 'data');
  try {
    for (const entry of await fs.readdir(dataDir, { withFileTypes: true })) {
      if (entry.isDirectory() && /^state(?:-|$)/i.test(entry.name)) dirs.add(path.join(dataDir, entry.name));
    }
  } catch (_error) { /* data directory may not exist */ }
  return [...dirs];
}

async function readManagedState(root, configuredStateDir) {
  const ledgers = [];
  const protectedPaths = new Set();
  for (const dir of await stateDirectories(root, configuredStateDir)) {
    try {
      const ledger = JSON.parse(await fs.readFile(path.join(dir, 'topics.json'), 'utf8'));
      if (Array.isArray(ledger.entries)) ledgers.push(ledger);
    } catch (_error) { /* absent or not yet initialized */ }
    try {
      const queue = JSON.parse(await fs.readFile(path.join(dir, 'publish-queue.json'), 'utf8'));
      for (const item of [...(queue.pending || []), ...(queue.inFlight ? [queue.inFlight] : [])]) {
        if (item && item.outPath) protectedPaths.add(projectPath(root, item.outPath));
      }
    } catch (_error) { /* absent queue */ }
  }
  return { ledgers, protectedPaths };
}

function formatMb(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * Remove only managed regenerable artifacts and media whose destinations succeeded.
 * The default is preview-only; callers must pass apply:true to remove files.
 */
async function cleanupDisk(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  const now = Number(options.now) || Date.now();
  const apply = options.apply === true;
  const log = typeof options.log === 'function' ? options.log : console.log;
  const snapshotDays = positiveDays(options.snapshotRetentionDays ?? process.env.DISK_SNAPSHOT_RETENTION_DAYS, 7);
  const imageDays = positiveDays(options.imageRetentionDays ?? process.env.DISK_IMAGE_RETENTION_DAYS, 14);
  const browserDays = positiveDays(options.browserCacheRetentionDays ?? process.env.DISK_BROWSER_CACHE_RETENTION_DAYS, 7);
  const uploadedGraceHoursValue = Number(options.uploadedGraceHours ?? process.env.DISK_UPLOADED_MASTER_GRACE_HOURS ?? 0);
  const uploadedGraceHours = Number.isFinite(uploadedGraceHoursValue) && uploadedGraceHoursValue >= 0
    ? Math.min(uploadedGraceHoursValue, 24 * 365)
    : 0;
  const videoRoot = path.join(root, 'data', 'videos');
  const candidates = [];
  const report = { apply, removedFiles: 0, removedDirectories: 0, reclaimedBytes: 0,
    candidates: [], deleted: [], skipped: [], inventory: null };
  const seen = new Set();
  const addFile = (category, filePath, bytes, expectedSha256 = null) => {
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push({ category, path: resolved, bytes, type: 'file', ...(expectedSha256 ? { expectedSha256 } : {}) });
  };
  const addDirectory = (category, dirPath, bytes) => {
    const resolved = path.resolve(dirPath);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push({ category, path: resolved, bytes, type: 'directory' });
  };

  const snapshotRoot = path.join(root, 'logs', 'snaps');
  const snapshotCutoff = now - snapshotDays * DAY_MS;
  const snapshots = await directoryStats(snapshotRoot);
  for (const file of snapshots.files) {
    if (file.mtimeMs < snapshotCutoff && /\.(?:png|jpe?g|webp)$/i.test(file.path)) {
      addFile('debug-snapshot', file.path, file.size);
    }
  }

  const processes = await readProcessList();
  const generatorActive = processes.some(p => /scripts\/generate-animated-video\.js\b/.test(p.command));
  const imageRoot = path.join(root, 'data', 'images');
  if (generatorActive) {
    report.skipped.push('cache de imagens: há uma geração ativa');
  } else {
    let imageDirs = [];
    try {
      imageDirs = (await fs.readdir(imageRoot, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(imageRoot, entry.name));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        report.skipped.push(`cache de imagens: falha ao listar (${error.message})`);
      }
    }
    const imageCutoff = now - imageDays * DAY_MS;
    for (const dir of imageDirs) {
      const stats = await directoryStats(dir);
      if (stats.files.length && stats.latestMtime < imageCutoff) addDirectory('generated-image-cache', dir, stats.bytes);
    }
  }

  const profilesRoot = path.join(root, 'data', 'browser-profiles');
  const browsersActive = processes.some(p => /browser-profiles[\\/]/.test(p.command));
  if (browsersActive) {
    report.skipped.push('cache de navegador: há Chromium usando um perfil');
  } else {
    const cacheDirs = await findNamedDirectories(profilesRoot, ['Cache', 'Code Cache', 'GPUCache']);
    const cacheCutoff = now - browserDays * DAY_MS;
    for (const dir of cacheDirs) {
      const stats = await directoryStats(dir);
      for (const file of stats.files) if (file.mtimeMs < cacheCutoff) addFile('browser-cache', file.path, file.size);
    }
  }

  const state = await readManagedState(root, options.stateDir);
  const allEntriesForInventory = state.ledgers.flatMap(ledger => ledger.entries);
  report.inventory = await scanDiskMediaInventory({ root, stateDir: options.stateDir, now });
  for (const protectedPath of options.protectedVideoPaths || []) {
    if (protectedPath) state.protectedPaths.add(projectPath(root, protectedPath));
  }
  if (options.deleteUploadedMedia === true) {
    const graceCutoff = now - uploadedGraceHours * 60 * 60 * 1000;
    for (const ledger of state.ledgers) {
      for (const entry of ledger.entries) {
        if (!entry || typeof entry !== 'object') continue;
        // Its QA manifest covers the master and all parts. Removing one
        // confirmed asset makes the remaining approved parts unverifiable.
        if (isApprovedExistingEpisode(entry)) continue;
        const generatedAt = Date.parse(entry.generatedAt || '');
        const youtubeResult = entry.results?.long?.youtube || entry.ytUrl;
        const confirmedYouTubeUrl = publicationSucceeded(youtubeResult);
        if (entry.publicationEligible === false || !Number.isFinite(generatedAt) || generatedAt > graceCutoff
          || typeof entry.videoPath !== 'string' || !entry.videoPath) continue;
        const videoPath = projectPath(root, entry.videoPath);
        if (!inside(videoRoot, videoPath) || path.extname(videoPath).toLowerCase() !== '.mp4' || state.protectedPaths.has(videoPath)) continue;

        if (confirmedYouTubeUrl) {
          let current;
          try { current = await sha256StableRegularFile(videoPath); } catch (_error) { current = null; }
          if (current
            && longUploadsSucceeded(entry, entry.results, { root, expectedSha256: current.sha256 })
            && allArtifactOwnersConfirmed(allEntriesForInventory, videoPath, {
              root, expectedSha256: current.sha256, requirePublicationEligible: true
            })
            && (await verifyArtifactOwnersForPublication({
              root, entries: allEntriesForInventory, artifactPath: videoPath, expectedSha256: current.sha256
            })).status === 'verified') {
            try {
              const stat = await fs.stat(videoPath);
              if (stat.isFile()) addFile('confirmed-youtube-master', videoPath, stat.size, current.sha256);
            } catch (_error) { /* already gone */ }
          }
        }

        for (const [index, clip] of normalizedClips(entry).entries()) {
          const clipPath = projectPath(root, clip.path);
          if (!inside(videoRoot, clipPath) || path.extname(clipPath).toLowerCase() !== '.mp4'
            || state.protectedPaths.has(clipPath)) continue;
          let current;
          try { current = await sha256StableRegularFile(clipPath); } catch (_error) { current = null; }
          if (!current || !clipCanBeDeletedAfterPublication(entry, entry.results, index, { root, expectedSha256: current.sha256 })
            || !allArtifactOwnersConfirmed(allEntriesForInventory, clipPath, {
              root, expectedSha256: current.sha256, requirePublicationEligible: true
            })
            || (await verifyArtifactOwnersForPublication({
              root, entries: allEntriesForInventory, artifactPath: clipPath, expectedSha256: current.sha256
            })).status !== 'verified') continue;
          try {
            const stat = await fs.stat(clipPath);
            if (stat.isFile()) addFile('confirmed-social-clip', clipPath, stat.size, current.sha256);
          } catch (_error) { /* already gone */ }
        }
      }
    }
  }

  if (options.deleteUnapprovedMedia === true) {
    const artifacts = new Set();
    for (const entry of allEntriesForInventory) {
      if (typeof entry?.videoPath === 'string' && entry.videoPath) artifacts.add(projectPath(root, entry.videoPath));
      for (const clip of normalizedClips(entry)) artifacts.add(projectPath(root, clip.path));
    }
    for (const artifactPath of artifacts) {
      if (!inside(videoRoot, artifactPath) || path.extname(artifactPath).toLowerCase() !== '.mp4'
        || state.protectedPaths.has(artifactPath)) continue;
      const ownerProofs = artifactOwnerPublicationProofs(allEntriesForInventory, artifactPath, { root });
      if (!isSafeUnapprovedDeletion(ownerProofs)) continue;
      const reviewedHashes = ownerProofs.map(owner => owner.reviewedAssetSha256);
      if (!reviewedHashes.length || reviewedHashes.some(hash => !/^[a-f0-9]{64}$/i.test(String(hash || '')))
        || new Set(reviewedHashes.map(hash => hash.toLowerCase())).size !== 1) continue;
      try {
        const stat = await fs.lstat(artifactPath);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const current = await sha256StableRegularFile(artifactPath);
        if (current.sha256 !== reviewedHashes[0].toLowerCase()) continue;
        addFile('qa-unapproved-media', artifactPath, stat.size, current.sha256);
      } catch (_error) { /* already removed or inaccessible */ }
    }
  }

  // Recheck process use after planning; a browser/generator may have started
  // while the filesystem inventory was being collected.
  if (apply && candidates.some(c => c.category === 'browser-cache' || c.category === 'generated-image-cache')) {
    const latestProcesses = await readProcessList();
    const nowGeneratorActive = latestProcesses.some(p => /scripts\/generate-animated-video\.js\b/.test(p.command));
    const nowBrowserActive = latestProcesses.some(p => /browser-profiles[\\/]/.test(p.command));
    const blocked = new Set();
    if (nowGeneratorActive) blocked.add('generated-image-cache');
    if (nowBrowserActive) blocked.add('browser-cache');
    if (blocked.size) {
      for (const category of blocked) report.skipped.push(`${category}: processo iniciou durante a varredura`);
      for (let i = candidates.length - 1; i >= 0; i--) if (blocked.has(candidates[i].category)) candidates.splice(i, 1);
    }
  }

  const safeCandidates = [];
  for (const candidate of candidates) {
    const allowedRoot = candidate.type === 'directory'
      ? imageRoot
      : candidate.category === 'debug-snapshot'
        ? snapshotRoot
        : candidate.category === 'browser-cache'
          ? profilesRoot
          : videoRoot;
    if (!await safeManagedTarget(root, allowedRoot, candidate.path, candidate.type)) {
      report.skipped.push(`${candidate.category}: caminho simbólico ou fora da raiz gerenciada`);
      continue;
    }
    safeCandidates.push(candidate);
  }
  candidates.splice(0, candidates.length, ...safeCandidates);

  for (const candidate of candidates) {
    if (!apply) continue;
    try {
      const allowedRoot = candidate.type === 'directory'
        ? imageRoot
        : candidate.category === 'debug-snapshot'
          ? snapshotRoot
          : candidate.category === 'browser-cache'
            ? profilesRoot
            : videoRoot;
      if (!await safeManagedTarget(root, allowedRoot, candidate.path, candidate.type)) {
        report.skipped.push(`${candidate.category}: caminho mudou durante a limpeza`);
        continue;
      }
      if (candidate.type === 'directory') {
        await fs.rm(candidate.path, { recursive: true, force: true });
        report.removedDirectories++;
      } else {
        if (candidate.category === 'confirmed-youtube-master' || candidate.category === 'confirmed-social-clip'
          || candidate.category === 'qa-unapproved-media') {
          const deletion = await deleteMediaWithEvidence({
            root,
            filePath: candidate.path,
            allowedRoots: [videoRoot],
            ledgerPath: path.join(path.resolve(root, options.stateDir || 'data/state'), 'media-deletions.jsonl'),
            disposition: candidate.category === 'qa-unapproved-media'
              ? { kind: candidate.category, reason: 'artefato sem liberação factual/QA; arquivo aposentado antes de recriação' }
              : { kind: candidate.category, reason: 'todos os destinos esperados para cada referência ao arquivo foram confirmados' },
            ...(candidate.expectedSha256 ? { expectedSha256: candidate.expectedSha256 } : {}),
            ownerProofs: artifactOwnerPublicationProofs(allEntriesForInventory, candidate.path, { root })
          });
          candidate.sha256 = deletion.sha256;
          candidate.deletionId = deletion.deletionId;
        } else {
          await fs.unlink(candidate.path);
        }
        report.removedFiles++;
      }
      report.reclaimedBytes += candidate.bytes;
      report.deleted.push({ category: candidate.category, path: candidate.path, bytes: candidate.bytes,
        ...(candidate.sha256 ? { sha256: candidate.sha256 } : {}), ...(candidate.deletionId ? { deletionId: candidate.deletionId } : {}) });
    } catch (error) {
      report.skipped.push(`${candidate.category}: arquivo preservado após falha na exclusão (${String(error.message || error).slice(0, 180)})`);
    }
  }

  const totals = new Map();
  for (const candidate of candidates) totals.set(candidate.category, (totals.get(candidate.category) || 0) + candidate.bytes);
  for (const [category, bytes] of totals) {
    log(`${apply ? '🧹 limpeza' : '🔎 candidato'} ${category}: ${formatMb(bytes)} em ${candidates.filter(c => c.category === category).length} item(ns)`);
  }
  for (const reason of report.skipped) log(`⏭️ ${reason}`);
  if (report.inventory) {
    const { totals } = report.inventory;
    log(`📂 inventário de vídeos: ${totals.files} arquivos, ${totals['ledger-linked']} vinculados, ${totals.queued} na fila, ${totals.untracked} sem vínculo (${formatMb(totals.bytes)})`);
  }
  if (apply) log(`🧹 limpeza concluída: ${formatMb(report.reclaimedBytes)} liberados`);
  else log(`🔎 prévia: ${formatMb([...totals.values()].reduce((sum, bytes) => sum + bytes, 0))} seriam liberados; use --apply para excluir`);
  report.candidates = candidates.map(({ category, path: candidatePath, bytes }) => ({ category, path: candidatePath, bytes }));
  report.candidateFiles = candidates.length;
  report.candidateBytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0);
  return report;
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Uso: node utils/disk-cleanup.js [--apply] [--include-uploaded]');
    console.log('Sem --apply, só mostra uma prévia. --include-uploaded inclui masters com URL confirmada no YouTube.');
    process.exit(0);
  }
  cleanupDisk({
    apply: process.argv.includes('--apply'),
    stateDir: process.env.STATE_DIR || 'data/state',
    deleteUploadedMedia: process.env.DELETE_AFTER_UPLOAD === '1' || process.argv.includes('--include-uploaded')
  }).catch(error => {
    console.error(`Falha na limpeza: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { cleanupDisk, isSafeUnapprovedDeletion };
